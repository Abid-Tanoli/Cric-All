import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";

import mongoose from "mongoose";
import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import User from "../src/models/User.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import Match from "../src/models/Match.js";
import Event from "../src/models/Event.js";
import TeamCategory from "../src/models/TeamCategory.js";
import TeamOrganization from "../src/models/TeamOrganization.js";
import Membership from "../src/models/Membership.js";
import AuditLog from "../src/models/AuditLog.js";
import { createOrganization } from "../src/controllers/organizationController.js";
import {
  createOrgEvent,
  createOrgMatch,
  deleteOrgEvent,
  deleteOrgMatch,
  listOrgMatches,
  setOrgMatchSquads,
  updateOrgMatch,
} from "../src/controllers/orgMatchesController.js";
import {
  createOrgEventSchema,
  createOrgMatchSchema,
  setOrgMatchSquadsSchema,
  updateOrgMatchSchema,
} from "../src/validators/matchValidators.js";
import { requireOrgPermission } from "../src/middleware/orgAccess.js";
import { PERMISSIONS } from "../src/permissions/orgPermissions.js";

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
    Match.deleteMany({}),
    Event.deleteMany({}),
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
    name: `Fixture Person ${counter}`,
    email: `fixture-${counter}-${Math.random().toString(36).slice(2, 8)}@openctest.dev`,
    password: "password-123",
    role: "scorer",
    accountType: "organization_admin",
    emailVerified: true,
    ...overrides,
  });
}

async function makeOrg(owner, name = "Fixtures Org") {
  const res = mockRes();
  await createOrganization(mockReq({ user: owner, principalType: "user", body: { name } }), res);
  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
  return res.body.organization;
}

let teamCounter = 0;
async function makeOrgTeam(org, name = "XI") {
  teamCounter += 1;
  return Team.create({ name: `${name} ${teamCounter}`, organizationRef: org._id, organization: org.name, isPublic: false });
}

const parsed = (schema, payload) => schema.parse(payload);
const id = (doc) => String(doc._id);
const managerAccess = { via: "membership", roles: ["manager"], permissions: [] };

function reqFor(user, org, body, params = {}) {
  return mockReq({ user, principalType: "user", org, orgAccess: managerAccess, body, params });
}

// ---------------------------------------------------------------------------
// Tenancy is the point
// ---------------------------------------------------------------------------
test("a manager creates a fixture between two of the organization's own teams", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const a = await makeOrgTeam(org, "Alpha");
  const b = await makeOrgTeam(org, "Beta");

  const res = mockRes();
  await createOrgMatch(
    reqFor(owner, org, parsed(createOrgMatchSchema, { teams: [id(a), id(b)], matchType: "T10", venue: "Ground" })),
    res,
  );

  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
  const stored = await Match.findById(res.body.match._id);
  assert.ok(stored.organizationRef.equals(org._id), "the tenant key comes from req.org");
  assert.strictEqual(stored.status, "upcoming");
  assert.strictEqual(stored.totalOvers, 10, "totalOvers is derived from matchType, not sent by the client");
  assert.ok(stored.innings.length === 2, "both innings are seeded with their teams");
  assert.ok(await AuditLog.findOne({ action: "match.created" }));
});

test("a fixture cannot be smuggled into another organization", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const a = await makeOrgTeam(org);

  // The schema refuses the key outright rather than letting it be ignored.
  const injected = createOrgMatchSchema.safeParse({ teams: [id(a), id(a)], organizationRef: id(org) });
  assert.strictEqual(injected.success, false);
  assert.ok(
    injected.error.issues.some(
      (issue) => issue.code === "unrecognized_keys" && issue.keys.includes("organizationRef")
    )
  );
});

test("a team from another organization is rejected", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, "Org One");
  const mine = await makeOrgTeam(org, "Mine");

  const otherOwner = await makeUser();
  const otherOrg = await makeOrg(otherOwner, "Org Two");
  const theirs = await makeOrgTeam(otherOrg, "Theirs");

  const res = mockRes();
  await createOrgMatch(reqFor(owner, org, parsed(createOrgMatchSchema, { teams: [id(mine), id(theirs)] })), res);
  assert.strictEqual(res.statusCode, 422, JSON.stringify(res.body));
  assert.strictEqual(res.body.code, "MATCH_TEAM_NOT_IN_ORG");
  assert.strictEqual(await Match.countDocuments({}), 0, "nothing was written");
});

