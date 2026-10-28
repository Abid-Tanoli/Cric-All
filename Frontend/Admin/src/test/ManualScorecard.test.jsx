import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// The page reads tournaments/teams/squads over the shared axios instance and
// toasts on save; all of that is mocked so the form behaviour can be asserted.
const { get, post, put, showToast } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  showToast: vi.fn(),
}));
vi.mock("../services/api", () => ({ default: { get, post, put } }));
vi.mock("../components/Toast", () => ({ useToast: () => ({ showToast }) }));

import ManualScorecard from "../pages/ManualScorecard";

const renderPage = () =>
  render(
    <MemoryRouter>
      <ManualScorecard />
    </MemoryRouter>
  );

const renderPageAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/manual-scorecard" element={<ManualScorecard />} />
        <Route path="/admin/manual-scorecard/:id" element={<ManualScorecard />} />
      </Routes>
    </MemoryRouter>
  );

const DRAFT = {
  _id: "draft1",
  title: "Alpha vs Beta",
  source: "manual",
  manualDraft: true,
  status: "upcoming",
  stage: "quarter_final",
  stageLabel: "QF4",
  startAt: "2026-10-18T00:00:00.000Z",
  totalOvers: 20,
  tournament: { _id: "t1", name: "OPENCODE_TEST Cup" },
  teams: [{ _id: "A", name: "Alpha" }, { _id: "B", name: "Beta" }],
};

const PUBLISHED = {
  ...DRAFT,
  _id: "pub1",
  title: "Beta vs Alpha",
  manualDraft: false,
  status: "completed",
  stageLabel: "QF1",
  teams: [{ _id: "B", name: "Beta" }, { _id: "A", name: "Alpha" }],
  result: { winner: { _id: "B", name: "Beta" }, margin: "3 runs", resultType: "normal" },
};

const DRAFT_DETAIL = {
  ...DRAFT,
  teams: [
    { _id: "A", name: "Alpha", players: [{ _id: "pa", name: "Ann" }] },
    { _id: "B", name: "Beta", players: [{ _id: "pb", name: "Ben" }] },
  ],
  tossWinner: { _id: "A", name: "Alpha" },
  tossDecision: "bat",
  innings: [
    {
      team: { _id: "A", name: "Alpha" },
      runs: 40,
      wickets: 1,
      overs: 4,
      balls: 24,
      extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0 },
      batting: [{ player: { _id: "pa", name: "Ann" }, runs: 40, balls: 30, fours: 2, sixes: 1, isOut: true, dismissalType: "caught", dismissalText: "c Ben b Ben" }],
      bowling: [{ player: { _id: "pb", name: "Ben" }, overs: 4, balls: 24, maidens: 0, runs: 40, wickets: 1 }],
      fallOfWickets: [{ runs: 40, wickets: 1, player: { _id: "pa", name: "Ann" }, overs: 24 }],
    },
    {
      team: { _id: "B", name: "Beta" },
      runs: 37,
      wickets: 1,
      overs: 4,
      balls: 24,
      extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0 },
      batting: [{ player: { _id: "pb", name: "Ben" }, runs: 37, balls: 24, fours: 1, sixes: 2, isOut: true, dismissalType: "bowled" }],
      bowling: [{ player: { _id: "pa", name: "Ann" }, overs: 4, balls: 24, maidens: 0, runs: 37, wickets: 1 }],
      fallOfWickets: [],
    },
  ],
  result: { winner: { _id: "A", name: "Alpha" }, margin: "3 runs", resultType: "normal", description: "" },
  manOfMatch: { _id: "pa", name: "Ann" },
};

const mockManualLibrary = (matches = [DRAFT, PUBLISHED]) => {
  get.mockImplementation((url) => {
    if (url === "/tournaments") {
      return Promise.resolve({ data: { tournaments: [{ _id: "t1", name: "OPENCODE_TEST Cup" }] } });
    }
    if (url === "/tournaments/t1") {
      return Promise.resolve({
        data: { _id: "t1", teams: [{ _id: "A", name: "Alpha" }, { _id: "B", name: "Beta" }] },
      });
    }
    if (url === "/matches/manual") return Promise.resolve({ data: { matches } });
    if (url === "/matches/draft1") return Promise.resolve({ data: DRAFT_DETAIL });
    if (url === "/matches/pub1") return Promise.resolve({ data: { ...PUBLISHED } });
    if (url === "/teams/A/players") return Promise.resolve({ data: [{ _id: "pa", name: "Ann" }] });
    if (url === "/teams/B/players") return Promise.resolve({ data: [{ _id: "pb", name: "Ben" }] });
    return Promise.resolve({ data: {} });
  });
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  put.mockReset();
  showToast.mockReset();
  get.mockImplementation((url) => {
    if (url === "/tournaments") {
      return Promise.resolve({ data: { tournaments: [{ _id: "t1", name: "OPENCODE_TEST Cup" }] } });
    }
    if (url === "/tournaments/t1") {
      return Promise.resolve({
        data: { _id: "t1", teams: [{ _id: "A", name: "Alpha" }, { _id: "B", name: "Beta" }] },
      });
    }
    if (url === "/teams/A/players") return Promise.resolve({ data: [{ _id: "pa", name: "Ann" }] });
    if (url === "/teams/B/players") return Promise.resolve({ data: [{ _id: "pb", name: "Ben" }] });
    return Promise.resolve({ data: {} });
  });
  post.mockResolvedValue({ data: { match: { _id: "m1" } } });
  put.mockResolvedValue({ data: { match: { _id: "m1" } } });
});

