import { describe, expect, it, vi } from "vitest";
import { createScoringApi } from "../../../Shared/scoring/createScoringApi";

describe("scoring API adapter", () => {
  it("uses the injected API base URL and current auth token", async () => {
    const api = createScoringApi({
      apiBaseUrl: "https://api.example.test",
      getToken: () => "user-token",
    });
    let request;
    api.defaults.adapter = async (config) => {
      request = config;
      return { data: {}, status: 200, statusText: "OK", headers: {}, config };
    };

    await api.get("/matches/match-1");

    expect(request.baseURL).toBe("https://api.example.test");
    expect(request.url).toBe("/matches/match-1");
    expect(request.headers.Authorization).toBe("Bearer user-token");
  });
});
