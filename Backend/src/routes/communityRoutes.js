import express from "express";
import {
  getFeed,
  getPost,
  getComments,
  getTeamPosts,
  getPlayerPosts,
  createPost,
  updateOwnPost,
  deleteOwnPost,
  toggleLike,
  createComment,
  deleteOwnComment,
  reportPost,
  sharePostCount,
  adminQueue,
  adminApprovePost,
  adminHidePost,
  adminRemovePost,
  adminRestorePost,
  adminBanPoster,
  adminGetSettings,
  adminUpdateSettings,
} from "../controllers/communityController.js";
import validateObjectId from "../middleware/validateObjectId.js";

const router = express.Router();

// Public reads
router.get("/feed", getFeed);
router.get("/posts/:id", validateObjectId("id"), getPost);
router.get("/posts/:id/comments", validateObjectId("id"), getComments);
router.get("/teams/:id/posts", validateObjectId("id"), getTeamPosts);
router.get("/players/:id/posts", validateObjectId("id"), getPlayerPosts);

// Writes. Auth, rate limits, body validation and the community-enabled /
// banned-poster gates live inside the controller handlers (guardWrite), so
// every write answers with the same error contract. The client never supplies
// the author: it comes from the token. Subject ids are authorized per type.
router.post("/posts", createPost);
router.patch("/posts/:id", updateOwnPost);
router.delete("/posts/:id", deleteOwnPost);
router.post("/posts/:id/like", validateObjectId("id"), toggleLike);
router.post("/posts/:id/comments", createComment);
router.delete("/posts/:id/comments/:commentId", deleteOwnComment);
router.post("/posts/:id/report", validateObjectId("id"), reportPost);
// Sharing is deliberately unauthenticated; the controller rate-limits by IP.
router.post("/posts/:id/share", sharePostCount);

// Admin moderation (Admin-app auth: protect + requireAdmin, enforced in the
// controller handler chains).
router.get("/admin/queue", adminQueue);
router.post("/admin/posts/:id/approve", adminApprovePost);
router.post("/admin/posts/:id/hide", adminHidePost);
router.post("/admin/posts/:id/remove", adminRemovePost);
router.post("/admin/posts/:id/restore", adminRestorePost);
router.post("/admin/users/:id/ban-poster", adminBanPoster);
router.get("/admin/settings", adminGetSettings);
router.patch("/admin/settings", adminUpdateSettings);

export default router;
