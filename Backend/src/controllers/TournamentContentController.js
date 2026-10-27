import mongoose from "mongoose";
import Tournament from "../models/Tournament.js";
import Match from "../models/Match.js";
import TournamentMedia from "../models/TournamentMedia.js";
import TournamentArticle from "../models/TournamentArticle.js";
import { storeImage, ensureUploadsDir } from "../utils/photoStore.js";
import {
  gatherTournamentStats,
  computeFormAndNext,
  readTournamentStatsCache,
  writeTournamentStatsCache,
  invalidateTournamentStatsCache,
} from "../services/tournamentStats.js";
import { buildTournamentBracket } from "../services/tournamentBracket.js";
import {
  HttpError,
  readString,
  sanitizeText,
  sanitizeArticleBody,
  autoExcerpt,
  parseVideoUrl,
  resolveTournament,
  readContentSettings,
  publicMedia,
  publicArticleSummary,
  publicArticleDetail,
  uniqueArticleSlug,
} from "../services/tournamentContent.js";
import { recordAudit } from "../utils/audit.js";
import { hiddenTeamIds, isHiddenTeamDoc, isReservedTestName } from "../utils/publicProjection.js";

const PUBLISHED = { published: true, deletedAt: null };

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function parseIntQuery(value, min, max, fallback) {
  if (value === undefined || value === null || typeof value === "object") return fallback;
  return clampInt(value, min, max, fallback);
}

// The stats cache itself lives in `services/tournamentStats.js` so every write
// path can invalidate it without importing this controller. `?fresh=1` still
// bypasses it (used by tests and after an edit).

async function requireTournament(req) {
  const tournament = await resolveTournament(req.params.id);
  if (!tournament) throw new HttpError(404, "Tournament not found");
  return tournament;
}

// ---------------------------------------------------------------------------
// Public reads
// ---------------------------------------------------------------------------

export const getTournamentContent = async (req, res) => {
  try {
    const tournament = await requireTournament(req);
    const settings = readContentSettings(tournament);

    const [photoCount, videoCount, articleCount] = await Promise.all([
      TournamentMedia.countDocuments({ tournament: tournament._id, kind: "photo", ...PUBLISHED }),
      TournamentMedia.countDocuments({ tournament: tournament._id, kind: "video", ...PUBLISHED }),
      TournamentArticle.countDocuments({ tournament: tournament._id, ...PUBLISHED }),
    ]);

    res.status(200).json({
      tournamentId: String(tournament._id),
      overview: {
        bannerImage: settings.bannerImage,
        shortDescription: settings.shortDescription,
        city: settings.city,
        venue: tournament.venue || "",
        format: tournament.format || "",
        startDate: tournament.startDate || null,
        endDate: tournament.endDate || null,
        status: tournament.status || "upcoming",
      },
      visibility: settings.visibility,
      thresholds: settings.stats,
      counts: { photos: photoCount, videos: videoCount, articles: articleCount },
    });
  } catch (error) {
    if (error instanceof HttpError) return res.status(error.status).json({ message: error.message });
    console.error("Error fetching tournament content:", error);
    res.status(500).json({ message: "Failed to fetch tournament content", error: error.message });
  }
};

export const getTournamentStats = async (req, res) => {
  try {
    const tournament = await requireTournament(req);
    const settings = readContentSettings(tournament);
    const fresh = String(req.query?.fresh || "") === "1";
    const now = Date.now();

    let stats = fresh ? null : readTournamentStatsCache(tournament._id, settings.stats, now);
    if (!stats) {
      stats = await gatherTournamentStats(tournament, settings.stats);
      writeTournamentStatsCache(tournament._id, settings.stats, stats, now);
    }

    res.set("Cache-Control", "public, max-age=15, stale-while-revalidate=30");
    res.status(200).json(stats);
  } catch (error) {
    if (error instanceof HttpError) return res.status(error.status).json({ message: error.message });
    console.error("Error computing tournament stats:", error);
    res.status(500).json({ message: "Failed to compute tournament stats", error: error.message });
  }
};

