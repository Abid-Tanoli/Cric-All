import Match from "../models/Match.js";
import {
  COMPLETED_STATUSES,
  FIELDING_DISMISSALS,
  computeTournamentStats,
  inningsForMatch,
  isDidNotBat,
  isOutEntry,
  latestPlayerTeamAppearances,
  matchTeamRefs,
  oversToBalls,
  playerTeamInMatch,
  teamRefOf,
} from "./tournamentStats.js";

// ---------------------------------------------------------------------------
// Player career stats / match log
// ---------------------------------------------------------------------------
//
// Public profiles used to read `Player.stats`, which is only written by seed
// scripts and never by the scoring engine. A published manual scorecard (or a
// completed ball-by-ball match) therefore changed the tournament tables while
// the player page stayed at zero.
//
// Everything here is derived on read from the same `computeTournamentStats`
// layer the public tournament pages use. Nothing is persisted back onto
// `Player.stats`, so:
//   * a stored/seed value can never be added to a live value (no double count);
//   * publishing or completing a match is visible immediately (no backfill);
//   * manual and ball-by-ball innings follow exactly the same rules.
//
// Only completed, non-draft matches contribute. A match counts for a player only
// when they actually took part: a non-DNB batting row, a bowling row, or an
// explicit fielding credit. A squad member who did not bat/bowl/field is not a
// "match played" here and is not invented as one.

const idOf = (value) => {
  if (!value) return null;
  if (typeof value === "object") return value._id ? String(value._id) : null;
  return String(value);
};

const asNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const MATCH_SELECT = [
  "title",
  "venue",
  "matchType",
  "tournament",
  "teams",
  "innings.team",
  "innings.runs",
  "innings.wickets",
  "innings.balls",
  "innings.overs",
  "innings.extras",
  "innings.batting.player",
  "innings.batting.runs",
  "innings.batting.balls",
  "innings.batting.fours",
  "innings.batting.sixes",
  "innings.batting.isOut",
  "innings.batting.isRetiredHurt",
  "innings.batting.isRetired",
  "innings.batting.didNotBat",
  "innings.batting.batted",
  "innings.batting.dismissalType",
  "innings.batting.dismissalText",
  "innings.batting.fielder",
  "innings.batting.position",
  "innings.bowling.player",
  "innings.bowling.balls",
  "innings.bowling.overs",
  "innings.bowling.maidens",
  "innings.bowling.runs",
  "innings.bowling.wickets",
  "innings.bowling.wides",
  "innings.bowling.noBalls",
  "innings.bowling.dotBalls",
  "playingXI.team",
  "playingXI.players",
  "squad15.team",
  "squad15.players",
  "status",
  "manualDraft",
  "isDraft",
  "result",
  "startAt",
  "createdAt",
  "updatedAt",
].join(" ");

/**
 * Completed, published matches in which this player has a real contribution.
 * `limit` is applied after the summaries are built so career totals are never
 * truncated by the match-log page size.
 */
export async function loadPlayerMatchDocs(playerId) {
  return Match.find({
    status: { $in: COMPLETED_STATUSES },
    manualDraft: { $ne: true },
    isDraft: { $ne: true },
    $or: [
      { "innings.batting.player": playerId },
      { "innings.bowling.player": playerId },
      { "innings.batting.fielder": playerId },
    ],
  })
    .select(MATCH_SELECT)
    .populate("teams", "name shortName logo")
    .populate("tournament", "name shortName slug")
    .populate("innings.team", "name shortName logo")
    .populate("innings.batting.player", "name imageUrl")
    .populate("innings.batting.fielder", "name imageUrl")
    .populate("innings.bowling.player", "name imageUrl")
    .populate("playingXI.team", "name shortName logo")
    .populate("playingXI.players", "name imageUrl")
    .populate("squad15.team", "name shortName logo")
    .populate("squad15.players", "name imageUrl")
    .populate("result.winner", "name shortName logo")
    .sort({ startAt: -1, updatedAt: -1 })
    .lean();
}

function findBatting(match, playerId) {
  for (const innings of inningsForMatch(match)) {
    const row = (innings.batting || []).find(
      (entry) => idOf(entry.player) === playerId && !isDidNotBat(entry),
    );
    if (row) return { innings, row };
  }
  return null;
}

