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
import AuditLog from "../src/models/AuditLog.js";
import SystemSettings, { setPlatformSettings } from "../src/models/SystemSettings.js";
import { registerUser } from "../src/controllers/authController.js";
import {
  createOrganization,
  updateOrganization,
  deleteOrganization,
  getMyOrganizations,
  getOrganization,
} from "../src/controllers/organizationController.js";
import {
  acceptOrgInvitation,
  addOrgMember,
  createOrgInvitation,
  getMyOrgAccess,
  listOrgAuditLog,
  listOrgMembers,
  removeOrgMember,
  revokeOrgInvitation,
  transferOwnership,
  updateOrgMemberRoles,
} from "../src/controllers/membershipController.js";
import {
  requireAnyOrgPermission,
  requireOrgAdminType,
  requireOrgMembership,
  requireOrgOwner,
  requireOrgPermission,
  resolveOrgAccess,
} from "../src/middleware/orgAccess.js";
import { PERMISSIONS } from "../src/permissions/orgPermissions.js";
import {
  getPlatformSettingsHandler,
  updatePlatformSettingsHandler,
} from "../src/controllers/settingsController.js";

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
    AuditLog.deleteMany({}),
    SystemSettings.deleteMany({}),
  ]);
});

function makeNext() {
  let called = false;
  let error = null;
  return {
    get called() { return called; },
    get error() { return error; },
    next(err) { called = true; error = err || null; },
  };
}

async function runGuard(guard, req) {
  const res = mockRes();
  const next = makeNext();
  await guard(req, res, next.next);
  return { res, next };
}

let userCounter = 0;
async function makeUser(overrides = {}) {
  userCounter += 1;
  return User.create({
    name: `Org Person ${userCounter}`,
    email: `person-${userCounter}-${Math.random().toString(36).slice(2, 8)}@openctest.dev`,
    password: "password-123",
    role: "scorer",
    accountType: "organization_admin",
    emailVerified: true,
    ...overrides,
  });
}

/** Create an org owned by `owner` through the controller (not a raw insert). */
async function makeOrg(owner, overrides = {}) {
  const res = mockRes();
  await createOrganization(
    mockReq({ user: owner, principalType: "user", body: { name: "Test Org", ...overrides } }),
    res,
  );
  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
  return res.body.organization;
}

// ---------------------------------------------------------------------------
// Signup creates a real, owned organization
// ---------------------------------------------------------------------------
test("organization admin registration creates an owned organization and owner Membership", async () => {
  const req = mockReq({
    body: {
      name: "Green Principal",
      email: "org-admin@openctest.dev",
      password: "password-123",
      accountType: "organization_admin",
      organizationName: "Greenfield College",
      organizationCategory: "College",
    },
  });
  const res = mockRes();
  await registerUser(req, res);

  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
  assert.ok(res.body.organization?._id, "register response includes the created organization");
  assert.ok(res.body.organization.slug, "organization has a public slug");

  const user = await User.findOne({ email: "org-admin@openctest.dev" });
  const org = await TeamOrganization.findById(res.body.organization._id);
  assert.ok(org.owner.equals(user._id));

  const membership = await Membership.findOne({ organization: org._id, user: user._id });
  assert.ok(membership, "owner Membership row exists");
  assert.deepEqual(membership.roles, ["owner"]);
  assert.strictEqual(membership.status, "active");
});

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------
test("requireOrgAdminType: organization admins and platform admins pass, players are rejected", async () => {
  const orgAdmin = await makeUser();
  const player = await makeUser({ accountType: "player", role: "viewer" });

  let { res, next } = await runGuard(requireOrgAdminType, { user: orgAdmin, principalType: "user" });
  assert.ok(next.called && res.body === null, "organization admin passes");

  ({ res, next } = await runGuard(requireOrgAdminType, { user: { role: "admin" }, principalType: "admin" }));
  assert.ok(next.called, "platform admin passes");

  ({ res, next } = await runGuard(requireOrgAdminType, { user: player, principalType: "user" }));
  assert.ok(!next.called);
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.code, "ORG_ADMIN_REQUIRED");
});

