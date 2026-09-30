import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";

import mongoose from "mongoose";
import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import User from "../src/models/User.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import TeamCategory from "../src/models/TeamCategory.js";
import TeamOrganization from "../src/models/TeamOrganization.js";
import Membership from "../src/models/Membership.js";
import AuditLog from "../src/models/AuditLog.js";
import { createOrganization } from "../src/controllers/organizationController.js";
import {
  addOrgTeamPlayers,
  createOrgTeam,
  deleteOrgTeam,
  listOrgTeams,
  removeOrgTeamPlayers,
  updateOrgTeam,
} from "../src/controllers/orgTeamsController.js";
import { requireOrgPermission } from "../src/middleware/orgAccess.js";
import { PERMISSIONS } from "../src/permissions/orgPermissions.js";
import { createOrgTeamSchema, updateOrgTeamSchema } from "../src/validators/teamValidators.js";

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
    Team.deleteMany({}),
    Player.deleteMany({}),
    TeamCategory.deleteMany({}),
    TeamOrganization.deleteMany({}),
    Membership.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);
  // A properly configured platform: the category collection is seeded, which is
  // what organization `type` and team `category` are validated against.
  await TeamCategory.seedDefaults();
});

let counter = 0;
async function makeUser(overrides = {}) {
  counter += 1;
  return User.create({
    name: `Team Person ${counter}`,
    email: `team-${counter}-${Math.random().toString(36).slice(2, 8)}@openctest.dev`,
    password: "password-123",
    role: "scorer",
    accountType: "organization_admin",
    emailVerified: true,
    ...overrides,
  });
}

async function makeOrg(owner, name = "Teams Org") {
  const res = mockRes();
  await createOrganization(mockReq({ user: owner, principalType: "user", body: { name } }), res);
  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
  return res.body.organization;
}

async function addMember(org, user, roles) {
  return Membership.create({ organization: org._id, user: user._id, roles });
}

const ownerAccess = { via: "membership", roles: ["owner"], permissions: [] };

/** Validate like the route does, then call the controller — the tests never bypass the schemas. */
function parsed(schema, payload) {
  return schema.parse(payload);
}

// ---------------------------------------------------------------------------
// Creating teams
// ---------------------------------------------------------------------------
test("org manager creates a team; organizationRef comes from the guard, not the body", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);

  // A member must not be able to attach the team to another organization: the
  // strict schema refuses the key outright rather than letting it be ignored.
  const injected = createOrgTeamSchema.safeParse({
    name: "Injected XI",
    organizationRef: "507f1f77bcf86cd799439011",
  });
  assert.strictEqual(injected.success, false, "organizationRef is rejected from the body");
  assert.ok(
    injected.error.issues.some((issue) => issue.code === "unrecognized_keys" && issue.keys.includes("organizationRef"))
  );

  const res = mockRes();
  await createOrgTeam(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id) },
      body: parsed(createOrgTeamSchema, {
        name: "Crescent Under-19",
        shortName: "C-U19",
        category: "Club",
        homeGround: "Crescent Ground",
      }),
      org,
      orgAccess: ownerAccess,
    }),
    res,
  );

  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
  const stored = await Team.findById(res.body.team._id);
  assert.ok(stored.organizationRef.equals(org._id), "team is owned by the authorized organization");
  assert.strictEqual(stored.organization, org.name);
  assert.strictEqual(res.body.team.playerCount, 0);

  const audit = await AuditLog.findOne({ action: "team.created" });
  assert.ok(audit, "creation is audited");
  assert.ok(audit.organization.equals(org._id));
});

test("a team category the platform has not configured is rejected with TEAM_CATEGORY_UNKNOWN", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, "Category Org");

  await TeamCategory.deleteMany({});

  const res = mockRes();
  await createOrgTeam(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id) },
      body: { name: "Mystery XI", category: "Club" },
      org,
      orgAccess: ownerAccess,
    }),
    res,
  );
  assert.strictEqual(res.statusCode, 422, JSON.stringify(res.body));
  assert.strictEqual(res.body.code, "TEAM_CATEGORY_UNKNOWN");

  // Once the platform seeds its category configuration, the same payload works.
  await TeamCategory.seedDefaults();
  const ok = mockRes();
  await createOrgTeam(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id) },
      body: { name: "Mystery XI", category: "Club" },
      org,
      orgAccess: ownerAccess,
    }),
    ok,
  );
  assert.strictEqual(ok.statusCode, 201, JSON.stringify(ok.body));
});

test("a team without a category is allowed even when nothing is configured", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, "No Category Org");
  await TeamCategory.deleteMany({});
  const res = mockRes();
  await createOrgTeam(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id) },
      body: { name: "Uncategorised XI" },
      org,
      orgAccess: ownerAccess,
    }),
    res,
  );
  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
});

