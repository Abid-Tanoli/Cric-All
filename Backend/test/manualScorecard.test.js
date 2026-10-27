import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";

import express from "express";
import mongoose from "mongoose";
import { startTestDb, stopTestDb } from "./helpers/testDb.js";
import User from "../src/models/User.js";
import Admin from "../src/models/Admin.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import Match from "../src/models/Match.js";
import Tournament from "../src/models/Tournament.js";
import AuditLog from "../src/models/AuditLog.js";
import { generateToken } from "../src/utils/jwt.js";
import { validateManualScorecard } from "../src/services/manualScorecard.js";
import { aggregateSeriesStats } from "../src/controllers/seriesController.js";

// P1: a completed match entered from a paper scorebook must land in the same
// Match/innings structures a live-scored match uses, so standings, tournament
// player stats and the scorecard work with no special case. These tests drive
// the real router over HTTP (the guards live in the route wiring) and also unit
// test the pure validator.

let mongod;
let server;
let baseUrl;
let adminToken;

const call = (method, path, token, body) =>
  new Promise((resolve) => {
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

before(async () => {
  mongod = await startTestDb();

  const { default: matchRoutes } = await import("../src/routes/matchRoutes.js");
  const { default: tournamentRoutes } = await import("../src/routes/tournamentRoutes.js");
  const app = express();
  app.use(express.json());
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
    Player.deleteMany({}),
    Match.deleteMany({}),
    Tournament.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);
  const admin = await Admin.create({
    name: "Manual Admin",
    email: `manual-admin-${Math.random().toString(36).slice(2, 8)}@openctest.dev`,
    password: "password-123",
    role: "admin",
  });
  adminToken = generateToken(admin);
});

let seq = 0;
const makeClub = async () => {
  seq += 1;
  const playersA = await Player.create(
    Array.from({ length: 4 }, (_, i) => ({ name: `OPENCODE_TEST_manual_a${seq}_${i}` }))
  );
  const playersB = await Player.create(
    Array.from({ length: 4 }, (_, i) => ({ name: `OPENCODE_TEST_manual_b${seq}_${i}` }))
  );
  const teamA = await Team.create({ name: `OPENCODE_TEST Manual A ${seq}`, players: playersA.map((p) => p._id) });
  const teamB = await Team.create({ name: `OPENCODE_TEST Manual B ${seq}`, players: playersB.map((p) => p._id) });
  return { teamA, teamB, playersA, playersB };
};

const makeTournament = async (teamA, teamB) =>
  Tournament.create({
    name: `OPENCODE_TEST Manual Cup ${++seq}`,
    startDate: new Date("2026-10-08T00:00:00Z"),
    endDate: new Date("2026-10-20T00:00:00Z"),
    type: "knockout",
    teams: [teamA._id, teamB._id],
  });

// Public-list tests need names that the reserved-test-team filter does not hide.
const makeVisibleClub = async () => {
  seq += 1;
  const playersA = await Player.create(
    Array.from({ length: 4 }, (_, i) => ({ name: `Manual Public A${seq}_${i}` }))
  );
  const playersB = await Player.create(
    Array.from({ length: 4 }, (_, i) => ({ name: `Manual Public B${seq}_${i}` }))
  );
  const teamA = await Team.create({ name: `Manual Public A ${seq}`, players: playersA.map((p) => p._id) });
  const teamB = await Team.create({ name: `Manual Public B ${seq}`, players: playersB.map((p) => p._id) });
  return { teamA, teamB, playersA, playersB };
};

const buildPayload = ({ teamA, teamB, playersA, playersB, tournamentId, draft = false } = {}) => ({
  tournamentId: tournamentId ? String(tournamentId) : undefined,
  stage: "quarter_final",
  stageLabel: "QF1",
  teamA: String(teamA._id),
  teamB: String(teamB._id),
  startAt: "2026-10-11T09:00:00Z",
  totalOvers: 20,
  tossWinner: String(teamA._id),
  tossDecision: "bat",
  draft,
  innings: [
    {
      team: String(teamA._id),
      batting: [
        { player: String(playersA[0]._id), runs: 50, balls: 40, fours: 5, sixes: 1, isOut: true, dismissalType: "caught" },
        { player: String(playersA[1]._id), runs: 30, balls: 20, fours: 2, sixes: 2, isOut: false },
      ],
      bowling: [
        { player: String(playersB[0]._id), overs: "4", maidens: 0, runs: 40, wickets: 1 },
        { player: String(playersB[1]._id), overs: "3.4", maidens: 0, runs: 20, wickets: 0 },
      ],
      extras: { wides: 5, noBalls: 1, byes: 0, legByes: 2 },
      fallOfWickets: [{ runs: 60, wickets: 1, player: String(playersA[0]._id), overs: "7.2" }],
    },
    {
      team: String(teamB._id),
      batting: [{ player: String(playersB[0]._id), runs: 20, balls: 30, isOut: true, dismissalType: "bowled" }],
      bowling: [{ player: String(playersA[0]._id), overs: "4", maidens: 0, runs: 30, wickets: 2 }],
      extras: { wides: 3 },
    },
  ],
  result: { winner: String(teamA._id), margin: "65 runs", resultType: "normal" },
  manOfMatch: String(playersA[0]._id),
});

const validate = (payload, club, extra = {}) =>
  validateManualScorecard(payload, {
    teamIds: [String(club.teamA._id), String(club.teamB._id)],
    totalOvers: 20,
    squadByTeam: {
      [String(club.teamA._id)]: club.playersA.map((p) => String(p._id)),
      [String(club.teamB._id)]: club.playersB.map((p) => String(p._id)),
    },
    ...extra,
  });

// ---------------------------------------------------------------------------
// Pure validator
// ---------------------------------------------------------------------------

test("manual validator: rejects a total that does not equal batting runs + extras", async () => {
  const club = await makeClub();
  const payload = buildPayload(club);
  payload.innings[0].runs = 999;
  const res = validate(payload, club);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.path === "innings[0].runs"));
});

