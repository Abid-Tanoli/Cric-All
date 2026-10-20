import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The community admin pages go through services/communityApi, so we mock that
// module (the same shape the pages import) rather than the raw axios client.
const api = vi.hoisted(() => ({
  getQueue: vi.fn(),
  approvePost: vi.fn(),
  hidePost: vi.fn(),
  removePost: vi.fn(),
  restorePost: vi.fn(),
  banPoster: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));
vi.mock("../services/communityApi", () => ({ ...api, default: api }));

const showToast = vi.hoisted(() => vi.fn());
vi.mock("../components/Toast", () => ({ useToast: () => ({ showToast }) }));

// ConfirmModal is a presentational dialog; stubbing it keeps this test focused
// on the page's confirm-then-call behaviour without depending on its internals.
vi.mock("../components/ConfirmModal", () => ({
  default: ({ open, title, confirmLabel, onConfirm, onCancel }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <button onClick={onConfirm}>{confirmLabel || "Confirm"}</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    ) : null,
}));

import CommunityModeration from "../pages/CommunityModeration";
import CommunitySettings from "../pages/CommunitySettings";

const PENDING = {
  _id: "p1",
  kind: "story",
  status: "pending",
  title: "A pending post",
  body: "hello world",
  reportCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  authorUser: { _id: "u1", name: "Ann", email: "ann@example.test" },
  subject: { type: "user", ref: "u1" },
};

const renderModeration = () =>
  render(
    <MemoryRouter>
      <CommunityModeration />
    </MemoryRouter>
  );

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  showToast.mockReset();
  api.getSettings.mockResolvedValue({ bannedPosters: [] });
  api.getQueue.mockResolvedValue({ posts: [PENDING], nextCursor: null, hasMore: false });
  api.approvePost.mockResolvedValue({ post: { ...PENDING, status: "published" } });
  api.removePost.mockResolvedValue({ post: { ...PENDING, status: "removed" } });
});

describe("CommunityModeration", () => {
  it("lists pending posts and approves one", async () => {
    renderModeration();
    expect(await screen.findByText("A pending post")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() => expect(api.approvePost).toHaveBeenCalledWith("p1"));
    expect(showToast).toHaveBeenCalledWith("Post approved.", "success");
  });

  it("asks for confirmation before removing a post", async () => {
    renderModeration();
    await screen.findByText("A pending post");
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));

    // The ConfirmModal appears; only confirming calls the API.
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(api.removePost).not.toHaveBeenCalled();

    // The dialog's confirm button is the one labelled "Remove".
    fireEvent.click(within(dialog).getByRole("button", { name: /^remove$/i }));
    await waitFor(() => expect(api.removePost).toHaveBeenCalledWith("p1"));
  });

  it("bans a poster after confirming", async () => {
    api.getQueue.mockResolvedValue({ posts: [{ ...PENDING, status: "published" }], nextCursor: null, hasMore: false });
    api.banPoster.mockResolvedValue({ bannedPosters: ["u1"] });
    renderModeration();
    await screen.findByText("A pending post");
    fireEvent.click(screen.getByRole("button", { name: /ban poster/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^ban$/i }));
    await waitFor(() => expect(api.banPoster).toHaveBeenCalledWith("u1", true));
  });
});

describe("CommunitySettings", () => {
  const renderSettings = () =>
    render(
      <MemoryRouter>
        <CommunitySettings />
      </MemoryRouter>
    );

  it("toggles communityEnabled through the admin settings endpoint", async () => {
    api.getSettings.mockResolvedValue({
      communityEnabled: false,
      postMode: "auto",
      bannedPosters: [],
      maxPostsPerUserPerDay: 10,
      maxImagesPerPost: 6,
    });
    api.updateSettings.mockResolvedValue({ communityEnabled: true, postMode: "auto", bannedPosters: [], maxPostsPerUserPerDay: 10, maxImagesPerPost: 6 });

    renderSettings();
    const toggle = await screen.findByRole("switch", { name: /toggle community/i });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ communityEnabled: true }));
  });

  it("saves the limits", async () => {
    api.getSettings.mockResolvedValue({
      communityEnabled: true,
      postMode: "auto",
      bannedPosters: [],
      maxPostsPerUserPerDay: 10,
      maxImagesPerPost: 6,
    });
    api.updateSettings.mockResolvedValue({ communityEnabled: true, postMode: "auto", bannedPosters: [], maxPostsPerUserPerDay: 3, maxImagesPerPost: 2 });
    renderSettings();
    await screen.findByRole("heading", { name: /community settings/i });
    fireEvent.change(screen.getByLabelText(/max posts per user per day/i), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(/max images per post/i), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /save limits/i }));
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ maxPostsPerUserPerDay: 3, maxImagesPerPost: 2 }));
  });
});
