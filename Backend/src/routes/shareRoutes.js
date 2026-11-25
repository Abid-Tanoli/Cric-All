import express from "express";
import {
  sharePost,
  shareTeam,
  sharePlayer,
  shareClub,
} from "../controllers/shareController.js";
import validateObjectId from "../middleware/validateObjectId.js";

const router = express.Router();

router.get("/post/:id", validateObjectId("id"), sharePost);
router.get("/team/:id", validateObjectId("id"), shareTeam);
router.get("/player/:id", validateObjectId("id"), sharePlayer);
// Clubs are addressed by slug, so no ObjectId validation here.
router.get("/club/:slug", shareClub);

export default router;