test("requireOrgPermission: member without the permission is 403, platform admin passes, anon is 401", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const scorer = await makeUser({ accountType: "viewer", role: "viewer" });
  await Membership.create({ organization: org._id, user: scorer._id, roles: ["score_handler"] });

  const guard = requireOrgPermission(PERMISSIONS.MANAGE_TEAMS);

  // anonymous
  let ctx = await runGuard(guard, { params: { id: String(org._id) } });
  assert.strictEqual(ctx.res.statusCode, 401);

  // score_handler has score_match but NOT manage_teams
  ctx = await runGuard(guard, { user: scorer, principalType: "user", params: { id: String(org._id) } });
  assert.ok(!ctx.next.called);
  assert.strictEqual(ctx.res.statusCode, 403);
  assert.strictEqual(ctx.res.body.code, "ORG_PERMISSION_DENIED");
  assert.strictEqual(ctx.res.body.requiredPermission, PERMISSIONS.MANAGE_TEAMS);

  // the same person DOES pass the permission their role grants
  const scoreGuard = requireOrgPermission(PERMISSIONS.SCORE_MATCH);
  ctx = await runGuard(scoreGuard, { user: scorer, principalType: "user", params: { id: String(org._id) } });
  assert.ok(ctx.next.called, "score_handler passes score_match");

  // owner passes everything
  ctx = await runGuard(guard, { user: owner, principalType: "user", params: { id: String(org._id) } });
  assert.ok(ctx.next.called, "owner passes manage_teams");

  // platform admin passes
  ctx = await runGuard(guard, { user: { role: "admin" }, principalType: "admin", params: { id: String(org._id) } });
  assert.ok(ctx.next.called, "platform admin passes");
  assert.strictEqual(ctx.res.statusCode, 200);
});

test("requireAnyOrgPermission: passes on the first matching permission, reports all when none match", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const teamManager = await makeUser({ accountType: "viewer", role: "viewer" });
  await Membership.create({ organization: org._id, user: teamManager._id, roles: ["team_manager"] });
  const supporter = await makeUser({ accountType: "viewer", role: "viewer" });
  await Membership.create({ organization: org._id, user: supporter._id, roles: ["staff"] });

  const guard = requireAnyOrgPermission(PERMISSIONS.MANAGE_TEAMS, PERMISSIONS.CREATE_MATCH);

  // manage_teams alone is enough
  let ctx = await runGuard(guard, {
    user: teamManager,
    principalType: "user",
    params: { id: String(org._id) },
  });
  assert.ok(ctx.next.called, "team_manager reads the org team list via manage_teams");

  // neither permission is a 403, and the caller is told the whole set it needed
  ctx = await runGuard(guard, { user: supporter, principalType: "user", params: { id: String(org._id) } });
  assert.ok(!ctx.next.called);
  assert.strictEqual(ctx.res.statusCode, 403);
  assert.strictEqual(ctx.res.body.code, "ORG_PERMISSION_DENIED");
  assert.deepStrictEqual(ctx.res.body.requiredPermission, [
    PERMISSIONS.MANAGE_TEAMS,
    PERMISSIONS.CREATE_MATCH,
  ]);

  // a single-permission guard still reports one string, not an array
  const single = await runGuard(requireOrgPermission(PERMISSIONS.MANAGE_TEAMS), {
    user: supporter,
    principalType: "user",
    params: { id: String(org._id) },
  });
  assert.strictEqual(single.res.body.requiredPermission, PERMISSIONS.MANAGE_TEAMS);

  // platform admin passes either guard
  ctx = await runGuard(guard, { user: { role: "admin" }, principalType: "admin", params: { id: String(org._id) } });
  assert.ok(ctx.next.called, "platform admin passes");

  // an empty permission set is a membership check
  const membershipOnly = requireAnyOrgPermission();
  ctx = await runGuard(membershipOnly, { user: teamManager, principalType: "user", params: { id: String(org._id) } });
  assert.ok(ctx.next.called, "no permissions listed means any member passes");
});

test("requireOrgPermission: a stranger gets ORG_MEMBERSHIP_REQUIRED, a bogus id gets 404", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const stranger = await makeUser({ accountType: "viewer", role: "viewer" });

  let ctx = await runGuard(requireOrgMembership, {
    user: stranger,
    principalType: "user",
    params: { id: String(org._id) },
  });
  assert.ok(!ctx.next.called);
  assert.strictEqual(ctx.res.statusCode, 403);
  assert.strictEqual(ctx.res.body.code, "ORG_MEMBERSHIP_REQUIRED");

  ctx = await runGuard(requireOrgMembership, {
    user: owner,
    principalType: "user",
    params: { id: new mongoose.Types.ObjectId().toString() },
  });
  assert.strictEqual(ctx.res.statusCode, 404);
});

