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
  default: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

// The real provider renders toasts; the page only needs the hook. Mocking it
// also keeps these tests independent of the toast runtime/JSX config.
vi.mock("../components/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

function makePlayer(overrides = {}) {
  return {
    _id: "player-1",
    name: "Edit Me",
    playingRole: "Batsman",
    battingPosition: "middle_order",
    battingStyle: "Right-handed",
    bowlingStyle: "Right-arm Fast",
    category: "Other",
    subCategory: "",
    ageGroup: "Open",
    organization: "",
    imageUrl: "",
    phone: "",
    jerseyNumber: null,
    isPartTimeBowler: false,
    team: null,
    address: { town: "", district: "", city: "", province: "", country: "Pakistan" },
    gallery: [],
    videos: [],
    socialLinks: { facebook: "", instagram: "", twitter: "", youtube: "", whatsapp: "" },
    privacy: {
      contactInfo: "public",
      socialLinks: "public",
      location: "public",
      gallery: "public",
      videos: "public",
    },
    stats: {},
    ...overrides,
  };
}

function renderPage(player) {
  api.get.mockImplementation((url) => {
    if (url.startsWith("/players?")) {
      return Promise.resolve({
        data: { players: [player], totalPlayers: 1, totalPages: 1, currentPage: 1 },
      });
    }
    if (url === "/teams") return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
  api.put.mockImplementation((url, data) =>
    Promise.resolve({ data: { ...player, ...data } })
  );

  const store = configureStore({
    reducer: { players: playersReducer, teams: teamsReducer },
  });

  return render(
    <Provider store={store}>
      <MemoryRouter>
        <ManagePlayers />
      </MemoryRouter>
    </Provider>
  );
}

async function openEdit(expectedPosition = "middle_order") {
  await screen.findByText("Edit Me");
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  await waitFor(() => {
    expect(document.querySelector('select[name="battingPosition"]')?.value).toBe(expectedPosition);
  });
  return document.querySelector('select[name="battingPosition"]');
}

describe("Admin ManagePlayers — batting position edit", () => {
  beforeEach(() => {
    api.get.mockReset();
    api.put.mockReset();
  });

  it("opens the edit form with the stored position pre-selected", async () => {
    renderPage(makePlayer({ battingPosition: "lower_order" }));
    const select = await openEdit("lower_order");

    expect(select.value).toBe("lower_order");
    expect(screen.getByRole("heading", { name: "Edit Personnel" })).toBeTruthy();
  });

  it("saves a changed position from the edit form", async () => {
    renderPage(makePlayer());
    const select = await openEdit();

    fireEvent.change(select, { target: { value: "opener" } });
    fireEvent.click(screen.getByRole("button", { name: /update file/i }));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put).toHaveBeenCalledWith(
      "/players/player-1",
      expect.objectContaining({ battingPosition: "opener" })
    );
  });

  it("clears the position back to Not set and sends an explicit empty value", async () => {
    renderPage(makePlayer());
    const select = await openEdit();

    fireEvent.change(select, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /update file/i }));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put).toHaveBeenCalledWith(
      "/players/player-1",
      expect.objectContaining({ battingPosition: "" })
    );
  });
});