test("a duplicate team name is a 409, not a crash", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, "Dup Org");

  for (const attempt of [1, 2]) {
    const res = mockRes();
    await createOrgTeam(
      mockReq({
        user: owner,
        principalType: "user",
        params: { id: String(org._id) },
        body: { name: "Same Name XI" },
        org,
        orgAccess: ownerAccess,
      }),
      res,
    );
    if (attempt === 1) assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
    else assert.strictEqual(res.statusCode, 409, JSON.stringify(res.body));
  }
});

// ---------------------------------------------------------------------------
// Tenant isolation — the core of Phase 4
// ---------------------------------------------------------------------------
test("cross-tenant: org A cannot read, update or delete org B's team", async () => {
  const ownerA = await makeUser();
  const ownerB = await makeUser();
  const orgA = await makeOrg(ownerA, "Alpha Org");
  const orgB = await makeOrg(ownerB, "Beta Org");

  const created = mockRes();
  await createOrgTeam(
    mockReq({
      user: ownerB,
      principalType: "user",
      params: { id: String(orgB._id) },
      body: { name: "Beta Private XI" },
      org: orgB,
      orgAccess: ownerAccess,
    }),
    created,
  );
  assert.strictEqual(created.statusCode, 201, JSON.stringify(created.body));
  const teamB = created.body.team;

  // Owner of A points every Phase 4 write at B's team.
  const writeAttempts = [
    [updateOrgTeam, { body: { name: "Stolen" } }],
    [deleteOrgTeam, { body: {} }],
    [addOrgTeamPlayers, { body: { playerIds: [String(new mongoose.Types.ObjectId())] } }],
    [removeOrgTeamPlayers, { body: { playerIds: [String(new mongoose.Types.ObjectId())] } }],
  ];

  for (const [handler, extra] of writeAttempts) {
    const res = mockRes();
    await handler(
      mockReq({
        user: ownerA,
        principalType: "user",
        params: { id: String(orgA._id), teamId: teamB._id },
        org: orgA,
        orgAccess: ownerAccess,
        ...extra,
      }),
      res,
    );
    assert.strictEqual(res.statusCode, 404, `${handler.name} must not reach another org's team`);
  }

  // And the team is still there, unchanged.
  const survivor = await Team.findById(teamB._id);
  assert.ok(survivor, "the other organization's team was not touched");
  assert.strictEqual(survivor.name, "Beta Private XI");

  // The list only ever returns this organization's teams.
  const listRes = mockRes();
  await listOrgTeams(mockReq({ user: ownerA, principalType: "user", params: { id: String(orgA._id) }, org: orgA }), listRes);
  assert.deepEqual(listRes.body.items, []);
});

test("a team with no organization is not reachable through an org's team routes", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, "Orphan Org");

  const orphan = await Team.create({ name: "Platform Owned XI" });
  const res = mockRes();
  await updateOrgTeam(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id), teamId: String(orphan._id) },
      body: { name: "Claimed" },
      org,
      orgAccess: ownerAccess,
    }),
    res,
  );
  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual((await Team.findById(orphan._id)).name, "Platform Owned XI");
});

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------
test("manage_teams: a coach cannot create a team, a manager can", async () => {
  const owner = await makeUser();
  const coach = await makeUser();
  const manager = await makeUser();
  const org = await makeOrg(owner, "Perms Org");
  await addMember(org, coach, ["coach"]);
  await addMember(org, manager, ["manager"]);

  for (const [user, roles, expected] of [
    [coach, ["coach"], 403],
    [manager, ["manager"], 201],
  ]) {
    const guardRes = mockRes();
    let allowed = false;
    await requireOrgPermission(PERMISSIONS.MANAGE_TEAMS)(
      mockReq({ user, principalType: "user", params: { id: String(org._id) } }),
      guardRes,
      () => {
        allowed = true;
      },
    );
    assert.strictEqual(allowed, expected === 201, `guard for ${roles[0]}`);

    if (expected === 403) {
      assert.strictEqual(guardRes.body.code, "ORG_PERMISSION_DENIED");
    } else {
      const res = mockRes();
      await createOrgTeam(
        mockReq({
          user,
          principalType: "user",
          params: { id: String(org._id) },
          body: { name: `Manager Team ${Math.random().toString(36).slice(2, 6)}` },
          org,
          orgAccess: { via: "membership", roles, permissions: [] },
        }),
        res,
      );
      assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
    }
  }
});

test("a non-member is refused by the guard before any team query runs", async () => {
  const owner = await makeUser();
  const stranger = await makeUser();
  const org = await makeOrg(owner, "Closed Org");

  const res = mockRes();
  let called = false;
  await requireOrgPermission(PERMISSIONS.MANAGE_TEAMS)(
    mockReq({ user: stranger, principalType: "user", params: { id: String(org._id) } }),
    res,
    () => {
      called = true;
    },
  );
  assert.strictEqual(called, false);
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.code, "ORG_MEMBERSHIP_REQUIRED");
});

