import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";
process.env.FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import User from "../src/models/User.js";
import TeamOrganization from "../src/models/TeamOrganization.js";
import Membership from "../src/models/Membership.js";
import Invitation, { hashInvitationToken } from "../src/models/Invitation.js";
import AuditLog from "../src/models/AuditLog.js";
import SystemSettings from "../src/models/SystemSettings.js";
import { createOrganization } from "../src/controllers/organizationController.js";
import {
  acceptOrgInvitation,
  addOrgMember,
  createOrgInvitation,
  listMyInvitations,
  previewInvitation,
  revokeOrgInvitation,
} from "../src/controllers/membershipController.js";
import { deleteUserAccount } from "../src/services/accountDeletionService.js";
import { createInvitationSchema } from "../src/validators/orgValidators.js";
import { normalizePhone } from "../src/utils/phone.js";

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

const orgAccess = { via: "membership", roles: ["owner"], permissions: [] };

let counter = 0;

/** An account identified by email — the shape every pre-Fix-A invite assumed. */
async function makeEmailUser(overrides = {}) {
  counter += 1;
  return User.create({
    name: `Email Person ${counter}`,
    email: `person-${counter}@openctest.dev`,
    password: "password-123",
    role: "viewer",
    accountType: "viewer",
    emailVerified: true,
    ...overrides,
  });
}

/** A phone-only account: no email at all, which is the whole point of Fix A. */
async function makePhoneUser({ phone, phoneVerified = true, ...overrides } = {}) {
  counter += 1;
  return User.create({
    name: `Phone Person ${counter}`,
    phone,
    phoneVerified,
    password: "password-123",
    role: "viewer",
    accountType: "viewer",
    ...overrides,
  });
}

async function makeOwner() {
  counter += 1;
  return User.create({
    name: `Owner ${counter}`,
    email: `owner-${counter}@openctest.dev`,
    password: "password-123",
    role: "scorer",
    accountType: "organization_admin",
    emailVerified: true,
  });
}

async function makeOrg(owner, overrides = {}) {
  const res = mockRes();
  await createOrganization(
    mockReq({ user: owner, principalType: "user", body: { name: "Test Org", ...overrides } }),
    res,
  );
  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
  return res.body.organization;
}

async function invite(owner, org, body) {
  const res = mockRes();
  await createOrgInvitation(
    mockReq({ user: owner, principalType: "user", params: { id: String(org._id) }, body, org: await TeamOrganization.findById(org._id), orgAccess }),
    res,
  );
  return res;
}

/** Give a pending invitation a raw token the test can present. */
async function armToken(filter, rawToken = "c".repeat(64)) {
  await Invitation.updateOne(filter, { $set: { tokenHash: hashInvitationToken(rawToken) } });
  return rawToken;
}

// ---------------------------------------------------------------------------
// Addressing and validation
// ---------------------------------------------------------------------------
test("validators accept email-only and phone-only, and reject a request with neither", () => {
  assert.equal(createInvitationSchema.safeParse({ email: "a@b.com", roles: ["player"] }).success, true);
  assert.equal(createInvitationSchema.safeParse({ phone: "0300 1234567", roles: ["player"] }).success, true);
  assert.equal(createInvitationSchema.safeParse({ roles: ["player"] }).success, false, "neither address is a 400");
  assert.equal(createInvitationSchema.safeParse({ email: "", phone: "", roles: ["player"] }).success, false);
  assert.equal(createInvitationSchema.safeParse({ phone: "not-a-number" }).success, false, "garbage phone is a 400");
  assert.equal(createInvitationSchema.safeParse({ email: "also not an email" }).success, false);
});

