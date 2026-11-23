import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeEmail,
  planMigration,
  applyPlan,
} from "../src/scripts/migrateUserEmailVerification.js";

const user = (overrides = {}) => ({
  _id: `id-${Math.random().toString(16).slice(2)}`,
  email: `${Math.random().toString(16).slice(2)}@example.com`,
  emailVerified: false,
  phoneVerified: false,
  password: "hash",
  status: "active",
  tokenVersion: 0,
  passwordSet: true,
  ...overrides,
});

test("normalizeEmail is case/space insensitive", () => {
  assert.equal(normalizeEmail("  User@Example.COM "), "user@example.com");
  assert.equal(normalizeEmail(undefined), "");
});

test("dry-run planning produces writes but never applies them", () => {
  const users = [user(), user({ emailVerified: true, emailVerificationCode: "stale" })];
  const plan = planMigration(users);
  assert.equal(plan.total, 2);
  assert.equal(plan.alreadyVerified, 1);
  assert.equal(plan.toVerify, 1);
  assert.ok(plan.writes.some((w) => String(w.id) === String(users[0]._id)));
  // The inputs are untouched — reporting is side-effect free.
  assert.equal(users[0].emailVerified, false);
  assert.equal(users[0].emailVerificationCode, undefined);
});

test("grandfather policy marks legacy and never-verified users as verified", () => {
  const legacyPhone = user({ phoneVerified: true, phoneVerifiedAt: new Date() });
  const neverVerified = user();
  const plan = planMigration([legacyPhone, neverVerified], { grandfather: true });
  assert.equal(plan.legacyPhoneVerified, 1);
  assert.equal(plan.toVerify, 2);
  const phoneWrite = plan.writes.find((w) => String(w.id) === String(legacyPhone._id));
  assert.equal(phoneWrite.set.emailVerified, true);
  assert.ok(phoneWrite.set.emailVerifiedAt);
  assert.ok(phoneWrite.unset.emailVerificationCode === "");
});

test("--require-verification leaves every unverified user unverified", () => {
  const legacyPhone = user({ phoneVerified: true });
  const plan = planMigration([legacyPhone, user({ emailVerified: true })], { grandfather: false });
  assert.equal(plan.toVerify, 0);
  assert.equal(plan.toLeaveUnverified, 1);
  assert.ok(!plan.writes.some((w) => String(w.id) === String(legacyPhone._id) && w.set.emailVerified));
});

test("duplicates are reported and never merged or deleted", () => {
  const a = user({ email: "Duplicate@Example.com" });
  const b = user({ email: "duplicate@example.COM" });
  const plan = planMigration([a, b]);
  assert.equal(plan.duplicates.length, 1);
  assert.deepEqual(plan.duplicates[0][0], "duplicate@example.com");
  assert.equal(plan.writes.length, 2, "both rows are reported as planned writes, not combined");
});

test("applyPlan writes exactly the planned fields through the injected model", async () => {
  const calls = [];
  const UserModel = {
    async updateOne(filter, update) {
      calls.push({ filter, update });
    },
  };
  const target = user({ emailVerified: false, emailVerificationCode: "stale" });
  const plan = planMigration([target]);
  const updated = await applyPlan(plan, { UserModel });
  assert.equal(updated, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].filter, { _id: target._id });
  assert.equal(calls[0].update.$set.emailVerified, true);
  assert.equal(calls[0].update.$unset.emailVerificationCode, "");
});