test("manual validator: rejects wickets that do not match dismissals", async () => {
  const club = await makeClub();
  const payload = buildPayload(club);
  payload.innings[0].wickets = 7;
  const res = validate(payload, club);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.path === "innings[0].wickets"));
});

test("manual validator: rejects a duplicate player row", async () => {
  const club = await makeClub();
  const payload = buildPayload(club);
  payload.innings[0].batting.push({ player: String(club.playersA[0]._id), runs: 1, balls: 1, isOut: false });
  const res = validate(payload, club);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /twice/.test(e.message)));
});

test("manual validator: rejects a player who is not in the team's squad", async () => {
  const club = await makeClub();
  const payload = buildPayload(club);
  payload.innings[0].batting[0].player = String(new mongoose.Types.ObjectId());
  const res = validate(payload, club);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /not in the selected team/.test(e.message)));
});

test("manual validator: enforces over format and the overs quota", async () => {
  const club = await makeClub();
  const badFormat = buildPayload(club);
  badFormat.innings[0].overs = "19.6";
  assert.ok(validate(badFormat, club).errors.some((e) => /final over/.test(e.message)));

  const tooMany = buildPayload(club);
  tooMany.innings[0].overs = "25";
  assert.ok(validate(tooMany, club).errors.some((e) => /exceed/.test(e.message)));
});

test("manual validator: rejects a winner who is not one of the two teams", async () => {
  const club = await makeClub();
  const payload = buildPayload(club);
  payload.result.winner = String(new mongoose.Types.ObjectId());
  const res = validate(payload, club);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.path === "result.winner"));
});

test("manual validator: a retired-hurt batsman is not a wicket", async () => {
  const club = await makeClub();
  const payload = buildPayload(club);
  payload.innings = [
    {
      team: String(club.teamA._id),
      batting: [{ player: String(club.playersA[0]._id), runs: 10, balls: 10, isOut: true, dismissalType: "retired hurt" }],
      bowling: [],
      extras: {},
    },
  ];
  const res = validateManualScorecard(payload, {
    teamIds: [String(club.teamA._id), String(club.teamB._id)],
    totalOvers: 20,
    squadByTeam: {},
    requireComplete: false,
  });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.data.innings[0].wickets, 0);
  assert.equal(res.data.innings[0].batting[0].isOut, false);
});

// ---------------------------------------------------------------------------
// HTTP: create / standings / stats / auth
// ---------------------------------------------------------------------------

