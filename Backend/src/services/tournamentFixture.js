import Match from "../models/Match.js";
import Team from "../models/Team.js";
import Tournament from "../models/Tournament.js";
import { buildMatchInnings } from "../utils/matchInnings.js";

// ---------------------------------------------------------------------------
// Shared tournament-fixture creation
// ---------------------------------------------------------------------------
//
// The Admin "add fixture" endpoint and the operator scripts both create normal
// scheduled tournament matches through this module. Keeping one path means a
// script-created fixture has exactly the same shape as one an admin draws in
// the UI: `status: "upcoming"`, the normal `source: "live"` default, no
// `manualDraft`, two empty innings ready for the toss, and a link in
// `Tournament.matches`.
//
// Nothing here publishes, completes, scores or recomputes points. Audit and
// socket emission stay in the controller because they need the HTTP request.

export const CONTROLLER_MATCH_CATEGORY = "Other";

export const OVER_BY_FORMAT = {
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
export const normalizeMatchType = (format) =>
  MATCH_TYPE_ALIASES[format] || format || "T20";

/**
 * Pure conflict check for a manual fixture. Returns a reason object or null.
 *
 * - duplicate: same unordered pair + same round + same group already exists
 * - double_booked: one of the teams already has a non-completed, non-abandoned
 *   fixture at the same startAt
 */
export const findManualFixtureConflict = ({
  existingMatches = [],
  team1,
  team2,
  round = 1,
  group = "",
  startAt,
} = {}) => {
  const pairKey = (a, b) => [String(a), String(b)].sort().join("|");
  // Rounds may be numeric (1, 2, ...) or stage labels ("QF", "SF", "Final"),
  // so compare them as strings - Number("QF") would be NaN and never match.
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
// silently mis-populated.
export const STAGE_VALUES = ["", "group", "quarter_final", "semi_final", "final", "third_place"];
const PRIOR_STAGE_FOR = { semi_final: "quarter_final", final: "semi_final" };
const STAGE_NAME = {
  group: "group stage",
  quarter_final: "quarter-final",
  semi_final: "semi-final",
  final: "final",
  third_place: "third-place play-off",
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
 * null. Only semi-finals and the final are guarded - a third-place play-off is
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
        ? `No ${priorName} has a winner yet - a ${stageName} can only be drawn once its teams have won the ${priorName}.`
        : `This tournament has no ${priorName} fixtures yet - create the ${priorName}s first.`,
    };
  }

  const missing = [team1, team2].filter((t) => !winners.has(String(t)));
  if (!missing.length) return null;

  return {
    reason: "team_not_advancing",
    message: `Both ${stageName} teams must be winners of the ${priorName}.`,
  };
};

export class TournamentFixtureError extends Error {
  constructor(status, message, reason = "") {
    super(message);
    this.name = "TournamentFixtureError";
    this.status = status;
    this.reason = reason;
  }
}

/**
 * Create one normal scheduled tournament fixture through the same rules as the
 * Admin manual-fixture endpoint.
 *
 * `dryRun` runs every validation (tournament, teams, duplicate/date conflict,
 * knockout progression) and returns the document that would be written without
 * saving it.
 */
export async function createTournamentFixture({
  tournamentId,
  team1,
  team2,
  venue,
  startTime,
  matchType,
  matchCategory,
  matchSubcategory,
  round,
  group,
  stage: rawStage,
  stageLabel,
  title,
  dryRun = false,
} = {}) {
  const stage = normalizeStage(rawStage);
  // The round the match will actually be stored with - the conflict check and
  // the save must agree, or a second draw of the same pair slips past the
  // duplicate guard.
  const effectiveRound = round != null && round !== "" ? round : (stage || 1);

  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) {
    throw new TournamentFixtureError(404, "Tournament not found");
  }

  if (!team1 || !team2) {
    throw new TournamentFixtureError(400, "Both teams are required");
  }
  if (String(team1) === String(team2)) {
    throw new TournamentFixtureError(400, "Team A and Team B must be different");
  }

  const inTournament = (id) =>
    (tournament.teams || []).some((t) => String(t?._id || t) === String(id));
  if (!inTournament(team1) || !inTournament(team2)) {
    throw new TournamentFixtureError(400, "Both teams must be part of this tournament");
  }

  const teamsExist = await Team.find({ _id: { $in: [team1, team2] } }).select("_id").lean();
  if (teamsExist.length !== 2) {
    throw new TournamentFixtureError(400, "One or both teams do not exist");
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
    throw new TournamentFixtureError(409, conflict.message, conflict.reason);
  }

  // Knockout progression: a semi-final may only be drawn from quarter-final
  // winners and the final from semi-final winners.
  const progressionError = findStageProgressionError({ stage, team1, team2, existingMatches });
  if (progressionError) {
    throw new TournamentFixtureError(400, progressionError.message, progressionError.reason);
  }

  const lastMatch = await Match.findOne({ tournament: tournamentId })
    .sort({ matchNumber: -1 })
    .select("matchNumber")
    .lean();
  const matchNumber = (lastMatch?.matchNumber || 0) + 1;

  const resolvedMatchType = normalizeMatchType(matchType || tournament.format || "T20");

  const match = new Match({
    title: String(title || "").trim() || `${tournament.name} - Match ${matchNumber}`,
    matchNumber,
    venue: venue || tournament.venue,
    matchType: resolvedMatchType,
    totalOvers: OVER_BY_FORMAT[resolvedMatchType] || 20,
    // "league" is not a valid matchCategory enum value - it used to make every
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
    // A knockout fixture with no date yet is a legitimate "TBD" placeholder -
    // keep startAt null rather than inventing "now" so the schedule is honest.
    startAt: startTime ? new Date(startTime) : (stage ? null : new Date()),
    status: "upcoming",
  });

  if (dryRun) {
    return { match, tournament, matchNumber, dryRun: true };
  }

  await match.save();
  await match.populate("teams", "name shortName logo");

  if (!(tournament.matches || []).some((id) => String(id) === String(match._id))) {
    tournament.matches.push(match._id);
    await tournament.save();
  }

  return { match, tournament, matchNumber, dryRun: false };
}

export default { createTournamentFixture };
