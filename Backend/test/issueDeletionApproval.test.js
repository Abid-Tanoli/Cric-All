import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

process.env.JWT_SECRET = process.env.JWT_SECRET || "issue-delete-approval-test-secret";

import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import TeamOrganization from "../src/models/TeamOrganization.js";
import Membership from "../src/models/Membership.js";
import User from "../src/models/User.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import Match from "../src/models/Match.js";
import Tournament from "../src/models/Tournament.js";
import Series from "../src/models/Series.js";
import Event from "../src/models/Event.js";
import IssueReport from "../src/models/IssueReport.js";
import AuditLog from "../src/models/AuditLog.js";
import Invitation from "../src/models/Invitation.js";
import {
  approveAndDeleteAdminIssue,
  getAdminIssueDeletionImpact,
} from "../src/controllers/issueReportController.js";
import { requirePlatformAdminDelete } from "../src/middleware/orgAccess.js";

// Admin approval of owner-submitted team/organization deletion requests.
// Every fixture user is freshly created with a run-scoped email so a verified
// account left over from another test can never turn a 201 into a 409.

const RUN_ID = `approve_del_${process.pid}_${Date.now().toString(36)}`;
let userSeq = 0;
let mongod;

before(async () => {
  mongod = await startTestDb();
});

after(async () => {
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Promise.all([
    TeamOrganization.deleteMany({}),
    Membership.deleteMany({}),
    User.deleteMany({}),
    Team.deleteMany({}),
    Player.deleteMany({}),
    Match.deleteMany({}),
    Tournament.deleteMany({}),
    Series.deleteMany({}),
    Event.deleteMany({}),
    IssueReport.deleteMany({}),
    AuditLog.deleteMany({}),
    Invitation.deleteMany({}),
  ]);
});

const freshUser = (label) => {
  userSeq += 1;
  return User.create({
    name: `${label} ${RUN_ID} ${userSeq}`,
    email: `approve.del.${label}.${RUN_ID}.${userSeq}@example.test`,
    emailVerified: true,
  });
};

const adminPrincipal = () => ({
  _id: new mongoose.Types.ObjectId(),
  email: `platform.${RUN_ID}@example.test`,
  username: `platform-admin-${RUN_ID}`,
  role: "admin",
});

async function fixture({ targetType = "team" } = {}) {
  const owner = await freshUser("Owner");
  const organization = await TeamOrganization.create({
    name: `Approve Org ${RUN_ID} ${userSeq}`,
    owner: owner._id,
    createdBy: owner._id,
  });
  await Membership.create({
    organization: organization._id,
    user: owner._id,
    roles: ["owner"],
    status: "active",
  });

  let team = null;
  let targetId = organization._id;
  if (targetType === "team") {
    team = await Team.create({
      name: `Approve Team ${RUN_ID} ${userSeq}`,
      organizationRef: organization._id,
      isPublic: true,
    });
    targetId = team._id;
  }

  const report = await IssueReport.create({
    organization: organization._id,
    reporter: owner._id,
    type: "deletion_request",
    subject: `Delete ${targetType} ${RUN_ID}`,
    description: "Owner asked the platform admin to remove this duplicate.",
    targetType,
    targetId,
  });

  return { owner, organization, team, report, admin: adminPrincipal() };
}

const call = async (handler, principal, params, body = {}) => {
  const res = mockRes();
  await handler(mockReq({ params, body, user: principal, principalType: "admin" }), res);
  return res;
};

test("an organization owner still gets ADMIN_ONLY_DELETE for a direct team/org delete", async () => {
  const { owner, organization, team } = await fixture();

  for (const params of [
    { id: String(organization._id) },
    { orgId: String(organization._id), teamId: String(team._id) },
  ]) {
    const res = mockRes();
    let nextCalled = false;
    requirePlatformAdminDelete(
      mockReq({ params, user: owner, principalType: "user" }),
      res,
      () => { nextCalled = true; },
    );
    assert.equal(nextCalled, false, "the delete controller must not be reached");
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, "ADMIN_ONLY_DELETE");
  }
});

