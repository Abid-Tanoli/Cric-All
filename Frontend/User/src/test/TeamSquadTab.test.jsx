import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import TeamProfile from "../pages/TeamProfile";
import {
  addOrgTeamNewPlayers,
  addOrgTeamPlayer,
  addOrgTeamPlayers,
  getMyOrgAccess,
  removeOrgTeamPlayers,
  searchOrgTeamAvailablePlayers,
} from "../services/organizationApi";
import { api } from "../services/api";
import { buildNewPlayerPayload, parsePlayerNames } from "../lib/squadAdd";

vi.mock("../services/api", () => ({
  api: { get: vi.fn() },
}));

vi.mock("../services/organizationApi", () => ({
  getMyOrgAccess: vi.fn(),
  addOrgTeamPlayer: vi.fn(),
  addOrgTeamPlayers: vi.fn(),
  addOrgTeamNewPlayers: vi.fn(),
  removeOrgTeamPlayers: vi.fn(),
  searchOrgTeamAvailablePlayers: vi.fn(),
}));

vi.mock("../pages/auth/auth", () => ({
  useStoredUser: () => globalThis.__TEST_USER__ ?? null,
}));

vi.mock("../community/CommunityConfigContext", () => ({
  useCommunityConfig: () => ({ enabled: false }),
}));

vi.mock("../community/ShareMenu", () => ({ default: () => null }));
vi.mock("../community/PostsTab", () => ({ default: () => null }));

// LocationSelect would fetch the whole location tree; the squad tests only care
// that the chosen refs/labels reach the request body, so the control is stubbed.
vi.mock("@shared/components/LocationSelect.jsx", () => ({
  default: () => <div data-testid="location-select" />,
}));

const team = (players = []) => ({
  _id: "team-1",
  name: "Crescent XI",
  players,
  organizationRef: { _id: "org-1", name: "Crescent Club" },
});

const squadPlayer = {
  _id: "player-1",
  name: "Sana Mir",
  playingRole: "Bowler",
  battingPosition: "",
  jerseyNumber: 27,
  stats: { runs: 10, wickets: 4, matches: 3 },
};

function renderTeam(profileTeam) {
  api.get.mockImplementation((url) => {
    if (String(url).startsWith("/teams/")) {
      return Promise.resolve({
        data: { data: { team: profileTeam, ranking: null, recentMatches: [], branches: [] } },
      });
    }
    return Promise.resolve({ data: [] });
  });

  return render(
    <MemoryRouter initialEntries={["/teams/team-1"]}>
      <Routes>
        <Route path="/teams/:id" element={<TeamProfile />} />
      </Routes>
    </MemoryRouter>
  );
}

