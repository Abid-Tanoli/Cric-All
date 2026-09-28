import express from "express";
import {
  getPlayers,
  createPlayer,
  getPlayerRanking,
  getPlayer,
  getPlayerMatches,
  updatePlayer,
  deletePlayer,
  bulkDeletePlayers,
  getHeadToHead,
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
import { createPlayerSchema } from "../validators/playerValidators.js";
import * as playerService from "../services/playerService.js";
import { protect, requireAdmin, requireVerifiedEmail } from "../middleware/authMiddleware.js";
import validateObjectId from "../middleware/validateObjectId.js";

const router = express.Router();
const adminOnly = [protect, requireAdmin, requireVerifiedEmail];

router.get("/", getPlayers);
router.get("/ranking", getPlayerRanking);
router.get("/free-agents", async (req, res) => {
  try {
    const { search } = req.query;
    const freeAgents = await playerService.getFreeAgents(search);
    res.status(200).json(freeAgents);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch free agents", error: error.message });
  }
});
router.get("/rankings/batting", getBattingRankings);
router.get("/rankings/bowling", getBowlingRankings);
router.get("/rankings/all-rounder", getAllRounderRankings);
router.get("/rankings/fielder", getFielderRankings);
router.get("/rankings/wicket-keeper", getWicketKeeperRankings);
router.get("/rankings", getPlayerRankings);
router.get("/:id/matches", validateObjectId("id"), getPlayerMatches);
router.get("/:id", validateObjectId("id"), getPlayer);
router.get("/head-to-head/:batsmanId/:bowlerId", validateObjectId("batsmanId"), validateObjectId("bowlerId"), getHeadToHead);

router.post("/", validate(createPlayerSchema), createPlayer);
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
router.put("/:id", ...adminOnly, validateObjectId("id"), updatePlayer);
router.delete("/:id", ...adminOnly, validateObjectId("id"), deletePlayer);
router.delete("/:id/team", ...adminOnly, validateObjectId("id"), async (req, res) => {
  try {
    const player = await playerService.removePlayerFromTeam(req.params.id);
    res.status(200).json({ player, message: "Player removed from team successfully" });
  } catch (error) {
    res.status(400).json({ message: "Failed to remove player from team", error: error.message });
  }
});

export default router;
