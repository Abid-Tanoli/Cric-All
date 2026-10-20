import express from "express";
import {
  sharePost,
  shareTeam,
  sharePlayer,
} from "../controllers/shareController.js";
import validateObjectId from "../middleware/validateObjectId.js";

const router = express.Router();

router.get("/post/:id", validateObjectId("id"), sharePost);
router.get("/team/:id", validateObjectId("id"), shareTeam);
router.get("/player/:id", validateObjectId("id"), sharePlayer);

export default router;
