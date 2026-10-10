import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

// Same in-process harness as oct11HttpRoutes.test.js: VERCEL=1 so index.js does
// not bind a port, MONGO_URL="" so dotenv cannot inject the developer's real
// database, and an ephemeral listener owned by this file.
process.env.VERCEL = "1";
process.env.MONGO_URL = "";
delete process.env.MONGODB_URI;
delete process.env.MONGO_URI;
process.env.JWT_SECRET = process.env.JWT_SECRET || "oct11-http-test-secret";
process.env.LOG_REQUESTS = "false";

import { startTestDb, stopTestDb } from "./helpers/testDb.js";
import Admin from "../src/models/Admin.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import Match from "../src/models/Match.js";

// oct11 follow-up: every fixture a human can create must be scorable. Fixtures
// made by the tournament paths used to be persisted with no `innings`, so the
// toss/first ball 400'd with "Invalid innings index". These tests drive each
// creation path over real HTTP, then run toss -> playing XI -> a handful of
// deliveries (a wide, a wicket and a completed over) -> undo, and assert 200.

const PREFIX = "Oct11Score";
const DATES = { startDate: "2026-10-11T00:00:00.000Z", endDate: "2026-10-20T00:00:00.000Z" };

let mongod;
let server;
let base;

const uniqueName = (label) => `${PREFIX} ${label} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function makeAdminToken(label = "admin") {
  const admin = await Admin.create({
    name: `${PREFIX} ${label}`,
    email: `${PREFIX}.${label}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`,
    password: "a-password-hash-that-is-never-compared",
    role: "superadmin",
  });
  return jwt.sign({ id: String(admin._id) }, process.env.JWT_SECRET);
}

// A team plus 11 players, so a playing XI can be filed.
async function makeTeamWithSquad(label, index) {
  const team = await Team.create({ name: uniqueName(`${label} T${index}`) });
  const players = [];
  for (let i = 0; i < 11; i += 1) {
    players.push(await Player.create({ name: uniqueName(`${label} P${i}`), team: team._id }));
  }
  return { team, players };
}

async function setXI(token, matchId, teamId, players) {
  const res = await req("PUT", `/api/matches/${matchId}/playing-xi`, {
    token,
    body: { teamId: String(teamId), players: players.map((p) => String(p._id)) },
  });
  assert.equal(res.status, 200, `playing XI set: ${JSON.stringify(res.body)}`);
  return res;
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
    // status code is what these tests assert against when a reply is not JSON
  }
  return { status: res.status, body: json };
}

/**
 * Toss, set both XIs, then bowl the same short over on every fixture:
 * a wide (no legal ball), a dot, a bowled dismissal, then 3 more legal balls so
 * the over completes. Finishes by undoing one ball. `bat`/`bowl` are arrays of
 * player id strings. Returns the key figures for assertions.
 */
async function playShortOver(token, matchId, bat, bowl) {
  const id = (p) => String(p?._id || p);
  const batsman1 = id(bat[0]);
  const batsman2 = id(bat[1]);
  const incoming = id(bat[2]);
  const bowler = id(bowl[0]);

  const ball = (payload) =>
    req("POST", `/api/matches/${matchId}/score`, {
      token,
      body: {
        inningsIndex: 0,
        batsmanOnStrikeId: batsman1,
        batsmanNonStrikeId: batsman2,
        bowlerId: bowler,
        commentaryText: `${PREFIX} test delivery`,
        ...payload,
      },
    });

  // wide: no legal ball is consumed
  const wide = await ball({ runs: 0, isWide: true });
  assert.equal(wide.status, 200, `wide accepted: ${JSON.stringify(wide.body)}`);
  await sleep(120);

  // dot ball (legal #1). Keep the striker the server reports.
  const dot = await ball({ runs: 0 });
  assert.equal(dot.status, 200);
  let striker = String(dot.body?.strikerAfterId || batsman1);
  await sleep(120);

  // bowled dismissal (legal #2)
  const wicket = await ball({
    runs: 0,
    isWicket: true,
    wicketType: "bowled",
    dismissedPlayerId: striker,
    nextBatsmanId: incoming,
  });
  assert.equal(wicket.status, 200, `wicket accepted: ${JSON.stringify(wicket.body)}`);
  await sleep(120);

  // legal #3..#6 — the over completes on the sixth legal ball
  for (let i = 0; i < 4; i += 1) {
    const r = await ball({ runs: i === 0 ? 1 : 0 });
    assert.equal(r.status, 200, `legal ball accepted: ${JSON.stringify(r.body)}`);
    await sleep(120);
  }

  const scored = await req("GET", `/api/matches/${matchId}`, { token });
  const innings = scored.body?.match?.innings?.[0] || scored.body?.innings?.[0];
  assert.ok(innings, "innings 0 exists after scoring");

  const undo = await req("POST", `/api/matches/${matchId}/revert-ball`, {
    token,
    body: { inningsIndex: 0 },
  });
  assert.equal(undo.status, 200, `revert accepted: ${JSON.stringify(undo.body)}`);

  return { innings };
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

test("platform POST /api/matches: fixture is scorable through toss -> XI -> over -> undo", async () => {
  const token = await makeAdminToken();
  const a = await makeTeamWithSquad("Match", 0);
  const b = await makeTeamWithSquad("Match", 1);

  const created = await req("POST", "/api/matches", {
    token,
    body: { teams: [String(a.team._id), String(b.team._id)], matchType: "T20", totalOvers: 20 },
  });
  assert.equal(created.status, 201);
  const matchId = created.body.match._id;
  assert.equal(created.body.match.innings.length, 2, "innings seeded at creation");

  const toss = await req("PUT", `/api/matches/${matchId}/toss`, {
    token,
    body: { tossWinnerId: String(a.team._id), decision: "bat" },
  });
  assert.equal(toss.status, 200);
  await setXI(token, matchId, a.team._id, a.players);
  await setXI(token, matchId, b.team._id, b.players);

  const { innings } = await playShortOver(token, matchId, a.players, b.players);
  assert.equal(Number(innings.wickets), 1, "one wicket fell");
  assert.ok(Number(innings.extras?.wides) >= 1, "the wide was recorded");
  assert.ok(Number(innings.balls) >= 5, "legal balls were counted");
});

test("auto-generate POST /api/tournaments/:id/fixtures/apply: every generated fixture is scorable", async () => {
  const token = await makeAdminToken();
  const squads = [await makeTeamWithSquad("Auto", 0), await makeTeamWithSquad("Auto", 1), await makeTeamWithSquad("Auto", 2)];
  const byTeam = new Map(squads.map((s) => [String(s.team._id), s.players]));

  const created = await req("POST", "/api/tournaments", {
    token,
    body: { name: uniqueName("Auto"), ...DATES, type: "league", teams: squads.map((s) => String(s.team._id)), format: "T20" },
  });
  assert.equal(created.status, 201);
  const id = created.body.tournament._id;

  const applied = await req("POST", `/api/tournaments/${id}/fixtures/apply`, {
    token,
    body: { startAt: "2026-10-12T09:00:00.000Z" },
  });
  assert.equal(applied.status, 200);
  assert.equal(applied.body.created.length, 3);

  // Every generated fixture must carry seeded innings, not just the first one.
  const fixtureId = applied.body.created[0];
  const fetched = await req("GET", `/api/matches/${fixtureId}`, { token });
  const match = fetched.body?.match || fetched.body;
  assert.equal(match.innings.length, 2, "generated fixture has innings");

  const [teamX, teamY] = match.teams.map((t) => String(t._id || t));
  const bat = byTeam.get(teamX);
  const bowl = byTeam.get(teamY);

  const toss = await req("PUT", `/api/matches/${fixtureId}/toss`, {
    token,
    body: { tossWinnerId: teamX, decision: "bat" },
  });
  assert.equal(toss.status, 200);

  const squadOf = new Map(squads.map((s) => [String(s.team._id), s.players]));
  await setXI(token, fixtureId, teamX, squadOf.get(teamX));
  await setXI(token, fixtureId, teamY, squadOf.get(teamY));

  const { innings } = await playShortOver(token, fixtureId, bat, bowl);
  assert.equal(Number(innings.wickets), 1);
  assert.ok(Number(innings.extras?.wides) >= 1);
});

test('manual createTournamentMatch in a knockout tournament with round "QF" is scorable', async () => {
  const token = await makeAdminToken();
  const a = await makeTeamWithSquad("KO", 0);
  const b = await makeTeamWithSquad("KO", 1);

  const created = await req("POST", "/api/tournaments", {
    token,
    body: { name: uniqueName("KO"), ...DATES, type: "knockout", teams: [String(a.team._id), String(b.team._id)], format: "T20" },
  });
  assert.equal(created.status, 201);
  const id = created.body.tournament._id;

  const fixture = await req("POST", `/api/tournaments/${id}/matches`, {
    token,
    body: { team1: String(a.team._id), team2: String(b.team._id), round: "QF", startTime: "2026-10-12T09:00:00.000Z" },
  });
  assert.equal(fixture.status, 201, JSON.stringify(fixture.body));
  assert.equal(fixture.body.match.round, "QF", 'the "QF" round label is stored');
  assert.equal(fixture.body.match.innings.length, 2, "innings seeded at creation");

  const matchId = fixture.body.match._id;
  const toss = await req("PUT", `/api/matches/${matchId}/toss`, {
    token,
    body: { tossWinnerId: String(a.team._id), decision: "bat" },
  });
  assert.equal(toss.status, 200);

  await setXI(token, matchId, a.team._id, a.players);
  await setXI(token, matchId, b.team._id, b.players);

  const { innings } = await playShortOver(token, matchId, a.players, b.players);
  assert.equal(Number(innings.wickets), 1);
  assert.ok(Number(innings.extras?.wides) >= 1);
});

test("a pre-existing fixture saved without innings is repaired lazily on toss (no migration)", async () => {
  const token = await makeAdminToken();
  const a = await makeTeamWithSquad("Legacy", 0);
  const b = await makeTeamWithSquad("Legacy", 1);

  const created = await req("POST", "/api/matches", {
    token,
    body: { teams: [String(a.team._id), String(b.team._id)], matchType: "T20" },
  });
  const matchId = created.body.match._id;

  // Simulate an old row: strip innings as a pre-fix fixture would have been saved.
  await Match.updateOne({ _id: matchId }, { $unset: { innings: 1 } });
  const stripped = await Match.findById(matchId).lean();
  assert.ok(!stripped.innings || stripped.innings.length === 0, "innings really absent");

  const toss = await req("PUT", `/api/matches/${matchId}/toss`, {
    token,
    body: { tossWinnerId: String(a.team._id), decision: "bat" },
  });
  assert.equal(toss.status, 200, "toss repairs a fixture with no innings");

  const repaired = await req("GET", `/api/matches/${matchId}`, { token });
  const inningsAfter = repaired.body?.match?.innings || repaired.body?.innings;
  assert.equal(inningsAfter.length, 2, "toss created the missing innings");

  const { innings } = await playShortOver(token, matchId, a.players, b.players);
  assert.equal(Number(innings.wickets), 1);
});

test("a fixture with no innings is also repaired at the first ball if the toss was skipped", async () => {
  const token = await makeAdminToken();
  const a = await makeTeamWithSquad("FirstBall", 0);
  const b = await makeTeamWithSquad("FirstBall", 1);

  const created = await req("POST", "/api/matches", {
    token,
    body: { teams: [String(a.team._id), String(b.team._id)], matchType: "T20" },
  });
  const matchId = created.body.match._id;
  await Match.updateOne({ _id: matchId }, { $unset: { innings: 1 } });

  // Straight to a delivery, no toss.
  const first = await req("POST", `/api/matches/${matchId}/score`, {
    token,
    body: {
      inningsIndex: 0,
      runs: 1,
      batsmanOnStrikeId: String(a.players[0]._id),
      batsmanNonStrikeId: String(a.players[1]._id),
      bowlerId: String(b.players[0]._id),
      commentaryText: `${PREFIX} first ball`,
    },
  });
  assert.equal(first.status, 200, `first ball repaired the innings: ${JSON.stringify(first.body)}`);
});
