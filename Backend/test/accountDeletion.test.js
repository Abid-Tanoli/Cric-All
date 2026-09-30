import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";
process.env.FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

import mongoose from "mongoose";
import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import User from "../src/models/User.js";
import TeamOrganization from "../src/models/TeamOrganization.js";
import Membership from "../src/models/Membership.js";
import Invitation from "../src/models/Invitation.js";
import HandlerRequest from "../src/models/HandlerRequest.js";
import MatchOfficial from "../src/models/MatchOfficial.js";
import Player from "../src/models/Player.js";
import Team from "../src/models/Team.js";
import AuditLog from "../src/models/AuditLog.js";
import { deleteAccount } from "../src/controllers/authController.js";
import { deleteUserAccount } from "../src/services/accountDeletionService.js";

let mongod;

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
    Invitation.deleteMany({}),
    HandlerRequest.deleteMany({}),
    MatchOfficial.deleteMany({}),
    Player.deleteMany({}),
    Team.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);
});

let counter = 0;
async function makeUser(overrides = {}) {
  counter += 1;
  return User.create({
    name: `Delete Person ${counter}`,
    email: `delete-${counter}-${Math.random().toString(36).slice(2, 8)}@openctest.dev`,
    password: "password-123",
    role: "scorer",
    accountType: "organization_admin",
    emailVerified: true,
    ...overrides,
  });
}

async function runDelete(user, overrides = {}) {
  const res = mockRes();
  await deleteAccount(
    mockReq({ user, principalType: "user", ...overrides }),
    res
  );
  return res;
}

