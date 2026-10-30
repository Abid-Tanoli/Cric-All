import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";
process.env.FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

import mongoose from "mongoose";
import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import User from "../src/models/User.js";
import TeamOrganization from "../src/models/TeamOrganization.js";
import Membership from "../src/models/Membership.js";
import AuditLog from "../src/models/AuditLog.js";
import { changePassword, loginUser } from "../src/controllers/authController.js";
import { handoverOrganization } from "../src/controllers/orgHandoverController.js";
import { listOrganizations } from "../src/controllers/organizationController.js";

let mongod;
let orgCounter = 0;
let userCounter = 0;

before(async () => {
  mongod = await startTestDb();
});

after(async () => {
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    TeamOrganization.deleteMany({}),
    Membership.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);
});

function platformAdminReq(orgId, body) {
  return mockReq({
    user: { _id: new mongoose.Types.ObjectId(), role: "admin", username: "platform-admin" },
    principalType: "admin",
    params: { id: String(orgId) },
    body,
    ip: "127.0.0.1",
  });
}

async function makeOrg({ owner = null, name = "Handover Test Org" } = {}) {
  orgCounter += 1;
  return TeamOrganization.create({
    name,
    slug: `handover-test-org-${orgCounter}-${Math.random().toString(36).slice(2, 6)}`,
    owner,
  });
}

async function makeUser(overrides = {}) {
  userCounter += 1;
  const user = await User.create({
    name: `Handover Person ${userCounter}`,
    email: `handover-${userCounter}-${Math.random().toString(36).slice(2, 8)}@openctest.dev`,
    password: "existing-pass-123",
    role: "scorer",
    accountType: "organization_admin",
    emailVerified: true,
    ...overrides,
  });
  return user;
}

async function login(identifier, password) {
  const res = mockRes();
  await loginUser(mockReq({ body: { identifier, password } }), res);
  return res;
}

async function handover(org, body) {
  const res = mockRes();
  await handoverOrganization(platformAdminReq(org._id, body), res);
  return res;
}

// ---------------------------------------------------------------------------
// Handover
// ---------------------------------------------------------------------------
test("handover creates a verified owner account, assigns ownership, and logs the audit trail", async () => {
  const org = await makeOrg();

  const res = await handover(org, {
    name: "New Owner",
    email: "new-owner@openctest.dev",
    phone: "0300 1234567",
  });

  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.accountCreated, true);
  assert.ok(res.body.temporaryPassword, "a temporary password is issued for a new account");
  assert.strictEqual(res.body.mustChangePassword, true);
  assert.strictEqual(res.body.loginIdentifiers.email, "new-owner@openctest.dev");
  assert.strictEqual(res.body.loginIdentifiers.phone, "923001234567");

  const user = await User.findOne({ email: "new-owner@openctest.dev" }).select("+password");
  assert.ok(user, "the owner account exists");
  assert.strictEqual(user.phone, "923001234567");
  assert.strictEqual(user.accountType, "organization_admin");
  assert.strictEqual(user.role, "scorer");
  assert.strictEqual(user.emailVerified, true);
  assert.strictEqual(user.phoneVerified, true);
  assert.strictEqual(user.mustChangePassword, true);
  assert.strictEqual(user.passwordSet, true);
  assert.ok(user.password, "the temporary password is stored hashed");

  const savedOrg = await TeamOrganization.findById(org._id);
  assert.ok(savedOrg.owner.equals(user._id));

  const membership = await Membership.findOne({ organization: org._id, user: user._id });
  assert.ok(membership, "owner Membership row exists");
  assert.deepEqual(membership.roles, ["owner"]);
  assert.strictEqual(membership.status, "active");
  assert.strictEqual(membership.source, "admin");

  const audit = await AuditLog.findOne({ action: "org.handover_completed" });
  assert.ok(audit, "handover is audited");
  assert.strictEqual(audit.targetType, "user");
  assert.strictEqual(String(audit.targetId), String(user._id));
  assert.strictEqual(audit.metadata.accountCreated, true);
  assert.strictEqual(audit.metadata.identityVerifiedBy, "admin_handover");
  assert.ok(
    !JSON.stringify(audit.toObject()).includes(res.body.temporaryPassword),
    "the temporary password is never written to the audit log"
  );

  // The account works immediately with the temporary password, and the client
  // is told to send the person to the change-password screen.
  const loginRes = await login("new-owner@openctest.dev", res.body.temporaryPassword);
  assert.strictEqual(loginRes.statusCode, 200, JSON.stringify(loginRes.body));
  assert.strictEqual(loginRes.body.user.mustChangePassword, true);

  const phoneLoginRes = await login("0300 1234567", res.body.temporaryPassword);
  assert.strictEqual(phoneLoginRes.statusCode, 200, "the owner can also sign in with the phone number");
});

