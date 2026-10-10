import Tournament from "../models/Tournament.js";
import Match from "../models/Match.js";
import Team from "../models/Team.js";
import { getIO } from "../socket/socket.js";
import mongoose from "mongoose";
import { recordAudit } from "../utils/audit.js";
import {
  planTournamentFixtures,
  fixturePairKey,
  recomputeTournamentPoints,
} from "../services/tournamentService.js";
import {
  hiddenTeamIds,
  reservedNamesMongoClause,
  stripHiddenTeamRefs,
  PLAYER_ROSTER_SELECT,
} from "../utils/publicProjection.js";

const CONTROLLER_MATCH_CATEGORY = "Other";

const MIN_TEAMS_BY_TYPE = {
  knockout: 2,
  league: 3,
  "group-stage": 4,
  mixed: 4,
};

const uniqueTeamIds = (teams = []) => {
  const seen = new Set();
  const out = [];
  for (const team of Array.isArray(teams) ? teams : []) {
    const id = String(team?._id || team || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
};

/**
 * Backend-enforced team-count rule: knockout >= 2, league >= 3,
 * group-stage/mixed >= 4. Returns an error string, or null when valid.
 * Exported for unit tests.
 */
export const validateTournamentTeamCount = (type, teams, originalCount) => {
  const count = uniqueTeamIds(teams).length;
  const known = MIN_TEAMS_BY_TYPE[type];
  const min = known != null ? known : 2;
  if (originalCount != null && Array.isArray(teams) && originalCount !== teams.length) {
    return "Duplicate teams are not allowed in a tournament";
  }
  if (count < min) {
    return `A ${type || "tournament"} needs at least ${min} teams (got ${count})`;
  }
  return null;
};

const parsePointsConfig = (body = {}) => {
  const base = { win: 2, tie: 1, noResult: 1 };
  const incoming = body.pointsConfig || {};
  const pick = (key) => {
    const value = Number(incoming[key]);
    return Number.isFinite(value) && value >= 0 ? value : base[key];
  };
  return { win: pick("win"), tie: pick("tie"), noResult: pick("noResult") };
};

const pointsRow = (teamId) => ({
  team: teamId,
  matchesPlayed: 0,
  won: 0,
  lost: 0,
  tied: 0,
  noResult: 0,
  points: 0,
  netRunRate: 0,
  for: 0,
  against: 0,
  wicketsFor: 0,
  wicketsAgainst: 0,
  seriesForm: [],
});

const isTransientDbError = (error) => (
  error?.name === "MongooseError" ||
  error?.name === "MongoServerSelectionError" ||
  error?.name === "MongoNetworkTimeoutError" ||
  /timed out|buffering|not connected/i.test(error?.message || "")
);

export const getTournaments = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const page = Math.max(Number(req.query.page) || 1, 1);

    // Fix B: the public tournament board omits fixtures and tournaments that
    // only involve hidden teams.
    const excluded = await hiddenTeamIds();
    const query = { $and: [reservedNamesMongoClause("name")] };
    if (excluded.length) query.$and.push({ teams: { $nin: excluded } });

    const tournaments = await Tournament.find(query)
      .populate("teams", "name shortName logo")
      .populate("winner", "name shortName logo")
      .populate("runnerUp", "name shortName logo")
      .sort({ startDate: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .maxTimeMS(5000)
      .lean();

    res.status(200).json(tournaments);
  } catch (error) {
    console.error("Error fetching tournaments:", error);
    if (isTransientDbError(error)) {
      return res.status(200).json([]);
    }
    res.status(500).json({
      message: "Failed to fetch tournaments",
      error: error.message
    });
  }
};

export const getTournament = async (req, res) => {
  try {
    const { id } = req.params;
    const query = mongoose.isValidObjectId(id) ? { _id: id } : { slug: id };
    const tournament = await Tournament.findOne(query)
      .populate("teams", "name shortName logo")
      .populate("matches")
      .populate("pointsTable.team", "name shortName logo")
      .populate("groups.teams", "name shortName logo")
      .populate("winner", "name shortName logo")
      .populate("runnerUp", "name shortName logo");

    if (!tournament) {
      return res.status(404).json({ message: "Tournament not found" });
    }

    // Fix B: detail-by-id stays reachable (ids are unguessable) but a guest's
    // tournament page does not carry a hidden team's standings, matches or
    // honour. The roster used to be populated with whole Player documents here.
    stripHiddenTeamRefs(tournament, new Set(await hiddenTeamIds()));

    res.status(200).json(tournament);
  } catch (error) {
    console.error("Error fetching tournament:", error);
    res.status(500).json({
      message: "Failed to fetch tournament",
      error: error.message
    });
  }
};

export const createTournament = async (req, res) => {
  try {
    const { name, shortName, type, startDate, endDate, teams, venue, format, status } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: "Tournament name is required" });
    }
    if (!startDate || !endDate) {
      return res.status(400).json({ message: "startDate and endDate are required" });
    }
    if (new Date(endDate) < new Date(startDate)) {
      return res.status(400).json({ message: "endDate cannot be before startDate" });
    }

    const tournamentType = type || "league";
    if (!Object.prototype.hasOwnProperty.call(MIN_TEAMS_BY_TYPE, tournamentType) && tournamentType !== "knockout") {
      // Unknown types still default to the safe minimum of 2 via the validator.
    }

    const teamIds = uniqueTeamIds(teams);
    const countError = validateTournamentTeamCount(
      tournamentType,
      teams,
      Array.isArray(teams) ? teams.length : undefined,
    );
    if (countError) {
      return res.status(400).json({ message: countError });
    }

    // Every team must actually exist.
    const found = await Team.find({ _id: { $in: teamIds } }).select("_id").lean();
    if (found.length !== teamIds.length) {
      return res.status(400).json({ message: "One or more teams do not exist" });
    }

    const tournament = new Tournament({
      name: String(name).trim(),
      shortName: shortName || String(name).substring(0, 10).toUpperCase(),
      type: tournamentType,
      startDate,
      endDate,
      teams: teamIds,
      venue: venue || "",
      format: format || "T20",
      pointsConfig: parsePointsConfig(req.body),
      pointsTable: teamIds.map(pointsRow),
      status: status || "upcoming",
      createdByAdmin: req.user?._id || null,
    });

    await tournament.save();
    await tournament.populate("teams", "name shortName logo");

    recordAudit({
      req,
      action: "tournament.created",
      targetType: "tournament",
      targetId: tournament._id,
      targetLabel: tournament.name,
      metadata: { type: tournament.type, teamCount: teamIds.length, pointsConfig: tournament.pointsConfig },
    });

    try {
      const io = getIO();
      io.emit("tournament:created", tournament);
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(201).json({
      tournament,
      message: "Tournament created successfully"
    });
  } catch (error) {
    console.error("Error creating tournament:", error);
    res.status(400).json({
      message: "Failed to create tournament",
      error: error.message
    });
  }
};

