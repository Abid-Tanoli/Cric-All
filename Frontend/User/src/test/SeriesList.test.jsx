import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SeriesList from "../pages/SeriesList";
import { api } from "../services/api";

// Regression coverage for the public /series board.
//
// The page used to fetch /tournaments only when /events returned an empty
// array, so the first local event made every tournament disappear from the
// board even though /series/:id still worked. These tests keep both collections
// in the fixture: the tournament must render alongside the event, its derived
// "ongoing" status must show as "in progress", and the status tabs must filter
// on that derived value.

vi.mock("../services/api", () => ({ api: { get: vi.fn() } }));

const ONGOING_ID = "tournament-ongoing";
const COMPLETED_ID = "tournament-completed";
const EVENT_ID = "event-series";

const localEvent = {
  _id: EVENT_ID,
  name: "Community Cup",
  slug: "community-cup",
  eventType: "series",
  status: "upcoming",
  teams: [],
  matches: [],
};

const ongoingTournament = {
  _id: ONGOING_ID,
  name: "All Baldia T20 Hard Ball Cricket Tournament",
  slug: "all-baldia-t20-hard-ball",
  type: "knockout",
  status: "upcoming",
  publicStatus: "ongoing",
  teams: [],
  matches: [],
};

const completedTournament = {
  _id: COMPLETED_ID,
  name: "Baldia Champions Cup",
  slug: "baldia-champions-cup",
  type: "knockout",
  status: "completed",
  publicStatus: "completed",
  teams: [],
  matches: [],
  winner: { _id: "team-sky", name: "Sky Sports", shortName: "" },
  runnerUp: { _id: "team-young", name: "Young Star", shortName: "" },
};

function mockApi() {
  api.get.mockImplementation((url) => {
    if (url === "/events") return Promise.resolve({ data: [localEvent] });
    if (url === "/tournaments") return Promise.resolve({ data: [ongoingTournament, completedTournament] });
    if (url === "/international/series") return Promise.resolve({ data: { data: [] } });
    if (url === "/international/status") return Promise.resolve({ data: { data: null } });
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
}

const renderPage = () => render(
  <MemoryRouter>
    <SeriesList />
  </MemoryRouter>,
);

beforeEach(() => {
  api.get.mockReset();
  mockApi();
});

describe("SeriesList local events and tournaments", () => {
  it("loads tournaments even when /events is not empty", async () => {
    renderPage();

    expect(await screen.findByText(ongoingTournament.name)).toBeInTheDocument();
    expect(screen.getByText(localEvent.name)).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("/tournaments", expect.objectContaining({
      params: { limit: 100 },
    }));
  });

  it("shows the derived ongoing status as in progress", async () => {
    renderPage();

    expect(await screen.findByTestId(`local-status-${ONGOING_ID}`)).toHaveTextContent("in progress");
    expect(screen.getByTestId(`local-status-${COMPLETED_ID}`)).toHaveTextContent("completed");
  });

  it("shows the champion on a completed tournament card", async () => {
    renderPage();

    await screen.findByText(completedTournament.name);
    expect(screen.getByTestId(`local-champion-${COMPLETED_ID}`)).toHaveTextContent("Champions: Sky Sports");
    expect(screen.queryByTestId(`local-champion-${ONGOING_ID}`)).not.toBeInTheDocument();
  });

  it("filters by status and restores both collections under All", async () => {
    renderPage();

    await screen.findByText(ongoingTournament.name);

    fireEvent.click(screen.getByRole("button", { name: "Status: Completed" }));
    expect(screen.getByText(completedTournament.name)).toBeInTheDocument();
    expect(screen.queryByText(ongoingTournament.name)).not.toBeInTheDocument();
    expect(screen.queryByText(localEvent.name)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Status: In Progress" }));
    expect(screen.getByText(ongoingTournament.name)).toBeInTheDocument();
    expect(screen.queryByText(completedTournament.name)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Status: All" }));
    expect(screen.getByText(ongoingTournament.name)).toBeInTheDocument();
    expect(screen.getByText(completedTournament.name)).toBeInTheDocument();
    expect(screen.getByText(localEvent.name)).toBeInTheDocument();
  });

  it("treats tournament documents as the existing tournament type filter", async () => {
    renderPage();

    await screen.findByText(ongoingTournament.name);

    fireEvent.click(screen.getByRole("button", { name: /^tournament \(\d+\)$/i }));
    expect(screen.getByText(ongoingTournament.name)).toBeInTheDocument();
    expect(screen.getByText(completedTournament.name)).toBeInTheDocument();
    expect(screen.queryByText(localEvent.name)).not.toBeInTheDocument();
  });
});
