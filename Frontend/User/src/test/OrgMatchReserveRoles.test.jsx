import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../services/organizationApi", () => ({
  addOrgTeamPlayer: vi.fn(),
  createOrgMatch: vi.fn(),
  createOrganizationIssue: vi.fn(),
  getMatchDetail: vi.fn(),
  getMatchSquads: vi.fn(),
  listOrgMatches: vi.fn(),
  listOrgTeamsManaged: vi.fn(),
  setMatchPlayingXI: vi.fn(),
  setMatchSuperSub: vi.fn(),
  setMatchTeamRoles: vi.fn(),
  setMatchToss: vi.fn(),
  setMatchTwelfthMan: vi.fn(),
  updateOrgMatch: vi.fn(),
}));

import { MatchSetup } from "../pages/organization/OrgMatches";
import {
  getMatchDetail,
  getMatchSquads,
  setMatchSuperSub,
} from "../services/organizationApi";

const teams = [
  { _id: "team-a", name: "Sky Sports" },
  { _id: "team-b", name: "Young Star" },
];
const squadA = Array.from({ length: 14 }, (_, i) => ({
  _id: `a${i + 1}`,
  name: `Sky Player ${i + 1}`,
  playingRole: "Batsman",
}));
const squadB = Array.from({ length: 11 }, (_, i) => ({
  _id: `b${i + 1}`,
  name: `Star Player ${i + 1}`,
}));
const match = { _id: "match-1", teams };

beforeEach(() => {
  vi.clearAllMocks();
  getMatchDetail.mockResolvedValue({
    playingXI: [{ team: "team-a", players: squadA.slice(0, 11) }],
    twelfthMan: [{ team: "team-a", player: "a12" }],
    superSub: [{ team: "team-a", player: "a13" }],
    teamRoles: [],
  });
  getMatchSquads.mockResolvedValue({
    teams: [
      { team: teams[0], squad: squadA, squadSource: "tournament" },
      { team: teams[1], squad: squadB, squadSource: "tournament" },
    ],
  });
});

describe("organization match setup reserve roles", () => {
  it("renders separate 12th Man and Super Sub selectors with exclusive options", async () => {
    render(<MatchSetup orgId="org-1" match={match} onClose={vi.fn()} onSaved={vi.fn()} />);

    const twelfth = await screen.findByLabelText("Sky Sports 12th Man");
    const superSub = screen.getByLabelText("Sky Sports Super Sub");
    expect(twelfth).toHaveValue("a12");
    expect(superSub).toHaveValue("a13");
    expect(Array.from(superSub.options).map((option) => option.textContent)).not.toContain("Sky Player 12");
    expect(Array.from(twelfth.options).map((option) => option.textContent)).not.toContain("Sky Player 13");

    fireEvent.change(twelfth, { target: { value: "a14" } });
    expect(twelfth).toHaveValue("a14");
    expect(superSub).toHaveValue("a13");
    expect(Array.from(twelfth.options).map((option) => option.textContent)).not.toContain("Sky Player 13");
  });

  it("clears a reserve role with a non-blocking message when that player joins the XI", async () => {
    render(<MatchSetup orgId="org-1" match={match} onClose={vi.fn()} onSaved={vi.fn()} />);

    await screen.findByLabelText("Sky Sports 12th Man");
    fireEvent.click(screen.getAllByRole("button", { pressed: true })[0]); // free an XI slot
    fireEvent.click(screen.getByRole("button", { name: /Sky Player 13/ }));

    expect(screen.getByLabelText("Sky Sports Super Sub")).toHaveValue("");
    expect(screen.getByText("Sky Player 13 was removed as Super Sub because they are now in the Playing XI."))
      .toBeInTheDocument();
    expect(screen.getByLabelText("Sky Sports 12th Man")).toHaveValue("a12");
  });

  it("saves the separate Super Sub nomination through its own endpoint", async () => {
    render(<MatchSetup orgId="org-1" match={match} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText("Sky Sports Super Sub"), {
      target: { value: "a14" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save setup/i }));
    });

    expect(setMatchSuperSub).toHaveBeenCalledWith("match-1", "team-a", "a14");
  });
});