// ---------------------------------------------------------------------------
// The happy path
// ---------------------------------------------------------------------------
test("deletes the account and everything hanging off it", async () => {
  const user = await makeUser();
  const org = await TeamOrganization.create({ name: "Cleanup Org", owner: user._id });
  const teammate = await makeUser();

  await Membership.create([
    { organization: org._id, user: user._id, roles: ["admin"], status: "active" },
    { organization: org._id, user: teammate._id, roles: ["owner"], status: "active" },
  ]);
  await Invitation.create({
    organization: org._id,
    inviter: teammate._id,
    invitee: user._id,
    email: user.email,
    tokenHash: `hash-${Math.random().toString(36).slice(2)}`,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await HandlerRequest.create({ user: user._id, type: "team" });
  await Player.create({ name: "Kept Player", createdBy: user._id });
  const team = await Team.create({ name: "Kept Team", managedBy: user._id });

  const res = await runDelete(user);

  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(await User.countDocuments({ _id: user._id }), 0);
  assert.equal(await Membership.countDocuments({ user: user._id }), 0);
  assert.equal(await Invitation.countDocuments({ email: user.email }), 0);
  assert.equal(await HandlerRequest.countDocuments({ user: user._id }), 0);

  // Public content survives; only the pointer to the deleted account goes.
  const keptPlayer = await Player.findOne({ name: "Kept Player" });
  assert.ok(keptPlayer, "player profile is not deleted with the account");
  assert.ok(!keptPlayer.createdBy, "player no longer points at a missing user");
  const keptTeam = await Team.findById(team._id);
  assert.ok(keptTeam, "team is not deleted with the account");
  assert.ok(!keptTeam.managedBy, "team no longer points at a missing user");

  // The teammate's membership and the org itself are untouched.
  assert.equal(await Membership.countDocuments({ organization: org._id }), 1);
  assert.equal(await TeamOrganization.countDocuments({ _id: org._id }), 1);
});

test("records an audit entry after the account is gone", async () => {
  const user = await makeUser();

  await runDelete(user);

  const entry = await AuditLog.findOne({ action: "user.account_deleted" });
  assert.ok(entry, "deletion is written to the audit trail");
  assert.equal(entry.targetId, String(user._id));
  assert.equal(entry.targetLabel, user.email);
});

test("the audit trail survives: deleting a second account does not erase the first one's entries", async () => {
  const first = await makeUser();
  const second = await makeUser();

  await runDelete(first);
  await runDelete(second);

  const entries = await AuditLog.find({ action: "user.account_deleted" });
  assert.equal(entries.length, 2, "both deletions remain on record");
});

// ---------------------------------------------------------------------------
// Ownership is the one thing that blocks deletion
// ---------------------------------------------------------------------------
test("refuses to delete the last owner of an organization and names it", async () => {
  const user = await makeUser();
  const org = await TeamOrganization.create({ name: "Sole Owner Club", owner: user._id });
  await Membership.create({
    organization: org._id,
    user: user._id,
    roles: ["owner"],
    status: "active",
  });

  const res = await runDelete(user);

  assert.strictEqual(res.statusCode, 409);
  assert.strictEqual(res.body.code, "ACCOUNT_OWNS_ORGANIZATION");
  assert.deepEqual(res.body.organizations.map((o) => o.name), ["Sole Owner Club"]);

  // Nothing was removed, so the person can promote somebody and retry.
  assert.ok(await User.findById(user._id), "account still exists after the refusal");
  assert.equal(await Membership.countDocuments({ organization: org._id }), 1);
});

test("ownership passes to a remaining owner, so deletion is allowed", async () => {
  const user = await makeUser();
  const heir = await makeUser();
  const org = await TeamOrganization.create({ name: "Two Owner Club", owner: user._id });
  await Membership.create([
    { organization: org._id, user: user._id, roles: ["owner"], status: "active" },
    { organization: org._id, user: heir._id, roles: ["owner"], status: "active" },
  ]);

  const res = await runDelete(user);

  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  const updatedOrg = await TeamOrganization.findById(org._id);
  assert.ok(updatedOrg.owner.equals(heir._id), "org owner is now the remaining owner");
  assert.ok(updatedOrg.owner, "org.owner never becomes null while an owner exists");
});

test("a removed membership does not count as a co-owner", async () => {
  const user = await makeUser();
  const formerOwner = await makeUser();
  const org = await TeamOrganization.create({ name: "Former Owner Club", owner: user._id });
  await Membership.create([
    { organization: org._id, user: user._id, roles: ["owner"], status: "active" },
    { organization: org._id, user: formerOwner._id, roles: ["owner"], status: "removed" },
  ]);

  const res = await runDelete(user);

  assert.strictEqual(res.statusCode, 409, JSON.stringify(res.body));
});

// ---------------------------------------------------------------------------
// Principal and input guards
// ---------------------------------------------------------------------------
test("an admin token cannot reach the user account deletion", async () => {
  const user = await makeUser();
  const res = mockRes();

  await deleteAccount(mockReq({ user, principalType: "admin" }), res);

  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.code, "WRONG_PRINCIPAL");
  assert.ok(await User.findById(user._id), "user account untouched by an admin token");
});

test("an unverified account can still delete itself", async () => {
  // The two stuck validation accounts were never able to verify their address.
  // Gating this on requireVerifiedEmail would leave them permanently stuck.
  const user = await makeUser({ emailVerified: false });

  const res = await runDelete(user);

  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(await User.countDocuments({ _id: user._id }), 0);
});

test("a suspended account's token is rejected before the controller runs", async () => {
  const user = await makeUser({ status: "suspended" });
  const { protect } = await import("../src/middleware/authMiddleware.js");
  const { default: jwt } = await import("jsonwebtoken");

  const token = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET);
  const res = mockRes();
  await protect(mockReq({ headers: { authorization: `Bearer ${token}` } }), res, () => {});

  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.code, "ACCOUNT_SUSPENDED");
});

test("the service rejects a malformed user id instead of throwing a cast error", async () => {
  await assert.rejects(() => deleteUserAccount("not-an-object-id"), {
    code: "INVALID_USER_ID",
  });
});

test("the service reports a missing account as 404", async () => {
  await assert.rejects(
    () => deleteUserAccount(new mongoose.Types.ObjectId().toString()),
    { code: "USER_NOT_FOUND" }
  );
});