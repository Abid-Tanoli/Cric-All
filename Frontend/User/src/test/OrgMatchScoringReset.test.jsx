import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// B19 / T1.6: the club scoring page decides whether the shared scoring screen
// offers Reset. It must follow the server's rule (create_match), so a
// score_handler never sees a button the API will refuse.

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
vi.mock("@shared/scoring/ManageScore", async () => {
  const { useScoringAdapters } = await import("@shared/scoring/ScoringAdapters");
  return {
    default: function AdapterProbe() {
      const adapters = useScoringAdapters();
      return <div data-testid="scoring-screen">{adapters.allowReset ? "reset allowed" : "reset hidden"}</div>;
    },
  };
});

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
  localStorage.setItem("bq_user", JSON.stringify({ _id: "user-1", name: "Ann" }));
  listOrgMatches.mockResolvedValue({
    items: [{ _id: "match-1", organizationRef: "org-1", status: "live" }],
  });
  getMatchDetail.mockResolvedValue({
    _id: "match-1",
    organizationRef: "org-1",
    status: "live",
    assignedScorers: [],
    teams: [],
  });
});

describe("OrgMatchScoring reset access", () => {
  it("hides reset from a score_handler", async () => {
    getMyOrgAccess.mockResolvedValue({
      roles: ["score_handler"],
      permissions: ["score_match", "view_analytics"],
      isPlatformAdmin: false,
    });
    renderPage();

    expect(await screen.findByTestId("scoring-screen")).toHaveTextContent("reset hidden");
  });

  it.each([
    ["owner", ["owner"]],
    ["admin", ["admin"]],
    ["manager", ["manager"]],
  ])("offers reset to an org %s (create_match)", async (_label, roles) => {
    getMyOrgAccess.mockResolvedValue({
      roles,
      permissions: ["create_match", "score_match", "view_analytics"],
      isPlatformAdmin: false,
    });
    renderPage();

    expect(await screen.findByTestId("scoring-screen")).toHaveTextContent("reset allowed");
  });
});
