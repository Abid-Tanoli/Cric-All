import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";

import mongoose from "mongoose";
import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import User from "../src/models/User.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import Location from "../src/models/Location.js";
import TeamCategory from "../src/models/TeamCategory.js";
import TeamOrganization from "../src/models/TeamOrganization.js";
import Membership from "../src/models/Membership.js";
import AuditLog from "../src/models/AuditLog.js";
import { createOrganization } from "../src/controllers/organizationController.js";
import {
  addOrgTeamPlayers,
  createOrgTeam,
  deleteOrgTeam,
  listOrgTeamAvailablePlayers,
  listOrgTeams,
  removeOrgTeamPlayers,
  updateOrgTeam,
} from "../src/controllers/orgTeamsController.js";
import { requireOrgPermission } from "../src/middleware/orgAccess.js";
import { PERMISSIONS } from "../src/permissions/orgPermissions.js";
import {
  createOrgTeamSchema,
  orgTeamAddPlayersSchema,
  updateOrgTeamSchema,
} from "../src/validators/teamValidators.js";

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
    Location.deleteMany({}),
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
  await createOrganization(mockReq({ user: owner, principalType: "user", body: { name, createDefaultTeam: false } }), res);
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

  const player = await Player.create({ name: "Squad Player", role: "player", createdBy: owner._id });

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
  const player = await Player.create({ name: "Doomed Player", createdBy: owner._id });
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

test("squad: an owner creates and attaches a new player in the same call", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, "Inline Player Org");

  const created = mockRes();
  await createOrgTeam(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id) },
      body: { name: "Inline XI" },
      org,
      orgAccess: ownerAccess,
    }),
    created,
  );
  const teamId = created.body.team._id;

  const res = mockRes();
  await addOrgTeamPlayers(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id), teamId },
      body: { newPlayer: { name: "Inline Player", role: "Bowler", phone: "0300 1234567" } },
      org,
      orgAccess: ownerAccess,
    }),
    res,
  );
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.player.name, "Inline Player");
  assert.ok(res.body.team.players.some((player) => String(player._id) === String(res.body.player._id)));

  const stored = await Player.findById(res.body.player._id);
  assert.ok(stored.team.equals(teamId));
  assert.ok(stored.createdBy.equals(owner._id));
  assert.ok((await Team.findById(teamId)).players.some((id) => String(id) === String(stored._id)));

  const duplicate = mockRes();
  await addOrgTeamPlayers(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id), teamId },
      body: { newPlayer: { name: "Inline Player" } },
      org,
      orgAccess: ownerAccess,
    }),
    duplicate,
  );
  assert.strictEqual(duplicate.statusCode, 409);
  assert.strictEqual(duplicate.body.code, "PLAYER_DUPLICATE");
  assert.match(duplicate.body.message, /already exists/i);
});

test("squad: a player owned by another organization cannot be attached", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, "Attach Org");
  const otherOwner = await makeUser();
  const otherOrg = await makeOrg(otherOwner, "Foreign Player Org");

  const created = mockRes();
  await createOrgTeam(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id) },
      body: { name: "Attach XI" },
      org,
      orgAccess: ownerAccess,
    }),
    created,
  );
  const teamId = created.body.team._id;

  const foreignTeam = await Team.create({ name: "Foreign XI", organizationRef: otherOrg._id });
  const foreignPlayer = await Player.create({
    name: "Foreign Player",
    team: foreignTeam._id,
    createdBy: otherOwner._id,
  });
  foreignTeam.players = [foreignPlayer._id];
  await foreignTeam.save();

  const res = mockRes();
  await addOrgTeamPlayers(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id), teamId },
      body: { playerIds: [String(foreignPlayer._id)] },
      org,
      orgAccess: ownerAccess,
    }),
    res,
  );
  assert.strictEqual(res.statusCode, 403, JSON.stringify(res.body));
  assert.strictEqual(res.body.code, "PLAYER_NOT_OWNED");
  assert.ok((await Player.findById(foreignPlayer._id)).team.equals(foreignTeam._id), "the player was not moved");
  assert.strictEqual((await Team.findById(teamId)).players.length, 0);

  const strangerPlayer = await Player.create({ name: "Unattached Stranger", createdBy: otherOwner._id });
  const stranger = mockRes();
  await addOrgTeamPlayers(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id), teamId },
      body: { playerIds: [String(strangerPlayer._id)] },
      org,
      orgAccess: ownerAccess,
    }),
    stranger,
  );
  assert.strictEqual(stranger.statusCode, 403);
  assert.strictEqual(stranger.body.code, "PLAYER_NOT_OWNED");

  const ownUnattached = await Player.create({ name: "My Free Agent", createdBy: owner._id });
  const attached = mockRes();
  await addOrgTeamPlayers(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id), teamId },
      body: { playerIds: [String(ownUnattached._id)] },
      org,
      orgAccess: ownerAccess,
    }),
    attached,
  );
  assert.strictEqual(attached.statusCode, 200, JSON.stringify(attached.body));
  assert.ok((await Player.findById(ownUnattached._id)).team.equals(teamId));
});

