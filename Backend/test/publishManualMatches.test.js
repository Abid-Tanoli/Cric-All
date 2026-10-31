// Tests for src/scripts/publishManualMatches.js. The script's core is exercised
// against a throwaway mongodb-memory-server database; nothing connects to a real
// environment, and the default (dry run) is asserted to write nothing.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startTestDb, stopTestDb } from "./helpers/testDb.js";
import Player from "../src/models/Player.js";
import Team from "../src/models/Team.js";
import Match from "../src/models/Match.js";
import Tournament from "../src/models/Tournament.js";
import { runPublish, resolveTargetMatches } from "../src/scripts/publishManualMatches.js";
import {
  manualMatchToPayload,
  updateManualMatch,
} from "../src/controllers/manualScorecardController.js";
import { getPlayerStatsBundle } from "../src/services/playerStats.js";
import {
  computeTournamentStats,
  readTournamentStatsCache,
  writeTournamentStatsCache,
} from "../src/services/tournamentStats.js";

let mongod;

before(async () => {
  mongod = await startTestDb();
});

after(async () => {
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Promise.all([
    Player.deleteMany({}),
    Team.deleteMany({}),
    Match.deleteMany({}),
    Tournament.deleteMany({}),
  ]);
});

let seq = 0;

async function makeDraft({ tournament = null } = {}) {
  seq += 1;
  const playersA = await Player.create([
    { name: `Public Script A${seq}_0` },
    { name: `Public Script A${seq}_1` },
  ]);
  const playersB = await Player.create([
    { name: `Public Script B${seq}_0` },
    { name: `Public Script B${seq}_1` },
  ]);
  const teamA = await Team.create({ name: `Public Script A ${seq}`, players: playersA.map((p) => p._id) });
  const teamB = await Team.create({ name: `Public Script B ${seq}`, players: playersB.map((p) => p._id) });

  const currentTournament = tournament || await Tournament.create({
    name: `Public Script Cup ${seq}`,
    startDate: new Date("2026-10-01T00:00:00Z"),
    endDate: new Date("2026-10-31T00:00:00Z"),
    type: "knockout",
    teams: [teamA._id, teamB._id],
  });

  const match = await Match.create({
    title: `${teamA.name} vs ${teamB.name}`,
    matchType: "T20",
    totalOvers: 20,
    stage: "quarter_final",
    stageLabel: `QF${seq}`,
    tournament: currentTournament._id,
    teams: [teamA._id, teamB._id],
    startAt: new Date("2026-10-18T09:00:00Z"),
    status: "upcoming",
    source: "manual",
    manualDraft: true,
    innings: [
      {
        team: teamA._id,
        runs: 50,
        wickets: 1,
        overs: 4,
        balls: 24,
        extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0, total: 0 },
        batting: [{
          player: playersA[0]._id,
          runs: 50,
          balls: 30,
          fours: 5,
          sixes: 1,
          isOut: true,
          dismissalType: "caught",
        }],
        bowling: [{
          player: playersB[0]._id,
          overs: 4,
          balls: 24,
          maidens: 0,
          runs: 50,
          wickets: 1,
        }],
        fallOfWickets: [{ runs: 50, wickets: 1, player: playersA[0]._id, overs: 24 }],
        status: "completed",
      },
      {
        team: teamB._id,
        runs: 40,
        wickets: 1,
        overs: 4,
        balls: 24,
        extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0, total: 0 },
        batting: [{
          player: playersB[0]._id,
          runs: 40,
          balls: 24,
          fours: 1,
          sixes: 2,
          isOut: true,
          dismissalType: "bowled",
        }],
        bowling: [{
          player: playersA[0]._id,
          overs: 4,
          balls: 24,
          maidens: 0,
          runs: 40,
          wickets: 1,
        }],
        fallOfWickets: [],
        status: "completed",
      },
    ],
    result: { winner: teamA._id, margin: "10 runs", resultType: "normal" },
    manOfMatch: playersA[0]._id,
  });

  currentTournament.matches.push(match._id);
  await currentTournament.save();
  return { match, tournament: currentTournament, teamA, teamB };
}

