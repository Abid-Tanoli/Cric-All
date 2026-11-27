import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { teamOfInnings } from "../utils/matchHelpers";
import SummaryTab from "../components/SummaryTab";
import MatchSummaryCard from "../components/MatchSummaryCard";
import Summary from "../pages/Summary";
import Series from "../pages/Series";
import { api } from "../services/api";

// Innings are stored in batting order; `teams` is the fixture order. These views
// used to name innings[i] after teams[i], so when the second-listed side batted
// first every score was printed next to the other team.

vi.mock("../services/api", () => ({ api: { get: vi.fn() } }));
vi.mock("../services/socket", () => ({ initSocket: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn() }) }));
vi.mock("../components/BlogGallery", () => ({ default: () => null }));

const baldia = { _id: "bal", name: "Baldia Zalmi", shortName: "BAL" };
const khan = { _id: "kha", name: "Khan Associates", shortName: "KHA" };

// Khan Associates bat first but are listed second, as in production.
const match = {
  _id: "m1",
  title: "BAL v KHA",
  status: "completed",
  matchType: "T20",
  teams: [baldia, khan],
  innings: [
    { team: khan, runs: 235, wickets: 10, overs: 20, balls: 120, batting: [], bowling: [] },
    { team: baldia, runs: 232, wickets: 10, overs: 20, balls: 120, batting: [], bowling: [] },
  ],
  result: { description: "Khan Associates won by 3 runs." },
};

beforeEach(() => {
  api.get.mockReset();
});

describe("teamOfInnings", () => {
  it("names the team the innings says batted", () => {
    expect(teamOfInnings(match, match.innings[0], 0)).toBe(khan);
    expect(teamOfInnings(match, match.innings[1], 1)).toBe(baldia);
  });

  it("resolves a team given only by id", () => {
    expect(teamOfInnings(match, { team: "kha" }, 0)).toBe(khan);
  });

  it("keeps a populated team that is missing from the teams list", () => {
    const other = { _id: "oth", name: "Other XI" };
    expect(teamOfInnings(match, { team: other }, 0)).toBe(other);
  });

  it("falls back to the position when the innings names no team", () => {
    expect(teamOfInnings(match, { runs: 1 }, 1)).toBe(khan);
  });
});

describe("match page Summary tab", () => {
  it("heads each innings card with the team that batted it", () => {
    // A match in progress has no result banner, which repeats the short names.
    render(<SummaryTab match={{ ...match, status: "live", result: undefined }} allPlayers={[]} />);

    const card = (name) => screen.getByText(name).parentElement.parentElement.textContent;
    expect(card("KHA")).toContain("235/10");
    expect(card("BAL")).toContain("232/10");
  });
});

describe("shareable match summary card", () => {
  it("prints each score under the team that made it", () => {
    render(<MatchSummaryCard match={match} />);

    const column = (name) => screen.getByText(name).parentElement.textContent;
    expect(column("KHA")).toContain("235/10");
    expect(column("BAL")).toContain("232/10");
    expect(column("BAL")).not.toContain("235");
  });
});

describe("/summary page", () => {
  it("names each innings after the team that batted it", async () => {
    api.get.mockResolvedValue({ data: match });
    render(
      <MemoryRouter initialEntries={["/summary/m1"]}>
        <Routes>
          <Route path="/summary/:matchId" element={<Summary />} />
        </Routes>
      </MemoryRouter>,
    );

    const card = async (name) => (await screen.findByRole("heading", { level: 3, name })).parentElement.parentElement.textContent;
    expect(await card("Khan Associates")).toContain("235/10");
    expect(await card("Baldia Zalmi")).toContain("232/10");
  });
});

describe("series page results", () => {
  it("credits each innings to the team that batted it", async () => {
    api.get.mockImplementation((url) => {
      if (url === "/series/s1") return Promise.resolve({ data: { _id: "s1", name: "Baldia Cup", matches: [match] } });
      if (url === "/series/s1/matches") return Promise.resolve({ data: { live: [], completed: [match], upcoming: [] } });
      if (url === "/matches/m1") return Promise.resolve({ data: match });
      return Promise.reject(new Error(`not mocked: ${url}`));
    });
    render(
      <MemoryRouter initialEntries={["/series/s1"]}>
        <Routes>
          <Route path="/series/:seriesId" element={<Series />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Fixtures & Results" }));
    await screen.findByRole("heading", { name: /Results \(1\)/ });

    const row = (name) => screen.getByText(name).parentElement.parentElement.textContent;
    expect(row("KHA")).toContain("235/10");
    expect(row("BAL")).toContain("232/10");
  });
});