// ---------------------------------------------------------------------------
// squad: the team page's "Add players" actions
// ---------------------------------------------------------------------------

async function makeSquadTeam(owner, org, name = "Page Squad XI") {
  const created = mockRes();
  await createOrgTeam(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id) },
      body: { name },
      org,
      orgAccess: ownerAccess,
    }),
    created,
  );
  assert.strictEqual(created.statusCode, 201, JSON.stringify(created.body));
  return created.body.team._id;
}

// The exact body the team page form posts. `locationRefs`/`locationLabels` are
// what LocationSelect hands back, including its null/empty defaults, and the
// schema must accept it as-is — a strict schema that only took the fields the
// API happened to already support would 400 every real form submission.
const formPayload = (locationRefs = null) => ({
  newPlayer: {
    name: "  Sana Mir  ",
    playingRole: "Bowler",
    battingStyle: "Right-handed",
    bowlingStyle: "Right-arm Off-break",
    jerseyNumber: 27,
    locationRefs: locationRefs || {
      countryId: null,
      provinceId: null,
      districtId: null,
      cityId: null,
      townId: null,
    },
    locationLabels: {
      country: "Pakistan",
      province: "Punjab",
      district: "",
      city: "",
      town: "",
    },
  },
});

test("squad: the real add-player form payload passes the strict validator and stores every field", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, "Form Payload Org");
  const teamId = await makeSquadTeam(owner, org);

  // Real curated nodes: Player's pre-save hook resolves the selection against
  // the location tree, which is exactly what a real form submission does too.
  const country = await Location.create({ type: "country", name: "Pakistan", nameKey: "pakistan", slug: "pakistan" });
  const province = await Location.create({
    type: "province",
    name: "Punjab",
    nameKey: "punjab",
    slug: "punjab",
    parent: country._id,
    ancestors: [country._id],
  });

  const body = parsed(
    orgTeamAddPlayersSchema,
    formPayload({
      countryId: String(country._id),
      provinceId: String(province._id),
      districtId: null,
      cityId: null,
      townId: null,
    }),
  );
  assert.strictEqual(body.newPlayer.name, "Sana Mir");
  assert.strictEqual(body.newPlayer.jerseyNumber, 27);
  assert.strictEqual(body.newPlayers.length, 0, "the bulk list defaults to empty");

  const res = mockRes();
  await addOrgTeamPlayers(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id), teamId },
      body,
      org,
      orgAccess: ownerAccess,
    }),
    res,
  );
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));

  const stored = await Player.findById(res.body.player._id).lean();
  assert.strictEqual(stored.name, "Sana Mir");
  assert.strictEqual(stored.playingRole, "Bowler");
  assert.strictEqual(stored.battingStyle, "Right-handed");
  assert.strictEqual(stored.bowlingStyle, "Right-arm Off-break");
  assert.strictEqual(stored.jerseyNumber, 27);
  assert.strictEqual(String(stored.locationRefs.provinceId), String(province._id));
  assert.strictEqual(stored.locationLabels.province, "Punjab");
  assert.strictEqual(stored.address.province, "Punjab", "labels also fill the legacy address");
  assert.ok(stored.team.equals(teamId));

  // A bare new player (the scoring screen's inline create) still works.
  const minimal = parsed(orgTeamAddPlayersSchema, { newPlayer: { name: "Bare Name" } });
  const minimalRes = mockRes();
  await addOrgTeamPlayers(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id), teamId },
      body: minimal,
      org,
      orgAccess: ownerAccess,
    }),
    minimalRes,
  );
  assert.strictEqual(minimalRes.statusCode, 200, JSON.stringify(minimalRes.body));
});

test("squad: the form payload is rejected when a field is outside the model's enums", async () => {
  const invalid = (patch) =>
    orgTeamAddPlayersSchema.safeParse({
      newPlayer: { ...formPayload().newPlayer, ...patch },
    });

  assert.strictEqual(invalid({ playingRole: "Goalkeeper" }).success, false);
  assert.strictEqual(invalid({ battingStyle: "Ambidextrous" }).success, false);
  assert.strictEqual(invalid({ jerseyNumber: 1000 }).success, false);
  assert.strictEqual(invalid({ unknownField: "x" }).success, false, "the schema stays strict");
});

