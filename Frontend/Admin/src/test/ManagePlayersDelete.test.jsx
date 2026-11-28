import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import ManagePlayers from "../pages/ManagePlayers";
import playersReducer from "../store/slices/playersSlice";
import teamsReducer from "../store/slices/teamSlice";
import api from "../services/api";

vi.mock("../services/api", () => ({
  default: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const showToast = vi.hoisted(() => vi.fn());
vi.mock("../components/Toast", () => ({ useToast: () => ({ showToast }) }));
// The real modal relies on the app's automatic JSX runtime; a plain confirm
// button is all these tests need.
vi.mock("../components/ConfirmModal", async () => {
  const { createElement } = await import("react");
  return {
    default: ({ open, confirmLabel, onConfirm }) =>
      open ? createElement("button", { onClick: onConfirm }, confirmLabel || "Confirm") : null,
  };
});

const player = {
  _id: "player-1",
  name: "Ali Khan",
  playingRole: "Batsman",
  battingStyle: "Right-handed",
  bowlingStyle: "Right-arm Fast",
  category: "Other",
  ageGroup: "Open",
  team: null,
  address: { country: "Pakistan" },
  gallery: [],
  videos: [],
  socialLinks: {},
  privacy: {},
  stats: {},
};

function renderPage() {
  api.get.mockImplementation((url) => {
    if (url.startsWith("/players?")) {
      return Promise.resolve({ data: { players: [player], totalPlayers: 1, totalPages: 1, currentPage: 1 } });
    }
    return Promise.resolve({ data: [] });
  });
  const store = configureStore({ reducer: { players: playersReducer, teams: teamsReducer } });
  return render(
    <Provider store={store}>
      <MemoryRouter>
        <ManagePlayers />
      </MemoryRouter>
    </Provider>
  );
}

// B16: the API now refuses to delete a player who has cricket records. The page
// must say so instead of failing silently or claiming success.
describe("Admin ManagePlayers — refused deletes", () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    api.delete.mockReset();
    showToast.mockReset();
  });

  it("shows the server's reason when a player cannot be deleted", async () => {
    const reason = "Ali Khan has cricket records (3 matches). Merge this player into the right profile instead of deleting.";
    api.delete.mockRejectedValue({ response: { status: 409, data: { message: reason, code: "PLAYER_HAS_HISTORY" } } });
    renderPage();
    await screen.findByText("Ali Khan");

    fireEvent.click(screen.getByRole("button", { name: "Delete player" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(reason, "error"));
    expect(api.delete).toHaveBeenCalledWith("/players/player-1");
    expect(screen.getByText("Ali Khan")).toBeTruthy();
  });

  it("does not report success when a bulk delete is refused", async () => {
    const reason = "1 selected player has cricket records (Ali Khan). Merge that player instead of deleting. Nothing was deleted.";
    api.post.mockRejectedValue({ response: { status: 409, data: { message: reason, code: "PLAYER_HAS_HISTORY" } } });
    renderPage();
    await screen.findByText("Ali Khan");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Ali Khan" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Selected (1)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete All" }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(reason, "error"));
    expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining("Successfully deleted"), "success");
  });
});
