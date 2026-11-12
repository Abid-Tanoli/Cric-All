import mongoose from "mongoose";
import Team from "../models/Team.js";
import Player from "../models/Player.js";
import TeamCategory from "../models/TeamCategory.js";
import * as teamService from "../services/teamService.js";
import * as playerService from "../services/playerService.js";
import { recordAudit } from "../utils/audit.js";
import {
  PLAYER_ROSTER_SELECT,
  resolveViewerContext,
  sanitizeTeamPublic,
} from "../utils/publicProjection.js";

// When the owner types a role inline, keep the free-text `role` for display and
// also set `playingRole` when it is one of the model's classifications, so the
// player does not show up as the default "Batsman" in every picker.
const PLAYING_ROLES = new Set([
  "Batsman",
  "Bowler",
  "All-Rounder",
  "Batting-All-Rounder",
  "Bowling-All-Rounder",
  "Wicket-Keeper",
]);

// Phase 4: teams that an organization owns.
//
// Two rules are enforced here and are the whole point of the phase:
//   1. every team is looked up WITH its organization in the query, so a team
//      from another organization is a 404 and never a 403 — the existence of
//      somebody else's team is not this caller's business;
//   2. `organizationRef` always comes from the authorized `req.org`, never from
//      the request body, so a member cannot attach a team to somebody else's
//      organization.

const notFound = (res, message = "Not found") => res.status(404).json({ message, code: "TEAM_NOT_FOUND" });

async function loadOwnedTeam(req, res) {
  const teamId = req.params.teamId;
  if (!mongoose.Types.ObjectId.isValid(teamId)) {
    notFound(res, "Team not found");
    return null;
  }
  const team = await Team.findOne({ _id: teamId, organizationRef: req.org._id });
  if (!team) {
    notFound(res, "Team not found");
    return null;
  }
  return team;
}

// Round 5: this was a hand-written whitelist that still returned `phone`, `email`
// and `socialLinks` regardless of the team's own `privacy` flags, and passed
// `players` straight through — in `addOrgTeamPlayers`/`removeOrgTeamPlayers` that
// array is fully populated, so the response carried whole Player documents.
// Delegating to the shared sanitizer means one place decides what a team payload
// may contain.
//
// These routes are already gated on `manage_teams` by the route middleware, so
// the caller is by definition a manager of the owning organization and gets the
// full team (and its full roster) — the "org member with manage permission" tier.
// `playerCount` is kept because three existing tests assert it.
const teamPayload = (team, viewer = null) => {
  const safe = sanitizeTeamPublic(team, { viewer, canViewPrivate: true });
  return { ...safe, playerCount: (safe.players || []).length };
};

