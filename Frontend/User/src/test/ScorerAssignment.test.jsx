import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../services/organizationApi", () => ({
  getMatchScorers: vi.fn(),
  setMatchScorers: vi.fn(),
  listOrgMembers: vi.fn(),
}));

import { ScorerAssignmentPanel } from "../pages/organization/OrgMatches";
import {
  getMatchScorers,
  setMatchScorers,
  listOrgMembers,
} from "../services/organizationApi";

const match = { _id: "match-1", teams: [] };

const roster = {
  items: [
    {
      _id: "membership-1",
      user: { _id: "user-1", name: "Ann Scorer" },
      roles: ["score_handler"],
      permissions: ["score_match", "view_analytics"],
    },
    {
      _id: "membership-2",
      user: { _id: "user-2", name: "Bob Manager" },
      roles: ["manager"],
      permissions: ["create_match", "score_match"],
    },
    {
      _id: "membership-3",
      user: { _id: "user-3", name: "Cara Player" },
      roles: ["player"],
      permissions: ["view_analytics"],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  listOrgMembers.mockResolvedValue(roster);
  getMatchScorers.mockResolvedValue({
    matchId: "match-1",
    assignedScorers: [{ _id: "user-1", name: "Ann Scorer" }],
  });
  setMatchScorers.mockResolvedValue({
    assignedScorers: [{ _id: "user-1", name: "Ann Scorer" }],
  });
});

describe("owner scorer picker", () => {
  it("pre-checks the assigned scorer, hides ineligible members and saves", async () => {
    const onSaved = vi.fn();
    render(<ScorerAssignmentPanel orgId="org-1" match={match} onClose={vi.fn()} onSaved={onSaved} />);

    const ann = await screen.findByLabelText("assign Ann Scorer");
    expect(ann).toBeChecked();
    expect(screen.getByLabelText("assign Bob Manager")).not.toBeChecked();
    expect(screen.queryByLabelText("assign Cara Player")).toBeNull();
    expect(screen.queryByTestId("scorer-unrestricted")).toBeNull();

    fireEvent.click(screen.getByLabelText("assign Bob Manager"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(setMatchScorers).toHaveBeenCalledWith("match-1", ["user-1", "user-2"]);
    expect(onSaved).toHaveBeenCalledWith("Scorer assignment saved.");
  });

  it("shows Anyone with scoring access for an empty list and clears it", async () => {
    getMatchScorers.mockResolvedValue({ matchId: "match-1", assignedScorers: [] });
    setMatchScorers.mockResolvedValue({ assignedScorers: [] });
    const onSaved = vi.fn();
    render(<ScorerAssignmentPanel orgId="org-1" match={match} onClose={vi.fn()} onSaved={onSaved} />);

    expect(await screen.findByTestId("scorer-unrestricted")).toHaveTextContent("Anyone with scoring access");
    expect(screen.getByText("No one selected means anyone with scoring access can score.")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    });

    expect(setMatchScorers).toHaveBeenCalledWith("match-1", []);
    expect(onSaved).toHaveBeenCalledWith(
      "Scorer assignment cleared. Anyone with scoring access can score."
    );
  });

  it("fits a 375px viewport without a fixed wide panel", async () => {
    window.innerWidth = 375;
    render(<ScorerAssignmentPanel orgId="org-1" match={match} onClose={vi.fn()} onSaved={vi.fn()} />);

    const dialog = await screen.findByRole("dialog", { name: "Assign scorers" });
    await screen.findByLabelText("assign Ann Scorer");
    expect(dialog.className).toContain("w-full");
    expect(dialog.className).toContain("max-w-lg");
    expect(screen.getByTestId("scorer-candidates").parentElement.className).toContain("overflow-y-auto");
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  });
});