test("a fixture that is not this organization's is a 404, and cannot be edited or deleted", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, "Mine");
  const a = await makeOrgTeam(org, "A");
  const b = await makeOrgTeam(org, "B");
  const created = mockRes();
  await createOrgMatch(reqFor(owner, org, parsed(createOrgMatchSchema, { teams: [id(a), id(b)] })), created);
  const matchId = created.body.match._id;

  const otherOwner = await makeUser();
  const otherOrg = await makeOrg(otherOwner, "Theirs");
  const stranger = { user: otherOwner, org: otherOrg, orgAccess: managerAccess };

  const update = mockRes();
  await updateOrgMatch(
    mockReq({
      ...stranger,
      params: { matchId },
      body: parsed(updateOrgMatchSchema, { venue: "Hijacked" }),
    }),
    update,
  );
  assert.strictEqual(update.statusCode, 404);
  assert.strictEqual(update.body.code, "MATCH_NOT_FOUND");

  const del = mockRes();
  await deleteOrgMatch(mockReq({ ...stranger, params: { matchId } }), del);
  assert.strictEqual(del.statusCode, 404);
  assert.ok(await Match.findById(matchId), "the fixture survived");
});

test("listOrgMatches only returns this organization's fixtures", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, "Listing Org");
  const a = await makeOrgTeam(org, "A");
  const b = await makeOrgTeam(org, "B");
  await createOrgMatch(reqFor(owner, org, parsed(createOrgMatchSchema, { teams: [id(a), id(b)], venue: "Home" })), mockRes());

  const otherOwner = await makeUser();
  const otherOrg = await makeOrg(otherOwner, "Other Org");
  const c = await makeOrgTeam(otherOrg, "C");
  const d = await makeOrgTeam(otherOrg, "D");
  await createOrgMatch(
    reqFor(otherOwner, otherOrg, parsed(createOrgMatchSchema, { teams: [id(c), id(d)], venue: "Away" })),
    mockRes(),
  );

  const res = mockRes();
  await listOrgMatches(mockReq({ user: owner, org }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.total, 1);
  assert.strictEqual(res.body.items[0].venue, "Home");
});

// ---------------------------------------------------------------------------
// Scoring stays out of reach
// ---------------------------------------------------------------------------
test("the schema refuses to let self-service set a live or completed status", async () => {
  assert.strictEqual(updateOrgMatchSchema.safeParse({ status: "live" }).success, false);
  assert.strictEqual(updateOrgMatchSchema.safeParse({ status: "completed" }).success, false);
  assert.strictEqual(updateOrgMatchSchema.safeParse({ status: "abandoned" }).success, true);
});

test("the schema has no room for a result, innings or a totalOvers override", async () => {
  for (const key of ["result", "innings", "totalOvers", "organizationRef", "manOfMatch", "currentInnings"]) {
    const result = updateOrgMatchSchema.safeParse({ [key]: "anything" });
    assert.strictEqual(result.success, false, `${key} must not be settable from the dashboard`);
  }
  assert.strictEqual(createOrgMatchSchema.safeParse({ teams: [id("507f1f77bcf86cd799439011"), id("507f1f77bcf86cd799439012")], totalOvers: 2 }).success, false);
});

test("a fixture with a recorded score cannot have its teams swapped or be deleted", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const a = await makeOrgTeam(org, "A");
  const b = await makeOrgTeam(org, "B");
  const c = await makeOrgTeam(org, "C");
  const created = mockRes();
  await createOrgMatch(reqFor(owner, org, parsed(createOrgMatchSchema, { teams: [id(a), id(b)] })), created);
  const matchId = created.body.match._id;

  await Match.updateOne({ _id: matchId }, { $set: { "innings.0.balls": 6, "innings.0.runs": 8 } });

  const swap = mockRes();
  await updateOrgMatch(
    reqFor(owner, org, parsed(updateOrgMatchSchema, { teams: [id(a), id(c)] }), { matchId }),
    swap,
  );
  assert.strictEqual(swap.statusCode, 409);
  assert.strictEqual(swap.body.code, "MATCH_ALREADY_SCORED");

  const del = mockRes();
  await deleteOrgMatch(reqFor(owner, org, {}, { matchId }), del);
  assert.strictEqual(del.statusCode, 409);
  assert.ok(await Match.findById(matchId), "the scored fixture is still there");
});

