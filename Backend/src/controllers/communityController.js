import mongoose from "mongoose";
import CommunityPost from "../models/CommunityPost.js";
import CommunityLike from "../models/CommunityLike.js";
import CommunityComment from "../models/CommunityComment.js";
import CommunityReport from "../models/CommunityReport.js";
import User from "../models/User.js";
import Player from "../models/Player.js";
import Team from "../models/Team.js";
import Membership from "../models/Membership.js";
import { getCommunitySettings, setCommunitySettings } from "../models/CommunitySettings.js";
import { protect, optionalProtect, requireAdmin, requireVerifiedEmail } from "../middleware/authMiddleware.js";
import { requireOrgPermission, isPlatformAdmin, resolveOrgAccess } from "../middleware/orgAccess.js";
import { PERMISSIONS, roleHasPermission } from "../permissions/orgPermissions.js";
import rateLimiter from "../middleware/rateLimiter.js";
import validateObjectId from "../middleware/validateObjectId.js";
import validate from "../middleware/validate.js";
import { 
  parseVideoUrl, 
  isValidVideoUrl, 
  sanitizeText, 
  isOwnUploadUrl,
  stripHtmlTags,
  stripControlChars,
  canViewPost,
  cursorDate,
  buildShareUrls
} from "../utils/communityHelpers.js";
import {
  createPostSchema,
  updatePostSchema,
  createCommentSchema,
  createReportSchema,
  adminSettingsPatchSchema
} from "../validators/communityValidators.js";
import { isReservedTestName, reservedNamesMongoClause } from "../utils/publicProjection.js";
import { recordAudit } from "../utils/audit.js";

// Rate limiters
const createPostLimiter = rateLimiter({ windowMs: 60 * 1000, max: 5 }); // 5 posts per min per user/IP
const commentLimiter = rateLimiter({ windowMs: 60 * 1000, max: 10 });
const likeLimiter = rateLimiter({ windowMs: 60 * 1000, max: 30 });
const reportLimiter = rateLimiter({ windowMs: 60 * 1000, max: 5 });
const shareLimiter = rateLimiter({ windowMs: 60 * 1000, max: 20 });

// Helper to check if user is banned
async function isBannedPoster(userId) {
  const settings = await getCommunitySettings();
  if (!settings.bannedPosters || settings.bannedPosters.length === 0) return false;
  return settings.bannedPosters.some(id => String(id) === String(userId));
}

// Check community enabled
async function checkCommunityEnabled(res) {
  const settings = await getCommunitySettings();
  if (!settings.communityEnabled) {
    return res.status(403).json({ 
      message: "Community is disabled", 
      code: "COMMUNITY_DISABLED" 
    });
  }
  return null;
}

// Get platform backend URL
function getBackendUrl() {
  return process.env.PUBLIC_BACKEND_URL || process.env.BACKEND_URL || "http://127.0.0.1:5000";
}

// Public SPA origin; share links point there, not at the API.
function getFrontendUrl() {
  return (process.env.PUBLIC_FRONTEND_URL || "https://cricall.online").replace(/\/+$/, "");
}

// GET /feed - cursor pagination
export const getFeed = [
  optionalProtect,
  async (req, res) => {
    try {
      const settings = await getCommunitySettings();
      if (!settings.communityEnabled) {
        return res.json({ posts: [], nextCursor: null, hasMore: false });
      }
      
      const { cursor, limit = 20, kind, subjectType, subjectId } = req.query;
      const limitNum = Math.min(parseInt(limit) || 20, 50);
      
      const query = { status: "published", isDeleted: false };
      
      if (kind && ["photo", "video", "article", "story"].includes(kind)) {
        query.kind = kind;
      }
      
      if (subjectType && ["team", "player", "user"].includes(subjectType)) {
        query["subject.type"] = subjectType;
        if (subjectId && mongoose.Types.ObjectId.isValid(subjectId)) {
          query["subject.ref"] = subjectId;
        }
      }
      
      const cursorAt = cursorDate(cursor);
      if (cursorAt) {
        query.createdAt = { $lt: cursorAt };
      }
      
      let posts = await CommunityPost.find(query)
        .sort({ createdAt: -1 })
        .limit(limitNum + 1)
        .populate("authorUser", "name avatar")
        .lean();
      
      // Filter out reserved test names if they appear in author or other fields
      posts = posts.filter(p => {
        if (p.authorUser && isReservedTestName(p.authorUser.name)) return false;
        return true;
      });
      
      const hasMore = posts.length > limitNum;
      if (hasMore) posts = posts.slice(0, limitNum);
      
      const nextCursor = posts.length > 0 ? posts[posts.length - 1].createdAt.toISOString() : null;
      
      res.json({ posts, nextCursor, hasMore });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch feed" });
    }
  }
];

