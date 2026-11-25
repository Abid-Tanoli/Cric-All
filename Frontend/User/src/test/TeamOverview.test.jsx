// PR 7 — the public team page overview blocks.
//
// The page used to show only completed matches. These tests pin the five new
// blocks on the first visible tab (About): live now, upcoming, recent results,
// top performers and best players — plus the empty states, so a brand-new team
// shows a sentence rather than a blank gap.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import TeamProfile from "../pages/TeamProfile";
import { api } from "../services/api";

vi.mock("../services/api", () => ({
  api: { get: vi.fn() },
}));

vi.mock("../services/organizationApi", () => ({
  getMyOrgAccess: vi.fn(),
  addOrgTeamPlayer: vi.fn(),
  addOrgTeamPlayers: vi.fn(),
  addOrgTeamNewPlayers: vi.fn(),
  removeOrgTeamPlayers: vi.fn(),
  searchOrgTeamAvailablePlayers: vi.fn(),
}));

vi.mock("../pages/auth/auth", () => ({
  useStoredUser: () => null,
}));

vi.mock("../community/CommunityConfigContext", () => ({
  useCommunityConfig: () => ({ enabled: false }),
}));

vi.mock("../community/ShareMenu", () => ({ default: () => null }));
vi.mock("../community/PostsTab", () => ({ default: () => null }));

const TEAM_ID = "team-1";

const team = (overrides = {}) => ({
  _id: TEAM_ID,
  name: "Crescent XI",
  players: [],
  organizationRef: null,
  ...overrides,
});

const performer = (overrides = {}) => ({
  _id: "player-1",
  name: "Sana Mir",
  imageUrl: "",
  playingRole: "Batter",
  jerseyNumber: 27,
  matches: 6,
  runs: 320,
  wickets: 1,
  strikeRate: 118.4,
  average: 53.3,
  rating: 345,
  ...overrides,
});

const recentMatch = {
  _id: "m-done",
  title: "Crescent XI vs Gulberg Stars",
  status: "completed",
  startAt: "2026-03-01T10:00:00.000Z",
  venue: "Model Town Ground",
  teams: [
    { _id: TEAM_ID, name: "Crescent XI" },
    { _id: "team-2", name: "Gulberg Stars" },
  ],
  innings: [
    { team: { _id: TEAM_ID }, runs: 154, wickets: 6, overs: 20 },
    { team: { _id: "team-2" }, runs: 150, wickets: 8, overs: 20 },
  ],
  result: { winner: TEAM_ID, description: "Crescent XI won by 4 runs" },
};

const upcomingMatches = [
  {
    _id: "m-next",
    title: "Crescent XI vs Township Titans",
    status: "upcoming",
    startAt: "2026-06-01T10:00:00.000Z",
    venue: "Township Ground",
    teams: [
      { _id: TEAM_ID, name: "Crescent XI" },
      { _id: "team-3", name: "Township Titans" },
    ],
  },
  {
    _id: "m-tbd",
    title: "Crescent XI vs Shadab XI",
    status: "upcoming",
    startAt: null,
    venue: "",
    teams: [
      { _id: TEAM_ID, name: "Crescent XI" },
      { _id: "team-4", name: "Shadab XI" },
    ],
  },
];

const liveMatches = [
  {
    _id: "m-live",
    title: "Crescent XI vs Model Town Blues",
    status: "live",
    startAt: "2026-05-20T10:00:00.000Z",
    venue: "Crescent Park",
    teams: [
      { _id: TEAM_ID, name: "Crescent XI" },
      { _id: "team-5", name: "Model Town Blues" },
    ],
    innings: [{ team: { _id: TEAM_ID }, runs: 88, wickets: 3, overs: 12 }],
  },
];

const fullProfile = {
  team: team(),
  ranking: null,
  branches: [],
  liveMatches,
  upcomingMatches,
  recentMatches: [recentMatch],
  topPerformers: {
    topRunScorer: performer(),
    topWicketTaker: performer({ _id: "player-2", name: "Adeel Ahmed", runs: 90, wickets: 14 }),
    bestStrikeRate: performer(),
    bestStrikeRateMinMatches: 3,
    bestPlayers: [
      performer({ _id: "player-2", name: "Adeel Ahmed", runs: 90, wickets: 14, rating: 440 }),
      performer(),
    ],
  },
};

const emptyProfile = {
  team: team(),
  ranking: null,
  branches: [],
  liveMatches: [],
  upcomingMatches: [],
  recentMatches: [],
  topPerformers: {
    topRunScorer: null,
    topWicketTaker: null,
    bestStrikeRate: null,
    bestStrikeRateMinMatches: 3,
    bestPlayers: [],
  },
};