describe("ManualScorecard", () => {
  it("renders the entry form with draft and publish actions", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /manual scorecard entry/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save draft/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^publish$/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /add batsman/i })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /add bowler/i })).toHaveLength(2);
  });

  it("adds a batsman row and toggles the scorecard preview", () => {
    renderPage();
    expect(screen.queryByTestId("manual-preview")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /add batsman/i })[0]);
    expect(screen.getByLabelText("batting player 0-0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /preview scorecard/i }));
    expect(screen.getByTestId("manual-preview")).toBeInTheDocument();
  });

  it("publishes a manual scorecard built from the entered innings", async () => {
    renderPage();

    fireEvent.change(await screen.findByLabelText("Tournament"), { target: { value: "t1" } });
    // Wait for the tournament's teams, then pick them.
    await screen.findAllByRole("option", { name: "Alpha" });
    fireEvent.change(screen.getByLabelText("Team A"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("Team B"), { target: { value: "B" } });

    // Innings 1 batting card.
    fireEvent.click(screen.getAllByRole("button", { name: /add batsman/i })[0]);
    await screen.findAllByRole("option", { name: "Ann" });
    fireEvent.change(screen.getByLabelText("batting player 0-0"), { target: { value: "pa" } });
    fireEvent.change(screen.getByLabelText("runs 0-0"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("balls 0-0"), { target: { value: "30" } });
    fireEvent.click(screen.getByLabelText("out 0-0"));
    fireEvent.change(screen.getByLabelText("dismissal 0-0"), { target: { value: "caught" } });
    fireEvent.change(screen.getByLabelText("innings overs 0"), { target: { value: "4" } });

    // Result.
    fireEvent.change(screen.getByLabelText("Winner"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("Margin"), { target: { value: "10 runs" } });

    fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, payload] = post.mock.calls[0];
    expect(url).toBe("/matches/manual");
    expect(payload.draft).toBe(false);
    expect(payload.teamA).toBe("A");
    expect(payload.innings[0].team).toBe("A");
    expect(payload.innings[0].runs).toBe(40);
    expect(payload.innings[0].wickets).toBe(1);
    expect(payload.innings[0].batting[0]).toMatchObject({ player: "pa", runs: 40, isOut: true, dismissalType: "caught" });
    expect(payload.result).toMatchObject({ resultType: "normal", winner: "A", margin: "10 runs" });
  });

  it("saves a draft with the draft flag set", async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText("Tournament"), { target: { value: "t1" } });
    await screen.findAllByRole("option", { name: "Alpha" });
    fireEvent.change(screen.getByLabelText("Team A"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("Team B"), { target: { value: "B" } });

    fireEvent.click(screen.getByRole("button", { name: /save draft/i }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, payload] = post.mock.calls[0];
    expect(url).toBe("/matches/manual");
    expect(payload.draft).toBe(true);
  });

  it("lists manual drafts and published scorecards with an Open/Edit action", async () => {
    mockManualLibrary();
    renderPageAt("/admin/manual-scorecard");

    expect(await screen.findByText("Alpha vs Beta")).toBeInTheDocument();
    expect(screen.getByText("Beta vs Alpha")).toBeInTheDocument();
    expect(screen.getByText(/QF4/)).toBeInTheDocument();
    expect(screen.getByText(/QF1/)).toBeInTheDocument();
    expect(screen.getAllByText(/OPENCODE_TEST Cup/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /open draft/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /open draft/i }));
    expect(await screen.findByRole("heading", { name: /edit manual scorecard/i })).toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalledWith("/matches/draft1"));
  });

  it("opens a published scorecard from the Published list for editing", async () => {
    mockManualLibrary();
    renderPageAt("/admin/manual-scorecard");

    await screen.findByText("Beta vs Alpha");
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));

    expect(await screen.findByRole("heading", { name: /edit manual scorecard/i })).toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalledWith("/matches/pub1"));
  });

  it("opens a draft into the existing form and publishes it through PUT /matches/:id/manual", async () => {
    mockManualLibrary();
    renderPageAt("/admin/manual-scorecard/draft1");

    await waitFor(() => expect(screen.getByLabelText("Team A")).toHaveValue("A"));
    expect(screen.getByLabelText("Team B")).toHaveValue("B");
    expect(screen.getByLabelText("Stage label")).toHaveValue("QF4");
    expect(screen.getByLabelText("Tournament")).toHaveValue("t1");
    expect(await screen.findByText(/40\/1/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /preview scorecard/i }));
    expect(screen.getByTestId("manual-preview")).toHaveTextContent("Ann 40 (30)");

    fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const [url, payload] = put.mock.calls[0];
    expect(url).toBe("/matches/draft1/manual");
    expect(payload).toMatchObject({
      draft: false,
      teamA: "A",
      teamB: "B",
      stage: "quarter_final",
      stageLabel: "QF4",
      tournamentId: "t1",
    });
    expect(payload.innings[0]).toMatchObject({ team: "A", runs: 40, wickets: 1, overs: "4.0" });
    expect(payload.innings[0].batting[0]).toMatchObject({ player: "pa", runs: 40, isOut: true, dismissalType: "caught" });
    expect(payload.innings[0].fallOfWickets).toEqual([
      { runs: 40, wickets: 1, player: "pa", overs: "4.0" },
    ]);
    expect(payload.result).toMatchObject({ resultType: "normal", winner: "A", margin: "3 runs" });
  });
});
