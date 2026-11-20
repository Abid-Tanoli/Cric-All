import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Overlay from "../pages/Overlay";
import { api } from "../services/api";

vi.mock("../services/api", () => ({ api: { get: vi.fn() } }));

const socketOn = vi.fn();
const socketOff = vi.fn();
vi.mock("../services/socket", () => ({
  initSocket: () => ({ on: socketOn, off: socketOff }),
  joinMatchRoom: vi.fn(),
  leaveMatchRoom: vi.fn(),
}));

function renderOverlay(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/overlay/:matchId" element={<Overlay />} />
      </Routes>
    </MemoryRouter>
  );
}

const teamA = { _id: "t1", name: "Alpha Cricket Club", shortName: "ALP", logo: "https://img.test/a.png" };
const teamB = { _id: "t2", name: "Beta Cricket Club", shortName: "BET", logo: "https://img.test/b.png" };
const striker = { _id: "p1", name: "Rana Striker" };
const nonStriker = { _id: "p2", name: "Naveed Non" };
const bowler = { _id: "p3", name: "Bilal Bowler" };

const liveMatch = {
  _id: "m1",
  status: "live",
  currentInnings: 1,
  teams: [teamA, teamB],
  innings: [
    { team: teamA, runs: 150, wickets: 6, balls: 120, overs: 20, batting: [], bowling: [], oversHistory: [] },
    {
      team: teamB,
      runs: 88,
      wickets: 2,
      balls: 60,
      overs: 10,
      target: 151,
      requiredRunRate: 6.3,
      currentBatsman1: striker,
      currentBatsman2: nonStriker,
      onStrikeBatsman: striker,
      currentBowler: bowler,
      batting: [
        { player: striker, runs: 41, balls: 28, isOut: false },
        { player: nonStriker, runs: 22, balls: 18, isOut: false },
      ],
      bowling: [{ player: bowler, wickets: 1, runs: 24, balls: 24, overs: 4 }],
      oversHistory: [
        {
          overNumber: 9,
          balls: [
            { ballNumber: 1, runs: 1 },
            { ballNumber: 2, runs: 0 },
            { ballNumber: 3, runs: 4 },
            { ballNumber: 4, runs: 0 },
            { ballNumber: 5, runs: 6 },
            { ballNumber: 6, isWicket: true, wicketType: "bowled", runs: 0 },
          ],
        },
      ],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  document.documentElement.style.background = "";
  document.body.style.background = "";
});

describe("Overlay page", () => {
  it("shows loading then renders live scoreboard data", async () => {
    api.get.mockResolvedValueOnce({ data: liveMatch });
    renderOverlay("/overlay/m1");

    expect(screen.getByText("Loading live overlay…")).toBeInTheDocument();

    expect(await screen.findByText("ALP")).toBeInTheDocument();
    expect(screen.getByText("BET")).toBeInTheDocument();
    expect(screen.getByText(/150\/6/)).toBeInTheDocument();
    expect(screen.getByText(/88\/2/)).toBeInTheDocument();
    expect(screen.getByText(/Target 151/)).toBeInTheDocument();
    expect(screen.getByText(/Need 63/)).toBeInTheDocument();
    expect(screen.getByText(/Rana Striker\*/)).toBeInTheDocument();
    expect(screen.getByText(/Naveed Non/)).toBeInTheDocument();
    expect(screen.getByText(/Bilal Bowler/)).toBeInTheDocument();
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(screen.getByText("Last 6")).toBeInTheDocument();
    expect(screen.getByText("W")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
  });

  it("shows not found for a missing match", async () => {
    api.get.mockRejectedValueOnce({ response: { status: 404 } });
    renderOverlay("/overlay/missing");

    expect(await screen.findByText("Match not found")).toBeInTheDocument();
  });

  it("shows completed state and result gracefully", async () => {
    api.get.mockResolvedValueOnce({
      data: {
        ...liveMatch,
        status: "completed",
        result: { description: "Alpha Cricket Club won by 12 runs" },
      },
    });
    renderOverlay("/overlay/m1");

    expect(await screen.findByText("FINAL")).toBeInTheDocument();
    expect(screen.getByText("Alpha Cricket Club won by 12 runs")).toBeInTheDocument();
  });

  it("applies theme/position/scale params and ignores invalid values", async () => {
    api.get.mockResolvedValueOnce({ data: liveMatch });
    renderOverlay("/overlay/m1?theme=light&position=top&scale=2&foo=bar&theme=neon");

    expect(await screen.findByText("ALP")).toBeInTheDocument();
    expect(document.body.style.background).toBe("transparent");
    // no crash with invalid/extra params and UI still renders
    expect(screen.getByText(/Target 151/)).toBeInTheDocument();
  });

  it("hides requested sections from a validated hide list", async () => {
    api.get.mockResolvedValueOnce({ data: liveMatch });
    renderOverlay("/overlay/m1?hide=target,bowler,balls,unknown");

    expect(await screen.findByText("ALP")).toBeInTheDocument();
    expect(screen.getByText(/Rana Striker\*/)).toBeInTheDocument();
    expect(screen.queryByText(/Target 151/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Bilal Bowler/)).not.toBeInTheDocument();
    expect(screen.queryByText("Last 6")).not.toBeInTheDocument();
  });
});