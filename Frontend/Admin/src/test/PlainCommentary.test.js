import { describe, expect, it } from "vitest";
import {
  ballChipText,
  ballChipTone,
  ballDeliveryRuns,
  ballResultPhrase,
  ballSentence,
  buildPlainOverFeed,
  overByOverList,
} from "@shared/scoring/utils/plainCommentary";

const ball = (overrides = {}) => ({
  runs: 0,
  batsmanRuns: 0,
  extraRuns: 0,
  isWide: false,
  isNoBall: false,
  isBye: false,
  isLegBye: false,
  isWicket: false,
  bowlerName: "Bowler",
  batsmanName: "Batter",
  ...overrides,
});

describe("ballChipText", () => {
  it("covers dot, singles, twos and threes", () => {
    expect(ballChipText(ball())).toBe("\u2022");
    expect(ballChipText(ball({ runs: 1, batsmanRuns: 1 }))).toBe("1");
    expect(ballChipText(ball({ runs: 2, batsmanRuns: 2 }))).toBe("2");
    expect(ballChipText(ball({ runs: 3, batsmanRuns: 3 }))).toBe("3");
  });

  it("keeps boundaries as their run value", () => {
    expect(ballChipText(ball({ runs: 4, batsmanRuns: 4 }))).toBe("4");
    expect(ballChipText(ball({ runs: 6, batsmanRuns: 6 }))).toBe("6");
    expect(ballChipTone(ball({ runs: 4, batsmanRuns: 4 }))).toBe("boundary");
    expect(ballChipTone(ball({ runs: 6, batsmanRuns: 6 }))).toBe("boundary");
  });

  it("marks every wicket type and a wicket with runs completed", () => {
    expect(ballChipText(ball({ isWicket: true, wicketType: "bowled" }))).toBe("W");
    expect(ballChipText(ball({ isWicket: true, wicketType: "caught" }))).toBe("W");
    expect(ballChipText(ball({ isWicket: true, wicketType: "lbw" }))).toBe("W");
    expect(ballChipText(ball({ isWicket: true, wicketType: "stumped" }))).toBe("W");
    expect(ballChipText(ball({ isWicket: true, wicketType: "run out" }))).toBe("W");
    expect(
      ballChipText(ball({ isWicket: true, wicketType: "run out", runs: 1, batsmanRuns: 1 }))
    ).toBe("1W");
    expect(ballChipTone(ball({ isWicket: true, wicketType: "bowled" }))).toBe("wicket");
  });

  it("writes wides with their total runs", () => {
    expect(ballChipText(ball({ isWide: true, extraRuns: 1 }))).toBe("wd");
    expect(ballChipText(ball({ isWide: true, extraRuns: 3 }))).toBe("3wd");
    expect(ballChipTone(ball({ isWide: true, extraRuns: 1 }))).toBe("extra");
  });

  it("writes no balls with bat runs, byes and leg byes", () => {
    expect(ballChipText(ball({ isNoBall: true, extraRuns: 1 }))).toBe("nb");
    expect(
      ballChipText(ball({ isNoBall: true, extraRuns: 1, runs: 4, batsmanRuns: 4 }))
    ).toBe("5nb");
    expect(
      ballChipText(ball({ isNoBall: true, isBye: true, extraRuns: 4, runs: 0 }))
    ).toBe("5n-b");
    expect(
      ballChipText(ball({ isNoBall: true, isLegBye: true, extraRuns: 2, runs: 0 }))
    ).toBe("3n-b");
  });

  it("writes byes and leg byes", () => {
    expect(ballChipText(ball({ isBye: true, extraRuns: 2 }))).toBe("2b");
    expect(ballChipText(ball({ isLegBye: true, extraRuns: 1 }))).toBe("1lb");
  });
});

