import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AwardsTab } from "../pages/organization/OrgTournamentDetail";
import { setOrgTournamentOfficialAwards } from "../services/organizationApi";

vi.mock("../services/organizationApi", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    setOrgTournamentAwards: vi.fn(),
    setOrgTournamentOfficialAwards: vi.fn(),
  };
});

const ORG_ID = "a".repeat(24);
const TOURNAMENT_ID = "b".repeat(24);

const detail = {
  _id: TOURNAMENT_ID,
  name: "Charity Cup",
  status: "completed",
  teams: [{ _id: "teamA", name: "Alpha CC" }],
  winner: { _id: "teamA" },
  awards: {},
  officialAwards: {
    topPlayers: [{ _id: "p1" }, { _id: "p2" }],
    bestBatsman: { _id: "p1" },
    bestBowler: { _id: "p3" },
    bestFielder: { _id: "p2" },
    emergingPlayer: { _id: "p4" },
    citations: { bestFielder: "18 dismissals" },
    customAwards: [{ title: "Best Catch", player: { _id: "p3" }, citation: "Final overhead" }],
    note: "Presented at the final",
    published: false,
  },
};

const squads = [
  {
    team: { _id: "teamA", name: "Alpha CC" },
    players: [
      { _id: "p1", name: "Ann" },
      { _id: "p2", name: "Ben" },
      { _id: "p3", name: "Cleo" },
      { _id: "p4", name: "Dev" },
    ],
  },
];

function renderTab({ canManage = true } = {}) {
  const onSaved = vi.fn();
  const onError = vi.fn();
  render(
    <AwardsTab
      orgId={ORG_ID}
      tournamentId={TOURNAMENT_ID}
      detail={detail}
      squads={squads}
      canManage={canManage}
      onSaved={onSaved}
      onError={onError}
    />,
  );
  return { onSaved, onError };
}

beforeEach(() => {
  vi.clearAllMocks();
  setOrgTournamentOfficialAwards.mockResolvedValue({});
});

describe("organization official awards editor", () => {
  it("loads every saved honour and saves citations, custom awards and publication", async () => {
    const { onSaved } = renderTab();

    expect(screen.getByLabelText("1st place")).toHaveValue("p1");
    expect(screen.getByLabelText("Official best fielder / wicketkeeper")).toHaveValue("p2");
    expect(screen.getByLabelText("Official emerging player")).toHaveValue("p4");
    expect(screen.getByLabelText("Official best fielder / wicketkeeper citation")).toHaveValue("18 dismissals");
    expect(screen.getByLabelText("Custom award 1 title")).toHaveValue("Best Catch");
    expect(screen.getByRole("checkbox", { name: /Publish on the public tournament page/i })).not.toBeChecked();

    fireEvent.change(screen.getByLabelText("Official best fielder / wicketkeeper citation"), {
      target: { value: "Twenty dismissals" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add custom award" }));
    fireEvent.change(screen.getByLabelText("Custom award 2 title"), { target: { value: "Final Catch" } });
    fireEvent.change(screen.getByLabelText("Custom award 2 player"), { target: { value: "p4" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Publish on the public tournament page/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save official awards" }));

    await waitFor(() => expect(setOrgTournamentOfficialAwards).toHaveBeenCalledTimes(1));
    expect(setOrgTournamentOfficialAwards).toHaveBeenCalledWith(
      ORG_ID,
      TOURNAMENT_ID,
      expect.objectContaining({
        topPlayers: ["p1", "p2"],
        bestBatsman: "p1",
        bestBowler: "p3",
        bestFielder: "p2",
        emergingPlayer: "p4",
        citations: expect.objectContaining({ bestFielder: "Twenty dismissals" }),
        customAwards: [
          { title: "Best Catch", player: "p3", citation: "Final overhead" },
          { title: "Final Catch", player: "p4", citation: "" },
        ],
        note: "Presented at the final",
        published: true,
      }),
    );
    expect(onSaved).toHaveBeenCalledWith("Official awards saved.");
  });

  it("keeps publication read-only for org viewers", () => {
    renderTab({ canManage: false });

    expect(screen.queryByRole("button", { name: "Save official awards" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("1st place")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Publish on the public tournament page/i })).toBeDisabled();
  });
});
