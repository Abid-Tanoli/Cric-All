import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TableTab from "../pages/tournament/tabs/TableTab";
import TeamsTab from "../pages/tournament/tabs/TeamsTab";
import HomeTab from "../pages/tournament/tabs/HomeTab";

const wrap = (node) => render(<MemoryRouter>{node}</MemoryRouter>);

const bracket = {
  isKnockout: true,
  champion: { _id: "t1", name: "Reds" },
  stages: [
    {
      stage: "quarter_final",
      label: "Quarter Finals",
      matches: [
        {
          matchId: "qf1",
          placeholder: false,
          stageLabel: "QF1",
          status: "completed",
          teams: [
            { _id: "t1", name: "Reds", shortName: "RED", isWinner: true, score: { runs: 150, wickets: 5 } },
            { _id: "t2", name: "Blues", shortName: "BLU", isWinner: false, score: { runs: 149, wickets: 8 } },
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

describe("tournament stats tabs", () => {
  it("renders a knockout bracket instead of an empty points table", () => {
    wrap(<TableTab standings={[]} bracket={bracket} tournament={{ name: "Knockout Cup" }} />);

    expect(screen.getByText("Knockout Bracket")).toBeInTheDocument();
    expect(screen.getByText("Quarter Finals")).toBeInTheDocument();
    expect(screen.getByText("Winner SF1")).toBeInTheDocument();
    expect(screen.getByText("Champion")).toBeInTheDocument();
    expect(screen.getByText("Reds")).toBeInTheDocument();
    expect(screen.queryByText("Points Table Not Available")).not.toBeInTheDocument();
    expect(screen.queryByText("Points Table")).not.toBeInTheDocument();
  });

  it("keeps the points table for a league tournament", () => {
    const standings = [
      {
        team: { _id: "t1", name: "Reds", shortName: "RED" },
        matchesPlayed: 1,
        won: 1,
        lost: 0,
        points: 2,
        netRunRate: 1.5,
        form: ["W"],
      },
    ];
    wrap(<TableTab standings={standings} bracket={null} tournament={{ name: "League Cup" }} />);

    expect(screen.getByText("Points Table")).toBeInTheDocument();
    expect(screen.queryByText("Knockout Bracket")).not.toBeInTheDocument();
    expect(screen.getByText("Reds")).toBeInTheDocument();
  });

  it("shows per-team tournament numbers on the Teams tab", () => {
    const stats = {
      teamStats: [
        {
          teamId: "t1",
          name: "Reds",
          logo: "",
          played: 2,
          won: 1,
          lost: 1,
          runs: 301,
          wickets: 11,
          fours: 12,
          sixes: 16,
          highestTotalText: "156",
          lowestTotalText: "145",
          runRate: 7.59,
        },
      ],
    };
    wrap(<TeamsTab teams={[{ _id: "t1", name: "Reds" }]} squads={[]} stats={stats} />);

    expect(screen.getByText("Team Stats")).toBeInTheDocument();
    const teamLinks = screen.getAllByRole("link", { name: /Reds/ });
    expect(teamLinks.length).toBeGreaterThan(0);
    for (const link of teamLinks) expect(link).toHaveAttribute("href", "/teams/t1");
    expect(screen.getByText("301")).toBeInTheDocument();
    expect(screen.getByText("156")).toBeInTheDocument();
    expect(screen.getByText("Squads not announced yet")).toBeInTheDocument();
  });

  it("shows tournament runs, wickets and boundaries on Home", () => {
    wrap(
      <HomeTab
        content={{}}
        matches={[
          { _id: "m1", status: "completed", teams: [{ shortName: "RED" }, { shortName: "BLU" }], result: { description: "Reds won" } },
          { _id: "m2", status: "upcoming", teams: [{ shortName: "RED" }, { shortName: "BLU" }] },
        ]}
        stats={{ totalRuns: 1191, totalWickets: 42, boundaryMeter: { sixes: 61, fours: 132 } }}
        basePath="/series/t"
      />,
    );

    expect(screen.getByText("Total Runs")).toBeInTheDocument();
    expect(screen.getByText("1191")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("61")).toBeInTheDocument();
    expect(screen.getByText("132")).toBeInTheDocument();
    expect(screen.getByText("Total Matches")).toBeInTheDocument();
  });
});
