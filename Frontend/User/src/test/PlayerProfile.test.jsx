import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PlayerProfile from "../pages/PlayerProfile";
import { api } from "../services/api";

vi.mock("../services/api", () => ({ api: { get: vi.fn() } }));
vi.mock("../config/features", () => ({ featureFlags: () => ({ comparison: false }) }));
vi.mock("../community/CommunityConfigContext", () => ({
  useCommunityConfig: () => ({ enabled: false }),
}));
vi.mock("../community/PostsTab", () => ({ default: () => null }));
vi.mock("../community/ShareMenu", () => ({ default: () => null }));

describe("player profile stats and identity", () => {
  beforeEach(() => {
    api.get.mockImplementation(async (path) => {
      if (path === "/players/player-1") {
        return {
          data: {
            _id: "player-1",
            name: "Profile Player",
            playingRole: "All-rounder",
            battingPosition: "opener",
            team: { _id: "team-1", name: "Latest Team" },
            stats: {
              statsSource: "matches",
              matches: 3,
              innings: 2,
              notOuts: 1,
              runs: 54,
              highScore: 42,
              average: 54,
              strikeRate: 120,
              fours: 6,
              sixes: 2,
              wickets: 2,
              bowlingInnings: 1,
              balls: 12,
              runsConceded: 18,
              economy: 9,
            },
          },
        };
      }
      if (path === "/players/player-1/matches") {
        return {
          data: {
            totalMatches: 3,
            matches: [{
              _id: "match-1",
              title: "Latest Team vs Opponents",
              teamId: "team-1",
              team: "Latest Team",
              teamLogo: "",
              opposition: { _id: "team-2", name: "Opponents" },
              resultForPlayer: "W",
              batting: { runs: 42, balls: 30, ballsFaced: 30, strikeRate: 140 },
              bowling: { wickets: 2, balls: 12, runs: 18, economy: 9 },
              fielding: { catches: 0, stumpings: 0, runOuts: 0, total: 0 },
            }],
          },
        };
      }
      throw new Error(`Unexpected API request: ${path}`);
    });
  });

  it("renders derived career figures and keeps role and batting-position badges", async () => {
    render(
      <MemoryRouter initialEntries={["/players/player-1"]}>
        <Routes>
          <Route path="/players/:playerId" element={<PlayerProfile />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Profile Player")).toBeInTheDocument();
    expect(screen.getByText("All-rounder")).toBeInTheDocument();
    expect(screen.getByTestId("batting-position-badge")).toHaveTextContent("Opener");
    expect(screen.getAllByText("54").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Batting" }));
    await waitFor(() => expect(screen.getByText("Detailed Batting Stats")).toBeInTheDocument());
    expect(screen.getByText("Overall")).toBeInTheDocument();
    expect(screen.getAllByText("54").length).toBeGreaterThan(0);
  });
});
