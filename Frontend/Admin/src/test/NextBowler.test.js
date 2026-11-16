import { describe, expect, it } from "vitest";
import {
  buildBowlerOptions,
  isNextBowlerRequired,
} from "../utils/nextBowler";

const bowlers = [
  { _id: "a", name: "A Bowler" },
  { _id: "b", name: "B Bowler" },
  { _id: "c", name: "C Bowler" },
  { _id: "d", name: "D Bowler" },
];

const bowlingStats = [
  { player: "a", balls: 24, runs: 18, wickets: 2, maidens: 1 },
  { player: "b", balls: 6, runs: 9, wickets: 0, maidens: 0 },
  { player: "c", balls: 0, runs: 0, wickets: 0, maidens: 0 },
];

describe("buildBowlerOptions", () => {
  it("puts eligible bowlers first and the last-over bowler last with a reason", () => {
    const { eligible, ineligible } = buildBowlerOptions({
      bowlers,
      bowlingStats,
      lastOverBowlerId: "b",
      quota: 4,
    });

    expect(eligible.map((option) => option._id)).toEqual(["c", "d"]);
    expect(ineligible.map((option) => option._id)).toEqual(["a", "b"]);
    expect(ineligible.find((option) => option._id === "a").reasons).toContain(
      "Quota of 4 overs completed"
    );
    expect(ineligible.find((option) => option._id === "b").reasons).toContain(
      "Bowled last over"
    );
    expect(eligible[0]).toMatchObject({ overs: "0.0", runs: 0, wickets: 0 });
    expect(eligible[0].oversRemaining).toBe(4);
  });
});

describe("isNextBowlerRequired", () => {
  const oversHistory = [
    { balls: [{ runs: 1 }, { runs: 0 }, { runs: 4 }, { runs: 0 }, { runs: 1 }, { runs: 2 }] },
  ];

  it("requires a bowler after an over when the same bowler is still selected", () => {
    expect(
      isNextBowlerRequired({
        balls: 6,
        currentBowler: "b",
        oversHistory: [{ ...oversHistory[0], bowler: "b" }],
      })
    ).toBe(true);
  });

  it("does not require a bowler once a different bowler is selected", () => {
    expect(
      isNextBowlerRequired({
        balls: 6,
        currentBowler: "c",
        oversHistory: [{ ...oversHistory[0], bowler: "b" }],
      })
    ).toBe(false);
  });
});