function renderTeam(profile) {
  api.get.mockImplementation((url) => {
    if (String(url).startsWith("/teams/")) {
      return Promise.resolve({ data: { data: profile } });
    }
    return Promise.resolve({ data: [] });
  });

  return render(
    <MemoryRouter initialEntries={[`/teams/${TEAM_ID}`]}>
      <Routes>
        <Route path="/teams/:id" element={<TeamProfile />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  document.title = "";
});

describe("Team page overview — live, upcoming, recent, performers", () => {
  it("shows the live fixture, upcoming fixtures and recent results on the first visible tab", async () => {
    renderTeam(fullProfile);

    expect(await screen.findByText("Live now")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();

    expect(screen.getByText("Upcoming matches")).toBeInTheDocument();
    expect(screen.getAllByText(/Township Titans/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Township Ground/)).toBeInTheDocument();
    // An undated fixture says so rather than rendering "Invalid Date".
    expect(screen.getByText("Date to be confirmed")).toBeInTheDocument();

    expect(screen.getByText("Recent results")).toBeInTheDocument();
    // "Won" is also a stat label in the hero stats bar, so match the badge set.
    expect(screen.getAllByText("Won").length).toBeGreaterThan(0);
    expect(screen.getByText(/154\/6 \(20\)/)).toBeInTheDocument();
    expect(screen.getByText(/150\/8 \(20\)/)).toBeInTheDocument();
    expect(screen.getByText("Crescent XI won by 4 runs")).toBeInTheDocument();
  });

  it("lists the top performers with their key number and the best players", async () => {
    renderTeam(fullProfile);

    expect(await screen.findByText("Top performers")).toBeInTheDocument();
    expect(screen.getByText("Top run scorer")).toBeInTheDocument();
    expect(screen.getByText("Top wicket taker")).toBeInTheDocument();
    expect(screen.getByText("Best strike rate")).toBeInTheDocument();

    expect(screen.getByText("320 runs in 6 matches")).toBeInTheDocument();
    expect(screen.getByText("14 wickets in 6 matches")).toBeInTheDocument();
    expect(screen.getByText("118.40 SR over 6 matches")).toBeInTheDocument();

    expect(screen.getByText("Best players")).toBeInTheDocument();
    expect(screen.getAllByText("Adeel Ahmed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sana Mir").length).toBeGreaterThan(0);
    const playerLinks = screen.getAllByRole("link", { name: /Adeel Ahmed/ });
    expect(
      playerLinks.some((link) => link.getAttribute("href") === "/players/player-2"),
    ).toBe(true);
  });

  it("uses the team name in the page title once it has loaded", async () => {
    renderTeam(fullProfile);

    await screen.findByText("Top performers");
    await waitFor(() => expect(document.title).toBe("Crescent XI | CricAll"));
  });

  it("shows empty states instead of blank gaps, and hides Live now when nothing is live", async () => {
    renderTeam(emptyProfile);

    expect(await screen.findByText("No upcoming matches yet.")).toBeInTheDocument();
    expect(screen.getByText("No completed matches yet.")).toBeInTheDocument();
    expect(screen.getByText("No individual performances recorded yet.")).toBeInTheDocument();
    expect(screen.getByText("No ranked players yet.")).toBeInTheDocument();
    expect(screen.queryByText("Live now")).not.toBeInTheDocument();
  });

  it("honours the media privacy flag on the gallery and videos", async () => {
    const { unmount } = renderTeam({
      ...emptyProfile,
      team: team({
        privacy: { media: "hidden" },
        media: [{ url: "http://x/g1.jpg", caption: "team photo" }],
        videos: [{ url: "http://x/v1.mp4", title: "clip" }],
      }),
    });

    await screen.findByText("No upcoming matches yet.");
    expect(screen.queryByText("Gallery")).not.toBeInTheDocument();
    expect(screen.queryByText("Videos")).not.toBeInTheDocument();
    unmount();

    renderTeam({
      ...emptyProfile,
      team: team({
        privacy: { media: "public" },
        media: [{ url: "http://x/g1.jpg", caption: "team photo" }],
        videos: [{ url: "http://x/v1.mp4", title: "clip" }],
      }),
    });

    expect(await screen.findByText("Gallery")).toBeInTheDocument();
    expect(screen.getByText("Videos")).toBeInTheDocument();
  });
});
