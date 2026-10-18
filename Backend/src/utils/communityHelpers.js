import { isPlatformAdmin } from "../middleware/orgAccess.js";

/** The platform's own API origin; used to decide whether an image URL is ours. */
export function getBackendUrl() {
  return (
    process.env.PUBLIC_BACKEND_URL ||
    process.env.BACKEND_URL ||
    "http://127.0.0.1:5000"
  ).replace(/\/+$/, "");
}

export const YOUTUBE_REGEX = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/(watch\?v=|embed\/|v\/)?([a-zA-Z0-9_-]{11})/i;
export const FACEBOOK_VIDEO_REGEX = /^(https?:\/\/)?(www\.|fb\.)?(facebook\.com)\/(watch\/\?v=|videos\/|reel\/|share\/v\/)?[^\s]+/i;
export const INSTAGRAM_VIDEO_REGEX = /^(https?:\/\/)?(www\.)?(instagram\.com)\/(reel\/|p\/|tv\/)[^\s]+/i;

export function parseVideoUrl(url) {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  
  // YouTube
  const ytMatch = trimmed.match(YOUTUBE_REGEX);
  if (ytMatch) {
    return { provider: "youtube", id: ytMatch[5] };
  }
  
  // Facebook - just validate format, store id from URL
  if (FACEBOOK_VIDEO_REGEX.test(trimmed)) {
    // Extract video ID part (simplified - store full path identifier or just validated)
    const parts = trimmed.split("/");
    // Try to find numeric/video id
    for (let i = 0; i < parts.length; i++) {
      if (/^\d+$/.test(parts[i])) return { provider: "facebook", id: parts[i] };
    }
    return { provider: "facebook", id: trimmed };
  }
  
  // Instagram
  if (INSTAGRAM_VIDEO_REGEX.test(trimmed)) {
    const match = trimmed.match(/\/(reel|p|tv)\/([A-Za-z0-9_-]+)/);
    if (match) return { provider: "instagram", id: match[2] };
    return { provider: "instagram", id: trimmed };
  }
  
  return null;
}

export function isValidVideoUrl(url) {
  return parseVideoUrl(url) !== null;
}

/**
 * True only for an image reference this platform itself serves.
 *
 * Accepts the relative form the upload endpoint returns (`/uploads/<file>`)
 * and the absolute form built from it (`<backend>/uploads/<file>`). An
 * absolute URL on any other origin — including `https://evil.test/uploads/…`,
 * which a naive `includes("/uploads/")` accepts — is rejected, because the feed
 * would otherwise render a hot-linked image that can change after the fact.
 */
export function isOwnUploadUrl(url, backendUrl = getBackendUrl()) {
  if (!url || typeof url !== "string") return false;
  if (url.startsWith("/uploads/")) return true;
  const base = String(backendUrl || "").replace(/\/+$/, "");
  if (base && url.startsWith(`${base}/uploads/`)) return true;
  return false;
}

/**
 * Parses a feed/comments cursor. Any value that is not a real timestamp (an
 * operator object from `?cursor[$ne]=1`, a number, a malformed string) becomes
 * null rather than an Invalid Date, which Mongoose would reject with a
 * CastError — a public read answering 500 for a query parameter.
 */
export function cursorDate(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed);
}

/**
 * May this viewer see this post at all?
 *
 * `published` is public. `pending`, `hidden` and `removed` are visible only to
 * the author and to a platform admin, which is what makes "pending, visible
 * only to the author and admins" enforceable in one place instead of per route.
 */
export function canViewPost(post, req) {
  if (!post || post.isDeleted) return false;
  if (post.status === "published") return true;
  if (!req?.user) return false;
  if (isPlatformAdmin(req)) return true;
  return String(post.authorUser?._id || post.authorUser) === String(req.user._id);
}

export function stripHtmlTags(str) {
  if (!str || typeof str !== "string") return "";
  // Remove all HTML tags
  return str.replace(/<[^>]*>/g, "");
}

export function stripControlChars(str) {
  if (!str || typeof str !== "string") return "";
  // Remove control characters except \n, \r, \t
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

export function sanitizeText(str, maxLen) {
  if (!str || typeof str !== "string") return "";
  let cleaned = stripHtmlTags(str);
  cleaned = stripControlChars(cleaned);
  if (maxLen && cleaned.length > maxLen) {
    cleaned = cleaned.substring(0, maxLen);
  }
  return cleaned;
}

// Build share URLs
export function buildShareUrls(postId, title, url) {
  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title || "");
  return {
    whatsapp: `https://wa.me/?text=${encodedTitle}%20${encodedUrl}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    twitter: `https://x.com/intent/tweet?text=${encodedTitle}&url=${encodedUrl}`,
    telegram: `https://t.me/share/url?url=${encodedUrl}&text=${encodedTitle}`,
    // Instagram has no web share URL - native Web Share API or copy link
  };
}
