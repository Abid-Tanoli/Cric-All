import mongoose from "mongoose";
import Tournament from "../models/Tournament.js";
import TournamentMedia from "../models/TournamentMedia.js";
import TournamentArticle from "../models/TournamentArticle.js";
import { deleteStoredFile } from "../utils/photoStore.js";

// ---------------------------------------------------------------------------
// Tournament hub content: validation, sanitization and shared helpers used by
// the public read routes and the platform-admin write routes.
// ---------------------------------------------------------------------------
//
// Everything here is additive. Nothing reads or writes an existing collection
// except Tournament, and only its additive `content` sub-document.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Input safety
// ---------------------------------------------------------------------------

/**
 * Reads a required string field. A non-string (e.g. `{ "$ne": null }` from a
 * NoSQL-injection attempt) is rejected rather than coerced, so an object can
 * never reach a Mongoose query.
 */
export function readString(body, field, { required = false, max = 2000, fallback = "" } = {}) {
  const raw = body?.[field];
  if (raw === undefined || raw === null) {
    if (required) throw new HttpError(400, `${field} is required`);
    return fallback;
  }
  if (typeof raw !== "string") {
    throw new HttpError(400, `${field} must be a string`);
  }
  const value = raw.trim();
  if (required && !value) throw new HttpError(400, `${field} is required`);
  return value.slice(0, max);
}

/** Strips HTML tags and control characters from a short text field. */
export function sanitizeText(value, max = 2000) {
  if (value == null) return "";
  return String(value)
    .replace(/<[^>]*>/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Sanitizes an article body: it is stored as plain text / Markdown and is
 * re-rendered as text, but dangerous constructs are removed anyway so that a
 * stored row can never be mistaken for trusted HTML.
 */
export function sanitizeArticleBody(body) {
  if (typeof body !== "string") return "";
  let out = body;
  out = out.replace(
    /<\s*(script|style|iframe|object|embed|form|link|meta|svg)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
    "",
  );
  out = out.replace(/<\s*(script|style|iframe|object|embed|form|link|meta|svg)[^>]*\/?>/gi, "");
  out = out.replace(/\son\w+\s*=\s*"[^"]*"/gi, "");
  out = out.replace(/\son\w+\s*=\s*'[^']*'/gi, "");
  out = out.replace(/\son\w+\s*=\s*[^\s>]+/gi, "");
  out = out.replace(/javascript\s*:/gi, "");
  out = out.replace(/data\s*:\s*text\/html/gi, "");
  return out.slice(0, 20000);
}

export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function autoExcerpt(body, max = 220) {
  const text = sanitizeText(body).replace(/\s+/g, " ");
  return text.length <= max ? text : `${text.slice(0, max).trim()}...`;
}

// ---------------------------------------------------------------------------
// Video URL allow-list
// ---------------------------------------------------------------------------

const YOUTUBE_HOST = /(^|\.)youtube\.com$/;
const YOUTUBE_NOCOOKIE = /(^|\.)youtube-nocookie\.com$/;
const FACEBOOK_HOST = /(^|\.)facebook\.com$/;

/**
 * Validates a video URL against an allow-list of hosts and extracts the embed
 * id. Only the URL/id is ever stored — the server never fetches remote media.
 * Returns `{ ok, provider, videoId, url }` or `{ ok:false, error }`.
 */
export function parseVideoUrl(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, error: "A video URL is required" };
  }
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: "Enter a valid http(s) video URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Only http(s) URLs are allowed" };
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0] || "";
    if (!id) return { ok: false, error: "Could not read the YouTube video id" };
    return { ok: true, provider: "youtube", videoId: id.slice(0, 32), url: url.href };
  }
  if (YOUTUBE_HOST.test(host) || YOUTUBE_NOCOOKIE.test(host) || host === "youtube-nocookie.com") {
    let id = url.searchParams.get("v") || "";
    const parts = url.pathname.split("/").filter(Boolean);
    if (!id && parts.length >= 2 && ["embed", "shorts", "live", "v"].includes(parts[0])) {
      id = parts[1];
    }
    if (!id) return { ok: false, error: "Could not read the YouTube video id" };
    return { ok: true, provider: "youtube", videoId: id.slice(0, 32), url: url.href };
  }
  if (FACEBOOK_HOST.test(host) || host === "fb.watch") {
    const id = url.pathname.replace(/^\/+/, "").slice(0, 200) || url.href;
    return { ok: true, provider: "facebook", videoId: id, url: url.href };
  }
  return { ok: false, error: "Only YouTube and Facebook video links are supported" };
}