test("dry run validates a draft and writes nothing", async () => {
  const { match } = await makeDraft();
  const report = await runPublish({ matchIds: [String(match._id)], log: () => {} });

  assert.equal(report.apply, false);
  assert.equal(report.counts["WOULD PUBLISH"], 1);
  const unchanged = await Match.findById(match._id);
  assert.equal(unchanged.manualDraft, true);
  assert.equal(unchanged.status, "upcoming");
});

test("--tournament selects drafts, and --apply publishes through the shared path", async () => {
  const { match, tournament, teamA } = await makeDraft();

  const selected = await resolveTargetMatches({ tournamentId: String(tournament._id) });
  assert.equal(selected.matches.length, 1);
  assert.equal(String(selected.matches[0]._id), String(match._id));

  const report = await runPublish({ tournamentId: String(tournament._id), apply: true, log: () => {} });
  assert.equal(report.counts.PUBLISHED, 1);
  assert.equal(report.blocked, 0);

  const saved = await Match.findById(match._id);
  assert.equal(saved.manualDraft, false);
  assert.equal(saved.status, "completed");

  const savedTournament = await Tournament.findById(tournament._id);
  const row = savedTournament.pointsTable.find((entry) => String(entry.team) === String(teamA._id));
  assert.equal(row?.points, 2, "the shared publish path recomputes standings");
});

test("PUT manual publishes a draft, invalidates tournament cache, and refreshes profile stats", async () => {
  const { match, tournament } = await makeDraft();
  const playerId = String(match.innings[0].batting[0].player);
  const before = await getPlayerStatsBundle(playerId);
  assert.equal(before.stats.runs, 0);

  writeTournamentStatsCache(tournament._id, {}, { stale: true });
  const req = {
    params: { id: String(match._id) },
    body: { ...manualMatchToPayload(match), draft: false },
  };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await updateManualMatch(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.match.manualDraft, false);
  assert.equal(res.body.match.status, "completed");
  assert.equal(readTournamentStatsCache(tournament._id, {}), null);

  const after = await getPlayerStatsBundle(playerId);
  assert.equal(after.stats.runs, 50);
  assert.equal(after.stats.wickets, 1);
  const publishedMatches = await Match.find({
    tournament: tournament._id,
    status: "completed",
  }).populate("teams", "name shortName logo")
    .populate("innings.team", "name shortName logo")
    .lean();
  const tournamentStats = computeTournamentStats({
    matches: publishedMatches,
    minBallsFaced: 0,
    minOvers: 0,
  });
  assert.equal(
    after.stats.runs,
    tournamentStats.topRunScorers.find((row) => row.playerId === playerId).runs,
  );
  assert.equal(
    after.stats.wickets,
    tournamentStats.topWicketTakers.find((row) => row.playerId === playerId).wickets,
  );
});

test("a second --apply is idempotent (already published is skipped)", async () => {
  const { match } = await makeDraft();
  await runPublish({ matchIds: [String(match._id)], apply: true, log: () => {} });
  const second = await runPublish({ matchIds: [String(match._id)], apply: true, log: () => {} });

  assert.equal(second.counts.SKIP, 1);
  assert.equal(second.counts.PUBLISHED || 0, 0);
});

test("an invalid draft is blocked and never written", async () => {
  const { match } = await makeDraft();
  // A complete scorecard needs a winner; clearing it makes the stored draft
  // fail the same validator the Admin publish path uses.
  match.result.winner = null;
  await match.save({ validateModifiedOnly: true });

  const report = await runPublish({ matchIds: [String(match._id)], apply: true, log: () => {} });
  assert.equal(report.counts.BLOCKED, 1);
  assert.equal(report.blocked, 1);

  const saved = await Match.findById(match._id);
  assert.equal(saved.manualDraft, true);
  assert.equal(saved.status, "upcoming");
});
