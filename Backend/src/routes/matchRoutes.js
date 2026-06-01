import express from "express";
import {
  getMatches,
  getMatch,
  createMatch,
  updateMatch,
  deleteMatch,
  setMOM,
  getMatchStats,
  updateMatchStatus,
  setPlayingXI,
  setOpeners,
  updateToss,
  setSquad15,
  setTwelfthMan,
  setBowlingXI,
  setTeamRoles
} from "../controllers/matchController.js";
import {
  updateScore,
  endInnings,
  startNextInnings,
  reduceOvers,
  resolveTie,
  startSuperOverInnings,
  editCommentary,
  handleFieldClick,
  revertLastBall,
  setBowler,
  generateAICommentary,
  useStrategicTimeout,
  recordDRSReview,
  resetInnings,
  resetMatch,
  editBall,
  retireBatsman
} from "../controllers/scoreController.js";
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

const router = express.Router();

router.get("/", getMatches);
router.get("/:id", getMatch);
router.get("/:id/stats", getMatchStats);
router.get("/:id/partnerships/:inning", getMatchPartnerships);
router.get("/:id/partnerships/:inning/active", getActivePartnership);
router.get("/:id/wagon-wheel/:inning", getWagonWheelData);
router.get("/:id/wagon-wheel/:inning/:batsmanId", getWagonWheelData);
router.get("/:id/analytics", getMatchAnalytics);
router.get("/:id/graph-data", getMatchGraphData);
router.get("/:id/boundaries", getMatchBoundaries);
router.get("/:id/drs", getMatchReviews);
router.get("/:id/commentary", getMatchCommentary);
router.get("/:id/officials", getMatchOfficials);

router.post("/", createMatch);
router.post("/:matchId/score", updateScore);
router.post("/:matchId/end-innings", endInnings);
router.post("/:matchId/start-next-innings", startNextInnings);
router.post("/:matchId/reduce-overs", reduceOvers);
router.post("/:matchId/resolve-tie", resolveTie);
router.post("/:matchId/start-super-over", startSuperOverInnings);
router.put("/:matchId/edit-commentary", editCommentary);
router.post("/:matchId/field-click", handleFieldClick);
router.post("/:matchId/revert-ball", revertLastBall);
router.post("/:matchId/set-bowler", setBowler);
router.post("/:matchId/ai-commentary", generateAICommentary);
router.post("/:matchId/timeout", useStrategicTimeout);
router.post("/:matchId/drs", recordDRSReview);
router.post("/:matchId/reset-innings", resetInnings);
router.post("/:matchId/reset-match", resetMatch);
router.post("/:matchId/retire-batsman", retireBatsman);
router.put("/:matchId/edit-ball", editBall);
router.post("/:matchId/officials", assignMatchOfficial);
router.put("/:matchId/officials/:userId", updateMatchOfficial);
router.post("/:matchId/umpire-signal", triggerUmpireSignal);
router.put("/:matchId/official-status", updateMatchStatusOfficial);

router.put("/:id", updateMatch);
router.put("/:id/status", updateMatchStatus);
router.put("/:id/mom", setMOM);
router.put("/:matchId/playing-xi", setPlayingXI);
router.put("/:matchId/openers", setOpeners);
router.put("/:matchId/toss", updateToss);
router.put("/:matchId/squad15", setSquad15);
router.put("/:matchId/twelfth-man", setTwelfthMan);
router.put("/:matchId/bowling-xi", setBowlingXI);
router.put("/:matchId/team-roles", setTeamRoles);

router.delete("/:id", deleteMatch);

export default router;