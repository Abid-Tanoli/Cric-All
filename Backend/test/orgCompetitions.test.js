import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";

import express from "express";
import mongoose from "mongoose";
import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import User from "../src/models/User.js";
import Admin from "../src/models/Admin.js";
import Team from "../src/models/Team.js";
import Match from "../src/models/Match.js";
import Event from "../src/models/Event.js";
import Tournament from "../src/models/Tournament.js";
import Series from "../src/models/Series.js";
import TeamOrganization from "../src/models/TeamOrganization.js";
import Membership from "../src/models/Membership.js";
import AuditLog from "../src/models/AuditLog.js";
import SystemSettings from "../src/models/SystemSettings.js";
import { createOrganization } from "../src/controllers/organizationController.js";
import { generateToken } from "../src/utils/jwt.js";

// Phase 2 (org-owned competitions) — the tenant layer over the Admin
// tournament/series handlers.
//
// This suite mounts the *real* organization and match routers and drives them
// over HTTP, because the interesting failures are in the route wiring (which
// permission guards a route, and whether a by-id route scopes to the caller's
// organization) rather than in the permission map alone. Every case therefore
// asserts either "the guard refused with 403" or "the guard let it through", and
// a separate suite asserts that another tenant's competition is a 404, never a
// 200 and never a 403 that would confirm it exists.

let mongod;
let server;
let baseUrl;

before(async () => {
  mongod = await startTestDb();

  const { default: organizationRoutes } = await import("../src/routes/organizationRoutes.js");
  const { default: matchRoutes } = await import("../src/routes/matchRoutes.js");
  const { default: tournamentRoutes } = await import("../src/routes/tournamentRoutes.js");
  const app = express();
  app.use(express.json());
  app.use("/organizations", organizationRoutes);
  app.use("/matches", matchRoutes);
  app.use("/tournaments", tournamentRoutes);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Admin.deleteMany({}),
    Team.deleteMany({}),
    Match.deleteMany({}),
    Event.deleteMany({}),
    Tournament.deleteMany({}),
    Series.deleteMany({}),
    TeamOrganization.deleteMany({}),
    Membership.deleteMany({}),
    AuditLog.deleteMany({}),
    SystemSettings.deleteMany({}),
  ]);
});

function call(method, path, token, body) {
  return new Promise((resolve) => {
    const url = new URL(path, `${baseUrl}/`);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };
    const r = http.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        let data = null;
        try { data = JSON.parse(text); } catch { data = text; }
        resolve({ status: res.statusCode, body: data });
      });
    });
    r.on("error", (err) => resolve({ status: 0, body: { message: err.message } }));
    if (body !== undefined) r.write(JSON.stringify(body));
    r.end();
  });
}

let counter = 0;
const uniq = () => {
  counter += 1;
  return `${counter}-${Math.random().toString(36).slice(2, 8)}`;
};

async function makeUser(overrides = {}) {
  return User.create({
    name: `Competition Person ${uniq()}`,
    email: `competition-${uniq()}@openctest.dev`,
    password: "password-123",
    role: "scorer",
    accountType: "organization_admin",
    emailVerified: true,
    ...overrides,
  });
}

async function makeOrg(owner, name) {
  const res = mockRes();
  await createOrganization(mockReq({ user: owner, principalType: "user", body: { name } }), res);
  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
  return res.body.organization;
}

async function addMember(org, user, roles) {
  return Membership.create({ organization: org._id, user: user._id, roles, status: "active" });
}

const plusDays = (days) => new Date(Date.now() + days * 86_400_000);

/**
 * One complete world: two organizations, a manager and a score handler in A, an
 * outsider with no membership, a platform admin, and one competition of each
 * kind per organization. Every test builds its own so a destructive route in one
 * case can never bleed into another.
 */
