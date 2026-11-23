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
// Email-verification migration for existing User accounts.
//
//   node src/scripts/migrateUserEmailVerification.js            # dry-run (default)
//   node src/scripts/migrateUserEmailVerification.js --apply    # write
//   node src/scripts/migrateUserEmailVerification.js --apply --require-verification
//
// Policy: the OLD gate accepted emailVerified OR phoneVerified. With the gate
// now email-only, --apply grandfathers accounts that were verified under the
// old rule (including phone-verified ones) so nobody silently loses access.
// Accounts that were never verified stay unverified and must verify by email.
// --require-verification leaves every unverified account unverified instead.
// Nothing is written in dry-run; duplicates are only ever reported.
// ---------------------------------------------------------------------------

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

/** Pure planning step: describes writes without performing any. */
export function planMigration(users, { grandfather = true } = {}) {
  const byEmail = new Map();
  for (const user of users) {
    const key = normalizeEmail(user.email);
    if (!byEmail.has(key)) byEmail.set(key, []);
    byEmail.get(key).push(String(user._id));
  }
  const duplicates = [...byEmail.entries()].filter(([, ids]) => ids.length > 1);

  const plan = {
    total: users.length,
    alreadyVerified: 0,
    legacyPhoneVerified: 0,
    toVerify: 0,
    toLeaveUnverified: 0,
    duplicates,
    writes: [],
  };

  for (const user of users) {
    if (user.emailVerified === true) {
      plan.alreadyVerified++;
    } else if (grandfather && user.phoneVerified === true) {
      plan.legacyPhoneVerified++;
      plan.toVerify++;
    } else if (grandfather) {
      plan.toVerify++;
    } else {
      plan.toLeaveUnverified++;
    }

    const set = {};
    const unset = {};
    const now = new Date();

    if (grandfather && user.emailVerified !== true) {
      set.emailVerified = true;
      set.emailVerifiedAt = user.emailVerifiedAt || now;
    }
    if (typeof user.passwordSet !== "boolean") set.passwordSet = Boolean(user.password);
    if (!["active", "suspended"].includes(user.status)) set.status = "active";
    if (typeof user.tokenVersion !== "number") set.tokenVersion = 0;

    if (user.emailVerified === true || (grandfather && user.emailVerified !== true)) {
      unset.emailVerificationToken = "";
      unset.emailVerificationExpires = "";
      unset.emailVerificationCode = "";
      unset.emailVerificationAttempts = "";
    }

    if (Object.keys(set).length || Object.keys(unset).length) {
      plan.writes.push({ id: user._id, set, unset });
    }
  }
  return plan;
}

/** Apply a planned migration through an injected repository (model in prod). */
export async function applyPlan(plan, { UserModel = User } = {}) {
  let updated = 0;
  for (const { id, set, unset } of plan.writes) {
    // eslint-disable-next-line no-await-in-loop
    await UserModel.updateOne(
      { _id: id },
      { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    );
    updated++;
  }
  return updated;
}

function report(plan, { apply, grandfather, admins, orphanEmails, adminEmails }) {
  console.log(`Mode: ${apply ? "APPLY" : "dry-run"}${grandfather ? "" : " (--require-verification)"}`);
  console.log("");
  console.log(`Users: ${plan.total}`);
  console.log(`  Admins (separate collection): ${admins}`);
  console.log(`  Already emailVerified=true:   ${plan.alreadyVerified}`);
  console.log(`  Legacy phone-verified (grandfathered): ${plan.legacyPhoneVerified}`);
  console.log(`  ${grandfather ? "Would grandfather as verified" : "Would remain unverified"}: ${grandfather ? plan.toVerify : plan.toLeaveUnverified}`);
  console.log(`  Planned document writes: ${plan.writes.length}`);
  console.log("");
  console.log(`Duplicate normalized emails within User: ${plan.duplicates.length}`);
  for (const [email, ids] of plan.duplicates.slice(0, 20)) {
    console.log(`  ! ${email} → ${ids.join(", ")}`);
  }
  console.log(`Emails present in BOTH User and Admin: ${orphanEmails.length}`);
  for (const email of orphanEmails.slice(0, 20)) console.log(`  - ${email}`);
}

export async function main() {
  const url = process.env.MONGO_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!url) throw new Error("MONGO_URL / MONGODB_URI / MONGO_URI is required.");

  const apply = process.argv.includes("--apply");
  const grandfather = !process.argv.includes("--require-verification");

  const target = getMongoTarget(url);
  await mongoose.connect(url, {
    serverSelectionTimeoutMS: 60000,
    connectTimeoutMS: 60000,
    socketTimeoutMS: 120000,
  });

  try {
    const users = await User.find({}).select("+password").lean();
    const admins = await Admin.find({}).lean();
    const plan = planMigration(users, { grandfather });

    const adminEmails = new Set(admins.map((a) => normalizeEmail(a.email)));
    const allEmails = new Map();
    for (const user of users) {
      const key = normalizeEmail(user.email);
      allEmails.set(key, (allEmails.get(key) || 0) + 1);
    }
    const overlaps = [...allEmails.keys()].filter((e) => e && adminEmails.has(e));

    console.log(`Mongo host: ${target.host || "unknown"} (db: ${target.databaseName || "?"})`);
    report(plan, { apply, grandfather, admins: admins.length, orphanEmails: overlaps, adminEmails });

    if (plan.duplicates.length > 0) {
      console.error("\nDUPLICATES FOUND — resolve them manually first. This script will not delete or merge accounts.");
      process.exitCode = 1;
      return;
    }
    if (!apply) {
      console.log("\nDry-run: nothing written. Re-run with --apply to persist.");
      return;
    }

    const updated = await applyPlan(plan, { UserModel: User });
    console.log(`\nUsers updated: ${updated}`);
    console.log("Done.");
  } finally {
    await mongoose.disconnect();
  }
}

// Only run when invoked directly, so tests can import the pure planning/apply
// functions without opening a Mongo connection.
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  });
}
