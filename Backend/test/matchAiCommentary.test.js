import test, { before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";

import express from "express";
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
import { createOrgMatch, updateOrgMatch } from "../src/controllers/orgMatchesController.js";
import { handleFieldClick } from "../src/controllers/scoreController.js";
import aiCommentary from "../src/services/aiCommentary.js";
import { initSocket } from "../src/socket/socket.js";
import { generateToken } from "../src/utils/jwt.js";
import {
  createOrgMatchSchema,
  updateOrgMatchSchema,
  updateMatchAiCommentarySchema,
} from "../src/validators/matchValidators.js";

// The toggle is a match write, not a UI preference. Drive the real router over
// HTTP so the permission matrix and the boolean validator are both exercised.
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
  // The scoring controllers emit on the match room; a real socket keeps those
  // emits from throwing while exercising the permission and validation paths.
  initSocket(server);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  mock.restoreAll();
  await new Promise((resolve) => server?.close(resolve));
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

function call(method, path, token, body) {
  return new Promise((resolve) => {
    const url = new URL(path, `${baseUrl}/`);
    const request = http.request(
      {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString();
          let data;
          try { data = JSON.parse(text); } catch { data = text; }
          resolve({ status: response.statusCode, body: data });
        });
      },
    );
    request.on("error", (error) => resolve({ status: 0, body: { message: error.message } }));
    if (body) request.write(JSON.stringify(body));
    request.end();
  });
}

let counter = 0;
async function makeUser(overrides = {}) {
  counter += 1;
  return User.create({
    name: `AI Flag Person ${counter}`,
    email: `ai-flag-${counter}-${Math.random().toString(36).slice(2, 8)}@openctest.dev`,
    password: "password-123",
    role: "scorer",
    accountType: "organization_admin",
    emailVerified: true,
    ...overrides,
  });
}

async function makeOrg(owner, name = "AI Flag Club") {
  const res = mockRes();
  await createOrganization(mockReq({ user: owner, principalType: "user", body: { name } }), res);
  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
  return res.body.organization;
}

async function addMember(org, user, roles) {
  return Membership.create({ organization: org._id, user: user._id, roles, status: "active" });
}

async function makeOrgMatch(org, overrides = {}) {
  return Match.create({
    title: "AI Flag XI vs XI",
    matchType: "T20",
    status: "live",
    organizationRef: org._id,
    organization: org.name,
    innings: [{ team: null, status: "live", balls: 0, runs: 0 }],
    ...overrides,
  });
}

const togglePath = (match) => `/matches/${match._id}/ai-commentary`;

// ---------------------------------------------------------------------------
// Default and old documents
// ---------------------------------------------------------------------------
test("a new match defaults to AI commentary off", async () => {
  const match = await makeOrgMatch(await makeOrg(await makeUser()));
  assert.strictEqual(match.useAiCommentary, false);
  const stored = await Match.findById(match._id);
  assert.strictEqual(stored.useAiCommentary, false);
});