test("a partly-scored fixture can still be called off", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const a = await makeOrgTeam(org, "A");
  const b = await makeOrgTeam(org, "B");
  const created = mockRes();
  await createOrgMatch(reqFor(owner, org, parsed(createOrgMatchSchema, { teams: [id(a), id(b)] })), created);
  const matchId = created.body.match._id;
  await Match.updateOne({ _id: matchId }, { $set: { "innings.0.balls": 3 } });

  const res = mockRes();
  await updateOrgMatch(reqFor(owner, org, parsed(updateOrgMatchSchema, { status: "abandoned" }), { matchId }), res);
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual((await Match.findById(matchId)).status, "abandoned");
  assert.ok(await AuditLog.findOne({ action: "match.updated" }));
});

test("an untouched fixture can be rescheduled and renamed", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const a = await makeOrgTeam(org, "A");
  const b = await makeOrgTeam(org, "B");
  const created = mockRes();
  await createOrgMatch(reqFor(owner, org, parsed(createOrgMatchSchema, { teams: [id(a), id(b)] })), created);
  const matchId = created.body.match._id;

  const startAt = new Date("2030-04-01T10:00:00.000Z");
  const res = mockRes();
  await updateOrgMatch(
    reqFor(owner, org, parsed(updateOrgMatchSchema, { title: "Rematch", startAt, venue: "New Ground" }), { matchId }),
    res,
  );
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  const stored = await Match.findById(matchId);
  assert.strictEqual(stored.title, "Rematch");
  assert.strictEqual(stored.startAt.toISOString(), startAt.toISOString());
});

test("a fixture with the same team twice is refused", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const a = await makeOrgTeam(org);
  assert.strictEqual(createOrgMatchSchema.safeParse({ teams: [id(a), id(a)] }).success, false);
  assert.strictEqual(createOrgMatchSchema.safeParse({ teams: [id(a)] }).success, false);
});

// ---------------------------------------------------------------------------
// Squads
// ---------------------------------------------------------------------------
async function makePlayer(team, name) {
  const player = await Player.create({ name, team: team._id });
  await Team.updateOne({ _id: team._id }, { $addToSet: { players: player._id } });
  return player;
}

test("squads can be set from the team roster", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const a = await makeOrgTeam(org, "A");
  const b = await makeOrgTeam(org, "B");
  const p1 = await makePlayer(a, "A One");
  const p2 = await makePlayer(a, "A Two");
  const p3 = await makePlayer(b, "B One");

  const created = mockRes();
  await createOrgMatch(reqFor(owner, org, parsed(createOrgMatchSchema, { teams: [id(a), id(b)] })), created);
  const matchId = created.body.match._id;

  const res = mockRes();
  await setOrgMatchSquads(
    reqFor(
      owner,
      org,
      parsed(setOrgMatchSquadsSchema, {
        squads: [
          { team: id(a), players: [id(p1), id(p2)], captain: id(p1) },
          { team: id(b), players: [id(p3)] },
        ],
      }),
      { matchId },
    ),
    res,
  );

  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  const stored = await Match.findById(matchId);
  const squadA = stored.squad15.find((s) => String(s.team) === id(a));
  assert.strictEqual(squadA.players.length, 2);
  assert.ok(squadA.captain.equals(p1._id), "the captain is recorded on the squad the scorer reads");
  assert.ok(await AuditLog.findOne({ action: "match.squads_updated" }));
});

test("a player who is not on the team roster cannot be nominated", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const a = await makeOrgTeam(org, "A");
  const b = await makeOrgTeam(org, "B");
  const onRoster = await makePlayer(a, "On Roster");
  const stranger = await Player.create({ name: "Never Played For Them" });

  const created = mockRes();
  await createOrgMatch(reqFor(owner, org, parsed(createOrgMatchSchema, { teams: [id(a), id(b)] })), created);

  const res = mockRes();
  await setOrgMatchSquads(
    reqFor(
      owner,
      org,
      parsed(setOrgMatchSquadsSchema, { squads: [{ team: id(a), players: [id(onRoster), id(stranger)] }] }),
      { matchId: created.body.match._id },
    ),
    res,
  );

  assert.strictEqual(res.statusCode, 422, JSON.stringify(res.body));
  assert.strictEqual(res.body.code, "SQUAD_PLAYER_NOT_IN_TEAM");
  assert.deepEqual(res.body.playerIds, [id(stranger)], "the offending ids come back so the UI can explain");
});