function findBowling(match, playerId) {
  for (const innings of inningsForMatch(match)) {
    const row = (innings.bowling || []).find((entry) => idOf(entry.player) === playerId);
    if (row) return { innings, row };
  }
  return null;
}

/**
 * Fielding credit is only taken from an explicit `fielder` on a recognised
 * dismissal. A manual scorecard that did not record a catcher therefore stays
 * at zero instead of guessing one.
 */
function fieldingSummary(match, playerId) {
  const totals = { catches: 0, stumpings: 0, runOuts: 0, total: 0 };
  for (const innings of inningsForMatch(match)) {
    for (const row of innings.batting || []) {
      const credit = FIELDING_DISMISSALS[String(row?.dismissalType || "").toLowerCase()];
      if (!credit) continue;
      if (idOf(row?.fielder) !== playerId) continue;
      totals[credit] += 1;
      totals.total += 1;
    }
  }
  return totals.total > 0 ? totals : null;
}

function battingSummary(found) {
  if (!found) return null;
  const { row } = found;
  const runs = asNumber(row.runs);
  const balls = asNumber(row.balls);
  const isOut = isOutEntry(row);
  return {
    runs,
    balls,
    ballsFaced: balls,
    fours: asNumber(row.fours),
    sixes: asNumber(row.sixes),
    isOut,
    notOut: !isOut,
    dismissalType: row.dismissalType || "",
    dismissalText: row.dismissalText || "",
    position: row.position || null,
    strikeRate: balls > 0 ? Number(((runs / balls) * 100).toFixed(2)) : null,
  };
}

function bowlingSummary(found) {
  if (!found) return null;
  const { row } = found;
  const balls =
    Number.isFinite(Number(row.balls)) && Number(row.balls) > 0
      ? Number(row.balls)
      : oversToBalls(row.overs);
  const runs = asNumber(row.runs);
  const wickets = asNumber(row.wickets);
  return {
    balls,
    oversText: `${Math.floor(balls / 6)}.${balls % 6}`,
    maidens: asNumber(row.maidens),
    runs,
    wickets,
    wides: asNumber(row.wides),
    noBalls: asNumber(row.noBalls),
    dotBalls: asNumber(row.dotBalls),
    economy: balls > 0 ? Number(((runs / balls) * 6).toFixed(2)) : null,
    strikeRate: wickets > 0 ? Number(((balls / wickets) * 6).toFixed(1)) : null,
  };
}

function resultForPlayer(match, teamId) {
  const resultType = String(match.result?.resultType || "").toLowerCase();
  if (resultType === "tie") return "T";
  if (resultType === "no result" || resultType === "abandoned") return "NR";
  if (resultType === "draw") return "D";
  const winnerId = idOf(match.result?.winner);
  if (winnerId && teamId) return winnerId === String(teamId) ? "W" : "L";
  return null;
}

/**
 * Build one row per completed match for the profile Match Log / FormTracker.
 * The player's side is resolved by the same innings-aware helper as the
 * tournament tables, so fixture order cannot swap the team.
 */
export function buildPlayerMatchSummaries(matches, playerId) {
  const wanted = String(playerId);
  const summaries = [];

  for (const match of matches) {
    const batting = battingSummary(findBatting(match, wanted));
    const bowling = bowlingSummary(findBowling(match, wanted));
    const fielding = fieldingSummary(match, wanted);
    if (!batting && !bowling && !fielding) continue;

    const team = playerTeamInMatch(match, wanted) || teamRefOf(match.teams?.[0]);
    const opposition =
      matchTeamRefs(match).find((entry) => entry.id && entry.id !== team.id) || null;

    summaries.push({
      _id: match._id,
      title: match.title,
      venue: match.venue,
      matchType: match.matchType,
      startAt: match.startAt || match.updatedAt || match.createdAt || null,
      status: match.status,
      tournament: match.tournament || null,
      teams: match.teams || [],
      result: match.result || null,
      teamId: team.id,
      team: team.name || "",
      teamLogo: team.logo || "",
      playerTeam: team.id
        ? { _id: team.id, name: team.name || "", logo: team.logo || "" }
        : null,
      opposition: opposition
        ? {
            _id: opposition.id,
            name: opposition.name || "",
            logo: opposition.logo || "",
          }
        : null,
      batting,
      bowling,
      fielding,
      resultForPlayer: resultForPlayer(match, team.id),
    });
  }

  return summaries;
}

