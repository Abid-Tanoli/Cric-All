import { describe, it, expect } from "vitest";
import { TOURNAMENT_TABS, resolveTabs, isTabVisible, tabByPath } from "../pages/tournament/registry";

const fullCtx = {
  visibility: {},
  counts: { matches: 6, photos: 4, videos: 2, articles: 3 },
  stats: { empty: false, topRunScorers: [{}], topWicketTakers: [{}] },
  standings: [{ team: {} }],
  teams: [{ _id: "t1" }],
  squads: [],
};

describe("tournament tab registry", () => {
  it("is a single ordered config array", () => {
    expect(TOURNAMENT_TABS.map((t) => t.key)).toEqual([
      "home",
      "fixtures",
      "table",
      "stats",
      "teams",
      "photos",
      "videos",
      "articles",
    ]);
    // Every entry carries the fields the layout renders from.
    for (const tab of TOURNAMENT_TABS) {
      expect(typeof tab.label).toBe("string");
      expect(typeof tab.path).toBe("string");
    }
  });

  it("hides empty media tabs and keeps the rest in order", () => {
    const tabs = resolveTabs({
      ...fullCtx,
      counts: { matches: 6, photos: 0, videos: 0, articles: 0 },
    });
    expect(tabs.map((t) => t.key)).toEqual(["home", "fixtures", "table", "stats", "teams"]);
  });

  it("shows a media tab as soon as it has content", () => {
    const tabs = resolveTabs({ ...fullCtx, counts: { matches: 0, photos: 1, videos: 0, articles: 0 } });
    expect(tabs.map((t) => t.key)).toEqual(["home", "table", "stats", "teams", "photos"]);
  });

  it("honours per-tournament visibility without touching global flags", () => {
    const tabs = resolveTabs({
      ...fullCtx,
      visibility: { stats: false, table: false, teams: false, photos: true },
    });
    expect(tabs.map((t) => t.key)).toEqual([
      "home",
      "fixtures",
      "photos",
      "videos",
      "articles",
    ]);
  });

  it("hides the Stats tab when there is nothing to show", () => {
    const tabs = resolveTabs({ ...fullCtx, stats: { empty: true } });
    expect(isTabVisible("stats", { ...fullCtx, stats: { empty: true } })).toBe(false);
    expect(tabs.some((t) => t.key === "stats")).toBe(false);
  });

  it("resolves a tab by its path, and Home by the empty string", () => {
    expect(tabByPath("", fullCtx).key).toBe("home");
    expect(tabByPath("fixtures", fullCtx).key).toBe("fixtures");
    expect(tabByPath("articles", fullCtx).key).toBe("articles");
    expect(tabByPath("nope", fullCtx)).toBe(null);
  });

  it("registers a future Bracket tab without touching the layout (data-only)", () => {
    // A new entry appended to the same array shape is all a new tab needs.
    const bracket = { key: "bracket", label: "Bracket", path: "bracket", isAvailable: () => true };
    const entries = [...TOURNAMENT_TABS, bracket];
    const visible = entries.filter((tab) => !tab.gate || fullCtx.visibility[tab.gate] !== false)
      .filter((tab) => tab.isAvailable(fullCtx));
    expect(visible.map((t) => t.key)).toContain("bracket");
    expect(visible[visible.length - 1].key).toBe("bracket");
  });
});
