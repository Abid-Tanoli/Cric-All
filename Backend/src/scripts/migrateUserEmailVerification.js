import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { getMongoTarget } from "../utils/mongoTarget.js";
import User from "../models/User.js";
import Admin from "../models/Admin.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// ---------------------------------------------------------------------------
// Phase 1 migration: email-verification identity fields on User.
//
//   node src/scripts/migrateUserEmailVerification.js            # dry-run
//   node src/scripts/migrateUserEmailVerification.js --apply    # write
//   node src/scripts/migrateUserEmailVerification.js --apply --require-verification
//
// Default (--apply) GRANDFATHERS every existing account as verified: they were
// created before verification existed and the owner may not have SMTP
// configured yet, so refusing them would lock everyone out. New registrations
// are always unverified.
//
// --require-verification keeps existing accounts unverified instead, so every
// legacy account must verify before it can perform privileged actions.
//
// Duplicates are only ever REPORTED. This script never deletes a user.
// ---------------------------------------------------------------------------

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

async function main() {
  const url = process.env.MONGO_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!url) {
    throw new Error("MONGO_URL / MONGODB_URI / MONGO_URI is required.");
  }

  const apply = process.argv.includes("--apply");
  const grandfather = !process.argv.includes("--require-verification");

  const target = getMongoTarget(url);
  await mongoose.connect(url, {
    serverSelectionTimeoutMS: 60000,
    connectTimeoutMS: 60000,
    socketTimeoutMS: 120000,
  });

  const users = await User.find({}).select("+password").lean();
  const admins = await Admin.find({}).lean();

  // 1. Duplicate detection (normalized, case-insensitive).
  const byEmail = new Map();
  for (const user of users) {
    const key = normalizeEmail(user.email);
    if (!byEmail.has(key)) byEmail.set(key, []);
    byEmail.get(key).push(String(user._id));
  }
  const duplicates = [...byEmail.entries()].filter(([, ids]) => ids.length > 1);

  // 2. Email overlaps between User and Admin collections (informational:
  //    they are separate login surfaces, but operators should know).
  const adminEmails = new Set(admins.map((a) => normalizeEmail(a.email)));
  const overlaps = [...byEmail.keys()].filter((e) => adminEmails.has(e));

  // 3. Counts for the verification fields.
  let alreadyVerified = 0;
  let toVerify = 0;
  let toLeaveUnverified = 0;
  let missingStatus = 0;
  let missingPasswordSet = 0;
  let hasPassword = 0;
  let hasGoogle = 0;
  const invalidEmails = [];

  for (const user of users) {
    const normalized = normalizeEmail(user.email);
    if (!normalized) invalidEmails.push(String(user._id));

    if (user.password) hasPassword++;
    if (user.googleId) hasGoogle++;

    if (user.emailVerified === true) {
      alreadyVerified++;
    } else if (grandfather) {
      toVerify++;
    } else {
      toLeaveUnverified++;
    }

    if (!["active", "suspended"].includes(user.status)) missingStatus++;
    if (typeof user.passwordSet !== "boolean") missingPasswordSet++;
  }

  console.log(`Mongo host: ${target.host || "unknown"} (db: ${target.databaseName || "?"})`);
  console.log(`Mode: ${apply ? "APPLY" : "dry-run"}${grandfather ? "" : " (--require-verification)"}`);
  console.log("");
  console.log(`Users: ${users.length}`);
  console.log(`  Admins (separate collection): ${admins.length}`);
  console.log(`  Already emailVerified=true:   ${alreadyVerified}`);
  console.log(`  ${grandfather ? "Would grandfather as verified" : "Would remain unverified"}: ${grandfather ? toVerify : toLeaveUnverified}`);
  console.log(`  With a password: ${hasPassword}   With googleId: ${hasGoogle}`);
  console.log(`  Missing/invalid status: ${missingStatus}   Missing passwordSet: ${missingPasswordSet}`);
  console.log("");
  console.log(`Duplicate normalized emails within User: ${duplicates.length}`);
  for (const [email, ids] of duplicates.slice(0, 20)) {
    console.log(`  ! ${email} → ${ids.join(", ")}`);
  }
  console.log(`Emails present in BOTH User and Admin: ${overlaps.length}`);
  for (const email of overlaps.slice(0, 20)) {
    console.log(`  - ${email}`);
  }
  if (invalidEmails.length) {
    console.log(`Users with an empty email: ${invalidEmails.join(", ")}`);
  }

  if (duplicates.length > 0) {
    console.error(
      "\nDUPLICATES FOUND — resolve them manually first. This script will not delete or merge accounts.",
    );
    process.exitCode = 1;
    return;
  }

  if (!apply) {
    console.log("\nDry-run: nothing written. Re-run with --apply to persist.");
    return;
  }

  const now = new Date();
  let updated = 0;

  for (const user of users) {
    const set = {};
    const unset = {};

    if (grandfather && user.emailVerified !== true) {
      set.emailVerified = true;
      set.emailVerifiedAt = user.emailVerifiedAt || now;
    }
    if (typeof user.passwordSet !== "boolean") {
      set.passwordSet = Boolean(user.password);
    }
    if (!["active", "suspended"].includes(user.status)) {
      set.status = "active";
    }
    if (typeof user.tokenVersion !== "number") {
      set.tokenVersion = 0;
    }
    if (user.emailVerified === true) {
      unset.emailVerificationToken = "";
      unset.emailVerificationExpires = "";
    }

    if (Object.keys(set).length === 0 && Object.keys(unset).length === 0) continue;

    // eslint-disable-next-line no-await-in-loop
    await User.updateOne({ _id: user._id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    updated++;
  }

  console.log(`\nUsers updated: ${updated}`);
  console.log("Done.");
}

main()
  .catch((error) => {
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
