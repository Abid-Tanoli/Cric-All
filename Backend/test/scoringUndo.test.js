import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import Match from "../src/models/Match.js";
import Player from "../src/models/Player.js";
import Team from "../src/models/Team.js";
import Ball from "../src/models/Ball.js";
import Delivery from "../src/models/Delivery.js";
import Partnership from "../src/models/Partnership.js";
import MatchAnalytics from "../src/models/MatchAnalytics.js";
import { updateScore, revertLastBall } from "../src/controllers/scoreController.js";
import { __setAiCommentaryEnabledForTests } from "../src/services/aiCommentary.js";

// These tests drive the real HTTP-less controller pair (updateScore then
// revertLastBall) against an in-memory MongoDB. The core idea is a round trip:
// score a delivery, snapshot the persisted match, undo it, score the *same*
// delivery again, and require the two snapshots to be byte-for-byte equal. If
// the undo left a counter high (the old `ball.runs` bug), double-counted a
// batter, forgot a maiden or failed to reopen an innings, the re-score diverges
// and the comparison fails.

let mongod;
const ids = {};

before(async () => {
  mongod = await startTestDb();
  // Keep the suite offline and deterministic: no AI commentary, no network.
  __setAiCommentaryEnabledForTests(false);

  const [teamA, teamB] = await Team.create([{ name: "Undo A" }, { name: "Undo B" }]);
  ids.teamA = teamA._id;
  ids.teamB = teamB._id;

  const names = ["bat1", "bat2", "bat3", "bat4", "bowl1", "bowl2", "field1"];
  const players = await Player.create(names.map((name) => ({ name })));
  names.forEach((name, i) => {
    ids[name] = players[i]._id;
  });
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

async function newMatch({ inningsIndex = 0, target = 0, firstInningsRuns = 0, wickets = 0 } = {}) {
  const innings = [
    inningsDoc(ids.teamA, inningsIndex === 0
      ? { status: "live", wickets }
      : { status: "completed", runs: firstInningsRuns, balls: firstInningsRuns ? 120 : 0 }),
    inningsDoc(ids.teamB, inningsIndex === 1 ? { status: "live", target } : { status: "upcoming" }),
  ];
  const live = innings[inningsIndex];
  live.currentBatsman1 = ids.bat1;
  live.currentBatsman2 = ids.bat2;
  live.onStrikeBatsman = ids.bat1;
  live.currentBowler = ids.bowl1;
  // A real chase starts with the required rate already set by the
  // start-next-innings endpoint; the engine preserves it rather than deriving
  // it per ball, so seed it or the undo (which does recompute it) would look
  // like it changed the value.
  if (target > 0) live.requiredRunRate = Number((target / 20).toFixed(2));

  return Match.create({
    title: `undo-${Date.now()}-${Math.random()}`,
    matchType: "T20",
    teams: [ids.teamA, ids.teamB],
    totalOvers: 20,
    status: "live",
    currentInnings: inningsIndex,
    innings,
  });
}

async function score(matchId, inningsIndex, body) {
  const req = mockReq({
    params: { matchId: String(matchId) },
    body: { inningsIndex, bowlerId: ids.bowl1, ...body },
  });
  const res = mockRes();
  await updateScore(req, res);
  assert.equal(res.statusCode, 200, `score should succeed: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function undo(matchId, inningsIndex) {
  const req = mockReq({ params: { matchId: String(matchId) }, body: { inningsIndex } });
  const res = mockRes();
  await revertLastBall(req, res);
  assert.equal(res.statusCode, 200, `undo should succeed: ${JSON.stringify(res.body)}`);
  return res.body;
}

// Fields that legitimately change between two writes and must not take part in
// the equality check: document ids, Mongoose bookkeeping, wall-clock stamps and
// the over `summary`. The summary is a presentation string that updateScore
// persists through a fire-and-forget `findByIdAndUpdate`, so whether it has
// landed by the time we read back is a race and not scoring state.
const VOLATILE_KEYS = new Set(["_id", "__v", "createdAt", "updatedAt", "timestamp", "summary"]);

function normalize(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(normalize);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (VOLATILE_KEYS.has(key)) continue;
      out[key] = normalize(value[key]);
    }
    return out;
  }
  return value;
}

async function snapshot(matchId) {
  const doc = await Match.findById(matchId).lean();
  return normalize({
    status: doc.status,
    currentInnings: doc.currentInnings,
    result: doc.result,
    winProbabilityHistory: doc.winProbabilityHistory,
    innings: doc.innings,
  });
}

// ─── Round-trip table ────────────────────────────────────────────────────
// Each entry scores one delivery (optionally after a setup run of deliveries),
// checks the applied state, undoes it, checks the rollback, re-scores it and
// requires the match to land in exactly the same state.

const idOf = (player) => String(player?._id || player || "");

const cases = [
  {
    name: "dot ball",
    ball: { runs: 0 },
    check: (i) => {
      assert.equal(i.runs, 0);
      assert.equal(i.balls, 1);
      assert.equal(i.batting[0].dotBalls, 1);
      assert.equal(i.bowling[0].dotBalls, 1);
    },
  },
  {
    name: "single",
    ball: { runs: 1 },
    check: (i) => {
      assert.equal(i.runs, 1);
      assert.equal(i.batting[0].runs, 1);
      assert.equal(i.batting[0].balls, 1);
    },
  },
  {
    name: "boundary four",
    ball: { runs: 4 },
    check: (i) => {
      assert.equal(i.runs, 4);
      assert.equal(i.batting[0].runs, 4);
      assert.equal(i.batting[0].fours, 1);
    },
  },
  {
    name: "wide",
    ball: { isWide: true, runs: 0 },
    check: (i) => {
      assert.equal(i.runs, 1);
      assert.equal(i.balls, 0);
      assert.equal(i.extras.wides, 1);
    },
    checkUndo: (i) => {
      assert.equal(i.runs, 0);
      assert.equal(i.extras.wides, 0);
    },
  },
  {
    name: "wide plus two runs",
    ball: { isWide: true, runs: 2 },
    check: (i) => {
      assert.equal(i.runs, 3);
      assert.equal(i.balls, 0);
      assert.equal(i.extras.wides, 3);
    },
    checkUndo: (i) => {
      assert.equal(i.runs, 0);
      assert.equal(i.extras.wides, 0);
    },
  },
  {
    name: "no ball",
    ball: { isNoBall: true, runs: 0 },
    check: (i) => {
      assert.equal(i.runs, 1);
      assert.equal(i.balls, 0);
      assert.equal(i.extras.noBalls, 1);
    },
  },
  {
    name: "no ball plus bat runs",
    ball: { isNoBall: true, runs: 4 },
    check: (i) => {
      assert.equal(i.runs, 5);
      assert.equal(i.extras.noBalls, 1);
      assert.equal(i.batting[0].runs, 4);
      assert.equal(i.batting[0].fours, 1);
    },
  },
  {
    name: "bye",
    ball: { isBye: true, runs: 2 },
    check: (i) => {
      assert.equal(i.runs, 2);
      assert.equal(i.balls, 1);
      assert.equal(i.extras.byes, 2);
      // Byes are not charged to the bowler.
      assert.equal(i.bowling[0].runs, 0);
    },
  },
  {
    name: "leg bye",
    ball: { isLegBye: true, runs: 1 },
    check: (i) => {
      assert.equal(i.runs, 1);
      assert.equal(i.balls, 1);
      assert.equal(i.extras.legByes, 1);
      assert.equal(i.bowling[0].runs, 0);
    },
  },
  {
    name: "bowled wicket",
    ball: { isWicket: true, wicketType: "bowled", dismissedPlayerId: ids.bat1, nextBatsmanId: ids.bat3 },
    check: (i) => {
      assert.equal(i.wickets, 1);
      assert.equal(i.bowling[0].wickets, 1);
      assert.equal(i.fallOfWickets.length, 1);
      const dismissed = i.batting.find((b) => String(b.player?._id || b.player) === String(ids.bat1));
      assert.ok(dismissed, "the dismissed batter must have a card");
      assert.equal(dismissed.isOut, true);
    },
    checkUndo: (i) => {
      assert.equal(i.wickets, 0);
      assert.equal(i.fallOfWickets.length, 0);
      const dismissed = i.batting.find((b) => String(b.player?._id || b.player) === String(ids.bat1));
      assert.ok(!dismissed || dismissed.isOut !== true);
    },
  },
  {
    name: "last ball of the over",
    setup: [{ runs: 0 }, { runs: 0 }, { runs: 0 }, { runs: 0 }, { runs: 0 }],
    ball: { runs: 1 },
    check: (i) => {
      assert.equal(i.balls, 6);
      assert.equal(i.oversHistory.length, 1);
      assert.equal(i.oversHistory[0].balls.length, 6);
      assert.equal(i.oversHistory[0].maidenOver, false);
    },
  },
  {
    name: "maiden over completion",
    setup: [{ runs: 0 }, { runs: 0 }, { runs: 0 }, { runs: 0 }, { runs: 0 }],
    ball: { runs: 0 },
    check: (i) => {
      assert.equal(i.balls, 6);
      assert.equal(i.oversHistory[0].maidenOver, true);
      assert.equal(i.bowling[0].maidens, 1);
    },
    checkUndo: (i) => {
      assert.equal(i.balls, 5);
      assert.equal(i.oversHistory[0].maidenOver, false);
      assert.equal(i.bowling[0].maidens, 0);
    },
  },
  {
    name: "innings-ending tenth wicket",
    matchOptions: { wickets: 9 },
    ball: { isWicket: true, wicketType: "bowled", dismissedPlayerId: ids.bat1, nextBatsmanId: ids.bat3 },
    check: (i) => assert.equal(i.wickets, 10),
    checkUndo: (i, match) => {
      assert.equal(i.wickets, 9);
      assert.equal(i.status, "live");
      assert.equal(match.status, "live");
      assert.equal(match.currentInnings, 0);
      assert.equal(i.target, 0);
    },
  },
  {
    name: "winning run in the chase",
    matchOptions: { inningsIndex: 1, target: 1, firstInningsRuns: 0 },
    ball: { runs: 1 },
    check: (i) => assert.equal(i.runs, 1),
    checkUndo: (i, match) => {
      assert.equal(match.status, "live");
      assert.ok(!match.result || !match.result.winner, "result/winner must be cleared on undo");
      assert.ok(!match.result || !match.result.margin, "margin must be cleared on undo");
    },
  },
  {
    name: "run-out of the non-striker without crossing",
    ball: () => ({
      runs: 0,
      isWicket: true,
      wicketType: "runOut",
      dismissedPlayerId: ids.bat2,
      nextBatsmanId: ids.bat3,
    }),
    check: (i) => {
      assert.equal(i.wickets, 1);
      assert.equal(i.bowling[0].wickets, 0, "a run-out must not credit the bowler");
      const dismissed = i.batting.find((b) => idOf(b.player) === String(ids.bat2));
      assert.equal(dismissed.isOut, true);
      assert.equal(idOf(i.onStrikeBatsman), String(ids.bat1));
      assert.equal(idOf(i.currentBatsman2), String(ids.bat3));
    },
    checkUndo: (i) => {
      assert.equal(i.wickets, 0);
      assert.equal(i.bowling[0].wickets, 0, "undo must not push the bowler's wickets below zero");
      const dismissed = i.batting.find((b) => idOf(b.player) === String(ids.bat2));
      assert.equal(dismissed.isOut, false, "the dismissed non-striker must come back");
      assert.equal(idOf(i.onStrikeBatsman), String(ids.bat1), "the original striker keeps strike");
      assert.equal(idOf(i.currentBatsman1), String(ids.bat1));
      assert.equal(idOf(i.currentBatsman2), String(ids.bat2), "the non-striker is restored at the other end");
    },
  },
  {
    name: "run-out of the non-striker after crossing",
    ball: () => ({
      runs: 0,
      isWicket: true,
      wicketType: "runOut",
      dismissedPlayerId: ids.bat2,
      didCross: true,
      nextBatsmanId: ids.bat3,
    }),
    check: (i) => {
      assert.equal(i.wickets, 1);
      assert.equal(i.bowling[0].wickets, 0);
      assert.equal(idOf(i.onStrikeBatsman), String(ids.bat3), "the replacement is on strike");
      assert.equal(idOf(i.currentBatsman2), String(ids.bat1));
    },
    checkUndo: (i) => {
      assert.equal(i.wickets, 0);
      assert.equal(i.bowling[0].wickets, 0);
      assert.equal(idOf(i.onStrikeBatsman), String(ids.bat1));
      assert.equal(idOf(i.currentBatsman1), String(ids.bat1));
      assert.equal(idOf(i.currentBatsman2), String(ids.bat2));
    },
  },
  {
    name: "run-out of the striker after crossing",
    ball: () => ({
      runs: 0,
      isWicket: true,
      wicketType: "runOut",
      dismissedPlayerId: ids.bat1,
      didCross: true,
      nextBatsmanId: ids.bat3,
    }),
    check: (i) => {
      assert.equal(i.wickets, 1);
      assert.equal(i.bowling[0].wickets, 0);
      assert.equal(idOf(i.onStrikeBatsman), String(ids.bat2));
      assert.equal(idOf(i.currentBatsman2), String(ids.bat3));
    },
    checkUndo: (i) => {
      assert.equal(i.wickets, 0);
      assert.equal(i.bowling[0].wickets, 0);
      assert.equal(idOf(i.onStrikeBatsman), String(ids.bat1), "the dismissed striker is back on strike");
      assert.equal(idOf(i.currentBatsman1), String(ids.bat1));
      assert.equal(idOf(i.currentBatsman2), String(ids.bat2));
    },
  },
  {
    name: "runs completed before a run-out",
    ball: () => ({
      runs: 2,
      isWicket: true,
      wicketType: "runOut",
      dismissedPlayerId: ids.bat2,
      nextBatsmanId: ids.bat3,
    }),
    check: (i) => {
      assert.equal(i.runs, 2);
      assert.equal(i.wickets, 1);
      assert.equal(i.bowling[0].wickets, 0);
      const striker = i.batting.find((b) => idOf(b.player) === String(ids.bat1));
      assert.equal(striker.runs, 2);
    },
    checkUndo: (i) => {
      assert.equal(i.runs, 0);
      assert.equal(i.wickets, 0);
      assert.equal(i.balls, 0);
      assert.equal(i.bowling[0].wickets, 0);
      const striker = i.batting.find((b) => idOf(b.player) === String(ids.bat1));
      assert.equal(striker.runs, 0);
      assert.equal(striker.balls, 0);
      assert.equal(idOf(i.currentBatsman2), String(ids.bat2));
    },
  },
  {
    name: "undoing a non-bowler dismissal does not decrement the bowler's wickets",
    setup: () => [{
      runs: 0,
      isWicket: true,
      wicketType: "bowled",
      dismissedPlayerId: ids.bat1,
      nextBatsmanId: ids.bat3,
    }],
    ball: () => ({
      runs: 0,
      isWicket: true,
      wicketType: "runOut",
      dismissedPlayerId: ids.bat2,
      nextBatsmanId: ids.bat4,
    }),
    check: (i) => {
      assert.equal(i.wickets, 2);
      assert.equal(i.bowling[0].wickets, 1);
    },
    checkUndo: (i) => {
      assert.equal(i.wickets, 1);
      assert.equal(i.bowling[0].wickets, 1, "the earlier bowler wicket must survive the undo");
      assert.equal(idOf(i.onStrikeBatsman), String(ids.bat3));
      assert.equal(idOf(i.currentBatsman2), String(ids.bat2));
    },
  },
  {
    name: "wide during a free hit restores the free hit on undo",
    setup: () => [{ isNoBall: true, runs: 0 }],
    ball: () => ({ isWide: true, runs: 0 }),
    check: (i) => {
      assert.equal(i.isFreeHit, true);
      assert.equal(i.runs, 2);
      assert.equal(i.extras.noBalls, 1);
      assert.equal(i.extras.wides, 1);
    },
    checkUndo: (i) => {
      assert.equal(i.isFreeHit, true, "undoing the wide must leave the free hit live");
      assert.equal(i.runs, 1);
      assert.equal(i.extras.wides, 0);
    },
  },
  {
    name: "no-ball during a free hit restores the free hit on undo",
    setup: () => [{ isNoBall: true, runs: 0 }],
    ball: () => ({ isNoBall: true, runs: 0 }),
    check: (i) => {
      assert.equal(i.isFreeHit, true);
      assert.equal(i.runs, 2);
      assert.equal(i.extras.noBalls, 2);
    },
    checkUndo: (i) => {
      assert.equal(i.isFreeHit, true, "undoing the second no-ball must leave the first free hit live");
      assert.equal(i.runs, 1);
      assert.equal(i.extras.noBalls, 1);
    },
  },
];

for (const c of cases) {
  test(`undo round-trip: ${c.name}`, async () => {
    const match = await newMatch(c.matchOptions || {});
    const inningsIndex = (c.matchOptions && c.matchOptions.inningsIndex) || 0;

    const setup = typeof c.setup === "function" ? c.setup() : (c.setup || []);
    for (const setupBall of setup) {
      await score(match._id, inningsIndex, setupBall);
    }

    const ball = typeof c.ball === "function" ? c.ball() : c.ball;
    const scored = await score(match._id, inningsIndex, ball);
    if (c.check) c.check(scored.innings);

    const afterScore = await snapshot(match._id);

    const undone = await undo(match._id, inningsIndex);
    if (c.checkUndo) c.checkUndo(undone.match.innings[inningsIndex], undone.match);

    await score(match._id, inningsIndex, ball);
    const afterRescore = await snapshot(match._id);

    assert.deepEqual(
      afterRescore,
      afterScore,
      `${c.name}: re-scoring the same delivery after undo must reproduce the same match state`,
    );
  });
}

// ─── Per-ball document cleanup ───────────────────────────────────────────

test("undo removes the per-ball documents so a re-score does not duplicate them", async () => {
  const match = await newMatch({});

  await score(match._id, 0, { runs: 4 });
  assert.equal(await Ball.countDocuments({ matchId: match._id }), 1);
  assert.equal(await Delivery.countDocuments({ matchId: match._id }), 1);
  assert.equal(await Partnership.countDocuments({ matchId: match._id }), 1);

  await undo(match._id, 0);
  assert.equal(await Ball.countDocuments({ matchId: match._id }), 0, "Ball document must be removed");
  assert.equal(await Delivery.countDocuments({ matchId: match._id }), 0, "Delivery document must be removed");
  assert.equal(await Partnership.countDocuments({ matchId: match._id }), 0, "empty partnership must be removed");

  await score(match._id, 0, { runs: 4 });
  assert.equal(await Ball.countDocuments({ matchId: match._id }), 1);
  assert.equal(await Delivery.countDocuments({ matchId: match._id }), 1);
  assert.equal(await Partnership.countDocuments({ matchId: match._id }), 1);
});

test("undo rolls the analytics boundaries back with the ball", async () => {
  const match = await newMatch({});

  await score(match._id, 0, { runs: 6 });
  let analytics = await MatchAnalytics.findOne({ matchId: match._id });
  assert.equal(analytics.totalSixesInning1, 1);
  assert.equal(analytics.totalBoundariesInning1, 1);
  assert.equal(analytics.boundaryRunsInning1, 6);

  await undo(match._id, 0);
  analytics = await MatchAnalytics.findOne({ matchId: match._id });
  assert.equal(analytics.totalSixesInning1, 0);
  assert.equal(analytics.totalBoundariesInning1, 0);
  assert.equal(analytics.boundaryRunsInning1, 0);
});

// ─── Concurrency guard ───────────────────────────────────────────────────

test("a concurrent score and undo for the same match returns 409 for the loser", async () => {
  const match = await newMatch({});

  const body = { inningsIndex: 0, runs: 1, bowlerId: ids.bowl1 };
  const req1 = mockReq({ params: { matchId: String(match._id) }, body });
  const req2 = mockReq({ params: { matchId: String(match._id) }, body });
  const res1 = mockRes();
  const res2 = mockRes();

  // Both handlers start before either awaits, so the first one holds the lock
  // while the second sees it and bails out with 409.
  await Promise.all([updateScore(req1, res1), updateScore(req2, res2)]);

  const codes = [res1.statusCode, res2.statusCode].sort();
  assert.deepEqual(codes, [200, 409]);
  const loser = res1.statusCode === 409 ? res1 : res2;
  assert.equal(loser.body.code, "SCORING_IN_PROGRESS");
});

test("the lock is released even when the request fails", async () => {
  const missingId = new mongoose.Types.ObjectId();
  const res = mockRes();
  await updateScore(mockReq({ params: { matchId: String(missingId) }, body: { inningsIndex: 0, runs: 1 } }), res);
  assert.equal(res.statusCode, 404);

  // A second request for the same id must not be blocked by a wedged lock.
  const retry = mockRes();
  await updateScore(mockReq({ params: { matchId: String(missingId) }, body: { inningsIndex: 0, runs: 1 } }), retry);
  assert.equal(retry.statusCode, 404);
});
