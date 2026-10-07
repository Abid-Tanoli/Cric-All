import mongoose from "mongoose";
import { getMongoTarget } from "../utils/mongoTarget.js";
import { normalizePhone } from "../utils/phone.js";
import User from "../models/User.js";

// Phone-signup identity migration.
//
// The phone signup feature (Task 2) changes two things about the `users`
// collection that existing databases were NOT created with:
//
//   1. `email` becomes an OPTIONAL identifier, so its unique index must be
//      rebuilt as unique+sparse — a plain unique index collides on two
//      documents that both omit the field (i.e. two phone-only accounts).
//      (The server also performs this swap automatically at boot, see
//      src/utils/identityIndexes.js; this script exists so an operator can
//      see and apply it deliberately.)
//
//   2. `phone` gains a partial unique index over its normalized form
//      (digits-only + country code, see src/utils/phone.js). Legacy rows hold
//      whatever the signup form was typed as ("0300-1234567"), so this script
//      normalizes them first — otherwise the same number in two formats would
//      slip past the unique index.
//
// Usage:
//   node src/scripts/migrateUserPhoneIdentity.js --uri <mongodb-uri>            # dry run (default)
//   node src/scripts/migrateUserPhoneIdentity.js --uri <mongodb-uri> --apply    # normalize + swap indexes
//
// Containerized deployments (the database hostname is a Docker service name
// such as `mongodb`, not loopback) must name it deliberately:
//
//   node src/scripts/migrateUserPhoneIdentity.js \
//     --uri "$MONGO_URL" --allow-host mongodb --allow-database cric-all --apply
//
// The URI is passed explicitly on the command line. This script deliberately
// does NOT load .env (same rule as migrateTeamNameUniqueness.js): reading the
// application's environment file to discover a connection string would widen
// the blast radius and risk printing a credential into a terminal or CI log.
//
// It REPORTS duplicates and never deletes, merges or rewrites an account it is
// not sure about: which of two accounts sharing a phone number is the real one
// is a business decision, and only an operator can make it. With --apply it
// will:
//   - normalize legacy phone values that normalize uniquely;
//   - rebuild email_1 as unique+sparse;
//   - create the partial unique phone_1 index (refusing while duplicates
//     remain, because a unique index cannot be built over duplicate keys).

mongoose.set("autoIndex", false);

