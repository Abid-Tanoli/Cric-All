import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import ScorecardTab from "../components/ScorecardTab";
import { buildTournamentAwards } from "../utils/tournamentAwards";

// P4: the player of the match must be visible on the public scorecard (the tab
// a paper match opens on), and the tournament honours block must shape an
// organiser's picks without guessing.

const match = (overrides = {}) => ({
  _id: "m1",
  teams: [{ _id: "t1", name: "Alpha" }, { _id: "t2", name: "Beta" }],
  innings: [
    {
      team: { _id: "t1", name: "Alpha" },
      runs: 120,
      wickets: 5,
      balls: 120,
      batting: [{ player: { _id: "p1", name: "Ann" }, runs: 40, balls: 30, isOut: true }],
      bowling: [{ player: { _id: "p2", name: "Ben" }, balls: 24, runs: 20, wickets: 2 }],
      fallOfWickets: [],
      extras: { total: 8, wides: 5, noBalls: 1, byes: 1, legByes: 1 },
    },
  ],
  ...overrides,
});

const renderScorecard = (props) =>
  render(
    <MemoryRouter>
      <ScorecardTab
        match={props.match}
        innings={props.match.innings[0]}
        selectedInnings={0}
        setSelectedInnings={() => {}}
        battingTeam={props.match.innings[0].team}
        players={[{ _id: "p1", name: "Ann" }, { _id: "p2", name: "Ben" }]}
      />
    </MemoryRouter>
  );

describe("ScorecardTab player of the match", () => {
  it("shows the player of the match on the scorecard", () => {
    renderScorecard({ match: match({ manOfMatch: { _id: "p1", name: "Ann" } }) });
    const card = screen.getByTestId("player-of-the-match");
    expect(within(card).getByText("Player of the Match")).toBeTruthy();
    expect(within(card).getByText("Ann")).toBeTruthy();
  });

  it("resolves a player id against the squad when it is not populated", () => {
    renderScorecard({ match: match({ manOfMatch: "p2" }) });
    const card = screen.getByTestId("player-of-the-match");
    expect(within(card).getByText("Ben")).toBeTruthy();
  });

  it("shows nothing when no player of the match is set", () => {
    renderScorecard({ match: match() });
    expect(screen.queryByTestId("player-of-the-match")).toBeNull();
  });
});

describe("buildTournamentAwards", () => {
  it("returns nothing for a tournament with no honours", () => {
    expect(buildTournamentAwards({ _id: "t1", name: "Cup" })).toEqual([]);
    expect(buildTournamentAwards(null)).toEqual([]);
  });

  it("builds champion and runner-up rows from populated teams", () => {
    const rows = buildTournamentAwards({
      winner: { _id: "teamA", name: "Alpha CC" },
      runnerUp: { _id: "teamB", name: "Beta CC" },
    });
    expect(rows.map((r) => r.title)).toEqual(["Champion", "Runner-up"]);
    expect(rows[0]).toMatchObject({ name: "Alpha CC", teamId: "teamA" });
  });

  it("includes the three player awards with their roles", () => {
    const rows = buildTournamentAwards({
      awards: {
        playerOfTournament: { _id: "p1", name: "Ann", playingRole: "All-Rounder" },
        bestBatsman: { _id: "p2", name: "Ben", role: "Batsman" },
        bestBowler: { _id: "p3", name: "Cleo", playingRole: "Bowler" },
      },
    });
    expect(rows.map((r) => r.title)).toEqual([
      "Player of the Tournament",
      "Best Batsman",
      "Best Bowler",
    ]);
    expect(rows[0]).toMatchObject({ name: "Ann", subtitle: "All-Rounder", playerId: "p1" });
    expect(rows[1].subtitle).toBe("Batsman");
  });

  it("skips only the awards that are missing", () => {
    const rows = buildTournamentAwards({
      winner: { _id: "teamA", name: "Alpha CC" },
      awards: { bestBowler: { _id: "p3", name: "Cleo" } },
    });
    expect(rows.map((r) => r.title)).toEqual([
      "Champion",
      "Best Bowler",
    ]);
  });
});
