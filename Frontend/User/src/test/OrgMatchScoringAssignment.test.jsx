import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../services/organizationApi", () => ({
  addOrgTeamPlayer: vi.fn(),
  getMyOrgAccess: vi.fn(),
  getMatchDetail: vi.fn(),
  listOrgMatches: vi.fn(),
}));
vi.mock("../services/socket", () => ({
  initSocket: () => ({}),
  joinMatchRoom: vi.fn(),
  leaveMatchRoom: vi.fn(),
}));
vi.mock("@shared/scoring/ManageScore", () => ({
  default: () => <div data-testid="scoring-screen">Scoring screen</div>,
}));

import OrgMatchScoring from "../pages/organization/OrgMatchScoring";
import { getMyOrgAccess, getMatchDetail, listOrgMatches } from "../services/organizationApi";

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/organization/org-1/matches/match-1/score/live"]}>
      <Routes>
        <Route path="/organization/:orgId/matches/:matchId/score/:tab" element={<OrgMatchScoring />} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem("bq_user", JSON.stringify({ _id: "user-handler", name: "Ann Handler" }));
  getMyOrgAccess.mockResolvedValue({
    roles: ["score_handler"],
    permissions: ["score_match", "view_analytics"],
    isPlatformAdmin: false,
  });
  listOrgMatches.mockResolvedValue({
    items: [{ _id: "match-1", organizationRef: "org-1", status: "live" }],
  });
  getMatchDetail.mockResolvedValue({
    _id: "match-1",
    organizationRef: "org-1",
    status: "live",
    assignedScorers: ["user-other"],
    teams: [],
  });
});

describe("OrgMatchScoring assignment pre-check", () => {
  it("blocks a score_handler who is not assigned to this fixture", async () => {
    renderPage();

    expect(await screen.findByText("Not assigned as scorer")).toBeInTheDocument();
    expect(
      screen.getByText("You are not assigned as scorer for this match, ask the club owner")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("scoring-screen")).toBeNull();
  });

  it("opens the scoring screen for an assigned score_handler", async () => {
    getMatchDetail.mockResolvedValue({
      _id: "match-1",
      organizationRef: "org-1",
      status: "live",
      assignedScorers: ["user-handler"],
      teams: [],
    });
    renderPage();

    expect(await screen.findByTestId("scoring-screen")).toBeInTheDocument();
    expect(screen.queryByText(/not assigned as scorer for this match/i)).toBeNull();
  });

  it("does not block owners and managers supervising an assigned fixture", async () => {
    getMyOrgAccess.mockResolvedValue({
      roles: ["manager"],
      permissions: ["create_match", "score_match", "view_analytics"],
      isPlatformAdmin: false,
    });
    renderPage();

    expect(await screen.findByTestId("scoring-screen")).toBeInTheDocument();
  });

  it("keeps the club-wide rule when no scorer is assigned", async () => {
    getMatchDetail.mockResolvedValue({
      _id: "match-1",
      organizationRef: "org-1",
      status: "live",
      assignedScorers: [],
      teams: [],
    });
    renderPage();

    expect(await screen.findByTestId("scoring-screen")).toBeInTheDocument();
  });
});