// Standings = the EXISTING points table (never recomputed here) plus the two
// presentation-only columns the hub adds: recent form and next opponent.
export const getTournamentStandings = async (req, res) => {
  try {
    const tournament = await requireTournament(req);
    const populated = await Tournament.findById(tournament._id).populate(
      "pointsTable.team",
      "name shortName logo",
    );

    // Hidden (`isPublic:false`) and reserved-test teams must never reach a
    // public standings row, and a visible team's "next opponent" must not name
    // one either. `hiddenTeamIds()` covers both `isPublic:false` and the
    // reserved test prefixes, so the id set is the single source of truth.
    const hidden = new Set(await hiddenTeamIds());
    const isHiddenRef = (team) => {
      if (!team) return true;
      if (hidden.has(String(team._id || team))) return true;
      if (typeof team === "object" && isHiddenTeamDoc(team)) return true;
      return typeof team === "object" && isReservedTestName(team.name);
    };

    const teamIds = (populated.teams || []).map((t) => String(t?._id || t));
    const matches = await Match.find({ tournament: tournament._id, manualDraft: { $ne: true } })
      .select(
        "teams status result startAt round group stage stageLabel matchNumber " +
          "innings.team innings.runs innings.wickets innings.balls innings.overs innings.extras " +
          "innings.batting.runs innings.batting.balls innings.batting.fours innings.batting.sixes " +
          "innings.batting.isOut innings.batting.dismissalType innings.batting.didNotBat innings.batting.batted",
      )
      .populate("teams", "name shortName logo")
      .lean();

    const { form, next } = computeFormAndNext(matches, teamIds);
    const bracketMatches = matches.filter(
      (match) => !(match.teams || []).some((team) => isHiddenRef(team)),
    );
    const bracket = buildTournamentBracket(bracketMatches, { type: tournament.type });

    const rows = [...(populated.pointsTable || [])]
      .filter((row) => row?.team)
      .filter((row) => !isHiddenRef(row.team))
      .map((row) => {
        const id = String(row.team?._id || row.team);
        const nextMatch = next.get(id);
        const nextTeam = nextMatch
          ? (nextMatch.teams || []).find((t) => String(t?._id || t) !== id)
          : null;
        return {
          team: { _id: id, name: row.team.name, shortName: row.team.shortName, logo: row.team.logo },
          matchesPlayed: row.matchesPlayed || 0,
          won: row.won || 0,
          lost: row.lost || 0,
          tied: row.tied || 0,
          noResult: row.noResult || 0,
          points: row.points || 0,
          netRunRate: row.netRunRate || 0,
          for: row.for || 0,
          against: row.against || 0,
          wicketsFor: row.wicketsFor || 0,
          wicketsAgainst: row.wicketsAgainst || 0,
          form: (form.get(id) || []).slice(-5).reverse(),
          next:
            nextTeam && !isHiddenRef(nextTeam)
              ? {
                  matchId: String(nextMatch._id),
                  opponent: nextTeam.name || nextTeam.shortName || "",
                  startAt: nextMatch.startAt || null,
                }
              : null,
        };
      })
      .sort((a, b) => b.points - a.points || b.netRunRate - a.netRunRate);

    res.status(200).json({
      tournamentId: String(tournament._id),
      type: tournament.type,
      hasStandings: rows.length > 0,
      rows,
      bracket,
      isKnockout: Boolean(bracket?.isKnockout),
    });
  } catch (error) {
    if (error instanceof HttpError) return res.status(error.status).json({ message: error.message });
    console.error("Error fetching standings:", error);
    res.status(500).json({ message: "Failed to fetch standings", error: error.message });
  }
};

