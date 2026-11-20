import { describe, expect, it } from "vitest";
import {
  buildPlainOverFeed,
  dismissalLine,
  howOutText,
  newBatterText,
  newBowlerText,
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
  bowlerName: "Adil",
  batsmanName: "Hamza",
  ...overrides,
});

const over = (overNumber, id, name, balls) => ({
  overNumber,
  bowler: { _id: id, name },
  balls,
});

const six = (bowlerName, overrides = {}) =>
  Array.from({ length: 6 }, (_, index) => ({
    ...ball({
      bowlerName,
      ballNumber: index + 1,
      batsmanOnStrike: "p1",
      batsmanNonStrike: "p2",
      ...overrides,
    }),
  }));

describe("end of over card", () => {
  it("lists both bowlers with their O-M-R-W after an over", () => {
    const feed = buildPlainOverFeed([
      over(0, "a", "Adil", six("Adil")),
      over(1, "b", "Basit", six("Basit")),
    ]);

    expect(feed[0].title).toBe("End of over 2");
    expect(feed[0].scoreText).toBe("0/0");
    expect(feed[0].bowlers).toEqual([
      { id: "b", name: "Basit", line: "1.0-1-0-0", isCurrent: true },
      { id: "a", name: "Adil", line: "1.0-1-0-0", isCurrent: false },
    ]);
  });

  it("shows just the one bowler once a single over has been bowled", () => {
    const feed = buildPlainOverFeed([over(0, "a", "Adil", six("Adil"))]);
    expect(feed[0].bowlers).toHaveLength(1);
    expect(feed[0].bowlers[0]).toMatchObject({ name: "Adil", isCurrent: true });
  });

  it("totals both batters and marks the striker", () => {
    const feed = buildPlainOverFeed(
      [
        over(0, "a", "Adil", [
          { ...ball({ runs: 4, batsmanRuns: 4 }), ballNumber: 1, batsmanOnStrike: "p1", batsmanNonStrike: "p2" },
          { ...ball({ runs: 1, batsmanRuns: 1 }), ballNumber: 2, batsmanOnStrike: "p2", batsmanNonStrike: "p1" },
          { ...ball({ runs: 1, batsmanRuns: 1 }), ballNumber: 3, batsmanOnStrike: "p2", batsmanNonStrike: "p1" },
          { ...ball({ runs: 1, batsmanRuns: 1 }), ballNumber: 4, batsmanOnStrike: "p2", batsmanNonStrike: "p1" },
          { ...ball({ runs: 1, batsmanRuns: 1 }), ballNumber: 5, batsmanOnStrike: "p2", batsmanNonStrike: "p1" },
          { ...ball({ runs: 1, batsmanRuns: 1 }), ballNumber: 6, batsmanOnStrike: "p2", batsmanNonStrike: "p1" },
        ]),
      ],
      {
        players: [
          { _id: "p1", name: "Hamza" },
          { _id: "p2", name: "Shan" },
        ],
      }
    );

    expect(feed[0].batters).toEqual([
      { id: "p2", name: "Shan", runs: 5, balls: 5, onStrike: true },
      { id: "p1", name: "Hamza", runs: 4, balls: 1, onStrike: false },
    ]);
  });

  it("does not count a wide as a ball faced or a run to the batter", () => {
    const feed = buildPlainOverFeed(
      [
        over(0, "a", "Adil", [
          { ...ball({ isWide: true, extraRuns: 3 }), ballNumber: 1, batsmanOnStrike: "p1", batsmanNonStrike: "p2" },
        ]),
      ],
      { players: [{ _id: "p1", name: "Hamza" }] }
    );

    expect(feed[0].batters[0]).toMatchObject({ name: "Hamza", runs: 0, balls: 0 });
  });

  it("adds the target and what is still needed in a chase", () => {
    const feed = buildPlainOverFeed(
      [over(0, "a", "Adil", six("Adil", { runs: 1, batsmanRuns: 1 }))],
      { target: 20, totalOvers: 2 }
    );

    expect(feed[0].chase).toEqual({ target: 20, need: 14, ballsLeft: 6 });
    expect(feed[0].chaseText).toBe("Target 20 · need 14 from 6 balls");
  });

  it("has no chase line without a target", () => {
    const feed = buildPlainOverFeed([over(0, "a", "Adil", six("Adil"))]);
    expect(feed[0].chase).toBeNull();
    expect(feed[0].chaseText).toBe("");
  });

  it("keeps the chips in delivery order on the card", () => {
    const feed = buildPlainOverFeed([
      over(0, "a", "Adil", [
        { ...ball({ runs: 4, batsmanRuns: 4 }), ballNumber: 1 },
        { ...ball({ isWicket: true, wicketType: "bowled" }), ballNumber: 2 },
        { ...ball({ isWide: true, extraRuns: 2 }), ballNumber: 3 },
      ]),
    ]);

    expect(feed[0].chips).toEqual(["4", "W", "2wd"]);
  });
});

