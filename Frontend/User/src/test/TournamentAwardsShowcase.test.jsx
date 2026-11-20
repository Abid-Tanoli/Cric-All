import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TournamentAwardsShowcase from "../components/TournamentAwardsShowcase";
import HomeTab from "../pages/tournament/tabs/HomeTab";
import PlayerOfTournament from "../pages/tournament/tabs/PlayerOfTournament";

const officialAwards = {
  topPlayers: [
    { playerId: "wajid", name: "Wajid", team: "Sky Sports", imageUrl: "/wajid.jpg", position: 1 },
  ],
  playerOfTournament: {
    playerId: "wajid",
    name: "Wajid",
    team: "Sky Sports",
    imageUrl: "/wajid.jpg",
    stats: { matches: 4, runs: 112, wickets: 5 },
  },
  bestBatsman: {
    playerId: "ijaz",
    name: "Ijaz Koistani",
    team: "Young Star",
    imageUrl: "/ijaz.jpg",
    stats: { runs: 94, highest: "61*", strikeRate: 147.5 },
  },
  bestBowler: {
    playerId: "usman",
    name: "Usman Masood",
    team: "Young Star",
    imageUrl: "/usman.jpg",
    stats: { wickets: 9, economy: 6.1, bestFigures: "4/18" },
  },
};

const baseStats = {
  officialAwards,
  playerOfTournament: {
    rows: [{ playerId: "wajid", name: "Wajid", team: "Sky Sports", matches: 4, runs: 112, wickets: 5, impact: 210 }],
    leader: { playerId: "wajid", name: "Wajid", team: "Sky Sports", matches: 4, runs: 112, wickets: 5, impact: 210 },
    explanation: [],
  },
  topRunScorers: [],
  topWicketTakers: [],
};

const renderInRouter = (element) => render(<MemoryRouter>{element}</MemoryRouter>);

