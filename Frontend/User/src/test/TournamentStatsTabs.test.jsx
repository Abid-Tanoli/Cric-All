import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
      matches: [{
        placeholder: true,
        stage: "final",
        label: "Winner SF1 vs Winner SF2",
        teams: [
          { _id: "t3", name: "Sky Sports", isWinner: true },
          { _id: "t4", name: "Young Star", isWinner: true },
        ],
      }],
    },
  ],
};

describe("tournament stats tabs", () => {
  it("renders a knockout bracket instead of an empty points table", () => {
    wrap(<TableTab standings={[]} bracket={bracket} tournament={{ name: "Knockout Cup" }} />);

    expect(screen.getByText("Knockout Bracket")).toBeInTheDocument();
    expect(screen.getByText("Quarter Finals")).toBeInTheDocument();
    expect(screen.getByText("Finalists")).toBeInTheDocument();
    expect(screen.getByText("Young Star")).toBeInTheDocument();
    expect(screen.getByText("Champion")).toBeInTheDocument();
    expect(screen.getAllByText("Reds")).toHaveLength(1);
    expect(screen.getByText("RED")).toBeInTheDocument();
    expect(screen.queryByText("Final fixture not yet scheduled")).not.toBeInTheDocument();
    expect(screen.queryByText("Points Table Not Available")).not.toBeInTheDocument();
    expect(screen.queryByText("Points Table")).not.toBeInTheDocument();

    // Both finalists are known, but neither has won the final yet. The stale
    // isWinner flags on the placeholder must not produce a badge or a score.
    const finalCard = screen.getByTestId("bracket-placeholder-final");
    expect(within(finalCard).queryByText("W")).not.toBeInTheDocument();
    expect(within(finalCard).queryByText("0/0")).not.toBeInTheDocument();
    expect(within(finalCard).queryByText("-")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("bracket-match-qf1")).getByText("W")).toBeInTheDocument();
  });

  it("shows W only for the winner of a completed match at every knockout slot", () => {
    const states = {
      isKnockout: true,
      stages: [
        {
          stage: "quarter_final",
          label: "Quarter Finals",
          matches: [{
            matchId: "qf",
            stageLabel: "QF1",
            status: "completed",
            teams: [
              { _id: "a", name: "Alpha", isWinner: true, score: { runs: 150, wickets: 5 } },
              { _id: "b", name: "Beta", isWinner: false, score: { runs: 140, wickets: 8 } },
            ],
            result: { description: "Alpha won" },
          }],
        },
        {
          stage: "semi_final",
          label: "Semi Finals",
          matches: [{
            matchId: "sf",
            stageLabel: "SF1",
            status: "upcoming",
            // Stale/placeholder flags: an unplayed semi must not show a W.
            teams: [
              { _id: "a", name: "Alpha", isWinner: true },
              { _id: "b", name: "Beta", isWinner: true },
            ],
            result: {},
          }],
        },
        {
          stage: "third_place",
          label: "Third Place",
          matches: [{
            matchId: "tp",
            stageLabel: "3rd",
            status: "completed",
            teams: [
              { _id: "c", name: "Gamma", isWinner: true, score: { runs: 120, wickets: 7 } },
              { _id: "d", name: "Delta", isWinner: false, score: { runs: 119, wickets: 9 } },
            ],
            result: { description: "Gamma won" },
          }],
        },
      ],
    };
    wrap(<TableTab standings={[]} bracket={states} tournament={{ name: "Knockout Cup" }} />);

    expect(within(screen.getByTestId("bracket-match-qf")).getByText("W")).toBeInTheDocument();
    expect(within(screen.getByTestId("bracket-match-tp")).getByText("W")).toBeInTheDocument();
    const semi = screen.getByTestId("bracket-match-sf");
    expect(within(semi).queryByText("W")).not.toBeInTheDocument();
    expect(within(semi).queryByText("-")).not.toBeInTheDocument();
  });

  it("shows an upcoming final with date and venue but no winner badge or score", () => {
    const upcoming = {
      isKnockout: true,
      stages: [{
        stage: "final",
        label: "Final",
        matches: [{
          matchId: "final1",
          placeholder: false,
          stageLabel: "Final",
          status: "upcoming",
          startAt: "2026-11-01T05:30:00.000Z",
          venue: "Tahirabad Ground",
          teams: [
            { _id: "sky", name: "Sky Sports", isWinner: true },
            { _id: "young", name: "Young Star", isWinner: true },
          ],
          result: {},
        }],
      }],
    };
    wrap(<TableTab standings={[]} bracket={upcoming} tournament={{ name: "Knockout Cup" }} />);

    const card = screen.getByTestId("bracket-match-final1");
    expect(within(card).getByText("upcoming")).toBeInTheDocument();
    expect(within(card).getByText(/Nov 1, 2026/)).toBeInTheDocument();
    expect(within(card).getByText("Tahirabad Ground")).toBeInTheDocument();
    expect(within(card).queryByText("W")).not.toBeInTheDocument();
    expect(within(card).queryByText("0/0")).not.toBeInTheDocument();
    expect(within(card).queryByText("-")).not.toBeInTheDocument();
    expect(screen.queryByText("Final fixture not yet scheduled")).not.toBeInTheDocument();
  });

  it("shows a live final with its status and score but no winner badge", () => {
    const live = {
      isKnockout: true,
      stages: [{
        stage: "final",
        label: "Final",
        matches: [{
          matchId: "final2",
          placeholder: false,
          stageLabel: "Final",
          status: "live",
          startAt: "2026-11-01T05:30:00.000Z",
          venue: "Tahirabad Ground",
          teams: [
            { _id: "sky", name: "Sky Sports", isWinner: true, score: { runs: 120, wickets: 3 } },
            { _id: "young", name: "Young Star", isWinner: false, score: { runs: 40, wickets: 1 } },
          ],
          result: {},
        }],
      }],
    };
    wrap(<TableTab standings={[]} bracket={live} tournament={{ name: "Knockout Cup" }} />);

    const card = screen.getByTestId("bracket-match-final2");
    expect(within(card).getByText("live")).toBeInTheDocument();
    expect(within(card).getByText("120/3")).toBeInTheDocument();
    expect(within(card).getByText("40/1")).toBeInTheDocument();
    expect(within(card).queryByText("W")).not.toBeInTheDocument();
  });

  it("shows the winner badge and both scores for a completed final", () => {
    const completed = {
      isKnockout: true,
      champion: { _id: "sky", name: "Sky Sports" },
      stages: [{
        stage: "final",
        label: "Final",
        matches: [{
          matchId: "final3",
          placeholder: false,
          stageLabel: "Final",
          status: "completed",
          startAt: "2026-11-01T05:30:00.000Z",
          venue: "Tahirabad Ground",
          teams: [
            { _id: "sky", name: "Sky Sports", isWinner: true, score: { runs: 160, wickets: 5 } },
            { _id: "young", name: "Young Star", isWinner: false, score: { runs: 155, wickets: 9 } },
          ],
          result: { description: "Sky Sports won by 5 runs" },
        }],
      }],
    };
    wrap(<TableTab standings={[]} bracket={completed} tournament={{ name: "Knockout Cup" }} />);

    const card = screen.getByTestId("bracket-match-final3");
    expect(within(card).getByText("W")).toBeInTheDocument();
    expect(within(card).getByText("160/5")).toBeInTheDocument();
    expect(within(card).getByText("155/9")).toBeInTheDocument();
    expect(within(card).getByText("Sky Sports won by 5 runs")).toBeInTheDocument();
    expect(screen.getByText("Champion")).toBeInTheDocument();
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