test("handover to an existing account keeps its password unless a reset is requested", async () => {
  const existing = await makeUser({ email: "existing-owner@openctest.dev" });
  const org = await makeOrg();

  const res = await handover(org, {
    name: "Existing Owner",
    email: "existing-owner@openctest.dev",
  });

  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.accountCreated, false);
  assert.strictEqual(res.body.temporaryPassword, null);

  const stillWorks = await login("existing-owner@openctest.dev", "existing-pass-123");
  assert.strictEqual(stillWorks.statusCode, 200, "the existing password was left untouched");
  assert.strictEqual(stillWorks.body.user.mustChangePassword, false);

  const savedOrg = await TeamOrganization.findById(org._id);
  assert.ok(savedOrg.owner.equals(existing._id));
});

test("resetExistingPassword issues a temporary password and invalidates the old one", async () => {
  const existing = await makeUser({ email: "reset-owner@openctest.dev" });
  const org = await makeOrg();

  const res = await handover(org, {
    name: "Reset Owner",
    email: "reset-owner@openctest.dev",
    resetExistingPassword: true,
  });

  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.ok(res.body.temporaryPassword, "a temporary password is issued");
  assert.strictEqual(res.body.mustChangePassword, true);

  const oldPassword = await login("reset-owner@openctest.dev", "existing-pass-123");
  assert.strictEqual(oldPassword.statusCode, 400, "the old password no longer works");

  const tempPassword = await login("reset-owner@openctest.dev", res.body.temporaryPassword);
  assert.strictEqual(tempPassword.statusCode, 200, "the temporary password works");
  assert.strictEqual(tempPassword.body.user.mustChangePassword, true);

  const saved = await User.findById(existing._id);
  assert.strictEqual(saved.mustChangePassword, true);
  assert.strictEqual(saved.tokenVersion, 1, "issuing a temporary password invalidates older sessions");
});

test("handover can create a phone-only owner who signs in without an email", async () => {
  const org = await makeOrg();

  const res = await handover(org, {
    name: "Phone Only Owner",
    phone: "+92 300 2222222",
  });

  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.accountCreated, true);
  assert.strictEqual(res.body.loginIdentifiers.email, "");
  assert.strictEqual(res.body.loginIdentifiers.phone, "923002222222");

  const user = await User.findOne({ phone: "923002222222" });
  assert.ok(user);
  assert.strictEqual(user.email || "", "");
  assert.strictEqual(user.phoneVerified, true);
  assert.strictEqual(user.emailVerified, false);
  assert.strictEqual(user.mustChangePassword, true);

  const loginRes = await login("+92 300 2222222", res.body.temporaryPassword);
  assert.strictEqual(loginRes.statusCode, 200, JSON.stringify(loginRes.body));
  assert.strictEqual(loginRes.body.user.mustChangePassword, true);
});

test("handover promotes the new owner before demoting the previous owner to admin", async () => {
  const previousOwner = await makeUser({ email: "previous-owner@openctest.dev" });
  const org = await makeOrg({ owner: previousOwner._id });
  await Membership.create({
    organization: org._id,
    user: previousOwner._id,
    roles: ["owner"],
    source: "signup",
  });

  const res = await handover(org, {
    name: "Next Owner",
    email: "next-owner@openctest.dev",
  });

  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));

  const nextOwner = await User.findOne({ email: "next-owner@openctest.dev" });
  const savedOrg = await TeamOrganization.findById(org._id);
  assert.ok(savedOrg.owner.equals(nextOwner._id), "the organization points at the new owner");

  const nextMembership = await Membership.findOne({ organization: org._id, user: nextOwner._id });
  assert.deepEqual(nextMembership.roles, ["owner"]);

  const previousMembership = await Membership.findOne({
    organization: org._id,
    user: previousOwner._id,
  });
  assert.deepEqual(previousMembership.roles, ["admin"], "the previous owner stays on as admin");

  const legacyMember = savedOrg.members.find(
    (member) => String(member.user) === String(previousOwner._id)
  );
  assert.ok(legacyMember, "the deprecated org.members[] view includes the demoted owner");
  assert.strictEqual(legacyMember.role, "admin");

  const audit = await AuditLog.findOne({ action: "org.handover_completed" });
  assert.strictEqual(audit.metadata.previousOwnerDemoted, true);
  assert.strictEqual(audit.metadata.previousOwner, String(previousOwner._id));
});

