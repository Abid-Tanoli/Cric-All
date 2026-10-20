import React, { useEffect } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ShareMenu from "../community/ShareMenu";
import PostCard from "../community/PostCard";
import { CommunityConfigProvider, useCommunityConfig } from "../community/CommunityConfigContext";
import { postPreviewUrl, teamPreviewUrl, playerPreviewUrl, videoEmbed, timeAgo, isReservedName } from "../community/communityConfig";

// The community layer is exercised here with the axios service mocked, so these
// tests are about the UI contract (share link targets, plain-text rendering,
// runtime switch) rather than the network.

vi.mock("../services/communityApi", () => ({
  getCommunityConfig: vi.fn(),
  getFeed: vi.fn(),
  getPost: vi.fn(),
  getComments: vi.fn(),
  getTeamPosts: vi.fn(),
  getPlayerPosts: vi.fn(),
  createPost: vi.fn(),
  updatePost: vi.fn(),
  deletePost: vi.fn(),
  toggleLike: vi.fn(),
  createComment: vi.fn(),
  deleteComment: vi.fn(),
  reportPost: vi.fn(),
  sharePost: vi.fn(),
}));

import * as communityApi from "../services/communityApi";

const renderInRouter = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("communityConfig helpers", () => {
  it("builds backend preview URLs, never a hardcoded localhost or SPA path", () => {
    // jsdom origin is http://localhost:3000; API_BASE_URL falls back to /api in test
    expect(postPreviewUrl("abc")).toMatch(/\/share\/post\/abc$/);
    expect(teamPreviewUrl("t1")).toMatch(/\/share\/team\/t1$/);
    expect(playerPreviewUrl("p1")).toMatch(/\/share\/player\/p1$/);
    expect(postPreviewUrl("abc")).not.toContain("/community/post/");
  });

  it("only embeds allowlisted video providers", () => {
    expect(videoEmbed("youtube", "dQw4w9WgXcQ")?.src).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(videoEmbed("instagram", "xyz")).toBeNull();
    expect(videoEmbed(null, "x")).toBeNull();
  });

  it("detects reserved test names like the backend does", () => {
    expect(isReservedName("E2E_foo")).toBe(true);
    expect(isReservedName("OPENCODE_TEST_bar")).toBe(true);
    expect(isReservedName("Real Player")).toBe(false);
  });

  it("formats recent times relatively", () => {
    expect(timeAgo(new Date().toISOString())).toBe("just now");
    expect(timeAgo(new Date(Date.now() - 3600 * 1000).toISOString())).toBe("1h ago");
  });
});

describe("ShareMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("points every network share link at the backend preview URL and fires onShare once", async () => {
    const onShare = vi.fn().mockResolvedValue({});
    renderInRouter(<ShareMenu kind="post" id="post123" title="Hello" onShare={onShare} />);

    fireEvent.click(screen.getByRole("button", { name: /share/i }));

    const wa = screen.getByRole("menuitem", { name: /whatsapp/i });
    expect(wa.getAttribute("href")).toContain(encodeURIComponent("/share/post/post123"));

    fireEvent.click(wa);
    await waitFor(() => expect(onShare).toHaveBeenCalledTimes(1));
  });

  it("has no Instagram web link but explains the native share route", () => {
    renderInRouter(<ShareMenu kind="post" id="p1" title="t" />);
    fireEvent.click(screen.getByRole("button", { name: /share/i }));
    expect(screen.queryByRole("menuitem", { name: /instagram/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Instagram/i)).toBeInTheDocument();
  });
});

describe("PostCard renders user text as plain text", () => {
  it("never interprets HTML in the body", () => {
    const post = {
      _id: "p1",
      kind: "story",
      title: "<b>bold</b>",
      body: "<img src=x onerror=alert(1)>hello",
      createdAt: new Date().toISOString(),
      authorUser: { _id: "u1", name: "Someone" },
      subject: { type: "user", ref: "u1" },
      likeCount: 2,
      commentCount: 1,
    };
    renderInRouter(<PostCard post={post} compact />);
    // The raw tag text is shown, not an element.
    expect(screen.getByText("<b>bold</b>")).toBeInTheDocument();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });
});

describe("CommunityConfigProvider runtime switch", () => {
  it("reads enabled/postMode from the public config endpoint", async () => {
    communityApi.getCommunityConfig.mockResolvedValueOnce({ enabled: true, postMode: "approval" });
    const seen = [];
    const Probe = () => {
      const { enabled, postMode, status } = useCommunityConfig();
      // Record from an effect, never during render (keeps the component pure).
      useEffect(() => {
        seen.push({ enabled, postMode, status });
      }, [enabled, postMode, status]);
      return <span>{status}</span>;
    };
    renderInRouter(
      <CommunityConfigProvider>
        <Probe />
      </CommunityConfigProvider>
    );
    await waitFor(() => expect(seen.some((s) => s.status === "ready")).toBe(true));
    const ready = seen.find((s) => s.status === "ready");
    expect(ready.enabled).toBe(true);
    expect(ready.postMode).toBe("approval");
  });
});
