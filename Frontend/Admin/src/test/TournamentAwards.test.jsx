import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// P4: an admin sets the end-of-tournament honours from the tournament's own
// teams and squads, and the panel posts exactly what was picked.

const { get, put, showToast } = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  showToast: vi.fn(),
}));
vi.mock("../services/api", () => ({ default: { get, put } }));
vi.mock("../components/Toast", () => ({ useToast: () => ({ showToast }) }));

import TournamentManagement from "../pages/Tournamentmanagement";

const TOURNAMENT = {
  _id: "t1",
  name: "OPENCODE_TEST Knockout Cup",
  type: "knockout",
  teams: [{ _id: "teamA", name: "Alpha CC" }, { _id: "teamB", name: "Beta CC" }],
  winner: { _id: "teamA", name: "Alpha CC" },
  runnerUp: { _id: "teamB", name: "Beta CC" },
  awards: { bestBowler: { _id: "p3", name: "Cleo" } },
};

const SQUADS = [
  { team: { _id: "teamA", name: "Alpha CC" }, players: [{ _id: "p1", name: "Ann" }, { _id: "p2", name: "Ben" }] },
  { team: { _id: "teamB", name: "Beta CC" }, players: [{ _id: "p3", name: "Cleo" }] },
];

const renderPage = () =>
  render(
    <MemoryRouter>
      <TournamentManagement />
    </MemoryRouter>
  );

const openAwards = async () => {
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: /^manage$/i }));
  fireEvent.click(await screen.findByRole("button", { name: /^awards$/i }));
  await screen.findByLabelText("Tournament champion");
};

const optionValues = (label) =>
  Array.from(screen.getByLabelText(label).querySelectorAll("option")).map((o) => o.value);

describe("TournamentManagement awards tab", () => {
  beforeEach(() => {
    get.mockReset();
    put.mockReset();
    showToast.mockReset();
    get.mockImplementation((url) => {
      if (url === "/tournaments") return Promise.resolve({ data: [TOURNAMENT] });
      if (url === "/teams") return Promise.resolve({ data: TOURNAMENT.teams });
      if (url === "/tournaments/t1") return Promise.resolve({ data: TOURNAMENT });
      if (url === "/tournaments/t1/fixtures") return Promise.resolve({ data: [] });
      if (url === "/tournaments/t1/squad") return Promise.resolve({ data: SQUADS });
      return Promise.resolve({ data: {} });
    });
    put.mockResolvedValue({ data: { message: "Tournament awards saved" } });
  });

  it("offers the tournament's teams and squad players", async () => {
    await openAwards();

    expect(optionValues("Tournament champion")).toEqual(["", "teamA", "teamB"]);
    expect(optionValues("Tournament runner-up")).toEqual(["", "teamA", "teamB"]);
    expect(optionValues("Best bowler")).toEqual(["", "p1", "p2", "p3"]);
    expect(get).toHaveBeenCalledWith("/tournaments/t1/squad");
  });

  it("seeds the form from the honours already saved", async () => {
    await openAwards();
    expect(screen.getByLabelText("Tournament champion").value).toBe("teamA");
    expect(screen.getByLabelText("Tournament runner-up").value).toBe("teamB");
    expect(screen.getByLabelText("Best bowler").value).toBe("p3");
    expect(screen.getByLabelText("Player of the tournament").value).toBe("");
  });

  it("posts the chosen honours and reloads the tournament", async () => {
    await openAwards();

    fireEvent.change(screen.getByLabelText("Player of the tournament"), { target: { value: "p1" } });
    fireEvent.change(screen.getByLabelText("Best batsman"), { target: { value: "p2" } });
    fireEvent.click(screen.getByRole("button", { name: /save awards/i }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const [url, body] = put.mock.calls[0];
    expect(url).toBe("/tournaments/t1/awards");
    expect(body).toEqual({
      winner: "teamA",
      runnerUp: "teamB",
      playerOfTournament: "p1",
      bestBatsman: "p2",
      bestBowler: "p3",
    });
    expect(showToast).toHaveBeenCalledWith("Tournament awards saved", "success");
    // A reload re-reads the tournament detail.
    expect(get.mock.calls.filter(([u]) => u === "/tournaments/t1").length).toBeGreaterThan(1);
  });

  it("shows the server's field error when a pick is refused", async () => {
    put.mockRejectedValue({ response: { data: { errors: { bestBatsman: "The player must be in one of this tournament's squads." } } } });
    await openAwards();

    fireEvent.click(screen.getByRole("button", { name: /save awards/i }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        "The player must be in one of this tournament's squads.",
        "error",
      )
    );
  });
});
