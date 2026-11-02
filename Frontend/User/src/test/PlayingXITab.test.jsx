import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PlayingXITab from "../components/PlayingXITab";
import MatchInfoTab from "../components/MatchInfoTab";

const squadA = Array.from({ length: 19 }, (_, index) => ({
  _id: `a${index + 1}`,
  name: `Sky Player ${index + 1}`,
  playingRole: "Batsman",
}));
const squadB = Array.from({ length: 19 }, (_, index) => ({
  _id: `b${index + 1}`,
  name: `Star Player ${index + 1}`,
  playingRole: "Bowler",
}));

const teamA = { _id: "team-a", name: "Sky Sports" };
const teamB = { _id: "team-b", name: "Young Star" };

const squads = {
  teams: [
    { team: teamA, squad: squadA, squadSource: "tournament", squadSize: 19 },
    { team: teamB, squad: squadB, squadSource: "tournament", squadSize: 19 },
  ],
};

const upcomingMatch = {
  _id: "match-1",
  status: "upcoming",
  teams: [teamA, teamB],
  playingXI: [],
  twelfthMan: [],
  innings: [{ team: "team-a", status: "upcoming" }],
  currentInnings: 0,
};

describe("public Playing XI tab", () => {
  it("shows the full squad and 'Playing XI not announced' until an XI is saved", () => {
    render(<PlayingXITab match={upcomingMatch} players={[]} squads={squads} />);

    expect(screen.getAllByText("Squad").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Playing XI not announced").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/19 players/)).toHaveLength(2);
    expect(screen.getByText("Sky Player 19")).toBeInTheDocument();
    expect(screen.getByText("Star Player 19")).toBeInTheDocument();
    expect(screen.queryByText(/batting now/i)).toBeNull();
  });

  it("never renders an invented 11-player sheet from the short roster", () => {
    render(<PlayingXITab match={upcomingMatch} players={[]} squads={null} />);

    expect(screen.getAllByText("Playing XI not announced").length).toBeGreaterThan(0);
    expect(screen.queryByText("Player 1")).toBeNull();
    expect(screen.queryByText(/^Player \d+$/)).toBeNull();
  });

  it("treats a partial historical XI as unannounced in both public tabs", () => {
    const partialXI = [{ team: "team-a", players: squadA.slice(0, 10) }];
    const match = { ...upcomingMatch, playingXI: partialXI };
    const { rerender } = render(<PlayingXITab match={match} players={[]} squads={squads} />);
    expect(screen.getAllByText("Playing XI not announced").length).toBeGreaterThan(0);
    expect(screen.getByText("Sky Player 19")).toBeInTheDocument();

    rerender(<MatchInfoTab match={match} />);
    expect(screen.getByText("Sky Sports Squad")).toBeInTheDocument();
    expect(screen.getAllByText("Playing XI not announced")).toHaveLength(2);
  });

  it("does not label a team 'batting now' before the match is live", () => {
    const savedXI = [{ team: "team-a", players: squadA.slice(0, 11) }];
    render(
      <PlayingXITab
        match={{ ...upcomingMatch, playingXI: savedXI }}
        players={[]}
        squads={squads}
      />
    );

    expect(screen.getAllByText("Playing XI").length).toBeGreaterThan(0);
    expect(screen.queryByText(/batting now/i)).toBeNull();
  });

  it("shows 'batting now' only once the match is live or completed", () => {
    const savedXI = [
      { team: "team-a", players: squadA.slice(0, 11) },
      { team: "team-b", players: squadB.slice(0, 11) },
    ];
    render(
      <PlayingXITab
        match={{ ...upcomingMatch, status: "live", playingXI: savedXI }}
        players={[]}
        squads={squads}
      />
    );

    expect(screen.getByText(/batting now/i)).toBeInTheDocument();
  });
});
