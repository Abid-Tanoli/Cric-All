import test from "node:test";
import assert from "node:assert/strict";
import { ScoringEngine } from "../src/services/scoring/ScoringEngine.js";
import { processDeliveryWithEngine } from "../src/services/scoring/controllerAdapter.js";
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

test("the fall-of-wickets sub-document persists the dismissal type and fielder", () => {
  const inningsSchema = Match.schema.path("innings").schema;
  const fowSchema = inningsSchema.path("fallOfWickets").schema;
  assert.ok(fowSchema.path("wicketType"), "wicketType must be persisted");
  assert.ok(fowSchema.path("fielder"), "fielder must be persisted");
  assert.ok(fowSchema.path("wicket"), "the engine's wicket number must be persisted");
  assert.ok(fowSchema.path("wickets"), "the manual form's wicket number must be persisted");
});

test("a run-out charges the dismissal to the batsman the scorer named", () => {
  const engine = createEngine();
  const result = engine.processDelivery(delivery({
    isWicket: true,
    wicketType: "runOut",
    dismissedPlayer: "batter-2", // the non-striker is run out
    fielder: "fielder-1",
  }));

  assert.equal(result.innings.wickets, 1);
  assert.equal(result.innings.fallOfWickets[0].player, "batter-2");

  const nonStrikerCard = result.innings.batting.find((b) => String(b.player) === "batter-2");
  const strikerCard = result.innings.batting.find((b) => String(b.player) === "batter-1");
  assert.ok(nonStrikerCard, "the dismissed non-striker has a card");
  assert.equal(nonStrikerCard.isOut, true, "the non-striker is shown out");
  assert.equal(nonStrikerCard.dismissalType, "runOut");
  assert.ok(!strikerCard || strikerCard.isOut !== true, "the striker is not shown out");
});

// ─────────────────────────────────────────────────────────────────────────────
// Run-out ends: which batter is out, and where the replacement comes in.
// ─────────────────────────────────────────────────────────────────────────────

test("a run-out of the striker without crossing leaves the striker's end vacant", () => {
  const engine = createEngine();
  const result = engine.processDelivery(delivery({
    isWicket: true,
    wicketType: "runOut",
    dismissedPlayer: "batter-1",
  }));

  assert.equal(result.ball.dismissedPlayer, "batter-1");
  assert.equal(result.ball.nextBatsmanOnStrike, "batter-1");
  assert.equal(result.ball.nextBatsmanNonStrike, "batter-2");
});

test("a run-out of the striker after crossing swaps the surviving batters", () => {
  const engine = createEngine();
  const result = engine.processDelivery(delivery({
    isWicket: true,
    wicketType: "runOut",
    dismissedPlayer: "batter-1",
    didCross: true,
  }));

  assert.equal(result.ball.nextBatsmanOnStrike, "batter-2");
  assert.equal(result.ball.nextBatsmanNonStrike, "batter-1");
});

test("a run-out of the non-striker without crossing keeps the striker on strike", () => {
  const engine = createEngine();
  const result = engine.processDelivery(delivery({
    isWicket: true,
    wicketType: "runOut",
    dismissedPlayer: "batter-2",
  }));

  assert.equal(result.ball.nextBatsmanOnStrike, "batter-1");
  assert.equal(result.ball.nextBatsmanNonStrike, "batter-2");
});

test("a run-out of the non-striker after crossing puts the replacement on strike", () => {
  const engine = createEngine();
  const result = engine.processDelivery(delivery({
    isWicket: true,
    wicketType: "runOut",
    dismissedPlayer: "batter-2",
    didCross: true,
  }));

  assert.equal(result.ball.nextBatsmanOnStrike, "batter-2");
  assert.equal(result.ball.nextBatsmanNonStrike, "batter-1");
});

