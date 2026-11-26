import { parseOvers } from "../utils/overs.js";

// One definition of net run rate for the tournament points table and the team
// rankings, so the two boards can never disagree.
//
//   NRR = (runs scored / overs faced) - (runs conceded / overs bowled)
//
// summed over every counted match. The rules this module owns:
//   * An innings belongs to `innings.team`, never to its position in the array:
//     the side batting first is not always `match.teams[0]`. Old documents
//     without `innings.team` fall back to the position.
//   * Overs come from legal balls. When only an overs figure is stored (manual
//     scorecards), "12.4" means 12 overs and 4 balls, not 12.4 overs.
//   * A side bowled out is charged the full quota of overs, whatever the
//     scorecard says it faced.
//   * Super overs are not innings (they live in `match.superOvers`) and never
//     count.
// Which matches count (completed with a result, not a no-result) is decided by
// the caller.

export const ALL_OUT_WICKETS = 10;

const idOf = (value) => String(value?._id || value || "");
const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Legal balls an innings lasted, from `balls`, else from its overs figure. */
export function inningsBalls(innings) {
  const balls = toNumber(innings?.balls, 0);
  if (balls > 0) return Math.round(balls);
  const parsed = parseOvers(innings?.overs);
  return parsed.valid ? parsed.balls : 0;
}

/** Balls an innings counts for in NRR: the full quota when the side was bowled out. */
export function chargedBalls(innings, match) {
  const quotaOvers = toNumber(match?.totalOvers, 0);
  const allOutAt = match?.matchType === "Super Over" ? 2 : ALL_OUT_WICKETS;
  if (quotaOvers > 0 && toNumber(innings?.wickets, 0) >= allOutAt) return quotaOvers * 6;
  return inningsBalls(innings);
}

/** Team id an innings belongs to: `innings.team`, else the team at the same index. */
export function inningsTeamId(match, innings, index) {
  const own = idOf(innings?.team);
  if (own) return own;
  return idOf(match?.teams?.[index]);
}

/**
 * What one match adds to each side's NRR totals.
 * Returns Map(teamId -> { runsFor, ballsFor, runsAgainst, ballsAgainst }).
 */
export function matchRunTotals(match) {
  const teamIds = (match?.teams || []).map(idOf).filter(Boolean);
  const totals = new Map(
    teamIds.map((id) => [id, { runsFor: 0, ballsFor: 0, runsAgainst: 0, ballsAgainst: 0 }]),
  );
  (match?.innings || []).forEach((innings, index) => {
    const batting = inningsTeamId(match, innings, index);
    if (!totals.has(batting)) return;
    const runs = toNumber(innings?.runs, 0);
    const balls = chargedBalls(innings, match);
    const row = totals.get(batting);
    row.runsFor += runs;
    row.ballsFor += balls;
    for (const [id, other] of totals) {
      if (id === batting) continue;
      other.runsAgainst += runs;
      other.ballsAgainst += balls;
    }
  });
  return totals;
}

/** Add one match's totals into running totals keyed by team id. */
export function addRunTotals(into, matchTotals) {
  for (const [id, row] of matchTotals) {
    const current = into.get(id) || { runsFor: 0, ballsFor: 0, runsAgainst: 0, ballsAgainst: 0 };
    current.runsFor += row.runsFor;
    current.ballsFor += row.ballsFor;
    current.runsAgainst += row.runsAgainst;
    current.ballsAgainst += row.ballsAgainst;
    into.set(id, current);
  }
  return into;
}

/** NRR from totals, rounded to 3 places. A side that has not batted or bowled scores 0 for that half. */
export function netRunRate({ runsFor = 0, ballsFor = 0, runsAgainst = 0, ballsAgainst = 0 } = {}) {
  const scored = ballsFor > 0 ? runsFor / (ballsFor / 6) : 0;
  const conceded = ballsAgainst > 0 ? runsAgainst / (ballsAgainst / 6) : 0;
  return Number((scored - conceded).toFixed(3));
}

export default { ALL_OUT_WICKETS, inningsBalls, chargedBalls, inningsTeamId, matchRunTotals, addRunTotals, netRunRate };