test("handover does not promote a stale non-owner org.owner pointer to admin", async () => {
  const staleOwner = await makeUser({ email: "stale-owner@openctest.dev" });
  const org = await makeOrg({ owner: staleOwner._id });
  await Membership.create({
    organization: org._id,
    user: staleOwner._id,
    roles: ["player"],
    source: "signup",
  });

  const res = await handover(org, {
    name: "Real Owner",
    email: "real-owner@openctest.dev",
  });

  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));

  const staleMembership = await Membership.findOne({
    organization: org._id,
    user: staleOwner._id,
  });
  assert.deepEqual(staleMembership.roles, ["player"], "a non-owner is left untouched");

  const audit = await AuditLog.findOne({ action: "org.handover_completed" });
  assert.strictEqual(audit.metadata.previousOwnerDemoted, false);
});

test("handover rejects identifiers that belong to two different accounts", async () => {
  const emailOwner = await makeUser({ email: "email-owner@openctest.dev", phone: "" });
  await makeUser({ email: "phone-owner@openctest.dev", phone: "923001111111" });
  const org = await makeOrg();

  const res = await handover(org, {
    name: "Split Identity",
    email: "email-owner@openctest.dev",
    phone: "0300 1111111",
  });

  assert.strictEqual(res.statusCode, 409);
  assert.strictEqual(res.body.code, "OWNER_IDENTIFIERS_CONFLICT");

  const savedOrg = await TeamOrganization.findById(org._id);
  assert.strictEqual(savedOrg.owner, null, "a failed handover changes nothing");

  const memberships = await Membership.countDocuments({ organization: org._id });
  assert.strictEqual(memberships, 0, "no membership is created for a failed handover");

  const emailUser = await User.findById(emailOwner._id);
  assert.strictEqual(emailUser.mustChangePassword, false);
});

test("only a platform admin can hand an organization over", async () => {
  const org = await makeOrg();
  const res = mockRes();

  await handoverOrganization(
    mockReq({
      user: { _id: new mongoose.Types.ObjectId(), role: "scorer" },
      principalType: "user",
      params: { id: String(org._id) },
      body: { name: "Not Admin", email: "not-admin@openctest.dev" },
    }),
    res
  );

  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.code, "PLATFORM_ADMIN_REQUIRED");
});

test("the admin directory lists deactivated organizations so they can still be handed over", async () => {
  await makeOrg({ name: "Active Handover Org" });
  const inactive = await makeOrg({ name: "Inactive Handover Org" });
  inactive.isActive = false;
  await inactive.save();

  const adminRes = mockRes();
  await listOrganizations(
    mockReq({
      user: { _id: new mongoose.Types.ObjectId(), role: "admin" },
      principalType: "admin",
      query: {},
    }),
    adminRes
  );
  assert.strictEqual(adminRes.statusCode, 200, JSON.stringify(adminRes.body));
  assert.strictEqual(adminRes.body.items.length, 2);

  const publicRes = mockRes();
  await listOrganizations(mockReq({ query: {} }), publicRes);
  assert.strictEqual(publicRes.statusCode, 200, JSON.stringify(publicRes.body));
  assert.strictEqual(publicRes.body.items.length, 1, "the public directory still hides inactive organizations");
});

// ---------------------------------------------------------------------------
// Change password
// ---------------------------------------------------------------------------
test("change-password replaces the password, clears mustChangePassword, and issues a fresh token", async () => {
  const user = await makeUser({
    email: "change-me@openctest.dev",
    mustChangePassword: true,
  });

  const res = mockRes();
  await changePassword(
    mockReq({
      user: { _id: user._id },
      principalType: "user",
      body: { currentPassword: "existing-pass-123", newPassword: "brand-new-pass-456" },
    }),
    res
  );

  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.ok(res.body.token, "a fresh token survives the tokenVersion bump");
  assert.strictEqual(res.body.user.mustChangePassword, false);
  assert.strictEqual(res.body.user.passwordSet, true);

  const saved = await User.findById(user._id).select("+password");
  assert.strictEqual(saved.mustChangePassword, false);
  assert.strictEqual(saved.tokenVersion, 1);
  assert.strictEqual(await saved.comparePassword("brand-new-pass-456"), true);

  const oldPassword = await login("change-me@openctest.dev", "existing-pass-123");
  assert.strictEqual(oldPassword.statusCode, 400);

  const newPassword = await login("change-me@openctest.dev", "brand-new-pass-456");
  assert.strictEqual(newPassword.statusCode, 200);
  assert.strictEqual(newPassword.body.user.mustChangePassword, false);
});