test("requireOrgPermission also resolves :orgId (nested route shape)", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const ctx = await runGuard(requireOrgPermission(PERMISSIONS.MANAGE_ORG), {
    user: owner,
    principalType: "user",
    params: { orgId: String(org._id) },
  });
  assert.ok(ctx.next.called);
  assert.ok(ctx.next.error === null);
});

// ---------------------------------------------------------------------------
// Create / update / delete
// ---------------------------------------------------------------------------
test("self-service create: caller becomes owner, supervisory fields are ignored, slug is unique", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, { description: "hello", isActive: false, verificationStatus: "verified" });
  assert.ok(String(org.owner._id || org.owner) === String(owner._id));
  assert.strictEqual(org.isActive, true, "isActive cannot be forced by self-service");
  assert.strictEqual(org.verificationStatus, "unverified", "verificationStatus cannot be forced");
  assert.strictEqual(org.description, "hello");
  assert.strictEqual(org.slug, "test-org");

  // second org with the same name gets -2
  const second = await makeOrg(owner);
  assert.strictEqual(second.slug, "test-org-2");
});

test("unknown organization type is rejected with 422", async () => {
  const owner = await makeUser();
  const res = mockRes();
  await createOrganization(
    mockReq({ user: owner, principalType: "user", body: { name: "Typed Org", type: "not-a-real-category" } }),
    res,
  );
  assert.strictEqual(res.statusCode, 422);
  assert.strictEqual(res.body.code, "ORG_TYPE_UNKNOWN");
});

test("sub-organizations are limited to orgs the caller manages", async () => {
  const mine = await makeUser();
  const stranger = await makeUser();
  const parent = await makeOrg(mine, { name: "My Parent Org" });

  const allowed = mockRes();
  await createOrganization(
    mockReq({ user: mine, principalType: "user", body: { name: "My Sub Org", parent: String(parent._id) } }),
    allowed,
  );
  assert.strictEqual(allowed.statusCode, 201, JSON.stringify(allowed.body));

  const denied = mockRes();
  await createOrganization(
    mockReq({ user: stranger, principalType: "user", body: { name: "Intruder Org", parent: String(parent._id) } }),
    denied,
  );
  assert.strictEqual(denied.statusCode, 403);
  assert.strictEqual(denied.body.code, "ORG_PARENT_FORBIDDEN");
});

test("updateOrganization: owner edits allowed fields, supervisory fields are 403", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, { name: "Editable Org" });
  const orgId = String(org._id);

  const req = mockReq({
    user: owner,
    principalType: "user",
    params: { id: orgId },
    body: { name: "Renamed Org", contact: { phone: "0300-1234567", email: "club@example.com" } },
  });
  const guardNext = makeNext();
  await requireOrgPermission(PERMISSIONS.MANAGE_ORG)(req, mockRes(), guardNext.next);
  assert.ok(guardNext.called && guardNext.error === null, "guard loaded org");

  const res = mockRes();
  await updateOrganization(req, res);
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.organization.name, "Renamed Org");
  assert.strictEqual(res.body.organization.contact.phone, "0300-1234567");

  const req2 = mockReq({ user: owner, principalType: "user", params: { id: orgId }, body: { isActive: false } });
  const guardNext2 = makeNext();
  await requireOrgPermission(PERMISSIONS.MANAGE_ORG)(req2, mockRes(), guardNext2.next);
  const deactivateRes = mockRes();
  await updateOrganization(req2, deactivateRes);
  assert.strictEqual(deactivateRes.statusCode, 403);
  assert.strictEqual(deactivateRes.body.code, "ORG_SUPERVISORY_FIELDS");
});

