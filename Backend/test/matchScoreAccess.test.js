import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";

import express from "express";
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
import Admin from "../src/models/Admin.js";
import { createOrganization } from "../src/controllers/organizationController.js";
import { generateToken } from "../src/utils/jwt.js";
import { requireMatchScoreAccess, resolveMatchScoreAccess } from "../src/middleware/matchAccess.js";

// This suite mounts the *real* match router and drives it over HTTP, because the
// reported bug was never in the permission matrix — it was in the route wiring.
// `orgPermissions.test.js` already proved a score_handler holds score_match, and
// the live API still answered 403 "Admin role required", which can only happen if
// the route used adminOnly. Testing the matrix again would have stayed green while
// the bug shipped, so these tests exercise the router itself.

let mongod;
let server;
let baseUrl;

before(async () => {
  mongod = await startTestDb();

  const { default: matchRoutes } = await import("../src/routes/matchRoutes.js");
  const { default: liveMatchRoutes } = await import("../src/routes/liveMatchRoutes.js");
  const app = express();
  app.use(express.json());
  app.use("/matches", matchRoutes);
  app.use("/livematch", liveMatchRoutes);

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
    Player.deleteMany({}),
    Match.deleteMany({}),
    Event.deleteMany({}),
    TeamCategory.deleteMany({}),
    TeamOrganization.deleteMany({}),
    Membership.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);
});

