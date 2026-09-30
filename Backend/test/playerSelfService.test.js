import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";

import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import User from "../src/models/User.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import TeamCategory from "../src/models/TeamCategory.js";
import TeamOrganization from "../src/models/TeamOrganization.js";
import Membership from "../src/models/Membership.js";
import AuditLog from "../src/models/AuditLog.js";
import { createOrganization } from "../src/controllers/organizationController.js";
import { createPlayer, deletePlayer, getMyPlayers, updatePlayer } from "../src/controllers/playerController.js";
import { createPlayerSchema, updatePlayerSchema, adminPlayerSchema, adminUpdatePlayerSchema } from "../src/validators/playerValidators.js";
import { applyPlayerFieldPolicy, resolvePlayerWriteAccess } from "../src/middleware/playerAccess.js";

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
  await TeamCategory.seedDefaults();
});

let counter = 0;
async function makeUser(overrides = {}) {
  counter += 1;
  return User.create({
    name: `Player Person ${counter}`,
    email: `player-${counter}-${Math.random().toString(36).slice(2, 8)}@openctest.dev`,
    password: "password-123",
    role: "scorer",
    accountType: "organization_admin",
    emailVerified: true,
    ...overrides,
  });
}

async function makeOrg(owner, name = "Players Org") {
  const res = mockRes();
  await createOrganization(mockReq({ user: owner, principalType: "user", body: { name } }), res);
  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
  return res.body.organization;
}

async function makeOrgTeam(org, name = "Org XI") {
  return Team.create({ name, organizationRef: org._id, organization: org.name, type: "local_team" });
}

const parsed = (schema, payload) => schema.parse(payload);
const id = (doc) => String(doc._id);

// ---------------------------------------------------------------------------
// The hole the audit flagged
// ---------------------------------------------------------------------------
test("the strict schema rejects a smuggled stats block on create", () => {
  const result = createPlayerSchema.safeParse({
    name: "Career Cheat",
    stats: { runs: 10000, wickets: 250 },
  });
  assert.strictEqual(result.success, false, "stats must not be settable at create time");
  assert.ok(result.error.issues.some((issue) => issue.code === "unrecognized_keys" && issue.keys.includes("stats")));
});

test("the strict schema rejects the legacy `Campus` key and accepts `campus`", () => {
  assert.strictEqual(createPlayerSchema.safeParse({ name: "X", Campus: "Lahore" }).success, false);
  assert.strictEqual(createPlayerSchema.safeParse({ name: "X", campus: "Lahore" }).success, true);
});

test("the schema rejects an out-of-enum playing role instead of storing it", () => {
  const result = createPlayerSchema.safeParse({ name: "X", playingRole: "Wicketkeeper" });
  assert.strictEqual(result.success, false);
  // The model enum spells it "Wicket-Keeper"; accepting the other spelling would
  // produce a profile the scoring UI cannot read.
  assert.strictEqual(createPlayerSchema.safeParse({ name: "X", playingRole: "Wicket-Keeper" }).success, true);
});

test("imageUrl must be an http(s) URL or a site-relative path", () => {
  assert.strictEqual(createPlayerSchema.safeParse({ name: "X", imageUrl: "javascript:alert(1)" }).success, false);
  assert.strictEqual(createPlayerSchema.safeParse({ name: "X", imageUrl: "https://cdn.example/a.png" }).success, true);
  assert.strictEqual(createPlayerSchema.safeParse({ name: "X", imageUrl: "/uploads/a.png" }).success, true);
});

// ---------------------------------------------------------------------------
// Self-service creation
// ---------------------------------------------------------------------------
test("any verified account can create a profile, and it is attributed to them", async () => {
  const user = await makeUser({ accountType: "viewer", role: "viewer" });
  const res = mockRes();
  await createPlayer(
    mockReq({
      user,
      principalType: "user",
      body: parsed(createPlayerSchema, { name: "Self Made Cricketer", playingRole: "Bowler" }),
    }),
    res,
  );

  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
  const stored = await Player.findOne({ name: "Self Made Cricketer" });
  assert.ok(stored, "the profile was stored");
  assert.ok(stored.createdBy.equals(user._id), "createdBy comes from the session, not the body");
  assert.ok(await AuditLog.findOne({ action: "player.created" }), "creation is audited");
});

test("a caller cannot set createdBy by putting it in the body", async () => {
  const user = await makeUser();
  const victim = await makeUser();

  // The schema does not list createdBy at all, so the attempt is a 400 at the
  // route. Assert the schema, then assert the controller cannot be tricked.
  assert.strictEqual(createPlayerSchema.safeParse({ name: "X", createdBy: id(victim) }).success, false);

  const res = mockRes();
  await createPlayer(
    mockReq({ user, principalType: "user", body: { name: "Forged", createdBy: id(victim) } }),
    res,
  );
  const stored = await Player.findOne({ name: "Forged" });
  assert.ok(stored.createdBy.equals(user._id), "the session user wins over the body");
  assert.ok(!stored.createdBy.equals(victim._id));
});

