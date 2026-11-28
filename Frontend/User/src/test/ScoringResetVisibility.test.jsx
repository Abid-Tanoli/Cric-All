import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ScoringAdaptersProvider } from "@shared/scoring/ScoringAdapters";

// B19 / T1.6: the scorer's match menu put "Reset innings" and "Reset match"
// right after "End innings". This renders the real shared ManageScore menu and
// only stubs the scoring hook and the heavy child panels, so what is checked is
// the Match actions block itself.

const handlers = vi.hoisted(() => ({
  handleEndInnings: vi.fn(),
  handleResetInnings: vi.fn(),
  handleResetMatch: vi.fn(),
}));

vi.mock("@shared/scoring/hooks/useMatchScoring", () => {
  const innings = [
    { _id: "inn-1", team: "A", status: "live", runs: 47, wickets: 2, balls: 30, oversHistory: [] },
    { _id: "inn-2", team: "B", status: "upcoming", runs: 0, wickets: 0, balls: 0, oversHistory: [] },
  ];
  const selectedMatch = {
    _id: "match-1",
    title: "Alpha vs Beta",
    status: "live",
    venue: "Ground",
    totalOvers: 20,
    currentInnings: 0,
    teams: [{ _id: "A", name: "Alpha" }, { _id: "B", name: "Beta" }],
    innings,
  };
  const state = {
    matches: [selectedMatch],
    selectedMatch,
    loading: false,
    socketConnected: true,
    isPreMatchComplete: true,
    activeTab: "live",
    confirmModal: { open: false },
    curInn: innings[0],
    battingTeamTeam: selectedMatch.teams[0],
    bowlingTeamTeam: selectedMatch.teams[1],
    battingXI: [],
    bowlingXI: [],
    battingPlayingXI: [],
    bowlingPlayingXI: [],
    formattedHistory: [],
    pitchMapBalls: [],
    getSquad: () => [],
    getPlayingXI: () => [],
    ...handlers,
  };
  return { default: () => state };
});

// Mobile bar stub: the only way into the menu view is its view switch.
vi.mock("@shared/scoring/components/ScoringMobileBar", () => ({
  default: ({ onViewChange }) => (
    <button type="button" onClick={() => onViewChange("menu")}>Open match menu</button>
  ),
}));
const stub = vi.hoisted(() => () => ({ default: () => null }));
vi.mock("@shared/scoring/components/ScoreManagement/ScoringScoreHeader", stub);
vi.mock("@shared/scoring/components/ScoreManagement/RightSidebarControls", stub);
vi.mock("@shared/scoring/components/ScoreManagement/LiveTab", stub);
vi.mock("@shared/scoring/components/ScoreManagement/ScorecardTab", stub);
vi.mock("@shared/scoring/components/ScoreManagement/CommentaryTab", stub);
vi.mock("@shared/scoring/components/ScoreManagement/StatsTab", stub);
vi.mock("@shared/scoring/components/ScoreManagement/NextBowlerModal", stub);
vi.mock("@shared/scoring/components/ScoreManagement/WicketDetailsForm", stub);
vi.mock("@shared/scoring/components/ScoreManagement/TieResolutionModal", stub);
vi.mock("@shared/scoring/components/ScoreManagement/SuperOverSetupModal", stub);
vi.mock("@shared/scoring/components/ScoreManagement/MatchSetupWizard", stub);
vi.mock("@shared/scoring/components/ScoreManagement/InningsBreakScreen", stub);
vi.mock("@shared/scoring/components/ScoreManagement/PlayerOfMatchCard", stub);

import ManageScore from "@shared/scoring/ManageScore";

const adapters = (overrides = {}) => ({
  navigate: vi.fn(),
  LinkComponent: ({ to, end, className, children, ...rest }) => (
    <a href={to} className={typeof className === "function" ? className({}) : className} {...rest}>{children}</a>
  ),
  buildScorePath: (id, tab) => `/score/${id}/${tab || "live"}`,
  buildScoreListPath: () => "/score",
  buildEventsPath: () => "/events",
  allowSettings: false,
  ...overrides,
});

const openMenu = (value) => {
  render(
    <ScoringAdaptersProvider value={value}>
      <ManageScore matchId="match-1" tabId="live" />
    </ScoringAdaptersProvider>
  );
  fireEvent.click(screen.getByRole("button", { name: "Open match menu" }));
  expect(screen.getByText("Match actions")).toBeInTheDocument();
};

describe("scorer match menu: reset actions (B19)", () => {
  it("does not show Reset innings or Reset match when the adapter does not allow reset", () => {
    openMenu(adapters());

    expect(screen.getByRole("button", { name: "End innings" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reset innings/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /reset match/i })).toBeNull();
  });

  it("shows both reset actions when the adapter allows reset", () => {
    openMenu(adapters({ allowReset: true }));

    fireEvent.click(screen.getByRole("button", { name: /reset innings/i }));
    fireEvent.click(screen.getByRole("button", { name: /reset match/i }));
    expect(handlers.handleResetInnings).toHaveBeenCalledTimes(1);
    expect(handlers.handleResetMatch).toHaveBeenCalledTimes(1);
  });
});
