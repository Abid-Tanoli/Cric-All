import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import MissingPlayerRoles from "../pages/MissingPlayerRoles";
import api from "../services/api";

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock("../components/Toast", () => ({ useToast: () => ({ showToast }) }));

vi.mock("../components/ConfirmModal", () => ({
  default: ({ open, title, message, confirmLabel, onConfirm, onCancel }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <p>{message}</p>
        <button onClick={onCancel}>Cancel</button>
        <button onClick={onConfirm}>{confirmLabel}</button>
      </div>
    ) : null,
}));

const PLAYERS = [
  {
    _id: "p1",
    name: "Amir",
    role: "",
    playingRole: "Batsman",
    teams: [{ _id: "t1", name: "City XI" }],
    organization: "City Club",
    battingStyle: "Right-handed",
    bowlingStyle: "Not Applicable",
    stats: { matches: 2, runs: 60, wickets: 0 },
    suggestedRole: "Batsman",
  },
  {
    _id: "p2",
    name: "Bilal",
    role: null,
    playingRole: "Batsman",
    teams: [],
    organization: "",
    battingStyle: "Left-handed",
    bowlingStyle: "Right-arm Fast",
    stats: { matches: 3, runs: 0, wickets: 9 },
    suggestedRole: "Bowler",
  },
];

function renderPage() {
  api.get.mockImplementation((url) => {
    if (url.includes("missing-role")) {
      return Promise.resolve({
        data: { players: PLAYERS, totalPlayers: 2, totalPages: 1, currentPage: 1 },
      });
    }
    return Promise.resolve({ data: { teams: [{ _id: "t1", name: "City XI" }] } });
  });
  api.post.mockResolvedValue({ data: { dryRun: false, count: 1, changes: [] } });
  return render(<MissingPlayerRoles />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MissingPlayerRoles", () => {
  it("renders the table, count badge and list filters", async () => {
    renderPage();

    expect(await screen.findByText("Amir")).toBeInTheDocument();
    expect(screen.getByText("Bilal")).toBeInTheDocument();
    expect(screen.getByText("2 remaining")).toBeInTheDocument();
    expect(screen.getAllByText("City XI").length).toBeGreaterThan(0);
    expect(screen.getByText("City Club")).toBeInTheDocument();
    expect(screen.getByText("2 / 60 / 0")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Role for Amir" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Team filter"), { target: { value: "t1" } });
    await waitFor(() => {
      const call = api.get.mock.calls.filter(([url]) => url.includes("missing-role")).at(-1);
      expect(call[1].params.team).toBe("t1");
    });

    fireEvent.change(screen.getByLabelText("Search players"), { target: { value: "Amir" } });
    await waitFor(() => {
      const call = api.get.mock.calls.filter(([url]) => url.includes("missing-role")).at(-1);
      expect(call[1].params.search).toBe("Amir");
    }, { timeout: 1500 });
  });

  it("fills dropdowns from suggestions without posting anything", async () => {
    renderPage();
    await screen.findByText("Amir");

    fireEvent.click(screen.getByRole("button", { name: "Use suggestion for Bilal" }));
    expect(screen.getByRole("combobox", { name: "Role for Bilal" }).value).toBe("Bowler");
    expect(api.post).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Apply all suggestions" }));
    expect(screen.getByRole("combobox", { name: "Role for Amir" }).value).toBe("Batsman");
    expect(screen.getByRole("combobox", { name: "Role for Bilal" }).value).toBe("Bowler");
    expect(api.post).not.toHaveBeenCalled();
  });

  it("dry-runs, confirms the roles, then saves and refreshes", async () => {
    api.post
      .mockResolvedValueOnce({ data: { dryRun: true, count: 2, changes: [] } })
      .mockResolvedValueOnce({ data: { dryRun: false, count: 2, changes: [] } });
    renderPage();
    await screen.findByText("Amir");

    fireEvent.click(screen.getByLabelText("Select Amir"));
    fireEvent.click(screen.getByLabelText("Select Bilal"));
    fireEvent.change(screen.getByRole("combobox", { name: "Role for Amir" }), {
      target: { value: "All-Rounder" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Role for Bilal" }), {
      target: { value: "Bowler" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set role for selected" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post.mock.calls[0][1]).toEqual({
      dryRun: true,
      updates: [
        { playerId: "p1", role: "All-Rounder" },
        { playerId: "p2", role: "Bowler" },
      ],
    });

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Update 2 player(s)");
    expect(dialog).toHaveTextContent("Amir → All-Rounder");
    expect(dialog).toHaveTextContent("Bilal → Bowler");

    fireEvent.click(within(dialog).getByRole("button", { name: "Save roles" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post.mock.calls[1][1]).toEqual({
      updates: [
        { playerId: "p1", role: "All-Rounder" },
        { playerId: "p2", role: "Bowler" },
      ],
    });
    expect(showToast).toHaveBeenCalledWith("Updated role for 2 player(s)", "success");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows per-item server errors and never opens the confirm dialog", async () => {
    api.post.mockRejectedValueOnce({
      response: {
        data: {
          message: "Validation failed",
          errors: [{ index: 1, message: "Must be a valid id" }],
        },
      },
    });
    renderPage();
    await screen.findByText("Amir");

    fireEvent.click(screen.getByLabelText("Select Amir"));
    fireEvent.change(screen.getByRole("combobox", { name: "Role for Amir" }), {
      target: { value: "Batsman" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set role for selected" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Must be a valid id");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.post).toHaveBeenCalledTimes(1);
  });
});
