import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// The component reads the live match through the shared axios instance and
// shows a toast on success; both are mocked so the wording can be asserted.
const { get, showToast } = vi.hoisted(() => ({ get: vi.fn(), showToast: vi.fn() }));
vi.mock("../services/api", () => ({ default: { get } }));
vi.mock("../components/Toast", () => ({ useToast: () => ({ showToast }) }));

import ImpactPlayerSetup from "../components/ScoreManagement/ImpactPlayerSetup";

const teamA = {
  _id: "t1",
  name: "Team A",
  players: [
    { _id: "p1", name: "Alice" },
    { _id: "p2", name: "Bob" },
  ],
};
const teamB = { _id: "t2", name: "Team B", players: [] };

const match = {
  _id: "m1",
  teams: [teamA, teamB],
  playingXI: [{ team: "t1", players: [{ _id: "p1", name: "Alice" }] }],
  twelfthMan: [{ team: "t1", player: { _id: "p2", name: "Bob" } }],
  impactPlayers: [
    { team: "t1", player: { _id: "p2", name: "Bob" }, replaces: { _id: "p1", name: "Alice" } },
  ],
};

const fullSquad = Array.from({ length: 19 }, (_, index) => ({
  _id: `p${index + 1}`,
  name: `Player ${index + 1}`,
}));
const squads = {
  teams: [{ team: "t1", squad: fullSquad }],
};

beforeEach(() => {
  get.mockReset();
  get.mockImplementation((url) => ({
    data: url.endsWith("/squads") ? squads : match,
  }));
});

describe("12th Man setup wording", () => {
  it("says 12th Man and never the IPL 'Impact player' label", async () => {
    render(<ImpactPlayerSetup match={match} matchId="m1" />);

    await screen.findByText(/12th Man used/);
    expect(screen.getByText(/12th Man Bob replaced Alice/)).toBeInTheDocument();
    expect(screen.queryByText(/impact player/i)).toBeNull();
  });

  it("labels 12th Man candidates with their batting position", async () => {
    get.mockImplementation((url) => ({
      data: url.endsWith("/squads")
        ? {
            teams: [{
              team: "t1",
              squad: [
                { _id: "p1", name: "Alice", playingRole: "Batsman" },
                { _id: "p2", name: "Bob", playingRole: "Bowler", battingPosition: "middle_order" },
                { _id: "p3", name: "Cara", playingRole: "Batsman" },
              ],
            }],
          }
        : {
            ...match,
            twelfthMan: [],
            impactPlayers: [],
          },
    }));

    render(
      <ImpactPlayerSetup
        match={match}
        matchId="m1"
      />
    );

    const select = await screen.findByLabelText("Team A 12th man");
    const labels = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(labels).toContain("Bob — Middle Order");
    expect(labels).toContain("Cara");
    expect(labels.some((label) => label.includes("Alice"))).toBe(false);
  });

  it("uses the full squad for a nominated 12th Man outside the capped team roster", async () => {
    const xi = fullSquad.slice(0, 11);
    const nominated = fullSquad[11];
    get.mockImplementation((url) => ({
      data: url.endsWith("/squads")
        ? squads
        : {
            ...match,
            playingXI: [{ team: "t1", players: xi }],
            twelfthMan: [{ team: "t1", player: nominated }],
            impactPlayers: [],
          },
    }));

    render(<ImpactPlayerSetup match={match} matchId="m1" />);

    const select = await screen.findByLabelText("Team A 12th man");
    const labels = Array.from(select.querySelectorAll("option")).map((option) => option.textContent);
    expect(labels).toContain("Player 19");
    expect(labels).not.toContain("Player 1");
    expect(select.value).toBe(nominated._id);
    expect(await screen.findByRole("button", { name: "Apply 12th Man" })).toBeInTheDocument();
  });

  it("does not fall back to the capped team roster when the full squad cannot load", async () => {
    get.mockImplementation((url) => (
      url.endsWith("/squads")
        ? Promise.reject(new Error("Squad service unavailable"))
        : Promise.resolve({
            data: {
              ...match,
              playingXI: [{ team: "t1", players: fullSquad.slice(0, 11) }],
              twelfthMan: [],
              impactPlayers: [],
            },
          })
    ));

    render(<ImpactPlayerSetup match={match} matchId="m1" />);

    expect(await screen.findByText("Squad service unavailable")).toBeInTheDocument();
    expect(screen.queryByLabelText("Team A 12th man")).not.toBeInTheDocument();
  });
});
