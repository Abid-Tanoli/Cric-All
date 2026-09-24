import express from "express";
import { protect, requireAdmin } from "../middleware/authMiddleware.js";
import validateObjectId from "../middleware/validateObjectId.js";
import {
  getMatches,
  getMatch,
  createMatch,
  updateMatch,
  deleteMatch,
  setMOM,
  getMatchStats,
  getMatchLiveStats,
  getMatchSummary,
  getMatchPartnershipsSummary,
  getMatchSquads,
  updateMatchStatus,
  setPlayingXI,
  setOpeners,
  updateToss,
  setSquad15,
  setTwelfthMan,
  setBowlingXI,
  setTeamRoles,
  toggleMatchFeatured
} from "../controllers/matchController.js";
import {
  updateScore,
  resolveTie,
  startSuperOverInnings,
  editCommentary,
  handleFieldClick,
  revertLastBall,
  setBowler,
  generateAICommentary,
  useStrategicTimeout,
  recordDRSReview,
  resetMatch,
  editBall,
  retireBatsman
} from "../controllers/scoreController.js";
import {
  endInnings,
  startNextInnings,
  reduceOvers,
  resetInnings
} from "../controllers/inningsController.js";
import {
  getMatchPartnerships,
  getActivePartnership,
  getWagonWheelData,
  getMatchAnalytics,
  getMatchGraphData,
  getMatchBoundaries,
  getMatchReviews,
  getMatchCommentary,
  assignMatchOfficial,
  getMatchOfficials,
  updateMatchOfficial,
  triggerUmpireSignal,
  updateMatchStatusOfficial
} from "../controllers/analyticsController.js";

import validate from "../middleware/validate.js";
import rateLimiter from "../middleware/rateLimiter.js";
import {
  updateScoreSchema,
  editCommentarySchema,
  handleFieldClickSchema,
  revertLastBallSchema,
  setBowlerSchema,
  endInningsSchema,
  reduceOversSchema,
  resetInningsSchema,
  resolveTieSchema,
  startSuperOverInningsSchema,
  editBallSchema,
  recordDRSReviewSchema,
  useStrategicTimeoutSchema,
  retireBatsmanSchema,
} from "../validators/scoreValidators.js";
import Match from "../models/Match.js";

const router = express.Router();
const adminOnly = [protect, requireAdmin];
const scoringRateLimit = rateLimiter({ windowMs: 1000, max: 12 });

router.get("/", getMatches);
router.get("/:id", validateObjectId("id"), getMatch);
router.get("/:id/stats", validateObjectId("id"), getMatchStats);
router.get("/:id/live-stats", validateObjectId("id"), getMatchLiveStats);
router.get("/:id/summary", validateObjectId("id"), getMatchSummary);
router.get("/:id/partnerships", validateObjectId("id"), getMatchPartnershipsSummary);
router.get("/:id/squads", validateObjectId("id"), getMatchSquads);
router.get("/:id/partnerships/:inning", validateObjectId("id"), getMatchPartnerships);
router.get("/:id/partnerships/:inning/active", validateObjectId("id"), getActivePartnership);
router.get("/:id/wagon-wheel/:inning", validateObjectId("id"), getWagonWheelData);
router.get("/:id/wagon-wheel/:inning/:batsmanId", validateObjectId("id"), validateObjectId("batsmanId"), getWagonWheelData);
router.get("/:id/analytics", validateObjectId("id"), getMatchAnalytics);
router.get("/:id/graph-data", validateObjectId("id"), getMatchGraphData);
router.get("/:id/boundaries", validateObjectId("id"), getMatchBoundaries);
router.get("/:id/drs", validateObjectId("id"), getMatchReviews);
router.get("/:id/commentary", validateObjectId("id"), getMatchCommentary);
router.get("/:id/officials", validateObjectId("id"), getMatchOfficials);

