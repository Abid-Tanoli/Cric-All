import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useTournamentHub from "../pages/tournament/useTournamentHub";
import { api } from "../services/api";

const TOURNAMENT_ID = "b".repeat(24);

vi.mock("../services/api", () => ({ api: { get: vi.fn() } }));
vi.mock("../services/socket", () => ({
  initSocket: () => ({ on: () => {}, off: () => {} }),
}));

const sponsors = [
  { _id: "s1", name: "Title Co", logoUrl: "/uploads/title.png", linkUrl: "https://title.example", tier: "title", order: 0 },
];

beforeEach(() => {
  api.get.mockReset();
  api.get.mockImplementation((url) => {
    if (url.endsWith("/sponsors")) return Promise.resolve({ data: sponsors });
    if (url.endsWith("/content")) return Promise.resolve({ data: { tournamentId: TOURNAMENT_ID, visibility: {}, counts: {} } });
    if (url.endsWith("/standings")) return Promise.resolve({ data: { rows: [] } });
    if (url.endsWith("/stats")) return Promise.resolve({ data: {} });
    if (url.endsWith("/squad")) return Promise.resolve({ data: [] });
    if (url.endsWith("/fixtures")) return Promise.resolve({ data: [] });
    if (url === `/tournaments/${TOURNAMENT_ID}`) {
      return Promise.resolve({ data: { _id: TOURNAMENT_ID, name: "Cup", teams: [], matches: [] } });
    }
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
});

describe("tournament sponsor data", () => {
  it("loads the public sponsor endpoint and exposes only its safe fields", async () => {
    const { result } = renderHook(() => useTournamentHub(TOURNAMENT_ID));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(api.get).toHaveBeenCalledWith(`/tournaments/${TOURNAMENT_ID}/sponsors`, {
      timeout: 10000,
    });
    expect(result.current.sponsors).toEqual(sponsors);
  });

  it("treats a failed sponsor read as an empty strip instead of a failed page", async () => {
    api.get.mockImplementation((url) => {
      if (url.endsWith("/sponsors")) return Promise.reject(new Error("sponsor service down"));
      if (url.endsWith("/content")) return Promise.resolve({ data: { tournamentId: TOURNAMENT_ID, visibility: {}, counts: {} } });
      if (url.endsWith("/standings")) return Promise.resolve({ data: { rows: [] } });
      if (url.endsWith("/stats")) return Promise.resolve({ data: {} });
      if (url.endsWith("/squad")) return Promise.resolve({ data: [] });
      if (url === `/tournaments/${TOURNAMENT_ID}`) {
        return Promise.resolve({ data: { _id: TOURNAMENT_ID, name: "Cup", teams: [], matches: [] } });
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });

    const { result } = renderHook(() => useTournamentHub(TOURNAMENT_ID));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.sponsors).toEqual([]);
  });
});
