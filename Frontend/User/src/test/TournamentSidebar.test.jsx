import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TournamentSidebar, {
  MINI_TABLE_SIZE,
  LEADER_SIZE,
} from "../pages/tournament/TournamentSidebar";

// ---------------------------------------------------------------------------
// The right sidebar has a fixed order and fixed sizes. Both are contract, not
// incidental styling, so they are asserted here rather than left to the eye.
// ---------------------------------------------------------------------------

const standings = Array.from({ length: 10 }, (_, i) => ({
  team: { _id: `team-${i + 1}`, name: `Team ${i + 1}`, shortName: `T${i + 1}` },
  matchesPlayed: i + 1,
  points: 10 - i,
}));

const stats = {
  topWicketTakers: Array.from({ length: 5 }, (_, i) => ({
    playerId: `bowl-${i + 1}`,
    name: `Bowler ${i + 1}`,
    team: "Alpha",
    wickets: 10 - i,
  })),
  topRunScorers: Array.from({ length: 5 }, (_, i) => ({
    playerId: `bat-${i + 1}`,
    name: `Batter ${i + 1}`,
    team: "Alpha",
    runs: 200 - i,
  })),
};

const renderSidebar = (props = {}) =>
  render(
    <MemoryRouter>
      <TournamentSidebar standings={standings} stats={stats} {...props} />
    </MemoryRouter>
  );

describe("TournamentSidebar", () => {
  it("keeps the documented section order: table, wickets, runs", () => {
    const { container } = renderSidebar();
    const order = [...container.querySelectorAll('[data-testid^="sidebar-"]')].map((el) =>
      el.getAttribute("data-testid")
    );
    expect(order).toEqual(["sidebar-table", "sidebar-wickets", "sidebar-runs"]);
  });

  it("truncates the mini table to the top 8 and the leaders to the top 3", () => {
    const { container } = renderSidebar();

    const tableRows = container.querySelectorAll('[data-testid="sidebar-table"] a[href^="/teams/"]');
    expect(tableRows).toHaveLength(MINI_TABLE_SIZE);
    expect(screen.getByText("Team 8")).toBeInTheDocument();
    expect(screen.queryByText("Team 9")).not.toBeInTheDocument();

    const wicketRows = container.querySelectorAll('[data-testid="sidebar-wickets"] a[href^="/players/"]');
    expect(wicketRows).toHaveLength(LEADER_SIZE);
    expect(screen.queryByText("Bowler 4")).not.toBeInTheDocument();

    const runRows = container.querySelectorAll('[data-testid="sidebar-runs"] a[href^="/players/"]');
    expect(runRows).toHaveLength(LEADER_SIZE);
    expect(screen.queryByText("Batter 4")).not.toBeInTheDocument();
  });

  it("shows a friendly placeholder in each section when there is nothing yet", () => {
    renderSidebar({ standings: [], stats: {} });
    expect(screen.getByText("No standings yet")).toBeInTheDocument();
    expect(screen.getByText("No bowling stats yet")).toBeInTheDocument();
    expect(screen.getByText("No batting stats yet")).toBeInTheDocument();
  });

  it("swaps an empty points table for the knockout bracket", () => {
    const bracket = {
      isKnockout: true,
      champion: null,
      stages: [
        {
          stage: "quarter_final",
          label: "Quarter Finals",
          matches: [
            {
              matchId: "qf1",
              placeholder: false,
              stageLabel: "QF1",
              teams: [
                { _id: "t1", name: "Reds", shortName: "RED", isWinner: true, score: { text: "150/5" } },
                { _id: "t2", name: "Blues", shortName: "BLU", isWinner: false, score: { text: "149/8" } },
              ],
              result: { description: "Reds won by 5 wickets" },
            },
          ],
        },
        {
          stage: "final",
          label: "Final",
          matches: [{ placeholder: true, label: "Winner SF1" }],
        },
      ],
    };

    renderSidebar({ standings: [], bracket });

    expect(screen.getByText("Knockout")).toBeInTheDocument();
    expect(screen.queryByText("No standings yet")).not.toBeInTheDocument();
    expect(screen.getByText("✓ RED vs BLU")).toBeInTheDocument();
    expect(screen.getByText("Winner SF1")).toBeInTheDocument();
    expect(screen.getByText("Quarter Finals")).toBeInTheDocument();
  });
});