test("deleteOrganization: refuses when sub-organizations or extra members exist", async () => {
  const owner = await makeUser();
  const parent = await makeOrg(owner, { name: "Parent For Delete" });
  const child = await makeOrg(owner, { name: "Child For Delete", parent: String(parent._id) });
  void child;

  const req = mockReq({ user: owner, principalType: "user", params: { id: String(parent._id) } });
  const res = mockRes();
  await deleteOrganization(req, res);
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.message, /sub-organizations/i);

  await TeamOrganization.deleteOne({ parent: parent._id });
  const extra = await makeUser({ accountType: "viewer", role: "viewer" });
  await Membership.create({ organization: parent._id, user: extra._id, roles: ["player"] });

  const res2 = mockRes();
  await deleteOrganization(mockReq({ user: owner, principalType: "user", params: { id: String(parent._id) } }), res2);
  assert.strictEqual(res2.statusCode, 400);
  assert.strictEqual(res2.body.code, "ORG_HAS_MEMBERS");
});

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------
test("members: direct add requires a verified account, rejects duplicates, lists paginated", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, { name: "Members Org" });
  const joiner = await makeUser({ accountType: "viewer", role: "viewer", emailVerified: true });
  const unverified = await makeUser({ accountType: "viewer", role: "viewer", emailVerified: false });

  const orgDoc = await TeamOrganization.findById(org._id);
  const ownerAccess = { via: "membership", roles: ["owner"], permissions: [] };

  const addRes = mockRes();
  await addOrgMember(
    mockReq({ user: owner, principalType: "user", params: { id: String(org._id) }, body: { email: joiner.email, roles: ["score_handler"] }, org: orgDoc, orgAccess: ownerAccess }),
    addRes,
  );
  assert.strictEqual(addRes.statusCode, 201, JSON.stringify(addRes.body));
  assert.deepEqual(addRes.body.member.roles, ["score_handler"]);

  const dupRes = mockRes();
  await addOrgMember(
    mockReq({ user: owner, principalType: "user", params: { id: String(org._id) }, body: { email: joiner.email, roles: ["player"] }, org: orgDoc, orgAccess: ownerAccess }),
    dupRes,
  );
  assert.strictEqual(dupRes.statusCode, 409);
  assert.strictEqual(dupRes.body.code, "ALREADY_MEMBER");

  const unverifiedRes = mockRes();
  await addOrgMember(
    mockReq({ user: owner, principalType: "user", params: { id: String(org._id) }, body: { email: unverified.email, roles: ["player"] }, org: orgDoc, orgAccess: ownerAccess }),
    unverifiedRes,
  );
  assert.strictEqual(unverifiedRes.statusCode, 422);
  assert.strictEqual(unverifiedRes.body.code, "EMAIL_NOT_VERIFIED");

  const ghostRes = mockRes();
  await addOrgMember(
    mockReq({ user: owner, principalType: "user", params: { id: String(org._id) }, body: { email: "ghost@openctest.dev", roles: ["player"] }, org: orgDoc, orgAccess: ownerAccess }),
    ghostRes,
  );
  assert.strictEqual(ghostRes.statusCode, 404);
  assert.strictEqual(ghostRes.body.code, "USER_NOT_FOUND");

  const listRes = mockRes();
  await listOrgMembers(mockReq({ user: owner, params: { id: String(org._id) }, query: { page: "1", limit: "10" } }), listRes);
  assert.strictEqual(listRes.statusCode, 200);
  assert.strictEqual(listRes.body.total, 2, "owner + score handler");
});

test("roles: non-owner cannot grant admin, cannot change own roles, last owner is protected", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, { name: "Roles Org" });
  const manager = await makeUser({ accountType: "viewer", role: "viewer" });
  await Membership.create({ organization: org._id, user: manager._id, roles: ["manager"] });

  const managerAccess = { via: "membership", roles: ["manager"], permissions: [] };

  // manager tries to grant admin
  const escalateRes = mockRes();
  await updateOrgMemberRoles(
    mockReq({ user: manager, principalType: "user", params: { id: String(org._id), userId: String(owner._id) }, body: { roles: ["admin"] }, org: await TeamOrganization.findById(org._id), orgAccess: managerAccess }),
    escalateRes,
  );
  assert.strictEqual(escalateRes.statusCode, 403);
  assert.strictEqual(escalateRes.body.code, "PRIVILEGED_ROLE_FORBIDDEN");

  // manager tries to promote themselves
  const selfRes = mockRes();
  await updateOrgMemberRoles(
    mockReq({ user: manager, principalType: "user", params: { id: String(org._id), userId: String(manager._id) }, body: { roles: ["admin"] }, org: await TeamOrganization.findById(org._id), orgAccess: managerAccess }),
    selfRes,
  );
  assert.strictEqual(selfRes.statusCode, 403);

  // owner cannot be demoted through the role endpoint
  const ownerAccess = { via: "membership", roles: ["owner"], permissions: [] };
  const demoteRes = mockRes();
  await updateOrgMemberRoles(
    mockReq({ user: owner, principalType: "user", params: { id: String(org._id), userId: String(owner._id) }, body: { roles: ["player"] }, org: await TeamOrganization.findById(org._id), orgAccess: ownerAccess }),
    demoteRes,
  );
  assert.ok(demoteRes.statusCode === 400 || demoteRes.statusCode === 403, `got ${demoteRes.statusCode}`);
});

