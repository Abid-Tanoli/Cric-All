// Fix B — the test-data / private-team visibility contract.
//
// Round 5 stopped Player/Team public reads from leaking private *fields*. This
// pass is about leaking whole *rows*: a fixture team whose name carries a
// reserved prefix (OPENCODE_TEST_, E2E_, TEST_, …), and a real organization team
// its owner has hidden with `isPublic: false`, must not appear on any public
// list or be addressable by id to anyone who could not have found it.
//
// The tests below pin the contract end to end:
//   * a reserved-name team is invisible to the public catalogue and to ?search=;
//   * a private team is invisible to a stranger even when they name its org;
//   * the owning organization's managers and platform admins stay entitled;
//   * the visibility toggle is authorized by manage_teams and refused otherwise;
//   * a hidden team's detail and ranking reads answer 404 to a stranger.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";

import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import User from "../src/models/User.js";
import Admin from "../src/models/Admin.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import TeamOrganization from "../src/models/TeamOrganization.js";
import TeamCategory from "../src/models/TeamCategory.js";
import Membership from "../src/models/Membership.js";
import AuditLog from "../src/models/AuditLog.js";
import { createOrganization } from "../src/controllers/organizationController.js";
import { listTeams, getTeam, toggleTeamVisibility } from "../src/controllers/teamsController.js";
import { getTeamPlayerRankings } from "../src/services/rankingService.js";

let mongod;

before(async () => {
  mongod = await startTestDb();
  // The reserved-name filter is query-only, but waiting for index init keeps the
  // per-org team-name uniqueness from racing the first inserts, as in
  // publicProjection.test.js.
  await Team.init();
});

after(async () => {
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Admin.deleteMany({}),
    Team.deleteMany({}),
    Player.deleteMany({}),
    TeamOrganization.deleteMany({}),
    TeamCategory.deleteMany({}),
    Membership.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);
  await TeamCategory.seedDefaults();
});

let counter = 0;

async function makeUser(overrides = {}) {
  counter += 1;
  return User.create({
    name: `Visibility Person ${counter}`,
    email: `vis-${counter}-${Math.random().toString(36).slice(2, 8)}@openctest.dev`,
    password: "password-123",
    role: "scorer",
    accountType: "organization_admin",
    emailVerified: true,
    ...overrides,
  });
}

async function makeAdmin() {
  counter += 1;
  return Admin.create({
    name: `Visibility Root ${counter}`,
    email: `vis-root-${counter}@openctest.dev`,
    username: `visroot${counter}`,
    password: "password-123",
    role: "superadmin",
  });
}

async function makeOrg(owner, name = "Visibility Org") {
  const res = mockRes();
  await createOrganization(mockReq({ user: owner, principalType: "user", body: { name } }), res);
  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
  return res.body.organization;
}

/** A membership that grants `manage_teams` for the organization. */
async function addMember(user, org, roles = ["owner"]) {
  return Membership.create({
    organization: org._id,
    user: user._id,
    roles,
    status: "active",
    source: "direct",
  });
}

const anon = (overrides = {}) => mockReq({ query: {}, params: {}, ...overrides });
const named = (team) => ({ query: {}, params: { id: String(team._id) } });

// ---------------------------------------------------------------------------
// Reserved-name fixtures
// ---------------------------------------------------------------------------

test("a reserved-name team is hidden from the public list, search and detail reads", async () => {
  counter += 1;
  const fixtureName = `E2E_Leaky_XI_${counter}`;
  const fixture = await Team.create({ name: fixtureName, isPublic: true });

  const listed = mockRes();
  await listTeams(anon(), listed);
  assert.ok(
    !listed.body.some((t) => t.name === fixtureName),
    "a reserved-name team is absent from the anonymous catalogue",
  );

  const searched = mockRes();
  await listTeams(anon({ query: { search: "E2E_Leaky" } }), searched);
  assert.ok(
    !searched.body.some((t) => t.name === fixtureName),
    "searching its name does not surface a reserved fixture",
  );

  const stranger = await makeUser();

  const byId = mockRes();
  await getTeam(anon(named(fixture)), byId);
  assert.strictEqual(byId.statusCode, 404, "a reserved fixture is not addressable by an anonymous id read");

  const byAuthStranger = mockRes();
  await getTeam(mockReq({ user: stranger, principalType: "user", ...named(fixture) }), byAuthStranger);
  assert.strictEqual(byAuthStranger.statusCode, 404, "an authenticated stranger gets the same 404");

  // The platform admin app still needs to see and open fixtures to debug them.
  const admin = await makeAdmin();
  const adminList = mockRes();
  await listTeams(mockReq({ user: admin, principalType: "admin", query: {} }), adminList);
  assert.ok(
    adminList.body.some((t) => t.name === fixtureName),
    "a platform admin still sees the fixture in the catalogue",
  );

  const adminById = mockRes();
  await getTeam(mockReq({ user: admin, principalType: "admin", ...named(fixture) }), adminById);
  assert.strictEqual(adminById.statusCode, 200, "a platform admin can still open the fixture by id");
});

// ---------------------------------------------------------------------------
// Private real teams
// ---------------------------------------------------------------------------

