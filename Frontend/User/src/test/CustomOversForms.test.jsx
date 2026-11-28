import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MatchForm, formatLabel } from "../pages/organization/OrgMatches";
import { TournamentForm } from "../pages/organization/CompetitionForms";
import { buildTournamentPayload, validateTournamentForm } from "../lib/orgCompetitions";
import { createOrgMatch, updateOrgMatch } from "../services/organizationApi";

vi.mock("../services/organizationApi", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createOrgMatch: vi.fn(), updateOrgMatch: vi.fn() };
});

const ORG_ID = "a".repeat(24);
const teams = [{ _id: "t1", name: "Alpha CC" }, { _id: "t2", name: "Bravo CC" }];

function renderCreate() {
  const onDone = vi.fn();
  render(<MatchForm orgId={ORG_ID} teams={teams} onDone={onDone} onCancel={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Home side *"), { target: { value: "t1" } });
  fireEvent.change(screen.getByLabelText("Away side *"), { target: { value: "t2" } });
  return { onDone };
}

// T1.3 (B17): custom overs, ball type and a bowler quota from the owner forms.
describe("Match form — custom overs", () => {
  beforeEach(() => {
    createOrgMatch.mockReset();
    updateOrgMatch.mockReset();
  });

  it("asks for overs only when Custom is chosen and sends them with the ball type", async () => {
    createOrgMatch.mockResolvedValue({ match: { _id: "m1" } });
    renderCreate();
    expect(screen.queryByLabelText("Overs *")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "Custom" } });
    fireEvent.change(screen.getByLabelText("Overs *"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Ball type"), { target: { value: "tape" } });
    fireEvent.click(screen.getByRole("button", { name: "Create fixture" }));

    await waitFor(() => expect(createOrgMatch).toHaveBeenCalledTimes(1));
    expect(createOrgMatch).toHaveBeenCalledWith(ORG_ID, expect.objectContaining({
      teams: ["t1", "t2"], matchType: "Custom", totalOvers: 7, ballType: "tape",
    }));
  });

  it("never sends overs for a fixed format", async () => {
    createOrgMatch.mockResolvedValue({ match: { _id: "m1" } });
    renderCreate();
    fireEvent.click(screen.getByRole("button", { name: "Create fixture" }));

    await waitFor(() => expect(createOrgMatch).toHaveBeenCalledTimes(1));
    expect(createOrgMatch.mock.calls[0][1]).not.toHaveProperty("totalOvers");
  });

  it("stops a Custom match without overs, or with a quota above the overs", async () => {
    renderCreate();
    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "Custom" } });
    fireEvent.change(screen.getByLabelText("Overs *"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Max overs per bowler"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Create fixture" }));

    expect(await screen.findByText("A bowler cannot bowl more overs than the match has.")).toBeInTheDocument();
    expect(createOrgMatch).not.toHaveBeenCalled();
  });

  it("labels a Custom fixture with its overs", () => {
    expect(formatLabel({ matchType: "Custom", totalOvers: 7 })).toBe("Custom · 7 overs");
    expect(formatLabel({ matchType: "T20", totalOvers: 20 })).toBe("T20");
  });
});

describe("Tournament form — custom overs", () => {
  const valid = { name: "Tri Series", type: "league", startDate: "2026-12-01", endDate: "2026-12-10", teams: ["a", "b", "c"] };

  it("needs whole overs from 1 to 50 for a Custom tournament", () => {
    expect(validateTournamentForm({ ...valid, format: "Custom", totalOvers: "" }).message).toBe(
      "Enter the overs: a whole number from 1 to 50."
    );
    expect(validateTournamentForm({ ...valid, format: "Custom", totalOvers: "51" }).ok).toBe(false);
    expect(validateTournamentForm({ ...valid, format: "Custom", totalOvers: "12" }).ok).toBe(true);
  });

  it("sends overs only with Custom, and the ball type either way", () => {
    expect(buildTournamentPayload({ ...valid, format: "Custom", totalOvers: "12", ballType: "tape" })).toMatchObject({
      format: "Custom", totalOvers: 12, ballType: "tape",
    });
    const fixed = buildTournamentPayload({ ...valid, format: "T20", totalOvers: "12" });
    expect(fixed).not.toHaveProperty("totalOvers");
    expect(fixed.ballType).toBe(null);
  });

  it("shows the overs field only for Custom", () => {
    render(<TournamentForm onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByLabelText("Overs per innings *")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "Custom" } });
    expect(screen.getByLabelText("Overs per innings *")).toBeInTheDocument();
  });
});
