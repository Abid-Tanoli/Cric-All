import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import TournamentHub from "../pages/tournament/TournamentHub";
import FixturesTab from "../pages/tournament/tabs/FixturesTab";
import PhotosTab from "../pages/tournament/tabs/PhotosTab";
import StatsTab from "../pages/tournament/tabs/StatsTab";
import { api } from "../services/api";

// ---------------------------------------------------------------------------
// Hub routing, deep links and fallbacks.
//
// The hub is mounted under /series/:seriesId (plus /:tab and /articles/:slug).
// These tests drive it through a real MemoryRouter the same way App.jsx does,
// so the deep-link contract is exercised end to end.
// ---------------------------------------------------------------------------

vi.mock("../services/api", () => ({ api: { get: vi.fn() } }));

vi.mock("../services/socket", () => ({
  initSocket: () => ({ on: () => {}, off: () => {} }),
  getSocket: () => null,
  joinMatchRoom: () => {},
  leaveMatchRoom: () => {},
  disconnectSocket: () => {},
}));

// The legacy page is only loaded when /series/:id is not a tournament. Stub it
// so the fallback path can be asserted cheaply.
vi.mock("../pages/Series", async () => {
  const React = await import("react");
  return {
    default: () => React.createElement("div", { "data-testid": "legacy-series" }, "Legacy Series"),
  };
});

const TOURNAMENT_ID = "a".repeat(24);

const alphas = { _id: "team-a", name: "Alpha CC", shortName: "ALP" };
const betas = { _id: "team-b", name: "Beta CC", shortName: "BET" };

const tournament = {
  _id: TOURNAMENT_ID,
  name: "Premier Cup",
  type: "league",
  status: "live",
  venue: "Oval",
  startDate: "2026-01-01T00:00:00.000Z",
  endDate: "2026-02-01T00:00:00.000Z",
  logo: "",
  teams: [alphas, betas],
  matches: [
    { _id: "m1", status: "live", teams: [alphas, betas], venue: "Oval", group: "Group A", matchNumber: 1 },
    { _id: "m2", status: "completed", teams: [alphas, betas], venue: "Oval", group: "Group A", matchNumber: 2, result: { description: "Alpha won by 5 wickets" } },
  ],
};

const content = {
  tournamentId: TOURNAMENT_ID,
  visibility: {},
  counts: { matches: 2, photos: 1, videos: 1, articles: 1 },
  overview: { shortDescription: "A short description", city: "Mumbai" },
};

const standings = {
  rows: [{ team: alphas, matchesPlayed: 2, won: 1, lost: 1, points: 2, netRunRate: 0.5, form: ["W", "L"] }],
};

const stats = {
  empty: false,
  topRunScorers: [{ playerId: "p1", name: "Runny Raja", team: "Alpha CC", runs: 120 }],
  topWicketTakers: [{ playerId: "p2", name: "Wicky Waqar", team: "Alpha CC", wickets: 7 }],
  topFielders: [],
  boundaryMeter: { sixes: 3, fours: 9, mostSixes: [], mostFours: [] },
  highestScores: [],
  bestBowling: [],
  bestStrikeRates: [],
  bestEconomy: [],
};

const photos = [{ _id: "ph1", url: "https://cdn.example/x.jpg", caption: "Trophy" }];
const videos = [{ _id: "v1", provider: "youtube", videoId: "abc123", caption: "Highlights" }];
const articles = [{ _id: "ar1", slug: "season-preview", title: "Season Preview", excerpt: "Exciting season ahead" }];
const article = { _id: "ar1", slug: "season-preview", title: "Season Preview", body: "Full body text" };