test("a squad can only be set for one of the two teams in the fixture", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const a = await makeOrgTeam(org, "A");
  const b = await makeOrgTeam(org, "B");
  const outsider = await makeOrgTeam(org, "C");
  const p = await makePlayer(outsider, "C Player");

  const created = mockRes();
  await createOrgMatch(reqFor(owner, org, parsed(createOrgMatchSchema, { teams: [id(a), id(b)] })), created);

  const res = mockRes();
  await setOrgMatchSquads(
    reqFor(
      owner,
      org,
      parsed(setOrgMatchSquadsSchema, { squads: [{ team: id(outsider), players: [id(p)] }] }),
      { matchId: created.body.match._id },
    ),
    res,
  );
  assert.strictEqual(res.statusCode, 422);
  assert.strictEqual(res.body.code, "SQUAD_TEAM_NOT_IN_MATCH");
});

test("the squad schema keeps the captain inside the squad and the squad realistic", async () => {
  const teamId = id("507f1f77bcf86cd799439011");
  const one = id("507f1f77bcf86cd799439012");
  const two = id("507f1f77bcf86cd799439013");
  assert.strictEqual(
    setOrgMatchSquadsSchema.safeParse({ squads: [{ team: teamId, players: [one], captain: two }] }).success,
    false,
    "a captain outside the squad is a data-entry mistake"
  );
  assert.strictEqual(setOrgMatchSquadsSchema.safeParse({ squads: [{ team: teamId, players: [] }] }).success, false);
  assert.strictEqual(
    setOrgMatchSquadsSchema.safeParse({ squads: [{ team: teamId, players: Array(21).fill(one) }] }).success,
    false
  );
  assert.strictEqual(
    setOrgMatchSquadsSchema.safeParse({
      squads: [
        { team: teamId, players: [one] },
        { team: teamId, players: [two] },
      ],
    }).success,
    false,
    "the same team cannot have two squads"
  );
});

test("replacing a squad drops the player who was removed", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const a = await makeOrgTeam(org, "A");
  const b = await makeOrgTeam(org, "B");
  const p1 = await makePlayer(a, "Stays");
  const p2 = await makePlayer(a, "Leaves");

  const created = mockRes();
  await createOrgMatch(reqFor(owner, org, parsed(createOrgMatchSchema, { teams: [id(a), id(b)] })), created);
  const matchId = created.body.match._id;

  await setOrgMatchSquads(
    reqFor(owner, org, parsed(setOrgMatchSquadsSchema, { squads: [{ team: id(a), players: [id(p1), id(p2)] }] }), {
      matchId,
    }),
    mockRes(),
  );
  await setOrgMatchSquads(
    reqFor(owner, org, parsed(setOrgMatchSquadsSchema, { squads: [{ team: id(a), players: [id(p1)] }] }), {
      matchId,
    }),
    mockRes(),
  );

  const stored = await Match.findById(matchId);
  const squad = stored.squad15.find((s) => String(s.team) === id(a));
  assert.deepEqual(squad.players.map(String), [id(p1)], "a merge would have left the dropped player nominated");
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
test("a manager creates an event owned by the organization", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const res = mockRes();
  await createOrgEvent(
    reqFor(
      owner,
      org,
      parsed(createOrgEventSchema, {
        name: "Summer League",
        eventType: "league",
        format: "T10",
        totalTeams: 6,
        startDate: "2030-05-01",
        endDate: "2030-06-01",
      }),
    ),
    res,
  );

  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
  const stored = await Event.findById(res.body.event._id);
  assert.ok(stored.organization.equals(org._id), "the tenant key comes from req.org");
  assert.ok(stored.createdBy.equals(owner._id), "who created it is recorded");
  assert.ok(await AuditLog.findOne({ action: "event.created" }));
});

test("a single-match event cannot declare a team count", async () => {
  assert.strictEqual(
    createOrgEventSchema.safeParse({ name: "Friendly", eventType: "single-match", totalTeams: 4 }).success,
    false
  );
  assert.strictEqual(createOrgEventSchema.safeParse({ name: "X", eventType: "single-match" }).success, true);
});

test("an event cannot end before it starts", async () => {
  const result = createOrgEventSchema.safeParse({
    name: "Backwards",
    eventType: "series",
    startDate: "2030-06-01",
    endDate: "2030-05-01",
  });
  assert.strictEqual(result.success, false);
});

test("a fixture can be created inside one of the organization's events", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const a = await makeOrgTeam(org, "A");
  const b = await makeOrgTeam(org, "B");
  const event = mockRes();
  await createOrgEvent(reqFor(owner, org, parsed(createOrgEventSchema, { name: "Cup", eventType: "tournament" })), event);

  const res = mockRes();
  await createOrgMatch(
    reqFor(owner, org, parsed(createOrgMatchSchema, { teams: [id(a), id(b)], eventId: String(event.body.event._id) })),
    res,
  );
  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));

  const linked = await Event.findById(event.body.event._id);
  assert.ok(linked.matches.some((m) => m.equals(res.body.match._id)), "the event lists the fixture");
  assert.ok((await Match.findById(res.body.match._id)).event.equals(event.body.event._id), "and vice versa");
});