test("a phone-only account can be invited, sees the invitation only once the phone is verified, and accepts with the right role", async () => {
  const owner = await makeOwner();
  const org = await makeOrg(owner, { name: "Phone Invite Org" });
  const invitee = await makePhoneUser({ phone: "0300 1234567", phoneVerified: false });

  const created = await invite(owner, org, { phone: "0300 1234567", roles: ["score_handler"], message: "Join us" });
  assert.strictEqual(created.statusCode, 201, JSON.stringify(created.body));
  assert.strictEqual(created.body.channel, "phone");
  assert.strictEqual(created.body.smsDelivered, true, "the console SMS driver reports delivery in dev");
  assert.strictEqual(created.body.invitation.tokenHash, undefined, "raw hash never leaves the server");

  const stored = await Invitation.findOne({ organization: org._id, status: "pending" });
  assert.equal(stored.email, "", "a phone-only invitation carries no email");
  assert.equal(stored.phone, normalizePhone("0300 1234567"));
  const rawToken = await armToken({ _id: stored._id });

  // Not visible, not acceptable until the phone on the account is verified.
  const inboxBefore = mockRes();
  await listMyInvitations(mockReq({ user: await User.findById(invitee._id) }), inboxBefore);
  assert.deepEqual(inboxBefore.body, [], "an unverified phone sees no invitations");

  const previewBefore = mockRes();
  await previewInvitation(mockReq({ user: await User.findById(invitee._id), params: { token: rawToken } }), previewBefore);
  assert.strictEqual(previewBefore.statusCode, 200);
  assert.strictEqual(previewBefore.body.forAccount, true, "it IS this account's invitation");
  assert.strictEqual(previewBefore.body.channel, "phone");
  assert.strictEqual(previewBefore.body.emailVerified, false, "but the phone is not verified yet");

  const acceptBefore = mockRes();
  await acceptOrgInvitation(mockReq({ user: await User.findById(invitee._id), body: { token: rawToken } }), acceptBefore);
  assert.strictEqual(acceptBefore.statusCode, 403);
  assert.strictEqual(acceptBefore.body.code, "EMAIL_NOT_VERIFIED");

  // Verify the phone (what OTP verification does in production).
  await User.updateOne({ _id: invitee._id }, { $set: { phoneVerified: true, phoneVerifiedAt: new Date() } });

  const inboxAfter = mockRes();
  await listMyInvitations(mockReq({ user: await User.findById(invitee._id) }), inboxAfter);
  assert.strictEqual(inboxAfter.body.length, 1, "the invitation appears once the phone is verified");
  assert.strictEqual(inboxAfter.body[0].channel, "phone");
  assert.strictEqual(inboxAfter.body[0].addressedTo, "+923001234567");

  const accept = mockRes();
  await acceptOrgInvitation(mockReq({ user: await User.findById(invitee._id), body: { token: rawToken } }), accept);
  assert.strictEqual(accept.statusCode, 200, JSON.stringify(accept.body));

  const membership = await Membership.findOne({ organization: org._id, user: invitee._id });
  assert.strictEqual(membership.status, "active");
  assert.deepEqual(membership.roles, ["score_handler"]);

  assert.equal((await Invitation.findById(stored._id)).status, "accepted");
});

test("a different account cannot accept somebody else's phone invitation", async () => {
  const owner = await makeOwner();
  const org = await makeOrg(owner, { name: "Wrong Account Org" });
  const invitee = await makePhoneUser({ phone: "0300 1111111" });
  const stranger = await makePhoneUser({ phone: "0300 9999999" });

  const created = await invite(owner, org, { phone: "0300 1111111", roles: ["player"] });
  assert.strictEqual(created.statusCode, 201, JSON.stringify(created.body));
  const rawToken = await armToken({ organization: org._id, status: "pending" });

  const res = mockRes();
  await acceptOrgInvitation(mockReq({ user: stranger, body: { token: rawToken } }), res);
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.code, "INVITATION_PHONE_MISMATCH");

  // The inbox never shows it either — visibility and acceptance share the rule.
  const inbox = mockRes();
  await listMyInvitations(mockReq({ user: stranger }), inbox);
  assert.deepEqual(inbox.body, []);

  assert.equal(await Membership.countDocuments({ organization: org._id, user: stranger._id }), 0);
  assert.equal((await Invitation.findOne({ organization: org._id })).status, "pending");
});