// A team category is a configuration concern, not a free string. Same rule as
// organization `type`: the value must exist in the platform's TeamCategory
// collection, which TeamCategory.seedDefaults() populates.
async function assertCategoryIsConfigured(category) {
  if (!category) return;
  const configured = await TeamCategory.exists({
    $or: [
      { slug: String(category).toLowerCase() },
      { name: { $regex: `^${String(category).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } },
    ],
  });
  if (!configured) {
    const error = new Error(`"${category}" is not a configured team category.`);
    error.code = "TEAM_CATEGORY_UNKNOWN";
    throw error;
  }
}

export const listOrgTeams = async (req, res) => {
  try {
    const { search, isActive } = req.query || {};
    const teams = await teamService.listTeams({
      organizationRef: req.org._id,
      search: search ? String(search).trim() : undefined,
      isActive: isActive === undefined ? undefined : isActive === "true",
      limit: 200,
    });

    // Phase 6 needs the roster *with names*: the fixture squad editor is a set
    // of buttons a coach ticks, and a button labelled with a raw ObjectId is
    // useless. One extra query for the whole organization rather than one per
    // team.
    const playerIds = [...new Set(teams.flatMap((team) => (team.players || []).map(String)))];
    const players = playerIds.length
      ? await Player.find({ _id: { $in: playerIds } })
          .select("name playingRole battingPosition imageUrl")
          .lean()
      : [];
    const playerById = new Map(players.map((player) => [String(player._id), player]));

    const items = teams.map((team) => ({
      ...team,
      roster: (team.players || [])
        .map((playerId) => playerById.get(String(playerId)))
        .filter(Boolean)
        .map((player) => ({
          _id: player._id,
          name: player.name,
          playingRole: player.playingRole || "",
          battingPosition: player.battingPosition || "",
          imageUrl: player.imageUrl || "",
        })),
    }));

    res.status(200).json({ items, total: items.length });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch teams", error: error.message });
  }
};

export const createOrgTeam = async (req, res) => {
  try {
    await assertCategoryIsConfigured(req.body.category);

    const team = await teamService.createTeam({
      ...req.body,
      // Never taken from the body — the guard middleware already proved this
      // caller may act on this organization.
      organizationRef: req.org._id,
      organization: req.org.name,
      type: req.body.type || "local_team",
    });

    await recordAudit({
      req,
      organization: req.org._id,
      action: "team.created",
      targetType: "team",
      targetId: team._id,
      targetLabel: team.name,
    });

    res.status(201).json({ team: teamPayload(team), message: "Team created successfully" });
  } catch (error) {
    if (error.code === "TEAM_CATEGORY_UNKNOWN") {
      return res.status(422).json({ message: error.message, code: error.code });
    }
    if (/already exists/i.test(error.message || "")) {
      return res.status(409).json({ message: error.message, code: "TEAM_NAME_TAKEN" });
    }
    res.status(400).json({ message: "Failed to create team", error: error.message });
  }
};

export const updateOrgTeam = async (req, res) => {
  try {
    const existing = await loadOwnedTeam(req, res);
    if (!existing) return;

    if (req.body.category) await assertCategoryIsConfigured(req.body.category);

    // organizationRef is intentionally not in this object: an organization
    // cannot be moved by its own members.
    const { players, isActive, ...editable } = req.body;
    const team = await teamService.updateTeam(existing._id, { ...editable, ...(isActive === undefined ? {} : { isActive }) });

    await recordAudit({
      req,
      organization: req.org._id,
      action: "team.updated",
      targetType: "team",
      targetId: team._id,
      targetLabel: team.name,
      metadata: { fields: Object.keys(req.body) },
    });

    res.status(200).json({ team: teamPayload(team), message: "Team updated successfully" });
  } catch (error) {
    if (error.code === "TEAM_CATEGORY_UNKNOWN") {
      return res.status(422).json({ message: error.message, code: error.code });
    }
    if (/already exists/i.test(error.message || "")) {
      return res.status(409).json({ message: error.message, code: "TEAM_NAME_TAKEN" });
    }
    res.status(400).json({ message: "Failed to update team", error: error.message });
  }
};

export const deleteOrgTeam = async (req, res) => {
  try {
    const team = await loadOwnedTeam(req, res);
    if (!team) return;

    await teamService.deleteTeam(team._id);
    await recordAudit({
      req,
      organization: req.org._id,
      action: "team.deleted",
      targetType: "team",
      targetId: team._id,
      targetLabel: team.name,
    });

    res.status(200).json({ message: "Team deleted successfully", id: String(team._id) });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete team", error: error.message });
  }
};

export const addOrgTeamPlayers = async (req, res) => {
  try {
    const team = await loadOwnedTeam(req, res);
    if (!team) return;

    const assigned = [];
    for (const playerId of req.body.playerIds || []) {
      const player = await Player.findById(playerId).select("_id team createdBy name");
      if (!player) {
        return res.status(404).json({
          message: "One of those players does not exist.",
          code: "PLAYER_NOT_FOUND",
        });
      }

      // A player already on another organization's roster belongs to that
      // tenant; attaching it here would move a rival's player into this squad.
      // An unattached profile is only attachable by the account that created it.
      if (player.team) {
        const owningTeam = await Team.findById(player.team).select("organizationRef").lean();
        if (!owningTeam || String(owningTeam.organizationRef) !== String(req.org._id)) {
          return res.status(403).json({
            message: "That player belongs to another organization.",
            code: "PLAYER_NOT_OWNED",
          });
        }
      } else if (!player.createdBy || String(player.createdBy) !== String(req.user?._id)) {
        return res.status(403).json({
          message: "That player is not yours to add. Create a new player instead.",
          code: "PLAYER_NOT_OWNED",
        });
      }

      const assignedPlayer = await teamService.assignPlayerToTeam(team._id, playerId, "player");
      assigned.push(assignedPlayer._id);
    }

    let createdPlayer = null;
    if (req.body.newPlayer) {
      const { name, role, phone } = req.body.newPlayer;
      try {
        await playerService.assertPlayerNotDuplicate({ name, team: team._id, phone });
      } catch (dupErr) {
        if (dupErr.code === "PLAYER_DUPLICATE") {
          return res.status(409).json({
            message: dupErr.message,
            code: dupErr.code,
            existing: dupErr.existing,
          });
        }
        throw dupErr;
      }

      const storedPhone = playerService.canonicalPlayerPhone(phone);
      const chosenRole = String(role || "").trim();
      createdPlayer = await Player.create({
        name,
        role: chosenRole || "player",
        ...(PLAYING_ROLES.has(chosenRole) ? { playingRole: chosenRole } : {}),
        ...(storedPhone ? { phone: storedPhone } : {}),
        team: team._id,
        createdBy: req.user?._id || null,
      });
      await Team.findByIdAndUpdate(team._id, { $addToSet: { players: createdPlayer._id } });
      assigned.push(createdPlayer._id);
    }

    await recordAudit({
      req,
      organization: req.org._id,
      action: "team.players_added",
      targetType: "team",
      targetId: team._id,
      targetLabel: team.name,
      metadata: { playerIds: assigned.map(String) },
    });

    const fresh = await Team.findById(team._id).populate("players", "name role playingRole battingPosition imageUrl");
    res.status(200).json({
      team: teamPayload(fresh),
      player: createdPlayer,
      message: createdPlayer ? "Player added to the team" : "Players added successfully",
    });
  } catch (error) {
    if (/Player not found/i.test(error.message || "")) {
      return res.status(404).json({ message: "One of those players does not exist.", code: "PLAYER_NOT_FOUND" });
    }
    res.status(400).json({ message: "Failed to add players", error: error.message });
  }
};

export const removeOrgTeamPlayers = async (req, res) => {
  try {
    const team = await loadOwnedTeam(req, res);
    if (!team) return;

    for (const playerId of req.body.playerIds) {
      await teamService.removePlayerFromTeam(team._id, playerId);
    }

    await recordAudit({
      req,
      organization: req.org._id,
      action: "team.players_removed",
      targetType: "team",
      targetId: team._id,
      targetLabel: team.name,
      metadata: { playerIds: req.body.playerIds.map(String) },
    });

    const fresh = await Team.findById(team._id).populate("players", "name role playingRole battingPosition imageUrl");
    res.status(200).json({ team: teamPayload(fresh), message: "Players removed successfully" });
  } catch (error) {
    res.status(400).json({ message: "Failed to remove players", error: error.message });
  }
};

export const updateOrgTeamPlayerRole = async (req, res) => {
  try {
    const team = await loadOwnedTeam(req, res);
    if (!team) return;
    if (!mongoose.Types.ObjectId.isValid(req.params.playerId)) {
      return notFound(res, "Player not found");
    }

    const player = await teamService.updatePlayerRole(team._id, req.params.playerId, req.body);

    await recordAudit({
      req,
      organization: req.org._id,
      action: "team.player_role_changed",
      targetType: "player",
      targetId: player._id,
      targetLabel: player.name,
      metadata: { teamId: String(team._id), role: req.body.role },
    });

    res.status(200).json({ player, message: "Player role updated successfully" });
  } catch (error) {
    if (/Player not in this team/i.test(error.message || "")) {
      return res.status(404).json({ message: "That player is not in this team.", code: "PLAYER_NOT_IN_TEAM" });
    }
    res.status(400).json({ message: "Failed to update player role", error: error.message });
  }
};

export default {
  listOrgTeams,
  createOrgTeam,
  updateOrgTeam,
  deleteOrgTeam,
  addOrgTeamPlayers,
  removeOrgTeamPlayers,
  updateOrgTeamPlayerRole,
};
