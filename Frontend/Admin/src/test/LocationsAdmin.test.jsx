import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}));
vi.mock("../services/api", () => ({ default: api }));

import Locations from "../pages/Locations";

const LOCATIONS = [
  {
    _id: "pb",
    type: "province",
    name: "Punjab",
    parent: "pk",
    active: true,
    approved: true,
    source: "Seed v1",
    aliases: [],
  },
  {
    _id: "sd",
    type: "province",
    name: "Sindh",
    parent: "pk",
    active: true,
    approved: true,
    source: "Seed v1",
    aliases: [],
  },
];

function mockApi() {
  api.get.mockImplementation(async (url) => {
    if (url === "/locations/admin/suggestions") {
      return {
        data: {
          locations: [
            {
              _id: "sug1",
              type: "city",
              name: "Suggested Area",
              parent: "lhr",
              approved: false,
              createdAt: "2026-11-01T00:00:00.000Z",
              createdBy: { name: "A User" },
            },
          ],
        },
      };
    }
    return { data: { locations: LOCATIONS } };
  });
  api.post.mockResolvedValue({ data: { location: { _id: "new" } } });
  api.patch.mockResolvedValue({ data: { location: {} } });
}

describe("Admin Locations page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi();
  });

  it("lists the tree, filters by level and can deactivate a node", async () => {
    render(
      <MemoryRouter>
        <Locations />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Locations" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("Punjab").length).toBeGreaterThan(0));

    // Level + search are sent to the admin endpoint.
    expect(api.get).toHaveBeenCalledWith(
      "/locations/admin",
      expect.objectContaining({ params: expect.objectContaining({ type: "province" }) })
    );

    const buttons = screen.getAllByRole("button", { name: "Deactivate" });
    fireEvent.click(buttons[0]);
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/locations/admin/pb", { active: false })
    );
  });

  it("adds a node with a parent of the level above", async () => {
    render(
      <MemoryRouter>
        <Locations />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getAllByText("Punjab").length).toBeGreaterThan(0));

    fireEvent.change(screen.getByLabelText("New location level"), { target: { value: "city" } });
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        "/locations/admin",
        expect.objectContaining({ params: expect.objectContaining({ type: "district" }) })
      )
    );

    fireEvent.change(screen.getByLabelText("New location parent"), { target: { value: "sd" } });
    fireEvent.change(screen.getByLabelText("New location name"), { target: { value: "New City" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/locations/admin",
        expect.objectContaining({ type: "city", name: "New City", parent: "sd" })
      )
    );
  });

  it("approves and rejects suggestions in the review queue", async () => {
    render(
      <MemoryRouter>
        <Locations />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /Suggestions/ }));
    await waitFor(() => expect(screen.getByText(/Suggested Area/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/locations/admin/sug1/approve"));

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/locations/admin/sug1/reject"));
    confirmSpy.mockRestore();
  });

  it("merges a suggestion into an existing node by id", async () => {
    render(
      <MemoryRouter>
        <Locations />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /Suggestions/ }));
    await waitFor(() => expect(screen.getByText(/Suggested Area/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Merge Suggested Area into"), { target: { value: "lhr-city" } });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/locations/admin/sug1/merge", { intoId: "lhr-city" })
    );
    confirmSpy.mockRestore();
  });
});