describe("TournamentAwardsShowcase", () => {
  it("renders all official awards with real summaries, photos, and profile links", () => {
    renderInRouter(<TournamentAwardsShowcase stats={baseStats} />);

    expect(screen.getByTestId("award-card-playerOfTournament")).toHaveTextContent("Official award");
    expect(screen.getByTestId("award-card-playerOfTournament")).toHaveTextContent("4 matches · 112 runs · 5 wickets");
    expect(screen.getByTestId("award-card-bestBatsman")).toHaveTextContent("94 runs · High score 61* · SR 147.5");
    expect(screen.getByTestId("award-card-bestBowler")).toHaveTextContent("9 wickets · Econ 6.1 · Best 4/18");
    expect(screen.getByTestId("award-card-playerOfTournament")).toHaveAttribute("href", "/players/wajid");
    expect(screen.getByAltText("Wajid")).toHaveAttribute("src", "/wajid.jpg");
    expect(screen.getAllByText("Official award")).toHaveLength(3);
  });

  it("renders citations, fielder/emerging honours and custom awards when published", () => {
    const stats = {
      ...baseStats,
      officialAwards: {
        ...officialAwards,
        published: true,
        bestFielder: {
          playerId: "f1",
          name: "Finn",
          team: "Sky Sports",
          stats: { catches: 8, stumpings: 2, runOuts: 1 },
        },
        emergingPlayer: {
          playerId: "e1",
          name: "Elena",
          team: "Young Star",
          stats: { matches: 5, runs: 210, wickets: 7 },
        },
        citations: {
          playerOfTournament: "Match-winning impact in every phase",
          bestBatsman: "612 runs at 51 average",
          bestBowler: "23 wickets",
          bestFielder: "Eight catches behind the stumps",
          emergingPlayer: "Seven wickets on debut",
        },
        customAwards: [
          {
            title: "Best Catch",
            playerId: "c1",
            name: "Cleo",
            team: "Club C",
            citation: "Final overhead catch",
          },
        ],
        note: "Presented at the final ceremony",
      },
    };

    renderInRouter(<TournamentAwardsShowcase stats={stats} />);

    const fielder = screen.getByTestId("award-card-bestFielder");
    expect(fielder).toHaveTextContent("Best Fielder / Wicketkeeper");
    expect(fielder).toHaveTextContent("8 catches · 2 stumpings · 1 run outs");
    expect(fielder).toHaveTextContent("Eight catches behind the stumps");

    const emerging = screen.getByTestId("award-card-emergingPlayer");
    expect(emerging).toHaveTextContent("5 matches · 210 runs · 7 wickets");
    expect(emerging).toHaveTextContent("Seven wickets on debut");

    const custom = screen.getByTestId("award-card-custom-1");
    expect(custom).toHaveTextContent("Best Catch");
    expect(custom).toHaveTextContent("Cleo");
    expect(custom).toHaveTextContent("Final overhead catch");
    expect(screen.getByText("Presented at the final ceremony")).toBeInTheDocument();
  });

  it("hides official honours when they are unpublished or the tournament is not completed", () => {
    const { rerender } = renderInRouter(
      <TournamentAwardsShowcase
        stats={{
          ...baseStats,
          officialAwards: { ...officialAwards, published: false },
          topRunScorers: [],
          topWicketTakers: [],
        }}
      />,
    );
    expect(screen.queryByTestId("tournament-awards-showcase")).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <TournamentAwardsShowcase
          stats={{
            ...baseStats,
            publicStatus: "upcoming",
            officialAwards: { ...officialAwards, published: true },
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("award-card-playerOfTournament")).not.toBeInTheDocument();
    expect(screen.queryByTestId("award-card-bestBatsman")).not.toBeInTheDocument();
  });

  it("uses derived discipline leaders when official picks are absent", () => {
    renderInRouter(
      <TournamentAwardsShowcase
        stats={{
          officialAwards: {},
          playerOfTournament: {
            rows: [],
            leader: null,
          },
          topRunScorers: [{ playerId: "batter", name: "A Batter", team: "Club A", runs: 75, highestText: "51*", strikeRate: 125 }],
          topWicketTakers: [{ playerId: "bowler", name: "A Bowler", team: "Club B", wickets: 6, economy: 5.2, bestFigures: "3/12" }],
        }}
        showDerived
      />,
    );

    expect(screen.queryByTestId("award-card-playerOfTournament")).not.toBeInTheDocument();
    expect(screen.getByTestId("award-card-bestBatsman")).toHaveTextContent("Top by stats");
    expect(screen.getByTestId("award-card-bestBatsman")).toHaveTextContent("High score 51*");
    expect(screen.getByTestId("award-card-bestBowler")).toHaveTextContent("6 wickets · Econ 5.2 · Best 3/12");
  });

  it("hides unset awards when no computed leader exists and uses initials without photos", () => {
    const { rerender } = renderInRouter(
      <TournamentAwardsShowcase
        stats={{ officialAwards: {}, playerOfTournament: { rows: [] }, topRunScorers: [], topWicketTakers: [] }}
        showDerived
      />,
    );
    expect(screen.queryByTestId("tournament-awards-showcase")).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <TournamentAwardsShowcase
          stats={{
            officialAwards: {
              ...officialAwards,
              bestBatsman: null,
              bestBowler: null,
              topPlayers: [],
              playerOfTournament: { ...officialAwards.playerOfTournament, imageUrl: "" },
            },
            playerOfTournament: { rows: [] },
            topRunScorers: [],
            topWicketTakers: [],
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("Wajid avatar")).toHaveTextContent("W");
  });

  it("shows awards on the completed overview and before the impact podium", () => {
    const stats = { ...baseStats, topRunScorers: [], topWicketTakers: [] };
    const overview = renderInRouter(
      <HomeTab stats={stats} content={{ overview: { status: "completed" } }} matches={[]} />,
    );
    expect(screen.getByTestId("tournament-awards-showcase")).toBeInTheDocument();
    overview.unmount();

    const upcoming = renderInRouter(
      <HomeTab
        stats={{
          officialAwards: { bestBowler: officialAwards.bestBowler },
          playerOfTournament: { rows: [] },
          topRunScorers: [],
          topWicketTakers: [],
        }}
        content={{ overview: { status: "upcoming" } }}
        matches={[]}
      />,
    );
    expect(screen.getByTestId("award-card-bestBowler")).toBeInTheDocument();
    expect(screen.queryByTestId("award-card-playerOfTournament")).not.toBeInTheDocument();
    upcoming.unmount();

    renderInRouter(
      <PlayerOfTournament
        data={{ rows: baseStats.playerOfTournament.rows, leader: baseStats.playerOfTournament.leader }}
        officialAwards={officialAwards}
        stats={baseStats}
      />,
    );
    const showcase = screen.getByTestId("tournament-awards-showcase");
    const podium = screen.getByTestId("tournament-podium");
    expect(Boolean(showcase.compareDocumentPosition(podium) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(showcase.querySelector('[data-testid="award-card-playerOfTournament"]')?.textContent).toContain("Wajid");
    expect(podium.querySelector('[data-testid="podium-place-1"]')?.textContent).toContain("Wajid");
  });

  it("falls back to the computed podium when official awards are unpublished", () => {
    renderInRouter(
      <PlayerOfTournament
        data={{ rows: baseStats.playerOfTournament.rows, leader: baseStats.playerOfTournament.leader }}
        officialAwards={{ ...officialAwards, published: false }}
        stats={{ ...baseStats, publicStatus: "completed" }}
      />,
    );

    expect(screen.queryByText("Official Top 3")).not.toBeInTheDocument();
    expect(screen.getByText("Top 3 by impact points")).toBeInTheDocument();
  });
});