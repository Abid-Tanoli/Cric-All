import mongoose from "mongoose";
import CommunityPost from "../models/CommunityPost.js";
import CommunityLike from "../models/CommunityLike.js";
import CommunityComment from "../models/CommunityComment.js";
import CommunityReport from "../models/CommunityReport.js";
import User from "../models/User.js";
import Player from "../models/Player.js";
import Team from "../models/Team.js";
import Membership from "../models/Membership.js";
import { getCommunitySettings } from "../models/CommunitySettings.js";
import { protect, optionalProtect, requireAdmin } from "../middleware/authMiddleware.js";
import { requireOrgPermission } from "../middleware/orgAccess.js";
import { PERMISSIONS } from "../permissions/orgPermissions.js";
import rateLimiter from "../middleware/rateLimiter.js";
import validateObjectId from "../middleware/validateObjectId.js";
import { 
  parseVideoUrl, 
  isValidVideoUrl, 
  sanitizeText, 
  isOwnUploadUrl,
  stripHtmlTags,
  stripControlChars
} from "../utils/communityHelpers.js";
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
      
      if (cursor) {
        query.createdAt = { $lt: new Date(cursor) };
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
        status: "published", 
        isDeleted: false 
      }).populate("authorUser", "name avatar").lean();
      
      if (!post) {
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
export const getComments = [
  optionalProtect,
  async (req, res) => {
    try {
      const settings = await getCommunitySettings();
      if (!settings.communityEnabled) {
        return res.json({ comments: [], nextCursor: null, hasMore: false });
      }
      
      const { cursor, limit = 20 } = req.query;
      const limitNum = Math.min(parseInt(limit) || 20, 50);
      
      const query = { post: req.params.id, status: "published", isDeleted: false };
      if (cursor) {
        query.createdAt = { $lt: new Date(cursor) };
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
      if (cursor) {
        query.createdAt = { $lt: new Date(cursor) };
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
      if (cursor) {
        query.createdAt = { $lt: new Date(cursor) };
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