test("the last owner cannot be removed, and ownership cannot be self-granted", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, { name: "Owner Guard Org" });
  const other = await makeUser({ accountType: "viewer", role: "viewer" });
  await Membership.create({ organization: org._id, user: other._id, roles: ["admin"] });

  const ownerMembership = await Membership.findOne({ organization: org._id, user: owner._id });
  const otherMembership = await Membership.findOne({ organization: org._id, user: other._id });

  // removing the last owner is refused by the service invariant
  const removeRes = mockRes();
  await removeOrgMember(
    mockReq({ user: other, principalType: "user", params: { id: String(org._id), userId: String(owner._id) }, org: await TeamOrganization.findById(org._id), orgAccess: { via: "membership", roles: ["admin"] } }),
    removeRes,
  );
  assert.strictEqual(removeRes.statusCode, 400);
  assert.strictEqual(removeRes.body.code, "OWNER_CANNOT_BE_REMOVED");

  // an admin cannot make themselves owner
  const selfOwnerRes = mockRes();
  await transferOwnership(
    mockReq({ user: other, principalType: "user", params: { id: String(org._id), userId: String(other._id) }, org: await TeamOrganization.findById(org._id), orgAccess: { via: "membership", roles: ["admin"] } }),
    selfOwnerRes,
  );
  assert.strictEqual(selfOwnerRes.statusCode, 403);
  assert.strictEqual(selfOwnerRes.body.code, "SELF_ROLE_CHANGE_FORBIDDEN");

  // sanity: the owner membership and the admin membership are intact
  assert.ok(ownerMembership);
  assert.ok(otherMembership);
});

test("ownership transfer promotes the target and keeps the previous owner as admin", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, { name: "Transfer Org" });
  const successor = await makeUser({ accountType: "viewer", role: "viewer" });
  await Membership.create({ organization: org._id, user: successor._id, roles: ["team_manager"] });

  const res = mockRes();
  await transferOwnership(
    mockReq({ user: owner, principalType: "user", params: { id: String(org._id), userId: String(successor._id) }, org: await TeamOrganization.findById(org._id), orgAccess: { via: "membership", roles: ["owner"], permissions: [] } }),
    res,
  );
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));

  const orgAfter = await TeamOrganization.findById(org._id);
  assert.ok(orgAfter.owner.equals(successor._id), "org.owner pointer moved");
  const newOwner = await Membership.findOne({ organization: org._id, user: successor._id });
  assert.ok(newOwner.roles.includes("owner"));

  // The outgoing owner is demoted, not left holding a second owner role: a
  // transfer moves ownership rather than adding one.
  const oldOwner = await Membership.findOne({ organization: org._id, user: owner._id });
  assert.ok(!oldOwner.roles.includes("owner"), "previous owner no longer holds the owner role");
  assert.ok(oldOwner.roles.includes("admin"), "previous owner is kept on as an admin");

  // Exactly one owner remains.
  const owners = await Membership.find({ organization: org._id, status: "active", roles: "owner" });
  assert.strictEqual(owners.length, 1);
});

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------
test("invitation lifecycle: create → invitee accepts → membership active; foreign account rejected", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, { name: "Invite Org" });
  const invitee = await makeUser({ accountType: "viewer", role: "viewer", emailVerified: true });
  const stranger = await makeUser({ accountType: "viewer", role: "viewer", emailVerified: true });

  const orgAccess = { via: "membership", roles: ["owner"], permissions: [] };
  const createRes = mockRes();
  await createOrgInvitation(
    mockReq({ user: owner, principalType: "user", params: { id: String(org._id) }, body: { email: invitee.email, roles: ["score_handler"], message: "Join us" }, org: await TeamOrganization.findById(org._id), orgAccess }),
    createRes,
  );
  assert.strictEqual(createRes.statusCode, 201, JSON.stringify(createRes.body));
  assert.deepEqual(createRes.body.invitation.roles, ["score_handler"]);
  assert.strictEqual(createRes.body.invitation.tokenHash, undefined, "raw hash never leaves the server");

  // A second open invitation to the same address refreshes rather than stacks.
  const againRes = mockRes();
  await createOrgInvitation(
    mockReq({ user: owner, principalType: "user", params: { id: String(org._id) }, body: { email: invitee.email, roles: ["coach"] }, org: await TeamOrganization.findById(org._id), orgAccess }),
    againRes,
  );
  assert.strictEqual(againRes.statusCode, 201);
  assert.strictEqual(await Invitation.countDocuments({ organization: org._id, status: "pending" }), 1);

  const invitation = await Invitation.findOne({ organization: org._id, status: "pending" });
  const rawToken = "a".repeat(64);
  invitation.tokenHash = (await import("../src/models/Invitation.js")).hashInvitationToken(rawToken);
  await invitation.save();

  // stranger cannot accept
  const strangerRes = mockRes();
  await acceptOrgInvitation(mockReq({ user: stranger, body: { token: rawToken } }), strangerRes);
  assert.strictEqual(strangerRes.statusCode, 403);
  assert.strictEqual(strangerRes.body.code, "INVITATION_EMAIL_MISMATCH");

  // invitee accepts
  const acceptRes = mockRes();
  await acceptOrgInvitation(mockReq({ user: invitee, body: { token: rawToken } }), acceptRes);
  assert.strictEqual(acceptRes.statusCode, 200, JSON.stringify(acceptRes.body));
  assert.deepEqual(acceptRes.body.member.roles, ["coach"]);

  const membership = await Membership.findOne({ organization: org._id, user: invitee._id });
  assert.strictEqual(membership.status, "active");
  assert.deepEqual(membership.roles, ["coach"]);

  // token is single use
  const reuseRes = mockRes();
  await acceptOrgInvitation(mockReq({ user: invitee, body: { token: rawToken } }), reuseRes);
  assert.strictEqual(reuseRes.statusCode, 410);
});

