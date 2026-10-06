import mongoose from "mongoose";
import Team from "../models/Team.js";
import TeamOrganization from "../models/TeamOrganization.js";
import { getMongoTarget } from "../utils/mongoTarget.js";

// Round 5 (Phase 4) — prepare the database for per-organization team-name
// uniqueness.
//
// The change replaces one global unique index on `Team.name` with two partial
// unique indexes (see models/Team.js): (organizationRef, name) for org-owned
// teams, and a global name index for org-less platform teams.
//
// This script REPORTS. It never renames, merges or deletes a team, because a
// duplicate name is a business decision — two branches of one organization may
// legitimately be called the same thing, and only an operator knows whether to
// merge them or rename one. What it does with --apply is limited to dropping the
// obsolete global index and building the two replacements.
//
// Usage:
//   node src/scripts/migrateTeamNameUniqueness.js --uri <mongodb-uri>           # dry run (default)
//   node src/scripts/migrateTeamNameUniqueness.js --uri <mongodb-uri> --apply   # drop old index, create new ones
//
// Containerized deployments (the database hostname is a Docker service name
// such as `mongodb`, not loopback) must name it deliberately:
//
//   node src/scripts/migrateTeamNameUniqueness.js \
//     --uri "$MONGO_URL" --allow-host mongodb --allow-database cric-all --apply
//
// The URI is passed explicitly on the command line. This script deliberately does
// NOT load .env: it is run by hand against one known local database, and reading
// the application's environment file to discover a connection string would both
// widen the blast radius (every configured environment, not the local one) and
// risk printing a credential into a terminal or a CI log.
//
// Two guards, both of which must pass:
//   1. the host must be local (127.0.0.1 / localhost / ::1), or be named
//      explicitly with --allow-host=<name>;
//   2. the database must be cric-all-e2e, unless --allow-database=<name> is
//      passed deliberately. Any *local* database is still not automatically the
//      right one, and the previous "any localhost will do" guard was too loose.
//
// autoIndex is disabled before connecting so that Mongoose cannot build the new
// indexes in the background *while* this script is inspecting the old ones: the
// index swap has to be the only thing creating or dropping indexes, or the run
// races itself and reports a state that never existed.

mongoose.set("autoIndex", false);

const TARGET_INDEX = "name_1";
const ORG_INDEX = "organizationRef_1_name_1_unique";
const ORGLESS_INDEX = "name_1_orgless_unique";
const EXPECTED_DATABASE = "cric-all-e2e";

// The partial filter the (organizationRef, name) index uses. organizationRef is
// declared `Schema.Types.ObjectId`, so the saved value is a BSON ObjectId.
const ORG_PARTIAL_FILTER = { organizationRef: { $type: "objectId" } };

