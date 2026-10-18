import express from "express";
import {
  getFeed,
  getPost,
  getComments,
  getTeamPosts,
  getPlayerPosts,
  // Will add more as we implement
} from "../controllers/communityController.js";
import { protect, optionalProtect } from "../middleware/authMiddleware.js";
import validateObjectId from "../middleware/validateObjectId.js";
import rateLimiter from "../middleware/rateLimiter.js";

const router = express.Router();

// Public reads
router.get("/feed", getFeed);
router.get("/posts/:id", validateObjectId("id"), getPost);
router.get("/posts/:id/comments", validateObjectId("id"), getComments);
router.get("/teams/:id/posts", validateObjectId("id"), getTeamPosts);
router.get("/players/:id/posts", validateObjectId("id"), getPlayerPosts);

export default router;
