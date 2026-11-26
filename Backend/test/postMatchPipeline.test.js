import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";

import mongoose from "mongoose";
import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import Match from "../src/models/Match.js";
import Tournament from "../src/models/Tournament.js";
import TeamRanking from "../src/models/TeamRanking.js";
import { endInnings } from "../src/controllers/inningsController.js";
import { updateMatchStatus, abandonMatch } from "../src/controllers/matchController.js";
import { revertLastBall } from "../src/controllers/scoreController.js";
import { createManualMatch } from "../src/controllers/manualScorecardController.js";
import { updateMatchStatusOfficial } from "../src/controllers/analyticsController.js";
import { runPostMatchPipeline } from "../src/services/postMatch.js";

// Every completion path must leave the derived tables (team rankings, player
// career figures, tournament points) rebuilt exactly once, and undo must remove
// the contribution again. These tests drive the real controllers against a
// throwaway MongoDB, so they exercise the same code the API calls.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

let mongod;

before(async () => {
  mongod = await startTestDb();
});

after(async () => {
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Promise.all([
    Team.deleteMany({}),
    Player.deleteMany({}),
    Match.deleteMany({}),
    Tournament.deleteMany({}),
    TeamRanking.deleteMany({}),
  ]);
});

let seq = 0;
const unique = (label) => {
  seq += 1;
  return `PMTEST_${label}_${seq}_${Date.now()}`;
};

const completedInnings = (values) => ({ ...values, status: "completed" });

/**
 * Two teams, four players, one tournament and one match. The match is already
 * completed by default; pass `status: "live"` to leave the chase unfinished so
 * a controller can complete it through its own path.
 */
async function seedMatch({ status = "completed", withTournament = true } = {}) {
  const [batter, bowler, keeper, opponent] = await Player.create([
    { name: unique("batter") },
    { name: unique("bowler") },
    { name: unique("keeper") },
    { name: unique("opponent") },
  ]);

  const teamA = await Team.create({
    name: unique("TeamA"),
    players: [batter._id, bowler._id],
  });
  const teamB = await Team.create({
    name: unique("TeamB"),
    players: [keeper._id, opponent._id],
  });

  const innings = [
    completedInnings({
      team: teamA._id,
      runs: 150,
      wickets: 5,
      balls: 120,
      overs: 20,
      batting: [
        {
          player: batter._id,
          runs: 75,
          balls: 50,
          fours: 6,
          sixes: 3,
          isOut: true,
          dismissalType: "caught",
          fielder: keeper._id,
        },
      ],
      bowling: [{ player: opponent._id, balls: 120, overs: 20, runs: 150, wickets: 3 }],
    }),
    completedInnings({
      team: teamB._id,
      runs: 140,
      wickets: 8,
      balls: 120,
      overs: 20,
      target: 151,
      batting: [
        { player: opponent._id, runs: 40, balls: 30, isOut: true, dismissalType: "bowled" },
      ],
      bowling: [{ player: batter._id, balls: 120, overs: 20, runs: 130, wickets: 2 }],
    }),
  ];

  if (status !== "completed") {
    innings[1].status = "live";
    innings[1].balls = 120;
    innings[1].overs = 20;
  }

  const match = await Match.create({
    title: unique("match"),
    matchType: "T20",
    totalOvers: 20,
    teams: [teamA._id, teamB._id],
    innings,
    currentInnings: 1,
    status,
    // A status-only completion relies on the already-recorded result, the same
    // as the scoring UI: it writes the result before flipping the status.
    result: { winner: teamA._id, resultType: "normal", margin: "10 runs", description: "Team A won by 10 runs" },
    playingXI: [
      { team: teamA._id, players: [batter._id, bowler._id] },
      { team: teamB._id, players: [keeper._id, opponent._id] },
    ],
  });

  let tournament = null;
  if (withTournament) {
    tournament = await Tournament.create({
      name: unique("cup"),
      startDate: new Date("2026-10-01T00:00:00Z"),
      endDate: new Date("2026-10-31T00:00:00Z"),
      type: "league",
      teams: [teamA._id, teamB._id],
      matches: [match._id],
    });
    match.tournament = tournament._id;
    await match.save();
  }

  return { match, tournament, teamA, teamB, batter, bowler, keeper, opponent };
}

