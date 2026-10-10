import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

// --- test process environment -------------------------------------------------
//
// These assignments run before the *dynamic* import of ../src/index.js below,
// which is the only module here that pulls in `dotenv/config`. Two things matter:
//
//   VERCEL=1  makes index.js build the Express app WITHOUT binding PORT, so the
//             file owns its own ephemeral listener (app.listen(0)).
//   MONGO_URL=""  is an existing (empty) key, so dotenv will not overwrite it
//             with the developer's real MONGO_URL from Backend/.env. connectDB
//             then sees a falsy URL and returns null, leaving the mongoose
//             default connection owned entirely by startTestDb()'s in-memory
//             Mongo. The developer's real database is never contacted.
//
process.env.VERCEL = "1";
process.env.MONGO_URL = "";
delete process.env.MONGODB_URI;
delete process.env.MONGO_URI;
process.env.JWT_SECRET = process.env.JWT_SECRET || "oct11-http-test-secret";
process.env.LOG_REQUESTS = "false";

import { startTestDb, stopTestDb } from "./helpers/testDb.js";
import Admin from "../src/models/Admin.js";
import User from "../src/models/User.js";
import Team from "../src/models/Team.js";
import Match from "../src/models/Match.js";

// Terminal A / oct11: exercise the real Express routers over HTTP. The earlier
// tournament tests call controllers directly with mock req/res; these go through
// the auth middleware stack, so they pin the 401/403/400/409 boundaries that a
// caller actually sees on the wire.

const PREFIX = "Oct11HTTP";
const FAR_ID = "0123456789abcdef01234567"; // valid ObjectId shape, never inserted
const DATES = {
  startDate: "2026-10-11T00:00:00.000Z",
  endDate: "2026-10-20T00:00:00.000Z",
};

let mongod;
let server;
let base;