// ---------------------------------------------------------------------------
// Tournament resolution
// ---------------------------------------------------------------------------

export async function resolveTournament(idOrSlug, { lean = false } = {}) {
  if (typeof idOrSlug !== "string" || !idOrSlug.trim()) return null;
  const value = idOrSlug.trim();
  const query = mongoose.isValidObjectId(value) ? { _id: value } : { slug: value };
  const found = Tournament.findOne(query);
  return lean ? found.lean() : found;
}

// ---------------------------------------------------------------------------
// Settings / overview
// ---------------------------------------------------------------------------

export const DEFAULT_VISIBILITY = Object.freeze({
  photos: true,
  videos: true,
  articles: true,
  stats: true,
  table: true,
  teams: true,
});

export const DEFAULT_THRESHOLDS = Object.freeze({ minBallsFaced: 30, minOvers: 5 });

/** Reads the additive content settings with safe defaults for old rows. */
export function readContentSettings(tournament) {
  const content = (tournament && tournament.content) || {};
  const visibility = { ...DEFAULT_VISIBILITY, ...(content.visibility || {}) };
  const stats = { ...DEFAULT_THRESHOLDS, ...(content.stats || {}) };
  return {
    bannerImage: content.bannerImage || "",
    shortDescription: content.shortDescription || "",
    city: content.city || "",
    visibility,
    stats: {
      minBallsFaced: Number.isFinite(Number(stats.minBallsFaced)) ? Number(stats.minBallsFaced) : 30,
      minOvers: Number.isFinite(Number(stats.minOvers)) ? Number(stats.minOvers) : 5,
    },
  };
}

/** Public-safe projection of a media row. */
export function publicMedia(row) {
  return {
    _id: String(row._id),
    kind: row.kind,
    url: row.url || "",
    provider: row.provider || "",
    videoId: row.videoId || "",
    caption: sanitizeText(row.caption, 400),
    sortOrder: row.sortOrder || 0,
    createdAt: row.createdAt,
  };
}

/** Public-safe article list row (no body). */
export function publicArticleSummary(row) {
  return {
    _id: String(row._id),
    slug: row.slug,
    title: sanitizeText(row.title, 300),
    excerpt: sanitizeText(row.excerpt, 400),
    coverImage: row.coverImage || "",
    publishedAt: row.publishedAt || row.createdAt,
    createdAt: row.createdAt,
  };
}

/** Public-safe article detail. */
export function publicArticleDetail(row) {
  return {
    ...publicArticleSummary(row),
    body: sanitizeArticleBody(row.body),
  };
}

// ---------------------------------------------------------------------------
// Deletion / orphan handling
// ---------------------------------------------------------------------------

export async function uniqueArticleSlug(tournamentId, desired, excludeId = null) {
  const base = slugify(desired) || "article";
  let candidate = base;
  let n = 1;
  // Bounded loop; slugs are short and collisions are rare.
  for (let i = 0; i < 200; i += 1) {
    const query = { tournament: tournamentId, slug: candidate, deletedAt: null };
    if (excludeId) query._id = { $ne: excludeId };
    const clash = await TournamentArticle.findOne(query).select("_id").lean();
    if (!clash) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Removes every hub artefact for a tournament: media rows (and, for local
 * uploads, the files on disk) and articles. Called when a tournament is
 * deleted, so deleting a tournament never silently orphans its uploads.
 * Idempotent: safe to call twice.
 */
export async function deleteTournamentContent(tournamentId) {
  if (!tournamentId) return { media: 0, files: 0, articles: 0 };
  const media = await TournamentMedia.find({ tournament: tournamentId }).select("url kind").lean();
  let files = 0;
  for (const row of media) {
    if (row.kind === "photo" && row.url) {
      try {
        if (await deleteStoredFile(row.url)) files += 1;
      } catch {
        // A missing/unreadable file must not block the delete.
      }
    }
  }
  const mediaResult = await TournamentMedia.deleteMany({ tournament: tournamentId });
  const articleResult = await TournamentArticle.deleteMany({ tournament: tournamentId });
  return { media: mediaResult.deletedCount || 0, files, articles: articleResult.deletedCount || 0 };
}

export default {
  HttpError,
  readString,
  sanitizeText,
  sanitizeArticleBody,
  slugify,
  autoExcerpt,
  parseVideoUrl,
  resolveTournament,
  readContentSettings,
  publicMedia,
  publicArticleSummary,
  publicArticleDetail,
  uniqueArticleSlug,
  deleteTournamentContent,
  DEFAULT_VISIBILITY,
  DEFAULT_THRESHOLDS,
};
