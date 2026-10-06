// Round 5 — team visibility backfill (`Team.isPublic`).
//
// Why this exists
// ---------------
// `isPublic` is the switch `teamService.listTeams` reads before it will return an
// organization-owned team to an unauthenticated caller. It was added in Round 5b
// so the public "All Teams" page is not limited to org-less platform teams.
//
// A schema default is not enough on its own, and this is the part that is easy to
// get wrong: `listTeams` queries with `.lean()`, which returns raw BSON with no
// Mongoose defaults applied. So a legacy document that has NO `isPublic` field
// does not match `{ isPublic: true }` — Mongo will not match a missing field
// against `true`. Those teams stay hidden from the public list until they are
// explicitly written, no matter what the schema default says.
//
// Modes (mutually exclusive; --apply requires one)
// ------------------------------------------------
//   (none)              report only. Changes nothing, always.
//   --set-public        isPublic: true on teams MISSING the field only. Safe for
//                       adoption: publishes legacy teams without touching any
//                       team that has already been given an explicit opinion.
//   --force-private     isPublic: false on every team currently published.
//                       Destructive to visibility, so it must be asked for by
//                       name and is never implied by --set-public.
//
// Safety
// ------
//   * Refuses to run without an explicit --uri. This script does not read .env.
//   * Refuses any non-loopback host, and any database other than cric-all-e2e,
//     unless --allow-host / --allow-database name them deliberately.
//   * Deletes nothing, ever. The only writes are a single updateMany that sets
//     one boolean.
//   * Dry run by default: without --apply it only counts and prints.
//
// Usage
// -----
//   node src/scripts/migrateSetIsPublic.js --uri <mongodb-uri>
//   node src/scripts/migrateSetIsPublic.js --uri <mongodb-uri> --set-public --apply
//   node src/scripts/migrateSetIsPublic.js --uri <mongodb-uri> --force-private --apply
//   node src/scripts/migrateSetIsPublic.js --uri <mongodb-uri> --force-private --apply --allow-database <name>
//
// Containerized deployments (the database hostname is a Docker service name
// such as `mongodb`, not loopback) must name it deliberately:
//
//   node src/scripts/migrateSetIsPublic.js \
//     --uri "$MONGO_URL" --allow-host mongodb --allow-database cric-all --set-public --apply

import mongoose from "mongoose";
import Team from "../models/Team.js";
import { getMongoTarget } from "../utils/mongoTarget.js";

const EXPECTED_DATABASE = "cric-all-e2e";
const ORG_LESS = "(no organization)";

const SET_PUBLIC = "--set-public";
const FORCE_PRIVATE = "--force-private";

function argValue(flag) {
  const a = process.argv.find((x) => x.startsWith(flag + "="));
  if (a) return a.slice(flag.length + 1);
  const i = process.argv.indexOf(flag);
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) {
    return process.argv[i + 1];
  }
  return undefined;
}

function parseMode() {
  const setPublic = process.argv.includes(SET_PUBLIC);
  const forcePrivate = process.argv.includes(FORCE_PRIVATE);
  if (setPublic && forcePrivate) {
    throw new Error(
      `Refusing to run: ${SET_PUBLIC} and ${FORCE_PRIVATE} are opposite intents. Pick one.`,
    );
  }
  if (!setPublic && !forcePrivate) return "report";
  return setPublic ? "set-public" : "force-private";
}

/** What a mode would write, and what it deliberately leaves alone. */
function planFor(mode) {
  if (mode === "set-public") {
    return {
      label: `${SET_PUBLIC} — publish legacy teams that have no opinion yet`,
      filter: { $or: [{ isPublic: { $exists: false } }, { isPublic: null }] },
      update: { $set: { isPublic: true } },
      touches: "teams with isPublic missing or null",
      leaves: "every team that already has isPublic true or false",
    };
  }
  if (mode === "force-private") {
    return {
      label: `${FORCE_PRIVATE} — un-publish every currently published team`,
      filter: { isPublic: true },
      update: { $set: { isPublic: false } },
      touches: "every team with isPublic: true",
      leaves: "teams already private",
    };
  }
  return null;
}

async function resolveMode() {
  const url = argValue("--uri");
  if (!url) {
    throw new Error(
      "No connection string. Pass --uri <mongodb-uri> explicitly (this script does not read .env), " +
        "e.g. --uri mongodb://127.0.0.1:27017/cric-all-e2e",
    );
  }

  const { host, databaseName } = getMongoTarget(url);
  const hostname = host.replace(/^.*@/, "").split(":")[0].replace(/\[|\]$/g, "");
  const allowedHostname = argValue("--allow-host");
  if (!["127.0.0.1", "localhost", "::1", allowedHostname].includes(hostname)) {
    throw new Error(
      `Refusing to run: host ${hostname} is not loopback. This script only touches a ` +
        "known local database. Pass --allow-host=<name> if you really mean another " +
        "host, e.g. a Docker service name on an internal network.",
    );
  }

  const allowDb = argValue("--allow-database");
  if (allowDb) {
    if (databaseName !== allowDb) {
      throw new Error(`Refusing to run: connected to ${databaseName}, not ${allowDb}.`);
    }
  } else if (databaseName !== EXPECTED_DATABASE) {
    throw new Error(
      `Refusing to run: database is ${databaseName}, expected ${EXPECTED_DATABASE}. ` +
        "Point --uri at the local throwaway database, or pass --allow-database <name> deliberately.",
    );
  }

  const mode = parseMode();
  const apply = process.argv.includes("--apply");
  if (apply && mode === "report") {
    throw new Error(
      `Refusing to run: --apply needs a mode. Pass ${SET_PUBLIC} or ${FORCE_PRIVATE}. ` +
        "Run without --apply first to see the counts.",
    );
  }

  return { url, databaseName, mode, apply };
}