test("expired invitation is rejected; owner-role invitations cannot be created", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, { name: "Expiry Org" });
  const invitee = await makeUser({ accountType: "viewer", role: "viewer", emailVerified: true });
  const orgAccess = { via: "membership", roles: ["owner"], permissions: [] };

  const ownerInvite = mockRes();
  await createOrgInvitation(
    mockReq({ user: owner, principalType: "user", params: { id: String(org._id) }, body: { email: invitee.email, roles: ["owner"] }, org: await TeamOrganization.findById(org._id), orgAccess }),
    ownerInvite,
  );
  assert.strictEqual(ownerInvite.statusCode, 403);
  assert.strictEqual(ownerInvite.body.code, "PRIVILEGED_ROLE_FORBIDDEN");

  const createRes = mockRes();
  await createOrgInvitation(
    mockReq({ user: owner, principalType: "user", params: { id: String(org._id) }, body: { email: invitee.email, roles: ["player"] }, org: await TeamOrganization.findById(org._id), orgAccess }),
    createRes,
  );
  assert.strictEqual(createRes.statusCode, 201);

  const { hashInvitationToken } = await import("../src/models/Invitation.js");
  const rawToken = "b".repeat(64);
  await Invitation.updateOne(
    { organization: org._id, status: "pending" },
    { $set: { tokenHash: hashInvitationToken(rawToken), expiresAt: new Date(Date.now() - 1000) } },
  );

  const acceptRes = mockRes();
  await acceptOrgInvitation(mockReq({ user: invitee, body: { token: rawToken } }), acceptRes);
  assert.strictEqual(acceptRes.statusCode, 410);
  assert.strictEqual(acceptRes.body.code, "INVITATION_EXPIRED");
});

test("revoke makes a pending invitation unusable", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, { name: "Revoke Org" });
  const invitee = await makeUser({ accountType: "viewer", role: "viewer", emailVerified: true });
  const orgAccess = { via: "membership", roles: ["owner"], permissions: [] };

  const createRes = mockRes();
  await createOrgInvitation(
    mockReq({ user: owner, principalType: "user", params: { id: String(org._id) }, body: { email: invitee.email, roles: ["player"] }, org: await TeamOrganization.findById(org._id), orgAccess }),
    createRes,
  );
  const invitationId = String(createRes.body.invitation._id);

  const revokeRes = mockRes();
  await revokeOrgInvitation(
    mockReq({ user: owner, principalType: "user", params: { id: String(org._id), invitationId }, org: await TeamOrganization.findById(org._id) }),
    revokeRes,
  );
  assert.strictEqual(revokeRes.statusCode, 200);

  const invitation = await Invitation.findById(invitationId);
  assert.strictEqual(invitation.status, "revoked");

  const again = mockRes();
  await revokeOrgInvitation(
    mockReq({ user: owner, principalType: "user", params: { id: String(org._id), invitationId }, org: await TeamOrganization.findById(org._id) }),
    again,
  );
  assert.strictEqual(again.statusCode, 409);
  assert.strictEqual(again.body.code, "INVITATION_NOT_PENDING");
});