async function openSquadTab() {
  await screen.findByText("Crescent XI");
  fireEvent.click(screen.getByRole("button", { name: "Squad" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.__TEST_USER__ = { _id: "user-1", name: "Owner" };
  getMyOrgAccess.mockResolvedValue({ permissions: ["manage_players"], roles: ["owner"] });
  addOrgTeamPlayer.mockResolvedValue({ message: "Player added to the team" });
  addOrgTeamPlayers.mockResolvedValue({ message: "Players added successfully" });
  addOrgTeamNewPlayers.mockResolvedValue({ message: "Players added successfully" });
  removeOrgTeamPlayers.mockResolvedValue({ message: "Players removed successfully" });
  searchOrgTeamAvailablePlayers.mockResolvedValue({ items: [], total: 0 });
});

afterEach(() => {
  globalThis.__TEST_USER__ = null;
});

describe("Team page Squad tab — manager actions", () => {
  it("shows the add and remove actions to somebody who may manage the squad", async () => {
    renderTeam(team([squadPlayer]));
    await openSquadTab();

    expect(await screen.findByRole("button", { name: /add players/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove sana mir from the squad/i })).toBeInTheDocument();
    expect(getMyOrgAccess).toHaveBeenCalledWith("org-1");
  });

  it("prints the shirt number on the squad card", async () => {
    renderTeam(team([squadPlayer, { ...squadPlayer, _id: "player-2", name: "No Number", jerseyNumber: null }]));
    await openSquadTab();

    expect(await screen.findByText("#27")).toBeInTheDocument();
    // A player with no number shows no badge rather than "#null" / "#0".
    expect(screen.queryByText("#null")).not.toBeInTheDocument();
    expect(screen.getByText("No Number")).toBeInTheDocument();
  });

  it("shows a visitor the current empty text and no actions", async () => {
    getMyOrgAccess.mockRejectedValue(new Error("You are not a member of this organization."));
    renderTeam(team([]));
    await openSquadTab();

    expect(await screen.findByText("No players in this team yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add players/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Add your first players")).not.toBeInTheDocument();
  });

  it("gives a manager without manage_players no squad actions", async () => {
    getMyOrgAccess.mockResolvedValue({ permissions: ["view_analytics"], roles: ["player"] });
    renderTeam(team([]));
    await openSquadTab();

    expect(await screen.findByText("No players in this team yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add players/i })).not.toBeInTheDocument();
  });

  it("invites the manager to add the first players on an empty squad", async () => {
    renderTeam(team([]));
    await openSquadTab();

    expect(await screen.findByText("Add your first players")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add players/i })).toBeInTheDocument();
  });
});

describe("Team page Squad tab — adding players", () => {
  it("creates a new player with the fields the form collected", async () => {
    renderTeam(team([]));
    await openSquadTab();

    fireEvent.click(await screen.findByRole("button", { name: /add players/i }));
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "  Sana Mir  " } });
    fireEvent.change(screen.getByLabelText("Playing role"), { target: { value: "Bowler" } });
    fireEvent.change(screen.getByLabelText("Batting style"), { target: { value: "Right-handed" } });
    fireEvent.change(screen.getByLabelText("Shirt number"), { target: { value: "27" } });
    fireEvent.click(screen.getByRole("button", { name: "Add player" }));

    await waitFor(() => expect(addOrgTeamPlayer).toHaveBeenCalledTimes(1));
    const [orgId, teamId, payload] = addOrgTeamPlayer.mock.calls[0];
    expect(orgId).toBe("org-1");
    expect(teamId).toBe("team-1");
    expect(payload).toMatchObject({
      name: "Sana Mir",
      playingRole: "Bowler",
      battingStyle: "Right-handed",
      jerseyNumber: 27,
      locationRefs: { countryId: null, provinceId: null, districtId: null, cityId: null, townId: null },
      locationLabels: { country: "", province: "", district: "", city: "", town: "" },
    });
    // Optionals the owner left blank are omitted, never sent as "".
    expect(payload.bowlingStyle).toBeUndefined();
    expect(await screen.findByRole("status")).toHaveTextContent(/was added to the squad/i);
  });

  it("previews a pasted list and only then creates the players", async () => {
    renderTeam(team([]));
    await openSquadTab();

    fireEvent.click(await screen.findByRole("button", { name: /add players/i }));
    fireEvent.click(screen.getByRole("tab", { name: "Add several" }));
    fireEvent.change(screen.getByLabelText("One name per line"), {
      target: { value: "Ali Raza\nSana Mir\n\nAli Raza\nBilal Shah" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(await screen.findByText("Will add 3 players")).toBeInTheDocument();
    expect(screen.getByText("Sana Mir")).toBeInTheDocument();
    expect(addOrgTeamNewPlayers).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Add 3 players" }));

    await waitFor(() => expect(addOrgTeamNewPlayers).toHaveBeenCalledTimes(1));
    expect(addOrgTeamNewPlayers).toHaveBeenCalledWith("org-1", "team-1", [
      { name: "Ali Raza" },
      { name: "Sana Mir" },
      { name: "Bilal Shah" },
    ]);
  });

  it("adds an existing player from the search results", async () => {
    searchOrgTeamAvailablePlayers.mockResolvedValue({
      items: [{ _id: "player-9", name: "Bilal Shah", playingRole: "Batsman", team: null }],
      total: 1,
    });
    renderTeam(team([]));
    await openSquadTab();

    fireEvent.click(await screen.findByRole("button", { name: /add players/i }));
    fireEvent.click(screen.getByRole("tab", { name: "Add existing" }));

    expect(await screen.findByText("Bilal Shah")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(addOrgTeamPlayers).toHaveBeenCalledWith("org-1", "team-1", ["player-9"]));
  });

  it("re-reads the available list after adding somebody, leaving no stale row", async () => {
    // First load shows a free agent; once they are on the squad the server stops
    // returning them. A picker that kept its first response would still offer
    // "Add" for a player who is already in the squad.
    searchOrgTeamAvailablePlayers
      .mockResolvedValueOnce({
        items: [{ _id: "player-9", name: "Bilal Shah", playingRole: "Batsman", team: null }],
        total: 1,
      })
      .mockResolvedValue({ items: [], total: 0 });

    renderTeam(team([]));
    await openSquadTab();

    fireEvent.click(await screen.findByRole("button", { name: /add players/i }));
    fireEvent.click(screen.getByRole("tab", { name: "Add existing" }));
    expect(await screen.findByText("Bilal Shah")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(addOrgTeamPlayers).toHaveBeenCalledWith("org-1", "team-1", ["player-9"]));
    await waitFor(() => expect(searchOrgTeamAvailablePlayers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("Bilal Shah")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
  });

  it("re-reads the available list after players are created and removed elsewhere", async () => {
    renderTeam(team([squadPlayer]));
    await openSquadTab();

    // A pasted list is created while the picker is not on screen.
    fireEvent.click(await screen.findByRole("button", { name: /add players/i }));
    fireEvent.click(screen.getByRole("tab", { name: "Add several" }));
    fireEvent.change(screen.getByLabelText("One name per line"), { target: { value: "Ali Raza" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("Will add 1 player")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add 1 player" }));
    await waitFor(() => expect(addOrgTeamNewPlayers).toHaveBeenCalledTimes(1));

    // Entering the picker after that change fetches a fresh list.
    fireEvent.click(screen.getByRole("tab", { name: "Add existing" }));
    await waitFor(() => expect(searchOrgTeamAvailablePlayers).toHaveBeenCalledTimes(1));

    // A removal elsewhere on the page bumps the signal, so the picker re-reads
    // again instead of keeping rows fetched before the squad changed.
    fireEvent.click(screen.getByRole("button", { name: /remove sana mir from the squad/i }));
    await waitFor(() => expect(removeOrgTeamPlayers).toHaveBeenCalledWith("org-1", "team-1", ["player-1"]));
    await waitFor(() => expect(searchOrgTeamAvailablePlayers).toHaveBeenCalledTimes(2));
  });

  it("removes a player from the squad without deleting the profile", async () => {
    renderTeam(team([squadPlayer]));
    await openSquadTab();

    fireEvent.click(await screen.findByRole("button", { name: /remove sana mir from the squad/i }));

    await waitFor(() => expect(removeOrgTeamPlayers).toHaveBeenCalledWith("org-1", "team-1", ["player-1"]));
  });
});

describe("squadAdd helpers", () => {
  it("builds the exact body the strict backend schema receives", () => {
    const payload = buildNewPlayerPayload({
      name: "  Ayesha Khan ",
      playingRole: "",
      jerseyNumber: "",
      locationRefs: { countryId: "c1", provinceId: null, districtId: null, cityId: null, townId: null },
      locationLabels: { country: "Pakistan", province: "", district: "", city: "", town: "" },
    });

    expect(payload).toEqual({
      name: "Ayesha Khan",
      locationRefs: { countryId: "c1", provinceId: null, districtId: null, cityId: null, townId: null },
      locationLabels: { country: "Pakistan", province: "", district: "", city: "", town: "" },
    });
    expect(buildNewPlayerPayload({ name: "   " })).toBeNull();
  });

  it("parses one name per line, trimming and de-duplicating", () => {
    expect(parsePlayerNames("Ali  Raza\r\n\r\n sana mir \nali raza\n")).toEqual(["Ali Raza", "sana mir"]);
  });
});
