import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import matchesReducer from "../store/slices/matchesSlice";
import { Home } from "../pages/Home";
import { api } from "../services/api";

vi.mock("../services/api", () => ({ api: { get: vi.fn() } }));
vi.mock("../services/socket", () => ({ initSocket: () => ({ on: vi.fn(), off: vi.fn() }) }));
vi.mock("../hooks/useCricketProviderStatus", () => ({
  useCricketProviderStatus: () => ({ configured: false }),
  isProviderConfigured: () => false,
}));
vi.mock("../components/Register", () => ({ default: () => <div>register form</div> }));
vi.mock("../components/CreatePlayerProfile", () => ({ default: () => null }));
vi.mock("../components/BlogGallery", () => ({ default: () => null }));
vi.mock("../components/GlobalSearch", () => ({ default: () => null }));
vi.mock("../components/ads/AdSlot", () => ({ default: () => null }));

const renderHome = async () => {
  const store = configureStore({ reducer: { matches: matchesReducer } });
  const view = render(
    <Provider store={store}>
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    </Provider>,
  );
  await waitFor(() => expect(store.getState().matches.status).toBe("succeeded"));
  return view;
};

beforeEach(() => {
  localStorage.clear();
  api.get.mockReset();
  api.get.mockResolvedValue({ data: [] });
});

describe("Home sidebar copy", () => {
  it("shows no hardcoded trending tags", async () => {
    const { container } = await renderHome();
    expect(screen.queryByText("Trending")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent(/#\w+/);
  });

  it("invites organizations instead of handlers", async () => {
    const { container } = await renderHome();
    expect(container).not.toHaveTextContent(/handler/i);
    expect(screen.getByText(/can register as organizations/i)).toBeInTheDocument();

    // Same entry point as before: the registration form still opens.
    fireEvent.click(screen.getByRole("button", { name: "Join as Player or Organization" }));
    expect(screen.getByText("register form")).toBeInTheDocument();
  });
});