// Case- and accent-insensitive comparison, matching the index collation
// (locale "en", strength 2): "Strikers" and "strikers" are one name.
function foldKey(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function argValue(flag) {
  const withEquals = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (withEquals) return withEquals.slice(flag.length + 1);
  const index = process.argv.indexOf(flag);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  return undefined;
}

async function main() {
  const url = argValue("--uri") || process.env.MIGRATION_MONGO_URL;
  if (!url) {
    throw new Error(
      "No connection string. Pass --uri <mongodb-uri> explicitly (this script does not read .env), " +
        "or set MIGRATION_MONGO_URL.",
    );
  }

  const { host, databaseName } = getMongoTarget(url);
  const hostname = host.replace(/^.*@/, "").split(":")[0].replace(/^\[|\]$/g, "");
  const allowedHostname = argValue("--allow-host");
  if (!["127.0.0.1", "localhost", "::1", allowedHostname].includes(hostname)) {
    throw new Error(
      `Refusing to inspect or modify a non-local MongoDB target: "${hostname}". ` +
        "Loopback only by default. Pass --allow-host=<name> if you really mean " +
        "another host, e.g. a Docker service name on an internal network.",
    );
  }

  const allowedDatabase = argValue("--allow-database") || EXPECTED_DATABASE;
  if (databaseName !== allowedDatabase) {
    throw new Error(
      `Refusing to run against database "${databaseName}". Expected "${allowedDatabase}". ` +
        "Re-run with the local test database, or pass --allow-database=<name> if you really mean another local one.",
    );
  }

  const apply = process.argv.includes("--apply");
  await mongoose.connect(url, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });

  try {
    console.log(`Target: local MongoDB database ${databaseName || "(unnamed)"}`);
    console.log(`Mode: ${apply ? "APPLY" : "DRY RUN (no changes will be made)"}`);
    console.log("");

    const teams = await Team.find({}, { name: 1, organizationRef: 1, organization: 1 }).lean();
    const orgs = await TeamOrganization.find({}, { _id: 1, name: 1 }).lean();
    const orgNameById = new Map(orgs.map((o) => [String(o._id), o.name]));

    const orgOwned = teams.filter((t) => t.organizationRef);
    const orgLess = teams.filter((t) => !t.organizationRef);
    console.log(`Teams total:            ${teams.length}`);
    console.log(`  organization-owned:   ${orgOwned.length}`);
    console.log(`  org-less (platform):  ${orgLess.length}`);
    console.log("");

    // --- duplicate report, per organization --------------------------------
    const byOrg = new Map();
    for (const team of orgOwned) {
      const key = String(team.organizationRef);
      if (!byOrg.has(key)) byOrg.set(key, []);
      byOrg.get(key).push(team);
    }

    let duplicateGroups = 0;
    let duplicateTeams = 0;
    console.log("Duplicate names WITHIN an organization (these block the new index):");
    for (const [orgId, group] of byOrg) {
      const buckets = new Map();
      for (const team of group) {
        const folded = foldKey(team.name);
        if (!buckets.has(folded)) buckets.set(folded, []);
        buckets.get(folded).push(team);
      }
      for (const [folded, members] of buckets) {
        if (members.length < 2) continue;
        duplicateGroups += 1;
        duplicateTeams += members.length;
        console.log(`  org ${orgNameById.get(orgId) || orgId} (${orgId})`);
        for (const member of members) {
          console.log(`      ${member.name}  _id=${member._id}`);
        }
      }
    }
    if (duplicateGroups === 0) console.log("  none");
    console.log("");

    // --- org-less duplicates ----------------------------------------------
    const orgLessBuckets = new Map();
    for (const team of orgLess) {
      const folded = foldKey(team.name);
      if (!orgLessBuckets.has(folded)) orgLessBuckets.set(folded, []);
      orgLessBuckets.get(folded).push(team);
    }
    const orgLessDuplicates = [...orgLessBuckets.entries()].filter(([, m]) => m.length > 1);
    console.log("Duplicate names among ORG-LESS teams (these block the global index):");
    if (orgLessDuplicates.length === 0) {
      console.log("  none");
    } else {
      for (const [folded, members] of orgLessDuplicates) {
        console.log(`  "${folded}"`);
        for (const member of members) {
          console.log(`      ${member.name}  _id=${member._id}`);
        }
      }
    }
    console.log("");

    // --- storage-type caveat ----------------------------------------------
    // The (organizationRef, name) index filters on
    // `{ organizationRef: { $type: "objectId" } }`, which is what Mongoose
    // actually stores for this ref. A legacy row that holds the reference as a
    // *string* would fall outside the index and rely on the application-level
    // check in teamService alone, so those rows are counted and named here. Note
    // that Mongoose casts a string ObjectId to a real ObjectId on save, so a
    // non-zero count means the data predates that casting or was written
    // outside the model.
    const objectIdOrg = orgOwned.filter(
      (t) => t.organizationRef?._bsontype === "ObjectId" || t.organizationRef instanceof mongoose.Types.ObjectId,
    ).length;
    const otherOrg = orgOwned.length - objectIdOrg;
    console.log("organizationRef storage types among org-owned teams:");
    console.log(`  BSON ObjectId (covered by the new partial index): ${objectIdOrg}`);
    console.log(`  any other type (application check only):           ${otherOrg}`);
    if (otherOrg > 0) {
      for (const team of orgOwned) {
        const isObjectId =
          team.organizationRef?._bsontype === "ObjectId" ||
          team.organizationRef instanceof mongoose.Types.ObjectId;
        if (!isObjectId) {
          console.log(`      needs review: ${team.name}  _id=${team._id}`);
        }
      }
    }
    console.log("");

    // --- index state -------------------------------------------------------
    const existing = await Team.collection.indexes();
    const names = existing.map((i) => i.name);
    const hasTarget = names.includes(TARGET_INDEX);
    const hasOrg = names.includes(ORG_INDEX);
    const hasOrgless = names.includes(ORGLESS_INDEX);
    console.log("Index state:");
    console.log(`  ${TARGET_INDEX} (old global unique on name): ${hasTarget ? "present" : "absent"}`);
    console.log(`  ${ORG_INDEX}: ${hasOrg ? "present" : "absent"}`);
    console.log(`  ${ORGLESS_INDEX}: ${hasOrgless ? "present" : "absent"}`);
    console.log("");

    const blockers = duplicateGroups > 0 || orgLessDuplicates.length > 0;

    if (!apply) {
      console.log("Dry run complete. Nothing was changed.");
      if (blockers) {
        console.log("");
        console.log("ACTION NEEDED: resolve the duplicates listed above before applying.");
        console.log("This script will refuse to build the new indexes while duplicates remain,");
        console.log("because a unique index cannot be created over duplicate keys.");
        console.log("It will not rename or merge teams for you.");
      } else {
        console.log("");
        console.log("No duplicates found. Re-run with --apply to swap the indexes.");
      }
      return;
    }

    if (blockers) {
      console.log("REFUSING to apply: duplicates exist (see above).");
      console.log("Resolve them manually — this script never renames, merges or deletes a team.");
      process.exitCode = 2;
      return;
    }

    if (hasTarget) {
      await Team.collection.dropIndex(TARGET_INDEX);
      console.log(`Dropped old global unique index ${TARGET_INDEX}.`);
    }
    if (!hasOrg) await Team.collection.createIndex(
      { organizationRef: 1, name: 1 },
      {
        unique: true,
        collation: { locale: "en", strength: 2 },
        partialFilterExpression: ORG_PARTIAL_FILTER,
        name: ORG_INDEX,
      },
    );
    if (!hasOrgless) await Team.collection.createIndex(
      { name: 1 },
      {
        unique: true,
        collation: { locale: "en", strength: 2 },
        partialFilterExpression: { organizationRef: null },
        name: ORGLESS_INDEX,
      },
    );
    console.log("Applied: per-organization team-name uniqueness is now in place.");
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