test("an event from another organization cannot be attached", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, "Mine");
  const a = await makeOrgTeam(org, "A");
  const b = await makeOrgTeam(org, "B");

  const otherOwner = await makeUser();
  const otherOrg = await makeOrg(otherOwner, "Theirs");
  const otherEvent = mockRes();
  await createOrgEvent(
    reqFor(otherOwner, otherOrg, parsed(createOrgEventSchema, { name: "Theirs", eventType: "series" })),
    otherEvent,
  );

  const res = mockRes();
  await createOrgMatch(
    reqFor(owner, org, parsed(createOrgMatchSchema, { teams: [id(a), id(b)], eventId: id(otherEvent.body.event) })),
    res,
  );
  assert.strictEqual(res.statusCode, 422);
  assert.strictEqual(res.body.code, "EVENT_NOT_IN_ORG");
});

test("an event with fixtures cannot be deleted, and the fixture link survives", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const a = await makeOrgTeam(org, "A");
  const b = await makeOrgTeam(org, "B");
  const event = mockRes();
  await createOrgEvent(reqFor(owner, org, parsed(createOrgEventSchema, { name: "Cup", eventType: "tournament" })), event);
  await createOrgMatch(
    reqFor(owner, org, parsed(createOrgMatchSchema, { teams: [id(a), id(b)], eventId: String(event.body.event._id) })),
    mockRes(),
  );

  const res = mockRes();
  await deleteOrgEvent(reqFor(owner, org, {}, { eventId: String(event.body.event._id) }), res);
  assert.strictEqual(res.statusCode, 409);
  assert.strictEqual(res.body.code, "EVENT_HAS_MATCHES");
  assert.ok(await Event.findById(event.body.event._id));
});

test("an empty event can be deleted, and only by its own organization", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, "Mine");
  const event = mockRes();
  await createOrgEvent(reqFor(owner, org, parsed(createOrgEventSchema, { name: "Abandoned Plan", eventType: "series" })), event);

  const otherOwner = await makeUser();
  const otherOrg = await makeOrg(otherOwner, "Theirs");
  const notMine = mockRes();
  await deleteOrgEvent(reqFor(otherOwner, otherOrg, {}, { eventId: String(event.body.event._id) }), notMine);
  assert.strictEqual(notMine.statusCode, 404);
  assert.ok(await Event.findById(event.body.event._id));

  const res = mockRes();
  await deleteOrgEvent(reqFor(owner, org, {}, { eventId: String(event.body.event._id) }), res);
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(await Event.findById(event.body.event._id), null);
});

// ---------------------------------------------------------------------------
// The guard itself
// ---------------------------------------------------------------------------
test("create_match is not implied by manage_players, and a coach cannot create a fixture", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const coach = await makeUser({ accountType: "viewer", role: "viewer" });
  await Membership.create({ organization: org._id, user: coach._id, roles: ["coach"] });

  // Drive the real guard the route uses, with the same params the route sees, so
  // this asserts the permission wiring rather than a hand-rolled copy of it.
  const res = mockRes();
  let passed = false;
  await requireOrgPermission(PERMISSIONS.CREATE_MATCH)(
    mockReq({ user: coach, principalType: "user", params: { id: String(org._id) } }),
    res,
    () => {
      passed = true;
    }
  );
  assert.strictEqual(passed, false, "a coach manages players, not fixtures");
  assert.strictEqual(res.statusCode, 403, JSON.stringify(res.body));

  // The owner holds every permission, so the same guard lets them through.
  const ownerRes = mockRes();
  let ownerPassed = false;
  await requireOrgPermission(PERMISSIONS.CREATE_MATCH)(
    mockReq({ user: owner, principalType: "user", params: { id: String(org._id) } }),
    ownerRes,
    () => {
      ownerPassed = true;
    }
  );
  assert.strictEqual(ownerPassed, true, JSON.stringify(ownerRes.body));
});

test("a non-member is refused before the permission is even considered", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const outsider = await makeUser();

  const res = mockRes();
  await requireOrgPermission(PERMISSIONS.CREATE_MATCH)(
    mockReq({ user: outsider, principalType: "user", params: { id: String(org._id) } }),
    res,
    () => {}
  );
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.code, "ORG_MEMBERSHIP_REQUIRED");
});