const rankingFor = (teamId) => TeamRanking.findOne({ team: teamId }).lean();

const pointsRowFor = async (tournamentId, teamId) => {
  const tournament = await Tournament.findById(tournamentId).lean();
  return (tournament.pointsTable || []).find((row) => String(row.team) === String(teamId));
};

/** Count how many times the pipeline writes career figures for one call. */
async function countPlayerWrites(fn) {
  const original = Player.bulkWrite;
  let calls = 0;
  Player.bulkWrite = async (...args) => {
    calls += 1;
    return original.apply(Player, args);
  };
  try {
    await fn();
  } finally {
    Player.bulkWrite = original;
  }
  return calls;
}

test("/end-innings rebuilds rankings, career figures and the points table once", async () => {
  const seeded = await seedMatch({ status: "live" });
  const res = mockRes();

  const writes = await countPlayerWrites(async () => {
    await endInnings(
      mockReq({ params: { matchId: String(seeded.match._id) }, body: { inningsIndex: 1 } }),
      res,
    );
  });

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.match.status, "completed");
  assert.equal(res.body.postMatch?.ok, true, (res.body.postMatch?.errors || []).join("; "));
  assert.equal(writes, 1, "career figures should be written once per completion");

  const ranking = await rankingFor(seeded.teamA._id);
  assert.equal(ranking.matchesPlayed, 1);
  assert.equal(ranking.matchesWon, 1);
  assert.equal(ranking.points, 2);
  assert.equal(ranking.overallRank, 1);

  const batter = await Player.findById(seeded.batter._id).lean();
  assert.equal(batter.stats.runs, 75);
  assert.equal(batter.stats.fifties, 1);
  assert.equal(batter.stats.matches, 1);

  const keeper = await Player.findById(seeded.keeper._id).lean();
  assert.equal(keeper.stats.catches, 1, "a credited catch must reach Player.stats");

  const row = await pointsRowFor(seeded.tournament._id, seeded.teamA._id);
  assert.equal(row.won, 1);
  assert.equal(row.points, 2);
});

test("the pipeline is idempotent: running it twice yields identical rows", async () => {
  const seeded = await seedMatch();

  const pick = (source, fields) =>
    Object.fromEntries(fields.map((field) => [field, source?.[field]]));
  const snapshot = async () => ({
    ranking: pick(await rankingFor(seeded.teamA._id), [
      "matchesPlayed", "matchesWon", "matchesLost", "matchesDrawn", "matchesNoResult",
      "points", "rating", "netRunRate", "overallRank", "categoryRank", "form",
    ]),
    batter: { ...(await Player.findById(seeded.batter._id).lean()).stats },
    table: pick(await pointsRowFor(seeded.tournament._id, seeded.teamA._id), [
      "matchesPlayed", "won", "lost", "tied", "noResult",
      "points", "netRunRate", "for", "against", "wicketsFor", "wicketsAgainst",
    ]),
  });

  await runPostMatchPipeline(seeded.match._id, { reason: "test:first" });
  const first = await snapshot();

  await runPostMatchPipeline(seeded.match._id, { reason: "test:second" });
  const second = await snapshot();

  assert.deepEqual(second, first);
});

test("a failing ranking step does not fail completion and is reported", async () => {
  const seeded = await seedMatch({ status: "live" });
  const res = mockRes();

  const original = TeamRanking.findOneAndUpdate;
  TeamRanking.findOneAndUpdate = async () => {
    throw new Error("ranking store unavailable");
  };
  try {
    await endInnings(
      mockReq({ params: { matchId: String(seeded.match._id) }, body: { inningsIndex: 1 } }),
      res,
    );
  } finally {
    TeamRanking.findOneAndUpdate = original;
  }

  assert.equal(res.statusCode, 200, "completion must still succeed");
  assert.equal(res.body.match.status, "completed");
  assert.equal(res.body.postMatch.ok, false);
  assert.ok(
    res.body.postMatch.errors.some((error) => /ranking store unavailable/.test(error)),
    JSON.stringify(res.body.postMatch.errors),
  );

  // The rest of the pipeline still ran.
  const batter = await Player.findById(seeded.batter._id).lean();
  assert.equal(batter.stats.runs, 75);
  const row = await pointsRowFor(seeded.tournament._id, seeded.teamA._id);
  assert.equal(row.points, 2);
});

