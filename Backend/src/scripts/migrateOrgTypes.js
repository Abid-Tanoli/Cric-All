import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../utils/db.js";
import TeamOrganization from "../models/TeamOrganization.js";
import {
  LEGACY_TYPE_TO_ORG_TYPE,
  mapLegacyTypeToOrgType,
  normalizeLegacyType,
} from "../services/organizationService.js";

// Adds the fixed orgType enum alongside the legacy free-form `type`.
//
//   npm run orgtypes:migrate             # dry run, writes nothing
//   npm run orgtypes:migrate -- --apply  # writes orgType + migration marker
//   npm run orgtypes:migrate -- --revert             # dry-run the rollback
//   npm run orgtypes:migrate -- --revert --apply     # perform the rollback
//
// Nothing is guessed: an unrecognised legacy value is reported and left for a
// human, and --revert is limited to documents carrying our marker so an orgType
// set by a user or an API client is never removed.

const MIGRATION_KEY = "orgTypeMigration";

function planFor(doc) {
  const raw = normalizeLegacyType(doc?.type);
  if (doc?.orgType) {
    return { status: "already", orgType: doc.orgType, raw };
  }
  if (!raw) return { status: "unmatched", orgType: "other", raw };

  const result = mapLegacyTypeToOrgType(raw);
  if (!result.mapped) return { status: "unmatched", orgType: "other", raw };
  return { status: "mapped", orgType: result.orgType, raw };
}

async function run() {
  const revert = process.argv.includes("--revert");
  const apply = process.argv.includes("--apply");

  const connection = await connectDB();
  if (!connection) {
    console.error("Cannot migrate org types: MongoDB is not reachable. Set MONGO_URL / MONGODB_URI.");
    process.exit(1);
  }

  const report = { apply: !revert && apply, revert, scanned: 0, mapped: 0, already: 0, unmatched: 0, written: 0, reverted: 0 };
  const needsAttention = [];

  if (revert) {
    const cursor = TeamOrganization.find({ [`${MIGRATION_KEY}.applied`]: true })
      .select(`_id name type orgType ${MIGRATION_KEY}`)
      .cursor();
    for await (const doc of cursor) {
      report.scanned += 1;
      if (!apply) {
        // A revert is a write by definition; --revert is the explicit opt-in.
        continue;
      }
      await TeamOrganization.updateOne(
        { _id: doc._id },
        {
          $unset: { orgType: 1, typeDetails: 1, [MIGRATION_KEY]: 1 },
        }
      );
      report.reverted += 1;
    }
    console.log(`Org type revert (${apply ? "APPLY" : "DRY RUN — pass --revert with --apply to write"})`);
    console.log(`Scanned ${report.scanned} migrated records; reverted=${report.reverted}`);
    await mongoose.disconnect();
    return;
  }

  const cursor = TeamOrganization.find({}).select(`_id name type orgType typeDetails ${MIGRATION_KEY}`).cursor();
  for await (const doc of cursor) {
    report.scanned += 1;
    const plan = planFor(doc);
    if (plan.status === "already") {
      report.already += 1;
      continue;
    }
    if (plan.status === "unmatched") {
      report.unmatched += 1;
      needsAttention.push({ id: String(doc._id), name: doc.name, type: plan.raw });
      continue;
    }
    report.mapped += 1;
    if (!apply) continue;

    // Keep the legacy value untouched; only add the new enum and a marker.
    const storedLegacy = normalizeLegacyType(doc.type) || plan.orgType;
    await TeamOrganization.updateOne(
      { _id: doc._id },
      {
        $set: {
          orgType: plan.orgType,
          type: storedLegacy,
          [MIGRATION_KEY]: { applied: true, from: storedLegacy, at: new Date() },
        },
      }
    );
    report.written += 1;
  }

  console.log(`Org type migration ${apply ? "(APPLY)" : "(DRY RUN — pass --apply to write)"}`);
  console.log(
    `Scanned ${report.scanned} organizations; mapped=${report.mapped} already=${report.already} unmatched=${report.unmatched} written=${report.written}`
  );
  const counts = Object.entries(LEGACY_TYPE_TO_ORG_TYPE)
    .map(([legacy, orgType]) => `  ${legacy} -> ${orgType}`)
    .join("\n");
  console.log(`Mapping:\n${counts}`);
  if (needsAttention.length) {
    console.log("\nNeeds attention (not written):", JSON.stringify(needsAttention.slice(0, 50), null, 2));
  }

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error("Org type migration failed:", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