async function makeWorld() {
  const tag = uniq();
  const ownerA = await makeUser();
  const managerA = await makeUser();
  const scorerA = await makeUser();
  const stranger = await makeUser();
  const ownerB = await makeUser();
  const admin = await Admin.create({
    name: `Platform Admin ${tag}`,
    email: `platform-admin-${tag}@openctest.dev`,
    password: "password-123",
    role: "admin",
  });

  const orgA = await makeOrg(ownerA, `Competition Club A ${tag}`);
  const orgB = await makeOrg(ownerB, `Competition Club B ${tag}`);
  await addMember(orgA, managerA, ["manager"]);
  await addMember(orgA, scorerA, ["score_handler"]);

  const [teamA1, teamA2, teamB1, teamB2] = await Team.create([
    { name: `A XI One ${tag}`, organizationRef: orgA._id },
    { name: `A XI Two ${tag}`, organizationRef: orgA._id },
    { name: `B XI One ${tag}`, organizationRef: orgB._id },
    { name: `B XI Two ${tag}`, organizationRef: orgB._id },
  ]);

  const tournamentA = await Tournament.create({
    name: `Org A Cup ${tag}`,
    type: "knockout",
    startDate: plusDays(-1),
    endDate: plusDays(2),
    teams: [teamA1._id, teamA2._id],
    organizationRef: orgA._id,
  });
  const tournamentB = await Tournament.create({
    name: `Org B Cup ${tag}`,
    type: "knockout",
    startDate: plusDays(-1),
    endDate: plusDays(2),
    teams: [teamB1._id, teamB2._id],
    organizationRef: orgB._id,
  });
  const seriesA = await Series.create({
    name: `Org A Series ${tag}`,
    organizationRef: orgA._id,
    teams: [teamA1._id, teamA2._id],
  });
  const seriesB = await Series.create({
    name: `Org B Series ${tag}`,
    organizationRef: orgB._id,
    teams: [teamB1._id, teamB2._id],
  });

  const eventA = await Event.create({
    name: `Org A Event ${tag}`,
    eventType: "series",
    organization: orgA._id,
    startDate: plusDays(-1),
    endDate: plusDays(2),
  });
  const eventB = await Event.create({
    name: `Org B Event ${tag}`,
    eventType: "series",
    organization: orgB._id,
    startDate: plusDays(-1),
    endDate: plusDays(2),
  });

  const makeMatch = (org, teams) =>
    Match.create({
      title: `${org.name} fixture ${tag}`,
      venue: "Ground",
      matchType: "T20",
      startAt: new Date(),
      teams,
      organizationRef: org._id,
      organization: org.name,
      status: "live",
      innings: [
        { team: teams[0], status: "live" },
        { team: teams[1], status: "upcoming" },
      ],
    });
  const matchA = await makeMatch(orgA, [teamA1._id, teamA2._id]);
  const matchB = await makeMatch(orgB, [teamB1._id, teamB2._id]);

  return {
    ownerA, managerA, scorerA, stranger, ownerB, admin,
    orgA, orgB, teamA1, teamA2, teamB1, teamB2,
    tournamentA, tournamentB, seriesA, seriesB, eventA, eventB, matchA, matchB,
  };
}

function actorsOf(w) {
  return {
    owner: generateToken(w.ownerA),
    manager: generateToken(w.managerA),
    score_handler: generateToken(w.scorerA),
    stranger: generateToken(w.stranger),
    other_org_owner: generateToken(w.ownerB),
    platform_admin: generateToken(w.admin),
  };
}

// Who the guards should let through each kind of route.
const READ = ["owner", "manager", "score_handler", "platform_admin"];
const COMP = ["owner", "platform_admin"];
const FIXTURE = ["owner", "manager", "platform_admin"];
// Product rule: hard-deletes are platform-admin-only; every org role is refused.
const PLATFORM_DELETE = ["platform_admin"];