// ---------------------------------------------------------------------------
// Tenant isolation and audit
// ---------------------------------------------------------------------------
test("cross-tenant: a member of Org A has no membership in Org B and is denied", async () => {
  const ownerA = await makeUser();
  const ownerB = await makeUser();
  const orgA = await makeOrg(ownerA, { name: "Tenant A" });
  const orgB = await makeOrg(ownerB, { name: "Tenant B" });

  const accessA = await resolveOrgAccess(await TeamOrganization.findById(orgA._id), await User.findById(ownerA._id));
  const accessB = await resolveOrgAccess(await TeamOrganization.findById(orgB._id), await User.findById(ownerA._id));

  assert.strictEqual(accessA.roles.includes("owner"), true);
  assert.strictEqual(accessB.membership, null);
  assert.deepEqual(accessB.permissions, []);

  const ctx = await runGuard(requireOrgPermission(PERMISSIONS.MANAGE_TEAMS), {
    user: await User.findById(ownerA._id),
    principalType: "user",
    params: { id: String(orgB._id) },
  });
  assert.strictEqual(ctx.res.statusCode, 403);
  assert.strictEqual(ctx.res.body.code, "ORG_MEMBERSHIP_REQUIRED");
});

test("getMyOrganizations lists only the caller's orgs, with roles and permissions", async () => {
  const owner = await makeUser();
  const otherOwner = await makeUser();
  const org = await makeOrg(owner, { name: "Mine" });
  await makeOrg(otherOwner, { name: "Theirs" });

  const member = await makeUser({ accountType: "viewer", role: "viewer" });
  await Membership.create({ organization: org._id, user: member._id, roles: ["coach"] });

  const ownerRes = mockRes();
  await getMyOrganizations(mockReq({ user: owner }), ownerRes);
  assert.strictEqual(ownerRes.body.length, 1);
  assert.deepEqual(ownerRes.body[0].myRoles, ["owner"]);
  assert.strictEqual(ownerRes.body[0].myRole, "owner");

  const memberRes = mockRes();
  await getMyOrganizations(mockReq({ user: member }), memberRes);
  assert.strictEqual(memberRes.body.length, 1);
  assert.deepEqual(memberRes.body[0].myRoles, ["coach"]);
  assert.ok(memberRes.body[0].permissions.includes(PERMISSIONS.MANAGE_PLAYERS));
  assert.ok(!memberRes.body[0].permissions.includes(PERMISSIONS.MANAGE_MEMBERS));

  // memberCount comes from Membership, not the deprecated members[] array:
  // a stale legacy array full of ghosts must not inflate the number.
  assert.strictEqual(ownerRes.body[0].memberCount, 2, "owner + coach, from Membership rows");
  await TeamOrganization.updateOne({ _id: org._id }, { members: [{ user: owner._id, role: "admin" }, { user: member._id, role: "member" }] });
  const staleRes = mockRes();
  await getMyOrganizations(mockReq({ user: owner }), staleRes);
  assert.strictEqual(staleRes.body[0].memberCount, 2, "legacy array is ignored");

  const outsiderRes = mockRes();
  await getMyOrganizations(mockReq({ user: await makeUser() }), outsiderRes);
  assert.deepEqual(outsiderRes.body, []);
});

test("getMyOrgAccess returns roles + permissions, 403 for non-members", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, { name: "Access Org" });
  const stranger = await makeUser({ accountType: "viewer", role: "viewer" });

  const okRes = mockRes();
  await getMyOrgAccess(mockReq({ user: owner, params: { id: String(org._id) } }), okRes);
  assert.strictEqual(okRes.statusCode, 200);
  assert.deepEqual(okRes.body.roles, ["owner"]);
  assert.ok(okRes.body.permissions.length > 0);

  const denied = mockRes();
  await getMyOrgAccess(mockReq({ user: stranger, params: { id: String(org._id) } }), denied);
  assert.strictEqual(denied.statusCode, 403);
  assert.strictEqual(denied.body.code, "ORG_MEMBERSHIP_REQUIRED");
});

