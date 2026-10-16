import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";

import express from "express";
import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import User from "../src/models/User.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import Match from "../src/models/Match.js";
import Tournament from "../src/models/Tournament.js";
import AuditLog from "../src/models/AuditLog.js";
import { validateTournamentAwards } from "../src/controllers/TournamentController.js";
import { generateToken } from "../src/utils/jwt.js";

// P4: end-of-tournament honours. An admin names a champion, a runner-up and
// three players; the server refuses anything that is not part of this
// tournament. The player-of-the-match rule for a single match lives here too,
// because it is the same "was this person actually in the game?" question.

let mongod;
let server;
let baseUrl;

before(async () => {
  mongod = await startTestDb();

  const { default: tournamentRoutes } = await import("../src/routes/tournamentRoutes.js");
  const { default: matchRoutes } = await import("../src/routes/matchRoutes.js");
  const app = express();
  app.use(express.json());
  app.use("/tournaments", tournamentRoutes);
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
    Team.deleteMany({}),
    Player.deleteMany({}),
    Match.deleteMany({}),
    Tournament.deleteMany({}),
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
async function makeAdmin() {
  counter += 1;
  const user = await User.create({
    name: `OPENCODE_TEST_Awards Admin ${counter}`,
    email: `awards-admin-${counter}-${Math.random().toString(36).slice(2, 8)}@openctest.dev`,
    password: "password-123",
    role: "admin",
    accountType: "viewer",
    emailVerified: true,
  });
  return { user, token: generateToken(user) };
}

// An 8-team knockout with squads, mirroring the real local-club draw.
async function makeKnockout(admin) {
  const teamA = await Team.create({ name: `OPENCODE_TEST Awards A ${counter}` });
  const teamB = await Team.create({ name: `OPENCODE_TEST Awards B ${counter}` });
  const teamC = await Team.create({ name: `OPENCODE_TEST Awards C ${counter}` });
  const teams = [teamA, teamB, teamC];

  const playerInA = await Player.create({ name: `OPENCODE_TEST Awards Batter ${counter}`, team: teamA._id });
  const playerInB = await Player.create({ name: `OPENCODE_TEST Awards Bowler ${counter}`, team: teamB._id });
  // Named in a squad but not on either team â€” the sort of stray id an award
  // form must refuse.
  const outsider = await Player.create({ name: `OPENCODE_TEST Awards Outsider ${counter}`, team: teamC._id });

  const tournament = await Tournament.create({
    name: `OPENCODE_TEST Awards Cup ${counter}`,
    shortName: "AWD",
    type: "knockout",
    startDate: new Date("2026-10-11"),
    endDate: new Date("2026-10-18"),
    teams: teams.map((t) => t._id),
    createdByAdmin: admin?.user?._id || null,
    tournamentSquads: [
      { team: teamA._id, players: [playerInA._id] },
      { team: teamB._id, players: [playerInB._id] },
    ],
  });

  return { teamA, teamB, teamC, playerInA, playerInB, outsider, tournament };
}

async function makeMatch({ teamA, teamB, player, status }) {
  return Match.create({
    title: "OPENCODE_TEST Awards Final",
    venue: "Ground",
    matchType: "T20",
    startAt: new Date(),
    teams: [teamA._id, teamB._id],
    status,
    innings: [
      { team: teamA._id, status: status === "completed" ? "completed" : "live" },
      { team: teamB._id, status: "upcoming" },
    ],
  });
}

// --- pure validation -------------------------------------------------------

test("awards: the champion must be one of the tournament's teams", () => {
  const ok = validateTournamentAwards({ body: { winner: "aaaaaaaaaaaaaaaaaaaaaaaa" }, teamIds: ["aaaaaaaaaaaaaaaaaaaaaaaa"] });
  assert.equal(ok.ok, true);

  const refused = validateTournamentAwards({ body: { winner: "bbbbbbbbbbbbbbbbbbbbbbbb" }, teamIds: ["aaaaaaaaaaaaaaaaaaaaaaaa"] });
  assert.equal(refused.ok, false);
  assert.match(refused.errors.winner, /tournament's teams/);
});

test("awards: champion and runner-up cannot be the same team", () => {
  const refused = validateTournamentAwards({
    body: { winner: "aaaaaaaaaaaaaaaaaaaaaaaa", runnerUp: "aaaaaaaaaaaaaaaaaaaaaaaa" },
    teamIds: ["aaaaaaaaaaaaaaaaaaaaaaaa"],
  });
  assert.equal(refused.ok, false);
  assert.match(refused.errors.runnerUp, /cannot be the same team/);
});

test("awards: a team id that is not a real ObjectId is refused", () => {
  const refused = validateTournamentAwards({ body: { winner: "not-an-objectid" }, teamIds: [] });
  assert.equal(refused.ok, false);
  assert.match(refused.errors.winner, /not a valid id/);
});

test("awards: a partial update never touches the awards it omits", () => {
  const result = validateTournamentAwards({
    body: { winner: "aaaaaaaaaaaaaaaaaaaaaaaa" },
    teamIds: ["aaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbb"],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { winner: "aaaaaaaaaaaaaaaaaaaaaaaa" });
  assert.equal("playerOfTournament" in result.data, false);
});

test("awards: an empty value clears an award", () => {
  const result = validateTournamentAwards({
    body: { winner: "", bestBatsman: null },
    teamIds: ["aaaaaaaaaaaaaaaaaaaaaaaa"],
    squadPlayerIds: ["cccccccccccccccccccccccc"],
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.winner, null);
  assert.equal(result.data.bestBatsman, null);
});

test("awards: squad membership is only enforced when the tournament has squads", () => {
  const stray = "dddddddddddddddddddddddd";
  // No squads recorded: we cannot know the roster, so a player is accepted.
  const withoutSquads = validateTournamentAwards({ body: { bestBatsman: stray }, teamIds: ["aaaaaaaaaaaaaaaaaaaaaaaa"] });
  assert.equal(withoutSquads.ok, true);

  // With squads: the player must actually be in one.
  const withSquads = validateTournamentAwards({
    body: { bestBatsman: stray },
    teamIds: ["aaaaaaaaaaaaaaaaaaaaaaaa"],
    squadPlayerIds: ["cccccccccccccccccccccccc"],
  });
  assert.equal(withSquads.ok, false);
  assert.match(withSquads.errors.bestBatsman, /tournament's squads/);
});

// --- the awards route over a real database ----------------------------------

test("awards route: an admin saves the honours and the public read shows them", async () => {
  const { token } = await makeAdmin();
  const { teamA, teamB, playerInA, playerInB, tournament } = await makeKnockout({ user: (await User.findOne({ role: "admin" })) });

  const saved = await call("PUT", `/tournaments/${tournament._id}/awards`, token, {
    winner: teamA._id.toString(),
    runnerUp: teamB._id.toString(),
    playerOfTournament: playerInA._id.toString(),
    bestBatsman: playerInA._id.toString(),
    bestBowler: playerInB._id.toString(),
  });

  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(String(saved.body.tournament.winner._id), String(teamA._id));
  assert.equal(saved.body.tournament.awards.bestBowler.name, playerInB.name);

  // A guest's tournament page carries the honours too.
  const read = await call("GET", `/tournaments/${tournament._id}`, null);
  assert.equal(read.status, 200);
  assert.equal(String(read.body.winner._id), String(teamA._id));
  assert.equal(String(read.body.runnerUp._id), String(teamB._id));
  assert.equal(read.body.awards.playerOfTournament.name, playerInA.name);

  const audit = await AuditLog.findOne({ action: "tournament.awards_set" });
  assert.ok(audit, "setting the honours is audited");
  assert.equal(String(audit.targetId), String(tournament._id));
});

test("awards route: a team outside the tournament is refused", async () => {
  const { token } = await makeAdmin();
  const { teamA, tournament } = await makeKnockout({ user: await User.findOne({ role: "admin" }) });
  // A team that exists but is not part of this tournament.
  const outsiderTeam = await Team.create({ name: `OPENCODE_TEST Awards Outsider Team ${counter}` });

  const refused = await call("PUT", `/tournaments/${tournament._id}/awards`, token, {
    winner: outsiderTeam._id.toString(),
    runnerUp: teamA._id.toString(),
  });

  assert.equal(refused.status, 400);
  assert.match(refused.body.errors.winner, /tournament's teams/);
  assert.equal(refused.body.errors.runnerUp, undefined, "only the offending field is reported");

  const unchanged = await Tournament.findById(tournament._id).lean();
  assert.ok(!unchanged.winner, "nothing is written when validation fails");
});

test("awards route: a player outside the squads is refused", async () => {
  const { token } = await makeAdmin();
  const { teamA, teamB, outsider, tournament } = await makeKnockout({ user: await User.findOne({ role: "admin" }) });

  const refused = await call("PUT", `/tournaments/${tournament._id}/awards`, token, {
    winner: teamA._id.toString(),
    runnerUp: teamB._id.toString(),
    bestBatsman: outsider._id.toString(),
  });

  assert.equal(refused.status, 400);
  assert.match(refused.body.errors.bestBatsman, /tournament's squads/);
});

test("awards route: clearing one award leaves the others alone", async () => {
  const { token } = await makeAdmin();
  const { teamA, teamB, playerInA, playerInB, tournament } = await makeKnockout({ user: await User.findOne({ role: "admin" }) });

  await call("PUT", `/tournaments/${tournament._id}/awards`, token, {
    winner: teamA._id.toString(),
    runnerUp: teamB._id.toString(),
    bestBatsman: playerInA._id.toString(),
    bestBowler: playerInB._id.toString(),
  });

  // The organiser changes their mind about the best bowler only.
  const cleared = await call("PUT", `/tournaments/${tournament._id}/awards`, token, { bestBowler: "" });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));

  const after = await Tournament.findById(tournament._id).lean();
  assert.equal(after.awards.bestBowler, null);
  assert.equal(String(after.awards.bestBatsman), String(playerInA._id), "the other awards survive a clear");
  assert.equal(String(after.winner), String(teamA._id));
});

test("awards route: a non-admin is refused", async () => {
  counter += 1;
  const viewer = await User.create({
    name: `OPENCODE_TEST Awards Viewer ${counter}`,
    email: `awards-viewer-${counter}-${Math.random().toString(36).slice(2, 8)}@openctest.dev`,
    password: "password-123",
    role: "viewer",
    accountType: "viewer",
    emailVerified: true,
  });
  const { tournament, teamA } = await makeKnockout({ user: await User.findOne({ role: "admin" }) });

  const refused = await call("PUT", `/tournaments/${tournament._id}/awards`, generateToken(viewer), {
    winner: teamA._id.toString(),
  });

  assert.equal(refused.status, 403);
});

// --- player of the match ----------------------------------------------------

test("mom route: it is refused until the match is completed", async () => {
  const { token } = await makeAdmin();
  const { teamA, teamB, playerInA } = await makeKnockout({ user: await User.findOne({ role: "admin" }) });
  const match = await makeMatch({ teamA, teamB, player: playerInA, status: "live" });

  const refused = await call("PUT", `/matches/${match._id}/mom`, token, { playerId: playerInA._id.toString() });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, "MOM_REQUIRES_COMPLETED_MATCH");

  const unchanged = await Match.findById(match._id).lean();
  assert.ok(!unchanged.manOfMatch, "no player of the match was written");
});

test("mom route: a player from either team is accepted and audited", async () => {
  const { token } = await makeAdmin();
  const { teamA, teamB, playerInA } = await makeKnockout({ user: await User.findOne({ role: "admin" }) });
  const match = await makeMatch({ teamA, teamB, player: playerInA, status: "completed" });

  const saved = await call("PUT", `/matches/${match._id}/mom`, token, { playerId: playerInA._id.toString() });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.match.manOfMatch.name, playerInA.name);

  const audit = await AuditLog.findOne({ action: "match.mom_set" });
  assert.ok(audit, "awarding the player of the match is audited");
});

test("mom route: a player who was not in the match is refused", async () => {
  const { token } = await makeAdmin();
  const { teamA, teamB, outsider } = await makeKnockout({ user: await User.findOne({ role: "admin" }) });
  const match = await makeMatch({ teamA, teamB, status: "completed" });

  const refused = await call("PUT", `/matches/${match._id}/mom`, token, { playerId: outsider._id.toString() });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, "MOM_PLAYER_NOT_IN_MATCH");

  const unchanged = await Match.findById(match._id).lean();
  assert.ok(!unchanged.manOfMatch, "a player who did not play is not recorded");
});

test("mom route: a paper-match player named only in the innings is accepted", async () => {
  const { token } = await makeAdmin();
  const { teamA, teamB } = await makeKnockout({ user: await User.findOne({ role: "admin" }) });
  // A paper match records its roster on the match, so the batter has no
  // Player.team link. They must still be eligible.
  const paperBatter = await Player.create({ name: `OPENCODE_TEST Awards Paper ${counter}` });
  const match = await Match.create({
    title: "OPENCODE_TEST Awards Paper Final",
    venue: "Ground",
    matchType: "T20",
    startAt: new Date(),
    teams: [teamA._id, teamB._id],
    status: "completed",
    innings: [
      { team: teamA._id, status: "completed", batting: [{ player: paperBatter._id, runs: 40 }] },
      { team: teamB._id, status: "completed" },
    ],
  });

  const saved = await call("PUT", `/matches/${match._id}/mom`, token, { playerId: paperBatter._id.toString() });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.match.manOfMatch.name, paperBatter.name);
});

test("mom route: an empty body clears the honour", async () => {
  const { token } = await makeAdmin();
  const { teamA, teamB, playerInA } = await makeKnockout({ user: await User.findOne({ role: "admin" }) });
  const match = await makeMatch({ teamA, teamB, player: playerInA, status: "completed" });
  await Match.updateOne({ _id: match._id }, { manOfMatch: playerInA._id });

  const cleared = await call("PUT", `/matches/${match._id}/mom`, token, { playerId: "" });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.equal(cleared.body.match.manOfMatch, null);
});

test("mom route: a player id that is not an ObjectId is refused", async () => {
  const { token } = await makeAdmin();
  const { teamA, teamB } = await makeKnockout({ user: await User.findOne({ role: "admin" }) });
  const match = await makeMatch({ teamA, teamB, status: "completed" });

  const refused = await call("PUT", `/matches/${match._id}/mom`, token, { playerId: "banana" });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, "MOM_INVALID_PLAYER");
});

test("mom controller: works directly through mockReq/mockRes", async () => {
  const { setMOM } = await import("../src/controllers/matchController.js");
  const admin = await User.findOne({ role: "admin" }) || (await makeAdmin()).user;
  const { teamA, teamB, playerInA } = await makeKnockout({ user: admin });
  const match = await makeMatch({ teamA, teamB, status: "completed" });

  const res = mockRes();
  await setMOM(mockReq({ user: admin, params: { id: match._id.toString() }, body: { playerId: playerInA._id.toString() } }), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.match.manOfMatch.name, playerInA.name);
});