export const updateTournament = async (req, res) => {
  try {
    const tournament = await Tournament.findById(req.params.id);

    if (!tournament) {
      return res.status(404).json({ message: "Tournament not found" });
    }

    const { name, shortName, type, startDate, endDate, teams, venue, format, status } = req.body;

    // Team edits must still satisfy the count / existence rules.
    if (teams !== undefined) {
      const teamIds = uniqueTeamIds(teams);
      const countError = validateTournamentTeamCount(
        type || tournament.type,
        teams,
        Array.isArray(teams) ? teams.length : undefined,
      );
      if (countError) return res.status(400).json({ message: countError });

      const found = await Team.find({ _id: { $in: teamIds } }).select("_id").lean();
      if (found.length !== teamIds.length) {
        return res.status(400).json({ message: "One or more teams do not exist" });
      }

      // Keep the points table in step with the team list (idempotent rebuild on
      // next completion; here we just seed/keep rows).
      const existingRows = new Map(
        (tournament.pointsTable || []).map((row) => [String(row.team), row]),
      );
      tournament.pointsTable = teamIds.map((id) => existingRows.get(String(id)) || pointsRow(id));
      tournament.teams = teamIds;
    }

    if (name !== undefined) tournament.name = String(name).trim();
    if (shortName !== undefined) tournament.shortName = shortName;
    if (type !== undefined) tournament.type = type;
    if (startDate !== undefined) tournament.startDate = startDate;
    if (endDate !== undefined) tournament.endDate = endDate;
    if (venue !== undefined) tournament.venue = venue;
    if (format !== undefined) tournament.format = format;
    if (status !== undefined) tournament.status = status;
    if (req.body.pointsConfig !== undefined) tournament.pointsConfig = parsePointsConfig(req.body);

    await tournament.save();
    await tournament.populate("teams", "name shortName logo");

    recordAudit({
      req,
      action: "tournament.updated",
      targetType: "tournament",
      targetId: tournament._id,
      targetLabel: tournament.name,
      metadata: { fields: Object.keys(req.body || {}) },
    });

    try {
      const io = getIO();
      io.emit("tournament:updated", tournament);
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({
      tournament,
      message: "Tournament updated successfully"
    });
  } catch (error) {
    console.error("Error updating tournament:", error);
    res.status(400).json({
      message: "Failed to update tournament",
      error: error.message
    });
  }
};

export const deleteTournament = async (req, res) => {
  try {
    const tournament = await Tournament.findById(req.params.id);

    if (!tournament) {
      return res.status(404).json({ message: "Tournament not found" });
    }

    // Delete all associated matches
    if (tournament.matches && tournament.matches.length > 0) {
      await Match.deleteMany({ _id: { $in: tournament.matches } });
    }

    await Tournament.findByIdAndDelete(req.params.id);

    recordAudit({
      req,
      action: "tournament.deleted",
      targetType: "tournament",
      targetId: tournament._id,
      targetLabel: tournament.name,
      metadata: { matchCount: (tournament.matches || []).length },
    });

    try {
      const io = getIO();
      io.emit("tournament:deleted", { id: req.params.id });
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({ message: "Tournament deleted successfully" });
  } catch (error) {
    console.error("Error deleting tournament:", error);
    res.status(500).json({
      message: "Failed to delete tournament",
      error: error.message
    });
  }
};

export const getTournamentPointsTable = async (req, res) => {
  try {
    const tournament = await Tournament.findById(req.params.id)
      .populate("pointsTable.team", "name shortName logo");

    if (!tournament) {
      return res.status(404).json({ message: "Tournament not found" });
    }

    // Sort by points, then by net run rate
    const sortedTable = [...tournament.pointsTable].sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return b.netRunRate - a.netRunRate;
    });

    res.status(200).json(sortedTable);
  } catch (error) {
    console.error("Error fetching points table:", error);
    res.status(500).json({
      message: "Failed to fetch points table",
      error: error.message
    });
  }
};

