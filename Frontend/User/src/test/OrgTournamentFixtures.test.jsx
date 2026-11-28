import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FixturesTab } from "../pages/organization/OrgTournamentDetail";
import { createOrgTournamentMatch, previewOrgTournamentFixtures } from "../services/organizationApi";

vi.mock("../services/organizationApi", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    previewOrgTournamentFixtures: vi.fn(),
    applyOrgTournamentFixtures: vi.fn(),
    createOrgTournamentMatch: vi.fn(),
  };
});

const ORG_ID = "a".repeat(24);
const TOURNAMENT_ID = "b".repeat(24);
const alpha = { _id: "t1", name: "Alpha CC" };
const bravo = { _id: "t2", name: "Bravo CC" };
const charlie = { _id: "t3", name: "Charlie CC" };

const detail = {
  _id: TOURNAMENT_ID,
  name: "Tri Series",
  type: "league",
  teams: [alpha, bravo, charlie],
  // Bravo top on points, Alpha second on NRR over Charlie.
  pointsTable: [
    { team: charlie, points: 2, netRunRate: -0.5 },
    { team: bravo, points: 4, netRunRate: 0.2 },
    { team: alpha, points: 2, netRunRate: 0.4 },
  ],
};

const leagueMatch = (status, n) => ({ _id: `m${n}`, status, stage: "", teams: [alpha, bravo], round: n });
const finishedLeague = [1, 2, 3, 4, 5].map((n) => leagueMatch("completed", n)).concat(leagueMatch("abandoned", 6));

function renderTab(fixtures = []) {
  const onSaved = vi.fn();
  const onError = vi.fn();
  render(
    <FixturesTab
      orgId={ORG_ID}
      tournamentId={TOURNAMENT_ID}
      detail={detail}
      fixtures={fixtures}
      canManage
      canFixture
      onSaved={onSaved}
      onError={onError}
    />
  );
  return { onSaved, onError };
}

// T1.5: double round + final from the owner UI.
describe("Fixtures tab — double round and final", () => {
  beforeEach(() => {
    previewOrgTournamentFixtures.mockReset();
    createOrgTournamentMatch.mockReset();
  });

  it("asks the server for a double round with a final", async () => {
    previewOrgTournamentFixtures.mockResolvedValue({
      preview: { format: "round-robin", totalMatches: 6, tbdMatches: 4, final: true, warnings: [] },
    });
    renderTab();

    fireEvent.change(screen.getByLabelText("Rounds"), { target: { value: "2" } });
    fireEvent.click(screen.getByLabelText("Add a final (1st v 2nd on the points table)"));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => expect(previewOrgTournamentFixtures).toHaveBeenCalledTimes(1));
    expect(previewOrgTournamentFixtures).toHaveBeenCalledWith(
      ORG_ID,
      TOURNAMENT_ID,
      expect.objectContaining({ format: "round-robin", legs: 2, withFinal: true })
    );
    expect(await screen.findByText(/6 concrete match\(es\).*plus the final \(1st v 2nd\)/)).toBeInTheDocument();
  });

  it("creates the final between the top two once the league is over", async () => {
    createOrgTournamentMatch.mockResolvedValue({});
    const { onSaved } = renderTab(finishedLeague);

    expect(screen.getByText("Bravo CC v Alpha CC (1st and 2nd on the points table)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create the final" }));

    await waitFor(() =>
      expect(createOrgTournamentMatch).toHaveBeenCalledWith(ORG_ID, TOURNAMENT_ID, {
        team1: "t2",
        team2: "t1",
        stage: "final",
        stageLabel: "Final",
      })
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("Final added: 1st v 2nd on the points table."));
  });

  it("waits while a league match is unfinished, and once the final exists", () => {
    const { unmount } = render(
      <FixturesTab orgId={ORG_ID} tournamentId={TOURNAMENT_ID} detail={detail} fixtures={[leagueMatch("upcoming", 1)]} canFixture onSaved={vi.fn()} onError={vi.fn()} />
    );
    expect(screen.getByText("Every league match must be finished first.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create the final" })).toBeDisabled();
    unmount();

    renderTab([...finishedLeague, { _id: "f", status: "upcoming", stage: "final", teams: [bravo, alpha] }]);
    expect(screen.getByText("The final is already in the fixtures.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create the final" })).toBeDisabled();
  });
});
