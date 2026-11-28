import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Players from "../pages/Players";
import { api } from "../services/api";

vi.mock("../services/api", () => ({ api: { get: vi.fn() } }));
vi.mock("../components/LocationFilters", () => ({
  default: () => null,
  locationQueryFromSearchParams: () => ({}),
}));

const player = { _id: "p1", name: "Imran Baloch", role: "Batsman" };

beforeEach(() => {
  api.get.mockReset();
  api.get.mockImplementation((url) => {
    if (url === "/teams") return Promise.resolve({ data: [{ _id: "t1", name: "Khan Associates" }] });
    if (url === "/players") return Promise.resolve({ data: { players: [player] } });
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
});

const renderPage = () => render(<MemoryRouter><Players /></MemoryRouter>);

describe("Players directory copy", () => {
  it("uses neutral player and team wording", async () => {
    const { container } = renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "Players" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "All Teams" })).toBeInTheDocument();
    expect(await screen.findByText(player.name)).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/scouter|franchise|personnel|legends/i);
    expect(screen.queryByPlaceholderText(/scouts/i)).not.toBeInTheDocument();
  });

  it("says no players were found when the search matches nobody", async () => {
    renderPage();
    await screen.findByText(player.name);

    fireEvent.change(screen.getByPlaceholderText("Search players by name..."), { target: { value: "zzz" } });
    expect(screen.getByText("No Players Found")).toBeInTheDocument();
  });

  it("has no campus filter and never sends a campus parameter", async () => {
    renderPage();
    await screen.findByText(player.name);

    expect(screen.queryByText(/campus/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("All Teams"), { target: { value: "t1" } });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/players", { params: { limit: 100, team: "t1", page: 1 } }));

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByDisplayValue("All Teams")).toBeInTheDocument();
    const sent = api.get.mock.calls.filter(([url]) => url === "/players");
    for (const [, options] of sent) {
      expect(Object.keys(options.params).map((key) => key.toLowerCase())).not.toContain("campus");
    }
    await screen.findByText(player.name);
  });
});

// B11: the API pages at 100, and the directory never asked for page 2; the role
// filter read the legacy `role` text instead of `playingRole`.
describe("Players directory paging and role filter", () => {
  const many = Array.from({ length: 126 }, (_, i) => ({ _id: `p${i + 1}`, name: `Player ${i + 1}`, playingRole: "Batsman" }));

  it("loads every page, so all 126 players are listed", async () => {
    api.get.mockImplementation((url, options) => {
      if (url === "/teams") return Promise.resolve({ data: [] });
      const page = options.params.page;
      const slice = page === 1 ? many.slice(0, 100) : many.slice(100);
      return Promise.resolve({ data: { players: slice, totalPlayers: 126, totalPages: 2, currentPage: page } });
    });
    renderPage();

    expect(await screen.findByText("Player 126")).toBeInTheDocument();
    expect(screen.getByText("Player 1")).toBeInTheDocument();
    expect(screen.getAllByText(/^Player \d+$/)).toHaveLength(126);
    const pages = api.get.mock.calls.filter(([url]) => url === "/players").map(([, o]) => o.params.page);
    expect(pages).toEqual([1, 2]);
  });

  it("filters on playingRole, falls back to the legacy role, and groups all-rounders", async () => {
    const roster = [
      { _id: "a", name: "Opener", playingRole: "Batsman" },
      { _id: "b", name: "Quick", playingRole: "Bowler" },
      { _id: "c", name: "Bat First All-Rounder", playingRole: "Batting-All-Rounder" },
      { _id: "d", name: "Old Record Spinner", role: "Bowler" },
    ];
    api.get.mockImplementation((url) => {
      if (url === "/teams") return Promise.resolve({ data: [] });
      return Promise.resolve({ data: { players: roster, totalPages: 1 } });
    });
    renderPage();
    await screen.findByText("Opener");
    const roleSelect = screen.getByDisplayValue("All Roles");

    fireEvent.change(roleSelect, { target: { value: "Bowler" } });
    expect(screen.getByText("Quick")).toBeInTheDocument();
    expect(screen.getByText("Old Record Spinner")).toBeInTheDocument();
    expect(screen.queryByText("Opener")).not.toBeInTheDocument();

    fireEvent.change(roleSelect, { target: { value: "All-Rounder" } });
    expect(screen.getByText("Bat First All-Rounder")).toBeInTheDocument();
    expect(screen.queryByText("Quick")).not.toBeInTheDocument();
    expect(screen.getByText("Batting-All-Rounder")).toBeInTheDocument(); // the card shows playingRole
  });
});
