import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../services/organizationApi", () => ({
  addOrgTeamPlayer: vi.fn(),
  completeOrgSeries: vi.fn(),
  createOrgMatch: vi.fn(),
  createOrganizationIssue: vi.fn(),
  getMatchDetail: vi.fn(),
  getMatchSquads: vi.fn(),
  getMyOrgAccess: vi.fn(),
  getOrgSeries: vi.fn(),
  linkOrgSeriesMatch: vi.fn(),
  listOrgMatches: vi.fn(),
  listOrgTeamsManaged: vi.fn(),
  setMatchPlayingXI: vi.fn(),
  setMatchSuperSub: vi.fn(),
  setMatchTeamRoles: vi.fn(),
  setMatchToss: vi.fn(),
  setMatchTwelfthMan: vi.fn(),
  unlinkOrgSeriesMatch: vi.fn(),
  updateOrgMatch: vi.fn(),
}));

import OrgSeriesDetail from "../pages/organization/OrgSeriesDetail";
import {
  completeOrgSeries,
  getMyOrgAccess,
  getOrgSeries,
  linkOrgSeriesMatch,
  listOrgMatches,
  unlinkOrgSeriesMatch,
} from "../services/organizationApi";

const teams = [
  { _id: "team-a", name: "Sky Sports" },
  { _id: "team-b", name: "Young Star" },
];

const detail = {
  _id: "series-1",
  name: "Summer Series",
  matchType: "T20",
  status: "ongoing",
  startDate: "2026-06-01T00:00:00.000Z",
  endDate: "2026-06-30T00:00:00.000Z",
  venue: "City Ground",
  teams,
  matches: [
    {
      _id: "match-1",
      seriesMatchNumber: 1,
      status: "completed",
      startAt: "2026-06-02T10:00:00.000Z",
      venue: "City Ground",
      teams,
      result: { winner: teams[0], resultType: "normal", description: "Sky Sports won by 5 runs" },
    },
    {
      _id: "match-2",
      seriesMatchNumber: 2,
      status: "completed",
      startAt: "2026-06-05T10:00:00.000Z",
      venue: "City Ground",
      teams,
      result: { resultType: "tie", description: "Match tied" },
    },
  ],
  score: {
    matches: 2,
    completed: 2,
    ties: 1,
    noResult: 0,
    outcome: "winner",
    winner: teams[0],
    teams: [
      { team: teams[0], played: 2, wins: 1, ties: 1, noResult: 0 },
      { team: teams[1], played: 2, wins: 0, ties: 1, noResult: 0 },
    ],
  },
};

const completedDetail = {
  ...detail,
  status: "completed",
  matches: detail.matches,
};

const accessWith = (permissions) => ({ permissions });

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/organization/org-1/series/series-1"]}>
      <Routes>
        <Route path="/organization/:orgId/series/:seriesId" element={<OrgSeriesDetail />} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  getOrgSeries.mockResolvedValue(detail);
  getMyOrgAccess.mockResolvedValue(
    accessWith(["manage_competitions", "create_match", "score_match"])
  );
  listOrgMatches.mockResolvedValue({ items: [] });
  linkOrgSeriesMatch.mockResolvedValue(detail);
  unlinkOrgSeriesMatch.mockResolvedValue(detail);
  completeOrgSeries.mockResolvedValue(completedDetail);
});

describe("organization series management screen", () => {
  it("shows the computed score, linked matches and scoring links", async () => {
    getMyOrgAccess.mockResolvedValue(accessWith(["score_match"]));
    renderPage();

    expect(await screen.findByRole("heading", { name: "Summer Series" })).toBeInTheDocument();
    expect(screen.getByText("T20 · 2 matches · City Ground")).toBeInTheDocument();
    expect(screen.getByText("Leading: Sky Sports")).toBeInTheDocument();
    expect(screen.getByText("2 completed · 1 tie · 0 no result")).toBeInTheDocument();
    expect(screen.getAllByText("Sky Sports").length).toBeGreaterThan(0);
    expect(screen.getByText("Match 1")).toBeInTheDocument();
    expect(screen.getByText("Match 2")).toBeInTheDocument();

    const scoreLinks = screen.getAllByRole("link", { name: "Score" });
    expect(scoreLinks[0]).toHaveAttribute(
      "href",
      "/organization/org-1/matches/match-1/score/live"
    );
    expect(screen.queryByRole("button", { name: /\+ Add match/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Complete series/i })).not.toBeInTheDocument();
  });

  it("lets a manager add, link and remove matches but not complete the series", async () => {
    getMyOrgAccess.mockResolvedValue(accessWith(["create_match", "score_match"]));
    listOrgMatches.mockResolvedValue({
      items: [{ _id: "match-9", title: "Old fixture", teams, startAt: "2026-06-03T10:00:00.000Z" }],
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();

    expect(await screen.findByRole("button", { name: /\+ Add match/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Complete series/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Request series deletion/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /\+ Add match/i }));
    const picker = await screen.findByLabelText("Existing match");
    expect(screen.getByRole("option", { name: /Sky Sports v Young Star/i })).toBeInTheDocument();

    fireEvent.change(picker, { target: { value: "match-9" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Link match" }));
    });
    expect(linkOrgSeriesMatch).toHaveBeenCalledWith("org-1", "series-1", "match-9");

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    });
    expect(unlinkOrgSeriesMatch).toHaveBeenCalledWith("org-1", "series-1", "match-1");
  });

  it("completes an owned series and shows the derived winner", async () => {
    getOrgSeries.mockResolvedValueOnce(detail).mockResolvedValue(completedDetail);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();

    const completeButton = await screen.findByRole("button", { name: /Complete series/i });
    fireEvent.click(completeButton);

    expect(completeOrgSeries).toHaveBeenCalledWith("org-1", "series-1");
    await waitFor(() => {
      expect(screen.getByText("Sky Sports won the series.")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Complete series/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /\+ Add match/i })).not.toBeInTheDocument();
  });
});
