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
          .select("name playingRole battingPosition imageUrl jerseyNumber")
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
          jerseyNumber: player.jerseyNumber ?? null,
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

// Shared by the single-player and "add several" halves of the squad route, so
// both write exactly the same fields. `role` stays the free-text display value;
// `playingRole` is the classification every picker reads.
function squadPlayerFields(input, team, userId) {
  const chosenRole = String(input.role || "").trim();
  const payload = {
    name: input.name,
    role: chosenRole || "player",
    team: team._id,
    createdBy: userId || null,
  };
  const playingRole = input.playingRole || (PLAYING_ROLES.has(chosenRole) ? chosenRole : "");
  if (playingRole && PLAYING_ROLES.has(playingRole)) payload.playingRole = playingRole;
  if (input.battingStyle) payload.battingStyle = input.battingStyle;
  if (input.bowlingStyle) payload.bowlingStyle = input.bowlingStyle;
  if (input.jerseyNumber != null) payload.jerseyNumber = input.jerseyNumber;
  if (input.locationRefs) payload.locationRefs = input.locationRefs;
  if (input.locationLabels) payload.locationLabels = input.locationLabels;

  // Same mapping the self-service form makes: the legacy address block is filled
  // from the curated labels so older screens still show a place.
  const labels = input.locationLabels || {};
  const address = {};
  for (const key of ["town", "district", "city", "province", "country"]) {
    if (labels[key]) address[key] = labels[key];
  }
  if (Object.keys(address).length) payload.address = address;

  const storedPhone = playerService.canonicalPlayerPhone(input.phone);
  if (storedPhone) payload.phone = storedPhone;
  return payload;
}

/**
 * GET /organizations/:id/teams/:teamId/players/available?search=
 *
 * The owner-side squad picker needs a list of people it may actually attach:
 * free agents this account created, and players already on another team of the
 * same organization. Searching by name or phone is done here rather than on the
 * public free-agent endpoint because a phone number is not public data.
 * Guarded by the same manage_players permission as the write it feeds.
 */
export const listOrgTeamAvailablePlayers = async (req, res) => {
  try {
    const team = await loadOwnedTeam(req, res);
    if (!team) return;

    const orgTeamIds = await Team.find({ organizationRef: req.org._id }).distinct("_id");
    const query = {
      team: { $ne: team._id },
      $or: [
        { team: { $in: orgTeamIds } },
        { $and: [{ $or: [{ team: null }, { team: { $exists: false } }] }, { createdBy: req.user?._id || null }] },
      ],
    };

    const term = String(req.query.search || "").trim();
    if (term) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const digits = term.replace(/\D/g, "");
      const matches = [{ name: { $regex: escaped, $options: "i" } }];
      if (digits.length >= 3) matches.push({ phone: { $regex: digits } });
      query.$and = [...(query.$and || []), { $or: matches }];
    }

    const players = await Player.find(query)
      .select("name phone playingRole role imageUrl team")
      .populate("team", "name shortName")
      .sort({ name: 1 })
      .limit(50)
      .lean();

    res.status(200).json({ items: players, total: players.length });
  } catch (error) {
    res.status(500).json({ message: "Failed to search players", error: error.message });
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
      try {
        await playerService.assertPlayerNotDuplicate({
          name: req.body.newPlayer.name,
          team: team._id,
          phone: req.body.newPlayer.phone,
        });
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

      createdPlayer = await Player.create(
        squadPlayerFields(req.body.newPlayer, team, req.user?._id)
      );
      await Team.findByIdAndUpdate(team._id, { $addToSet: { players: createdPlayer._id } });
      assigned.push(createdPlayer._id);
    }

    // "Add several": validate every name against the database and against the
    // request itself *before* creating anything, so a duplicate halfway down the
    // pasted list cannot leave a half-built squad behind.
    const bulkInput = req.body.newPlayers || [];
    if (bulkInput.length) {
      const seen = new Set();
      for (const entry of bulkInput) {
        const key = playerService.normalizePlayerName(entry.name);
        if (seen.has(key)) {
          return res.status(409).json({
            message: `"${entry.name}" is listed more than once.`,
            code: "PLAYER_DUPLICATE",
            existing: { name: entry.name },
          });
        }
        seen.add(key);
        try {
          await playerService.assertPlayerNotDuplicate({
            name: entry.name,
            team: team._id,
            phone: entry.phone,
          });
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
      }

      for (const entry of bulkInput) {
        const player = await Player.create(squadPlayerFields(entry, team, req.user?._id));
        await Team.findByIdAndUpdate(team._id, { $addToSet: { players: player._id } });
        assigned.push(player._id);
      }
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

    const fresh = await Team.findById(team._id).populate("players", "name role playingRole battingPosition imageUrl jerseyNumber");
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

    const fresh = await Team.findById(team._id).populate("players", "name role playingRole battingPosition imageUrl jerseyNumber");
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
  listOrgTeamAvailablePlayers,
  removeOrgTeamPlayers,
  updateOrgTeamPlayerRole,
};