test("obstructing the field follows the same crossing rules as a run-out", () => {
  const engine = createEngine();
  const result = engine.processDelivery(delivery({
    isWicket: true,
    wicketType: "obstructingField",
    dismissedPlayer: "batter-2",
    didCross: true,
  }));

  assert.equal(result.ball.nextBatsmanOnStrike, "batter-2");
  assert.equal(result.ball.nextBatsmanNonStrike, "batter-1");
  assert.equal(result.innings.bowling[0].wickets, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Bowler credit
// ─────────────────────────────────────────────────────────────────────────────

test("only dismissals that belong to the bowler are credited to the bowler", () => {
  const bowlerDismissals = ["bowled", "caught", "lbw", "stumped", "hitWicket"];
  const nonBowlerDismissals = ["runOut", "retiredOut", "obstructingField", "hitTwice", "handledBall", "timedOut"];

  for (const wicketType of bowlerDismissals) {
    const engine = createEngine();
    const result = engine.processDelivery(delivery({
      isWicket: true,
      wicketType,
      dismissedPlayer: "batter-1",
      fielder: "fielder-1",
    }));
    assert.equal(result.innings.bowling[0].wickets, 1, `${wicketType} should credit the bowler`);
  }

  for (const wicketType of nonBowlerDismissals) {
    const engine = createEngine();
    const result = engine.processDelivery(delivery({
      isWicket: true,
      wicketType,
      dismissedPlayer: "batter-1",
      fielder: "fielder-1",
    }));
    assert.equal(result.innings.bowling[0].wickets, 0, `${wicketType} must not credit the bowler`);
  }
});

test("an absent dismissed player still defaults to the striker for old clients", () => {
  const engine = createEngine();
  const result = engine.processDelivery(delivery({
    isWicket: true,
    wicketType: "caught",
    fielder: "fielder-1",
  }));

  assert.equal(result.ball.dismissedPlayer, "batter-1");
  assert.equal(result.innings.fallOfWickets[0].player, "batter-1");
});

// ─────────────────────────────────────────────────────────────────────────────
// Free hit persistence
// ─────────────────────────────────────────────────────────────────────────────

test("a free hit survives a wide and a chain of no-balls until a legal ball", () => {
  const engine = createEngine();

  const noBall = engine.processDelivery(delivery({ isNoBall: true, runs: 1 }));
  assert.equal(noBall.freeHitNext, true);

  const wide = engine.processDelivery(delivery({ isWide: true, runs: 1 }));
  assert.equal(wide.freeHitNext, true, "a wide must not clear the free hit");
  assert.equal(wide.ball.isFreeHit, true);

  const secondNoBall = engine.processDelivery(delivery({ isNoBall: true, runs: 0 }));
  assert.equal(secondNoBall.freeHitNext, true, "another no-ball keeps the free hit alive");

  const legal = engine.processDelivery(delivery({ runs: 0 }));
  assert.equal(legal.freeHitNext, false, "a legal ball clears the free hit");
});

test("a free hit extended by a wide still only allows non-bowler dismissals", () => {
  const engine = createEngine();
  engine.processDelivery(delivery({ isNoBall: true, runs: 0 }));

  const stumpedOnWide = engine.processDelivery(delivery({
    isWide: true,
    isWicket: true,
    wicketType: "stumped",
    dismissedPlayer: "batter-1",
  }));
  assert.equal(stumpedOnWide.ball.isWicket, false);
  assert.equal(stumpedOnWide.freeHitNext, true);

  const runOutOnWide = engine.processDelivery(delivery({
    isWide: true,
    isWicket: true,
    wicketType: "runOut",
    dismissedPlayer: "batter-2",
  }));
  assert.equal(runOutOnWide.ball.isWicket, true);
  assert.equal(runOutOnWide.innings.wickets, 1);
  assert.equal(runOutOnWide.freeHitNext, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// New batter placement (adapter layer)
// ─────────────────────────────────────────────────────────────────────────────

function createMatchDoc() {
  return {
    matchType: "T20",
    status: "live",
    currentInnings: 0,
    innings: [{
      ...createInnings({ _id: "team-1", name: "Falcons" }),
      status: "live",
      onStrikeBatsman: "batter-1",
      currentBatsman1: "batter-1",
      currentBatsman2: "batter-2",
      currentBowler: "bowler-1",
    }],
    markModified() {},
    toObject() { return this; },
  };
}

function playLegalBalls(doc, count) {
  for (let i = 0; i < count; i += 1) {
    processDeliveryWithEngine(doc, {
      inningsIndex: 0,
      runs: 0,
      bowlerId: "bowler-1",
      batsmanOnStrikeId: "batter-1",
      batsmanNonStrikeId: "batter-2",
    });
  }
}

test("the incoming batter replaces the dismissed non-striker at the non-striker's end", () => {
  const doc = createMatchDoc();
  processDeliveryWithEngine(doc, {
    inningsIndex: 0,
    runs: 0,
    isWicket: true,
    wicketType: "runOut",
    dismissedPlayerId: "batter-2",
    didCross: false,
    nextBatsmanId: "batter-3",
    bowlerId: "bowler-1",
    batsmanOnStrikeId: "batter-1",
    batsmanNonStrikeId: "batter-2",
  });

  assert.equal(doc.innings[0].onStrikeBatsman, "batter-1");
  assert.equal(doc.innings[0].currentBatsman1, "batter-1");
  assert.equal(doc.innings[0].currentBatsman2, "batter-3");
});

test("a crossed run-out of the non-striker puts the incoming batter on strike", () => {
  const doc = createMatchDoc();
  processDeliveryWithEngine(doc, {
    inningsIndex: 0,
    runs: 0,
    isWicket: true,
    wicketType: "runOut",
    dismissedPlayerId: "batter-2",
    didCross: true,
    nextBatsmanId: "batter-3",
    bowlerId: "bowler-1",
    batsmanOnStrikeId: "batter-1",
    batsmanNonStrikeId: "batter-2",
  });

  assert.equal(doc.innings[0].onStrikeBatsman, "batter-3");
  assert.equal(doc.innings[0].currentBatsman1, "batter-3");
  assert.equal(doc.innings[0].currentBatsman2, "batter-1");
});

test("a wicket on the last ball of an over leaves the correct batter on strike next over", () => {
  const doc = createMatchDoc();
  playLegalBalls(doc, 5);

  processDeliveryWithEngine(doc, {
    inningsIndex: 0,
    runs: 0,
    isWicket: true,
    wicketType: "runOut",
    dismissedPlayerId: "batter-2",
    didCross: false,
    nextBatsmanId: "batter-3",
    bowlerId: "bowler-1",
    batsmanOnStrikeId: "batter-1",
    batsmanNonStrikeId: "batter-2",
  });

  assert.equal(doc.innings[0].onStrikeBatsman, "batter-3");
  assert.equal(doc.innings[0].currentBatsman2, "batter-1");
});

test("a striker dismissed on the last ball of an over leaves the non-striker on strike", () => {
  const doc = createMatchDoc();
  playLegalBalls(doc, 5);

  processDeliveryWithEngine(doc, {
    inningsIndex: 0,
    runs: 0,
    isWicket: true,
    wicketType: "caught",
    dismissedPlayerId: "batter-1",
    fielderId: "fielder-1",
    nextBatsmanId: "batter-3",
    bowlerId: "bowler-1",
    batsmanOnStrikeId: "batter-1",
    batsmanNonStrikeId: "batter-2",
  });

  assert.equal(doc.innings[0].onStrikeBatsman, "batter-2");
  assert.equal(doc.innings[0].currentBatsman2, "batter-3");
});
