import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

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
});