test("PUT /matches/:id/status completes and reopens through the same pipeline", async () => {
  const seeded = await seedMatch({ status: "live" });

  const complete = mockRes();
  await updateMatchStatus(
    mockReq({ params: { id: String(seeded.match._id) }, body: { status: "completed" } }),
    complete,
  );
  assert.equal(complete.statusCode, 200, JSON.stringify(complete.body));
  assert.equal(complete.body.postMatch.ok, true);
  assert.equal((await rankingFor(seeded.teamA._id)).points, 2);

  const reopen = mockRes();
  await updateMatchStatus(
    mockReq({ params: { id: String(seeded.match._id) }, body: { status: "live" } }),
    reopen,
  );
  assert.equal(reopen.statusCode, 200, JSON.stringify(reopen.body));
  assert.equal(reopen.body.postMatch.ok, true);

  const ranking = await rankingFor(seeded.teamA._id);
  assert.equal(ranking.matchesPlayed, 0, "an unfinished match must not stay counted");
  assert.equal(ranking.points, 0);

  const batter = await Player.findById(seeded.batter._id).lean();
  assert.equal(batter.stats.runs, 0);

  const row = await pointsRowFor(seeded.tournament._id, seeded.teamA._id);
  assert.equal(row.points, 0);
});

test("reverting the ball that completed a match removes its contribution", async () => {
  const seeded = await seedMatch();
  await runPostMatchPipeline(seeded.match._id, { reason: "test:seed" });
  assert.equal((await rankingFor(seeded.teamA._id)).points, 2);

  const match = await Match.findById(seeded.match._id);
  match.innings[1].oversHistory = [
    {
      overNumber: 19,
      isComplete: true,
      balls: [
        {
          runs: 1,
          extraRuns: 0,
          isWide: false,
          isNoBall: false,
          isBye: false,
          isLegBye: false,
          isWicket: false,
          batsmanOnStrike: seeded.opponent._id,
          batsmanNonStrike: seeded.keeper._id,
          bowler: seeded.batter._id,
          notation: "1",
          ballNumber: 6,
          displayBallNumber: 6,
          freeHitNext: false,
        },
      ],
    },
  ];
  await match.save();

  const res = mockRes();
  await revertLastBall(
    mockReq({ params: { matchId: String(seeded.match._id) }, body: { inningsIndex: 1 } }),
    res,
  );

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.match.status, "live");
  assert.equal(res.body.postMatch?.ok, true, (res.body.postMatch?.errors || []).join("; "));

  const ranking = await rankingFor(seeded.teamA._id);
  assert.equal(ranking.matchesPlayed, 0);
  assert.equal(ranking.points, 0);

  const batter = await Player.findById(seeded.batter._id).lean();
  assert.equal(batter.stats.runs, 0, "career figures must be rebuilt without the reverted match");

  const row = await pointsRowFor(seeded.tournament._id, seeded.teamA._id);
  assert.equal(row.points, 0);
});

