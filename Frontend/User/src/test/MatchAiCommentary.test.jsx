import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { ScoringAdaptersProvider } from "@shared/scoring/ScoringAdapters";
import useMatchScoring from "@shared/scoring/hooks/useMatchScoring";
import RightSidebarControls from "@shared/scoring/components/ScoreManagement/RightSidebarControls";
import { getScoringVisibility } from "@shared/scoring/utils/scoringVisibility";

const MATCH_ID = "m-ai-1";

const { apiGet, apiPatch, fetchMatches, showToast } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  fetchMatches: vi.fn(),
  showToast: vi.fn(),
}));

const buildMatch = (overrides = {}) => ({
  _id: MATCH_ID,
  title: "AI flag fixture",
  status: "live",
  matchType: "T20",
  totalOvers: 20,
  teams: [
    { _id: "A", name: "Alpha" },
    { _id: "B", name: "Beta" },
  ],
  innings: [],
  currentInnings: 0,
  playingXI: [],
  twelfthMan: [],
  superSub: [],
  ...overrides,
});

const makeAdapters = () => ({
  api: {
    defaults: { baseURL: "" },
    get: apiGet,
    patch: apiPatch,
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  apiBaseUrl: "",
  getToken: () => null,
  fetchMatches,
  socket: null,
  buildScorePath: (path) => path,
  showToast,
  joinMatchRoom: vi.fn(),
  leaveMatchRoom: vi.fn(),
});

const makeWrapper = () => ({ children }) => (
  <ScoringAdaptersProvider value={makeAdapters()}>{children}</ScoringAdaptersProvider>
);

const mockMatchFetch = (match) => {
  fetchMatches.mockResolvedValue([{ _id: MATCH_ID, title: match.title }]);
  apiGet.mockImplementation((url) => {
    if (url === `/matches/${MATCH_ID}`) return Promise.resolve({ data: match });
    if (url === `/matches/${MATCH_ID}/squads`) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
};

const renderScoringHook = () =>
  renderHook(() => useMatchScoring({ matchId: MATCH_ID, tabId: "admin" }), {
    wrapper: makeWrapper(),
  });

const renderControls = (useAiCommentary) =>
  render(
    <RightSidebarControls
      battingXI={[]}
      bowlingXI={[]}
      strikerId=""
      nonStrikerId=""
      bowlerId=""
      selectedRuns={0}
      setSelectedRuns={vi.fn()}
      setShowSelectionModal={vi.fn()}
      handleRevert={vi.fn()}
      reverting={false}
      selectedExtra=""
      setSelectedExtra={vi.fn()}
      selectedWicket=""
      submitBall={vi.fn()}
      onSelectBowler={vi.fn()}
      useAICommentary={useAiCommentary}
      setUseAICommentary={vi.fn()}
      manualCommentary=""
      setManualCommentary={vi.fn()}
    />
  );

beforeEach(() => {
  window.localStorage.clear();
  apiGet.mockReset();
  apiPatch.mockReset();
  fetchMatches.mockReset();
  showToast.mockReset();
});

describe("match-level AI commentary flag (user scoring)", () => {
  it("treats an old match without the flag as OFF and removes a stale browser value", async () => {
    window.localStorage.setItem("bq_use_ai_commentary", "true");
    mockMatchFetch(buildMatch());

    const { result } = renderScoringHook();
    await waitFor(() => expect(result.current.selectedMatch?._id).toBe(MATCH_ID));

    expect(result.current.useAICommentary).toBe(false);
    expect(window.localStorage.getItem("bq_use_ai_commentary")).toBeNull();
  });

  it("reads ON from the match document, not from browser storage", async () => {
    window.localStorage.setItem("bq_use_ai_commentary", "false");
    mockMatchFetch(buildMatch({ useAiCommentary: true }));

    const { result } = renderScoringHook();
    await waitFor(() => expect(result.current.useAICommentary).toBe(true));
  });

  it("toggling PATCHes the match and updates the shared flag", async () => {
    const match = buildMatch({ useAiCommentary: false });
    mockMatchFetch(match);
    apiPatch.mockResolvedValue({ data: { match: buildMatch({ useAiCommentary: true }) } });

    const { result } = renderScoringHook();
    await waitFor(() => expect(result.current.selectedMatch?._id).toBe(MATCH_ID));

    await act(async () => {
      await result.current.setUseAICommentary(true);
    });

    expect(apiPatch).toHaveBeenCalledWith(`/matches/${MATCH_ID}/ai-commentary`, {
      useAiCommentary: true,
    });
    expect(result.current.useAICommentary).toBe(true);
  });

  it("keeps the OFF layout simple", () => {
    renderControls(false);

    expect(
      screen.getByText(/AI commentary: OFF \(applies to everyone scoring this match\)/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Pitch map & shot map/)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Optional ball note")).toBeInTheDocument();
    expect(getScoringVisibility(false).showAdvancedAnalysis).toBe(false);
  });

  it("keeps the ON analysis layout", () => {
    renderControls(true);

    expect(
      screen.getByText(/AI commentary: ON \(applies to everyone scoring this match\)/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Pitch map & shot map/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Optional ball note")).not.toBeInTheDocument();
    expect(getScoringVisibility(true).showAdvancedAnalysis).toBe(true);
  });
});