function mockApi(overrides = {}) {
  const opts = {
    tournament,
    content,
    standings,
    stats,
    squad: [],
    fixtures: [],
    photos,
    videos,
    articles,
    article,
    ...overrides,
  };

  api.get.mockImplementation((url) => {
    if (typeof url !== "string") return Promise.reject(new Error(`bad url ${url}`));
    if (url.includes("/articles/")) return Promise.resolve({ data: { article: opts.article } });
    if (url.endsWith("/articles")) return Promise.resolve({ data: { items: opts.articles } });
    if (url.endsWith("/photos")) return Promise.resolve({ data: { items: opts.photos } });
    if (url.endsWith("/videos")) return Promise.resolve({ data: { items: opts.videos } });
    if (url.endsWith("/content")) return Promise.resolve({ data: opts.content });
    if (url.endsWith("/standings")) return Promise.resolve({ data: opts.standings });
    if (url.endsWith("/stats")) return Promise.resolve({ data: opts.stats });
    if (url.endsWith("/squad")) return Promise.resolve({ data: opts.squad });
    if (url.endsWith("/fixtures")) return Promise.resolve({ data: opts.fixtures });
    if (/^\/tournaments\/[a-f0-9]{24}$/i.test(url)) return Promise.resolve({ data: opts.tournament });
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

function renderHub(initialPath) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LocationProbe />
      <Routes>
        <Route path="/series/:seriesId" element={<TournamentHub />} />
        <Route path="/series/:seriesId/articles/:slug" element={<TournamentHub />} />
        <Route path="/series/:seriesId/:tab" element={<TournamentHub />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  api.get.mockReset();
  mockApi();
});

describe("TournamentHub routing and deep links", () => {
  it("renders the hub root (Home) with the right sidebar", async () => {
    renderHub(`/series/${TOURNAMENT_ID}`);
    expect(await screen.findByText("Total Matches")).toBeInTheDocument();
    expect(screen.getByTestId("tournament-sidebar")).toBeInTheDocument();
    expect(screen.getByText("Runny Raja")).toBeInTheDocument();
    expect(screen.getByText("Wicky Waqar")).toBeInTheDocument();
  });

  it("renders the Fixtures tab from its deep link", async () => {
    renderHub(`/series/${TOURNAMENT_ID}/fixtures`);
    expect(await screen.findByLabelText("Search fixtures")).toBeInTheDocument();
    expect(screen.getByTestId("match-group-Results")).toBeInTheDocument();
  });

  it("renders the Table deep link", async () => {
    renderHub(`/series/${TOURNAMENT_ID}/table`);
    expect(await screen.findByText("NRR")).toBeInTheDocument();
  });

  it("renders the Stats deep link", async () => {
    renderHub(`/series/${TOURNAMENT_ID}/stats`);
    expect(await screen.findByText("Most Runs")).toBeInTheDocument();
  });

  it("renders the Teams deep link", async () => {
    renderHub(`/series/${TOURNAMENT_ID}/teams`);
    expect(await screen.findByText("Team Squads")).toBeInTheDocument();
  });

  it("renders the Photos tab (full width, no sidebar)", async () => {
    renderHub(`/series/${TOURNAMENT_ID}/photos`);
    expect(await screen.findByAltText("Trophy")).toBeInTheDocument();
    expect(screen.queryByTestId("tournament-sidebar")).not.toBeInTheDocument();
  });

  it("renders the Videos tab", async () => {
    renderHub(`/series/${TOURNAMENT_ID}/videos`);
    expect(await screen.findByTitle("Highlights")).toBeInTheDocument();
  });

  it("renders the Articles list and an article deep link", async () => {
    const { unmount } = renderHub(`/series/${TOURNAMENT_ID}/articles`);
    expect(await screen.findByText("Season Preview")).toBeInTheDocument();
    unmount();

    renderHub(`/series/${TOURNAMENT_ID}/articles/season-preview`);
    expect(await screen.findByText("Full body text")).toBeInTheDocument();
  });

  it("shows every registry tab when the tournament has content", async () => {
    renderHub(`/series/${TOURNAMENT_ID}`);
    await screen.findByText("Total Matches");
    expect(screen.getByText(/Fixtures & Results/)).toBeInTheDocument();
    expect(screen.getByText("Table")).toBeInTheDocument();
    expect(screen.getByText("Stats")).toBeInTheDocument();
    expect(screen.getByText("Teams")).toBeInTheDocument();
    expect(screen.getByText("Photos")).toBeInTheDocument();
    expect(screen.getByText("Videos")).toBeInTheDocument();
    expect(screen.getByText("Articles")).toBeInTheDocument();
  });

  it("hides the empty media tabs and redirects their deep links to Home", async () => {
    mockApi({ content: { ...content, counts: { matches: 2, photos: 0, videos: 0, articles: 0 } } });
    renderHub(`/series/${TOURNAMENT_ID}/photos`);

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(`/series/${TOURNAMENT_ID}`)
    );
    expect(await screen.findByText("Total Matches")).toBeInTheDocument();
    expect(screen.queryByText("Photos")).not.toBeInTheDocument();
    expect(screen.queryByText("Videos")).not.toBeInTheDocument();
    expect(screen.queryByText("Articles")).not.toBeInTheDocument();
  });

  it("falls back to the fixtures endpoint when the document carries no matches", async () => {
    mockApi({
      tournament: { ...tournament, matches: [] },
      fixtures: [{ _id: "m9", status: "completed", teams: [alphas, betas], result: { description: "Alpha won" } }],
    });
    renderHub(`/series/${TOURNAMENT_ID}/fixtures`);

    expect(await screen.findByTestId("match-group-Results")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(`/tournaments/${TOURNAMENT_ID}/fixtures`, expect.anything());
  });

  it("does not hit the fixtures endpoint when the document already has matches", async () => {
    renderHub(`/series/${TOURNAMENT_ID}/fixtures`);
    await screen.findByLabelText("Search fixtures");
    expect(api.get).not.toHaveBeenCalledWith(`/tournaments/${TOURNAMENT_ID}/fixtures`, expect.anything());
  });
});

describe("TournamentHub slug + fallback resolution", () => {
  it("resolves a slug through the content endpoint and echoes the real id", async () => {
    renderHub("/series/premier-cup");
    // The name renders in both the breadcrumb and the title heading.
    expect((await screen.findAllByText("Premier Cup")).length).toBeGreaterThan(0);
    expect(api.get).toHaveBeenCalledWith("/tournaments/premier-cup/content", expect.anything());
  });

  it("hands an unknown id to the legacy Series page", async () => {
    api.get.mockImplementation(() => Promise.reject(new Error("404")));
    renderHub(`/series/${TOURNAMENT_ID}`);
    expect(await screen.findByTestId("legacy-series")).toBeInTheDocument();
  });

  it("hands a hard failure to the legacy Series page", async () => {
    api.get.mockImplementation(() => {
      throw new Error("boom");
    });
    renderHub(`/series/${TOURNAMENT_ID}`);
    expect(await screen.findByTestId("legacy-series")).toBeInTheDocument();
  });
});

describe("tab empty and error states", () => {
  it("Fixtures shows an empty state and a no-match state", async () => {
    const { unmount } = render(
      <MemoryRouter>
        <FixturesTab matches={[]} />
      </MemoryRouter>
    );
    expect(screen.getByText("No fixtures have been scheduled yet.")).toBeInTheDocument();
    unmount();

    render(
      <MemoryRouter>
        <FixturesTab matches={tournament.matches} />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText("Search fixtures"), { target: { value: "zzzzz" } });
    expect(await screen.findByText("No matches match your filters.")).toBeInTheDocument();
  });

  it("Photos surfaces a load error", async () => {
    api.get.mockImplementation(() => Promise.reject(new Error("network down")));
    render(
      <MemoryRouter>
        <PhotosTab tournamentId={TOURNAMENT_ID} />
      </MemoryRouter>
    );
    expect(await screen.findByText("Could not load photos")).toBeInTheDocument();
  });

  it("Stats shows the empty state before any match is played", () => {
    render(
      <MemoryRouter>
        <StatsTab stats={{ empty: true }} />
      </MemoryRouter>
    );
    expect(screen.getByText("Stats will be available after matches are played.")).toBeInTheDocument();
    expect(screen.getByText("No batting stats available yet")).toBeInTheDocument();
  });
});
