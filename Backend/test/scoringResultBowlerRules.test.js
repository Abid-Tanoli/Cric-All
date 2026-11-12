import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import Match from "../src/models/Match.js";
import { ScoringEngine } from "../src/services/scoring/ScoringEngine.js";
import { processDeliveryWithEngine } from "../src/services/scoring/controllerAdapter.js";
import { computeChaseState, buildMatchResult, buildNoResultResult } from "../src/utils/resultHelpers.js";
import { getBowlerQuota } from "../src/services/scoring/bowlerRules.js";
import { updateScore, setBowler } from "../src/controllers/scoreController.js";
import { __setAiCommentaryEnabledForTests } from "../src/services/aiCommentary.js";

let mongod;
let seq = 0;
const ids = {};

before(async () => {
  mongod = await startTestDb();
  __setAiCommentaryEnabledForTests(false);

  const [teamA, teamB] = await Team.create([
    { name: "OPENCODE_TEST_result_rules_a" },
    { name: "OPENCODE_TEST_result_rules_b" },
  ]);
  ids.teamA = teamA._id;
  ids.teamB = teamB._id;

  const players = await Player.create(
    ["result_bat1", "result_bat2", "result_bowl1", "result_bowl2"].map((name) => ({ name }))
  );
  ids.bat1 = players[0]._id;
  ids.bat2 = players[1]._id;
  ids.bowl1 = players[2]._id;
  ids.bowl2 = players[3]._id;
});

after(async () => {
  await stopTestDb(mongod);
});

function inningsDoc(teamId, overrides = {}) {
  return {
    team: teamId,
    runs: 0,
    wickets: 0,
    balls: 0,
    overs: 0,
    status: "upcoming",
    extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalties: 0, total: 0 },
    oversHistory: [],
    batting: [],
    bowling: [],
    fielding: [],
    partnerships: [],
    fallOfWickets: [],
    ...overrides,
  };
}

async function newMatch({ inningsIndex = 0, target = 0, ...overrides } = {}) {
  seq += 1;
  const innings = [
    inningsDoc(ids.teamA, inningsIndex === 0 ? { status: "live" } : { status: "completed", runs: 150, balls: 120 }),
    inningsDoc(ids.teamB, inningsIndex === 1 ? { status: "live", target } : { status: "upcoming" }),
  ];
  return Match.create({
    title: `OPENCODE_TEST_result_rules_${seq}`,
    matchType: "T20",
    teams: [ids.teamA, ids.teamB],
    totalOvers: 20,
    status: "live",
    currentInnings: inningsIndex,
    innings,
    ...overrides,
  });
}

function legalBalls(count, start = 1) {
  return Array.from({ length: count }, (_, index) => ({
    ballNumber: start + index,
    isWide: false,
    isNoBall: false,
  }));
}

test("the chase state uses total legal balls bowled and returns 28 balls remaining after 92 balls", () => {
  const state = computeChaseState(
    { totalOvers: 20 },
    { target: 180, runs: 100, balls: 92 }
  );

  assert.equal(state.runsNeeded, 80);
  assert.equal(state.ballsRemaining, 28);
  assert.equal(state.requiredRunRate, 17.14);
});

test("a wicket win reports the legal balls left, not the balls already bowled", () => {
  const result = buildMatchResult({
    innings1: { team: { name: "Falcons" }, runs: 150 },
    innings2: { team: { name: "Strikers" }, runs: 151, wickets: 6, balls: 92 },
    match: { totalOvers: 20 },
    maxWickets: 10,
  });

  assert.equal(result.margin, "4 wickets");
  assert.equal(result.description, "Strikers won by 4 wickets (28 balls remaining)");
});

test("run wins, ties and no-results share the same result format", () => {
  const runs = buildMatchResult({
    innings1: { team: { name: "Falcons" }, runs: 150 },
    innings2: { team: { name: "Strikers" }, runs: 140, wickets: 9, balls: 120 },
    match: { totalOvers: 20 },
  });
  assert.equal(runs.description, "Falcons won by 10 runs");

  const tie = buildMatchResult({
    innings1: { team: { name: "Falcons" }, runs: 150 },
    innings2: { team: { name: "Strikers" }, runs: 150, wickets: 7, balls: 120 },
    match: { totalOvers: 20 },
  });
  assert.equal(tie.description, "Match tied");
  assert.equal(tie.resultType, "tie");

  const noResult = buildNoResultResult();
  assert.equal(noResult.description, "Match abandoned - no result");
  assert.equal(noResult.resultType, "no result");
});