const uniqueName = (label) =>
  `${PREFIX} ${label} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function makeAdminToken(label = "admin") {
  const admin = await Admin.create({
    name: `${PREFIX} ${label}`,
    email: `${PREFIX}.${label}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`,
    password: "a-password-hash-that-is-never-compared",
    role: "superadmin",
  });
  return jwt.sign({ id: String(admin._id) }, process.env.JWT_SECRET);
}

async function makeVerifiedUserToken(label = "user") {
  const user = await User.create({
    name: `${PREFIX} ${label}`,
    email: `${PREFIX}.${label}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`,
    role: "scorer",
    accountType: "organization_admin",
    emailVerified: true,
    tokenVersion: 0,
  });
  return jwt.sign({ id: String(user._id), tv: 0 }, process.env.JWT_SECRET);
}

async function makeTeams(count, label) {
  const teams = [];
  for (let i = 0; i < count; i += 1) {
    teams.push(await Team.create({ name: uniqueName(`${label} T${i}`) }));
  }
  return teams;
}

async function req(method, path, { token, body } = {}) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // Some middleware replies with no JSON body (or a non-JSON error); the
    // status code is what these tests assert against.
  }
  return { status: res.status, body: json };
}

before(async () => {
  mongod = await startTestDb();
  const { default: app } = await import("../src/index.js");
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => {
    server?.closeAllConnections?.();
    server?.close(resolve);
  });
  await stopTestDb(mongod);
});

// --- auth boundaries ----------------------------------------------------------

test("admin-only tournament create rejects an anonymous caller with 401", async () => {
  const res = await req("POST", "/api/tournaments", { body: { name: "x" } });
  assert.equal(res.status, 401);
});

test("admin-only tournament create rejects a verified non-admin with 403", async () => {
  const token = await makeVerifiedUserToken();
  const res = await req("POST", "/api/tournaments", {
    token,
    body: { name: "x", ...DATES, type: "league", teams: [] },
  });
  assert.equal(res.status, 403);
});

test("fixture preview is admin-only (anonymous 401)", async () => {
  const res = await req("POST", `/api/tournaments/${FAR_ID}/fixtures/preview`, { body: {} });
  assert.equal(res.status, 401);
});

test("tournament update rejects anonymous (401) and non-admin (403)", async () => {
  const anonymous = await req("PUT", `/api/tournaments/${FAR_ID}`, { body: {} });
  assert.equal(anonymous.status, 401);

  const token = await makeVerifiedUserToken();
  const nonAdmin = await req("PUT", `/api/tournaments/${FAR_ID}`, { token, body: {} });
  assert.equal(nonAdmin.status, 403);
});

// --- createTournament validation ---------------------------------------------

test("createTournament enforces name, dates and team rules over HTTP", async () => {
  const token = await makeAdminToken();
  const teams = await makeTeams(3, "CV");
  const teamIds = teams.map((t) => String(t._id));

  const noName = await req("POST", "/api/tournaments", {
    token,
    body: { ...DATES, type: "league", teams: teamIds },
  });
  assert.equal(noName.status, 400);

  const noDates = await req("POST", "/api/tournaments", {
    token,
    body: { name: uniqueName("NoDates"), type: "league", teams: teamIds },
  });
  assert.equal(noDates.status, 400);

  // A league needs at least three distinct teams.
  const tooFew = await req("POST", "/api/tournaments", {
    token,
    body: { name: uniqueName("TooFew"), ...DATES, type: "league", teams: teamIds.slice(0, 2) },
  });
  assert.equal(tooFew.status, 400);
  assert.match(tooFew.body.message, /at least 3/i);

  // Duplicates collapse below the minimum and are rejected.
  const duplicates = await req("POST", "/api/tournaments", {
    token,
    body: {
      name: uniqueName("Dup"),
      ...DATES,
      type: "league",
      teams: [teamIds[0], teamIds[0], teamIds[1]],
    },
  });
  assert.equal(duplicates.status, 400);

  const missingTeam = await req("POST", "/api/tournaments", {
    token,
    body: { name: uniqueName("Missing"), ...DATES, type: "league", teams: [teamIds[0], teamIds[1], FAR_ID] },
  });
  assert.equal(missingTeam.status, 400);
  assert.match(missingTeam.body.message, /do not exist/i);

  const ok = await req("POST", "/api/tournaments", {
    token,
    body: { name: uniqueName("OK"), ...DATES, type: "league", teams: teamIds, format: "T20" },
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.tournament.teams.length, 3);
});

test("an admin can update a tournament over HTTP", async () => {
  const token = await makeAdminToken();
  const teams = await makeTeams(3, "Upd");
  const created = await req("POST", "/api/tournaments", {
    token,
    body: { name: uniqueName("Upd"), ...DATES, type: "league", teams: teams.map((t) => String(t._id)) },
  });
  assert.equal(created.status, 201);

  const res = await req("PUT", `/api/tournaments/${created.body.tournament._id}`, {
    token,
    body: { venue: "Gaddafi Stadium" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.tournament.venue, "Gaddafi Stadium");
});

// --- duplicate data entry -----------------------------------------------------

test("POST /api/teams returns 409 for a duplicate name", async () => {
  const token = await makeAdminToken();
  const name = uniqueName("TeamDup");

  const first = await req("POST", "/api/teams", { token, body: { name } });
  assert.equal(first.status, 201);

  const second = await req("POST", "/api/teams", { token, body: { name } });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, "TEAM_NAME_TAKEN");
});

test("POST /api/players returns 409 for a duplicate name in the same team", async () => {
  const token = await makeAdminToken();
  const [team] = await makeTeams(1, "PlayerDup");
  const name = `${PREFIX} Player Dup`;

  const first = await req("POST", "/api/players", { token, body: { name, team: String(team._id) } });
  assert.equal(first.status, 201);

  const second = await req("POST", "/api/players", { token, body: { name, team: String(team._id) } });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, "PLAYER_DUPLICATE");
});

// --- fixtures -----------------------------------------------------------------

test("fixture preview then apply twice creates fixtures exactly once", async () => {
  const token = await makeAdminToken();
  const teams = await makeTeams(3, "Fix");
  const created = await req("POST", "/api/tournaments", {
    token,
    body: { name: uniqueName("Fix"), ...DATES, type: "league", teams: teams.map((t) => String(t._id)), format: "T20" },
  });
  const id = created.body.tournament._id;
  const startAt = "2026-10-12T09:00:00.000Z";

  const preview = await req("POST", `/api/tournaments/${id}/fixtures/preview`, { token, body: { startAt } });
  assert.equal(preview.status, 200);
  assert.ok(preview.body.preview, "preview plan is returned");
  assert.equal(preview.body.preview.totalMatches, 3);

  const first = await req("POST", `/api/tournaments/${id}/fixtures/apply`, { token, body: { startAt } });
  assert.equal(first.status, 200);
  assert.equal(first.body.applied, 3);

  const second = await req("POST", `/api/tournaments/${id}/fixtures/apply`, { token, body: { startAt } });
  assert.equal(second.status, 200);
  assert.equal(second.body.applied, 0, "a second apply must not re-create fixtures");
  assert.equal(second.body.skipped.length, 3);
});

test("manual fixture creation rejects a self-match, an outside team and a duplicate pair", async () => {
  const token = await makeAdminToken();
  const teams = await makeTeams(3, "Manual");
  const created = await req("POST", "/api/tournaments", {
    token,
    body: { name: uniqueName("Manual"), ...DATES, type: "league", teams: teams.map((t) => String(t._id)) },
  });
  const id = created.body.tournament._id;

  const self = await req("POST", `/api/tournaments/${id}/matches`, {
    token,
    body: { team1: String(teams[0]._id), team2: String(teams[0]._id) },
  });
  assert.equal(self.status, 400);

  const outside = await req("POST", `/api/tournaments/${id}/matches`, {
    token,
    body: { team1: String(teams[0]._id), team2: FAR_ID },
  });
  assert.equal(outside.status, 400);

  const first = await req("POST", `/api/tournaments/${id}/matches`, {
    token,
    body: { team1: String(teams[0]._id), team2: String(teams[1]._id), round: 1 },
  });
  assert.equal(first.status, 201);

  const again = await req("POST", `/api/tournaments/${id}/matches`, {
    token,
    body: { team1: String(teams[1]._id), team2: String(teams[0]._id), round: 1 },
  });
  assert.equal(again.status, 409);
  assert.equal(again.body.reason, "duplicate");
});

// --- match status transitions -------------------------------------------------

test("postpone/reschedule/abandon reject a completed match with 409", async () => {
  const token = await makeAdminToken();
  const teams = await makeTeams(3, "Status");
  const created = await req("POST", "/api/tournaments", {
    token,
    body: { name: uniqueName("Status"), ...DATES, type: "league", teams: teams.map((t) => String(t._id)), format: "T20" },
  });
  const id = created.body.tournament._id;

  const applied = await req("POST", `/api/tournaments/${id}/fixtures/apply`, {
    token,
    body: { startAt: "2026-10-12T09:00:00.000Z" },
  });
  assert.equal(applied.status, 200);
  assert.equal(applied.body.created.length, 3);

  const [completedId, upcomingId] = applied.body.created;
  await Match.updateOne({ _id: completedId }, { $set: { status: "completed" } });
  const future = "2026-11-01T09:00:00.000Z";

  assert.equal(
    (await req("POST", `/api/matches/${completedId}/reschedule`, { token, body: { startAt: future } })).status,
    409,
  );
  assert.equal(
    (await req("POST", `/api/matches/${completedId}/postpone`, { token, body: {} })).status,
    409,
  );
  assert.equal(
    (await req("POST", `/api/matches/${completedId}/abandon`, { token, body: {} })).status,
    409,
  );

  // Positive control: an upcoming match can be rescheduled.
  const rescheduled = await req("POST", `/api/matches/${upcomingId}/reschedule`, {
    token,
    body: { startAt: future },
  });
  assert.equal(rescheduled.status, 200);
});
