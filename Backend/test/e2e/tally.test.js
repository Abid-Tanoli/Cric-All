import test from "node:test";
import assert from "node:assert/strict";
import { createTally } from "./lib/tally.js";

for (const [label, extra] of [["bye", { isBye: true }], ["leg-bye", { isLegBye: true }]]) {
  test(`an odd ${label} run changes ends but is not credited to the batter`, () => {
    const tally = createTally();
    tally.setBatters("striker", "non-striker");

    tally.feed({
      runs: 1,
      ...extra,
      batsmanOnStrikeId: "striker",
      batsmanNonStrikeId: "non-striker",
      bowlerId: "bowler",
    });

    assert.equal(tally.state.onStrike, "non-striker");
    assert.equal(tally.snapshot().batting.find((row) => row.playerId === "striker").runs, 0);
    assert.equal(tally.snapshot().runs, 1);
  });
}