// ---------------------------------------------------------------------------
// Write access
// ---------------------------------------------------------------------------
test("the creator can edit their own profile", async () => {
  const user = await makeUser();
  const created = mockRes();
  await createPlayer(
    mockReq({ user, principalType: "user", body: parsed(createPlayerSchema, { name: "My Cricketer" }) }),
    created,
  );
  const playerId = created.body._id;

  const access = await resolvePlayerWriteAccess(
    { user, principalType: "user" },
    await Player.findById(playerId)
  );
  assert.strictEqual(access.allowed, true);
  assert.strictEqual(access.via, "creator");
});

test("a stranger cannot edit somebody else's profile", async () => {
  const owner = await makeUser();
  const stranger = await makeUser();
  const created = mockRes();
  await createPlayer(
    mockReq({ user: owner, principalType: "user", body: parsed(createPlayerSchema, { name: "Not Yours" }) }),
    created,
  );

  const res = mockRes();
  await updatePlayer(
    mockReq({
      user: stranger,
      principalType: "user",
      params: { id: created.body._id },
      body: parsed(updatePlayerSchema, { name: "Hijacked" }),
    }),
    res,
  );

  assert.strictEqual(res.statusCode, 403, JSON.stringify(res.body));
  assert.strictEqual(res.body.code, "PLAYER_WRITE_FORBIDDEN");
  assert.strictEqual((await Player.findById(created.body._id)).name, "Not Yours", "the profile is untouched");
});

test("a creator's stats edit is stripped, not applied, and the response says so", async () => {
  const user = await makeUser();
  const created = mockRes();
  await createPlayer(
    mockReq({ user, principalType: "user", body: parsed(createPlayerSchema, { name: "Honest Stats" }) }),
    created,
  );

  const res = mockRes();
  await updatePlayer(
    mockReq({
      user,
      principalType: "user",
      params: { id: created.body._id },
      body: parsed(updatePlayerSchema, { name: "Still Honest", stats: { runs: 9999 } }),
    }),
    res,
  );

  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  const stored = await Player.findById(created.body._id);
  assert.strictEqual(stored.name, "Still Honest", "the legitimate part of the edit applied");
  assert.strictEqual(stored.stats.runs, 0, "the stats claim was dropped");
  assert.ok(res.body.ignoredFields.includes("stats"), "the client is told what was ignored");
});

test("a creator cannot put their profile into a team by editing it", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const team = await makeOrgTeam(org);
  const created = mockRes();
  await createPlayer(
    mockReq({ user: owner, principalType: "user", body: parsed(createPlayerSchema, { name: "Sneaky" }) }),
    created,
  );

  await updatePlayer(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: created.body._id },
      body: parsed(updatePlayerSchema, { team: id(team) }),
    }),
    mockRes(),
  );

  const stored = await Player.findById(created.body._id);
  assert.ok(!stored.team, "team assignment stays a separate, permission-checked action");
  assert.strictEqual((await Team.findById(team._id)).players.length, 0);
});

// ---------------------------------------------------------------------------
// Organization managers
// ---------------------------------------------------------------------------
test("a coach of the owning organization can edit a player in one of its teams", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const team = await makeOrgTeam(org);
  const coach = await makeUser({ accountType: "viewer", role: "viewer" });
  await Membership.create({ organization: org._id, user: coach._id, roles: ["coach"] });

  const created = mockRes();
  await createPlayer(
    mockReq({ user: owner, principalType: "user", body: parsed(createPlayerSchema, { name: "Squad Member" }) }),
    created,
  );
  const playerId = created.body._id;
  await Player.updateOne({ _id: playerId }, { team: team._id });

  const access = await resolvePlayerWriteAccess(
    { user: coach, principalType: "user" },
    await Player.findById(playerId)
  );
  assert.strictEqual(access.allowed, true);
  assert.strictEqual(access.via, "org_manager");
  assert.ok(String(access.organization) === id(org), "the owning organization is reported for the audit entry");

  const res = mockRes();
  await updatePlayer(
    mockReq({
      user: coach,
      principalType: "user",
      params: { id: playerId },
      body: parsed(updatePlayerSchema, { imageUrl: "https://cdn.example/new.png" }),
    }),
    res,
  );
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.ok(await AuditLog.findOne({ action: "player.updated", "metadata.via": "org_manager" }));
});

