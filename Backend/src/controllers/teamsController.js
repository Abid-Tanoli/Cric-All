import Team from "../models/Team.js";
import TeamCategory from "../models/TeamCategory.js";
import * as teamService from "../services/teamService.js";
import * as playerService from "../services/playerService.js";

export const listTeams = async (req, res) => {
  try {
    const { category, categoryRef, organizationRef, city, search, type } = req.query;
    const teams = await teamService.listTeams({ category, categoryRef, organizationRef, city, search, type });
    res.status(200).json(teams);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch teams", error: error.message });
  }
};

export const getTeam = async (req, res) => {
  try {
    const profile = await teamService.getTeamProfile(req.params.id);
    if (!profile) {
      return res.status(404).json({ success: false, message: "Team not found" });
    }
    res.status(200).json({ success: true, data: profile });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch team", error: error.message });
  }
};

export const createTeam = async (req, res) => {
  try {
    const team = await teamService.createTeam(req.body);
    res.status(201).json({ team, message: "Team created successfully" });
  } catch (error) {
    res.status(400).json({ message: "Failed to create team", error: error.message });
  }
};

export const updateTeam = async (req, res) => {
  try {
    const team = await teamService.updateTeam(req.params.id, req.body);
    res.status(200).json({ team, message: "Team updated successfully" });
  } catch (error) {
    res.status(400).json({ message: "Failed to update team", error: error.message });
  }
};

export const updateTeamLocation = async (req, res) => {
  try {
    const { latitude, longitude, googleMapsUrl, placeId, fullAddress, city, area } = req.body;
    const team = await Team.findById(req.params.id);
    if (!team) return res.status(404).json({ message: "Team not found" });

    if (latitude !== undefined) team.latitude = latitude;
    if (longitude !== undefined) team.longitude = longitude;
    if (googleMapsUrl !== undefined) team.googleMapsUrl = googleMapsUrl;
    if (placeId !== undefined) team.placeId = placeId;
    if (fullAddress !== undefined) team.fullAddress = fullAddress;
    if (city !== undefined) team.city = city;
    if (area !== undefined) team.area = area;

    await team.save();
    res.status(200).json({ team, message: "Location updated successfully" });
  } catch (error) {
    res.status(400).json({ message: "Failed to update location", error: error.message });
  }
};

export const deleteTeam = async (req, res) => {
  try {
    const result = await teamService.deleteTeam(req.params.id);
    res.status(200).json({ message: "Team deleted successfully", ...result });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete team", error: error.message });
  }
};

export const addPlayersToTeam = async (req, res) => {
  try {
    const { playerIds } = req.body;
    if (!playerIds || !Array.isArray(playerIds)) {
      return res.status(400).json({ message: "Player IDs array is required" });
    }

    const results = [];
    for (const playerId of playerIds) {
      const player = await teamService.assignPlayerToTeam(req.params.id, playerId, "player");
      results.push(player);
    }

    const team = await Team.findById(req.params.id).populate("players");
    res.status(200).json({ team, players: results, message: "Players added successfully" });
  } catch (error) {
    res.status(400).json({ message: "Failed to add players", error: error.message });
  }
};

export const removePlayersFromTeam = async (req, res) => {
  try {
    const { playerIds } = req.body;
    if (!playerIds || !Array.isArray(playerIds)) {
      return res.status(400).json({ message: "Player IDs array is required" });
    }

    for (const playerId of playerIds) {
      await teamService.removePlayerFromTeam(req.params.id, playerId);
    }

    const team = await Team.findById(req.params.id).populate("players");
    res.status(200).json({ team, message: "Players removed successfully" });
  } catch (error) {
    res.status(400).json({ message: "Failed to remove players", error: error.message });
  }
};

export const updatePlayerRoleInTeam = async (req, res) => {
  try {
    const player = await teamService.updatePlayerRole(req.params.id, req.params.playerId, req.body);
    res.status(200).json({ player, message: "Player role updated successfully" });
  } catch (error) {
    res.status(400).json({ message: "Failed to update player role", error: error.message });
  }
};

export const getTeamPlayers = async (req, res) => {
  try {
    const { role, search } = req.query;
    const players = await playerService.getTeamPlayers(req.params.id, { role, search });
    res.status(200).json(players);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch team players", error: error.message });
  }
};

export const getTeamRanking = async (req, res) => {
  try {
    const { default: TeamRanking } = await import("../models/TeamRanking.js");
    const ranking = await TeamRanking.findOne({ team: req.params.id })
      .populate("team", "name shortName logo");
    if (!ranking) {
      return res.status(200).json({ message: "Ranking not yet computed" });
    }
    res.status(200).json(ranking);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch ranking", error: error.message });
  }
};

export const getTeamMatches = async (req, res) => {
  try {
    const { default: Match } = await import("../models/Match.js");
    const matches = await Match.find({ teams: req.params.id })
      .populate("teams", "name shortName logo")
      .sort({ startAt: -1 })
      .limit(20);
    res.status(200).json(matches);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch matches", error: error.message });
  }
};