export const updatePointsTable = async (req, res) => {
  try {
    const { tournamentId } = req.body;

    if (!tournamentId || !mongoose.isValidObjectId(tournamentId)) {
      return res.status(400).json({ message: "A valid tournamentId is required" });
    }

    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ message: "Tournament not found" });
    }

    // Recompute from scratch so running this twice can never double-count a
    // completed match. The old handler incremented in place.
    const recomputed = await recomputeTournamentPoints(tournamentId);

    recordAudit({
      req,
      action: "tournament.points_recomputed",
      targetType: "tournament",
      targetId: tournamentId,
      targetLabel: tournament.name,
    });

    try {
      const io = getIO();
      io.emit("tournament:pointsTableUpdated", recomputed);
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({
      tournament: recomputed,
      pointsTable: recomputed?.pointsTable || [],
      message: "Points table recomputed successfully"
    });
  } catch (error) {
    console.error("Error updating points table:", error);
    res.status(400).json({
      message: "Failed to update points table",
      error: error.message
    });
  }
};

export const getTournamentFixtures = async (req, res) => {
  try {
    const tournament = await Tournament.findById(req.params.id);

    if (!tournament) {
      return res.status(404).json({ message: "Tournament not found" });
    }

    const matches = await Match.find({ tournament: req.params.id })
      .populate("teams", "name shortName logo")
      .populate("result.winner", "name")
      .sort({ startAt: 1 });

    res.status(200).json(matches);
  } catch (error) {
    console.error("Error fetching fixtures:", error);
    res.status(500).json({
      message: "Failed to fetch fixtures",
      error: error.message
    });
  }
};

