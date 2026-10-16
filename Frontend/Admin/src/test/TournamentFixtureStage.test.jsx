import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The manual-fixture form decides whether to send `round` based on what the
// admin typed, so the outgoing POST body is the thing worth asserting.
const { get, post, showToast } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  showToast: vi.fn(),
}));
vi.mock("../services/api", () => ({ default: { get, post } }));
vi.mock("../components/Toast", () => ({ useToast: () => ({ showToast }) }));

import TournamentManagement from "../pages/Tournamentmanagement";

const TOURNAMENT = {
  _id: "t1",
  name: "OPENCODE_TEST Knockout Cup",
  type: "knockout",
  teams: [{ _id: "A", name: "Alpha" }, { _id: "B", name: "Beta" }],
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <TournamentManagement />
    </MemoryRouter>
  );

// Opens the management panel for the first listed tournament.
const openManagement = async () => {
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: /^manage$/i }));
  await screen.findByLabelText("Manual fixture team A");
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  showToast.mockReset();
  get.mockImplementation((url) => {
    if (url === "/tournaments") return Promise.resolve({ data: [TOURNAMENT] });
    if (url === "/teams") return Promise.resolve({ data: TOURNAMENT.teams });
    if (url === "/tournaments/t1") return Promise.resolve({ data: TOURNAMENT });
    if (url === "/tournaments/t1/fixtures") return Promise.resolve({ data: [] });
    return Promise.resolve({ data: {} });
  });
  post.mockResolvedValue({ data: { match: { _id: "m1" } } });
});

describe("TournamentManagement manual fixture stage", () => {
  it("offers the knockout stages in the manual fixture form", async () => {
    await openManagement();
    const stage = screen.getByLabelText("Manual fixture stage");
    const options = Array.from(stage.querySelectorAll("option")).map((o) => o.value);
    expect(options).toEqual(["", "quarter_final", "semi_final", "final", "third_place"]);
    expect(screen.getByLabelText("Manual fixture stage label")).toBeInTheDocument();
  });

  it("omits round from the payload when it is left empty so the server derives it", async () => {
    await openManagement();

    fireEvent.change(screen.getByLabelText("Manual fixture team A"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("Manual fixture team B"), { target: { value: "B" } });
    fireEvent.change(screen.getByLabelText("Manual fixture stage"), { target: { value: "semi_final" } });
    fireEvent.change(screen.getByLabelText("Manual fixture stage label"), { target: { value: "SF1" } });

    fireEvent.click(screen.getByRole("button", { name: /add fixture/i }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, payload] = post.mock.calls[0];
    expect(url).toBe("/tournaments/t1/matches");
    expect(payload.stage).toBe("semi_final");
    expect(payload.stageLabel).toBe("SF1");
    expect("round" in payload).toBe(false);
  });

  it("sends round as a number when the admin types one explicitly", async () => {
    await openManagement();

    fireEvent.change(screen.getByLabelText("Manual fixture team A"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("Manual fixture team B"), { target: { value: "B" } });
    fireEvent.change(screen.getByLabelText("Manual fixture round"), { target: { value: "2" } });

    fireEvent.click(screen.getByRole("button", { name: /add fixture/i }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [, payload] = post.mock.calls[0];
    expect(payload.round).toBe(2);
  });

  it("keeps round empty again after a successful save", async () => {
    await openManagement();

    fireEvent.change(screen.getByLabelText("Manual fixture team A"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("Manual fixture team B"), { target: { value: "B" } });
    fireEvent.change(screen.getByLabelText("Manual fixture round"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /add fixture/i }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    // The form resets so the next fixture is not silently forced to round 3.
    await waitFor(() =>
      expect(screen.getByLabelText("Manual fixture round")).toHaveValue(null)
    );
    expect(screen.getByLabelText("Manual fixture round").value).toBe("");
  });
});
