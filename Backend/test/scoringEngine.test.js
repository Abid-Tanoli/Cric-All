import test from "node:test";
import assert from "node:assert/strict";
import { ScoringEngine } from "../src/services/scoring/ScoringEngine.js";
import Match from "../src/models/Match.js";

function createInnings(team) {
  return {
    team,
    runs: 0,
    wickets: 0,
    balls: 0,
    status: "upcoming",
    extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalty: 0, total: 0 },
    oversHistory: [],
    batting: [],
    bowling: [],
    fielding: [],
    partnerships: [],
    fallOfWickets: [],
  };
}

function createEngine() {
  const team1 = { _id: "team-1", name: "Falcons" };
  const team2 = { _id: "team-2", name: "Strikers" };
  return new ScoringEngine({
    matchType: "T20",
    status: "scheduled",
    currentInnings: 0,
    innings: [createInnings(team1), createInnings(team2)],
  });
}

function delivery(overrides = {}) {
  return {
    inningsIndex: 0,
    batsmanOnStrike: "batter-1",
    batsmanNonStrike: "batter-2",
    bowler: "bowler-1",
    runs: 0,
    ...overrides,
  };
}

test("records a legal single and rotates strike", () => {
  const engine = createEngine();
  const result = engine.processDelivery(delivery({ runs: 1 }));

  assert.equal(result.innings.runs, 1);
  assert.equal(result.innings.balls, 1);
  assert.equal(result.ball.batsmanRuns, 1);
  assert.equal(result.ball.nextBatsmanOnStrike, "batter-2");
  assert.equal(result.innings.batting[0].ballsFaced, 1);
});

test("counts wides as extras without consuming a legal ball", () => {
  const engine = createEngine();
  const result = engine.processDelivery(delivery({ isWide: true, runs: 2 }));

  assert.equal(result.innings.runs, 3);
  assert.equal(result.innings.balls, 0);
  assert.equal(result.innings.extras.wides, 3);
  assert.equal(result.ball.extraRuns, 3);
});

test("activates a free hit and rejects a bowled dismissal on the next ball", () => {
  const engine = createEngine();
  const noBall = engine.processDelivery(delivery({ isNoBall: true, runs: 4 }));

  assert.equal(noBall.innings.runs, 5);
  assert.equal(noBall.innings.balls, 0);
  assert.equal(noBall.freeHitNext, true);

  const freeHit = engine.processDelivery(delivery({
    isWicket: true,
    wicketType: "bowled",
    dismissedPlayer: "batter-1",
  }));

  assert.equal(freeHit.ball.isFreeHit, true);
  assert.equal(freeHit.ball.isWicket, false);
  assert.equal(freeHit.innings.wickets, 0);
  assert.equal(freeHit.freeHitNext, false);
});

test("records caught dismissal and fielder statistics", () => {
  const engine = createEngine();
  const result = engine.processDelivery(delivery({
    isWicket: true,
    wicketType: "caught",
    dismissedPlayer: "batter-1",
    fielder: "fielder-1",
  }));

  assert.equal(result.innings.wickets, 1);
  assert.equal(result.innings.bowling[0].wickets, 1);
  assert.equal(result.innings.fielding[0].catches, 1);
  assert.equal(result.innings.fallOfWickets[0].fielder, "fielder-1");
});

test("run-outs are not charged as bowler wickets", () => {
  const engine = createEngine();
  const result = engine.processDelivery(delivery({
    isWicket: true,
    wicketType: "runOut",
    dismissedPlayer: "batter-1",
    fielder: "fielder-1",
  }));

  assert.equal(result.innings.wickets, 1);
  assert.equal(result.innings.bowling[0].wickets, 0);
  assert.equal(result.innings.fielding[0].runOuts, 1);
});

test("Test format matches the Match model enum spelling", () => {
  const engine = new ScoringEngine({
    matchType: "Test",
    status: "scheduled",
    currentInnings: 0,
    innings: [createInnings({ _id: "team-1" }), createInnings({ _id: "team-2" })],
  });

  assert.equal(engine.format.maxOvers, null);
  assert.equal(engine.format.maxWickets, 10);
});

test("completed innings and pending tie resolution reject deliveries without mutation", () => {
  const completed = createEngine();
  completed.match.innings[0].status = "completed";
  assert.throws(() => completed.processDelivery(delivery({ runs: 4 })), /completed innings/);
  assert.equal(completed.match.innings[0].runs, 0);
  assert.equal(completed.match.innings[0].oversHistory.length, 0);

  const tied = createEngine();
  tied.match.status = "pending_tie_resolution";
  assert.throws(() => tied.processDelivery(delivery({ runs: 4 })), /pending_tie_resolution/);
  assert.equal(tied.match.innings[0].runs, 0);
  assert.equal(tied.match.innings[0].oversHistory.length, 0);
});

test("innings schema persists the free-hit flag", () => {
  const inningsSchema = Match.schema.path("innings").schema;
  assert.ok(inningsSchema.path("isFreeHit"));
  const match = new Match({ title: "OPENCODE_TEST_free_hit_schema", teams: [] });
  match.innings.push({ isFreeHit: true });
  assert.equal(match.innings[0].isFreeHit, true);
});

test("reverts the latest delivery totals and player statistics", () => {
  const engine = createEngine();
  engine.processDelivery(delivery({ runs: 4 }));
  const reverted = engine.processDelivery({ inningsIndex: 0, revertBall: true });

  assert.equal(reverted.innings.runs, 0);
  assert.equal(reverted.innings.balls, 0);
  assert.equal(reverted.innings.batting[0].runs, 0);
  assert.equal(reverted.innings.batting[0].ballsFaced, 0);
  assert.equal(reverted.innings.bowling[0].runs, 0);
  assert.equal(reverted.innings.oversHistory.length, 0);
});
