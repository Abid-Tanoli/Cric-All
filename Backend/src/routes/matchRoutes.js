import express from "express";
import { protect, requireAdmin, requireVerifiedEmail } from "../middleware/authMiddleware.js";
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
import { requireMatchAccess, requireMatchScoreAccess } from "../middleware/matchAccess.js";
import { PERMISSIONS } from "../permissions/orgPermissions.js";
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
const adminOnly = [protect, requireAdmin, requireVerifiedEmail];
// Running a match is a `score_match` job, not a platform-admin one: the tenant
// is Match.organizationRef and the caller's Membership in that organization is
// what grants it. Platform Admins still pass (supervisory, audited). Creating,
// editing and deleting a fixture stays adminOnly.
const scoring = (idParam) => [protect, requireVerifiedEmail, requireMatchScoreAccess(idParam), validateObjectId(idParam)];
// Picking who plays is `create_match`, not `score_match` - same gate the
// org-scoped `PUT /organizations/:id/matches/:matchId/squads` has always used.
// These routes were all `adminOnly` before Phase 9 because they shipped in one
// bulk "Updated structure" commit (6fcb2c8), which left 35 of 51 match routes
// adminOnly, so that grouping carries no intent about who should set a squad. A
// `score_handler` runs the innings and calls the toss; it must not appoint the
// captain, vice-captain or wicket-keepers.
const squad = (idParam) => [protect, requireVerifiedEmail, requireMatchAccess(idParam, PERMISSIONS.CREATE_MATCH), validateObjectId(idParam)];
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
router.post("/:matchId/score", ...scoring("matchId"), scoringRateLimit, validate(updateScoreSchema), updateScore);
router.post("/:matchId/end-innings", ...scoring("matchId"), validate(endInningsSchema), endInnings);
router.post("/:matchId/start-next-innings", ...scoring("matchId"), startNextInnings);
router.post("/:matchId/reduce-overs", ...scoring("matchId"), validate(reduceOversSchema), reduceOvers);
router.post("/:matchId/resolve-tie", ...scoring("matchId"), validate(resolveTieSchema), resolveTie);
router.post("/:matchId/start-super-over", ...scoring("matchId"), validate(startSuperOverInningsSchema), startSuperOverInnings);
router.put("/:matchId/edit-commentary", ...scoring("matchId"), validate(editCommentarySchema), editCommentary);
router.post("/:matchId/field-click", ...scoring("matchId"), scoringRateLimit, validate(handleFieldClickSchema), handleFieldClick);
router.post("/:matchId/revert-ball", ...scoring("matchId"), scoringRateLimit, validate(revertLastBallSchema), revertLastBall);
router.post("/:matchId/set-bowler", ...scoring("matchId"), scoringRateLimit, validate(setBowlerSchema), setBowler);
router.post("/:matchId/ai-commentary", ...scoring("matchId"), generateAICommentary);
router.post("/:matchId/timeout", ...scoring("matchId"), validate(useStrategicTimeoutSchema), useStrategicTimeout);
router.post("/:matchId/drs", ...scoring("matchId"), validate(recordDRSReviewSchema), recordDRSReview);
router.post("/:matchId/reset-innings", ...scoring("matchId"), scoringRateLimit, validate(resetInningsSchema), resetInnings);
router.post("/:matchId/reset-match", ...scoring("matchId"), scoringRateLimit, resetMatch);
router.post("/:matchId/retire-batsman", ...scoring("matchId"), validate(retireBatsmanSchema), retireBatsman);
router.put("/:matchId/edit-ball", ...scoring("matchId"), scoringRateLimit, validate(editBallSchema), editBall);
router.post("/:matchId/officials", ...adminOnly, validateObjectId("matchId"), assignMatchOfficial);
router.put("/:matchId/officials/:userId", ...adminOnly, validateObjectId("matchId"), validateObjectId("userId"), updateMatchOfficial);
router.post("/:matchId/umpire-signal", ...adminOnly, validateObjectId("matchId"), triggerUmpireSignal);
router.put("/:matchId/official-status", ...scoring("matchId"), updateMatchStatusOfficial);

router.patch("/:id/featured", ...adminOnly, validateObjectId("id"), toggleMatchFeatured);
router.put("/:id", ...adminOnly, validateObjectId("id"), updateMatch);
router.put("/:id/status", ...scoring("id"), updateMatchStatus);
router.put("/:id/mom", ...scoring("id"), setMOM);
router.put("/:matchId/playing-xi", ...squad("matchId"), setPlayingXI);
router.put("/:matchId/openers", ...squad("matchId"), setOpeners);
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
router.put("/:matchId/toss", ...scoring("matchId"), updateToss);
router.put("/:matchId/squad15", ...squad("matchId"), setSquad15);
router.put("/:matchId/twelfth-man", ...squad("matchId"), setTwelfthMan);
router.put("/:matchId/bowling-xi", ...squad("matchId"), setBowlingXI);
router.put("/:matchId/team-roles", ...squad("matchId"), setTeamRoles);

router.delete("/:id", ...adminOnly, validateObjectId("id"), deleteMatch);

export default router;