test("a match saved before the field existed behaves as off", async () => {
  const org = await makeOrg(await makeUser());
  const result = await Match.collection.insertOne({
    title: "Legacy fixture",
    organizationRef: org._id,
    status: "upcoming",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const match = await Match.findById(result.insertedId);
  assert.notStrictEqual(match.useAiCommentary, true, "legacy documents must never read as opted in");
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
test("the flag must be a boolean on every setup and toggle route", async () => {
  for (const schema of [updateMatchAiCommentarySchema, updateOrgMatchSchema]) {
    for (const bad of ["true", 1, null, {}]) {
      assert.strictEqual(schema.safeParse({ useAiCommentary: bad }).success, false, `${JSON.stringify(bad)} was accepted`);
    }
    assert.strictEqual(schema.safeParse({ useAiCommentary: true }).success, true);
    assert.strictEqual(schema.safeParse({ useAiCommentary: false }).success, true);
  }
  assert.strictEqual(
    createOrgMatchSchema.safeParse({ teams: [], useAiCommentary: "yes" }).success,
    false,
  );
});

test("the toggle rejects non-boolean bodies and unknown keys over HTTP", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const match = await makeOrgMatch(org);
  const token = generateToken(owner);

  const bad = await call("PATCH", togglePath(match), token, { useAiCommentary: "yes" });
  assert.strictEqual(bad.status, 400);

  const extra = await call("PATCH", togglePath(match), token, { useAiCommentary: true, status: "completed" });
  assert.strictEqual(extra.status, 400);

  const stored = await Match.findById(match._id);
  assert.strictEqual(stored.useAiCommentary, false);
});

// ---------------------------------------------------------------------------
// Existing permission rules
// ---------------------------------------------------------------------------
test("platform admin and org owner/admin/manager can toggle the flag", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const match = await makeOrgMatch(org);
  const platformAdmin = await makeUser({ role: "admin" });

  const actors = [generateToken(platformAdmin), generateToken(owner)];
  for (const role of ["admin", "manager", "score_handler"]) {
    const user = await makeUser();
    await addMember(org, user, [role]);
    actors.push(generateToken(user));
  }

  for (const [index, token] of actors.entries()) {
    const value = index % 2 === 0;
    const res = await call("PATCH", togglePath(match), token, { useAiCommentary: value });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const fresh = await Match.findById(match._id);
    assert.strictEqual(fresh.useAiCommentary, value);
  }
});

test("viewers and players cannot toggle the flag", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const match = await makeOrgMatch(org);

  for (const role of ["player", "staff", "social_media_handler"]) {
    const user = await makeUser();
    await addMember(org, user, [role]);
    const res = await call("PATCH", togglePath(match), generateToken(user), { useAiCommentary: true });
    assert.strictEqual(res.status, 403, `${role} was allowed to change the match`);
  }

  const anonymous = await call("PATCH", togglePath(match), null, { useAiCommentary: true });
  assert.strictEqual(anonymous.status, 401);

  const outsider = await makeUser();
  const otherOrg = await makeOrg(outsider, "Other Club");
  const otherHandler = await makeUser();
  await addMember(otherOrg, otherHandler, ["score_handler"]);
  const crossTenant = await call("PATCH", togglePath(match), generateToken(otherHandler), { useAiCommentary: true });
  assert.strictEqual(crossTenant.status, 403);

  const stored = await Match.findById(match._id);
  assert.strictEqual(stored.useAiCommentary, false);
});

test("a score_handler not assigned to this match is refused; an assigned one is allowed", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const handler = await makeUser();
  const sibling = await makeUser();
  await addMember(org, handler, ["score_handler"]);
  await addMember(org, sibling, ["score_handler"]);
  const match = await makeOrgMatch(org, { assignedScorers: [sibling._id] });
  const token = generateToken(handler);

  const refused = await call("PATCH", togglePath(match), token, { useAiCommentary: true });
  assert.strictEqual(refused.status, 403);
  assert.strictEqual(refused.body?.code, "MATCH_SCORER_NOT_ASSIGNED");

  await Match.updateOne({ _id: match._id }, { $set: { assignedScorers: [handler._id] } });
  const assigned = await call("PATCH", togglePath(match), token, { useAiCommentary: true });
  assert.strictEqual(assigned.status, 200, JSON.stringify(assigned.body));
  const stored = await Match.findById(match._id);
  assert.strictEqual(stored.useAiCommentary, true);
});

// ---------------------------------------------------------------------------
// Match setup routes
// ---------------------------------------------------------------------------
test("org setup can set the flag at create and update time", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const teamA = await Team.create({ name: "Flag A", organizationRef: org._id, organization: org.name });
  const teamB = await Team.create({ name: "Flag B", organizationRef: org._id, organization: org.name });
  const access = { via: "membership", roles: ["owner"], permissions: [] };

  const created = mockRes();
  const createBody = createOrgMatchSchema.parse({
    teams: [String(teamA._id), String(teamB._id)],
    useAiCommentary: true,
  });
  await createOrgMatch(
    mockReq({ user: owner, org, orgAccess: access, body: createBody }),
    created,
  );
  assert.strictEqual(created.statusCode, 201, JSON.stringify(created.body));
  assert.strictEqual(created.body.match.useAiCommentary, true);

  const matchId = created.body.match._id;
  const updated = mockRes();
  await updateOrgMatch(
    mockReq({
      user: owner,
      org,
      orgAccess: access,
      params: { matchId },
      body: updateOrgMatchSchema.parse({ useAiCommentary: false }),
    }),
    updated,
  );
  assert.strictEqual(updated.statusCode, 200, JSON.stringify(updated.body));
  const stored = await Match.findById(matchId);
  assert.strictEqual(stored.useAiCommentary, false);
});

// ---------------------------------------------------------------------------
// Generation skip
// ---------------------------------------------------------------------------
test("AI commentary generation is skipped for a match with the flag off", async () => {
  const org = await makeOrg(await makeUser());
  const match = await makeOrgMatch(org);

  const calls = [];
  mock.method(aiCommentary, "generateBallCommentary", async (_data, options) => {
    calls.push(options);
    return { short: "AI line", vivid: "AI vivid" };
  });

  const off = mockRes();
  await handleFieldClick(
    mockReq({ params: { matchId: match._id }, body: { x: 50, y: 200, runs: 1 } }),
    off,
  );
  assert.strictEqual(off.statusCode, 200, JSON.stringify(off.body));
  assert.strictEqual(calls.length, 1, "the deterministic template still runs");
  assert.strictEqual(calls[0]?.skipAi, true, "no provider call while the match flag is off");

  await Match.updateOne({ _id: match._id }, { $set: { useAiCommentary: true } });
  const on = mockRes();
  await handleFieldClick(
    mockReq({ params: { matchId: match._id }, body: { x: 50, y: 200, runs: 1 } }),
    on,
  );
  assert.strictEqual(on.statusCode, 200, JSON.stringify(on.body));
  assert.strictEqual(calls.length, 2, "the match opted in, so generation should run");
  assert.strictEqual(calls[1]?.skipAi, false, "the opted-in match allows the provider call");
});
