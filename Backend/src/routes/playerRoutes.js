import express from "express";
import {
  getPlayers,
  createPlayer,
  getPlayerRanking,
  getPlayer,
  updatePlayer,
  deletePlayer,
  bulkDeletePlayers,
} from "../controllers/playerController.js";
import {
  getBattingRankings,
  getBowlingRankings,
  getAllRounderRankings,
  getPlayerRankings
} from "../controllers/rankingsController.js";
import validate from "../middleware/validate.js";
import { createPlayerSchema } from "../validators/playerValidators.js";
import * as playerService from "../services/playerService.js";

const router = express.Router();

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
router.get("/rankings", getPlayerRankings);
router.get("/:id", getPlayer);

router.post("/", validate(createPlayerSchema), createPlayer);
router.post("/bulk-delete", bulkDeletePlayers);
router.post("/:id/assign-team", async (req, res) => {
  try {
    const { teamId, role } = req.body;
    const player = await playerService.assignPlayerToTeam(req.params.id, teamId, role);
    res.status(200).json({ player, message: "Player assigned to team successfully" });
  } catch (error) {
    res.status(400).json({ message: "Failed to assign player", error: error.message });
  }
});
router.put("/:id", updatePlayer);
router.delete("/:id", deletePlayer);
router.delete("/:id/team", async (req, res) => {
  try {
    const player = await playerService.removePlayerFromTeam(req.params.id);
    res.status(200).json({ player, message: "Player removed from team successfully" });
  } catch (error) {
    res.status(400).json({ message: "Failed to remove player from team", error: error.message });
  }
});

export default router;