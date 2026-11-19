import React, { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("../services/api", () => ({
  default: { put: vi.fn(), get: vi.fn() },
}));

import MatchSetupWizard from "../components/ScoreManagement/MatchSetupWizard";

const squadA = Array.from({ length: 19 }, (_, index) => ({
  _id: `a${index + 1}`,
  name: `Sky Player ${index + 1}`,
  playingRole: index < 5 ? "Batsman" : "Bowler",
}));
const squadB = Array.from({ length: 19 }, (_, index) => ({
  _id: `b${index + 1}`,
  name: `Star Player ${index + 1}`,
  playingRole: index < 5 ? "Batsman" : "Bowler",
}));

const teamA = { _id: "team-a", name: "Sky Sports", players: squadA.slice(0, 7) };
const teamB = { _id: "team-b", name: "Young Star", players: squadB.slice(0, 6) };

const match = {
  _id: "match-1",
  status: "upcoming",
  teams: [teamA, teamB],
  playingXI: [],
  twelfthMan: [],
  rules: { twelfthManEnabled: true },
};

const squads = {
  matchId: "match-1",
  teams: [
    { team: { _id: "team-a", name: "Sky Sports" }, squad: squadA, squadSource: "tournament", squadSize: 19 },
    { team: { _id: "team-b", name: "Young Star" }, squad: squadB, squadSource: "tournament", squadSize: 19 },
  ],
  rules: { twelfthMan: { enabled: true, platformEnabled: true, scopedEnabled: true } },
};

const initialSetup = {
  team1XI: [],
  team2XI: [],
  team1TwelfthMan: "",
  team2TwelfthMan: "",
  team1SuperSub: "",
  team2SuperSub: "",
  matchFormat: "T20",
  totalOvers: 20,
  powerplayEnabled: true,
  powerplayOvers: 6,
  tossWinner: "",
  tossDecision: "bat",
  strikerId: "",
  nonStrikerId: "",
  bowlerId: "",
};

function Harness({
  onSave = vi.fn(),
  matchSquadsData = squads,
  matchSquadsLoading = false,
  matchSquadsError = "",
  onRetryLoadSquads = vi.fn(),
}) {
  const [setupState, setSetupState] = useState(initialSetup);
  return (
    <MatchSetupWizard
      wizardStep={2}
      selectedMatch={match}
      setSelectedMatch={vi.fn()}
      setupState={setupState}
      setSetupState={setSetupState}
      setWizardStep={vi.fn()}
      handleSaveFormat={vi.fn()}
      handleSavePlayingXI={onSave}
      handleContinueToToss={vi.fn()}
      handleSaveToss={vi.fn()}
      handleSaveOpeners={vi.fn()}
      matchSquads={matchSquadsData}
      matchSquadsLoading={matchSquadsLoading}
      matchSquadsError={matchSquadsError}
      onRetryLoadSquads={onRetryLoadSquads}
      twelfthManRule={{ enabled: true, platformEnabled: true, scopedEnabled: true }}
      battingXI={[]}
      bowlingXI={[]}
    />
  );
}

const squadGroup = (name) => screen.getByRole("group", { name: `${name} full squad` });

const pickFirst = (group, count) => {
  const buttons = within(group).getAllByRole("button");
  buttons.slice(0, count).forEach((button) => fireEvent.click(button));
};

describe("MatchSetupWizard full squad picker", () => {
  it("lists all 19 competition players even when the team roster only has 7", () => {
    render(<Harness />);

    expect(screen.getAllByText(/19 players available \(tournament squad\)/i)).toHaveLength(2);
    expect(within(squadGroup("Sky Sports")).getAllByRole("button")).toHaveLength(19);
    expect(within(squadGroup("Young Star")).getAllByRole("button")).toHaveLength(19);
    expect(screen.getAllByText("0 / 11")).toHaveLength(2);
  });

  it("disables Save until both teams have exactly 11 players", () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);

    const save = screen.getByRole("button", { name: /Save Playing XIs/i });
    expect(save).toBeDisabled();

    pickFirst(squadGroup("Sky Sports"), 10);
    expect(screen.getByText("10 / 11")).toBeInTheDocument();
    expect(save).toBeDisabled();

    fireEvent.click(within(squadGroup("Sky Sports")).getAllByRole("button")[10]);
    expect(screen.getByText("11 / 11")).toBeInTheDocument();
    expect(save).toBeDisabled();

    pickFirst(squadGroup("Young Star"), 11);
    expect(save).toBeEnabled();

    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("offers separate, exclusive 12th Man and Super Sub pickers outside the XI", () => {
    render(<Harness />);

    pickFirst(squadGroup("Sky Sports"), 11);
    pickFirst(squadGroup("Young Star"), 11);

    expect(screen.getAllByText("Super Sub enabled")).toHaveLength(2);

    const twelfth = screen.getByLabelText("Sky Sports 12th Man");
    const superSub = screen.getByLabelText("Sky Sports Super Sub");
    const optionLabels = (select) =>
      Array.from(select.querySelectorAll("option")).map((option) => option.textContent);

    expect(optionLabels(twelfth)[0]).toBe("No 12th Man");
    expect(optionLabels(superSub)[0]).toBe("No Super Sub");
    expect(optionLabels(twelfth)).toContain("Sky Player 12");
    expect(optionLabels(twelfth)).not.toContain("Sky Player 1");
    expect(optionLabels(twelfth)).not.toContain("Sky Player 11");

    fireEvent.change(twelfth, { target: { value: "a12" } });
    expect(optionLabels(superSub)).not.toContain("Sky Player 12");
    fireEvent.change(superSub, { target: { value: "a13" } });
    expect(optionLabels(twelfth)).not.toContain("Sky Player 13");
  });

  it("clears a reserve role and explains it when that player is added to the XI", () => {
    render(<Harness />);

    pickFirst(squadGroup("Sky Sports"), 11);
    fireEvent.change(screen.getByLabelText("Sky Sports 12th Man"), { target: { value: "a12" } });
    fireEvent.change(screen.getByLabelText("Sky Sports Super Sub"), { target: { value: "a13" } });

    const players = within(squadGroup("Sky Sports")).getAllByRole("button");
    fireEvent.click(players[0]); // make room in the XI
    fireEvent.click(within(squadGroup("Sky Sports")).getAllByRole("button")[11]); // Sky Player 12

    expect(screen.getByLabelText("Sky Sports 12th Man")).toHaveValue("");
    expect(screen.getByLabelText("Sky Sports Super Sub")).toHaveValue("a13");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Sky Player 12 was removed as 12th Man because they are now in the Playing XI."
    );
  });

  it("filters the picker with the search box", () => {
    render(<Harness />);

    fireEvent.change(screen.getAllByPlaceholderText(/Search player/i)[0], {
      target: { value: "Sky Player 19" },
    });

    const buttons = within(squadGroup("Sky Sports")).getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent("Sky Player 19");
  });

  it("does not fall back to the capped Team.players list when full squads fail to load", () => {
    const retry = vi.fn();
    render(
      <Harness
        matchSquadsData={null}
        matchSquadsError="temporary network failure"
        onRetryLoadSquads={retry}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("temporary network failure");
    expect(screen.queryByRole("group", { name: "Sky Sports full squad" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save Playing XIs/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