// GET /posts/:id
//
// A pending/hidden/removed post is not public, but it is still *theirs*: the
// author and a platform admin can open it (canViewPost), which is what makes
// postMode "approval" usable - the author sees what is waiting for review.
export const getPost = [
  optionalProtect,
  async (req, res) => {
    try {
      const settings = await getCommunitySettings();
      if (!settings.communityEnabled) {
        return res.status(404).json({ message: "Not found", code: "COMMUNITY_DISABLED" });
      }
      
      const post = await CommunityPost.findOne({ 
        _id: req.params.id, 
        isDeleted: false 
      }).populate("authorUser", "name avatar").lean();
      
      if (!post || !canViewPost(post, req)) {
        return res.status(404).json({ message: "Post not found" });
      }
      
      if (isReservedTestName(post.authorUser?.name)) {
        return res.status(404).json({ message: "Post not found" });
      }
      
      res.json({ post });
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch post" });
    }
  }
];

// GET /posts/:id/comments (cursor)
//
// The comment list of a non-public post is just as private as the post: the
// post's own visibility rule decides whether this list exists for the caller.
export const getComments = [
  optionalProtect,
  async (req, res) => {
    try {
      const settings = await getCommunitySettings();
      if (!settings.communityEnabled) {
        return res.json({ comments: [], nextCursor: null, hasMore: false });
      }
      
      const post = await CommunityPost.findOne({ _id: req.params.id, isDeleted: false })
        .populate("authorUser", "name")
        .lean();
      if (!post || !canViewPost(post, req) || isReservedTestName(post.authorUser?.name)) {
        return res.status(404).json({ message: "Post not found" });
      }

      const { cursor, limit = 20 } = req.query;
      const limitNum = Math.min(parseInt(limit) || 20, 50);
      
      const query = { post: req.params.id, status: "published", isDeleted: false };
      const cursorAt = cursorDate(cursor);
      if (cursorAt) {
        query.createdAt = { $lt: cursorAt };
      }
      
      let comments = await CommunityComment.find(query)
        .sort({ createdAt: -1 })
        .limit(limitNum + 1)
        .populate("author", "name avatar")
        .lean();
      
      const hasMore = comments.length > limitNum;
      if (hasMore) comments = comments.slice(0, limitNum);
      
      const nextCursor = comments.length > 0 ? comments[comments.length - 1].createdAt.toISOString() : null;
      
      res.json({ comments, nextCursor, hasMore });
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch comments" });
    }
  }
];

// GET /teams/:id/posts
export const getTeamPosts = [
  optionalProtect,
  async (req, res) => {
    try {
      const settings = await getCommunitySettings();
      if (!settings.communityEnabled) {
        return res.json({ posts: [], nextCursor: null, hasMore: false });
      }
      
      const team = await Team.findById(req.params.id).select("name").lean();
      if (!team || isReservedTestName(team.name)) {
        return res.json({ posts: [], nextCursor: null, hasMore: false });
      }
      
      const { cursor, limit = 20, kind } = req.query;
      const limitNum = Math.min(parseInt(limit) || 20, 50);
      
      const query = { 
        "subject.type": "team", 
        "subject.ref": req.params.id,
        status: "published", 
        isDeleted: false 
      };
      if (kind && ["photo", "video", "article", "story"].includes(kind)) {
        query.kind = kind;
      }
      const cursorAt = cursorDate(cursor);
      if (cursorAt) {
        query.createdAt = { $lt: cursorAt };
      }
      
      let posts = await CommunityPost.find(query)
        .sort({ createdAt: -1 })
        .limit(limitNum + 1)
        .populate("authorUser", "name avatar")
        .lean();
      
      const hasMore = posts.length > limitNum;
      if (hasMore) posts = posts.slice(0, limitNum);
      
      const nextCursor = posts.length > 0 ? posts[posts.length - 1].createdAt.toISOString() : null;
      
      res.json({ posts, nextCursor, hasMore });
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch team posts" });
    }
  }
];

