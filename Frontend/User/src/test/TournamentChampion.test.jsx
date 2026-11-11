import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TournamentChampionHero from "../components/TournamentChampionHero";
import TournamentChampionCard from "../components/TournamentChampionCard";
import HomeTab from "../pages/tournament/tabs/HomeTab";
import { teamShortName } from "../utils/teamDisplay";

const winner = { _id: "team-sky", name: "Sky Sports", shortName: "", logo: "/sky.png" };
const runnerUp = { _id: "team-young", name: "Young Star", shortName: "", logo: "" };

const tournament = {
  _id: "tournament-1",
  name: "Premier Cup",
  status: "completed",
  winner,
  runnerUp,
};

const finalMatch = {
  _id: "match-final",
  stage: "final",
  status: "completed",
  teams: [runnerUp, winner],
  result: { description: "Sky Sports won by 9 wickets (14 balls remaining)" },
};

const awardsStats = {
  officialAwards: {
    bestBowler: { playerId: "p1", name: "Usman Masood", team: "Young Star", wickets: 9 },
  },
  playerOfTournament: { rows: [] },
  topRunScorers: [],
  topWicketTakers: [],
};

const renderInRouter = (element) => render(<MemoryRouter>{element}</MemoryRouter>);

describe("TournamentChampionHero", () => {
  it("shows the champion badge, logo, team link and runners-up line", () => {
    renderInRouter(
      <TournamentChampionHero tournament={tournament} overview={{ status: "completed" }} />,
    );

    const badge = screen.getByTestId("tournament-champion-badge");
    expect(badge).toHaveTextContent("Champions");
    expect(screen.getByRole("img", { name: "Sky Sports logo" })).toHaveAttribute("src", "/sky.png");
    expect(screen.getByRole("link", { name: "Sky Sports" })).toHaveAttribute("href", "/teams/team-sky");
    expect(badge).toHaveTextContent("Runners-up: Young Star");
  });

  it("hides unless the tournament is completed with a decided winner", () => {
    const { rerender } = renderInRouter(
      <TournamentChampionHero tournament={tournament} overview={{ status: "ongoing" }} />,
    );
    expect(screen.queryByTestId("tournament-champion-badge")).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <TournamentChampionHero
          tournament={{ ...tournament, winner: null }}
          overview={{ status: "completed" }}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("tournament-champion-badge")).not.toBeInTheDocument();
  });

  it("falls back to the winner's initials when the logo is missing", () => {
    renderInRouter(
      <TournamentChampionHero
        tournament={{ ...tournament, winner: { ...winner, logo: "" } }}
        overview={{ status: "completed" }}
      />,
    );

    expect(screen.getByLabelText("Sky Sports logo")).toHaveTextContent("SS");
  });
});

describe("TournamentChampionCard", () => {
  it("shows the champion, runners-up and links the Final result to its scorecard", () => {
    renderInRouter(
      <TournamentChampionCard
        tournament={tournament}
        overview={{ status: "completed" }}
        matches={[finalMatch]}
      />,
    );

    expect(screen.getByTestId("tournament-champion-card")).toHaveTextContent("Champions");
    expect(screen.getByRole("img", { name: "Sky Sports logo" })).toHaveAttribute("src", "/sky.png");
    expect(screen.getByRole("link", { name: "Sky Sports" })).toHaveAttribute("href", "/teams/team-sky");
    expect(screen.getByTestId("tournament-champion-card")).toHaveTextContent("Runners-up: Young Star");
    expect(
      screen.getByRole("link", { name: "Sky Sports won by 9 wickets (14 balls remaining)" }),
    ).toHaveAttribute("href", "/match/match-final");
  });

  it("hides when the winner has not been decided", () => {
    renderInRouter(
      <TournamentChampionCard
        tournament={{ ...tournament, winner: null }}
        overview={{ status: "completed" }}
        matches={[finalMatch]}
      />,
    );

    expect(screen.queryByTestId("tournament-champion-card")).not.toBeInTheDocument();
  });

  it("uses initials when the champion logo is missing", () => {
    renderInRouter(
      <TournamentChampionCard
        tournament={{ ...tournament, winner: { ...winner, logo: "" } }}
        overview={{ status: "completed" }}
        matches={[finalMatch]}
      />,
    );

    expect(screen.getByLabelText("Sky Sports logo")).toHaveTextContent("SS");
  });
});

describe("HomeTab champions and recent results", () => {
  it("places the Champions card above Tournament Awards on a completed tournament", () => {
    renderInRouter(
      <HomeTab
        tournament={tournament}
        content={{ overview: { status: "completed" } }}
        stats={awardsStats}
        matches={[finalMatch]}
      />,
    );

    const champions = screen.getByTestId("tournament-champion-card");
    const awards = screen.getByTestId("tournament-awards-showcase");
    expect(Boolean(champions.compareDocumentPosition(awards) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(champions).toHaveTextContent("Sky Sports won by 9 wickets (14 balls remaining)");
  });

  it("does not show the Champions card before the tournament is completed", () => {
    renderInRouter(
      <HomeTab
        tournament={tournament}
        content={{ overview: { status: "ongoing" } }}
        stats={awardsStats}
        matches={[finalMatch]}
      />,
    );

    expect(screen.queryByTestId("tournament-champion-card")).not.toBeInTheDocument();
  });

  it("shows initials for recent results instead of the first three letters", () => {
    renderInRouter(
      <HomeTab
        content={{ overview: {} }}
        matches={[
          {
            _id: "match-result",
            status: "completed",
            teams: [
              { _id: "team-young", name: "Young Star", shortName: "" },
              { _id: "team-sky", name: "Sky Sports", shortName: "" },
            ],
            result: { description: "Sky Sports won" },
          },
        ]}
      />,
    );

    expect(screen.getByText("YS vs SS")).toBeInTheDocument();
    expect(screen.queryByText("YOU vs SKY")).not.toBeInTheDocument();
  });
});

describe("teamShortName", () => {
  it("prefers a stored short name over the initials fallback", () => {
    expect(teamShortName({ name: "Young Star", shortName: "YST" })).toBe("YST");
    expect(teamShortName({ name: "Young Star", shortName: "" })).toBe("YS");
    expect(teamShortName({ name: "Sky Sports" })).toBe("SS");
  });
});