test("admin creates a completed manual match that feeds standings and player stats", async () => {
  const club = await makeClub();
  const tournament = await makeTournament(club.teamA, club.teamB);
  const payload = buildPayload({ ...club, tournamentId: tournament._id });

  const res = await call("POST", "/matches/manual", adminToken, payload);
  assert.equal(res.status, 201, JSON.stringify(res.body));

  const match = res.body.match;
  assert.equal(match.source, "manual");
  assert.equal(match.status, "completed");
  assert.equal(match.stage, "quarter_final");
  assert.equal(match.stageLabel, "QF1");

  // Standings reflect the manual result: team A won -> 2 points.
  const savedTournament = await Tournament.findById(tournament._id);
  const rowA = savedTournament.pointsTable.find((r) => String(r.team) === String(club.teamA._id));
  const rowB = savedTournament.pointsTable.find((r) => String(r.team) === String(club.teamB._id));
  assert.equal(rowA.points, 2);
  assert.equal(rowA.won, 1);
  assert.equal(rowB.lost, 1);
  assert.ok(savedTournament.matches.some((id) => String(id) === String(match._id)));

  // Innings summary is stored (88 = 80 batting + 8 extras).
  const storedMatch = await Match.findById(match._id);
  assert.equal(storedMatch.innings[0].runs, 88);
  assert.equal(storedMatch.innings[0].extras.total, 8);
  assert.equal(storedMatch.innings[1].runs, 23);

  // Player stats aggregate reads the same innings a live match would.
  const stats = aggregateSeriesStats([storedMatch]);
  const top = stats.topRunScorers;
  assert.equal(top[0].playerId, String(club.playersA[0]._id));
  assert.equal(top[0].runs, 50);
  const wickets = stats.topWicketTakers;
  assert.equal(wickets[0].wickets, 2); // playersA[0] bowled 4 overs, 2 wickets

  // The public summary endpoint renders it without error.
  const summary = await call("GET", `/matches/${match._id}/summary`, adminToken);
  assert.equal(summary.status, 200, JSON.stringify(summary.body));
  assert.equal(summary.body.status, "completed");
  assert.equal(summary.body.innings.length, 2);
});

test("a non-admin user cannot create a manual scorecard", async () => {
  const club = await makeClub();
  const user = await User.create({
    name: "Regular User",
    email: `regular-${Math.random().toString(36).slice(2, 8)}@openctest.dev`,
    password: "password-123",
    role: "viewer",
    emailVerified: true,
  });
  const res = await call("POST", "/matches/manual", generateToken(user), buildPayload(club));
  assert.equal(res.status, 403);
});

test("an invalid manual scorecard over HTTP returns 400 with field errors", async () => {
  const club = await makeClub();
  const payload = buildPayload(club);
  payload.innings[0].runs = 5;
  const res = await call("POST", "/matches/manual", adminToken, payload);
  assert.equal(res.status, 400);
  assert.ok(Array.isArray(res.body.errors) && res.body.errors.length);
});

test("a draft is saved unpublished, then publishing recomputes standings", async () => {
  const club = await makeClub();
  const tournament = await makeTournament(club.teamA, club.teamB);
  const draft = await call("POST", "/matches/manual", adminToken, {
    ...buildPayload({ ...club, tournamentId: tournament._id }),
    draft: true,
    innings: [],
    result: {},
    manOfMatch: "",
  });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  assert.equal(draft.body.match.manualDraft, true);
  assert.equal(draft.body.match.status, "upcoming");

  const draftId = draft.body.match._id;
  let saved = await Tournament.findById(tournament._id);
  let rowA = saved.pointsTable.find((r) => String(r.team) === String(club.teamA._id));
  assert.equal(rowA?.points ?? 0, 0, "a draft must not count towards standings");

  const publish = await call("PUT", `/matches/${draftId}/manual`, adminToken, {
    ...buildPayload({ ...club, tournamentId: tournament._id }),
    draft: false,
  });
  assert.equal(publish.status, 200, JSON.stringify(publish.body));
  assert.equal(publish.body.match.status, "completed");
  assert.equal(publish.body.match.manualDraft, false);

  saved = await Tournament.findById(tournament._id);
  rowA = saved.pointsTable.find((r) => String(r.team) === String(club.teamA._id));
  assert.equal(rowA.points, 2);
});

test("a manual match can be edited, and a live match cannot use the manual endpoint", async () => {
  const club = await makeClub();
  const created = await call("POST", "/matches/manual", adminToken, buildPayload(club));
  const id = created.body.match._id;

  const edited = await call("PUT", `/matches/${id}/manual`, adminToken, {
    ...buildPayload(club),
    title: "QF1 edited title",
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.match.title, "QF1 edited title");

  const live = await Match.create({
    title: "Live match",
    matchType: "T20",
    teams: [club.teamA._id, club.teamB._id],
    status: "live",
  });
  const refused = await call("PUT", `/matches/${live._id}/manual`, adminToken, buildPayload(club));
  assert.equal(refused.status, 409);
});

test("deleting a manual match audits the action and unlinks it from the tournament", async () => {
  const club = await makeClub();
  const tournament = await makeTournament(club.teamA, club.teamB);
  const created = await call("POST", "/matches/manual", adminToken, buildPayload({ ...club, tournamentId: tournament._id }));
  const id = created.body.match._id;

  const deleted = await call("DELETE", `/matches/${id}`, adminToken);
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));

  assert.equal(await Match.findById(id), null);
  const saved = await Tournament.findById(tournament._id);
  assert.ok(!saved.matches.some((mid) => String(mid) === String(id)), "fixture must be unlinked");

  const audit = await AuditLog.findOne({ action: "match.manual_deleted", targetId: String(id) });
  assert.ok(audit, "a manual delete must write an audit entry");
});