const EMAIL_INDEX = "email_1";
const PHONE_INDEX = "phone_1";
const EXPECTED_DATABASE = "cric-all";

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
        "Re-run with the local development database, or pass --allow-database=<name> if you really mean another one.",
    );
  }

  const apply = process.argv.includes("--apply");
  await mongoose.connect(url, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });

  try {
    console.log(`Target: local MongoDB database ${databaseName || "(unnamed)"}`);
    console.log(`Mode: ${apply ? "APPLY" : "DRY RUN (no changes will be made)"}`);
    console.log("");

    const users = await User.find({}, { name: 1, email: 1, phone: 1 }).lean();
    console.log(`Users total: ${users.length}`);

    // --- phone inventory ---------------------------------------------------
    let withPhone = 0;
    let needsNormalization = 0;
    const byNormalized = new Map();
    for (const user of users) {
      const raw = typeof user.phone === "string" ? user.phone.trim() : "";
      if (!raw) continue;
      withPhone += 1;

      const normalized = normalizePhone(raw);
      if (!normalized) {
        console.log(`  unparseable phone on user ${user._id} (${user.name}): "${raw}"`);
        continue;
      }
      if (normalized !== raw) needsNormalization += 1;
      if (!byNormalized.has(normalized)) byNormalized.set(normalized, []);
      byNormalized.get(normalized).push({ id: String(user._id), name: user.name, raw });
    }
    const duplicateGroups = [...byNormalized.entries()].filter(([, rows]) => rows.length > 1);
    console.log(`  with a phone value:        ${withPhone}`);
    console.log(`  needing normalization:     ${needsNormalization}`);
    console.log(`  duplicate normalized nums: ${duplicateGroups.length}`);
    for (const [normalized, rows] of duplicateGroups) {
      console.log(`    ${normalized}`);
      for (const row of rows) console.log(`      ${row.name}  _id=${row.id}  raw="${row.raw}"`);
    }

    // --- email inventory ---------------------------------------------------
    const missingEmail = users.filter((u) => !u.email).length;
    console.log(`  accounts without an email: ${missingEmail} (these need the sparse email index)`);
    console.log("");

    // --- index state -------------------------------------------------------
    const indexes = await User.collection.indexes();
    const byName = new Map(indexes.map((i) => [i.name, i]));
    const emailIndex = byName.get(EMAIL_INDEX);
    const phoneIndex = byName.get(PHONE_INDEX);
    const emailIsSparse = Boolean(emailIndex && emailIndex.sparse && emailIndex.unique);
    console.log("Index state:");
    console.log(`  ${EMAIL_INDEX} (unique on email):     ${emailIndex ? "present" : "absent"}${emailIndex ? (emailIsSparse ? " (sparse, OK)" : " (NOT sparse — blocks phone-only signups)") : ""}`);
    console.log(`  ${PHONE_INDEX} (unique on phone):     ${phoneIndex ? "present (OK)" : "absent"}`);
    console.log("");

    const blockers = duplicateGroups.length > 0;

    if (!apply) {
      console.log("Dry run complete. Nothing was changed.");
      if (blockers) {
        console.log("");
        console.log("ACTION NEEDED: resolve the duplicate phone numbers above before applying.");
        console.log("A unique index cannot be built over duplicate keys, and this script");
        console.log("never decides which of two accounts is the real one.");
      } else {
        console.log("");
        console.log("No blockers found. Re-run with --apply to normalize phones and swap the indexes.");
        console.log("(The server also rebuilds the email index automatically at boot.)");
      }
      return;
    }

    // --- apply: normalize phones -----------------------------------------
    let normalizedCount = 0;
    for (const user of users) {
      const raw = typeof user.phone === "string" ? user.phone.trim() : "";
      if (!raw) continue;
      const normalized = normalizePhone(raw);
      if (!normalized || normalized === raw) continue;
      const owner = byNormalized.get(normalized) || [];
      if (owner.length > 1) continue; // duplicate — reported above, never auto-merged
      await User.updateOne({ _id: user._id }, { $set: { phone: normalized } });
      normalizedCount += 1;
    }
    console.log(`Normalized ${normalizedCount} phone value(s) to digits-only + country code.`);

    // --- apply: email index ------------------------------------------------
    if (emailIndex && !emailIsSparse) {
      await User.collection.dropIndex(EMAIL_INDEX);
      await User.collection.createIndex({ email: 1 }, { unique: true, sparse: true, name: EMAIL_INDEX });
      console.log(`Rebuilt ${EMAIL_INDEX} as unique+sparse.`);
    } else if (!emailIndex) {
      await User.collection.createIndex({ email: 1 }, { unique: true, sparse: true, name: EMAIL_INDEX });
      console.log(`Created ${EMAIL_INDEX} (unique+sparse).`);
    } else {
      console.log(`${EMAIL_INDEX} already correct.`);
    }

    // --- apply: phone index ------------------------------------------------
    if (blockers) {
      console.log("REFUSING to create the phone uniqueness index: duplicates exist (see above).");
      console.log("Resolve them manually — this script never deletes a user.");
      process.exitCode = 2;
      return;
    }
    if (phoneIndex) {
      await User.collection.dropIndex(PHONE_INDEX);
    }
    await User.collection.createIndex(
      { phone: 1 },
      {
        unique: true,
        partialFilterExpression: { phone: { $type: "string", $gt: "" } },
        name: PHONE_INDEX,
      },
    );
    console.log(`Created ${PHONE_INDEX} (partial unique on normalized phone).`);
    console.log("");
    console.log("Applied.");
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