// Tournament/Series Squad Management (11-20 players per team)
export const setTournamentSquad = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { teamId, players, captain, viceCaptain, wicketKeepers } = req.body;

    if (!players || players.length < 11 || players.length > 20) {
      return res.status(400).json({
        message: "Tournament squad size must be between 11 and 20 players"
      });
    }

    if (!captain) {
      return res.status(400).json({ message: "Captain is required" });
    }

    if (!viceCaptain) {
      return res.status(400).json({ message: "Vice-captain is required" });
    }

    if (!wicketKeepers || wicketKeepers.length === 0) {
      return res.status(400).json({ message: "At least one wicket-keeper is required" });
    }

    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ message: "Tournament not found" });
    }

    const isTeamInTournament = tournament.teams.some(
      t => t.toString() === teamId.toString()
    );

    if (!isTeamInTournament) {
      return res.status(400).json({
        message: "Team is not part of this tournament"
      });
    }

    const existingSquad = tournament.tournamentSquads.find(
      s => s.team.toString() === teamId.toString()
    );

    if (existingSquad) {
      existingSquad.players = players;
      existingSquad.captain = captain;
      existingSquad.viceCaptain = viceCaptain;
      existingSquad.wicketKeepers = wicketKeepers;
    } else {
      tournament.tournamentSquads.push({
        team: teamId,
        players,
        captain,
        viceCaptain,
        wicketKeepers
      });
    }

    await tournament.save();
    await tournament.populate("tournamentSquads.team", "name shortName logo");
    await tournament.populate("tournamentSquads.players", "name role playingRole");

    try {
      const io = getIO();
      io.emit("tournament:squadUpdated", { tournamentId, teamId });
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({
      message: "Tournament squad set successfully",
      tournament: tournament
    });
  } catch (error) {
    console.error("Error setting tournament squad:", error);
    res.status(500).json({
      message: "Failed to set tournament squad",
      error: error.message
    });
  }
};

export const getTournamentSquad = async (req, res) => {
  try {
    const { tournamentId, teamId } = req.params;

    const tournament = await Tournament.findById(tournamentId)
      .populate("tournamentSquads.team", "name shortName logo")
      .populate("tournamentSquads.players", "name role playingRole imageUrl battingStyle bowlingStyle");

    if (!tournament) {
      return res.status(404).json({ message: "Tournament not found" });
    }

    if (teamId) {
      const squad = tournament.tournamentSquads.find(
        s => s.team?._id?.toString() === teamId || s.team?.toString() === teamId
      );
      if (!squad) {
        return res.status(404).json({ message: "Squad not found for this team" });
      }
      return res.status(200).json(squad);
    }

    res.status(200).json(tournament.tournamentSquads);
  } catch (error) {
    console.error("Error fetching tournament squad:", error);
    res.status(500).json({
      message: "Failed to fetch tournament squad",
      error: error.message
    });
  }
};

