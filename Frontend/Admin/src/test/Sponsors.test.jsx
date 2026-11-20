import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Sponsors from "../pages/Sponsors";
import api from "../services/api";

vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  API_BASE_URL: "http://localhost:5000/api",
}));

vi.mock("../components/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

const TOURNAMENT_ID = "c".repeat(24);
const tournaments = [{ _id: TOURNAMENT_ID, name: "Premier Cup" }];
const sponsors = [
  {
    _id: "s1",
    name: "Title Co",
    logoUrl: "/uploads/title.png",
    linkUrl: "https://title.example",
    tier: "title",
    order: 0,
    active: true,
    scope: "tournament",
    tournamentRef: TOURNAMENT_ID,
  },
  {
    _id: "s2",
    name: "Platform Co",
    logoUrl: "/uploads/platform.png",
    linkUrl: "",
    tier: "supporting",
    order: 1,
    active: true,
    scope: "platform",
    tournamentRef: null,
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <Sponsors />
    </MemoryRouter>
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.put.mockReset();
  api.delete.mockReset();
  api.get.mockImplementation((url) => {
    if (url === "/tournaments") return Promise.resolve({ data: tournaments });
    if (url === "/admin/sponsors") return Promise.resolve({ data: sponsors });
    return Promise.resolve({ data: [] });
  });
  api.post.mockResolvedValue({ data: {} });
  api.put.mockResolvedValue({ data: sponsors });
  api.delete.mockResolvedValue({ data: { message: "Sponsor deleted" } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Sponsors (admin)", () => {
  it("loads the catalog and re-queries when the tournament filter changes", async () => {
    renderPage();

    expect(await screen.findByTestId("sponsors-title")).toHaveTextContent("Local sponsors");
    expect(api.get).toHaveBeenCalledWith("/tournaments");
    expect(api.get).toHaveBeenCalledWith("/admin/sponsors", {});
    expect(within(screen.getByTestId("sponsor-list")).getByText("Title Co")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Tournament filter"), {
      target: { value: TOURNAMENT_ID },
    });
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith("/admin/sponsors", {
        params: { tournamentId: TOURNAMENT_ID },
      })
    );
  });

  it("creates a tournament sponsor with scope and tenant fields", async () => {
    renderPage();
    await screen.findByTestId("sponsors-title");

    fireEvent.change(screen.getByLabelText("Sponsor name"), { target: { value: "New Co" } });
    fireEvent.change(screen.getByLabelText("Logo URL"), { target: { value: "/uploads/new.png" } });
    fireEvent.change(screen.getByLabelText("Link URL"), { target: { value: "https://new.example" } });
    fireEvent.change(screen.getByLabelText("Tournament"), { target: { value: TOURNAMENT_ID } });
    fireEvent.click(screen.getByRole("button", { name: "Add sponsor" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/admin/sponsors", {
        name: "New Co",
        logoUrl: "/uploads/new.png",
        linkUrl: "https://new.example",
        tier: "supporting",
        order: 0,
        active: true,
        scope: "tournament",
        tournamentRef: TOURNAMENT_ID,
      })
    );
  });

  it("creates a platform-wide sponsor without a tournament reference", async () => {
    renderPage();
    await screen.findByTestId("sponsors-title");

    fireEvent.change(screen.getByLabelText("Sponsor name"), { target: { value: "Global Co" } });
    fireEvent.change(screen.getByLabelText("Logo URL"), { target: { value: "/uploads/global.png" } });
    fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "platform" } });
    fireEvent.click(screen.getByRole("button", { name: "Add sponsor" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/admin/sponsors",
        expect.objectContaining({ scope: "platform", tournamentRef: null })
      )
    );
  });

  it("uploads a logo through the sponsor-specific field and fills the URL", async () => {
    renderPage();
    await screen.findByTestId("sponsors-title");
    api.post.mockResolvedValueOnce({ data: { url: "/uploads/uploaded.png" } });

    const file = new File(["png-bytes"], "logo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Logo file"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload logo" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/admin/sponsors/logo",
        expect.any(FormData),
        expect.objectContaining({ headers: { "Content-Type": "multipart/form-data" } })
      )
    );
    expect(screen.getByLabelText("Logo URL")).toHaveValue("/uploads/uploaded.png");
  });

  it("deactivates and reorders sponsors through the admin routes", async () => {
    renderPage();
    await screen.findByTestId("sponsors-title");

    fireEvent.click(within(screen.getByTestId("sponsor-list")).getAllByRole("button", { name: "Deactivate" })[0]);
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/admin/sponsors/s1", { active: false })
    );

    fireEvent.click(screen.getByRole("button", { name: "Move Platform Co up" }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/admin/sponsors/reorder", { ids: ["s2", "s1"] })
    );
  });

  it("deletes a sponsor and confirms the deletion is audited", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    await screen.findByTestId("sponsors-title");

    fireEvent.click(within(screen.getByTestId("sponsor-list")).getAllByRole("button", { name: "Delete" })[0]);
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/admin/sponsors/s1"));
  });
});