describe("ballResultPhrase", () => {
  it("describes plain results", () => {
    expect(ballResultPhrase(ball())).toBe("no run");
    expect(ballResultPhrase(ball({ runs: 1, batsmanRuns: 1 }))).toBe("1 run");
    expect(ballResultPhrase(ball({ runs: 3, batsmanRuns: 3 }))).toBe("3 runs");
    expect(ballResultPhrase(ball({ runs: 4, batsmanRuns: 4 }))).toBe("FOUR");
    expect(ballResultPhrase(ball({ runs: 6, batsmanRuns: 6 }))).toBe("SIX");
  });

  it("describes wides with their extra runs", () => {
    expect(ballResultPhrase(ball({ isWide: true, extraRuns: 1 }))).toBe("wide");
    expect(ballResultPhrase(ball({ isWide: true, extraRuns: 2 }))).toBe("wide, 1 run");
  });

  it("describes no balls with bat runs, byes and leg byes", () => {
    expect(ballResultPhrase(ball({ isNoBall: true, extraRuns: 1 }))).toBe("no ball");
    expect(
      ballResultPhrase(ball({ isNoBall: true, extraRuns: 1, runs: 6, batsmanRuns: 6 }))
    ).toBe("no ball, 6 runs off the bat");
    expect(
      ballResultPhrase(ball({ isNoBall: true, isBye: true, extraRuns: 4 }))
    ).toBe("no ball, 4 byes");
    expect(
      ballResultPhrase(ball({ isNoBall: true, isLegBye: true, extraRuns: 2 }))
    ).toBe("no ball, 2 leg byes");
  });

  it("describes byes and leg byes", () => {
    expect(ballResultPhrase(ball({ isBye: true, extraRuns: 2 }))).toBe("2 byes");
    expect(ballResultPhrase(ball({ isLegBye: true, extraRuns: 1 }))).toBe("1 leg bye");
  });

  it("describes wickets without inventing a fielder", () => {
    expect(ballResultPhrase(ball({ isWicket: true, wicketType: "bowled" }))).toBe(
      "OUT! bowled"
    );
    expect(ballResultPhrase(ball({ isWicket: true, wicketType: "caught" }))).toBe(
      "OUT! caught"
    );
    expect(
      ballResultPhrase(
        ball({ isWicket: true, wicketType: "caught", fielderName: "Keeper" })
      )
    ).toBe("OUT! caught by Keeper");
    expect(ballResultPhrase(ball({ isWicket: true, wicketType: "lbw" }))).toBe("OUT! lbw");
    expect(ballResultPhrase(ball({ isWicket: true, wicketType: "stumped" }))).toBe(
      "OUT! stumped"
    );
    expect(ballResultPhrase(ball({ isWicket: true, wicketType: null }))).toBe("OUT!");
  });

  it("describes a run out with the runs completed before it", () => {
    expect(
      ballResultPhrase(ball({ isWicket: true, wicketType: "run out", fielderName: "Point" }))
    ).toBe("run out (Point)");
    expect(
      ballResultPhrase(
        ball({
          isWicket: true,
          wicketType: "runOut",
          fielderName: "Point",
          runs: 1,
          batsmanRuns: 1,
        })
      )
    ).toBe("run out (Point), 1 run completed");
  });
});

describe("ballSentence", () => {
  it("reads like the reference commentary line", () => {
    expect(ballSentence(ball())).toBe("Bowler to Batter, no run");
    expect(ballSentence(ball({ runs: 4, batsmanRuns: 4 }))).toBe("Bowler to Batter, FOUR");
    expect(
      ballSentence(ball({ isWide: true, extraRuns: 2 }))
    ).toBe("Bowler to Batter, wide, 1 run");
  });
});

const sixBalls = (bowlerName) =>
  Array.from({ length: 6 }, (_, index) => ({
    ...ball({ runs: index === 0 ? 1 : 0, batsmanRuns: index === 0 ? 1 : 0 }),
    bowlerName,
    ballNumber: index + 1,
  }));

describe("buildPlainOverFeed", () => {
  const overs = [
    { overNumber: 0, bowler: { _id: "x", name: "Bowler X" }, balls: sixBalls("Bowler X") },
    {
      overNumber: 1,
      bowler: { _id: "y", name: "Bowler Y" },
      balls: [
        { ...ball({ isWicket: true, wicketType: "bowled" }), bowlerName: "Bowler Y", ballNumber: 1 },
        { ...ball({ runs: 4, batsmanRuns: 4 }), bowlerName: "Bowler Y", ballNumber: 2 },
        { ...ball({ isWide: true, extraRuns: 3 }), bowlerName: "Bowler Y", ballNumber: 3 },
      ],
    },
  ];

  it("totals each over and the running score", () => {
    const feed = buildPlainOverFeed(overs);
    expect(feed.map((entry) => entry.overNumber)).toEqual([2, 1]);
    expect(feed[1].runs).toBe(1);
    expect(feed[0].runs).toBe(7); // 4 + 3 wide runs
    expect(feed[0].score).toEqual({ runs: 8, wickets: 1 });
    expect(feed[0].complete).toBe(false);
    expect(feed[1].complete).toBe(true);
  });

  it("keeps chips in delivery order and newest over first", () => {
    const feed = buildPlainOverFeed(overs);
    expect(feed[0].chips).toEqual(["W", "4", "3wd"]);
    expect(feed[1].chips).toEqual(["1", "\u2022", "\u2022", "\u2022", "\u2022", "\u2022"]);
  });

  it("numbers deliveries by over and ball", () => {
    const feed = buildPlainOverFeed(overs);
    expect(feed[0].balls.map((entry) => entry.label)).toEqual(["2.1", "2.2", "2.3"]);
  });

  it("builds the end of over summary with the bowler line", () => {
    const feed = buildPlainOverFeed(overs);
    expect(feed[1].summary).toBe("End of over 1: 1 run, 1/0");
    expect(feed[1].bowlerLine).toBe("1.0-0-1-0");
  });

  it("builds the over-by-over name list", () => {
    expect(overByOverList(overs)).toEqual([
      { overNumber: 1, name: "Bowler X" },
      { overNumber: 2, name: "Bowler Y" },
    ]);
  });
});

describe("ballDeliveryRuns", () => {
  it("counts the innings total for every delivery", () => {
    expect(ballDeliveryRuns(ball({ runs: 2, batsmanRuns: 2 }))).toBe(2);
    expect(ballDeliveryRuns(ball({ isWide: true, extraRuns: 3 }))).toBe(3);
    expect(
      ballDeliveryRuns(ball({ isNoBall: true, extraRuns: 1, runs: 4, batsmanRuns: 4 }))
    ).toBe(5);
    expect(ballDeliveryRuns(ball({ isBye: true, extraRuns: 2 }))).toBe(2);
    expect(ballDeliveryRuns(ball({ isLegBye: true, extraRuns: 1 }))).toBe(1);
  });
});