// ---------------------------------------------------------------------------
// Admin draft library + public draft exclusion
// ---------------------------------------------------------------------------

test("the admin manual-match list returns drafts and published matches for any creator", async () => {
  const club = await makeClub();
  const tournament = await makeTournament(club.teamA, club.teamB);
  const draft = await call("POST", "/matches/manual", adminToken, {
    ...buildPayload({ ...club, tournamentId: tournament._id }),
    draft: true,
    innings: [],
    result: {},
    manOfMatch: "",
  });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));

  const published = await call("POST", "/matches/manual", adminToken, buildPayload({ ...club, tournamentId: tournament._id }));
  assert.equal(published.status, 201, JSON.stringify(published.body));

  const anonymous = await call("GET", "/matches/manual");
  assert.equal(anonymous.status, 401);

  const user = await User.create({
    name: "Manual Viewer",
    email: `manual-viewer-${Math.random().toString(36).slice(2, 8)}@openctest.dev`,
    password: "password-123",
    role: "viewer",
    emailVerified: true,
  });
  const nonAdmin = await call("GET", "/matches/manual", generateToken(user));
  assert.equal(nonAdmin.status, 403);

  const listed = await call("GET", "/matches/manual", adminToken);
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  const ids = listed.body.matches.map((match) => String(match._id));
  assert.ok(ids.includes(String(draft.body.match._id)), "draft is listed");
  assert.ok(ids.includes(String(published.body.match._id)), "published match is listed");

  const draftRow = listed.body.matches.find((match) => String(match._id) === String(draft.body.match._id));
  assert.equal(draftRow.manualDraft, true);
  assert.equal(draftRow.stageLabel, "QF1");
  assert.equal(draftRow.tournament.name, tournament.name);
  assert.equal(draftRow.teams.length, 2);
});

test("manual drafts are never exposed by the public match or tournament reads", async () => {
  const club = await makeVisibleClub();
  const tournament = await makeTournament(club.teamA, club.teamB);
  const draft = await call("POST", "/matches/manual", adminToken, {
    ...buildPayload({ ...club, tournamentId: tournament._id }),
    draft: true,
    innings: [],
    result: {},
    manOfMatch: "",
  });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  const draftId = String(draft.body.match._id);

  const publicFeed = await call("GET", "/matches");
  assert.equal(publicFeed.status, 200);
  assert.ok(!publicFeed.body.some((match) => String(match._id) === draftId), "draft absent from GET /matches");

  const filteredFeed = await call("GET", `/matches?tournament=${tournament._id}`);
  assert.ok(!filteredFeed.body.some((match) => String(match._id) === draftId));

  const anonymousDetail = await call("GET", `/matches/${draftId}`);
  assert.equal(anonymousDetail.status, 404, "anonymous draft detail is not addressable");

  const user = await User.create({
    name: "Manual Reader",
    email: `manual-reader-${Math.random().toString(36).slice(2, 8)}@openctest.dev`,
    password: "password-123",
    role: "viewer",
    emailVerified: true,
  });
  const nonAdminDetail = await call("GET", `/matches/${draftId}`, generateToken(user));
  assert.equal(nonAdminDetail.status, 404, "a signed-in non-admin cannot open a draft");

  const adminDetail = await call("GET", `/matches/${draftId}`, adminToken);
  assert.equal(adminDetail.status, 200, JSON.stringify(adminDetail.body));
  assert.equal(adminDetail.body.manualDraft, true);

  const publicFixtures = await call("GET", `/tournaments/${tournament._id}/fixtures`);
  assert.ok(!publicFixtures.body.some((match) => String(match._id) === draftId));

  const adminFixtures = await call("GET", `/tournaments/${tournament._id}/fixtures`, adminToken);
  assert.ok(adminFixtures.body.some((match) => String(match._id) === draftId));

  const publicTournament = await call("GET", `/tournaments/${tournament._id}`);
  assert.ok(!(publicTournament.body.matches || []).some((match) => String(match._id) === draftId));

  const adminTournament = await call("GET", `/tournaments/${tournament._id}`, adminToken);
  assert.ok((adminTournament.body.matches || []).some((match) => String(match._id) === draftId));
});