test("admin approves a team request: typed name, impact, audit and resolved report", async () => {
  const { organization, team, report, admin } = await fixture();
  const player = await Player.create({
    name: `Team Member ${RUN_ID}`,
    team: team._id,
    isPublic: true,
  });
  const params = { issueId: String(report._id) };

  const impactRes = await call(getAdminIssueDeletionImpact, admin, params);
  assert.equal(impactRes.statusCode, 200);
  assert.equal(impactRes.body.target.entityType, "team");
  assert.equal(impactRes.body.target.name, team.name);
  assert.equal(impactRes.body.impact.players, 1);
  assert.deepEqual(impactRes.body.impact.blockers, []);

  const missingName = await call(approveAndDeleteAdminIssue, admin, params);
  assert.equal(missingName.statusCode, 400);
  assert.equal(missingName.body.code, "ISSUE_DELETE_CONFIRMATION_REQUIRED");

  const wrongName = await call(approveAndDeleteAdminIssue, admin, params, { confirmName: "Some Other Team" });
  assert.equal(wrongName.statusCode, 400);
  assert.equal(wrongName.body.code, "ISSUE_DELETE_CONFIRMATION_MISMATCH");

  const approved = await call(approveAndDeleteAdminIssue, admin, params, { confirmName: team.name });
  assert.equal(approved.statusCode, 200);
  assert.equal(await Team.exists({ _id: team._id }), null);
  const unlinked = await Player.findById(player._id);
  assert.ok(!unlinked?.team, "the delete service unlinks players instead of orphaning them");

  const resolved = await IssueReport.findById(report._id);
  assert.equal(resolved.status, "resolved");
  assert.equal(String(resolved.resolvedBy), String(admin._id));
  assert.equal(resolved.statusHistory.at(-1).status, "resolved");

  const audit = await AuditLog.findOne({ action: "issue.deletion_approved" });
  assert.ok(audit, "an approval audit entry was written");
  assert.equal(audit.actorType, "admin");
  assert.equal(audit.targetType, "team");
  assert.equal(String(audit.targetId), String(team._id));
  assert.equal(audit.metadata.issueReportId, String(report._id));
  assert.equal(audit.metadata.approvedBy, admin.username);
  assert.equal(await TeamOrganization.exists({ _id: organization._id }) !== null, true);
});

test("admin refuses a team with linked matches and records no deletion", async () => {
  const { organization, team, report, admin } = await fixture();
  await Match.create({
    title: `Linked Fixture ${RUN_ID}`,
    teams: [team._id],
    organizationRef: organization._id,
    status: "upcoming",
    innings: [{ team: team._id, status: "upcoming" }],
  });
  const params = { issueId: String(report._id) };

  const res = await call(approveAndDeleteAdminIssue, admin, params, { confirmName: team.name });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "ISSUE_DELETE_LINKED_DATA");
  assert.equal(res.body.impact.matches, 1);
  assert.ok(res.body.impact.blockers.some((blocker) => /linked match/i.test(blocker)));

  assert.ok(await Team.exists({ _id: team._id }), "the blocked team was not deleted");
  const untouched = await IssueReport.findById(report._id);
  assert.equal(untouched.status, "open");
  assert.equal(await AuditLog.countDocuments({ action: "issue.deletion_approved" }), 0);
});

test("admin approves an organization request and resolves it without leaving branches", async () => {
  const { organization, report, admin } = await fixture({ targetType: "other" });
  const params = { issueId: String(report._id) };

  const impactRes = await call(getAdminIssueDeletionImpact, admin, params);
  assert.equal(impactRes.statusCode, 200);
  assert.equal(impactRes.body.target.entityType, "organization");
  assert.equal(impactRes.body.target.name, organization.name);
  assert.equal(impactRes.body.impact.memberships, 1);
  assert.deepEqual(impactRes.body.impact.blockers, []);

  const approved = await call(approveAndDeleteAdminIssue, admin, params, { confirmName: organization.name });
  assert.equal(approved.statusCode, 200);
  assert.equal(await TeamOrganization.exists({ _id: organization._id }), null);
  assert.equal(await Membership.countDocuments({ organization: organization._id }), 0);

  const resolved = await IssueReport.findById(report._id);
  assert.equal(resolved.status, "resolved");
  assert.equal(String(resolved.resolvedBy), String(admin._id));

  const approvalAudit = await AuditLog.findOne({ action: "issue.deletion_approved" });
  assert.ok(approvalAudit);
  assert.equal(approvalAudit.targetType, "organization");
  assert.equal(await AuditLog.countDocuments({ action: "org.deleted" }), 1, "the existing cascade stays audited");
});