test("squad: add several checks the whole list before creating anyone", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, "Bulk Org");
  const teamId = await makeSquadTeam(owner, org, "Bulk XI");
  await Player.create({ name: "Existing Member", team: teamId, createdBy: owner._id });

  // A name already on the squad, in the middle of the pasted list.
  const clash = parsed(orgTeamAddPlayersSchema, {
    newPlayers: [{ name: "First New" }, { name: "existing member" }, { name: "Third New" }],
  });
  const clashRes = mockRes();
  await addOrgTeamPlayers(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id), teamId },
      body: clash,
      org,
      orgAccess: ownerAccess,
    }),
    clashRes,
  );
  assert.strictEqual(clashRes.statusCode, 409, JSON.stringify(clashRes.body));
  assert.strictEqual(clashRes.body.code, "PLAYER_DUPLICATE");
  assert.strictEqual(await Player.countDocuments({ name: "First New" }), 0, "nothing was created");

  // The same name twice in one paste is refused for the same reason.
  const repeated = parsed(orgTeamAddPlayersSchema, {
    newPlayers: [{ name: "Twin" }, { name: "Twin" }],
  });
  const repeatedRes = mockRes();
  await addOrgTeamPlayers(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id), teamId },
      body: repeated,
      org,
      orgAccess: ownerAccess,
    }),
    repeatedRes,
  );
  assert.strictEqual(repeatedRes.statusCode, 409);
  assert.strictEqual(await Player.countDocuments({ name: "Twin" }), 0);

  // A clean list creates everybody on the squad in one call.
  const clean = parsed(orgTeamAddPlayersSchema, {
    newPlayers: [{ name: "Bulk One", playingRole: "Batsman" }, { name: "Bulk Two" }, { name: "Bulk Three" }],
  });
  const res = mockRes();
  await addOrgTeamPlayers(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id), teamId },
      body: clean,
      org,
      orgAccess: ownerAccess,
    }),
    res,
  );
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual(
    await Player.countDocuments({ team: teamId }),
    4,
    "the existing member plus the three new ones",
  );
  // The existing member was written straight to the collection by this test, so
  // only the three created through the route are on the roster array.
  assert.strictEqual((await Team.findById(teamId).lean()).players.length, 3, "the roster array was updated");
  const created = await Player.find({ name: { $in: ["Bulk One", "Bulk Two", "Bulk Three"] } }).lean();
  assert.strictEqual(created.length, 3);
  for (const player of created) {
    assert.ok(player.team.equals(teamId));
    assert.ok(player.createdBy.equals(owner._id));
  }
  assert.ok(await AuditLog.findOne({ action: "team.players_added" }));
});

test("squad: available-player search finds attachable players by name and phone, tenant scoped", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, "Picker Org");
  const teamId = await makeSquadTeam(owner, org, "Picker XI");

  const ownAgent = await Player.create({ name: "Ayesha Khan", phone: "923001234567", createdBy: owner._id });
  // A player on another team *of this organization*: attachable, because moving
  // between this club's teams is the owner's own business.
  const secondTeam = await makeSquadTeam(owner, org, "Picker Second XI");
  const inOrgPlayer = await Player.create({ name: "Bilal Shah", team: secondTeam });
  const inSquad = await Player.create({ name: "Ayesha Squad", team: teamId, createdBy: owner._id });

  const otherOwner = await makeUser();
  const otherOrg = await makeOrg(otherOwner, "Picker Other Org");
  const foreignTeam = await Team.create({ name: "Foreign Picker XI", organizationRef: otherOrg._id });
  await Player.create({ name: "Ayesha Foreign", createdBy: otherOwner._id, team: foreignTeam._id });
  const otherPersonsAgent = await Player.create({ name: "Ayesha Unattached", createdBy: otherOwner._id });

  const search = async (term) => {
    const res = mockRes();
    await listOrgTeamAvailablePlayers(
      mockReq({
        user: owner,
        principalType: "user",
        params: { id: String(org._id), teamId },
        query: term === undefined ? {} : { search: term },
        org,
        orgAccess: ownerAccess,
      }),
      res,
    );
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    return res.body.items.map((item) => String(item._id));
  };

  const all = await search();
  assert.deepStrictEqual(
    all.sort(),
    [String(ownAgent._id), String(inOrgPlayer._id)].sort(),
    "own free agents plus players of this organization's other teams, excluding the team's own squad",
  );
  assert.ok(!all.includes(String(inSquad._id)), "the current squad is not offered");
  assert.ok(!all.includes(String(otherPersonsAgent._id)), "somebody else's free agent is not attachable");

  assert.deepStrictEqual(await search("Bilal"), [String(inOrgPlayer._id)]);
  assert.deepStrictEqual(await search("300 123"), [String(ownAgent._id)], "phone search ignores spacing");
  assert.deepStrictEqual(await search("Ayesha"), [String(ownAgent._id)]);

  // The picker is behind the same guard as the write that consumes it.
  const scoreHandler = await makeUser();
  await addMember(org, scoreHandler, ["score_handler"]);
  const denied = mockRes();
  let allowed = false;
  await requireOrgPermission(PERMISSIONS.MANAGE_PLAYERS)(
    mockReq({ user: scoreHandler, principalType: "user", params: { id: String(org._id) } }),
    denied,
    () => {
      allowed = true;
    },
  );
  assert.strictEqual(allowed, false);
  assert.strictEqual(denied.body.code, "ORG_PERMISSION_DENIED");
});
