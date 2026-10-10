import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "../store/slices/authSlice";
import Sidebar from "../components/Sidebar";

const CORE_ITEMS = [
  "Dashboard",
  "Live Scores",
  "Live Scoring",
  "Manage Events",
  "Tournaments",
  "Manage Teams",
  "Organizations",
  "Manage Players",
  "Bulk Import",
  "Manage Blogs",
  "Rankings",
  "Sync Panel",
];

function renderSidebar({ role = "admin", route = "/admin", flags = {} } = {}) {
  for (const [key, value] of Object.entries(flags)) vi.stubEnv(key, value);
  const store = configureStore({
    reducer: { auth: authReducer },
    preloadedState: {
      auth: {
        user: { _id: "1", name: "Test Admin", email: "t@example.test", role },
        token: "test-token",
        loading: false,
        error: null,
      },
    },
  });
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[route]}>
        <Sidebar open onClose={() => {}} />
      </MemoryRouter>
    </Provider>
  );
}

const navLink = (label) => screen.getByRole("link", { name: new RegExp(label) });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Admin Sidebar", () => {
  it("renders every core navigation item", () => {
    renderSidebar();
    for (const label of CORE_ITEMS) {
      expect(navLink(label)).toBeInTheDocument();
    }
  });

  it("hides International and Handler Requests by default", () => {
    renderSidebar();
    expect(screen.queryByRole("link", { name: /International/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Handler Requests/ })).toBeNull();
  });

  it("reveals International and Handler Requests when the admin flags are on", () => {
    renderSidebar({
      flags: {
        VITE_SHOW_ADMIN_INTERNATIONAL: "true",
        VITE_SHOW_ADMIN_HANDLER_REQUESTS: "true",
      },
    });
    expect(navLink("International")).toBeInTheDocument();
    expect(navLink("Handler Requests")).toBeInTheDocument();
  });

  it("shows Manage Admins only to a superadmin", () => {
    const { unmount } = renderSidebar({ role: "admin" });
    expect(screen.queryByRole("link", { name: /Manage Admins/ })).toBeNull();
    unmount();

    renderSidebar({ role: "superadmin" });
    expect(navLink("Manage Admins")).toBeInTheDocument();
  });

  it("marks the active route and makes the nav a scrollable flex child", () => {
    renderSidebar({ route: "/admin" });
    expect(navLink("Dashboard")).toHaveAttribute("aria-current", "page");

    const nav = document.querySelector("nav");
    expect(nav.className).toContain("min-h-0");
    expect(nav.className).toContain("overflow-y-auto");
  });

  it("keeps a route reachable even when its nav entry is hidden", () => {
    renderSidebar();
    expect(screen.queryByRole("link", { name: /Handler Requests/ })).toBeNull();
    expect(navLink("Sync Panel")).toHaveAttribute("href", "/admin/sync");
  });
});