router.post("/", ...adminOnly, createMatch);
router.post("/:matchId/score", ...adminOnly, scoringRateLimit, validateObjectId("matchId"), validate(updateScoreSchema), updateScore);
router.post("/:matchId/end-innings", ...adminOnly, validateObjectId("matchId"), validate(endInningsSchema), endInnings);
router.post("/:matchId/start-next-innings", ...adminOnly, validateObjectId("matchId"), startNextInnings);
router.post("/:matchId/reduce-overs", ...adminOnly, validateObjectId("matchId"), validate(reduceOversSchema), reduceOvers);
router.post("/:matchId/resolve-tie", ...adminOnly, validateObjectId("matchId"), validate(resolveTieSchema), resolveTie);
router.post("/:matchId/start-super-over", ...adminOnly, validateObjectId("matchId"), validate(startSuperOverInningsSchema), startSuperOverInnings);
router.put("/:matchId/edit-commentary", ...adminOnly, validateObjectId("matchId"), validate(editCommentarySchema), editCommentary);
router.post("/:matchId/field-click", ...adminOnly, scoringRateLimit, validateObjectId("matchId"), validate(handleFieldClickSchema), handleFieldClick);
router.post("/:matchId/revert-ball", ...adminOnly, scoringRateLimit, validateObjectId("matchId"), validate(revertLastBallSchema), revertLastBall);
router.post("/:matchId/set-bowler", ...adminOnly, validateObjectId("matchId"), validate(setBowlerSchema), setBowler);
router.post("/:matchId/ai-commentary", ...adminOnly, validateObjectId("matchId"), generateAICommentary);
router.post("/:matchId/timeout", ...adminOnly, validateObjectId("matchId"), validate(useStrategicTimeoutSchema), useStrategicTimeout);
router.post("/:matchId/drs", ...adminOnly, validateObjectId("matchId"), validate(recordDRSReviewSchema), recordDRSReview);
router.post("/:matchId/reset-innings", ...adminOnly, scoringRateLimit, validateObjectId("matchId"), validate(resetInningsSchema), resetInnings);
router.post("/:matchId/reset-match", ...adminOnly, scoringRateLimit, validateObjectId("matchId"), resetMatch);
router.post("/:matchId/retire-batsman", ...adminOnly, validateObjectId("matchId"), validate(retireBatsmanSchema), retireBatsman);
router.put("/:matchId/edit-ball", ...adminOnly, scoringRateLimit, validateObjectId("matchId"), validate(editBallSchema), editBall);
router.post("/:matchId/officials", ...adminOnly, validateObjectId("matchId"), assignMatchOfficial);
router.put("/:matchId/officials/:userId", ...adminOnly, validateObjectId("matchId"), validateObjectId("userId"), updateMatchOfficial);
router.post("/:matchId/umpire-signal", ...adminOnly, validateObjectId("matchId"), triggerUmpireSignal);
router.put("/:matchId/official-status", ...adminOnly, validateObjectId("matchId"), updateMatchStatusOfficial);

router.patch("/:id/featured", ...adminOnly, validateObjectId("id"), toggleMatchFeatured);
router.put("/:id", ...adminOnly, validateObjectId("id"), updateMatch);
router.put("/:id/status", ...adminOnly, validateObjectId("id"), updateMatchStatus);
router.put("/:id/mom", ...adminOnly, validateObjectId("id"), setMOM);
router.put("/:matchId/playing-xi", ...adminOnly, validateObjectId("matchId"), setPlayingXI);
router.put("/:matchId/openers", ...adminOnly, validateObjectId("matchId"), setOpeners);
router.put("/:matchId/format", ...adminOnly, validateObjectId("matchId"), async (req, res) => {
  try {
    const { matchId } = req.params;
    const { matchFormat, totalOvers, powerplayEnabled, powerplayOvers } = req.body;
    const match = await Match.findById(matchId);
    if (!match) return res.status(404).json({ message: "Match not found" });
    match.matchType = matchFormat;
    match.totalOvers = totalOvers;
    if (!match.powerplayConfig) match.powerplayConfig = {};
    match.powerplayConfig.enabled = powerplayEnabled;
    match.powerplayConfig.overs = powerplayOvers || 0;
    await match.save();
    res.json({ match, message: "Match format updated" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});
router.put("/:matchId/toss", ...adminOnly, validateObjectId("matchId"), updateToss);
router.put("/:matchId/squad15", ...adminOnly, validateObjectId("matchId"), setSquad15);
router.put("/:matchId/twelfth-man", ...adminOnly, validateObjectId("matchId"), setTwelfthMan);
router.put("/:matchId/bowling-xi", ...adminOnly, validateObjectId("matchId"), setBowlingXI);
router.put("/:matchId/team-roles", ...adminOnly, validateObjectId("matchId"), setTeamRoles);

router.delete("/:id", ...adminOnly, validateObjectId("id"), deleteMatch);

export default router;