export const deleteTournamentSquad = async (req, res) => {
  try {
    const { tournamentId, teamId } = req.params;

    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ message: "Tournament not found" });
    }

    tournament.tournamentSquads = tournament.tournamentSquads.filter(
      s => s.team.toString() !== teamId
    );

    await tournament.save();

    try {
      const io = getIO();
      io.emit("tournament:squadDeleted", { tournamentId, teamId });
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({ message: "Tournament squad deleted successfully" });
  } catch (error) {
    console.error("Error deleting tournament squad:", error);
    res.status(500).json({
      message: "Failed to delete tournament squad",
      error: error.message
    });
  }
};

const OVER_BY_FORMAT = {
  "6 Overs": 6,
  "8 Overs": 8,
  T6: 6,
  T8: 8,
  T10: 10,
  T20: 20,
  ODI: 50,
  Test: 90,
};

// Tournament.format allows "T6"/"T8" but Match.matchType does not, so map any
// tournament-only alias onto a real matchType enum value before saving.
const MATCH_TYPE_ALIASES = { T6: "6 Overs", T8: "8 Overs" };
const normalizeMatchType = (format) => MATCH_TYPE_ALIASES[format] || format || "T20";

/**
 * Pure conflict check for a manual fixture. Returns a reason object or null.
 * Exported for unit tests.
 * - duplicate: same unordered pair + same round + same group already exists
 * - double_booked: one of the teams already has a non-completed, non-abandoned
 *   fixture at the same startAt
 */
export const findManualFixtureConflict = ({ existingMatches = [], team1, team2, round = 1, group = "", startAt } = {}) => {
  const pairKey = (a, b) => [String(a), String(b)].sort().join("|");
  const wantedPair = pairKey(team1, team2);
  const wantedRound = Number(round || 1);
  const wantedGroup = group || "";

  for (const match of existingMatches) {
    if (!match || !Array.isArray(match.teams) || match.teams.length < 2) continue;
    const exRound = match.round == null ? 1 : Number(match.round);
    const exGroup = match.group || "";
    if (
      pairKey(match.teams[0]?._id || match.teams[0], match.teams[1]?._id || match.teams[1]) === wantedPair &&
      exRound === wantedRound &&
      exGroup === wantedGroup
    ) {
      return { reason: "duplicate", message: "A fixture for this pair and round already exists" };
    }
  }

  if (startAt) {
    const wanted = new Date(startAt).getTime();
    if (!Number.isNaN(wanted)) {
      for (const match of existingMatches) {
        if (!match || !Array.isArray(match.teams)) continue;
        if (match.status === "completed" || match.status === "abandoned") continue;
        if (!match.startAt) continue;
        if (new Date(match.startAt).getTime() !== wanted) continue;
        const clash = match.teams.some((t) =>
          [String(team1), String(team2)].includes(String(t?._id || t)),
        );
        if (clash) {
          return {
            reason: "double_booked",
            message: "One of the teams already has a fixture at this date-time",
          };
        }
      }
    }
  }

  return null;
};

