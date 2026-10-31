import React from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import StatsTab from "../pages/tournament/tabs/StatsTab";

const stats = {
  empty: false,
  totalWides: 0,
  totalNoBalls: 0,
  boundaryMeter: { sixes: 4, fours: 10, mostSixes: [], mostFours: [] },
  topRunScorers: [
    {
      playerId: "p1",
      name: "Wali Amber",
      team: "Baldia Zalmi",
      matches: 5,
      innings: 5,
      notOuts: 1,
      runs: 225,
      highestText: "94*",
      average: 56.25,
      strikeRate: 160,
      fifties: 2,
      hundreds: 0,
      fours: 18,
      sixes: 12,
    },
  ],
  topWicketTakers: [
    {
      playerId: "p2",
      name: "Usman Masood",
      team: "Young Star",
      matches: 4,
      oversText: "16.0",
      wickets: 9,
      bestFigures: "4/18",
      average: 8.5,
      economy: 6.1,
      fourWickets: 1,
      fiveWickets: 0,
      wides: 0,
      noBalls: 0,
    },
  ],
  topFielders: [],
  highestScores: [],
  bestBowling: [],
  bestStrikeRates: [],
  bestEconomy: [],
  teamStats: [],
  playerOfTournament: {
    rows: [
      {
        playerId: "p1",
        rank: 1,
        name: "Wali Amber",
        team: "Baldia Zalmi",
        matches: 5,
        runs: 225,
        wickets: 4,
        innings: 5,
        ballsBowled: 36,
        oversText: "6.0",
        manOfMatchAwards: 2,
        impact: 318.4,
        breakdown: { batting: 290, bowling: 105.6, fielding: 0, winBonus: 78.2, manOfMatchBonus: 40 },
      },
      {
        playerId: "p3",
        rank: 2,
        name: "Ijaz Koistani",
        team: "Young Star",
        matches: 4,
        runs: 94,
        wickets: 8,
        impact: 275.5,
        breakdown: { batting: 149, bowling: 210, fielding: 0, winBonus: 70, manOfMatchBonus: 0 },
      },
    ],
    leader: {
      playerId: "p1",
      rank: 1,
      name: "Wali Amber",
      team: "Baldia Zalmi",
      matches: 5,
      impact: 318.4,
      breakdown: { batting: 290, bowling: 105.6, fielding: 0, winBonus: 78.2, manOfMatchBonus: 40 },
    },
    explanation: ["Batting: 1 point per run, plus 1 per four and 2 per six.", "Man of the Match: 20 extra points."],
    hasData: true,
  },
};

const renderTab = (payload = stats) =>
  render(
    <MemoryRouter>
      <StatsTab stats={payload} />
    </MemoryRouter>,
  );

describe("tournament Stats tab", () => {
  it("shows matches played on the batting and bowling tables", () => {
    renderTab();
    // Every player table carries the column: Most Runs, Most Wickets, Fielding,
    // Highest Scores, Best Bowling, Best Strike Rate, Best Economy.
    expect(screen.getAllByText("Mat").length).toBeGreaterThanOrEqual(2);
    const played = screen.getAllByTitle("Matches played").map((cell) => cell.textContent);
    expect(played).toContain("5");
    expect(played).toContain("4");
  });

  it("highlights the leader and lists the top 10 by impact", () => {
    renderTab();
    expect(screen.getByText("Player of the Tournament")).toBeInTheDocument();
    expect(screen.getByText(/provisional until the Final/i)).toBeInTheDocument();
    expect(screen.getAllByText("Wali Amber").length).toBeGreaterThan(1);
    expect(screen.getAllByText("318.4").length).toBeGreaterThan(0);
    expect(screen.getByText("Ijaz Koistani")).toBeInTheDocument();
    expect(screen.getByText("275.5")).toBeInTheDocument();
  });

  it("reveals a player's breakdown when the row is opened", () => {
    renderTab();
    fireEvent.click(screen.getByText("275.5")); // the impact cell of Ijaz's row
    expect(screen.getAllByText("Player of the Match").length).toBeGreaterThan(0);
    expect(screen.getByText("210.00")).toBeInTheDocument();
  });

  it("explains the calculation from the server-provided weights", () => {
    renderTab();
    fireEvent.click(screen.getByText(/How it's calculated/i));
    expect(screen.getByText(/1 point per run/)).toBeInTheDocument();
    expect(screen.getByText(/20 extra points/)).toBeInTheDocument();
  });

  it("stays graceful with no data yet", () => {
    renderTab({ empty: true });
    expect(
      screen.getByText(/ranking appears once matches are completed/i),
    ).toBeInTheDocument();
  });
});