test("a manager of a *different* organization cannot edit the player", async () => {
  const owner = await makeUser();
  const orgA = await makeOrg(owner, "Org A");
  const team = await makeOrgTeam(orgA, "A XI");
  const orgBowner = await makeUser();
  const orgB = await makeOrg(orgBowner, "Org B");
  const outsider = await makeUser({ accountType: "viewer", role: "viewer" });
  await Membership.create({ organization: orgB._id, user: outsider._id, roles: ["owner"] });

  const created = mockRes();
  await createPlayer(
    mockReq({ user: owner, principalType: "user", body: parsed(createPlayerSchema, { name: "Org A Player" }) }),
    created,
  );
  const playerId = created.body._id;
  await Player.updateOne({ _id: playerId }, { team: team._id });

  const access = await resolvePlayerWriteAccess(
    { user: outsider, principalType: "user" },
    await Player.findById(playerId)
  );
  assert.strictEqual(access.allowed, false, "tenant isolation holds across organizations");
});

test("a free agent with no team is editable only by its creator", async () => {
  const user = await makeUser();
  const created = mockRes();
  await createPlayer(
    mockReq({ user, principalType: "user", body: parsed(createPlayerSchema, { name: "Free Agent" }) }),
    created,
  );
  const playerId = created.body._id;
  await Player.updateOne({ _id: playerId }, { createdBy: null });

  const other = await makeUser();
  const access = await resolvePlayerWriteAccess(
    { user: other, principalType: "user" },
    await Player.findById(playerId)
  );
  assert.strictEqual(access.allowed, false, "no creator and no team means nobody self-service manages it");
});

// ---------------------------------------------------------------------------
// Field policy
// ---------------------------------------------------------------------------
test("applyPlayerFieldPolicy strips privileged fields but keeps the rest", () => {
  const { payload, stripped } = applyPlayerFieldPolicy(
    { name: "Fine", team: "507f1f77bcf86cd799439011", stats: { runs: 5 }, isSeed: true },
    { via: "creator" }
  );
  assert.deepEqual(payload, { name: "Fine" });
  assert.deepEqual(stripped.sort(), ["isSeed", "stats", "team"]);
});

test("applyPlayerFieldPolicy lets a platform admin keep everything", () => {
  const { payload, stripped } = applyPlayerFieldPolicy(
    { name: "Fine", team: "507f1f77bcf86cd799439011", stats: { runs: 5 } },
    { via: "platform_admin" }
  );
  assert.ok(payload.team && payload.stats, "the Admin app can still set a team and stats");
  assert.deepEqual(stripped, []);
});