export const listTournamentMedia = (kind) => async (req, res) => {
  try {
    const tournament = await requireTournament(req);
    const limit = parseIntQuery(req.query?.limit, 1, 100, kind === "photo" ? 60 : 24);
    const page = parseIntQuery(req.query?.page, 1, 1000, 1);

    const [items, total] = await Promise.all([
      TournamentMedia.find({ tournament: tournament._id, kind, ...PUBLISHED })
        .sort({ sortOrder: 1, createdAt: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      TournamentMedia.countDocuments({ tournament: tournament._id, kind, ...PUBLISHED }),
    ]);

    res.status(200).json({
      items: items.map(publicMedia),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    if (error instanceof HttpError) return res.status(error.status).json({ message: error.message });
    console.error("Error listing tournament media:", error);
    res.status(500).json({ message: "Failed to list tournament media", error: error.message });
  }
};

export const listTournamentArticles = async (req, res) => {
  try {
    const tournament = await requireTournament(req);
    const limit = parseIntQuery(req.query?.limit, 1, 50, 12);
    const page = parseIntQuery(req.query?.page, 1, 1000, 1);

    const [items, total] = await Promise.all([
      TournamentArticle.find({ tournament: tournament._id, ...PUBLISHED })
        .sort({ publishedAt: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      TournamentArticle.countDocuments({ tournament: tournament._id, ...PUBLISHED }),
    ]);

    res.status(200).json({
      items: items.map(publicArticleSummary),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    if (error instanceof HttpError) return res.status(error.status).json({ message: error.message });
    console.error("Error listing tournament articles:", error);
    res.status(500).json({ message: "Failed to list tournament articles", error: error.message });
  }
};

export const getTournamentArticle = async (req, res) => {
  try {
    const tournament = await requireTournament(req);
    const slug = String(req.params.slug || "").trim();
    if (!slug) return res.status(400).json({ message: "A slug is required" });

    const article = await TournamentArticle.findOne({
      tournament: tournament._id,
      slug,
      ...PUBLISHED,
    }).lean();
    if (!article) return res.status(404).json({ message: "Article not found" });

    res.status(200).json({ article: publicArticleDetail(article) });
  } catch (error) {
    if (error instanceof HttpError) return res.status(error.status).json({ message: error.message });
    console.error("Error fetching article:", error);
    res.status(500).json({ message: "Failed to fetch article", error: error.message });
  }
};

// ---------------------------------------------------------------------------
// Admin reads / writes
// ---------------------------------------------------------------------------

export const adminGetContent = async (req, res) => {
  try {
    const tournament = await requireTournament(req);
    const settings = readContentSettings(tournament);
    const [media, articles] = await Promise.all([
      TournamentMedia.find({ tournament: tournament._id, deletedAt: null })
        .sort({ kind: 1, sortOrder: 1, createdAt: 1 })
        .lean(),
      TournamentArticle.find({ tournament: tournament._id, deletedAt: null })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    res.status(200).json({
      tournament: {
        _id: String(tournament._id),
        name: tournament.name,
        shortName: tournament.shortName || "",
        type: tournament.type,
        format: tournament.format,
        venue: tournament.venue || "",
        status: tournament.status,
        startDate: tournament.startDate,
        endDate: tournament.endDate,
      },
      settings,
      media: media.map((row) => ({
        ...publicMedia(row),
        published: row.published,
        updatedAt: row.updatedAt,
      })),
      articles: articles.map((row) => ({ ...publicArticleDetail(row), published: row.published })),
    });
  } catch (error) {
    if (error instanceof HttpError) return res.status(error.status).json({ message: error.message });
    console.error("Error loading admin tournament content:", error);
    res.status(500).json({ message: "Failed to load tournament content", error: error.message });
  }
};

export const adminUpdateContent = async (req, res) => {
  try {
    const tournament = await requireTournament(req);
    const body = req.body && typeof req.body === "object" ? req.body : {};

    const next = {
      bannerImage: tournament.content?.bannerImage || "",
      shortDescription: tournament.content?.shortDescription || "",
      city: tournament.content?.city || "",
      visibility: { ...(tournament.content?.visibility?.toObject?.() || tournament.content?.visibility || {}) },
      stats: { ...(tournament.content?.stats?.toObject?.() || tournament.content?.stats || {}) },
    };

    if (body.bannerImage !== undefined) next.bannerImage = readString(body, "bannerImage", { max: 500 });
    if (body.shortDescription !== undefined) next.shortDescription = sanitizeText(readString(body, "shortDescription", { max: 600 }), 600);
    if (body.city !== undefined) next.city = sanitizeText(readString(body, "city", { max: 120 }), 120);

    if (body.visibility && typeof body.visibility === "object") {
      for (const key of ["photos", "videos", "articles", "stats", "table", "teams"]) {
        if (body.visibility[key] !== undefined) next.visibility[key] = body.visibility[key] === true;
      }
    }
    if (body.stats && typeof body.stats === "object") {
      if (body.stats.minBallsFaced !== undefined) {
        next.stats.minBallsFaced = clampInt(body.stats.minBallsFaced, 0, 1000, 30);
      }
      if (body.stats.minOvers !== undefined) {
        next.stats.minOvers = clampInt(body.stats.minOvers, 0, 100, 5);
      }
    }

    tournament.content = {
      ...(tournament.content?.toObject?.() || tournament.content || {}),
      bannerImage: next.bannerImage,
      shortDescription: next.shortDescription,
      city: next.city,
      visibility: next.visibility,
      stats: next.stats,
    };
    await tournament.save();

    recordAudit({
      req,
      action: "tournament.content_updated",
      targetType: "tournament",
      targetId: tournament._id,
      targetLabel: tournament.name,
      metadata: { fields: Object.keys(body) },
    });

    const settings = readContentSettings(tournament);
    invalidateTournamentStatsCache(tournament._id);
    res.status(200).json({ settings, message: "Content settings updated" });
  } catch (error) {
    if (error instanceof HttpError) return res.status(error.status).json({ message: error.message });
    console.error("Error updating tournament content:", error);
    res.status(400).json({ message: "Failed to update tournament content", error: error.message });
  }
};

async function nextSortOrder(tournamentId, kind) {
  const last = await TournamentMedia.findOne({ tournament: tournamentId, kind })
    .sort({ sortOrder: -1 })
    .select("sortOrder")
    .lean();
  return (last?.sortOrder || 0) + 1;
}

export const adminAddPhoto = async (req, res) => {
  try {
    const tournament = await requireTournament(req);
    if (!req.file) return res.status(400).json({ message: "No image file uploaded" });

    ensureUploadsDir();
    const { url, filename } = await storeImage(req.file.buffer, req.file.mimetype, req.file.originalname);

    const caption = sanitizeText(readString(req.body, "caption", { max: 400 }), 400);
    const sortOrder =
      req.body?.sortOrder !== undefined
        ? clampInt(req.body.sortOrder, 0, 100000, 0)
        : await nextSortOrder(tournament._id, "photo");
    const published = req.body?.published === undefined ? true : req.body.published === true;

    const media = await TournamentMedia.create({
      tournament: tournament._id,
      kind: "photo",
      url: `/uploads/${filename}`,
      caption,
      sortOrder,
      published,
      createdByAdmin: req.user?._id || null,
    });

    recordAudit({
      req,
      action: "tournament.photo_added",
      targetType: "tournament",
      targetId: tournament._id,
      targetLabel: tournament.name,
      metadata: { mediaId: String(media._id) },
    });

    res.status(201).json({ media: { ...publicMedia(media.toObject()), published }, message: "Photo added" });
  } catch (error) {
    if (error instanceof HttpError) return res.status(error.status).json({ message: error.message });
    console.error("Error adding tournament photo:", error);
    res.status(error.status || 400).json({ message: error.message || "Failed to add photo", error: error.message });
  }
};

export const adminAddVideo = async (req, res) => {
  try {
    const tournament = await requireTournament(req);
    const parsed = parseVideoUrl(readString(req.body, "url", { required: true, max: 500 }));
    if (!parsed.ok) return res.status(400).json({ message: parsed.error });

    const caption = sanitizeText(readString(req.body, "title", { max: 300 }) || readString(req.body, "caption", { max: 300 }), 300);
    const sortOrder =
      req.body?.sortOrder !== undefined
        ? clampInt(req.body.sortOrder, 0, 100000, 0)
        : await nextSortOrder(tournament._id, "video");
    const published = req.body?.published === undefined ? true : req.body.published === true;

    const media = await TournamentMedia.create({
      tournament: tournament._id,
      kind: "video",
      url: parsed.url,
      provider: parsed.provider,
      videoId: parsed.videoId,
      caption,
      sortOrder,
      published,
      createdByAdmin: req.user?._id || null,
    });

    recordAudit({
      req,
      action: "tournament.video_added",
      targetType: "tournament",
      targetId: tournament._id,
      targetLabel: tournament.name,
      metadata: { mediaId: String(media._id), provider: parsed.provider },
    });

    res.status(201).json({ media: { ...publicMedia(media.toObject()), published }, message: "Video added" });
  } catch (error) {
    if (error instanceof HttpError) return res.status(error.status).json({ message: error.message });
    console.error("Error adding tournament video:", error);
    res.status(400).json({ message: error.message || "Failed to add video", error: error.message });
  }
};

export const adminUpdateMedia = async (req, res) => {
  try {
    const tournament = await requireTournament(req);
    if (!mongoose.isValidObjectId(req.params.mediaId)) {
      return res.status(400).json({ message: "Invalid media id" });
    }
    const media = await TournamentMedia.findOne({
      _id: req.params.mediaId,
      tournament: tournament._id,
      deletedAt: null,
    });
    if (!media) return res.status(404).json({ message: "Media not found" });

    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (body.caption !== undefined) media.caption = sanitizeText(readString(body, "caption", { max: 400 }), 400);
    if (body.published !== undefined) media.published = body.published === true;
    if (body.sortOrder !== undefined) media.sortOrder = clampInt(body.sortOrder, 0, 100000, media.sortOrder);
    if (media.kind === "video" && body.url !== undefined) {
      const parsed = parseVideoUrl(readString(body, "url", { required: true, max: 500 }));
      if (!parsed.ok) return res.status(400).json({ message: parsed.error });
      media.url = parsed.url;
      media.provider = parsed.provider;
      media.videoId = parsed.videoId;
    }
    await media.save();

    res.status(200).json({ media: { ...publicMedia(media.toObject()), published: media.published }, message: "Media updated" });
  } catch (error) {
    if (error instanceof HttpError) return res.status(error.status).json({ message: error.message });
    console.error("Error updating tournament media:", error);
    res.status(400).json({ message: error.message || "Failed to update media", error: error.message });
  }
};

export const adminDeleteMedia = async (req, res) => {
  try {
    const tournament = await requireTournament(req);
    if (!mongoose.isValidObjectId(req.params.mediaId)) {
      return res.status(400).json({ message: "Invalid media id" });
    }
    const media = await TournamentMedia.findOne({
      _id: req.params.mediaId,
      tournament: tournament._id,
      deletedAt: null,
    });
    if (!media) return res.status(404).json({ message: "Media not found" });

    media.deletedAt = new Date();
    await media.save();

    // Soft-delete the row but remove the local file, so the delete is not
    // silently leaving an orphan on disk. External/cloud URLs are ignored by
    // deleteStoredFile.
    if (media.kind === "photo" && media.url) {
      try {
        const { deleteStoredFile } = await import("../utils/photoStore.js");
        await deleteStoredFile(media.url);
      } catch {
        // best-effort
      }
    }

    recordAudit({
      req,
      action: "tournament.media_deleted",
      targetType: "tournament",
      targetId: tournament._id,
      targetLabel: tournament.name,
      metadata: { mediaId: String(media._id), kind: media.kind },
    });

    res.status(200).json({ message: "Media deleted" });
  } catch (error) {
    if (error instanceof HttpError) return res.status(error.status).json({ message: error.message });
    console.error("Error deleting tournament media:", error);
    res.status(500).json({ message: "Failed to delete media", error: error.message });
  }
};

export const adminCreateArticle = async (req, res) => {
  try {
    const tournament = await requireTournament(req);
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const title = sanitizeText(readString(body, "title", { required: true, max: 300 }), 300);
    const rawBody = body.body === undefined ? "" : readString(body, "body", { max: 20000 });
    const cleanBody = sanitizeArticleBody(rawBody);
    const slugSource = body.slug !== undefined ? readString(body, "slug", { max: 120 }) : title;
    const slug = await uniqueArticleSlug(tournament._id, slugSource || title);
    const excerpt = body.excerpt !== undefined
      ? sanitizeText(readString(body, "excerpt", { max: 400 }), 400)
      : autoExcerpt(cleanBody);
    const coverImage = body.coverImage !== undefined ? readString(body, "coverImage", { max: 500 }) : "";
    const published = body.published === true;

    const article = await TournamentArticle.create({
      tournament: tournament._id,
      title,
      slug,
      coverImage,
      body: cleanBody,
      excerpt,
      published,
      publishedAt: published ? new Date() : null,
      createdByAdmin: req.user?._id || null,
    });

    recordAudit({
      req,
      action: "tournament.article_created",
      targetType: "tournament",
      targetId: tournament._id,
      targetLabel: tournament.name,
      metadata: { articleId: String(article._id), slug },
    });

    res.status(201).json({
      article: { ...publicArticleDetail(article.toObject()), published: article.published },
      message: "Article created",
    });
  } catch (error) {
    if (error instanceof HttpError) return res.status(error.status).json({ message: error.message });
    if (error?.code === 11000) return res.status(409).json({ message: "That slug is already used in this tournament" });
    console.error("Error creating article:", error);
    res.status(400).json({ message: error.message || "Failed to create article", error: error.message });
  }
};

export const adminUpdateArticle = async (req, res) => {
  try {
    const tournament = await requireTournament(req);
    if (!mongoose.isValidObjectId(req.params.articleId)) {
      return res.status(400).json({ message: "Invalid article id" });
    }
    const article = await TournamentArticle.findOne({
      _id: req.params.articleId,
      tournament: tournament._id,
      deletedAt: null,
    });
    if (!article) return res.status(404).json({ message: "Article not found" });

    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (body.title !== undefined) article.title = sanitizeText(readString(body, "title", { required: true, max: 300 }), 300);
    if (body.body !== undefined) article.body = sanitizeArticleBody(readString(body, "body", { max: 20000 }));
    if (body.coverImage !== undefined) article.coverImage = readString(body, "coverImage", { max: 500 });
    if (body.excerpt !== undefined) article.excerpt = sanitizeText(readString(body, "excerpt", { max: 400 }), 400);
    else if (body.body !== undefined && !article.excerpt) article.excerpt = autoExcerpt(article.body);
    if (body.slug !== undefined) {
      const desired = readString(body, "slug", { max: 120 }) || article.title;
      article.slug = await uniqueArticleSlug(tournament._id, desired, article._id);
    }
    if (body.published !== undefined) {
      const nowPublished = body.published === true;
      if (nowPublished && !article.publishedAt) article.publishedAt = new Date();
      article.published = nowPublished;
    }
    await article.save();

    res.status(200).json({
      article: { ...publicArticleDetail(article.toObject()), published: article.published },
      message: "Article updated",
    });
  } catch (error) {
    if (error instanceof HttpError) return res.status(error.status).json({ message: error.message });
    if (error?.code === 11000) return res.status(409).json({ message: "That slug is already used in this tournament" });
    console.error("Error updating article:", error);
    res.status(400).json({ message: error.message || "Failed to update article", error: error.message });
  }
};

export const adminDeleteArticle = async (req, res) => {
  try {
    const tournament = await requireTournament(req);
    if (!mongoose.isValidObjectId(req.params.articleId)) {
      return res.status(400).json({ message: "Invalid article id" });
    }
    const article = await TournamentArticle.findOne({
      _id: req.params.articleId,
      tournament: tournament._id,
      deletedAt: null,
    });
    if (!article) return res.status(404).json({ message: "Article not found" });

    article.deletedAt = new Date();
    await article.save();

    recordAudit({
      req,
      action: "tournament.article_deleted",
      targetType: "tournament",
      targetId: tournament._id,
      targetLabel: tournament.name,
      metadata: { articleId: String(article._id) },
    });

    res.status(200).json({ message: "Article deleted" });
  } catch (error) {
    if (error instanceof HttpError) return res.status(error.status).json({ message: error.message });
    console.error("Error deleting article:", error);
    res.status(500).json({ message: "Failed to delete article", error: error.message });
  }
};

export default {
  getTournamentContent,
  getTournamentStats,
  getTournamentStandings,
  listTournamentMedia,
  listTournamentArticles,
  getTournamentArticle,
  adminGetContent,
  adminUpdateContent,
  adminAddPhoto,
  adminAddVideo,
  adminUpdateMedia,
  adminDeleteMedia,
  adminCreateArticle,
  adminUpdateArticle,
  adminDeleteArticle,
};