/** Every new org competition route, with the roles allowed to pass its guard. */
function routeCases(w) {
  const o = `/organizations/${w.orgA._id}`;
  const t = `${o}/tournaments/${w.tournamentA._id}`;
  const s = `${o}/series/${w.seriesA._id}`;
  return [
    { name: "list tournaments", method: "GET", path: `${o}/tournaments`, allowed: READ },
    {
      name: "create tournament", method: "POST", path: `${o}/tournaments`, allowed: COMP,
      body: () => ({ name: `Created Cup ${uniq()}`, type: "knockout", startDate: plusDays(0), endDate: plusDays(1), teams: [w.teamA1._id, w.teamA2._id] }),
    },
    { name: "get tournament", method: "GET", path: t, allowed: READ },
    { name: "update tournament", method: "PUT", path: t, allowed: COMP, body: () => ({ venue: "Updated Ground" }) },
    { name: "add tournament teams", method: "POST", path: `${t}/teams`, allowed: COMP, body: () => ({ teamIds: [w.teamA2._id] }) },
    { name: "remove tournament team", method: "DELETE", path: `${t}/teams/${w.teamA2._id}`, allowed: COMP },
    { name: "set groups", method: "PUT", path: `${t}/groups`, allowed: COMP, body: () => ({ groups: [{ name: "A", teams: [w.teamA1._id, w.teamA2._id] }] }) },
    { name: "points table", method: "GET", path: `${t}/points-table`, allowed: READ },
    { name: "recompute points", method: "POST", path: `${t}/points-table/recompute`, allowed: COMP },
    { name: "fixtures list", method: "GET", path: `${t}/fixtures`, allowed: READ },
    { name: "fixtures preview", method: "POST", path: `${t}/fixtures/preview`, allowed: FIXTURE, body: () => ({}) },
    { name: "fixtures apply", method: "POST", path: `${t}/fixtures/apply`, allowed: FIXTURE, body: () => ({}) },
    { name: "create tournament match", method: "POST", path: `${t}/matches`, allowed: FIXTURE, body: () => ({ team1: w.teamA1._id, team2: w.teamA2._id }) },
    { name: "create standalone match", method: "POST", path: `${o}/matches`, allowed: FIXTURE, body: () => ({ teams: [w.teamA1._id, w.teamA2._id], startAt: new Date().toISOString() }) },
    { name: "delete match", method: "DELETE", path: `${o}/matches/${w.matchA._id}`, allowed: PLATFORM_DELETE },
    { name: "delete event", method: "DELETE", path: `${o}/events/${w.eventA._id}`, allowed: PLATFORM_DELETE },
    { name: "get squads", method: "GET", path: `${t}/squad`, allowed: READ },
    { name: "get team squad", method: "GET", path: `${t}/squad/${w.teamA1._id}`, allowed: READ },
    { name: "set squad", method: "POST", path: `${t}/squad`, allowed: FIXTURE, body: () => ({ teamId: w.teamA1._id, players: [] }) },
    { name: "delete squad", method: "DELETE", path: `${t}/squad/${w.teamA1._id}`, allowed: FIXTURE },
    { name: "set awards", method: "PUT", path: `${t}/awards`, allowed: COMP, body: () => ({ winner: w.teamA1._id }) },
    { name: "set official awards", method: "PUT", path: `${t}/official-awards`, allowed: COMP, body: () => ({ bestBatsman: null }) },
    { name: "delete tournament", method: "DELETE", path: t, allowed: PLATFORM_DELETE },
    { name: "list series", method: "GET", path: `${o}/series`, allowed: READ },
    { name: "create series", method: "POST", path: `${o}/series`, allowed: COMP, body: () => ({ name: `Created Series ${uniq()}` }) },
    { name: "get series", method: "GET", path: s, allowed: READ },
    { name: "update series", method: "PUT", path: s, allowed: COMP, body: () => ({ venue: "Series Ground" }) },
    { name: "delete series", method: "DELETE", path: s, allowed: PLATFORM_DELETE },
    { name: "toggle 12th man", method: "PUT", path: `${o}/matches/${w.matchA._id}/twelfth-man`, allowed: COMP, body: () => ({ enabled: true }) },
  ];
}

