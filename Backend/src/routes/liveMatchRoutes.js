import express from "express";
import { addBall } from "../controllers/liveMatchController.js";
import { protect, requireVerifiedEmail } from "../middleware/authMiddleware.js";
import { requireMatchScoreAccess } from "../middleware/matchAccess.js";
import rateLimiter from "../middleware/rateLimiter.js";
import validate from "../middleware/validate.js";
import validateObjectId from "../middleware/validateObjectId.js";
import { updateScoreSchema } from "../validators/scoreValidators.js";

const router = express.Router();

const scoringRateLimit = rateLimiter({ windowMs: 1000, max: 12 });

router.post(
  "/:matchId/ball",
  protect,
  requireVerifiedEmail,
  requireMatchScoreAccess("matchId"),
  scoringRateLimit,
  validateObjectId("matchId"),
  validate(updateScoreSchema),
  addBall,
);

export default router;