test("the same number written three different ways refreshes one pending invitation", async () => {
  const owner = await makeOwner();
  const org = await makeOrg(owner, { name: "Refresh Org" });
  await makePhoneUser({ phone: "923001234567" });

  const first = await invite(owner, org, { phone: "0300-1234567", roles: ["player"] });
  const second = await invite(owner, org, { phone: "+92 300 1234567", roles: ["coach"] });
  const third = await invite(owner, org, { phone: "923001234567", roles: ["player"] });

  assert.strictEqual(first.statusCode, 201, JSON.stringify(first.body));
  assert.strictEqual(second.statusCode, 201, JSON.stringify(second.body));
  assert.strictEqual(third.statusCode, 201, JSON.stringify(third.body));

  assert.strictEqual(await Invitation.countDocuments({ organization: org._id, status: "pending" }), 1);
  // The body carries an ObjectId, so compare the serialized ids.
  assert.strictEqual(String(second.body.invitation._id), String(first.body.invitation._id), "re-invite refreshes the same row");
  assert.strictEqual(String(third.body.invitation._id), String(first.body.invitation._id));
  assert.deepEqual((await Invitation.findById(first.body.invitation._id)).roles, ["player"], "the latest roles win");
});

test("an email invitation stays invisible to an account that has only verified its phone", async () => {
  const owner = await makeOwner();
  const org = await makeOrg(owner, { name: "Email Gate Org" });
  const halfVerified = await makeEmailUser({ emailVerified: false, phoneVerified: true, phone: "923005555555" });
  const fullyVerified = await makeEmailUser();

  const created = await invite(owner, org, { email: halfVerified.email, roles: ["score_handler"] });
  assert.strictEqual(created.statusCode, 201, JSON.stringify(created.body));
  assert.strictEqual(created.body.channel, "email");
  const rawToken = await armToken({ organization: org._id, status: "pending" });

  const inbox = mockRes();
  await listMyInvitations(mockReq({ user: halfVerified }), inbox);
  assert.deepEqual(inbox.body, [], "a verified phone does not open an email invitation");

  const accept = mockRes();
  await acceptOrgInvitation(mockReq({ user: halfVerified, body: { token: rawToken } }), accept);
  assert.strictEqual(accept.statusCode, 403);
  assert.strictEqual(accept.body.code, "EMAIL_NOT_VERIFIED");

  // With the email verified the very same invitation opens, exactly as before.
  await User.updateOne({ _id: halfVerified._id }, { $set: { emailVerified: true } });
  const inbox2 = mockRes();
  await listMyInvitations(mockReq({ user: await User.findById(halfVerified._id) }), inbox2);
  assert.strictEqual(inbox2.body.length, 1);
  assert.strictEqual(inbox2.body[0].channel, "email");

  const accept2 = mockRes();
  await acceptOrgInvitation(mockReq({ user: await User.findById(halfVerified._id), body: { token: rawToken } }), accept2);
  assert.strictEqual(accept2.statusCode, 200, JSON.stringify(accept2.body));
  assert.deepEqual(accept2.body.member.roles, ["score_handler"]);

  // A third account with no relationship to the address still cannot accept.
  const strangerRes = mockRes();
  await acceptOrgInvitation(mockReq({ user: fullyVerified, body: { token: rawToken } }), strangerRes);
  assert.strictEqual(strangerRes.statusCode, 410, "the token is already spent");
});

// ---------------------------------------------------------------------------
// ALREADY_MEMBER, owner role, tenant scoping
// ---------------------------------------------------------------------------
test("ALREADY_MEMBER also fires when the existing member was found by phone", async () => {
  const owner = await makeOwner();
  const org = await makeOrg(owner, { name: "Already Member Org" });
  const existing = await makePhoneUser({ phone: "0300 7777777" });

  const added = mockRes();
  await addOrgMember(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id) },
      body: { phone: "0300 7777777", roles: ["player"] },
      org: await TeamOrganization.findById(org._id),
      orgAccess,
    }),
    added,
  );
  assert.strictEqual(added.statusCode, 201, JSON.stringify(added.body));

  const created = await invite(owner, org, { phone: "+92 300 7777777", roles: ["coach"] });
  assert.strictEqual(created.statusCode, 409);
  assert.strictEqual(created.body.code, "ALREADY_MEMBER");
  assert.equal(await Invitation.countDocuments({ organization: org._id }), 0, "no invitation row is created");
  assert.ok(await Membership.findOne({ organization: org._id, user: existing._id }));
});

test("the owner role still cannot be granted by invitation, by phone or by email", async () => {
  const owner = await makeOwner();
  const org = await makeOrg(owner, { name: "No Owner Invite Org" });

  const byPhone = await invite(owner, org, { phone: "0300 4444444", roles: ["owner"] });
  assert.strictEqual(byPhone.statusCode, 403);
  assert.strictEqual(byPhone.body.code, "PRIVILEGED_ROLE_FORBIDDEN");

  const byEmail = await invite(owner, org, { email: "nobody@openctest.dev", roles: ["owner"] });
  assert.strictEqual(byEmail.statusCode, 403);
  assert.strictEqual(byEmail.body.code, "PRIVILEGED_ROLE_FORBIDDEN");

  assert.equal(await Invitation.countDocuments({ organization: org._id }), 0);
});

