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

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({ data: match });
});

describe("12th Man setup wording", () => {
  it("says 12th Man and never the IPL 'Impact player' label", async () => {
    render(<ImpactPlayerSetup match={match} matchId="m1" />);

    await screen.findByText(/12th Man used/);
    expect(screen.getByText(/12th Man Bob replaced Alice/)).toBeInTheDocument();
    expect(screen.queryByText(/impact player/i)).toBeNull();
  });
});