// GET /players/:id/posts
export const getPlayerPosts = [
  optionalProtect,
  async (req, res) => {
    try {
      const settings = await getCommunitySettings();
      if (!settings.communityEnabled) {
        return res.json({ posts: [], nextCursor: null, hasMore: false });
      }
      
      const player = await Player.findById(req.params.id).select("name").lean();
      if (!player || isReservedTestName(player.name)) {
        return res.json({ posts: [], nextCursor: null, hasMore: false });
      }
      
      const { cursor, limit = 20, kind } = req.query;
      const limitNum = Math.min(parseInt(limit) || 20, 50);
      
      const query = { 
        "subject.type": "player", 
        "subject.ref": req.params.id,
        status: "published", 
        isDeleted: false 
      };
      if (kind && ["photo", "video", "article", "story"].includes(kind)) {
        query.kind = kind;
      }
      const cursorAt = cursorDate(cursor);
      if (cursorAt) {
        query.createdAt = { $lt: cursorAt };
      }
      
      let posts = await CommunityPost.find(query)
        .sort({ createdAt: -1 })
        .limit(limitNum + 1)
        .populate("authorUser", "name avatar")
        .lean();
      
      const hasMore = posts.length > limitNum;
      if (hasMore) posts = posts.slice(0, limitNum);
      
      const nextCursor = posts.length > 0 ? posts[posts.length - 1].createdAt.toISOString() : null;
      
      res.json({ posts, nextCursor, hasMore });
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch player posts" });
    }
  }
];

// ---------------------------------------------------------------------------
// Write endpoints
// ---------------------------------------------------------------------------

/**
 * Every write funnels through the same three gates in this order:
 * community enabled -> writer not banned -> action allowed. Returning the
 * same shape from one helper keeps the error contract identical on every
 * route, which is what the tests assert against.
 */
async function guardWrite(req, res) {
  const settings = await getCommunitySettings();
  if (!settings.communityEnabled) {
    res.status(403).json({ message: "Community is disabled", code: "COMMUNITY_DISABLED" });
    return null;
  }
  if (await isBannedPoster(req.user._id)) {
    res.status(403).json({ message: "You are not allowed to post in the community.", code: "COMMUNITY_POSTER_BANNED" });
    return null;
  }
  return settings;
}

/**
 * Subject authorization. The client picks *whose* page the post lands on;
 * the server decides whether that pick is allowed, and it never copies a
 * client-supplied author id anywhere.
 *
 *  - user    : you may post as yourself (ref === your id) — nobody else.
 *  - team    : the owning organization's manage_teams OR publish_content
 *              member (the same permission set the org API enforces, resolved
 *              through resolveOrgAccess — the core of requireOrgPermission;
 *              the middleware form needs the org id in the URL, and here it
 *              arrives inside the request body). A handler directly managing
 *              an org-less team (Team.managedBy) may post for it too.
 *  - player  : the user the player profile is linked to, via
 *              Player.createdBy (the linkage set when a player account
 *              registers, see authController). MyPlayers has no separate
 *              link table to consult — createdBy *is* the MyPlayers link.
 *
 * Platform admins pass every branch: the Admin app is supervisory.
 */
