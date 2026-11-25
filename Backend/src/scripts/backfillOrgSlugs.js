import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { getMongoTarget } from "../utils/mongoTarget.js";
import TeamOrganization from "../models/TeamOrganization.js";
import { generateOrgSlug } from "../services/membershipService.js";
import { slugify } from "../utils/slug.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// ---------------------------------------------------------------------------
// Backfill public club slugs.
//
//   npm run orgs:backfill-slugs             # dry-run (default)
//   npm run orgs:backfill-slugs -- --apply  # write
//
// Only organizations with no slug are touched. An existing slug is a public
// address and is never rewritten, so the script is safe to run repeatedly:
// a second run finds nothing to do. Collisions are resolved by the same
// `generateOrgSlug` helper the API uses (`name`, `name-2`, `name-3`, …) and
// reserved words (`public`, `my`, `admin`, …) are skipped. Ownerless legacy
// clubs are included — no owner is required for a slug.
// ---------------------------------------------------------------------------

const EMPTY_SLUG = { $or: [{ slug: { $exists: false } }, { slug: null }, { slug: "" }] };

/**
 * Pure-ish worker so tests can call it against a throwaway database without
 * spawning a process. Returns the summary it printed.
 */
export async function backfillOrgSlugs({
  apply = false,
  log = console.log,
  Organization = TeamOrganization,
  generate = generateOrgSlug,
} = {}) {
  const orgs = await Organization.find({})
    .select("_id name slug owner")
    .sort({ createdAt: 1, _id: 1 })
    .lean();

  let alreadyHadSlug = 0;
  let written = 0;
  let skipped = 0;
  let failed = 0;
  const collisions = [];

  for (const org of orgs) {
    if (org.slug) {
      alreadyHadSlug += 1;
      continue;
    }

    const candidate = await generate(org.name, org._id);
    if (candidate !== slugify(org.name)) {
      collisions.push({ name: org.name, slug: candidate });
    }

    if (!apply) {
      written += 1;
      log(`  would set  ${org.name} (${org._id}) -> ${candidate}`);
      continue;
    }

    try {
      // Re-check the slug in the update filter so a concurrent run (or an edit
      // that landed while we were reading) can never overwrite a real slug.
      const result = await Organization.updateOne(
        { _id: org._id, ...EMPTY_SLUG },
        { $set: { slug: candidate } }
      );
      if (result.modifiedCount === 1) {
        written += 1;
        log(`  set        ${org.name} (${org._id}) -> ${candidate}`);
      } else {
        skipped += 1;
        log(`  skipped    ${org.name} (${org._id}) — slug appeared meanwhile`);
      }
    } catch (error) {
      if (error?.code === 11000) {
        // The unique index caught a race. Retry once through the collision-safe
        // generator so the run still finishes; anything else is reported.
        try {
          const retry = await generate(org.name, org._id);
          await Organization.updateOne(
            { _id: org._id, ...EMPTY_SLUG },
            { $set: { slug: retry } }
          );
          written += 1;
          log(`  set        ${org.name} (${org._id}) -> ${retry} (after collision)`);
        } catch (retryError) {
          failed += 1;
          log(`  FAILED     ${org.name} (${org._id}): ${retryError.message}`);
        }
      } else {
        failed += 1;
        log(`  FAILED     ${org.name} (${org._id}): ${error.message}`);
      }
    }
  }

  const summary = {
    scanned: orgs.length,
    alreadyHadSlug,
    missingSlug: alreadyHadSlug === orgs.length ? 0 : orgs.length - alreadyHadSlug,
    written: apply ? written : 0,
    wouldWrite: apply ? 0 : written,
    skipped,
    failed,
    collisions,
  };

  log("");
  log("Summary");
  log(`  organizations scanned        : ${summary.scanned}`);
  log(`  already had a slug           : ${summary.alreadyHadSlug}`);
  log(`  missing a slug               : ${summary.missingSlug}`);
  log(`  ${apply ? "slugs written" : "slugs that would be written"}                : ${apply ? summary.written : summary.wouldWrite}`);
  log(`  skipped (race)               : ${summary.skipped}`);
  log(`  failed                       : ${summary.failed}`);
  if (collisions.length) {
    log(`  collision-safe suffixes used : ${collisions.length}`);
    for (const row of collisions.slice(0, 20)) log(`    ${row.name} -> ${row.slug}`);
  }
  log(
    apply
      ? "\nBackfill applied."
      : "\nDry-run: nothing written. Re-run with --apply to persist."
  );
  return summary;
}

async function main() {
  const url = process.env.MONGO_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!url) throw new Error("MONGO_URL / MONGODB_URI / MONGO_URI is required.");

  const apply = process.argv.includes("--apply");
  const target = getMongoTarget(url);

  await mongoose.connect(url, {
    serverSelectionTimeoutMS: 60000,
    connectTimeoutMS: 60000,
    socketTimeoutMS: 120000,
  });

  console.log(`Mongo host: ${target.host || "unknown"} (db: ${target.databaseName || "?"})`);
  console.log(`Mode: ${apply ? "APPLY" : "dry-run"}`);
  console.log("");

  await backfillOrgSlugs({ apply });
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (invokedDirectly) {
  main()
    .catch((error) => {
      console.error("backfillOrgSlugs failed:", error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

export default backfillOrgSlugs;
