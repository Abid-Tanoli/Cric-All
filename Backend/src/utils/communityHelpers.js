import { isReservedTestName } from "./publicProjection.js";

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

export function isOwnUploadUrl(url, backendUrl) {
  if (!url || typeof url !== "string") return false;
  // Must point to /uploads/ on this platform
  if (url.startsWith("/uploads/")) return true;
  if (backendUrl) {
    try {
      const base = new URL(backendUrl);
      const u = new URL(url, backendUrl);
      if (u.origin === base.origin && u.pathname.startsWith("/uploads/")) return true;
    } catch {
      // ignore
    }
  }
  // Also accept relative uploads path
  if (url.includes("/uploads/")) {
    const idx = url.indexOf("/uploads/");
    const rest = url.slice(idx);
    if (rest.startsWith("/uploads/")) return true;
  }
  return false;
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