test("the scoring engine result uses 20 overs minus 92 balls = 28 remaining", () => {
  const engine = new ScoringEngine({
    matchType: "T20",
    status: "live",
    totalOvers: 20,
    innings: [
      { team: { name: "Falcons" }, runs: 150, wickets: 8, balls: 120 },
      { team: { name: "Strikers" }, runs: 151, wickets: 6, balls: 92 },
    ],
  });

  engine._calculateResult();
  assert.equal(engine.match.result.description, "Strikers won by 4 wickets (28 balls remaining)");
});

test("updateScore recomputes the live required run rate before returning/emitting the chase", async () => {
  const match = await Match.create({
    title: `OPENCODE_TEST_result_rules_rrr_${++seq}`,
    matchType: "T20",
    teams: [ids.teamA, ids.teamB],
    totalOvers: 20,
    status: "live",
    currentInnings: 1,
    innings: [
      inningsDoc(ids.teamA, { status: "completed", runs: 150, balls: 120 }),
      inningsDoc(ids.teamB, {
        status: "live",
        target: 151,
        runs: 100,
        balls: 92,
        requiredRunRate: 6.0,
        currentBatsman1: ids.bat1,
        currentBatsman2: ids.bat2,
        onStrikeBatsman: ids.bat1,
        currentBowler: ids.bowl1,
        batting: [
          { player: ids.bat1, runs: 80, balls: 50, fours: 5, sixes: 2, isOut: false },
          { player: ids.bat2, runs: 20, balls: 40, fours: 1, sixes: 0, isOut: false },
        ],
        bowling: [
          { player: ids.bowl1, balls: 12, overs: 2, runs: 30, wickets: 1 },
        ],
        oversHistory: [
          { overNumber: 15, bowler: ids.bowl1, balls: legalBalls(2) },
        ],
      }),
    ],
  });

  const res = mockRes();
  await updateScore(mockReq({
    params: { matchId: String(match._id) },
    body: {
      inningsIndex: 1,
      runs: 1,
      bowlerId: ids.bowl1,
      batsmanOnStrikeId: ids.bat1,
      batsmanNonStrikeId: ids.bat2,
    },
  }), res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const live = res.body.match.innings[1];
  assert.equal(live.runs, 101);
  assert.equal(live.balls, 93);
  assert.equal(live.requiredRunRate, 11.11);
});

test("bowler quota is match override, then format, then ceil(overs / 5)", () => {
  assert.equal(getBowlerQuota({ matchType: "T20", totalOvers: 20 }), 4);
  assert.equal(getBowlerQuota({ matchType: "T20", totalOvers: 20, maxBowlerOvers: 3 }), 3);
  assert.equal(getBowlerQuota({ matchType: "Tape Ball", totalOvers: 8 }), 2);
  assert.equal(getBowlerQuota({ matchType: "Unknown", totalOvers: 20 }), 4);
});

test("setBowler rejects a bowler who has reached the 4-over T20 quota", async () => {
  const bowling = [{ player: ids.bowl1, balls: 24, overs: 4, runs: 30, wickets: 2 }];
  const match = await newMatch({
    inningsIndex: 0,
    innings: [
      inningsDoc(ids.teamA, {
        status: "live",
        balls: 24,
        currentBowler: ids.bowl2,
        bowling: [bowling[0], { player: ids.bowl2, balls: 0, overs: 0, runs: 0, wickets: 0 }],
        oversHistory: [{ overNumber: 3, bowler: ids.bowl2, balls: legalBalls(6) }],
      }),
      inningsDoc(ids.teamB),
    ],
  });

  const res = mockRes();
  await setBowler(mockReq({
    params: { matchId: String(match._id) },
    body: { inningsIndex: 0, bowlerId: String(ids.bowl1) },
  }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "BOWLER_QUOTA_REACHED");
  assert.match(res.body.message, /4-over quota/);
});

test("setBowler rejects the previous over's bowler at the start of a new over", async () => {
  const match = await newMatch({
    inningsIndex: 0,
    innings: [
      inningsDoc(ids.teamA, {
        status: "live",
        balls: 6,
        currentBowler: ids.bowl2,
        bowling: [
          { player: ids.bowl1, balls: 6, overs: 1, runs: 5, wickets: 0 },
          { player: ids.bowl2, balls: 0, overs: 0, runs: 0, wickets: 0 },
        ],
        oversHistory: [{ overNumber: 0, bowler: ids.bowl1, balls: legalBalls(6) }],
      }),
      inningsDoc(ids.teamB),
    ],
  });

  const res = mockRes();
  await setBowler(mockReq({
    params: { matchId: String(match._id) },
    body: { inningsIndex: 0, bowlerId: String(ids.bowl1) },
  }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "SAME_BOWLER_CONSECUTIVE");
});

test("setBowler blocks a mid-over change unless completeOverReplacement is set, then bars the old bowler", async () => {
  const match = await newMatch({
    inningsIndex: 0,
    innings: [
      inningsDoc(ids.teamA, {
        status: "live",
        balls: 2,
        currentBowler: ids.bowl1,
        bowling: [
          { player: ids.bowl1, balls: 2, overs: 0, runs: 3, wickets: 0 },
          { player: ids.bowl2, balls: 0, overs: 0, runs: 0, wickets: 0 },
        ],
        oversHistory: [{ overNumber: 0, bowler: ids.bowl1, balls: legalBalls(2) }],
      }),
      inningsDoc(ids.teamB),
    ],
  });

  const blocked = mockRes();
  await setBowler(mockReq({
    params: { matchId: String(match._id) },
    body: { inningsIndex: 0, bowlerId: String(ids.bowl2) },
  }), blocked);
  assert.equal(blocked.statusCode, 400);
  assert.equal(blocked.body.code, "MID_OVER_BOWLER_CHANGE");

  const accepted = mockRes();
  await setBowler(mockReq({
    params: { matchId: String(match._id) },
    body: {
      inningsIndex: 0,
      bowlerId: String(ids.bowl2),
      completeOverReplacement: true,
    },
  }), accepted);
  assert.equal(accepted.statusCode, 200, JSON.stringify(accepted.body));
  const acceptedBowler = accepted.body.match.innings[0].currentBowler;
  assert.equal(String(acceptedBowler?._id || acceptedBowler), String(ids.bowl2));
  assert.equal(String(accepted.body.match.innings[0].replacedBowlerBlock.player), String(ids.bowl1));

  const returned = mockRes();
  await setBowler(mockReq({
    params: { matchId: String(match._id) },
    body: {
      inningsIndex: 0,
      bowlerId: String(ids.bowl1),
      completeOverReplacement: true,
    },
  }), returned);
  assert.equal(returned.statusCode, 400);
  assert.equal(returned.body.code, "REPLACED_BOWLER_IN_OVER");
});

test("the adapter path also rejects a bowler over quota", () => {
  const doc = {
    matchType: "T20",
    totalOvers: 20,
    status: "live",
    currentInnings: 0,
    innings: [{
      ...inningsDoc(ids.teamA, {
        status: "live",
        currentBowler: ids.bowl1,
        currentBatsman1: ids.bat1,
        currentBatsman2: ids.bat2,
        onStrikeBatsman: ids.bat1,
        bowling: [{ player: ids.bowl1, balls: 24, overs: 4, runs: 30, wickets: 2 }],
      }),
    }],
    markModified() {},
    toObject() { return this; },
  };

  assert.throws(
    () => processDeliveryWithEngine(doc, {
      inningsIndex: 0,
      runs: 1,
      bowlerId: ids.bowl1,
      batsmanOnStrikeId: ids.bat1,
      batsmanNonStrikeId: ids.bat2,
    }),
    (error) => error.code === "BOWLER_QUOTA_REACHED"
  );
});