test("change-password rejects a wrong, missing, or unchanged current password", async () => {
  const user = await makeUser({ email: "wrong-pass@openctest.dev" });

  const run = async (body) => {
    const res = mockRes();
    await changePassword(
      mockReq({ user: { _id: user._id }, principalType: "user", body }),
      res
    );
    return res;
  };

  const wrong = await run({ currentPassword: "not-my-password", newPassword: "another-pass-123" });
  assert.strictEqual(wrong.statusCode, 400);
  assert.strictEqual(wrong.body.code, "CURRENT_PASSWORD_INVALID");

  const missing = await run({ newPassword: "another-pass-123" });
  assert.strictEqual(missing.statusCode, 400);
  assert.strictEqual(missing.body.code, "CURRENT_PASSWORD_REQUIRED");

  const unchanged = await run({
    currentPassword: "existing-pass-123",
    newPassword: "existing-pass-123",
  });
  assert.strictEqual(unchanged.statusCode, 400);
  assert.strictEqual(unchanged.body.code, "PASSWORD_UNCHANGED");

  const weak = await run({ currentPassword: "existing-pass-123", newPassword: "short" });
  assert.strictEqual(weak.statusCode, 400, "the shared password-strength rule still applies");

  const saved = await User.findById(user._id).select("+password");
  assert.strictEqual(await saved.comparePassword("existing-pass-123"), true, "nothing changed");
});

test("a Google-only account can set its first password without a current password", async () => {
  const user = await makeUser({
    email: "google-only@openctest.dev",
    password: undefined,
    passwordSet: false,
    authProviders: [{ provider: "google", providerUserId: "google-123" }],
  });

  const res = mockRes();
  await changePassword(
    mockReq({
      user: { _id: user._id },
      principalType: "user",
      body: { newPassword: "first-password-123" },
    }),
    res
  );

  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.user.passwordSet, true);

  const saved = await User.findById(user._id).select("+password");
  assert.strictEqual(saved.passwordSet, true);
  assert.strictEqual(await saved.comparePassword("first-password-123"), true);
});

test("change-password refuses an admin principal", async () => {
  const res = mockRes();
  await changePassword(
    mockReq({
      user: { _id: new mongoose.Types.ObjectId(), role: "admin" },
      principalType: "admin",
      body: { currentPassword: "whatever-123", newPassword: "another-pass-123" },
    }),
    res
  );

  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.code, "WRONG_PRINCIPAL");
});

test("a temporary-password session is blocked from other protected routes server-side", async () => {
  const user = await makeUser({
    email: "gate-owner@openctest.dev",
    mustChangePassword: true,
  });
  const loginRes = await login("gate-owner@openctest.dev", "existing-pass-123");
  assert.strictEqual(loginRes.statusCode, 200, JSON.stringify(loginRes.body));

  const { protect } = await import("../src/middleware/authMiddleware.js");
  const withSession = (originalUrl) =>
    mockReq({
      headers: { authorization: `Bearer ${loginRes.body.token}` },
      originalUrl,
    });

  const blocked = mockRes();
  let blockedNext = false;
  await protect(withSession("/api/organizations"), blocked, () => {
    blockedNext = true;
  });
  assert.strictEqual(blockedNext, false, "the request must not reach the route");
  assert.strictEqual(blocked.statusCode, 403);
  assert.strictEqual(blocked.body.code, "PASSWORD_CHANGE_REQUIRED");

  const allowed = mockRes();
  let allowedNext = false;
  await protect(withSession("/api/auth/change-password"), allowed, () => {
    allowedNext = true;
  });
  assert.strictEqual(allowedNext, true, "the change-password route must stay reachable");

  // Once the password is replaced the gate is gone.
  await changePassword(
    mockReq({
      user: { _id: user._id },
      principalType: "user",
      body: { currentPassword: "existing-pass-123", newPassword: "replacement-pass-456" },
    }),
    mockRes()
  );
  const after = mockRes();
  let afterNext = false;
  await protect(withSession("/api/organizations"), after, () => {
    afterNext = true;
  });
  assert.strictEqual(afterNext, false, "the old token is invalidated by the password change");
  assert.strictEqual(after.statusCode, 401);
});