test("audit log records membership, role and invitation events for the org", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, { name: "Audit Org" });
  const joiner = await makeUser({ accountType: "viewer", role: "viewer", emailVerified: true });
  const orgAccess = { via: "membership", roles: ["owner"], permissions: [] };

  await addOrgMember(
    mockReq({ user: owner, principalType: "user", params: { id: String(org._id) }, body: { email: joiner.email, roles: ["manager"] }, org: await TeamOrganization.findById(org._id), orgAccess }),
    mockRes(),
  );
  await createOrgInvitation(
    mockReq({ user: owner, principalType: "user", params: { id: String(org._id) }, body: { email: "future@openctest.dev", roles: ["player"] }, org: await TeamOrganization.findById(org._id), orgAccess }),
    mockRes(),
  );

  const auditRes = mockRes();
  await listOrgAuditLog(
    mockReq({ user: owner, principalType: "user", params: { id: String(org._id) }, query: { page: "1", limit: "50" }, orgAccess }),
    auditRes,
  );
  assert.strictEqual(auditRes.statusCode, 200);
  const actions = auditRes.body.items.map((row) => row.action);
  assert.ok(actions.includes("org.created"), `has org.created: ${actions.join(",")}`);
  assert.ok(actions.includes("member.added_directly"));
  assert.ok(actions.includes("membership.added"));
  assert.ok(actions.includes("invitation.created"));
});

test("getOrganization exposes members from Membership, not the legacy array", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, { name: "Detail Org" });
  const coach = await makeUser({ accountType: "viewer", role: "viewer" });
  await Membership.create({ organization: org._id, user: coach._id, roles: ["coach"] });

  const res = mockRes();
  await getOrganization(mockReq({ params: { id: String(org._id) } }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.members.length, 2);
  assert.deepEqual(res.body.members.map((m) => m.roles).flat().sort(), ["coach", "owner"]);
});

test("requireOrgOwner: only the literal owner role passes", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, { name: "Owner Only Org" });
  const admin = await makeUser({ accountType: "viewer", role: "viewer" });
  await Membership.create({ organization: org._id, user: admin._id, roles: ["admin"] });

  let ctx = await runGuard(requireOrgOwner, { user: admin, principalType: "user", params: { id: String(org._id) } });
  assert.strictEqual(ctx.res.statusCode, 403);
  assert.strictEqual(ctx.res.body.code, "ORG_OWNER_REQUIRED");

  ctx = await runGuard(requireOrgOwner, { user: owner, principalType: "user", params: { id: String(org._id) } });
  assert.ok(ctx.next.called);
});

test("platform settings default to self-serve and record who changed them", async () => {
  await SystemSettings.deleteMany({});

  const read = mockRes();
  await getPlatformSettingsHandler(mockReq({}), read);
  assert.strictEqual(read.statusCode, 200);
  assert.strictEqual(read.body.data.requireOrgApproval, false);
  assert.strictEqual(read.body.data.requireMemberApproval, false);

  const admin = await makeUser({ role: "admin" });

  const empty = mockRes();
  await updatePlatformSettingsHandler(
    mockReq({ user: admin, body: { somethingElse: true } }),
    empty,
  );
  assert.strictEqual(empty.statusCode, 400, "a patch with no known keys is refused, not silently ignored");

  const on = mockRes();
  await updatePlatformSettingsHandler(
    mockReq({ user: admin, body: { requireOrgApproval: true } }),
    on,
  );
  assert.strictEqual(on.statusCode, 200, JSON.stringify(on.body));
  assert.strictEqual(on.body.data.requireOrgApproval, true);

  // The change is a supervisory one, so it has to be attributable afterwards.
  const log = await AuditLog.findOne({ action: "platform.settings_updated" });
  assert.ok(log, "platform.settings_updated is audited");
  assert.deepEqual(log.metadata, { requireOrgApproval: true });
});

test("a new organization honours requireOrgApproval when the platform has enabled it", async () => {
  await SystemSettings.deleteMany({});
  await setPlatformSettings({ requireOrgApproval: true });

  const owner = await makeUser();
  const org = await makeOrg(owner, { name: "Pending Approval Org" });
  assert.strictEqual(org.verificationStatus, "pending");

  await setPlatformSettings({ requireOrgApproval: false });
  const next = await makeOrg(owner, { name: "Self Serve Org" });
  assert.strictEqual(next.verificationStatus, "unverified");
});