/**
 * Counts per organization. `unset` is `isPublic == null`, which in an aggregation
 * also matches a missing field — that is the population `--set-public` exists to
 * publish, so it is worth seeing it per organization and not just in total.
 */
async function reportPerOrg(collection) {
  const rows = await collection
    .aggregate([
      {
        $group: {
          _id: { $ifNull: ["$organizationRef", ORG_LESS] },
          total: { $sum: 1 },
          published: { $sum: { $cond: [{ $eq: ["$isPublic", true] }, 1, 0] } },
          private: { $sum: { $cond: [{ $eq: ["$isPublic", false] }, 1, 0] } },
          unset: { $sum: { $cond: [{ $eq: ["$isPublic", null] }, 1, 0] } },
        },
      },
      { $sort: { total: -1, _id: 1 } },
    ])
    .toArray();

  // Names make the table readable; a missing organizations collection is not fatal.
  let names = new Map();
  try {
    const orgs = mongoose.connection.collection("organizations");
    for (const org of await orgs.find({}, { projection: { name: 1 } }).toArray()) {
      names.set(String(org._id), org.name || "");
    }
  } catch {
    /* names are a nicety, not a requirement */
  }

  const label = (id) =>
    id === ORG_LESS ? ORG_LESS : `${names.get(String(id)) || "organization"} (${id})`;

  console.log("");
  console.log("Per organization:");
  console.log("  organization".padEnd(46) + "total".padStart(7) + "public".padStart(8) + "private".padStart(9) + "unset".padStart(7));
  console.log("  " + "-".repeat(76));

  const totals = { total: 0, published: 0, private: 0, unset: 0 };
  for (const row of rows) {
    console.log(
      "  " +
        label(row._id).slice(0, 45).padEnd(46) +
        String(row.total).padStart(7) +
        String(row.published).padStart(8) +
        String(row.private).padStart(9) +
        String(row.unset).padStart(7),
    );
    totals.total += row.total;
    totals.published += row.published;
    totals.private += row.private;
    totals.unset += row.unset;
  }
  console.log("  " + "-".repeat(76));
  console.log(
    "  " + "TOTAL".padEnd(46) +
      String(totals.total).padStart(7) +
      String(totals.published).padStart(8) +
      String(totals.private).padStart(9) +
      String(totals.unset).padStart(7),
  );
  console.log("");
  return totals;
}

async function main() {
  const { url, databaseName, mode, apply } = await resolveMode();
  const plan = planFor(mode);

  console.log("");
  console.log("=== team visibility migration (isPublic) ==========================");
  console.log(`  Target     : ${databaseName} (loopback verified)`);
  console.log(`  Mode       : ${plan ? plan.label : "REPORT ONLY — no mode selected"}`);
  console.log(`  Will write : ${apply ? "YES (--apply)" : "no (dry run)"}`);
  if (plan) {
    console.log(`  Touches    : ${plan.touches}`);
    console.log(`  Leaves     : ${plan.leaves}`);
  }
  console.log("  Deletes    : nothing, ever");
  console.log("===================================================================");

  mongoose.set("autoIndex", false);
  await mongoose.connect(url, { maxPoolSize: 1, serverSelectionTimeoutMS: 5000 });
  try {
    const collection = Team.collection;
    await reportPerOrg(collection);

    if (!plan) {
      console.log("No mode selected, so nothing was changed.");
      console.log(
        `To publish legacy teams:  --set-public --apply\n` +
          `To un-publish everything: --force-private --apply`,
      );
      return;
    }

    const matched = await collection.countDocuments(plan.filter);

    if (!apply) {
      console.log(`Dry run: ${matched} team(s) would be set to isPublic: ${mode === "set-public"}`);
      console.log("Nothing was changed. Re-run with --apply to write.");
      return;
    }

    if (matched === 0) {
      console.log("Nothing matches this mode. No writes were made.");
      return;
    }

    const res = await collection.updateMany(plan.filter, plan.update);
    console.log(`APPLIED: matched ${matched}, modified ${res.modifiedCount}.`);
    console.log("Re-run without --apply to see the resulting per-organization counts.");
  } finally {
    await mongoose.connection.close();
  }
}

main().catch((e) => {
  console.error("");
  console.error(`REFUSING TO RUN: ${e.message}`);
  process.exitCode = 1;
});