test("an org manager cannot move a player through a profile edit either", () => {
  const { payload, stripped } = applyPlayerFieldPolicy(
    { team: "507f1f77bcf86cd799439011", stats: { runs: 5000 } },
    { via: "org_manager" }
  );
  assert.ok(!payload.team, "squad membership has one entry point: the org team routes");
  assert.ok(!payload.stats, "manage_players is not a licence to fabricate a career");
  assert.deepEqual(stripped.sort(), ["stats", "team"]);
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------
test("a stranger cannot delete a profile; the creator can", async () => {
  const owner = await makeUser();
  const stranger = await makeUser();
  const created = mockRes();
  await createPlayer(
    mockReq({ user: owner, principalType: "user", body: parsed(createPlayerSchema, { name: "Deletable" }) }),
    created,
  );
  const playerId = created.body._id;

  const denied = mockRes();
  await deletePlayer(mockReq({ user: stranger, principalType: "user", params: { id: playerId } }), denied);
  assert.strictEqual(denied.statusCode, 403);
  assert.ok(await Player.findById(playerId), "still there");

  const allowed = mockRes();
  await deletePlayer(mockReq({ user: owner, principalType: "user", params: { id: playerId } }), allowed);
  assert.strictEqual(allowed.statusCode, 200, JSON.stringify(allowed.body));
  assert.equal(await Player.findById(playerId), null);
  assert.ok(await AuditLog.findOne({ action: "player.deleted" }));
});

test("deleting a player detaches them from their team", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const team = await makeOrgTeam(org, "Detach XI");
  const created = mockRes();
  await createPlayer(
    mockReq({ user: owner, principalType: "user", body: parsed(createPlayerSchema, { name: "Departing" }) }),
    created,
  );
  const playerId = created.body._id;
  await Player.updateOne({ _id: playerId }, { team: team._id });
  await Team.updateOne({ _id: team._id }, { players: [playerId] });

  await deletePlayer(mockReq({ user: owner, principalType: "user", params: { id: playerId } }), mockRes());
  assert.deepEqual((await Team.findById(team._id)).players, [], "the squad no longer lists a deleted player");
});

test("deleting an unknown player is a 404, not a silent success", async () => {
  const user = await makeUser();
  const res = mockRes();
  await deletePlayer(
    mockReq({ user, principalType: "user", params: { id: "507f1f77bcf86cd799439011" } }),
    res,
  );
  assert.strictEqual(res.statusCode, 404);
});

// ---------------------------------------------------------------------------
// "My players"
// ---------------------------------------------------------------------------
test("getMyPlayers returns only this account's own profiles", async () => {
  const mine = await makeUser();
  const theirs = await makeUser();
  for (const [user, name] of [[mine, "Mine A"], [mine, "Mine B"], [theirs, "Theirs"]]) {
    const res = mockRes();
    await createPlayer(mockReq({ user, principalType: "user", body: parsed(createPlayerSchema, { name }) }), res);
    assert.strictEqual(res.statusCode, 201);
  }

  const res = mockRes();
  await getMyPlayers(mockReq({ user: mine, principalType: "user" }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.total, 2);
  assert.deepEqual(res.body.items.map((p) => p.name).sort(), ["Mine A", "Mine B"]);
});

test("the public profile response does not leak who owns the profile", async () => {
  const { getPlayer } = await import("../src/controllers/playerController.js");
  const user = await makeUser();
  const created = mockRes();
  await createPlayer(
    mockReq({ user, principalType: "user", body: parsed(createPlayerSchema, { name: "Private Owner" }) }),
    created,
  );

  const res = mockRes();
  await getPlayer(mockReq({ params: { id: created.body._id } }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.ok(!("createdBy" in res.body), "createdBy is not part of the public payload");
});

// ---------------------------------------------------------------------------
// The platform Admin app keeps the richer payload
// ---------------------------------------------------------------------------
test("the admin create schema accepts team and stats; the self-service one does not", () => {
  const payload = { name: "Enlisted", team: "507f1f77bcf86cd799439011", stats: { runs: 3 } };
  assert.strictEqual(createPlayerSchema.safeParse(payload).success, false);
  assert.strictEqual(adminPlayerSchema.safeParse(payload).success, true);
});

test("the admin create schema accepts team: '' for a free agent", () => {
  // The Admin form offers "Agent (No Team)" and sends ""; rejecting it here
  // would make a legitimate choice a 400.
  const result = adminPlayerSchema.safeParse({ name: "Enlisted Free Agent", team: "" });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.data.team, "", "the controller is what turns '' into 'no team'");
});

test("the admin update schema accepts seed provenance and an empty team", () => {
  assert.strictEqual(
    adminUpdatePlayerSchema.safeParse({ isSeed: true, seedSource: "espn", team: "" }).success,
    true
  );
  assert.strictEqual(updatePlayerSchema.safeParse({ isSeed: true }).success, false);
});

test("a platform admin can write career stats; the field policy does not strip them", async () => {
  const admin = await makeUser({ role: "admin" });
  const target = await makeUser();
  const created = mockRes();
  await createPlayer(
    mockReq({ user: target, principalType: "user", body: parsed(createPlayerSchema, { name: "Pro Cricketer" }) }),
    created,
  );

  const res = mockRes();
  await updatePlayer(
    mockReq({
      user: admin,
      principalType: "admin",
      params: { id: created.body._id },
      body: parsed(adminUpdatePlayerSchema, { stats: { runs: 4210, wickets: 88 } }),
    }),
    res,
  );

  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  const stored = await Player.findById(created.body._id);
  assert.strictEqual(stored.stats.runs, 4210, "the scoring figures the platform sets are kept");
  assert.ok(!res.body.ignoredFields, "nothing was ignored for a platform admin");
  assert.ok(await AuditLog.findOne({ action: "player.updated", "metadata.via": "platform_admin" }));
});

test("a platform admin can create a player straight into a team", async () => {
  const admin = await makeUser({ role: "admin" });
  const org = await makeOrg(await makeUser(), "Enlistment Org");
  const team = await makeOrgTeam(org, "Direct XI");

  const res = mockRes();
  await createPlayer(
    mockReq({
      user: admin,
      principalType: "admin",
      body: parsed(adminPlayerSchema, { name: "Signed Direct", team: id(team) }),
    }),
    res,
  );

  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
  const stored = await Player.findOne({ name: "Signed Direct" });
  assert.ok(stored.team.equals(team._id));
  assert.ok((await Team.findById(team._id)).players.some((p) => p.equals(stored._id)), "the squad was updated too");
});

test("a creator with an empty team selection is stored as a free agent", async () => {
  const admin = await makeUser({ role: "admin" });
  const res = mockRes();
  await createPlayer(
    mockReq({
      user: admin,
      principalType: "admin",
      body: parsed(adminPlayerSchema, { name: "Unsigned", team: "" }),
    }),
    res,
  );
  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
  assert.ok(!(await Player.findOne({ name: "Unsigned" })).team, "'' did not become a cast error");
});
