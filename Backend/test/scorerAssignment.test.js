import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";

import express from "express";
import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import User from "../src/models/User.js";
import Team from "../src/models/Team.js";
import Match from "../src/models/Match.js";
import TeamOrganization from "../src/models/TeamOrganization.js";
import Membership from "../src/models/Membership.js";
import AuditLog from "../src/models/AuditLog.js";
import MatchOfficial from "../src/models/MatchOfficial.js";
import Admin from "../src/models/Admin.js";
import { createOrganization } from "../src/controllers/organizationController.js";
import { generateToken } from "../src/utils/jwt.js";

// P2: a club can have several score handlers, but a knockout fixture is run by
// ONE of them. These tests mount the real match router and prove that an
// assignment narrows who may open the scoring screen, without breaking the
// Phase 9 rule for unassigned fixtures.

let mongod;
let server;
let baseUrl;

before(async () => {
  mongod = await startTestDb();

  const { default: matchRoutes } = await import("../src/routes/matchRoutes.js");
  const app = express();
  app.use(express.json());
  app.use("/matches", matchRoutes);

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
    TeamOrganization.deleteMany({}),
    Membership.deleteMany({}),
    AuditLog.deleteMany({}),
    MatchOfficial.deleteMany({}),
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
    name: `OPENCODE_TEST_Scorer ${counter}`,
    email: `scorer-${counter}-${Math.random().toString(36).slice(2, 8)}@openctest.dev`,
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

async function makeOrgMatch(org, teams) {
  return Match.create({
    title: "OPENCODE_TEST_Knockout QF",
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

async function club() {
  const owner = await makeUser();
  const handlerA = await makeUser();
  const handlerB = await makeUser();
  const org = await makeOrg(owner, `OPENCODE_TEST_Scorer Club ${counter}`);
  await addMember(org, handlerA, ["score_handler"]);
  await addMember(org, handlerB, ["score_handler"]);
  const teams = [
    await Team.create({ name: "OPENCODE_TEST XI A", organizationRef: org._id }),
    await Team.create({ name: "OPENCODE_TEST XI B", organizationRef: org._id }),
  ];
  const match = await makeOrgMatch(org, teams);
  return { owner, handlerA, handlerB, org, match };
}

test("an assigned scorer may score the match and a sibling handler is refused", async () => {
  const { owner, handlerA, handlerB, match } = await club();
  const matchId = String(match._id);

  // Before assignment both handlers pass the Phase 9 guard.
  const before = await call("PUT", `/matches/${matchId}/toss`, generateToken(handlerB), { toss: {} });
  assert.notStrictEqual(before.status, 403, JSON.stringify(before.body));

  // The owner (create_match) assigns handler A.
  const assigned = await call(
    "PUT",
    `/matches/${matchId}/scorers`,
    generateToken(owner),
    { scorerIds: [String(handlerA._id)] }
  );
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  assert.equal(assigned.body.assignedScorers.length, 1);
  assert.equal(String(assigned.body.assignedScorers[0]._id), String(handlerA._id));

  // The assigned scorer scores.
  const allowed = await call("PUT", `/matches/${matchId}/toss`, generateToken(handlerA), { toss: {} });
  assert.notStrictEqual(allowed.status, 403, JSON.stringify(allowed.body));

  // The sibling handler is refused, with a code the UI can explain.
  const refused = await call("PUT", `/matches/${matchId}/toss`, generateToken(handlerB), { toss: {} });
  assert.equal(refused.status, 403, JSON.stringify(refused.body));
  assert.equal(refused.body.code, "MATCH_SCORER_NOT_ASSIGNED");

  // The club owner keeps supervisory access.
  const ownerRes = await call("PUT", `/matches/${matchId}/toss`, generateToken(owner), { toss: {} });
  assert.notStrictEqual(ownerRes.status, 403, JSON.stringify(ownerRes.body));

  // So does a platform admin.
  const admin = await Admin.create({
    name: "Platform Admin",
    email: `platform-${counter}@openctest.dev`,
    password: "password-123",
    role: "admin",
  });
  const adminRes = await call("PUT", `/matches/${matchId}/toss`, generateToken(admin), { toss: {} });
  assert.notStrictEqual(adminRes.status, 403, JSON.stringify(adminRes.body));
});

test("clearing the assignment restores the org-wide score_match rule", async () => {
  const { owner, handlerA, handlerB, match } = await club();
  const matchId = String(match._id);

  await call("PUT", `/matches/${matchId}/scorers`, generateToken(owner), { scorerIds: [String(handlerA._id)] });
  const blocked = await call("PUT", `/matches/${matchId}/toss`, generateToken(handlerB), { toss: {} });
  assert.equal(blocked.status, 403);

  const cleared = await call("PUT", `/matches/${matchId}/scorers`, generateToken(owner), { scorerIds: [] });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.equal((cleared.body.assignedScorers || []).length, 0);

  const reopened = await call("PUT", `/matches/${matchId}/toss`, generateToken(handlerB), { toss: {} });
  assert.notStrictEqual(reopened.status, 403, JSON.stringify(reopened.body));
});

test("assigning a scorer is audited and unknown users are rejected", async () => {
  const { owner, handlerA, match } = await club();
  const matchId = String(match._id);

  const ok = await call(
    "PUT",
    `/matches/${matchId}/scorers`,
    generateToken(owner),
    { scorerIds: [String(handlerA._id)] }
  );
  assert.equal(ok.status, 200, JSON.stringify(ok.body));

  const audit = await AuditLog.findOne({ action: "match.scorers_assigned", targetId: matchId }).lean();
  assert.ok(audit, "an audit entry records the assignment");
  assert.deepEqual(audit.metadata.scorerIds, [String(handlerA._id)]);

  // A syntactically valid but non-existent user is refused (400, not a cast 500).
  const missing = await call(
    "PUT",
    `/matches/${matchId}/scorers`,
    generateToken(owner),
    { scorerIds: ["64b7f9c2f1a2b3c4d5e6f7a8"] }
  );
  assert.equal(missing.status, 400, JSON.stringify(missing.body));
});

test("a score_handler cannot assign scorers (that needs create_match)", async () => {
  const { handlerA, handlerB, match } = await club();

  const res = await call(
    "PUT",
    `/matches/${match._id}/scorers`,
    generateToken(handlerA),
    { scorerIds: [String(handlerB._id)] }
  );

  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal(res.body.requiredPermission, "create_match");
});

test("an unassigned match keeps the Phase 9 org-wide scoring rule", async () => {
  const { handlerA, match } = await club();

  const res = await call("PUT", `/matches/${match._id}/toss`, generateToken(handlerA), { toss: {} });
  assert.notStrictEqual(res.status, 403, JSON.stringify(res.body));
});

test("the officials endpoint wires a scorer to scoring access and never fakes an umpire", async () => {
  const { handlerA, match } = await club();
  const matchId = String(match._id);
  const admin = await Admin.create({
    name: "Platform Admin",
    email: `platform-ump-${counter}@openctest.dev`,
    password: "password-123",
    role: "admin",
  });
  const token = generateToken(admin);

  const scorer = await call("POST", `/matches/${matchId}/officials`, token, {
    userId: String(handlerA._id),
    role: "scorer",
  });
  assert.equal(scorer.status, 200, JSON.stringify(scorer.body));

  const afterScorer = await Match.findById(matchId).lean();
  assert.deepEqual(afterScorer.assignedScorers.map(String), [String(handlerA._id)]);
  assert.ok(!(afterScorer.umpires || []).length, "a scorer appointment leaves no umpire behind");

  // The appointed scorer can now score the fixture.
  const scored = await call("PUT", `/matches/${matchId}/toss`, generateToken(handlerA), { toss: {} });
  assert.notStrictEqual(scored.status, 403, JSON.stringify(scored.body));

  // An umpire appointment mirrors a NAME, never the raw id.
  const umpire = await call("POST", `/matches/${matchId}/officials`, token, {
    userId: String(handlerA._id),
    role: "umpire_on_field_1",
  });
  assert.equal(umpire.status, 200, JSON.stringify(umpire.body));

  const afterUmpire = await Match.findById(matchId).lean();
  const field = (afterUmpire.umpires || []).find((u) => u.role === "field");
  assert.ok(field, "the field umpire was recorded");
  assert.equal(field.name, handlerA.name);
  assert.notEqual(field.name, String(handlerA._id));
});
