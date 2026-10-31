import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { validateManualScorecard } from "../src/services/manualScorecard.js";
import { planFowOvers, inningsTotalBalls, overFigureFromBalls } from "../src/scripts/fixFowOvers.js";

// Fall-of-wicket `overs` is stored as ONE printed over figure ("2.1" = two overs
// and one ball), the same unit the live scoring engine writes. The manual
// validator used to store a ball count (13), which the public scorecard then
// printed as "13.0 ov" instead of "2.1 ov".

const draft = (fallOfWickets, overrides = {}) => {
  const teamA = new mongoose.Types.ObjectId();
  const teamB = new mongoose.Types.ObjectId();
  return {
    teamA: String(teamA),
    teamB: String(teamB),
    totalOvers: 20,
    innings: [
      {
        team: String(teamA),
        overs: "15.0",
        batting: [{ player: String(new mongoose.Types.ObjectId()), runs: 10, balls: 5, isOut: true, dismissalType: "bowled" }],
        fallOfWickets,
        ...overrides,
      },
      { team: String(teamB), batting: [] },
    ],
  };
};

const validate = (payload) =>
  validateManualScorecard(payload, {
    teamIds: [payload.teamA, payload.teamB],
    totalOvers: payload.totalOvers,
    requireComplete: false,
  });

test("manual validator: stores fall-of-wicket overs as a printed over figure", () => {
  for (const [input, expected] of [["7.2", 7.2], ["2.1", 2.1], ["19.5", 19.5], ["12", 12], ["", 0]]) {
    const res = validate(draft([{ runs: 10, wickets: 1, overs: input }]));
    assert.equal(res.ok, true, `${JSON.stringify(input)}: ${JSON.stringify(res.errors)}`);
    assert.equal(res.data.innings[0].fallOfWickets[0].overs, expected, `overs "${input}"`);
  }
});

test("manual validator: rejects a malformed fall-of-wicket over", () => {
  const res = validate(draft([{ runs: 10, wickets: 1, overs: "19.6" }]));
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((error) => error.path === "innings[0].fallOfWickets[0].overs"));
});

test("backfill: converts proven ball counts to over figures", () => {
  const match = {
    source: "manual",
    innings: [{ balls: 90, fallOfWickets: [{ overs: 13 }, { overs: 30 }, { overs: 38 }, { overs: 51 }] }],
  };
  const plan = planFowOvers(match);
  assert.deepEqual(plan.changes.map((change) => change.to), [2.1, 5, 6.2, 8.3]);
  assert.equal(plan.ambiguous.length, 0);
});

test("backfill: leaves a lone integer that fits both units alone", () => {
  const plan = planFowOvers({ source: "manual", innings: [{ balls: 90, fallOfWickets: [{ overs: 13 }] }] });
  assert.equal(plan.changes.length, 0);
  assert.equal(plan.ambiguous.length, 1);
});

test("backfill: never touches a live-scored match", () => {
  const plan = planFowOvers({ source: "live", innings: [{ balls: 90, fallOfWickets: [{ overs: 30 }] }] });
  assert.equal(plan.changes.length, 0);
  assert.equal(plan.ambiguous.length, 0);
});

test("backfill: an already converted innings is idempotent", () => {
  const match = { source: "manual", innings: [{ balls: 90, fallOfWickets: [{ overs: 2.1 }, { overs: 5 }, { overs: 6.2 }, { overs: 8.3 }] }] };
  const second = planFowOvers(match);
  assert.equal(second.changes.length, 0);
});

test("backfill: helpers round-trip the over figure", () => {
  assert.equal(inningsTotalBalls({ balls: 90 }), 90);
  assert.equal(inningsTotalBalls({ overs: 15.3 }), 93);
  assert.equal(overFigureFromBalls(13), 2.1);
  assert.equal(overFigureFromBalls(30), 5);
  assert.equal(overFigureFromBalls(51), 8.3);
});
