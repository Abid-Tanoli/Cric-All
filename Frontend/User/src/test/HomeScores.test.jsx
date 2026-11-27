import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import matchesReducer from "../store/slices/matchesSlice";
import { Home } from "../pages/Home";
import { inningsOfTeam } from "../utils/matchHelpers";
import { api } from "../services/api";

// Innings are stored in batting order; `teams` is the fixture order. Home used
// to pair teams[i] with innings[i], so when the second-listed side batted first
// its runs were printed next to the other team (production, 25 Nov 2026:
// "BAL 30/0" while Khan Associates were the side on 30/0).

vi.mock("../services/api", () => ({ api: { get: vi.fn() } }));
vi.mock("../services/socket", () => ({ initSocket: () => ({ on: vi.fn(), off: vi.fn() }) }));
vi.mock("../hooks/useCricketProviderStatus", () => ({
  useCricketProviderStatus: () => ({ configured: false }),
  isProviderConfigured: () => false,
}));
vi.mock("../components/Register", () => ({ default: () => null }));
vi.mock("../components/CreatePlayerProfile", () => ({ default: () => null }));
vi.mock("../components/BlogGallery", () => ({ default: () => null }));
vi.mock("../components/GlobalSearch", () => ({ default: () => null }));
vi.mock("../components/ads/AdSlot", () => ({ default: () => null }));

const baldia = { _id: "bal", name: "Baldia Zalmi", shortName: "BAL" };
const khan = { _id: "kha", name: "Khan Associates", shortName: "KHA" };

const liveMatch = {
  _id: "live-1",
  status: "live",
  matchType: "T20",
  startAt: new Date().toISOString(),
  teams: [baldia, khan],
  innings: [
    { team: khan, runs: 30, wickets: 0, overs: 2, balls: 12 },
    { team: baldia, runs: 0, wickets: 0, overs: 0, balls: 0 },
  ],
};

const renderHome = async (matches) => {
  api.get.mockImplementation((url) => Promise.resolve({ data: url === "/matches" ? matches : [] }));
  const store = configureStore({ reducer: { matches: matchesReducer } });
  render(
    <Provider store={store}>
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    </Provider>,
  );
  await waitFor(() => expect(store.getState().matches.status).toBe("succeeded"));
};

// Every row on the page that names this team, as "<name> <score>" text.
const rowsFor = (shortName) =>
  screen.getAllByText(shortName).map((el) => el.closest(".justify-between").textContent);

beforeEach(() => {
  localStorage.clear();
  api.get.mockReset();
});

describe("inningsOfTeam", () => {
  it("finds the innings by the team that batted it", () => {
    expect(inningsOfTeam(liveMatch, baldia, 0)).toBe(liveMatch.innings[1]);
    expect(inningsOfTeam(liveMatch, khan, 1)).toBe(liveMatch.innings[0]);
  });

  it("matches a team given only by id", () => {
    const match = { ...liveMatch, innings: [{ team: "kha", runs: 30 }, { team: "bal", runs: 0 }] };
    expect(inningsOfTeam(match, baldia, 0)).toBe(match.innings[1]);
  });

  it("uses the position only when the innings do not name a team", () => {
    const match = { teams: [baldia, khan], innings: [{ runs: 30 }, { runs: 0 }] };
    expect(inningsOfTeam(match, baldia, 0)).toBe(match.innings[0]);
  });

  it("returns nothing for a team that has not batted", () => {
    const match = { teams: [baldia, khan], innings: [{ team: khan, runs: 30 }] };
    expect(inningsOfTeam(match, baldia, 0)).toBeNull();
  });
});

describe("Home match scores", () => {
  it("prints each score next to the team that made it", async () => {
    await renderHome([liveMatch]);

    expect(rowsFor("KHA")).toEqual([expect.stringMatching(/30\/0$/)]);
    expect(rowsFor("BAL")).toEqual([expect.stringMatching(/(^|[^\d])0\/0$/)]);
  });

  it("does the same on the featured card", async () => {
    await renderHome([{ ...liveMatch, isFeatured: true }]);

    // Featured card and the live list each show the match once.
    expect(rowsFor("KHA")).toEqual([expect.stringMatching(/30\/0$/), expect.stringMatching(/30\/0$/)]);
    for (const row of rowsFor("BAL")) expect(row).not.toMatch(/30\/0/);
  });

  it("shows a dash for a team with no innings yet", async () => {
    await renderHome([{ ...liveMatch, innings: [liveMatch.innings[0]] }]);

    expect(rowsFor("BAL")).toEqual([expect.stringMatching(/-$/)]);
  });
});
