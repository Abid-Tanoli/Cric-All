import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import TournamentContent from "../pages/TournamentContent";
import api from "../services/api";

vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  API_BASE_URL: "http://localhost:5000/api",
}));

vi.mock("../components/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

const ID = "b".repeat(24);

const payload = {
  tournament: { _id: ID, name: "Premier Cup" },
  settings: {
    bannerImage: "",
    shortDescription: "A short description",
    city: "Mumbai",
    visibility: { photos: true, videos: false, articles: true, stats: true, table: true, teams: true },
    stats: { minBallsFaced: 30, minOvers: 5 },
  },
  media: [
    { _id: "ph1", kind: "photo", url: "/uploads/a.jpg", caption: "Trophy", published: true },
    { _id: "v1", kind: "video", url: "https://youtu.be/x", provider: "youtube", videoId: "x", caption: "Highlights", published: false },
  ],
  articles: [{ _id: "ar1", slug: "season-preview", title: "Season Preview", published: true, body: "Body" }],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/admin/tournaments/${ID}/content`]}>
      <Routes>
        <Route path="/admin/tournaments/:id/content" element={<TournamentContent />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.put.mockReset();
  api.delete.mockReset();
  api.get.mockResolvedValue({ data: payload });
  api.put.mockResolvedValue({ data: { settings: payload.settings } });
});

describe("TournamentContent (admin)", () => {
  it("loads the content payload and renders the overview fields", async () => {
    renderPage();
    expect(await screen.findByTestId("content-title")).toHaveTextContent("Premier Cup");
    expect(api.get).toHaveBeenCalledWith(`/tournaments/admin/${ID}/content`);
    expect(screen.getByLabelText("Short description")).toHaveValue("A short description");
    expect(screen.getByLabelText("City")).toHaveValue("Mumbai");
  });

  it("saves the overview copy", async () => {
    renderPage();
    const city = await screen.findByLabelText("City");
    fireEvent.change(city, { target: { value: "Pune" } });
    fireEvent.click(screen.getByRole("button", { name: "Save overview" }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        `/tournaments/admin/${ID}/content`,
        expect.objectContaining({ city: "Pune" })
      )
    );
  });

  it("lists photos and videos on their sub-tabs", async () => {
    renderPage();
    await screen.findByTestId("content-subtabs");

    fireEvent.click(screen.getByRole("tab", { name: "Photos" }));
    expect(await screen.findByTestId("photo-card")).toBeInTheDocument();
    expect(screen.getByAltText("Trophy")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Videos" }));
    expect(await screen.findByTestId("video-card")).toBeInTheDocument();
    expect(screen.getByText("Highlights")).toBeInTheDocument();
  });

  it("reflects per-tournament visibility and saves settings without touching global flags", async () => {
    renderPage();
    await screen.findByTestId("content-subtabs");
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));

    const videosToggle = await screen.findByLabelText("Show Videos tab");
    expect(videosToggle).not.toBeChecked();

    fireEvent.click(screen.getByLabelText("Show Teams tab"));
    fireEvent.change(screen.getByLabelText("Minimum balls faced"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        `/tournaments/admin/${ID}/content`,
        expect.objectContaining({
          visibility: expect.objectContaining({ teams: false, videos: false }),
          stats: expect.objectContaining({ minBallsFaced: 40 }),
        })
      )
    );
  });

  it("creates an article and prepends it to the list", async () => {
    api.post.mockResolvedValue({
      data: { article: { _id: "ar2", slug: "new-story", title: "New Story", published: false } },
    });
    renderPage();
    await screen.findByTestId("content-subtabs");
    fireEvent.click(screen.getByRole("tab", { name: "Articles" }));

    fireEvent.click(await screen.findByRole("button", { name: "New article" }));
    fireEvent.change(screen.getByLabelText("Article title"), { target: { value: "New Story" } });
    fireEvent.click(screen.getByRole("button", { name: "Save article" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        `/tournaments/admin/${ID}/articles`,
        expect.objectContaining({ title: "New Story" })
      )
    );
    expect(await screen.findByText("New Story")).toBeInTheDocument();
  });

  it("shows an error state with a retry when loading fails", async () => {
    api.get.mockRejectedValue({ response: { data: { message: "Nope" } } });
    renderPage();
    expect(await screen.findByText("Nope")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