// ---------------------------------------------------------------------------
// Permission matrix
// ---------------------------------------------------------------------------
test("permission matrix: every org competition route allows exactly the right roles", async () => {
  const w = await makeWorld();
  const actors = actorsOf(w);
  const failures = [];
  // A single world is enough: the assertion is guard-shaped (a role is either
  // refused with 403, or the guard lets the request through). A route that
  // deletes a resource therefore cannot corrupt a later case — the permission
  // guard still answers 403 for the roles it refuses, and a gone resource is a
  // 404 for the roles it allows.
  for (const routeCase of routeCases(w)) {
    for (const [role, token] of Object.entries(actors)) {
      const body = routeCase.body ? routeCase.body() : undefined;
      const res = await call(routeCase.method, routeCase.path, token, body);
      const allowed = routeCase.allowed.includes(role);
      if (allowed) {
        if (res.status === 403 || res.status === 401) {
          failures.push(`${routeCase.name} [${role}] unexpectedly refused ${res.status}: ${JSON.stringify(res.body)}`);
        }
      } else if (res.status !== 403) {
        failures.push(`${routeCase.name} [${role}] expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

// ---------------------------------------------------------------------------
// Owner/admin can actually run a competition
// ---------------------------------------------------------------------------
test("an owner creates a tournament and a series, and both are stamped with the organization", async () => {
  const w = await makeWorld();
  const token = generateToken(w.ownerA);

  const created = await call("POST", `/organizations/${w.orgA._id}/tournaments`, token, {
    name: `Stamped Cup ${uniq()}`,
    type: "knockout",
    startDate: plusDays(0),
    endDate: plusDays(1),
    teams: [w.teamA1._id, w.teamA2._id],
  });
  assert.strictEqual(created.status, 201, JSON.stringify(created.body));
  const tournamentId = created.body.tournament._id;

  const series = await call("POST", `/organizations/${w.orgA._id}/series`, token, { name: `Stamped Series ${uniq()}` });
  assert.strictEqual(series.status, 201, JSON.stringify(series.body));

  const [tournamentDoc, seriesDoc] = await Promise.all([
    Tournament.findById(tournamentId).lean(),
    Series.findById(series.body._id).lean(),
  ]);
  assert.strictEqual(String(tournamentDoc.organizationRef), String(w.orgA._id));
  assert.strictEqual(String(seriesDoc.organizationRef), String(w.orgA._id));
  // An org-created tournament is owned through organizationRef, not createdByAdmin.
  assert.strictEqual(tournamentDoc.createdByAdmin, null);

  const list = await call("GET", `/organizations/${w.orgA._id}/tournaments`, token);
  assert.strictEqual(list.status, 200);
  assert.ok(list.body.items.some((item) => String(item._id) === String(tournamentId)), "the new tournament is listed");
  assert.ok(
    !list.body.items.some((item) => String(item._id) === String(w.tournamentB._id)),
    "another organization's tournament is not listed"
  );
});

test("a manager can create a match inside the tournament but cannot create a tournament", async () => {
  const w = await makeWorld();
  const token = generateToken(w.managerA);

  const forbidden = await call("POST", `/organizations/${w.orgA._id}/tournaments`, token, {
    name: `Manager Cup ${uniq()}`,
    type: "knockout",
    startDate: plusDays(0),
    endDate: plusDays(1),
    teams: [w.teamA1._id, w.teamA2._id],
  });
  assert.strictEqual(forbidden.status, 403);
  assert.strictEqual(forbidden.body?.requiredPermission, "manage_competitions");

  const created = await call("POST", `/organizations/${w.orgA._id}/tournaments/${w.tournamentA._id}/matches`, token, {
    team1: w.teamA1._id,
    team2: w.teamA2._id,
    startAt: new Date().toISOString(),
  });
  assert.ok(created.status === 201 || created.status === 200, JSON.stringify(created.body));
  const matchId = created.body?.match?._id;
  assert.ok(matchId, "a match id is returned");
  const matchDoc = await Match.findById(matchId).lean();
  assert.strictEqual(String(matchDoc.organizationRef), String(w.orgA._id));
  assert.strictEqual(String(matchDoc.tournament), String(w.tournamentA._id));
});

// ---------------------------------------------------------------------------
// Cross-tenant: another tenant's document is a 404, never a confirmation
// ---------------------------------------------------------------------------
test("a member of one org gets a 404 for another org's tournament, series and match", async () => {
  const w = await makeWorld();
  const token = generateToken(w.ownerA);
  const o = `/organizations/${w.orgA._id}`;
  const tB = `${o}/tournaments/${w.tournamentB._id}`;
  const sB = `${o}/series/${w.seriesB._id}`;

  const cases = [
    ["GET", tB],
    ["PUT", tB, { venue: "Hijack" }],
    ["POST", `${tB}/teams`, { teamIds: [w.teamB1._id] }],
    ["DELETE", `${tB}/teams/${w.teamB1._id}`],
    ["PUT", `${tB}/groups`, { groups: [{ name: "A", teams: [w.teamB1._id, w.teamB2._id] }] }],
    ["GET", `${tB}/points-table`],
    ["POST", `${tB}/points-table/recompute`],
    ["GET", `${tB}/fixtures`],
    ["POST", `${tB}/fixtures/preview`, {}],
    ["POST", `${tB}/fixtures/apply`, {}],
    ["POST", `${tB}/matches`, { team1: w.teamB1._id, team2: w.teamB2._id }],
    ["GET", `${tB}/squad`],
    ["GET", `${tB}/squad/${w.teamB1._id}`],
    ["POST", `${tB}/squad`, { teamId: w.teamB1._id, players: [] }],
    ["DELETE", `${tB}/squad/${w.teamB1._id}`],
    ["PUT", `${tB}/awards`, { winner: w.teamB1._id }],
    ["PUT", `${tB}/official-awards`, { bestBatsman: null }],
    ["GET", sB],
    ["PUT", sB, { venue: "Hijack" }],
    ["PATCH", `${o}/matches/${w.matchB._id}`, { venue: "Hijack" }],
    ["PUT", `${o}/matches/${w.matchB._id}/twelfth-man`, { enabled: true }],
  ];

  for (const [method, path, body] of cases) {
    const res = await call(method, path, token, body);
    assert.strictEqual(res.status, 404, `${method} ${path} leaked ${res.status}: ${JSON.stringify(res.body)}`);
  }

  // Deletes are platform-admin-only, so they refuse with a blanket 403 that does
  // not depend on whose document it is (the owner is refused its own too — see
  // the permission matrix), and the target is never even resolved.
  const deletePaths = [tB, sB, `${o}/matches/${w.matchB._id}`, `${o}/events/${w.eventB._id}`];
  for (const path of deletePaths) {
    const res = await call("DELETE", path, token);
    assert.strictEqual(res.status, 403, `DELETE ${path} leaked ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body?.code, "ADMIN_ONLY_DELETE", `DELETE ${path} returned code ${res.body?.code}`);
  }

  // Nothing was touched.
  const stillThere = await Tournament.findById(w.tournamentB._id).lean();
  assert.ok(stillThere, "the other org's tournament survives");
  assert.strictEqual(stillThere.venue, "", "the other org's tournament was not edited");
});

test("the guest organization cannot edit the host's tournament or its match", async () => {
  const w = await makeWorld();
  const token = generateToken(w.ownerB);

  // Owner B is not a member of A, so the permission guard refuses before the
  // resource is even looked up.
  const tournament = await call("PUT", `/organizations/${w.orgA._id}/tournaments/${w.tournamentA._id}`, token, { venue: "Hijack" });
  assert.strictEqual(tournament.status, 403);

  // Even framed under their own organization, the host's tournament is not found.
  const underOwnOrg = await call("PUT", `/organizations/${w.orgB._id}/tournaments/${w.tournamentA._id}`, token, { venue: "Hijack" });
  assert.strictEqual(underOwnOrg.status, 404);
});

// ---------------------------------------------------------------------------
// Guest teams
// ---------------------------------------------------------------------------
test("a guest team may play once registered in the host tournament, but not before", async () => {
  const w = await makeWorld();
  const token = generateToken(w.ownerA);
  const o = `/organizations/${w.orgA._id}`;

  // A standalone fixture in A may not use B's team.
  const standalone = await call("POST", `${o}/matches`, token, {
    teams: [w.teamA1._id, w.teamB1._id],
    startAt: new Date().toISOString(),
  });
  assert.strictEqual(standalone.status, 422);
  assert.strictEqual(standalone.body?.code, "MATCH_TEAM_NOT_IN_ORG");

  // Nor may an unregistered guest appear in A's tournament.
  const unregistered = await call("POST", `${o}/matches`, token, {
    teams: [w.teamA1._id, w.teamB1._id],
    tournamentId: w.tournamentA._id,
    startAt: new Date().toISOString(),
  });
  assert.strictEqual(unregistered.status, 422);
  assert.strictEqual(unregistered.body?.code, "TOURNAMENT_TEAM_NOT_REGISTERED");

  // Register B's team in A's tournament, then it is a legitimate participant.
  const added = await call("POST", `${o}/tournaments/${w.tournamentA._id}/teams`, token, { teamIds: [w.teamB1._id] });
  assert.strictEqual(added.status, 200, JSON.stringify(added.body));

  const fixture = await call("POST", `${o}/matches`, token, {
    teams: [w.teamA1._id, w.teamB1._id],
    tournamentId: w.tournamentA._id,
    startAt: new Date().toISOString(),
  });
  assert.strictEqual(fixture.status, 201, JSON.stringify(fixture.body));
  // The guest plays in the host's match: the host's tenant, not the guest's.
  const matchDoc = await Match.findById(fixture.body.match._id).lean();
  assert.strictEqual(String(matchDoc.organizationRef), String(w.orgA._id));
});

// ---------------------------------------------------------------------------
// Scoring a match still belongs to the tenant
// ---------------------------------------------------------------------------
test("scoring and undo on an org match follow score_match, not the platform role", async () => {
  const w = await makeWorld();
  const actors = actorsOf(w);
  const allowed = ["owner", "manager", "score_handler", "platform_admin"];
  const endpoints = [
    ["POST", `/matches/${w.matchA._id}/score`, { runs: 1 }],
    ["POST", `/matches/${w.matchA._id}/revert-ball`, {}],
  ];

  const failures = [];
  for (const [method, path, body] of endpoints) {
    for (const [role, token] of Object.entries(actors)) {
      const res = await call(method, path, token, body);
      if (allowed.includes(role)) {
        if (res.status === 403 || res.status === 401) failures.push(`${path} [${role}] refused ${res.status}`);
      } else if (res.status !== 403) {
        failures.push(`${path} [${role}] expected 403, got ${res.status}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

// ---------------------------------------------------------------------------
// 12th Man / Super Sub is controlled by the host organization
// ---------------------------------------------------------------------------
test("an org match's 12th Man rule ignores the platform master switch", async () => {
  const w = await makeWorld();
  const token = generateToken(w.ownerA);
  // Platform master switch explicitly OFF. makeWorld() has already created the
  // settings row through getPlatformSettings(), so upsert rather than create.
  await SystemSettings.findOneAndUpdate(
    { key: "platform" },
    { $set: { value: { enableSuperSub: false } } },
    { upsert: true }
  );

  const toggled = await call("PUT", `/organizations/${w.orgA._id}/matches/${w.matchA._id}/twelfth-man`, token, { enabled: true });
  assert.strictEqual(toggled.status, 200, JSON.stringify(toggled.body));
  assert.strictEqual(toggled.body?.rules?.twelfthManEnabled, true);

  const squads = await call("GET", `/matches/${w.matchA._id}/squads`, token);
  assert.strictEqual(squads.status, 200);
  assert.strictEqual(squads.body?.rules?.twelfthMan?.organizationControlled, true);
  assert.strictEqual(squads.body?.rules?.twelfthMan?.enabled, true, "the host's setting is authoritative");

  // A platform (org-less) match is still blocked by the master switch.
  const platformMatch = await Match.create({
    title: `Platform fixture ${uniq()}`,
    matchType: "T20",
    startAt: new Date(),
    teams: [w.teamA1._id, w.teamA2._id],
    status: "upcoming",
  });
  // A platform admin passes the access guard, so the 403 below can only be the
  // platform master switch — which still gates an org-less match.
  const blocked = await call("PUT", `/matches/${platformMatch._id}/impact-player`, generateToken(w.admin), {
    teamId: w.teamA1._id,
    playerId: String(new mongoose.Types.ObjectId()),
    replacesPlayerId: String(new mongoose.Types.ObjectId()),
  });
  assert.strictEqual(blocked.status, 403);
  assert.strictEqual(blocked.body?.code, "TWELFTH_MAN_DISABLED");
});

// ---------------------------------------------------------------------------
// The Admin surface is unchanged
// ---------------------------------------------------------------------------
test("a platform admin still runs platform tournaments, and an org owner cannot use the Admin route", async () => {
  const w = await makeWorld();
  const adminToken = generateToken(w.admin);
  const ownerToken = generateToken(w.ownerA);

  const created = await call("POST", "/tournaments", adminToken, {
    name: `Platform Cup ${uniq()}`,
    type: "knockout",
    startDate: plusDays(0),
    endDate: plusDays(1),
    teams: [w.teamA1._id, w.teamA2._id],
  });
  assert.strictEqual(created.status, 201, JSON.stringify(created.body));
  const platformTournament = await Tournament.findById(created.body.tournament._id).lean();
  assert.strictEqual(platformTournament.organizationRef, null, "an Admin-created tournament stays platform-owned");

  const refused = await call("POST", "/tournaments", ownerToken, {
    name: `Owner Cup ${uniq()}`,
    type: "knockout",
    startDate: plusDays(0),
    endDate: plusDays(1),
    teams: [w.teamA1._id, w.teamA2._id],
  });
  assert.strictEqual(refused.status, 403);
});
