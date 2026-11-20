import { describe, expect, it } from "vitest";
import {
  buildBowlerGroups,
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

const legalOver = (overNumber, bowler) => ({
  overNumber,
  bowler,
  balls: [
    { ballNumber: 1, runs: 1 },
    { ballNumber: 2, runs: 0 },
    { ballNumber: 3, runs: 0 },
    { ballNumber: 4, runs: 0 },
    { ballNumber: 5, runs: 0 },
    { ballNumber: 6, runs: 0 },
  ],
});

describe("buildBowlerGroups", () => {
  const innings = {
    balls: 18,
    oversHistory: [legalOver(0, "a"), legalOver(1, "b"), legalOver(2, "a")],
  };

  it("splits already bowled from yet to bowl and lists their over numbers", () => {
    const { bowled, yetToBowl } = buildBowlerGroups({
      bowlers,
      bowlingStats,
      lastOverBowlerId: "b",
      quota: 4,
      innings,
    });

    expect(bowled.map((option) => option._id)).toEqual(["a", "b"]);
    expect(bowled[0].overNumbers).toEqual([1, 3]);
    expect(bowled[1].overNumbers).toEqual([2]);
    expect(yetToBowl.map((option) => option._id)).toEqual(["c", "d"]);
    expect(yetToBowl.every((option) => option.reasons.length === 0)).toBe(true);
  });

  it("orders already bowled by the first over they bowled", () => {
    const reordered = buildBowlerGroups({
      bowlers: [bowlers[2], bowlers[1], bowlers[0], bowlers[3]],
      bowlingStats,
      lastOverBowlerId: "a",
      quota: 4,
      innings,
    });

    expect(reordered.bowled.map((option) => option._id)).toEqual(["a", "b"]);
  });

  it("keeps the previous over's bowler blocked with the existing reason text", () => {
    const { bowled } = buildBowlerGroups({
      bowlers,
      bowlingStats,
      lastOverBowlerId: "a",
      quota: 4,
      innings,
    });

    const previous = bowled.find((option) => option._id === "a");
    expect(previous.reasons).toContain("Bowled last over");
  });

  it("marks a bowler whose quota is finished as ineligible", () => {
    const { bowled } = buildBowlerGroups({
      bowlers,
      bowlingStats,
      lastOverBowlerId: "b",
      quota: 4,
      innings,
    });

    const finished = bowled.find((option) => option._id === "a");
    expect(finished.oversRemaining).toBe(0);
    expect(finished.reasons).toContain("Quota of 4 overs completed");
  });

  it("still offers a newly added player who has not bowled", () => {
    const fresh = { _id: "e", name: "E Bowler" };
    const { yetToBowl } = buildBowlerGroups({
      bowlers: [...bowlers, fresh],
      bowlingStats,
      lastOverBowlerId: "a",
      quota: 4,
      innings,
    });

    expect(yetToBowl.map((option) => option._id)).toEqual(["c", "d", "e"]);
    expect(yetToBowl.every((option) => option.reasons.length === 0)).toBe(true);
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