async function authorizeSubject(req, res, subject) {
  if (isPlatformAdmin(req)) return true;

  if (subject.type === "user") {
    if (String(subject.ref) === String(req.user._id)) return true;
    return res.status(403).json({
      message: "You can only post as yourself.",
      code: "COMMUNITY_SUBJECT_DENIED",
    });
  }

  if (subject.type === "team") {
    const team = await Team.findById(subject.ref).select("name organizationRef managedBy isPublic").lean();
    if (!team || isReservedTestName(team.name)) {
      return res.status(404).json({ message: "Team not found", code: "COMMUNITY_SUBJECT_NOT_FOUND" });
    }
    if (team.organizationRef) {
      const access = await resolveOrgAccess({ _id: team.organizationRef }, req.user);
      if (!access.membership) {
        return res.status(403).json({
          message: "You are not a member of the team's organization.",
          code: "COMMUNITY_SUBJECT_DENIED",
        });
      }
      const allowed = [PERMISSIONS.MANAGE_TEAMS, PERMISSIONS.PUBLISH_CONTENT].some((p) =>
        roleHasPermission(access.roles, p)
      );
      if (allowed) return true;
      return res.status(403).json({
        message: "Your role in this organization does not allow posting for this team.",
        code: "COMMUNITY_SUBJECT_DENIED",
      });
    }
    if (team.managedBy && String(team.managedBy) === String(req.user._id)) return true;
    return res.status(403).json({
      message: "Only the team's manager can post for this team.",
      code: "COMMUNITY_SUBJECT_DENIED",
    });
  }

  if (subject.type === "player") {
    const player = await Player.findById(subject.ref).select("name createdBy").lean();
    if (!player || isReservedTestName(player.name)) {
      return res.status(404).json({ message: "Player not found", code: "COMMUNITY_SUBJECT_NOT_FOUND" });
    }
    if (player.createdBy && String(player.createdBy) === String(req.user._id)) return true;
    return res.status(403).json({
      message: "You are not linked to this player.",
      code: "COMMUNITY_SUBJECT_DENIED",
    });
  }

  return res.status(400).json({ message: "Unknown subject type", code: "COMMUNITY_SUBJECT_INVALID" });
}

/**
 * Media and video rules, shared by create and update:
 *  - images must be this platform's own upload URLs (never hot-linked
 *    externals) and respect the admin-tunable per-post ceiling;
 *  - video URLs must come from the YouTube/Facebook/Instagram allowlist.
 * Returns an error body on failure, or null when the payload is clean.
 */
