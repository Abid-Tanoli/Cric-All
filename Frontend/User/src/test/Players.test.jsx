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
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/players", { params: { limit: 100, team: "t1" } }));

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByDisplayValue("All Teams")).toBeInTheDocument();
    const sent = api.get.mock.calls.filter(([url]) => url === "/players");
    for (const [, options] of sent) {
      expect(Object.keys(options.params).map((key) => key.toLowerCase())).not.toContain("campus");
    }
    await screen.findByText(player.name);
  });
});
