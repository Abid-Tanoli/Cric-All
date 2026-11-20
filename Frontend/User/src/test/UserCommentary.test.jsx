import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CommentaryPreview from "../components/CommentaryPreview";

const delivery = (overrides = {}) => ({
  runs: 0,
  batsmanRuns: 0,
  extraRuns: 0,
  isWide: false,
  isNoBall: false,
  isBye: false,
  isLegBye: false,
  isWicket: false,
  bowlerName: "Bowler X",
  batsmanName: "Batter A",
  batsmanOnStrike: "p1",
  batsmanNonStrike: "p2",
  ...overrides,
});

const players = [
  { _id: "p1", name: "Batter A" },
  { _id: "p2", name: "Batter B" },
  { _id: "p3", name: "Batter C" },
];

const overs = [
  {
    overNumber: 0,
    bowler: { _id: "x", name: "Bowler X" },
    balls: [
      delivery({ ballNumber: 1 }),
      delivery({ ballNumber: 2, runs: 4, batsmanRuns: 4 }),
      delivery({ ballNumber: 3, isWicket: true, wicketType: "bowled" }),
      delivery({ ballNumber: 4, batsmanOnStrike: "p3", batsmanName: "Batter C" }),
      delivery({ ballNumber: 5, runs: 2, batsmanRuns: 2, batsmanOnStrike: "p3", batsmanName: "Batter C" }),
      delivery({ ballNumber: 6, runs: 1, batsmanRuns: 1, batsmanOnStrike: "p3", batsmanName: "Batter C" }),
      delivery({ ballNumber: 7, isWide: true, extraRuns: 2, batsmanOnStrike: "p3", batsmanName: "Batter C" }),
    ],
  },
];

describe("User match page commentary", () => {
  it("builds plain lines when no stored commentary exists", () => {
    render(<CommentaryPreview overs={overs} players={players} />);

    expect(screen.getByText("Bowler X to Batter A, no run")).toBeInTheDocument();
    expect(screen.getByText("Bowler X to Batter A, FOUR")).toBeInTheDocument();
    expect(screen.getByText("Bowler X to Batter A, OUT! bowled")).toBeInTheDocument();
    expect(screen.getByText("Bowler X to Batter C, wide, 1 run")).toBeInTheDocument();
    expect(screen.queryByText(/Commentary will appear here after the first ball/)).toBeNull();
  });

  it("shows the over strip with runs and one chip per delivery", () => {
    render(<CommentaryPreview overs={overs} players={players} />);

    expect(screen.getByText("9 RUNS")).toBeInTheDocument();
    expect(screen.getAllByText("\u2022").length).toBeGreaterThan(0);
    expect(screen.getAllByText("4").length).toBeGreaterThan(0);
    expect(screen.getAllByText("W").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2wd").length).toBeGreaterThan(0);
  });

  it("renders the end of over card with the score, both batters and the bowler", () => {
    render(<CommentaryPreview overs={overs} players={players} />);

    expect(screen.getByText("End of over 1")).toBeInTheDocument();
    expect(screen.getByText("9 runs")).toBeInTheDocument();
    expect(screen.getByText("9/1")).toBeInTheDocument();
    expect(screen.getByText("At the crease")).toBeInTheDocument();
    expect(screen.getByText("Bowling")).toBeInTheDocument();
    expect(screen.getByText("*")).toBeInTheDocument();
    expect(screen.getByText("3 (3)")).toBeInTheDocument();
    expect(screen.getByText("0 (0)")).toBeInTheDocument();
    expect(screen.getByText("Bowler X")).toBeInTheDocument();
    expect(screen.getByText("1.0-0-9-1")).toBeInTheDocument();
  });

  it("shows the new bowler and new batter event rows and the dismissal score", () => {
    render(<CommentaryPreview overs={overs} players={players} />);

    expect(screen.getByText("Bowler X to open the bowling")).toBeInTheDocument();
    expect(screen.getByText("New bowler")).toBeInTheDocument();
    expect(screen.getByText("Batter C comes in next at No. 3")).toBeInTheDocument();
    expect(screen.getByText("New batter")).toBeInTheDocument();
    expect(screen.getByText("Batter A b Bowler X, 4 (3)")).toBeInTheDocument();
  });

  it("keeps AI commentary unchanged when the match has it on", () => {
    const aiOvers = [
      {
        ...overs[0],
        balls: [
          {
            ...delivery({ ballNumber: 1, runs: 4, batsmanRuns: 4 }),
            vividCommentary: "Cracking shot through the covers.",
            commentary: "FOUR",
            isAi: true,
          },
        ],
      },
    ];
    render(<CommentaryPreview overs={aiOvers} players={players} useAiCommentary />);

    expect(screen.getByText("Bowler X to Batter A, FOUR")).toBeInTheDocument();
    expect(screen.getByText("Cracking shot through the covers.")).toBeInTheDocument();
  });

  it("does not show stored verbose text while AI commentary is off", () => {
    const storedOvers = [
      {
        ...overs[0],
        balls: [
          {
            ...delivery({ ballNumber: 1 }),
            vividCommentary: "The delivery was bowled and played toward the fielding area.",
            commentary: "Dot ball.",
          },
        ],
      },
    ];
    render(<CommentaryPreview overs={storedOvers} players={players} useAiCommentary={false} />);

    expect(screen.getByText("Bowler X to Batter A, no run")).toBeInTheDocument();
    expect(
      screen.queryByText(/The delivery was bowled and played toward the fielding area/)
    ).toBeNull();
  });
});