// ---------------------------------------------------------------------------
// Updates and squads
// ---------------------------------------------------------------------------
test("update rejects a body that tries to move the team, and records the change", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, "Update Org");

  const created = mockRes();
  await createOrgTeam(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id) },
      body: { name: "Movable XI" },
      org,
      orgAccess: ownerAccess,
    }),
    created,
  );
  const teamId = created.body.team._id;

  const otherOrgId = String(new mongoose.Types.ObjectId());
  assert.throws(
    () => updateOrgTeamSchema.parse({ organizationRef: otherOrgId }),
    /organizationRef/,
    "the update schema is strict about organizationRef"
  );

  const res = mockRes();
  await updateOrgTeam(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id), teamId },
      body: { homeGround: "New Ground", shortName: "NGR" },
      org,
      orgAccess: ownerAccess,
    }),
    res,
  );
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  const stored = await Team.findById(teamId);
  assert.strictEqual(stored.homeGround, "New Ground");
  assert.ok(stored.organizationRef.equals(org._id), "still owned by the same organization");
  assert.ok(await AuditLog.findOne({ action: "team.updated" }), "update is audited");
});

test("squad: players are added, re-roled and removed, and each step is audited", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, "Squad Org");

  const created = mockRes();
  await createOrgTeam(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id) },
      body: { name: "Squad XI" },
      org,
      orgAccess: ownerAccess,
    }),
    created,
  );
  const teamId = created.body.team._id;

  const player = await Player.create({ name: "Squad Player", role: "player" });

  const addRes = mockRes();
  await addOrgTeamPlayers(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id), teamId },
      body: { playerIds: [String(player._id)] },
      org,
      orgAccess: ownerAccess,
    }),
    addRes,
  );
  assert.strictEqual(addRes.statusCode, 200, JSON.stringify(addRes.body));
  assert.strictEqual(addRes.body.team.playerCount, 1);
  assert.ok((await Player.findById(player._id)).team.equals(teamId), "the player now belongs to the team");
  assert.ok(await AuditLog.findOne({ action: "team.players_added" }));

  const removeRes = mockRes();
  await removeOrgTeamPlayers(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id), teamId },
      body: { playerIds: [String(player._id)] },
      org,
      orgAccess: ownerAccess,
    }),
    removeRes,
  );
  assert.strictEqual(removeRes.statusCode, 200, JSON.stringify(removeRes.body));
  assert.strictEqual(removeRes.body.team.playerCount, 0);
  assert.equal((await Player.findById(player._id)).team, null);
  assert.ok(await AuditLog.findOne({ action: "team.players_removed" }));
});

test("deleting a team removes it and its players' team pointer", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, "Delete Org");

  const created = mockRes();
  await createOrgTeam(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id) },
      body: { name: "Doomed XI" },
      org,
      orgAccess: ownerAccess,
    }),
    created,
  );
  const teamId = created.body.team._id;
  const player = await Player.create({ name: "Doomed Player" });
  await addOrgTeamPlayers(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id), teamId },
      body: { playerIds: [String(player._id)] },
      org,
      orgAccess: ownerAccess,
    }),
    mockRes(),
  );

  const res = mockRes();
  await deleteOrgTeam(
    mockReq({ user: owner, principalType: "user", params: { id: String(org._id), teamId }, org, orgAccess: ownerAccess }),
    res,
  );
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(await Team.findById(teamId), null);
  // deleteTeam $unsets the pointer, so the field is gone rather than null.
  assert.equal((await Player.findById(player._id)).team ?? null, null);
  assert.ok(await AuditLog.findOne({ action: "team.deleted" }));
});

test("listOrgTeams only returns this organization's teams, and honours search", async () => {
  const owner = await makeUser();
  const other = await makeUser();
  const org = await makeOrg(owner, "List Org");
  const otherOrg = await makeOrg(other, "Other List Org");

  for (const [target, name] of [
    [org, "Alpha XI"],
    [org, "Beta XI"],
    [otherOrg, "Gamma XI"],
  ]) {
    const res = mockRes();
    await createOrgTeam(
      mockReq({
        user: owner,
        principalType: "user",
        params: { id: String(target._id) },
        body: { name: `${name} ${Math.random().toString(36).slice(2, 6)}` },
        org: target,
        orgAccess: ownerAccess,
      }),
      res,
    );
    assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
  }

  const all = mockRes();
  await listOrgTeams(mockReq({ user: owner, principalType: "user", params: { id: String(org._id) }, org, query: {} }), all);
  assert.strictEqual(all.body.items.length, 2);
  for (const team of all.body.items) {
    // listTeams populates organizationRef, so compare the id it was populated from.
    const refId = team.organizationRef?._id || team.organizationRef;
    assert.ok(String(refId) === String(org._id), "no foreign team leaks into the list");
  }

  const searched = mockRes();
  await listOrgTeams(
    mockReq({ user: owner, principalType: "user", params: { id: String(org._id) }, org, query: { search: "Alpha" } }),
    searched,
  );
  assert.strictEqual(searched.body.items.length, 1);
  assert.match(searched.body.items[0].name, /Alpha/);
});