export const createTournamentMatch = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { team1, team2, venue, startTime, matchType, matchCategory, matchSubcategory, round, group } = req.body;

    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ message: "Tournament not found" });
    }

    if (!team1 || !team2) {
      return res.status(400).json({ message: "Both teams are required" });
    }
    if (String(team1) === String(team2)) {
      return res.status(400).json({ message: "Team A and Team B must be different" });
    }

    const inTournament = (id) =>
      (tournament.teams || []).some((t) => String(t?._id || t) === String(id));
    if (!inTournament(team1) || !inTournament(team2)) {
      return res.status(400).json({ message: "Both teams must be part of this tournament" });
    }

    const teamsExist = await Team.find({ _id: { $in: [team1, team2] } }).select("_id").lean();
    if (teamsExist.length !== 2) {
      return res.status(400).json({ message: "One or both teams do not exist" });
    }

    const existingMatches = await Match.find({ tournament: tournamentId })
      .select("teams round group startAt status")
      .lean();

    const conflict = findManualFixtureConflict({
      existingMatches,
      team1,
      team2,
      round: round != null ? Number(round) : 1,
      group: group || "",
      startAt: startTime,
    });
    if (conflict) {
      return res.status(409).json({ message: conflict.message, reason: conflict.reason });
    }

    const lastMatch = await Match.findOne({ tournament: tournamentId })
      .sort({ matchNumber: -1 })
      .select("matchNumber")
      .lean();
    const matchNumber = (lastMatch?.matchNumber || 0) + 1;

    const resolvedMatchType = normalizeMatchType(matchType || tournament.format || "T20");

    const match = new Match({
      title: `${tournament.name} - Match ${matchNumber}`,
      matchNumber,
      venue: venue || tournament.venue,
      matchType: resolvedMatchType,
      totalOvers: OVER_BY_FORMAT[resolvedMatchType] || 20,
      // "league" is not a valid matchCategory enum value — it used to make every
      // real manual create fail validation. Keep the enum-valid default and put
      // the tournament label in matchSubcategory.
      matchCategory: matchCategory || CONTROLLER_MATCH_CATEGORY,
      matchSubcategory: matchSubcategory || tournament.name,
      round: round != null ? Number(round) : 1,
      group: group || "",
      tournament: tournamentId,
      teams: [team1, team2],
      startAt: startTime || new Date(),
      status: "upcoming"
    });

    await match.save();
    await match.populate("teams", "name shortName logo");

    // Add match to tournament
    tournament.matches.push(match._id);
    await tournament.save();

    recordAudit({
      req,
      action: "tournament.fixture_created",
      targetType: "match",
      targetId: match._id,
      targetLabel: match.title,
      metadata: { tournamentId, matchNumber, round: match.round, group: match.group },
    });

    try {
      const io = getIO();
      io.emit("tournament:matchCreated", { tournamentId, match });
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(201).json({
      match,
      message: "Match created in tournament successfully"
    });
  } catch (error) {
    console.error("Error creating tournament match:", error);
    res.status(500).json({
      message: "Failed to create tournament match",
      error: error.message
    });
  }
};

// Manual A/B group assignment for group-stage tournaments.
export const setTournamentGroups = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { groups } = req.body;

    if (!Array.isArray(groups) || groups.length === 0) {
      return res.status(400).json({ message: "A non-empty groups array is required" });
    }

    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) return res.status(404).json({ message: "Tournament not found" });

    const tournamentTeamIds = new Set((tournament.teams || []).map((t) => String(t?._id || t)));
    const seen = new Set();
    const normalized = [];

    for (const group of groups) {
      const name = String(group?.name || "").trim();
      if (!name) return res.status(400).json({ message: "Every group needs a name" });
      const teamIds = uniqueTeamIds(group.teams);
      if (teamIds.length < 2) {
        return res.status(400).json({ message: `Group "${name}" needs at least 2 teams` });
      }
      for (const id of teamIds) {
        if (!tournamentTeamIds.has(id)) {
          return res.status(400).json({ message: "A group lists a team that is not in this tournament" });
        }
        if (seen.has(id)) {
          return res.status(400).json({ message: "A team cannot be in more than one group" });
        }
        seen.add(id);
      }
      normalized.push({ name, teams: teamIds });
    }

    tournament.groups = normalized;
    await tournament.save();
    await tournament.populate("groups.teams", "name shortName logo");

    recordAudit({
      req,
      action: "tournament.groups_set",
      targetType: "tournament",
      targetId: tournament._id,
      targetLabel: tournament.name,
      metadata: { groups: normalized.map((g) => ({ name: g.name, size: g.teams.length })) },
    });

    res.status(200).json({ groups: tournament.groups, message: "Groups updated successfully" });
  } catch (error) {
    console.error("Error setting tournament groups:", error);
    res.status(500).json({ message: "Failed to set tournament groups", error: error.message });
  }
};