function validatePostMedia(settings, { media, videoUrl }) {
  const images = media || [];
  const maxImages = settings.maxImagesPerPost ?? 6;
  if (images.length > maxImages) {
    return { status: 400, body: { message: `At most ${maxImages} images per post`, code: "COMMUNITY_TOO_MANY_IMAGES" } };
  }
  // The upload endpoint (uploadRoutes) already rejects non-jpg/png/webp bytes
  // and anything over 5MB before a URL ever exists; the community layer
  // re-checks the extension so a hand-crafted `/uploads/evil.exe` reference
  // cannot slip into a post even if a file with that name were somehow stored.
  const IMAGE_EXT_RE = /\.(jpe?g|png|webp)$/i;
  for (const item of images) {
    if (!isOwnUploadUrl(item.url)) {
      return {
        status: 400,
        body: { message: "Images must use this platform's own upload URLs.", code: "COMMUNITY_EXTERNAL_IMAGE" },
      };
    }
    const pathOnly = String(item.url).split(/[?#]/)[0];
    if (!IMAGE_EXT_RE.test(pathOnly)) {
      return {
        status: 400,
        body: { message: "Images must be jpg, png or webp.", code: "COMMUNITY_IMAGE_TYPE" },
      };
    }
  }
  if (videoUrl && !isValidVideoUrl(videoUrl)) {
    return {
      status: 400,
      body: { message: "Video must be a YouTube, Facebook or Instagram URL.", code: "COMMUNITY_VIDEO_NOT_ALLOWED" },
    };
  }
  return null;
}

/** The author's post budget for the current UTC day. */
async function postsTodayCount(userId) {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  return CommunityPost.countDocuments({
    authorUser: userId,
    createdAt: { $gte: startOfDay },
    status: { $ne: "removed" },
  });
}

// POST /posts
export const createPost = [
  protect,
  requireVerifiedEmail,
  createPostLimiter,
  validate(createPostSchema),
  async (req, res) => {
    try {
      const settings = await guardWrite(req, res);
      if (!settings) return;

      const { kind, subject, title, body, media, videoUrl } = req.body;

      if (!(await authorizeSubject(req, res, subject))) return;

      const mediaError = validatePostMedia(settings, { media, videoUrl });
      if (mediaError) return res.status(mediaError.status).json(mediaError.body);

      const limit = settings.maxPostsPerUserPerDay ?? 10;
      if ((await postsTodayCount(req.user._id)) >= limit) {
        return res.status(429).json({
          message: `Daily post limit of ${limit} reached. Try again tomorrow.`,
          code: "COMMUNITY_DAILY_LIMIT",
        });
      }

      const cleanTitle = title ? sanitizeText(title, 120) : undefined;
      const cleanBody = body ? sanitizeText(body, 10000) : "";
      const cleanMedia = (media || []).map((item) => ({
        url: item.url,
        alt: item.alt ? sanitizeText(item.alt, 200) : "",
      }));

      let video = null;
      if (videoUrl) video = parseVideoUrl(videoUrl);

      const post = await CommunityPost.create({
        authorUser: req.user._id,
        subject: { type: subject.type, ref: subject.ref },
        kind,
        title: cleanTitle,
        body: cleanBody,
        media: cleanMedia,
        videoUrl: videoUrl || "",
        videoProvider: video ? video.provider : null,
        videoId: video ? video.id : "",
        status: settings.postMode === "approval" ? "pending" : "published",
      });

      res.status(201).json({ post });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to create post" });
    }
  }
];

// PATCH /posts/:id — author only, and only while the post is in an editable
// state. A hidden or removed post belongs to the moderation flow; editing it
// would let an author rewrite content an admin has already judged.
export const updateOwnPost = [
  protect,
  requireVerifiedEmail,
  createPostLimiter,
  validateObjectId("id"),
  validate(updatePostSchema),
  async (req, res) => {
    try {
      const settings = await guardWrite(req, res);
      if (!settings) return;

      const post = await CommunityPost.findOne({ _id: req.params.id, isDeleted: false });
      if (!post) return res.status(404).json({ message: "Post not found" });

      if (String(post.authorUser) !== String(req.user._id)) {
        return res.status(403).json({ message: "You can only edit your own posts.", code: "COMMUNITY_NOT_AUTHOR" });
      }
      if (post.status !== "published" && post.status !== "pending") {
        return res.status(403).json({ message: "This post is under review and cannot be edited.", code: "COMMUNITY_POST_LOCKED" });
      }

      const mediaError = validatePostMedia(settings, req.body);
      if (mediaError) return res.status(mediaError.status).json(mediaError.body);

      const patch = req.body;
      if (patch.kind !== undefined) post.kind = patch.kind;
      if (patch.title !== undefined) post.title = sanitizeText(patch.title, 120);
      if (patch.body !== undefined) post.body = sanitizeText(patch.body, 10000);
      if (patch.media !== undefined) {
        post.media = patch.media.map((item) => ({ url: item.url, alt: item.alt ? sanitizeText(item.alt, 200) : "" }));
      }
      if (patch.videoUrl !== undefined) {
        const video = patch.videoUrl ? parseVideoUrl(patch.videoUrl) : null;
        post.videoUrl = patch.videoUrl || "";
        post.videoProvider = video ? video.provider : null;
        post.videoId = video ? video.id : "";
      }

      await post.save();
      res.json({ post });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to update post" });
    }
  }
];

// DELETE /posts/:id — author only; soft delete so moderation history survives.
export const deleteOwnPost = [
  protect,
  createPostLimiter,
  validateObjectId("id"),
  async (req, res) => {
    try {
      const settings = await guardWrite(req, res);
      if (!settings) return;

      const post = await CommunityPost.findOne({ _id: req.params.id, isDeleted: false });
      if (!post) return res.status(404).json({ message: "Post not found" });

      if (String(post.authorUser) !== String(req.user._id)) {
        return res.status(403).json({ message: "You can only delete your own posts.", code: "COMMUNITY_NOT_AUTHOR" });
      }

      post.isDeleted = true;
      post.deletedAt = new Date();
      post.deletedBy = req.user._id;
      post.status = "removed";
      await post.save();

      res.json({ message: "Post deleted" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to delete post" });
    }
  }
];

// POST /posts/:id/like — toggle. The unique (user, post) index makes the
// double-click race safe: a duplicate create is treated as "already liked".
export const toggleLike = [
  protect,
  likeLimiter,
  validateObjectId("id"),
  async (req, res) => {
    try {
      const settings = await guardWrite(req, res);
      if (!settings) return;

      const post = await CommunityPost.findOne({ _id: req.params.id, status: "published", isDeleted: false })
        .select("_id")
        .lean();
      if (!post) return res.status(404).json({ message: "Post not found" });

      const removed = await CommunityLike.findOneAndDelete({ user: req.user._id, post: post._id });
      if (removed) {
        await CommunityPost.updateOne(
          { _id: post._id, likeCount: { $gt: 0 } },
          { $inc: { likeCount: -1 } }
        );
        return res.json({ liked: false });
      }

      try {
        await CommunityLike.create({ user: req.user._id, post: post._id });
      } catch (err) {
        if (err && err.code === 11000) return res.json({ liked: true });
        throw err;
      }
      await CommunityPost.updateOne({ _id: post._id }, { $inc: { likeCount: 1 } });
      res.json({ liked: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to toggle like" });
    }
  }
];

// POST /posts/:id/comments
export const createComment = [
  protect,
  requireVerifiedEmail,
  commentLimiter,
  validateObjectId("id"),
  validate(createCommentSchema),
  async (req, res) => {
    try {
      const settings = await guardWrite(req, res);
      if (!settings) return;

      const post = await CommunityPost.findOne({ _id: req.params.id, status: "published", isDeleted: false })
        .select("_id")
        .lean();
      if (!post) return res.status(404).json({ message: "Post not found" });

      const comment = await CommunityComment.create({
        post: post._id,
        author: req.user._id,
        body: sanitizeText(req.body.body, 1000),
      });
      await CommunityPost.updateOne({ _id: post._id }, { $inc: { commentCount: 1 } });

      res.status(201).json({ comment });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to create comment" });
    }
  }
];

// DELETE /posts/:id/comments/:commentId — commenter only; soft delete.
export const deleteOwnComment = [
  protect,
  commentLimiter,
  validateObjectId("id"),
  validateObjectId("commentId"),
  async (req, res) => {
    try {
      const settings = await guardWrite(req, res);
      if (!settings) return;

      const comment = await CommunityComment.findOne({
        _id: req.params.commentId,
        post: req.params.id,
        isDeleted: false,
      });
      if (!comment) return res.status(404).json({ message: "Comment not found" });

      if (String(comment.author) !== String(req.user._id)) {
        return res.status(403).json({ message: "You can only delete your own comments.", code: "COMMUNITY_NOT_AUTHOR" });
      }

      comment.isDeleted = true;
      comment.status = "removed";
      comment.deletedAt = new Date();
      comment.deletedBy = req.user._id;
      await comment.save();
      await CommunityPost.updateOne({ _id: req.params.id, commentCount: { $gt: 0 } }, { $inc: { commentCount: -1 } });

      res.json({ message: "Comment deleted" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to delete comment" });
    }
  }
];

// POST /posts/:id/report — one report per user per post (unique index); three
// distinct reports auto-hide the post pending admin review.
export const reportPost = [
  protect,
  reportLimiter,
  validateObjectId("id"),
  validate(createReportSchema),
  async (req, res) => {
    try {
      const settings = await guardWrite(req, res);
      if (!settings) return;

      const post = await CommunityPost.findOne({ _id: req.params.id, status: "published", isDeleted: false })
        .select("_id authorUser")
        .lean();
      if (!post) return res.status(404).json({ message: "Post not found" });

      if (String(post.authorUser) === String(req.user._id)) {
        return res.status(400).json({ message: "You cannot report your own post.", code: "COMMUNITY_SELF_REPORT" });
      }

      // One report per user per post. The unique index below is the concurrency
      // backstop, but a fresh database builds indexes on first model use, which
      // can trail the very first inserts by enough time to accept a duplicate —
      // so the ordinary duplicate case is answered by an explicit read first,
      // the same way registration answers a duplicate email.
      const existingReport = await CommunityReport.findOne({
        post: post._id,
        reporter: req.user._id,
      })
        .select("_id")
        .lean();
      if (existingReport) {
        return res.status(409).json({
          message: "You have already reported this post.",
          code: "COMMUNITY_ALREADY_REPORTED",
        });
      }

      try {
        await CommunityReport.create({
          post: post._id,
          comment: null,
          reporter: req.user._id,
          reason: req.body.reason,
          note: req.body.note ? sanitizeText(req.body.note, 500) : "",
        });
      } catch (err) {
        if (err && err.code === 11000) {
          return res.status(409).json({ message: "You have already reported this post.", code: "COMMUNITY_ALREADY_REPORTED" });
        }
        throw err;
      }

      const updated = await CommunityPost.findByIdAndUpdate(
        post._id,
        { $inc: { reportCount: 1 } },
        { new: true }
      ).select("reportCount status");

      let autoHidden = false;
      if (updated.reportCount >= 3 && updated.status === "published") {
        await CommunityPost.updateOne({ _id: post._id, status: "published" }, { $set: { status: "hidden" } });
        autoHidden = true;
        await recordAudit({
          req,
          action: "community.post.auto_hide",
          targetType: "community_post",
          targetId: post._id,
          metadata: { reportCount: updated.reportCount, threshold: 3 },
        });
      }

      res.status(201).json({ reportCount: updated.reportCount, status: autoHidden ? "hidden" : updated.status });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to report post" });
    }
  }
];

// POST /posts/:id/share — deliberately unauthenticated (a share often happens
// before login) so the limiter is keyed on the caller's IP alone; it counts
// the share and hands back the ready-made network URLs.
export const sharePostCount = [
  shareLimiter,
  validateObjectId("id"),
  async (req, res) => {
    try {
      const settings = await getCommunitySettings();
      if (!settings.communityEnabled) {
        return res.status(403).json({ message: "Community is disabled", code: "COMMUNITY_DISABLED" });
      }

      const post = await CommunityPost.findOne({ _id: req.params.id, status: "published", isDeleted: false })
        .select("title shareCount authorUser")
        .populate("authorUser", "name")
        .lean();
      if (!post || isReservedTestName(post.authorUser?.name)) {
        return res.status(404).json({ message: "Post not found" });
      }

      await CommunityPost.updateOne({ _id: post._id }, { $inc: { shareCount: 1 } });
      const url = `${getFrontendUrl()}/community/post/${post._id}`;

      res.json({ shareCount: post.shareCount + 1, url, urls: buildShareUrls(post._id, post.title, url) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to share post" });
    }
  }
];

// ---------------------------------------------------------------------------
// Admin moderation
//
// These run on Admin-app auth (protect + requireAdmin) and work whether the
// community is enabled or not — a disabled community still needs its queue
// cleared. Every state change is written to the audit log.
// ---------------------------------------------------------------------------

// GET /admin/queue?status=pending|hidden|removed|published&cursor=&limit=
export const adminQueue = [
  protect,
  requireAdmin,
  async (req, res) => {
    try {
      const { status = "pending", cursor, limit = 20 } = req.query;
      const limitNum = Math.min(parseInt(limit) || 20, 50);

      const query = {};
      if (["published", "pending", "hidden", "removed"].includes(status)) {
        query.status = status;
      } else {
        return res.status(400).json({ message: "Invalid status filter" });
      }
      if (cursor) {
        const at = new Date(cursor);
        if (!Number.isNaN(at.getTime())) query.createdAt = { $lt: at };
      }

      let posts = await CommunityPost.find(query)
        .sort({ createdAt: -1 })
        .limit(limitNum + 1)
        .populate("authorUser", "name email")
        .lean();

      const hasMore = posts.length > limitNum;
      if (hasMore) posts = posts.slice(0, limitNum);
      const nextCursor = posts.length > 0 ? posts[posts.length - 1].createdAt.toISOString() : null;

      res.json({ posts, nextCursor, hasMore });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch moderation queue" });
    }
  }
];

/** Shared body for approve/hide/remove/restore: flip status, audit, return. */
function moderationTransition(nextStatus, extra = {}) {
  return [
    protect,
    requireAdmin,
    validateObjectId("id"),
    async (req, res) => {
      try {
        const post = await CommunityPost.findOne({ _id: req.params.id, isDeleted: false });
        if (!post) return res.status(404).json({ message: "Post not found" });

        const previousStatus = post.status;
        post.status = nextStatus;
        Object.assign(post, extra);
        await post.save();

        await recordAudit({
          req,
          action: `community.post.${nextStatus}`,
          targetType: "community_post",
          targetId: post._id,
          targetLabel: post.title || "",
          metadata: { previousStatus, newStatus: nextStatus },
        });

        res.json({ post });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Moderation action failed" });
      }
    },
  ];
}

export const adminApprovePost = moderationTransition("published");
export const adminHidePost = moderationTransition("hidden");
export const adminRemovePost = moderationTransition("removed");
// Restore returns a post to the public feed and clears the author's own
// deletion marks only when they are set, so an admin restore never resurrects
// fields that were never part of a deletion.
export const adminRestorePost = [
  protect,
  requireAdmin,
  validateObjectId("id"),
  async (req, res) => {
    try {
      const post = await CommunityPost.findOne({ _id: req.params.id });
      if (!post) return res.status(404).json({ message: "Post not found" });

      const previousStatus = post.status;
      post.status = "published";
      post.isDeleted = false;
      if (post.deletedAt) post.deletedAt = null;
      if (post.deletedBy) post.deletedBy = null;
      await post.save();

      await recordAudit({
        req,
        action: "community.post.published",
        targetType: "community_post",
        targetId: post._id,
        targetLabel: post.title || "",
        metadata: { previousStatus, newStatus: "published", restored: true },
      });

      res.json({ post });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Moderation action failed" });
    }
  },
];

// POST /admin/users/:id/ban-poster — adds the user to the settings-level ban
// list; every community write checks that list, so this is a platform-wide
// posting ban rather than a per-team one.
export const adminBanPoster = [
  protect,
  requireAdmin,
  validateObjectId("id"),
  async (req, res) => {
    try {
      const user = await User.findById(req.params.id).select("name email").lean();
      if (!user) return res.status(404).json({ message: "User not found" });

      const settings = await getCommunitySettings();
      const banned = (settings.bannedPosters || []).map(String);
      if (banned.includes(String(user._id))) {
        return res.json({ message: "User is already banned from posting.", bannedPosters: banned });
      }

      banned.push(String(user._id));
      await setCommunitySettings({ bannedPosters: banned });

      await recordAudit({
        req,
        action: "community.poster.ban",
        targetType: "user",
        targetId: user._id,
        targetLabel: user.name || user.email || "",
      });

      res.json({ message: "User banned from posting.", bannedPosters: banned });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to ban poster" });
    }
  }
];

// GET /admin/settings
export const adminGetSettings = [
  protect,
  requireAdmin,
  async (req, res) => {
    try {
      res.json(await getCommunitySettings());
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to read community settings" });
    }
  }
];

// PATCH /admin/settings
export const adminUpdateSettings = [
  protect,
  requireAdmin,
  validate(adminSettingsPatchSchema),
  async (req, res) => {
    try {
      const patch = { ...req.body };
      if (patch.bannedPosters) patch.bannedPosters = patch.bannedPosters.map(String);
      const next = await setCommunitySettings(patch);

      await recordAudit({
        req,
        action: "community.settings.update",
        targetType: "community_settings",
        targetId: "community",
        metadata: { patch },
      });

      res.json(next);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to update community settings" });
    }
  }
];