test("a private team is invisible to a stranger but reachable by its own manager", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, "Hidden Squad Org");

  counter += 1;
  const team = await Team.create({
    name: `Hidden XI ${counter}`,
    organizationRef: org._id,
    isPublic: false,
  });

  const listed = mockRes();
  await listTeams(anon(), listed);
  assert.ok(!listed.body.some((t) => t.name === team.name), "a private team is not in the public list");

  // Naming the organization is not a licence to see its private teams.
  const byOrg = mockRes();
  await listTeams(anon({ query: { organizationRef: String(org._id) } }), byOrg);
  assert.ok(
    !byOrg.body.some((t) => t.name === team.name),
    "naming the organization does not reveal a private team to a stranger",
  );

  const strangerById = mockRes();
  await getTeam(anon(named(team)), strangerById);
  assert.strictEqual(strangerById.statusCode, 404, "a private team is not addressable by an anonymous id read");

  const managerById = mockRes();
  await getTeam(mockReq({ user: owner, principalType: "user", ...named(team) }), managerById);
  assert.strictEqual(managerById.statusCode, 200, "the owning organization's manager still reads the team");
  assert.strictEqual(managerById.body.data.team.name, team.name);
});

test("a hidden team's ranking board answers null (route turns that into 404)", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, "Hidden Ranking Org");

  counter += 1;
  const team = await Team.create({
    name: `Hidden Ranking XI ${counter}`,
    organizationRef: org._id,
    isPublic: false,
  });
  await Player.create({ name: `Hidden Ranked Player ${counter}`, team: team._id });

  assert.strictEqual(
    await getTeamPlayerRankings(String(team._id), null),
    null,
    "a hidden team's ranking board is null for a viewer who could not have found it",
  );
});

// ---------------------------------------------------------------------------
// The visibility toggle
// ---------------------------------------------------------------------------

test("a manager with manage_teams can hide and re-publish a team", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, "Toggle Org");

  counter += 1;
  const team = await Team.create({ name: `Toggle XI ${counter}`, organizationRef: org._id });
  assert.strictEqual(team.isPublic, true, "a new team starts public");

  const hidden = mockRes();
  await toggleTeamVisibility(mockReq({ user: owner, principalType: "user", ...named(team) }), hidden);
  assert.strictEqual(hidden.statusCode, 200, JSON.stringify(hidden.body));
  assert.strictEqual(hidden.body.isPublic, false, "the toggle returns the new value");
  assert.strictEqual((await Team.findById(team._id)).isPublic, false, "the change is persisted");

  const republished = mockRes();
  await toggleTeamVisibility(mockReq({ user: owner, principalType: "user", ...named(team) }), republished);
  assert.strictEqual(republished.body.isPublic, true, "toggling again re-publishes");
  assert.strictEqual((await Team.findById(team._id)).isPublic, true);

  const audit = await AuditLog.findOne({ action: "team.visibility_changed" });
  assert.ok(audit, "every visibility change is audited");
  assert.strictEqual(audit.targetId.toString(), String(team._id));
});

test("a stranger and a mere member cannot change visibility", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, "Guarded Toggle Org");

  const player = await makeUser();
  await addMember(player, org, ["player"]);

  const stranger = await makeUser();

  counter += 1;
  const team = await Team.create({ name: `Guarded Toggle XI ${counter}`, organizationRef: org._id });

  for (const [label, actor] of [
    ["a non-member", stranger],
    ["a member without manage_teams", player],
  ]) {
    const res = mockRes();
    await toggleTeamVisibility(mockReq({ user: actor, principalType: "user", ...named(team) }), res);
    assert.strictEqual(res.statusCode, 403, `${label} must be refused`);
  }
  assert.strictEqual((await Team.findById(team._id)).isPublic, true, "a refused toggle changed nothing");
});

test("a platform admin can change visibility and an unknown id is a 404", async () => {
  const admin = await makeAdmin();
  const owner = await makeUser();
  const org = await makeOrg(owner, "Admin Toggle Org");

  counter += 1;
  const team = await Team.create({ name: `Admin Toggle XI ${counter}`, organizationRef: org._id });

  const res = mockRes();
  await toggleTeamVisibility(mockReq({ user: admin, principalType: "admin", ...named(team) }), res);
  assert.strictEqual(res.statusCode, 200, "a platform admin may toggle any team");
  assert.strictEqual(res.body.isPublic, false);

  const missing = mockRes();
  await toggleTeamVisibility(
    mockReq({ user: admin, principalType: "admin", params: { id: "507f1f77bcf86cd799439011" }, query: {} }),
    missing,
  );
  assert.strictEqual(missing.statusCode, 404, "an unknown team id is a 404, not a 403");
});

// ---------------------------------------------------------------------------
// Edge: an org-less private team never slips into the public catalogue
// ---------------------------------------------------------------------------

test("an org-less team with isPublic false is not in the default public list", async () => {
  counter += 1;
  const name = `Orgless Private ${counter}`;
  await Team.create({ name, isPublic: false });

  const listed = mockRes();
  await listTeams(anon(), listed);
  assert.ok(!listed.body.some((t) => t.name === name), "the default catalogue honours isPublic even without an organization");

  const admin = await makeAdmin();
  const adminList = mockRes();
  await listTeams(mockReq({ user: admin, principalType: "admin", query: {} }), adminList);
  assert.ok(adminList.body.some((t) => t.name === name), "the platform admin still sees it");
});