// Preview fixtures (no DB writes) for league / group+knockout / knockout.
export const previewTournamentFixtures = async (req, res) => {
  try {
    const { id } = req.params;
    const tournament = await Tournament.findById(id).populate("teams", "name shortName logo");
    if (!tournament) return res.status(404).json({ message: "Tournament not found" });

    const plan = planTournamentFixtures(tournament, {
      format: req.body.format,
      startAt: req.body.startAt,
      gapHours: req.body.gapHours,
      venue: req.body.venue,
    });

    res.status(200).json({ preview: plan, message: "Fixture preview generated" });
  } catch (error) {
    console.error("Error previewing fixtures:", error);
    res.status(500).json({ message: "Failed to preview fixtures", error: error.message });
  }
};

// Apply a preview: persists concrete fixtures, skips duplicates, never mutates
// existing (including live/completed) matches.
export const applyTournamentFixtures = async (req, res) => {
  try {
    const { id } = req.params;
    const tournament = await Tournament.findById(id);
    if (!tournament) return res.status(404).json({ message: "Tournament not found" });

    const plan = planTournamentFixtures(tournament, {
      format: req.body.format,
      startAt: req.body.startAt,
      gapHours: req.body.gapHours,
      venue: req.body.venue,
    });

    // Any existing fixture with the same unordered pair blocks regeneration for
    // that pair, whatever its status — so live/completed matches are never
    // duplicated and never touched.
    const existingMatches = await Match.find({ tournament: id }).select("teams").lean();
    const existingPairs = new Set(
      existingMatches
        .filter((m) => Array.isArray(m.teams) && m.teams.length >= 2)
        .map((m) => fixturePairKey(m.teams[0], m.teams[1])),
    );

    const resolvedMatchType = normalizeMatchType(tournament.format || "T20");
    const created = [];
    const skipped = [];

    for (const planned of plan.matches || []) {
      if (planned.isTbd || planned.bye) continue;
      const key = fixturePairKey(planned.team1, planned.team2);
      if (existingPairs.has(key)) {
        skipped.push({
          matchNumber: planned.matchNumber,
          team1: planned.team1,
          team2: planned.team2,
          round: planned.round,
          group: planned.group,
          reason: "exists",
        });
        continue;
      }

      const match = new Match({
        title: `${tournament.name} - Match ${planned.matchNumber}`,
        matchNumber: planned.matchNumber,
        venue: planned.venue || tournament.venue,
        matchType: resolvedMatchType,
        totalOvers: OVER_BY_FORMAT[resolvedMatchType] || 20,
        matchCategory: CONTROLLER_MATCH_CATEGORY,
        matchSubcategory: tournament.name,
        round: planned.round,
        group: planned.group || "",
        tournament: id,
        teams: [planned.team1, planned.team2],
        startAt: planned.startAt,
        status: "upcoming",
      });
      await match.save();
      existingPairs.add(key);
      created.push(match._id);
    }

    if (created.length) {
      tournament.matches.push(...created);
      await tournament.save();
    }

    recordAudit({
      req,
      action: "tournament.fixtures_applied",
      targetType: "tournament",
      targetId: tournament._id,
      targetLabel: tournament.name,
      metadata: { created: created.length, skipped: skipped.length, format: plan.format },
    });

    try {
      const io = getIO();
      io.emit("tournament:fixturesApplied", { tournamentId: id, created: created.length });
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({
      applied: created.length,
      created,
      skipped,
      pendingTbd: (plan.matches || []).filter((m) => m.isTbd).length,
      warnings: plan.warnings || [],
      message: `${created.length} fixture(s) created, ${skipped.length} skipped`,
    });
  } catch (error) {
    console.error("Error applying fixtures:", error);
    res.status(500).json({ message: "Failed to apply fixtures", error: error.message });
  }
};
