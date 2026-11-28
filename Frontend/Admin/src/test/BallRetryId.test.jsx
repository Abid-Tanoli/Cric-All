import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { ScoringAdaptersProvider } from "@shared/scoring/ScoringAdapters";
import useMatchScoring from "@shared/scoring/hooks/useMatchScoring";

// B6: a ball the scorer sends again after an error or a lost answer must carry
// the same clientBallId, so the server records it once. Once the server has
// confirmed a ball, the next one gets a new id. Undo works the same way with
// clientActionId.

const MATCH_ID = "m-retry-1";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const { apiGet, apiPost, fetchMatches, showToast } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  fetchMatches: vi.fn(),
  showToast: vi.fn(),
}));

const buildMatch = () => ({
  _id: MATCH_ID,
  title: "Retry fixture",
  status: "live",
  matchType: "T20",
  totalOvers: 20,
  teams: [
    { _id: "A", name: "Alpha" },
    { _id: "B", name: "Beta" },
  ],
  currentInnings: 0,
  innings: [
    {
      team: "A",
      status: "live",
      runs: 0,
      wickets: 0,
      balls: 0,
      onStrikeBatsman: "p1",
      currentBatsman1: "p1",
      currentBatsman2: "p2",
      currentBowler: "b1",
      batting: [
        { player: "p1", runs: 0, balls: 0 },
        { player: "p2", runs: 0, balls: 0 },
      ],
      bowling: [{ player: "b1", balls: 0 }],
      oversHistory: [],
    },
  ],
  playingXI: [],
  twelfthMan: [],
  superSub: [],
});

const makeAdapters = () => ({
  api: {
    defaults: { baseURL: "" },
    get: apiGet,
    patch: vi.fn(),
    post: apiPost,
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

const renderScoringHook = async () => {
  const match = buildMatch();
  fetchMatches.mockResolvedValue([{ _id: MATCH_ID, title: match.title }]);
  apiGet.mockImplementation((url) => {
    if (url === `/matches/${MATCH_ID}`) return Promise.resolve({ data: match });
    return Promise.resolve({ data: [] });
  });
  const hook = renderHook(() => useMatchScoring({ matchId: MATCH_ID, tabId: "admin" }), {
    wrapper: ({ children }) => (
      <ScoringAdaptersProvider value={makeAdapters()}>{children}</ScoringAdaptersProvider>
    ),
  });
  await waitFor(() => expect(hook.result.current.selectedMatch?._id).toBe(MATCH_ID));
  return { ...hook, match };
};

const networkError = () => Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" });

const postsTo = (suffix) => apiPost.mock.calls.filter(([url]) => url === `/matches/${MATCH_ID}/${suffix}`);

const submit = async (result) => {
  await act(async () => {
    await result.current.submitBall();
  });
};

const undo = async (result) => {
  act(() => {
    result.current.handleRevert(0);
  });
  await act(async () => {
    await result.current.confirmModal.onConfirm();
  });
};

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  fetchMatches.mockReset();
  showToast.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("clientBallId on POST /matches/:id/score", () => {
  it("sends the same id again after a failed send, and a new id after the server confirms", async () => {
    const { result, match } = await renderScoringHook();
    apiPost
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce({ data: { match } })
      .mockResolvedValueOnce({ data: { match } });

    await submit(result);
    await submit(result);
    await submit(result);

    const [first, retry, next] = postsTo("score").map(([, body]) => body.clientBallId);
    expect(first).toMatch(UUID_V4);
    expect(retry).toBe(first);
    expect(next).toMatch(UUID_V4);
    expect(next).not.toBe(first);
  });

  it("gives a changed ball a new id even after a failed send", async () => {
    const { result, match } = await renderScoringHook();
    apiPost.mockRejectedValueOnce(networkError()).mockResolvedValueOnce({ data: { match } });

    await submit(result);
    act(() => {
      result.current.setSelectedRuns(4);
    });
    await submit(result);

    const [first, changed] = postsTo("score").map(([, body]) => body);
    expect(changed.runs).toBe(4);
    expect(changed.clientBallId).not.toBe(first.clientBallId);
  });

  it("gives a second identical ball a new id while the first is still in flight", async () => {
    const { result, match } = await renderScoringHook();
    let answerFirst;
    apiPost
      .mockImplementationOnce(() => new Promise((resolve) => { answerFirst = resolve; }))
      .mockResolvedValueOnce({ data: { match } });

    let firstSend;
    act(() => {
      firstSend = result.current.submitBall();
    });
    await submit(result);
    await act(async () => {
      answerFirst({ data: { match } });
      await firstSend;
    });

    const [first, second] = postsTo("score").map(([, body]) => body);
    expect(second.runs).toBe(first.runs);
    expect(second.clientBallId).toMatch(UUID_V4);
    expect(second.clientBallId).not.toBe(first.clientBallId);
  });

  it("keeps the id through repeated failures of the same ball", async () => {
    const { result, match } = await renderScoringHook();
    apiPost
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce({ data: { match } });

    await submit(result);
    await submit(result);
    await submit(result);

    const sent = postsTo("score").map(([, body]) => body.clientBallId);
    expect(new Set(sent).size).toBe(1);
  });

  it("starts with a new id after a reload, even when the last send failed", async () => {
    const first = await renderScoringHook();
    apiPost.mockRejectedValueOnce(networkError());
    await submit(first.result);
    first.unmount();

    const reloaded = await renderScoringHook();
    apiPost.mockResolvedValueOnce({ data: { match: reloaded.match } });
    await submit(reloaded.result);

    const [beforeReload, afterReload] = postsTo("score").map(([, body]) => body.clientBallId);
    expect(afterReload).toMatch(UUID_V4);
    expect(afterReload).not.toBe(beforeReload);
  });

  it("tells the scorer when the server already had the ball", async () => {
    const { result, match } = await renderScoringHook();
    apiPost.mockResolvedValueOnce({ data: { match, duplicate: true } });

    await submit(result);

    expect(result.current.toast).toBe("Ball already recorded");
  });

  it("still makes a valid id where crypto.randomUUID is missing (plain-HTTP address)", async () => {
    const { result, match } = await renderScoringHook();
    const webcrypto = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: (bytes) => webcrypto.getRandomValues(bytes) });
    apiPost.mockResolvedValueOnce({ data: { match } });

    await submit(result);

    expect(postsTo("score")[0][1].clientBallId).toMatch(UUID_V4);
  });
});

describe("clientActionId on POST /matches/:id/revert-ball", () => {
  it("sends the same id again after a failed undo, and a new id after the server confirms", async () => {
    const { result, match } = await renderScoringHook();
    apiPost
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce({ data: { match } })
      .mockResolvedValueOnce({ data: { match } });

    await undo(result);
    await undo(result);
    await undo(result);

    const [first, retry, next] = postsTo("revert-ball").map(([, body]) => body.clientActionId);
    expect(first).toMatch(UUID_V4);
    expect(retry).toBe(first);
    expect(next).toMatch(UUID_V4);
    expect(next).not.toBe(first);
  });
});
