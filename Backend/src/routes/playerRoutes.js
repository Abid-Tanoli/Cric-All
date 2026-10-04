import express from "express";
import {
  getPlayers,
  createPlayer,
  getMyPlayers,
  getPlayerRanking,
  getPlayer,
  getPlayerMatches,
  updatePlayer,
  deletePlayer,
  bulkDeletePlayers,
  getHeadToHead,
  listFreeAgents,
} from "../controllers/playerController.js";
import {
  getBattingRankings,
  getBowlingRankings,
  getAllRounderRankings,
  getFielderRankings,
  getWicketKeeperRankings,
  getPlayerRankings
} from "../controllers/rankingsController.js";
import validate from "../middleware/validate.js";
import {
  createPlayerSchema,
  updatePlayerSchema,
  adminPlayerSchema,
  adminUpdatePlayerSchema,
} from "../validators/playerValidators.js";
import * as playerService from "../services/playerService.js";
import { protect, optionalProtect, requireAdmin, requireVerifiedEmail } from "../middleware/authMiddleware.js";
import { isPlatformAdmin } from "../middleware/orgAccess.js";
import validateObjectId from "../middleware/validateObjectId.js";

const router = express.Router();
const adminOnly = [protect, requireAdmin, requireVerifiedEmail];

// One route, three kinds of caller. The platform Admin app has always been
// allowed to send the richer payload (a team assignment on create, career stats
// on update); a self-service creator is held to the strict shape that has no
// `team` and no `stats` key at all. Choosing the schema here — rather than
// keeping a second Admin-only endpoint — means there is one URL to reason about,
// and a field the Admin app can use is never silently dropped.
const createBody = (req, res, next) =>
  validate(isPlatformAdmin(req) ? adminPlayerSchema : createPlayerSchema)(req, res, next);

const updateBody = (req, res, next) =>
  validate(isPlatformAdmin(req) ? adminUpdatePlayerSchema : updatePlayerSchema)(req, res, next);

// Round 5 — `optionalProtect` on the reads whose shape is viewer-dependent.
// It never rejects: an absent or invalid token simply means "anonymous".
router.get("/", optionalProtect, getPlayers);
router.get("/ranking", optionalProtect, getPlayerRanking);
// Round 5: this read was left inline in the route file and returned the service
// result verbatim, so the privacy flags were never applied and `address` /
// `socialLinks` reached anonymous callers. It now goes through the controller so
// the projection is testable like every other public read.
router.get("/free-agents", optionalProtect, listFreeAgents);
// Must be declared before "/:id" — Express matches in registration order, so a
// "/mine" declared after the id route is swallowed by it and 400s on
// validateObjectId.
router.get("/mine", protect, getMyPlayers);
router.get("/rankings/batting", getBattingRankings);
router.get("/rankings/bowling", getBowlingRankings);
router.get("/rankings/all-rounder", getAllRounderRankings);
router.get("/rankings/fielder", getFielderRankings);
router.get("/rankings/wicket-keeper", getWicketKeeperRankings);
router.get("/rankings", getPlayerRankings);
router.get("/:id/matches", validateObjectId("id"), getPlayerMatches);
router.get("/:id", optionalProtect, validateObjectId("id"), getPlayer);
router.get("/head-to-head/:batsmanId/:bowlerId", validateObjectId("batsmanId"), validateObjectId("bowlerId"), getHeadToHead);

// A player profile is a public claim about a person rather than privileged
// data, so creating one is open to any verified account — it used to be open to
// *anyone at all*, including unauthenticated callers (see docs/architecture-audit.md).
// A creator can never set `stats` or `team` here; career numbers come from the
// scoring engine and squad membership from the org team routes.
router.post("/", protect, requireVerifiedEmail, createBody, createPlayer);
router.post("/bulk-delete", ...adminOnly, bulkDeletePlayers);
router.post("/:id/assign-team", ...adminOnly, validateObjectId("id"), async (req, res) => {
  try {
    const { teamId, role } = req.body;
    const player = await playerService.assignPlayerToTeam(req.params.id, teamId, role);
    res.status(200).json({ player, message: "Player assigned to team successfully" });
  } catch (error) {
    res.status(400).json({ message: "Failed to assign player", error: error.message });
  }
});
// Write access to a specific profile is decided per-player in the controller
// (resolvePlayerWriteAccess): platform admin, the creator, or a manager of the
// organization that owns the player's team. The route only establishes identity.
router.put(
  "/:id",
  protect,
  requireVerifiedEmail,
  validateObjectId("id"),
  updateBody,
  updatePlayer
);
router.delete("/:id", protect, requireVerifiedEmail, validateObjectId("id"), deletePlayer);
router.delete("/:id/team", ...adminOnly, validateObjectId("id"), async (req, res) => {
  try {
    const player = await playerService.removePlayerFromTeam(req.params.id);
    res.status(200).json({ player, message: "Player removed from team successfully" });
  } catch (error) {
    res.status(400).json({ message: "Failed to remove player from team", error: error.message });
  }
});

export default router;