test("a manual scorecard publish rebuilds the derived tables", async () => {
  const playersA = await Player.create([
    { name: unique("manualA1") },
    { name: unique("manualA2") },
  ]);
  const playersB = await Player.create([
    { name: unique("manualB1") },
    { name: unique("manualB2") },
  ]);
  const teamA = await Team.create({ name: unique("ManualA"), players: playersA.map((p) => p._id) });
  const teamB = await Team.create({ name: unique("ManualB"), players: playersB.map((p) => p._id) });
  const tournament = await Tournament.create({
    name: unique("manualCup"),
    startDate: new Date("2026-10-08T00:00:00Z"),
    endDate: new Date("2026-10-20T00:00:00Z"),
    type: "knockout",
    teams: [teamA._id, teamB._id],
  });

  const payload = {
    tournamentId: String(tournament._id),
    stage: "quarter_final",
    stageLabel: "QF1",
    teamA: String(teamA._id),
    teamB: String(teamB._id),
    startAt: "2026-10-11T09:00:00Z",
    totalOvers: 20,
    tossWinner: String(teamA._id),
    tossDecision: "bat",
    draft: false,
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
  };

  const res = mockRes();
  await createManualMatch(
    mockReq({ body: payload, user: { _id: new mongoose.Types.ObjectId(), username: "pmtest" } }),
    res,
  );

  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(res.body.postMatch?.ok, true, (res.body.postMatch?.errors || []).join("; "));

  const ranking = await rankingFor(teamA._id);
  assert.equal(ranking.matchesPlayed, 1);
  assert.equal(ranking.points, 2);

  const player = await Player.findById(playersA[0]._id).lean();
  assert.equal(player.stats.runs, 50);
  assert.equal(player.stats.fifties, 1);

  const row = await pointsRowFor(tournament._id, teamA._id);
  assert.equal(row.points, 2);
});

test("the official-status endpoint rebuilds the derived tables too", async () => {
  const seeded = await seedMatch({ status: "live" });
  const res = mockRes();

  await updateMatchStatusOfficial(
    mockReq({ params: { matchId: String(seeded.match._id) }, body: { status: "completed" } }),
    res,
  );

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.postMatch?.ok, true, (res.body.postMatch?.errors || []).join("; "));
  const ranking = await rankingFor(seeded.teamA._id);
  assert.equal(ranking.matchesPlayed, 1);
  assert.equal(ranking.points, 2);
  // The scorecard was already complete; only the status was left open.
  const batter = await Player.findById(seeded.batter._id).lean();
  assert.equal(batter.stats.runs, 75);
});

// T1.1: an abandoned match is a no-result. Team rankings still only count
// completed matches, but the tournament table gives both sides the no-result
// points (pointsConfig.noResult, default 1) and leaves NRR untouched.
test("abandoning a match gives no-result points in the table and nothing in rankings", async () => {
  const seeded = await seedMatch({ status: "live" });
  const res = mockRes();

  await abandonMatch(
    mockReq({ params: { id: String(seeded.match._id) }, body: { reason: "rain" } }),
    res,
  );

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.postMatch?.ok, true, (res.body.postMatch?.errors || []).join("; "));
  const ranking = await rankingFor(seeded.teamA._id);
  assert.equal(ranking?.matchesPlayed || 0, 0);
  const row = await pointsRowFor(seeded.tournament._id, seeded.teamA._id);
  assert.equal(row.points, 1);
  assert.equal(row.noResult, 1);
  assert.equal(row.matchesPlayed, 1);
  assert.equal(row.netRunRate, 0);
});

test("npm run stats:recompute is a dry run by default and writes with --apply", async () => {
  const seeded = await seedMatch();
  const baseUri = mongod.getUri();
  const mongoUrl = baseUri.endsWith("/") ? `${baseUri}cricall_test` : `${baseUri}/cricall_test`;
  const script = path.resolve(__dirname, "../src/scripts/recomputeStats.js");
  const run = (extraArgs) =>
    execFileAsync(process.execPath, [script, `--match=${seeded.match._id}`, ...extraArgs], {
      env: { ...process.env, MONGO_URL: mongoUrl },
      cwd: path.resolve(__dirname, ".."),
    });

  const dry = await run([]);
  assert.match(dry.stdout, /MODE: DRY RUN/);
  assert.match(dry.stdout, /Would recompute/);
  const before = await Player.findById(seeded.batter._id).lean();
  assert.equal(before.stats.runs, 0, "dry run must not write");

  const applied = await run(["--apply"]);
  assert.match(applied.stdout, /MODE: APPLY/);
  const after = await Player.findById(seeded.batter._id).lean();
  assert.equal(after.stats.runs, 75);
  assert.equal((await rankingFor(seeded.teamA._id)).points, 2);
});