describe("new bowler row", () => {
  const overs = [
    over(0, "a", "Adil", six("Adil")),
    over(1, "b", "Basit", six("Basit")),
    over(2, "c", "Chand", six("Chand")),
    over(3, "d", "Dinesh", six("Dinesh")),
    over(4, "a", "Adil", six("Adil")),
  ];
  const feed = buildPlainOverFeed(overs);

  it("opens the bowling in the first over", () => {
    expect(feed[4].events[0]).toMatchObject({
      kind: "bowler",
      text: "Adil to open the bowling",
    });
  });

  it("opens the bowling from the other end in the second over", () => {
    expect(feed[3].events[0].text).toBe("Basit to open the bowling");
  });

  it("names the bowler being replaced at that end", () => {
    expect(feed[2].events[0].text).toBe("Chand comes into the attack, replacing Adil");
  });

  it("says comes into the attack for a bowler returning after others", () => {
    expect(feed[0].events[0].text).toBe("Adil comes into the attack, replacing Chand");
  });

  it("puts the event before the first ball of the over", () => {
    const kinds = feed[0].events.map((event) => event.kind);
    expect(kinds[0]).toBe("bowler");
    expect(kinds.filter((kind) => kind === "ball")).toHaveLength(6);
  });
});

describe("wicket and new batter rows", () => {
  const overs = [
    over(0, "a", "Adil", [
      {
        ...ball({ runs: 1, batsmanRuns: 1 }),
        ballNumber: 1,
        batsmanOnStrike: "p1",
        batsmanNonStrike: "p2",
        batsmanName: "Hamza",
      },
      {
        ...ball({ isWicket: true, wicketType: "caught", fielderName: "Keeper" }),
        ballNumber: 2,
        batsmanOnStrike: "p1",
        batsmanNonStrike: "p2",
        batsmanName: "Hamza",
      },
      {
        ...ball(),
        ballNumber: 3,
        batsmanOnStrike: "p3",
        batsmanNonStrike: "p2",
        batsmanName: "Shan",
      },
    ]),
  ];

  it("puts the batter's final score on the dismissal line", () => {
    const feed = buildPlainOverFeed(overs);
    expect(feed[0].balls[1].dismissal).toBe("Hamza c Keeper b Adil, 1 (2)");
  });

  it("adds the incoming batter at his batting position", () => {
    const feed = buildPlainOverFeed(overs);
    const event = feed[0].events.find((entry) => entry.kind === "batter");
    expect(event.text).toBe("Shan comes in next at No. 3");
  });

  it("omits the new batter row when no one comes in next", () => {
    const feed = buildPlainOverFeed([
      over(0, "a", "Adil", [
        {
          ...ball({ isWicket: true, wicketType: "bowled" }),
          ballNumber: 1,
          batsmanOnStrike: "p1",
          batsmanNonStrike: "p2",
        },
      ]),
    ]);

    expect(feed[0].events.some((entry) => entry.kind === "batter")).toBe(false);
  });
});

describe("shorthand helpers", () => {
  it("writes the dismissal shorthand from the fields that exist", () => {
    expect(howOutText(ball({ isWicket: true, wicketType: "caught", fielderName: "Keeper" }))).toBe(
      "c Keeper b Adil"
    );
    expect(howOutText(ball({ isWicket: true, wicketType: "bowled" }))).toBe("b Adil");
    expect(howOutText(ball({ isWicket: true, wicketType: "lbw" }))).toBe("lbw b Adil");
    expect(howOutText(ball({ isWicket: true, wicketType: "runOut", fielderName: "Point" }))).toBe(
      "run out (Point)"
    );
    expect(howOutText(ball({ isWicket: true, wicketType: "hitWicket" }))).toBe("hit wicket b Adil");
  });

  it("omits a fielder or bowler the data does not have", () => {
    expect(howOutText(ball({ isWicket: true, wicketType: "caught" }))).toBe("c b Adil");
    expect(howOutText({ isWicket: true, wicketType: "caught" })).toBe("c");
    expect(howOutText({ isWicket: true, wicketType: "bowled" })).toBe("bowled");
  });

  it("builds no dismissal line without a name", () => {
    expect(dismissalLine({})).toBe("");
    expect(dismissalLine({ name: "Hamza", howOut: "b Adil", runs: 16, balls: 6 })).toBe(
      "Hamza b Adil, 16 (6)"
    );
  });

  it("builds the event sentences and leaves them empty without a name", () => {
    expect(newBowlerText("")).toBe("");
    expect(newBowlerText("Adil")).toBe("Adil to open the bowling");
    expect(newBowlerText("Adil", "Basit")).toBe("Adil comes into the attack, replacing Basit");
    expect(newBatterText("")).toBe("");
    expect(newBatterText("Shan", 4)).toBe("Shan comes in next at No. 4");
    expect(newBatterText("Shan")).toBe("Shan comes in next");
  });
});