test("an invitation cannot be revoked through a different organization's route", async () => {
  const ownerA = await makeOwner();
  const ownerB = await makeOwner();
  const orgA = await makeOrg(ownerA, { name: "Tenant A" });
  const orgB = await makeOrg(ownerB, { name: "Tenant B" });

  const created = await invite(ownerA, orgA, { phone: "0300 6666666", roles: ["player"] });
  assert.strictEqual(created.statusCode, 201, JSON.stringify(created.body));
  const invitationId = String(created.body.invitation._id);

  const res = mockRes();
  await revokeOrgInvitation(
    mockReq({
      user: ownerB,
      principalType: "user",
      params: { id: String(orgB._id), invitationId },
      org: await TeamOrganization.findById(orgB._id),
    }),
    res,
  );
  assert.strictEqual(res.statusCode, 404, "org B has no such invitation");
  assert.strictEqual((await Invitation.findById(invitationId)).status, "pending");
});

// ---------------------------------------------------------------------------
// Delivery reporting and account deletion
// ---------------------------------------------------------------------------
test("the response says nothing about whether the number already has an account", async () => {
  const owner = await makeOwner();
  const org = await makeOrg(owner, { name: "Leak Check Org" });

  // Phone with NO account behind it…
  const noAccount = await invite(owner, org, { phone: "0300 2000001", roles: ["player"] });
  // …and a phone whose owner has a verified email on a separate account.
  await makePhoneUser({ phone: "0300 2000002", email: "hasmail@openctest.dev", emailVerified: true });
  const withAccount = await invite(owner, org, { phone: "0300 2000002", roles: ["player"] });

  assert.strictEqual(noAccount.statusCode, 201);
  assert.strictEqual(withAccount.statusCode, 201);
  assert.strictEqual(noAccount.body.mailDelivered, false, "no caller-supplied email means no email answer");
  assert.strictEqual(withAccount.body.mailDelivered, false, "the account's own email is never reported back");
  assert.strictEqual(noAccount.body.smsDelivered, withAccount.body.smsDelivered, "identical answers either way");
  assert.strictEqual(noAccount.body.delivered, withAccount.body.delivered);
  // Only the phone number itself (which the caller typed) may appear in the
  // wording — nothing about accounts, mailboxes or verification state.
  for (const body of [noAccount.body, withAccount.body]) {
    assert.match(body.message, /^Invitation sent to \+\d{7,15}\.$/);
    assert.doesNotMatch(body.message, /mail|account|verified/i);
  }
});

test("deleting an account removes the invitations addressed to its phone", async () => {
  const owner = await makeOwner();
  const org = await makeOrg(owner, { name: "Deletion Org" });
  const invitee = await makePhoneUser({ phone: "0300 3000001" });

  const created = await invite(owner, org, { phone: "0300 3000001", roles: ["player"] });
  assert.strictEqual(created.statusCode, 201, JSON.stringify(created.body));
  const id = String(created.body.invitation._id);

  const cleanup = await deleteUserAccount(String(invitee._id), { email: "", phone: invitee.phone });
  assert.strictEqual(cleanup.cleanup.invitations, 1, "the phone-addressed invitation is cascaded away");
  assert.equal(await Invitation.findById(id), null);
  assert.equal(await User.findById(invitee._id), null);
});

test("invitations are addressed to an email when the inviter supplies one", async () => {
  const owner = await makeOwner();
  const org = await makeOrg(owner, { name: "Plain Email Org" });

  const created = await invite(owner, org, { email: "someone@openctest.dev", roles: ["player"] });
  assert.strictEqual(created.statusCode, 201, JSON.stringify(created.body));
  assert.strictEqual(created.body.channel, "email");
  assert.strictEqual(created.body.invitation.phone, "");
  assert.strictEqual(created.body.invitation.email, "someone@openctest.dev");
  assert.strictEqual(created.body.delivered, true, "the console mail driver reports delivery in dev");
});
