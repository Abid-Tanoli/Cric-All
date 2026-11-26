// PR 8 — the public club page.
//
// Pins the public surface: club identity and badges, About/social links, team
// cards linking to /teams/:id, upcoming fixtures, recent results, top
// performers, the empty states a brand-new club shows, and the not-found page
// for a private/unknown slug (the API answers 404, not 403).
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ClubProfile from "../pages/ClubProfile";
import { api } from "../services/api";

vi.mock("../services/api", () => ({
  api: { get: vi.fn() },
}));

const CLUB = {
  organization: {
    _id: "org-1",
    name: "Gulberg Stars",
    slug: "gulberg-stars",
    logoUrl: "",
    coverUrl: "",
    description: "A neighbourhood cricket club in Lahore.",
    website: "https://gulberg.example",
    foundedYear: 1998,
    orgType: "local_club",
    verificationStatus: "verified",
    location: { city: "Lahore", country: "Pakistan" },
    locationLabels: { city: "Lahore", country: "Pakistan" },
    socialLinks: { instagram: "https://instagram.com/gulberg", facebook: "" },
    branchCount: 2,
  },
  teams: [
    {
      _id: "team-1",
      name: "Gulberg Stars XI",
      teamRole: "1st XI",
      branchName: "Main",
      logo: "",
    },
  ],
  upcomingMatches: [
    {
      _id: "match-next",
      title: "Gulberg Stars XI vs Township Titans",
      startAt: "2026-06-01T10:00:00.000Z",
      venue: "Gulberg Ground",
      teams: [
        { _id: "team-1", name: "Gulberg Stars XI" },
        { _id: "team-2", name: "Township Titans" },
      ],
    },
  ],
  recentResults: [
    {
      _id: "match-done",
      title: "Gulberg Stars XI vs Model Town",
      status: "completed",
      startAt: "2026-05-01T10:00:00.000Z",
      teams: [
        { _id: "team-1", name: "Gulberg Stars XI" },
        { _id: "team-3", name: "Model Town" },
      ],
      innings: [
        { team: "team-1", runs: 154, wickets: 6, overs: 20 },
        { team: "team-3", runs: 150, wickets: 8, overs: 20 },
      ],
      result: { winner: "team-1", description: "Gulberg Stars XI won by 4 runs" },
    },
  ],
  topPerformers: {
    topRunScorer: {
      _id: "player-1",
      name: "Ayesha Khan",
      matches: 8,
      runs: 420,
      wickets: 2,
      strikeRate: 121.5,
      imageUrl: "",
    },
    topWicketTaker: {
      _id: "player-2",
      name: "Nida Dar",
      matches: 8,
      runs: 90,
      wickets: 18,
      strikeRate: 88.2,
      imageUrl: "",
    },
    bestStrikeRate: null,
    bestPlayers: [],
  },
};

const EMPTY_CLUB = {
  organization: {
    _id: "org-2",
    name: "Brand New Club",
    slug: "brand-new-club",
    orgType: "other",
    verificationStatus: "unverified",
    socialLinks: {},
  },
  teams: [],
  upcomingMatches: [],
  recentResults: [],
  topPerformers: { topRunScorer: null, topWicketTaker: null, bestStrikeRate: null, bestPlayers: [] },
};

function renderClub(slug = "gulberg-stars") {
  return render(
    <MemoryRouter initialEntries={[`/club/${slug}`]}>
      <Routes>
        <Route path="/club/:slug" element={<ClubProfile />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  api.get.mockReset();
});

describe("ClubProfile", () => {
  it("renders the club header, about, social links and verified badge", async () => {
    api.get.mockResolvedValue({ data: CLUB });
    renderClub();

    await waitFor(() => expect(screen.getByText("Gulberg Stars")).toBeInTheDocument());
    expect(api.get).toHaveBeenCalledWith("/organizations/public/gulberg-stars");
    expect(screen.getByText("A neighbourhood cricket club in Lahore.")).toBeInTheDocument();
    expect(screen.getByText("✓ Verified")).toBeInTheDocument();
    expect(screen.getByText(/Local club/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Instagram" })).toHaveAttribute(
      "href",
      "https://instagram.com/gulberg"
    );
    await waitFor(() => expect(document.title).toBe("Gulberg Stars | CricAll"));
  });

  it("links each team to its team page", async () => {
    api.get.mockResolvedValue({ data: CLUB });
    renderClub();

    await waitFor(() => expect(screen.getByText("Gulberg Stars XI")).toBeInTheDocument());
    expect(screen.getByText("Gulberg Stars XI").closest("a")).toHaveAttribute(
      "href",
      "/teams/team-1"
    );
  });

  it("renders upcoming fixtures, results and top performers", async () => {
    api.get.mockResolvedValue({ data: CLUB });
    renderClub();

    await waitFor(() =>
      expect(screen.getByText("Upcoming matches")).toBeInTheDocument()
    );
    expect(screen.getByText("Gulberg Stars XI vs Township Titans")).toBeInTheDocument();
    expect(screen.getByText("Gulberg Stars XI vs Model Town")).toBeInTheDocument();
    expect(screen.getByText("Gulberg Stars XI won by 4 runs")).toBeInTheDocument();
    expect(
      screen.getByText("Gulberg Stars XI 154/6 (20) • Model Town 150/8 (20)")
    ).toBeInTheDocument();
    expect(screen.getByText("Ayesha Khan")).toBeInTheDocument();
    expect(screen.getByText("Nida Dar")).toBeInTheDocument();
  });

  it("shows explicit empty states for a club with nothing yet", async () => {
    api.get.mockResolvedValue({ data: EMPTY_CLUB });
    renderClub("brand-new-club");

    await waitFor(() => expect(screen.getByText("Brand New Club")).toBeInTheDocument());
    expect(
      screen.getByText("This club has not added a description yet.")
    ).toBeInTheDocument();
    expect(screen.getByText("This club has not published a team yet.")).toBeInTheDocument();
    expect(screen.getByText("No upcoming matches yet.")).toBeInTheDocument();
    expect(screen.getByText("No completed matches yet.")).toBeInTheDocument();
    expect(
      screen.getByText("No individual performances recorded yet.")
    ).toBeInTheDocument();
  });

  it("renders the 404 page when the API says the club is private or unknown", async () => {
    api.get.mockRejectedValue({ response: { status: 404 } });
    renderClub("hidden-club");

    await waitFor(() => expect(screen.getByText("Page Not Found")).toBeInTheDocument());
  });

  it("shows a live match in its own section", async () => {
    api.get.mockResolvedValue({
      data: {
        ...CLUB,
        liveMatches: [{ _id: "match-live", title: "Gulberg Stars XI vs Live Side", teams: [] }],
      },
    });
    renderClub();

    await waitFor(() => expect(screen.getByText("Live now")).toBeInTheDocument());
    expect(screen.getByText("Gulberg Stars XI vs Live Side").closest("a")).toHaveAttribute(
      "href",
      "/match/match-live"
    );
  });

  it("offers a retry on a server error instead of claiming the club does not exist", async () => {
    api.get.mockRejectedValueOnce({ response: { status: 500 } });
    api.get.mockResolvedValueOnce({ data: CLUB });
    renderClub();

    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(screen.queryByText("Page Not Found")).not.toBeInTheDocument();
    retry.click();
    await waitFor(() => expect(screen.getByText("Gulberg Stars")).toBeInTheDocument());
  });
});
