import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import MyPlayers from "../pages/MyPlayers";
import { listMyPlayers, updateMyPlayer } from "../services/playerApi";

vi.mock("../services/playerApi", () => ({
  createMyPlayer: vi.fn(),
  deleteMyPlayer: vi.fn(),
  listMyPlayers: vi.fn(),
  updateMyPlayer: vi.fn(),
}));

vi.mock("../pages/auth/auth", () => ({
  useStoredUser: () => ({ _id: "user-1", name: "Owner", emailVerified: true }),
}));

function makePlayer(overrides = {}) {
  return {
    _id: "player-1",
    name: "Owner Player",
    playingRole: "Batsman",
    battingPosition: "middle_order",
    battingStyle: "Right-handed",
    bowlingStyle: "Right-arm Fast",
    category: "Other",
    ageGroup: "Open",
    organization: "",
    imageUrl: "",
    address: { town: "", district: "", city: "", province: "" },
    team: null,
    ...overrides,
  };
}

function renderPage(player) {
  listMyPlayers.mockResolvedValue({ items: [player], total: 1 });
  updateMyPlayer.mockImplementation((id, payload) =>
    Promise.resolve({ ...player, ...payload })
  );

  return render(
    <MemoryRouter>
      <MyPlayers />
    </MemoryRouter>
  );
}

async function openEdit(player) {
  await screen.findByText(player.name);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Edit player" })).toBeTruthy());
  return screen.getByLabelText("Batting position");
}

describe("User MyPlayers — batting position edit", () => {
  beforeEach(() => {
    listMyPlayers.mockReset();
    updateMyPlayer.mockReset();
  });

  it("opens the edit form with the stored position pre-selected", async () => {
    const player = makePlayer({ battingPosition: "lower_order" });
    renderPage(player);
    const select = await openEdit(player);

    expect(select.value).toBe("lower_order");
  });

  it("saves a changed position", async () => {
    const player = makePlayer();
    renderPage(player);
    const select = await openEdit(player);

    fireEvent.change(select, { target: { value: "opener" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateMyPlayer).toHaveBeenCalledTimes(1));
    expect(updateMyPlayer).toHaveBeenCalledWith(
      "player-1",
      expect.objectContaining({ battingPosition: "opener" })
    );
  });

  it("clears the position back to Not set without dropping it from the payload", async () => {
    const player = makePlayer();
    renderPage(player);
    const select = await openEdit(player);

    fireEvent.change(select, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateMyPlayer).toHaveBeenCalledTimes(1));
    const payload = updateMyPlayer.mock.calls[0][1];
    expect(payload).toHaveProperty("battingPosition", "");
  });
});