function call(method, path, token, body) {
  return new Promise((resolve) => {
    const url = new URL(path, `${baseUrl}/`);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
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
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

let counter = 0;
async function makeUser(overrides = {}) {
  counter += 1;
  return User.create({
    name: `Score Person ${counter}`,
    email: `score-${counter}-${Math.random().toString(36).slice(2, 8)}@openctest.dev`,
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

/** Give `user` a membership in `org` with exactly `roles`. */
async function addMember(org, user, roles) {
  return Membership.create({ organization: org._id, user: user._id, roles, status: "active" });
}

/** An org match, created directly so the suite does not depend on fixture setup. */
async function makeOrgMatch(org, teams) {
  return Match.create({
    title: "Org XI vs Org XI",
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
}

// Ball-by-ball and the innings around it. Squad composition is deliberately NOT
// here — see SQUAD_PATHS.
const SCORING_PATHS = [
  ["POST", "/score", { runs: 1 }],
  ["PUT", "/toss", { toss: {} }],
];

// Picking who plays. Gated on `create_match`, mirroring the org-scoped
// `PUT /organizations/:id/matches/:matchId/squads`.
//
// Built from a real team and real player ids so each call reaches its controller
// and returns 200 — otherwise `status !== 403` would pass on a 400/500 and prove
// nothing about the guard. `assert.ok` below is what makes that guarantee.
const squadRequests = (teamId, playerIds) => [
  ["PUT", "/playing-xi", { teamId, players: playerIds.slice(0, 11) }],
  ["PUT", "/openers", { inningsIndex: 0, batsman1Id: playerIds[0], batsman2Id: playerIds[1] }],
  ["PUT", "/squad15", { teamId, players: playerIds.slice(0, 11), captain: playerIds[0], viceCaptain: playerIds[1], wicketKeepers: [playerIds[2]] }],
  ["PUT", "/twelfth-man", { teamId, playerId: playerIds[11] }],
  ["PUT", "/bowling-xi", { teamId, players: playerIds.slice(0, 11) }],
  ["PUT", "/team-roles", { teamId, captain: playerIds[0], viceCaptain: playerIds[1], wicketKeepers: [playerIds[2]] }],
];

// ---------------------------------------------------------------------------
// The reported bug
// ---------------------------------------------------------------------------
test("a score_handler holding score_match is not told 'Admin role required'", async () => {
  const owner = await makeUser();
  const handler = await makeUser();
  const org = await makeOrg(owner, "Scoring Club");
  await addMember(org, handler, ["score_handler"]);
  const teams = [
    await Team.create({ name: "XI A", organizationRef: org._id }),
    await Team.create({ name: "XI B", organizationRef: org._id }),
  ];
  const match = await makeOrgMatch(org, teams);
  const token = generateToken(handler);

  for (const [method, path, body] of SCORING_PATHS) {
    const res = await call(method, `/matches/${match._id}${path}`, token, body);
    assert.notEqual(
      res.body?.message,
      "Admin role required",
      `${method} ${path} still answers with the platform-admin message`
    );
    assert.notStrictEqual(res.status, 403, `${method} ${path} was refused for a score_handler`);
  }
});

test("owner, admin, manager and score_handler all pass the guard", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, "Matrix Club");
  const teams = [
    await Team.create({ name: "XI A", organizationRef: org._id }),
    await Team.create({ name: "XI B", organizationRef: org._id }),
  ];
  const match = await makeOrgMatch(org, teams);

  const roles = ["admin", "manager", "score_handler"];
  for (const role of roles) {
    const user = await makeUser();
    await addMember(org, user, [role]);
    const res = await call("PUT", `/matches/${match._id}/toss`, generateToken(user), { toss: {} });
    assert.notStrictEqual(res.status, 403, `${role} was refused on a scoring route`);
  }

  // The owner needs no membership row: creating the org wrote one.
  const ownerRes = await call("PUT", `/matches/${match._id}/toss`, generateToken(owner), { toss: {} });
  assert.notStrictEqual(ownerRes.status, 403, "owner was refused on a scoring route");
});

test("a role without score_match is still refused", async () => {
  const owner = await makeUser();
  const social = await makeUser();
  const org = await makeOrg(owner, "Social Club");
  await addMember(org, social, ["social_media_handler"]);
  const teams = [
    await Team.create({ name: "XI A", organizationRef: org._id }),
    await Team.create({ name: "XI B", organizationRef: org._id }),
  ];
  const match = await makeOrgMatch(org, teams);

  const res = await call("PUT", `/matches/${match._id}/toss`, generateToken(social), { toss: {} });

  assert.strictEqual(res.status, 403);
});

// ---------------------------------------------------------------------------
// Scoring the innings and picking the squad are different jobs
// ---------------------------------------------------------------------------

// 12 players, so squad15 (11) and twelfth-man (the 12th) are both satisfiable.
const makeSquadClub = async (name) => {
  const owner = await makeUser();
  const org = await makeOrg(owner, name);
  const teams = [
    await Team.create({ name: "XI A", organizationRef: org._id }),
    await Team.create({ name: "XI B", organizationRef: org._id }),
  ];
  const players = await Promise.all(
    Array.from({ length: 12 }, () => makeUser())
  );
  const match = await makeOrgMatch(org, teams);
  return { owner, org, teams, match, playerIds: players.map((p) => p._id.toString()) };
};

test("a score_handler can score but cannot set the squads", async () => {
  const { org, match, playerIds } = await makeSquadClub("Split Club");
  const handler = await makeUser();
  await addMember(org, handler, ["score_handler"]);
  const token = generateToken(handler);

  const scoring = await call("PUT", `/matches/${match._id}/toss`, token, { toss: {} });
  assert.notStrictEqual(scoring.status, 403, "score_handler was refused on a scoring route");

  for (const [method, path, body] of squadRequests(match.teams[0]._id.toString(), playerIds)) {
    const res = await call(method, `/matches/${match._id}${path}`, token, body);
    assert.strictEqual(
      res.status,
      403,
      `score_handler was allowed to ${method} ${path} — appointing the squad needs create_match`
    );
    assert.strictEqual(res.body?.requiredPermission, "create_match");
  }
});

test("a create_match role can set the squads", async () => {
  const { owner, match, playerIds } = await makeSquadClub("Squad Club");
  const token = generateToken(owner);

  for (const [method, path, body] of squadRequests(match.teams[0]._id.toString(), playerIds)) {
    const res = await call(method, `/matches/${match._id}${path}`, token, body);
    assert.strictEqual(
      res.status,
      200,
      `owner got ${res.status} on ${method} ${path}: ${JSON.stringify(res.body)}`
    );
  }
});

test("a manager can set the squads — the guard is the org permission, not the platform role", async () => {
  // Regression guard for the original H-02 shape: if a squad route fell back to
  // `adminOnly`, a platform Admin would still pass and a manager would not.
  const { org, match, playerIds } = await makeSquadClub("Manager Squad Club");
  const manager = await makeUser();
  await addMember(org, manager, ["manager"]);
  const token = generateToken(manager);

  for (const [method, path, body] of squadRequests(match.teams[0]._id.toString(), playerIds)) {
    const res = await call(method, `/matches/${match._id}${path}`, token, body);
    assert.strictEqual(
      res.status,
      200,
      `manager got ${res.status} on ${method} ${path}: ${JSON.stringify(res.body)}`
    );
  }
});

test("a score_handler of one organization cannot score another organization's match", async () => {
  const ownerA = await makeUser();
  const ownerB = await makeUser();
  const handler = await makeUser();
  const orgA = await makeOrg(ownerA, "Club A");
  const orgB = await makeOrg(ownerB, "Club B");
  await addMember(orgA, handler, ["score_handler"]);
  const teams = [
    await Team.create({ name: "XI A", organizationRef: orgB._id }),
    await Team.create({ name: "XI B", organizationRef: orgB._id }),
  ];
  const match = await makeOrgMatch(orgB, teams);

  const res = await call("PUT", `/matches/${match._id}/toss`, generateToken(handler), { toss: {} });

  assert.strictEqual(res.status, 403, "cross-tenant scoring must be refused");
});

test("legacy live ball route uses the same tenant-scoped score_match guard", async () => {
  const owner = await makeUser();
  const scorer = await makeUser();
  const nonScoringMember = await makeUser();
  const outsider = await makeUser();
  const org = await makeOrg(owner, "Legacy Live Club");
  const otherOrg = await makeOrg(outsider, "Legacy Other Club");
  await addMember(org, scorer, ["score_handler"]);
  await addMember(org, nonScoringMember, ["social_media_handler"]);
  const teams = [
    await Team.create({ name: "Live XI A", organizationRef: org._id }),
    await Team.create({ name: "Live XI B", organizationRef: org._id }),
  ];
  const match = await makeOrgMatch(org, teams);
  const [striker, nonStriker, bowler] = await Player.create([
    { name: "OPENCODE_TEST_live_striker" },
    { name: "OPENCODE_TEST_live_non_striker" },
    { name: "OPENCODE_TEST_live_bowler" },
  ]);
  const payload = {
    inningsIndex: 0,
    runs: 1,
    batsmanOnStrikeId: String(striker._id),
    batsmanNonStrikeId: String(nonStriker._id),
    bowlerId: String(bowler._id),
    customCommentary: true,
    commentaryText: "OPENCODE_TEST local guard probe",
  };

  const allowed = await call("POST", `/livematch/${match._id}/ball`, generateToken(scorer), payload);
  assert.equal(allowed.status, 200, `assigned scorer should score: ${JSON.stringify(allowed.body)}`);

  for (const [user, label] of [[outsider, "no membership"], [nonScoringMember, "member without score_match"]]) {
    const refused = await call("POST", `/livematch/${match._id}/ball`, generateToken(user), payload);
    assert.equal(refused.status, 403, `${label} must be refused`);
  }

  const foreignTeams = [
    await Team.create({ name: "Foreign XI A", organizationRef: otherOrg._id }),
    await Team.create({ name: "Foreign XI B", organizationRef: otherOrg._id }),
  ];
  const foreignMatch = await makeOrgMatch(otherOrg, foreignTeams);
  const crossTenant = await call("POST", `/livematch/${foreignMatch._id}/ball`, generateToken(scorer), payload);
  assert.equal(crossTenant.status, 403, "scorer of another org must be refused");
});

test("a removed membership loses scoring access", async () => {
  const owner = await makeUser();
  const handler = await makeUser();
  const org = await makeOrg(owner, "Removed Club");
  const membership = await addMember(org, handler, ["score_handler"]);
  const teams = [
    await Team.create({ name: "XI A", organizationRef: org._id }),
    await Team.create({ name: "XI B", organizationRef: org._id }),
  ];
  const match = await makeOrgMatch(org, teams);

  const before = await call("PUT", `/matches/${match._id}/toss`, generateToken(handler), { toss: {} });
  assert.notStrictEqual(before.status, 403);

  membership.status = "removed";
  await membership.save();

  const after = await call("PUT", `/matches/${match._id}/toss`, generateToken(handler), { toss: {} });
  assert.strictEqual(after.status, 403, "a removed member must not keep scoring");
});

// ---------------------------------------------------------------------------
// Platform admins and org-less matches
// ---------------------------------------------------------------------------
test("a platform admin may score any organization's match", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, "Admin Club");
  const teams = [
    await Team.create({ name: "XI A", organizationRef: org._id }),
    await Team.create({ name: "XI B", organizationRef: org._id }),
  ];
  const match = await makeOrgMatch(org, teams);
  const admin = await Admin.create({
    name: "Platform Admin",
    email: "platform-admin@openctest.dev",
    password: "password-123",
    role: "admin",
  });

  const res = await call("PUT", `/matches/${match._id}/toss`, generateToken(admin), { toss: {} });

  assert.notStrictEqual(res.status, 403, "a platform admin must not be refused");
});

test("a match with no organizationRef stays platform-admin-only", async () => {
  const teams = [
    await Team.create({ name: "XI A" }),
    await Team.create({ name: "XI B" }),
  ];
  const match = await Match.create({
    title: "Historic Fixture",
    venue: "Ground",
    matchType: "T20",
    startAt: new Date(),
    teams,
    status: "live",
  });
  const owner = await makeUser();
  const org = await makeOrg(owner, "Unrelated Club");
  const handler = await makeUser();
  await addMember(org, handler, ["owner", "manager", "score_handler"]);

  const res = await call("PUT", `/matches/${match._id}/toss`, generateToken(handler), { toss: {} });

  assert.strictEqual(res.status, 403, "an org role must not reach a match with no tenant");
});

// ---------------------------------------------------------------------------
// Fixture setup stays platform-admin-only
// ---------------------------------------------------------------------------
test("creating and deleting a match fixture still requires the platform admin", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, "Fixture Club");

  const created = await call(
    "POST",
    "/matches",
    generateToken(owner),
    {
      title: "Self Created",
      matchType: "T20",
      startAt: new Date().toISOString(),
      teams: [String(new mongoose.Types.ObjectId()), String(new mongoose.Types.ObjectId())],
    }
  );
  assert.strictEqual(created.status, 403, "an org owner must not create fixtures directly");

  const teams = [
    await Team.create({ name: "XI A", organizationRef: org._id }),
    await Team.create({ name: "XI B", organizationRef: org._id }),
  ];
  const match = await makeOrgMatch(org, teams);
  const deleted = await call("DELETE", `/matches/${match._id}`, generateToken(owner));
  assert.strictEqual(deleted.status, 403, "an org owner must not delete fixtures directly");
});

// ---------------------------------------------------------------------------
// The guard itself
// ---------------------------------------------------------------------------
test("resolveMatchScoreAccess reports why access was refused", async () => {
  const owner = await makeUser();
  const outsider = await makeUser();
  const org = await makeOrg(owner, "Reason Club");
  const teams = [
    await Team.create({ name: "XI A", organizationRef: org._id }),
    await Team.create({ name: "XI B", organizationRef: org._id }),
  ];
  const match = await makeOrgMatch(org, teams);

  const allowed = await resolveMatchScoreAccess(mockReq({ user: owner, principalType: "user" }), match);
  assert.strictEqual(allowed.allowed, true);
  assert.ok(allowed.via, "an allowed request says how it was allowed");

  const denied = await resolveMatchScoreAccess(mockReq({ user: outsider, principalType: "user" }), match);
  assert.strictEqual(denied.allowed, false);
  assert.ok(denied.reason, "a refusal explains itself");
});

test("a malformed match id is a 400, not a cast error", async () => {
  const res = mockRes();
  let passed = false;
  await requireMatchScoreAccess("matchId")(
    mockReq({ user: {}, principalType: "user", params: { matchId: "not-an-id" } }),
    res,
    () => { passed = true; }
  );

  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(passed, false);
});
