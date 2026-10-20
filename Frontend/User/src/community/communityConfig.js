// Community constants + helpers shared by the feed, post page, forms and share
// menu. Colocated so the kinds/reasons/labels cannot drift between screens.

import { API_BASE_URL } from "../../../Shared/config/env.js";

export const POST_KINDS = ["photo", "video", "article", "story"];

export const KIND_LABELS = {
  photo: "Photo",
  video: "Video",
  article: "Article",
  story: "Story",
};

export const KINDS = POST_KINDS.map((value) => ({ value, label: KIND_LABELS[value] }));

// Report reason enum — must match the backend zod enum exactly.
export const REPORT_REASONS = [
  { value: "spam", label: "Spam or misleading" },
  { value: "abuse", label: "Abuse" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "hate", label: "Hate speech" },
  { value: "nudity", label: "Nudity or sexual content" },
  { value: "violence", label: "Violence or dangerous content" },
  { value: "false", label: "False information" },
  { value: "copyright", label: "Copyright violation" },
  { value: "other", label: "Something else" },
];

export const VIDEO_HINT = "Only YouTube, Facebook or Instagram video links are accepted.";

export const MAX_TITLE = 120;
export const MAX_BODY = 10000;
export const MAX_COMMENT = 1000;
export const MAX_IMAGES = 6;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * API origin without the `/api` suffix, derived from the SAME env var the axios
 * client uses (`VITE_API_URL`, dev fallback `http://localhost:5000/api`).
 *
 * Needed because upload URLs come back relative (`/uploads/x.jpg`) and because
 * the backend share pages live at `<origin>/share/...`, not under `/api`. Never
 * hardcoded to localhost at build time — in production (no VITE_API_URL) the API
 * is same-origin, so this resolves to that origin too.
 */
export function getApiOrigin() {
  const base = API_BASE_URL || "";
  if (/^https?:\/\//i.test(base)) {
    return base.replace(/\/api\/?$/i, "").replace(/\/+$/, "");
  }
  // Relative base ("/api") → same origin as the page.
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return base.replace(/\/api\/?$/i, "").replace(/\/+$/, "");
}

/** Backend preview URL (OG meta + meta-refresh redirect to the SPA route). */
export function previewUrl(kind, id) {
  return `${getApiOrigin()}/share/${kind}/${id}`;
}

export const postPreviewUrl = (id) => previewUrl("post", id);
export const teamPreviewUrl = (id) => previewUrl("team", id);
export const playerPreviewUrl = (id) => previewUrl("player", id);

/** Absolute URL for a `/uploads/...` reference (already-absolute URLs pass through). */
export function toAbsoluteMediaUrl(url) {
  if (!url || typeof url !== "string") return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `${getApiOrigin()}${url.startsWith("/") ? "" : "/"}${url}`;
}

/**
 * Allowlisted video embed, built only from the `videoProvider`/`videoId` the
 * backend parsed and stored. Returns null for anything else, so the feed can
 * fall back to a plain link instead of embedding an arbitrary URL.
 */
export function videoEmbed(videoProvider, videoId) {
  if (!videoId) return null;
  if (videoProvider === "youtube") {
    return { src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`, title: "YouTube video" };
  }
  if (videoProvider === "facebook") {
    return {
      src: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(videoId)}&show_text=false`,
      title: "Facebook video",
    };
  }
  return null; // Instagram has no safe generic embed without its script
}

const RESERVED_PREFIXES = ["opencode_test_", "opencode-test_", "e2e_", "test_", "cricall_test_"];

/** Mirror of the backend's reserved test-name rules — belt and braces for the UI. */
export function isReservedName(name) {
  const n = String(name || "").trim().toLowerCase();
  return RESERVED_PREFIXES.some((p) => n.startsWith(p));
}

/** "3h ago" style relative time; falls back to a locale date for older posts. */
export function timeAgo(input) {
  if (!input) return "";
  const then = new Date(input).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(input).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Resolve the display author/team/player names a post card shows. */
export function postNames(post) {
  const author = post?.authorUser;
  const authorName = typeof author === "string" ? "" : author?.name || "";
  const authorId = typeof author === "string" ? author : author?._id;
  const subject = post?.subject || {};
  const teamName =
    subject.type === "team" ? subject.ref?.name || subject.ref?.shortName || "" : "";
  const playerName = subject.type === "player" ? subject.ref?.name || "" : "";
  const teamId = subject.type === "team" ? subject.ref?._id || subject.ref : null;
  const playerId = subject.type === "player" ? subject.ref?._id || subject.ref : null;
  return { authorName, authorId, teamName, playerName, teamId, playerId };
}

/** `err.code` → a human message for the write paths (403/400/429 handling). */
export function friendlyWriteError(err, { banned } = {}) {
  const code = err?.code;
  if (err?.status === 429 || code === "COMMUNITY_DAILY_LIMIT") {
    return err?.retryAfter
      ? `Too many requests. Try again in ${err.retryAfter}s.`
      : "Too many requests right now. Please wait a moment and try again.";
  }
  switch (code) {
    case "COMMUNITY_DISABLED":
      return "The community section is currently switched off by the admins.";
    case "COMMUNITY_POSTER_BANNED":
      return banned || "Your account has been blocked from posting in the community.";
    case "COMMUNITY_SUBJECT_DENIED":
      return "You do not have permission to post as this team or player.";
    case "COMMUNITY_SUBJECT_NOT_FOUND":
      return "That team or player could not be found.";
    case "COMMUNITY_NOT_AUTHOR":
      return "You can only edit or delete your own posts.";
    case "COMMUNITY_EXTERNAL_IMAGE":
      return "Images must be uploaded through CricAll, not linked from another site.";
    case "COMMUNITY_IMAGE_TYPE":
      return "Images must be JPG, PNG or WebP.";
    case "COMMUNITY_TOO_MANY_IMAGES":
      return `You can attach at most ${MAX_IMAGES} images.`;
    case "COMMUNITY_VIDEO_NOT_ALLOWED":
      return VIDEO_HINT;
    case "COMMUNITY_SELF_REPORT":
      return "You cannot report your own post.";
    case "COMMUNITY_ALREADY_REPORTED":
      return "You have already reported this post. Our moderators are on it.";
    default:
      return err?.message || "Something went wrong. Please try again.";
  }
}

export default {
  POST_KINDS,
  KIND_LABELS,
  KINDS,
  REPORT_REASONS,
  VIDEO_HINT,
  MAX_TITLE,
  MAX_BODY,
  MAX_COMMENT,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  ALLOWED_IMAGE_TYPES,
  getApiOrigin,
  previewUrl,
  postPreviewUrl,
  teamPreviewUrl,
  playerPreviewUrl,
  toAbsoluteMediaUrl,
  videoEmbed,
  isReservedName,
  timeAgo,
  postNames,
  friendlyWriteError,
};
