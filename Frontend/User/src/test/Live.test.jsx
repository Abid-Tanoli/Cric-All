import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Live from "../pages/Live";
import { api } from "../services/api";

// Regression coverage for the public /live page.
//
// Live matches used to be looked up among the matches whose startAt is today, so
// a match that Home listed as LIVE disappeared here as soon as its start date was
// not the current day, and the page was left blank because the empty state only
// covered "the API returned no matches at all".

vi.mock("../services/api", () => ({ api: { get: vi.fn() } }));
vi.mock("../services/socket", () => ({ initSocket: () => ({ on: vi.fn(), off: vi.fn() }) }));
vi.mock("../components/LiveNavbar", () => ({ default: () => null }));
vi.mock("../components/cricapi/LiveMatchesSection", () => ({ default: () => null }));
vi.mock("../components/LocationFilters", () => ({
  default: () => null,
  locationQueryFromSearchParams: () => ({}),
}));

const daysFromNow = (days) => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString();
};

const baldia = { _id: "bal", name: "Baldia Zalmi", shortName: "BAL" };
const khan = { _id: "kha", name: "Khan Associates", shortName: "KHA" };

// Mirrors the production document: Khan Associates bat first, but they are
// teams[1], and tossWinner arrives populated.
const liveMatch = {
  _id: "live-1",
  status: "live",
  matchType: "T20",
  matchSubcategory: "",
  series: "",
  startAt: daysFromNow(-5),
  teams: [baldia, khan],
  innings: [
    { team: khan, runs: 30, wickets: 0, overs: 2, balls: 12 },
    { team: baldia, runs: 0, wickets: 0, overs: 0, balls: 0 },
  ],
  tossWinner: khan,
  tossDecision: "bat",
};

const oldResult = {
  _id: "done-1",
  status: "completed",
  startAt: daysFromNow(-30),
  teams: [baldia, khan],
  innings: [],
  result: { description: "Khan Associates won by 3 runs." },
};

const renderLive = (matches) => {
  api.get.mockResolvedValue({ data: matches });
  return render(<MemoryRouter><Live /></MemoryRouter>);
};

beforeEach(() => {
  api.get.mockReset();
});

describe("Live page", () => {
  it.each([["an earlier day", -5], ["today", 0], ["tomorrow", 1]])(
    "lists a live match scheduled for %s exactly once",
    async (_label, days) => {
      renderLive([{ ...liveMatch, startAt: daysFromNow(days) }, oldResult]);

      expect(await screen.findByRole("heading", { name: "Live Now" })).toBeInTheDocument();
      expect(screen.getAllByText("KHA")).toHaveLength(1);
      expect(screen.queryByRole("heading", { name: "Tomorrow" })).not.toBeInTheDocument();
      expect(screen.queryByText("See all matches")).not.toBeInTheDocument();
    },
  );

  it("lists a live match that has no start date", async () => {
    renderLive([{ ...liveMatch, startAt: null }]);
    expect(await screen.findByRole("heading", { name: "Live Now" })).toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
  });

  it.each(["in_progress", "innings-break", "innings_break", "super_over"])(
    "treats %s as a match in progress",
    async (status) => {
      renderLive([{ ...liveMatch, status }]);
      expect(await screen.findByRole("heading", { name: "Live Now" })).toBeInTheDocument();
    },
  );

  it("labels an innings break as a break, not as live play", async () => {
    renderLive([{ ...liveMatch, status: "innings-break" }]);
    expect(await screen.findByText("Innings Break")).toBeInTheDocument();
    expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
  });

  it("credits each innings to the team that batted it and names the toss winner", async () => {
    renderLive([liveMatch]);
    await screen.findByRole("heading", { name: "Live Now" });

    const row = (name) => screen.getByText(name).parentElement.parentElement;
    expect(within(row("KHA")).getByText(/30\/0/)).toBeInTheDocument();
    expect(within(row("BAL")).getByText(/^0\/0/)).toBeInTheDocument();
    expect(screen.getByText("Toss: KHA elected to bat")).toBeInTheDocument();
  });

  it("explains itself instead of rendering a blank page when nothing is current", async () => {
    renderLive([oldResult]);

    expect(await screen.findByText(/No live matches, recent results or upcoming fixtures/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See all matches" })).toHaveAttribute("href", "/");

    fireEvent.click(screen.getByRole("button", { name: "Live" }));
    expect(screen.getByText("No live matches right now")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Results" }));
    expect(screen.getByText("No results from yesterday")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Upcoming" }));
    expect(screen.getByText("No matches scheduled for today or tomorrow")).toBeInTheDocument();
  });

  it("keeps the general empty state when there are no matches at all", async () => {
    renderLive([]);
    expect(await screen.findByText("No matches available")).toBeInTheDocument();
  });
});
