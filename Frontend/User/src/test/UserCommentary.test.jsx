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
  ...overrides,
});

const overs = [
  {
    overNumber: 0,
    bowler: { _id: "x", name: "Bowler X" },
    balls: [
      delivery({ ballNumber: 1 }),
      delivery({ ballNumber: 2, runs: 4, batsmanRuns: 4 }),
      delivery({ ballNumber: 3, isWicket: true, wicketType: "bowled" }),
      delivery({ ballNumber: 4, isWide: true, extraRuns: 2 }),
      delivery({ ballNumber: 5, runs: 2, batsmanRuns: 2 }),
      delivery({ ballNumber: 6, runs: 1, batsmanRuns: 1 }),
    ],
  },
];

describe("User match page commentary", () => {
  it("builds plain lines when no stored commentary exists", () => {
    render(<CommentaryPreview overs={overs} />);

    expect(screen.getByText("Bowler X to Batter A, no run")).toBeInTheDocument();
    expect(screen.getByText("Bowler X to Batter A, FOUR")).toBeInTheDocument();
    expect(screen.getByText("Bowler X to Batter A, OUT! bowled")).toBeInTheDocument();
    expect(screen.getByText("Bowler X to Batter A, wide, 1 run")).toBeInTheDocument();
    expect(
      screen.getByText(/End of over 1: 9 runs, score 9\/1/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Commentary will appear here after the first ball/)).toBeNull();
  });

  it("shows the over strip with runs and one chip per delivery", () => {
    render(<CommentaryPreview overs={overs} />);

    expect(screen.getByText("9 RUNS")).toBeInTheDocument();
    expect(screen.getAllByText("\u2022").length).toBeGreaterThan(0);
    expect(screen.getAllByText("4").length).toBeGreaterThan(0);
    expect(screen.getAllByText("W").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2wd").length).toBeGreaterThan(0);
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
    render(<CommentaryPreview overs={aiOvers} useAiCommentary />);

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
    render(<CommentaryPreview overs={storedOvers} useAiCommentary={false} />);

    expect(screen.getByText("Bowler X to Batter A, no run")).toBeInTheDocument();
    expect(
      screen.queryByText(/The delivery was bowled and played toward the fielding area/)
    ).toBeNull();
  });
});
