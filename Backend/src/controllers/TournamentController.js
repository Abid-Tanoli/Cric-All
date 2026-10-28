import Tournament from "../models/Tournament.js";
import Match from "../models/Match.js";
import Team from "../models/Team.js";
import Player from "../models/Player.js";
import { getIO } from "../socket/socket.js";
import mongoose from "mongoose";
import { recordAudit } from "../utils/audit.js";
import { buildMatchInnings } from "../utils/matchInnings.js";
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
  PUBLIC_MATCH_FILTER,
  isDraftMatchDoc,
} from "../utils/publicProjection.js";
import { deleteTournamentContent } from "../services/tournamentContent.js";

const CONTROLLER_MATCH_CATEGORY = "Other";

// Public reads hide manual drafts. A platform admin keeps seeing them so the
// Admin fixtures/scorecard screens can work against the same endpoint.
const canSeeDrafts = (req) => req?.principalType === "admin";

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
      .populate("awards.playerOfTournament awards.bestBatsman awards.bestBowler", "name playingRole role")
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
      // The hub renders `tournament.matches` directly. Populating only the
      // match documents leaves `teams` and `innings[].team` as ObjectIds, so
      // every fixture card falls through to "TBD" even though the match has
      // two real teams. Live and manual matches store the same refs, so both
      // shapes are populated here rather than special-casing source:"manual".
      .populate({
        path: "matches",
        populate: [
          { path: "teams", select: "name shortName logo" },
          { path: "innings.team", select: "name shortName logo" },
          { path: "result.winner", select: "name shortName logo" },
        ],
      })
      .populate("pointsTable.team", "name shortName logo")
      .populate("groups.teams", "name shortName logo")
      .populate("winner", "name shortName logo")
      .populate("runnerUp", "name shortName logo")
      .populate("awards.playerOfTournament awards.bestBatsman awards.bestBowler", "name playingRole role");

    if (!tournament) {
      return res.status(404).json({ message: "Tournament not found" });
    }

    // Draft manual scorecards are private until published. The fixtures payload
    // is what the public hub groups, so a draft must not appear as an upcoming
    // match. An admin keeps seeing them for editing.
    if (!canSeeDrafts(req)) {
      tournament.matches = (tournament.matches || []).filter((match) => !isDraftMatchDoc(match));
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
      rules: { twelfthManEnabled: req.body?.rules?.twelfthManEnabled === true },
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
    if (req.body.rules && "twelfthManEnabled" in req.body.rules) {
      tournament.rules = { twelfthManEnabled: req.body.rules.twelfthManEnabled === true };
    }

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

    // Remove hub artefacts (media rows + local photo files, articles) so
    // deleting a tournament never silently orphans uploads. Best-effort: a
    // failure here must not block deleting the tournament itself.
    let contentCleanup = { media: 0, files: 0, articles: 0 };
    try {
      contentCleanup = await deleteTournamentContent(tournament._id);
    } catch (cleanupError) {
      console.error("Error cleaning up tournament content:", cleanupError);
    }

    await Tournament.findByIdAndDelete(req.params.id);

    recordAudit({
      req,
      action: "tournament.deleted",
      targetType: "tournament",
      targetId: tournament._id,
      targetLabel: tournament.name,
      metadata: {
        matchCount: (tournament.matches || []).length,
        mediaRemoved: contentCleanup.media,
        filesRemoved: contentCleanup.files,
        articlesRemoved: contentCleanup.articles,
      },
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

    const filters = { tournament: req.params.id };
    if (!canSeeDrafts(req)) Object.assign(filters, PUBLIC_MATCH_FILTER);
    // Keep this fallback payload in the same shape as GET /tournaments/:id:
    // FixtureCard prefers innings[].team and uses teams[idx] only when the
    // innings ref is not populated, so both paths need their teams expanded.
    const matches = await Match.find(filters)
      .populate("teams", "name shortName logo")
      .populate("innings.team", "name shortName logo")
      .populate("result.winner", "name shortName logo")
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
  // Rounds may be numeric (1, 2, ...) or stage labels ("QF", "SF", "Final"), so
  // compare them as strings — Number("QF") would be NaN and never match itself.
  const roundKey = (value) => (value == null || value === "" ? "1" : String(value));
  const wantedPair = pairKey(team1, team2);
  const wantedRound = roundKey(round);
  const wantedGroup = group || "";

  for (const match of existingMatches) {
    if (!match || !Array.isArray(match.teams) || match.teams.length < 2) continue;
    const exRound = roundKey(match.round);
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

// P3: knockout progression. A knockout fixture above the first round may only
// be drawn from teams that won the previous round, so a bracket can never be
// silently mis-populated. Exported (pure) for unit tests.
export const STAGE_VALUES = ["", "group", "quarter_final", "semi_final", "final", "third_place"];
const PRIOR_STAGE_FOR = { semi_final: "quarter_final", final: "semi_final" };
const STAGE_NAME = {
  group: "group stage",
  quarter_final: "quarter-final",
  semi_final: "semi-final",
  final: "final",
  third_place: "third-place",
};

export const normalizeStage = (stage) =>
  typeof stage === "string" && STAGE_VALUES.includes(stage) ? stage : "";

/** Pure: ids of teams that won a completed match at `stage`. */
export const stageWinnerIds = (matches = [], stage) => {
  const ids = new Set();
  for (const m of matches || []) {
    if (!m || m.stage !== stage || m.status !== "completed") continue;
    const winner = m.result?.winner;
    const id = winner?._id || winner;
    if (id) ids.add(String(id));
  }
  return ids;
};

/**
 * Pure progression check for a knockout fixture. Returns a reason object or
 * null. Only semi-finals and the final are guarded — a third-place play-off is
 * for the semi-final losers, so the winner rule does not apply.
 */
export const findStageProgressionError = ({ stage, team1, team2, existingMatches = [] } = {}) => {
  const wanted = normalizeStage(stage);
  const priorStage = PRIOR_STAGE_FOR[wanted];
  if (!priorStage) return null;

  const winners = stageWinnerIds(existingMatches, priorStage);
  const stageName = STAGE_NAME[wanted];
  const priorName = STAGE_NAME[priorStage];

  if (winners.size === 0) {
    const hasPrior = (existingMatches || []).some((m) => m && m.stage === priorStage);
    return {
      reason: hasPrior ? "no_prior_winner" : "no_prior_stage",
      message: hasPrior
        ? `No ${priorName} has a winner yet — a ${stageName} can only be drawn once its teams have won the ${priorName}.`
        : `This tournament has no ${priorName} fixtures yet — create the ${priorName}s first.`,
    };
  }

  const missing = [team1, team2].filter((t) => !winners.has(String(t)));
  if (!missing.length) return null;

  return {
    reason: "team_not_advancing",
    message: `Both ${stageName} teams must be winners of the ${priorName}.`,
  };
};

/**
 * P4: validate a tournament's end-of-tournament honours before saving them.
 *
 * Pure so it can be unit tested without a database. `winner`/`runnerUp` must be
 * teams already in the tournament; the three player awards must belong to a
 * player on one of those teams, or to the tournament's own squads when it has
 * them. An empty string / null clears an award, which is how an admin undoes a
 * mis-click.
 *
 * @returns {{ ok: true, data: object } | { ok: false, errors: object }}
 */
export const validateTournamentAwards = ({
  body = {},
  teamIds = [],
  squadPlayerIds = [],
} = {}) => {
  const errors = {};
  const teamIdSet = new Set((teamIds || []).map((id) => String(id?._id || id)));
  const squadSet = new Set((squadPlayerIds || []).map((id) => String(id?._id || id)));

  const cleanId = (value) => {
    if (value === null || value === undefined) return "";
    const raw = typeof value === "object" ? value._id : value;
    if (raw === null || raw === undefined) return "";
    return String(raw).trim();
  };

  const readId = (key) => {
    if (!Object.prototype.hasOwnProperty.call(body, key)) return undefined; // untouched
    const cleaned = cleanId(body[key]);
    if (!cleaned) return null; // explicit clear
    if (!mongoose.isValidObjectId(cleaned)) {
      errors[key] = "That is not a valid id.";
      return null;
    }
    return cleaned;
  };

  const winner = readId("winner");
  const runnerUp = readId("runnerUp");
  const playerOfTournament = readId("playerOfTournament");
  const bestBatsman = readId("bestBatsman");
  const bestBowler = readId("bestBowler");

  if (winner) {
    if (!teamIdSet.size) errors.winner = "This tournament has no teams to award yet.";
    else if (!teamIdSet.has(winner)) errors.winner = "The champion must be one of the tournament's teams.";
  }
  if (runnerUp) {
    if (!teamIdSet.size) errors.runnerUp = "This tournament has no teams to award yet.";
    else if (!teamIdSet.has(runnerUp)) errors.runnerUp = "The runner-up must be one of the tournament's teams.";
  }
  if (winner && runnerUp && winner === runnerUp) {
    errors.runnerUp = "The champion and runner-up cannot be the same team.";
  }

  for (const key of ["playerOfTournament", "bestBatsman", "bestBowler"]) {
    const value = { playerOfTournament, bestBatsman, bestBowler }[key];
    if (!value) continue;
    // Only enforce squad membership when the tournament actually has squads —
    // a knockout with pre-made squads is the normal case, but a bare tournament
    // without them must still be able to record its honours.
    if (squadSet.size && !squadSet.has(value)) {
      errors[key] = "The player must be in one of this tournament's squads.";
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  const data = {};
  // Only write keys the caller actually sent, so a partial update (e.g. just
  // the champion) never wipes the other awards.
  if (winner !== undefined) data.winner = winner;
  if (runnerUp !== undefined) data.runnerUp = runnerUp;
  if (playerOfTournament !== undefined) data.playerOfTournament = playerOfTournament;
  if (bestBatsman !== undefined) data.bestBatsman = bestBatsman;
  if (bestBowler !== undefined) data.bestBowler = bestBowler;

  return { ok: true, data };
};

export const setTournamentAwards = async (req, res) => {
  try {
    const tournament = await Tournament.findById(req.params.id);
    if (!tournament) {
      return res.status(404).json({ message: "Tournament not found" });
    }

    const squadPlayerIds = (tournament.tournamentSquads || []).flatMap((squad) =>
      (squad.players || []).map((player) => player?._id || player),
    );

    const validation = validateTournamentAwards({
      body: req.body || {},
      teamIds: tournament.teams || [],
      squadPlayerIds,
    });

    if (!validation.ok) {
      return res.status(400).json({
        message: "Please fix the awards before saving.",
        errors: validation.errors,
      });
    }

    const { data } = validation;
    if (data.winner !== undefined) tournament.winner = data.winner || null;
    if (data.runnerUp !== undefined) tournament.runnerUp = data.runnerUp || null;

    const awards = { ...(tournament.awards ? (tournament.awards.toObject ? tournament.awards.toObject() : tournament.awards) : {}) };
    for (const key of ["playerOfTournament", "bestBatsman", "bestBowler"]) {
      if (data[key] !== undefined) awards[key] = data[key] || null;
    }
    tournament.awards = awards;

    await tournament.save();
    await tournament.populate("teams", "name shortName logo");
    await tournament.populate("winner", "name shortName logo");
    await tournament.populate("runnerUp", "name shortName logo");
    await tournament.populate("awards.playerOfTournament awards.bestBatsman awards.bestBowler", "name playingRole role");

    recordAudit({
      req,
      action: "tournament.awards_set",
      targetType: "tournament",
      targetId: tournament._id,
      targetLabel: tournament.name,
      metadata: {
        winner: tournament.winner || null,
        runnerUp: tournament.runnerUp || null,
        playerOfTournament: tournament.awards?.playerOfTournament || null,
        bestBatsman: tournament.awards?.bestBatsman || null,
        bestBowler: tournament.awards?.bestBowler || null,
      },
    });

    try {
      const io = getIO();
      io.emit("tournament:updated", tournament);
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({ tournament, message: "Tournament awards saved" });
  } catch (error) {
    console.error("Error setting tournament awards:", error);
    res.status(400).json({
      message: "Failed to save tournament awards",
      error: error.message,
    });
  }
};

export const createTournamentMatch = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { team1, team2, venue, startTime, matchType, matchCategory, matchSubcategory, round, group, stage: rawStage, stageLabel } = req.body;
    const stage = normalizeStage(rawStage);
    // The round the match will actually be stored with — the conflict check and
    // the save must agree, or a second draw of the same pair slips past the
    // duplicate guard.
    const effectiveRound = round != null && round !== "" ? round : (stage || 1);

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
      .select("teams round group stage status startAt result.winner")
      .lean();

    const conflict = findManualFixtureConflict({
      existingMatches,
      team1,
      team2,
      round: effectiveRound,
      group: group || "",
      startAt: startTime,
    });
    if (conflict) {
      return res.status(409).json({ message: conflict.message, reason: conflict.reason });
    }

    // Knockout progression: a semi-final may only be drawn from quarter-final
    // winners and the final from semi-final winners.
    const progressionError = findStageProgressionError({ stage, team1, team2, existingMatches });
    if (progressionError) {
      return res.status(400).json({ message: progressionError.message, reason: progressionError.reason });
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
      round: effectiveRound,
      group: group || "",
      stage,
      stageLabel: (stageLabel || "").trim(),
      tournament: tournamentId,
      teams: [team1, team2],
      innings: buildMatchInnings([team1, team2]),
      // A knockout fixture with no date yet is a legitimate "TBD" placeholder —
      // keep startAt null rather than inventing "now" so the schedule is honest.
      startAt: startTime ? new Date(startTime) : (stage ? null : new Date()),
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
      metadata: { tournamentId, matchNumber, round: match.round, group: match.group, stage: match.stage, stageLabel: match.stageLabel },
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
        stage: planned.stage || "",
        stageLabel: planned.stageLabel || "",
        tournament: id,
        teams: [planned.team1, planned.team2],
        innings: buildMatchInnings([planned.team1, planned.team2]),
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
