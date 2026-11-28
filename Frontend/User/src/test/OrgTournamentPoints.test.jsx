import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PointsTab } from "../pages/organization/OrgTournamentDetail";
import { updateOrgTournament } from "../services/organizationApi";

vi.mock("../services/organizationApi", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, updateOrgTournament: vi.fn(), recomputeOrgTournamentPoints: vi.fn() };
});

const ORG_ID = "a".repeat(24);
const TOURNAMENT_ID = "b".repeat(24);

const detail = {
  _id: TOURNAMENT_ID,
  name: "Tri Series",
  pointsConfig: { win: 2, tie: 1, noResult: 1 },
  pointsTable: [
    { team: { _id: "t1", name: "Alpha CC" }, matchesPlayed: 1, won: 1, points: 2 },
    { team: { _id: "t2", name: "Bravo CC" }, matchesPlayed: 1, lost: 1, points: 0 },
  ],
};

function renderTab(props = {}) {
  const onSaved = vi.fn();
  const onError = vi.fn();
  render(
    <PointsTab orgId={ORG_ID} tournamentId={TOURNAMENT_ID} detail={detail} canManage onSaved={onSaved} onError={onError} {...props} />
  );
  return { onSaved, onError };
}

// T1.4: the three points-per-result numbers are set from the owner UI.
describe("Points tab — points per result", () => {
  beforeEach(() => {
    updateOrgTournament.mockReset();
  });

  it("shows the saved numbers and keeps Save off until one changes", () => {
    renderTab();
    expect(screen.getByLabelText("Win")).toHaveValue(2);
    expect(screen.getByLabelText("Tie")).toHaveValue(1);
    expect(screen.getByLabelText("No result")).toHaveValue(1);
    expect(screen.getByRole("button", { name: "Save points" })).toBeDisabled();
  });

  it("saves all three numbers and reports that the table was recomputed", async () => {
    updateOrgTournament.mockResolvedValue({ tournament: detail });
    const { onSaved } = renderTab();

    fireEvent.change(screen.getByLabelText("Win"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("No result"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save points" }));

    await waitFor(() =>
      expect(updateOrgTournament).toHaveBeenCalledWith(ORG_ID, TOURNAMENT_ID, { pointsConfig: { win: 3, tie: 1, noResult: 0 } })
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("Points per result saved. The points table has been recomputed."));
  });

  it("refuses a negative or fractional number without calling the server", () => {
    renderTab();
    fireEvent.change(screen.getByLabelText("Tie"), { target: { value: "-1" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Use whole numbers, 0 or more.");
    expect(screen.getByRole("button", { name: "Save points" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Tie"), { target: { value: "1.5" } });
    expect(screen.getByRole("button", { name: "Save points" })).toBeDisabled();
    expect(updateOrgTournament).not.toHaveBeenCalled();
  });

  it("shows the numbers as text to someone who cannot manage the tournament", () => {
    renderTab({ canManage: false });
    expect(screen.getByText("Points per result: Win 2 · Tie 1 · No result 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save points" })).not.toBeInTheDocument();
  });
});