/**
 * Career figures for one player, in the shape `Player.stats` exposes to the
 * public profile. This is a derived value and deliberately replaces any stored
 * seed value at response time.
 */
export function buildPlayerCareerStats(matches, playerId) {
  const wanted = String(playerId);
  const aggregate = computeTournamentStats({
    matches,
    minBallsFaced: 0,
    minOvers: 0,
    limit: 100000,
  });

  const battingRow = (aggregate.topRunScorers || []).find(
    (row) => String(row.playerId) === wanted,
  );
  const bowlingRow = (aggregate.topWicketTakers || []).find(
    (row) => String(row.playerId) === wanted,
  );
  const fieldingRow = (aggregate.topFielders || []).find(
    (row) => String(row.playerId) === wanted,
  );

  // Use the same latest-appearance rule as the tournament leaderboards. The
  // row is a plain object; internal stamps are non-enumerable.
  const appearance = latestPlayerTeamAppearances(matches).get(wanted) || {
    teamsPlayedFor: [],
  };
  const seenMatches = new Set();
  for (const match of matches) {
    const hasContribution =
      Boolean(findBatting(match, wanted)) ||
      Boolean(findBowling(match, wanted)) ||
      Boolean(fieldingSummary(match, wanted));
    if (hasContribution) seenMatches.add(String(match._id));
  }

  const teamsPlayedFor = Array.isArray(appearance.teamsPlayedFor)
    ? [...appearance.teamsPlayedFor].sort((a, b) => {
        const aTime = a.lastPlayedAt ? new Date(a.lastPlayedAt).getTime() : 0;
        const bTime = b.lastPlayedAt ? new Date(b.lastPlayedAt).getTime() : 0;
        return bTime - aTime || String(a.teamId).localeCompare(String(b.teamId));
      })
    : [];

  return {
    // Stored seed stats are intentionally not merged: every number below comes
    // from the match documents once, so a live match cannot be counted twice.
    matches: seenMatches.size,
    innings: battingRow?.innings || 0,
    notOuts: battingRow?.notOuts || 0,
    runs: battingRow?.runs || 0,
    balls: bowlingRow?.balls || 0,
    fours: battingRow?.fours || 0,
    sixes: battingRow?.sixes || 0,
    highScore: battingRow?.highest || 0,
    highScoreText: battingRow?.highestText || "0",
    average: battingRow?.average ?? 0,
    strikeRate: battingRow?.strikeRate ?? 0,
    fifties: battingRow?.fifties || 0,
    hundreds: battingRow?.hundreds || 0,
    wickets: bowlingRow?.wickets || 0,
    bowlingInnings: bowlingRow?.innings || 0,
    runsConceded: bowlingRow?.runs || 0,
    bowlingAverage: bowlingRow?.average ?? 0,
    economy: bowlingRow?.economy ?? 0,
    bestBowling: bowlingRow?.bestFigures || "0/0",
    fourWickets: bowlingRow?.fourWickets || 0,
    fiveWickets: bowlingRow?.fiveWickets || 0,
    dotBalls: bowlingRow?.dotBalls || 0,
    catches: fieldingRow?.catches || 0,
    stumpings: fieldingRow?.stumpings || 0,
    runOuts: fieldingRow?.runOuts || 0,
    teamId: appearance.teamId || null,
    team: appearance.team || "",
    teamLogo: appearance.teamLogo || "",
    teamsPlayedFor,
    statsSource: "matches",
  };
}

/** Load, summarise and aggregate a player's completed published matches once. */
export async function getPlayerStatsBundle(playerId, { limit = 20 } = {}) {
  const matches = await loadPlayerMatchDocs(playerId);
  const summaries = buildPlayerMatchSummaries(matches, playerId);
  const stats = buildPlayerCareerStats(matches, playerId);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  return {
    stats,
    matches: summaries.slice(0, safeLimit),
    totalMatches: summaries.length,
  };
}
