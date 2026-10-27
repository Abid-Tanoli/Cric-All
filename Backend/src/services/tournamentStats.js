import Match from "../models/Match.js";
import { hiddenTeamIds, isHiddenTeamDoc, isReservedTestName } from "../utils/publicProjection.js";

// ---------------------------------------------------------------------------
// Tournament statistics
// ---------------------------------------------------------------------------
//
// This is the ONE place tournament batting/bowling figures are aggregated. Both
// the public hub (`GET /api/tournaments/:id/stats`) and the sidebar read from
// here, so a change to the rules cannot make the two disagree.
//
// ---------------------------------------------------------------------------
// Input shape (documented so the manual-scorecard work from the oct12-knockout
// branch can be plugged in without touching this file)
// ---------------------------------------------------------------------------
//
// `computeTournamentStats` is pure and synchronous. It accepts:
//
//   {
//     minBallsFaced?: number,   // strike-rate qualification (default 30)
//     minOvers?: number,        // economy qualification (default 5)
//     limit?: number,           // max rows per list (default 50)
//     matches: MatchLike[],
//   }
//
// where a `MatchLike` is anything with this shape (a lean Match, a populated
// Match, or a hand-built fixture from the other branch):
//
//   {
//     _id?: string,
//     status: "completed" | "abandoned" | ...,
//     result?: { resultType?: "normal"|"tie"|"draw"|"no result"|"abandoned"|"super_over" },
//     manOfMatch?: PlayerRef,
//     teams?: TeamRef[],
//     innings: InningsLike[],
//   }
//
//   InningsLike = {
//     team?: TeamRef,
//     batting?: [{
//       player?: PlayerRef, runs?, balls?, fours?, sixes?,
//       isOut?: boolean, isRetiredHurt?: boolean,
//     }],
//     bowling?: [{
//       player?: PlayerRef, balls?, overs?, maidens?, runs?, wickets?,
//     }],
//   }
//
//   PlayerRef = string | { _id?, name?, imageUrl? }
//   TeamRef   = string | { _id?, name?, shortName?, logo?, isPublic? }
//
// A "manual scorecard" only has to populate `innings[].batting` / `innings[].bowling`
// with the same numbers a ball-by-ball innings produces; nothing else is assumed.
// If the other branch persists a manual scorecard somewhere else, adapt it into
// this shape once and pass it in — do not reimplement the maths. The single
// adapter seam for that is `inningsForMatch()` (below): it is the ONLY function
// that reads innings off a match, so teaching it the other branch's field is the
// whole integration.
//
// Only matches whose `status` is in `COMPLETED_STATUSES` contribute, so a live
// match never half-counts. `manually entered` and `ball-by-ball` matches follow
// exactly the same path.

/** Match statuses that contribute to career figures. */
export const COMPLETED_STATUSES = Object.freeze(["completed"]);

/**
 * A draft manual scorecard is saved with `status:"upcoming"` today, but the
 * statistics layer must never depend on that: a draft is excluded explicitly
 * whatever its status says, so a future publish-flag change cannot leak one.
 */
export function isDraftMatch(match) {
  return Boolean(match && (match.manualDraft === true || match.isDraft === true));
}

/**
 * Cricket overs ("3.4") to balls (22). A decimal `.6` is invalid notation, so
 * only `.1`–`.5` are read as balls; callers that already have `balls` never use
 * this fallback.
 */
export function oversToBalls(overs) {
  const value = Number(overs);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const whole = Math.floor(value);
  const partial = Math.round((value - whole) * 10);
  return whole * 6 + (partial > 0 && partial < 6 ? partial : 0);
}

/**
 * THE single plug-in point for a manual scorecard.
 *
 * Every figure below comes from an innings in the shape documented at the top
 * of this file. Today a match already stores those innings on `match.innings`,
 * whether they were produced ball-by-ball or entered by hand. When the
 * oct12-knockout branch starts persisting a manual scorecard in its own field,
 * adapt it HERE and nowhere else: return the innings as `InningsLike[]` and the
 * whole aggregation — batting, bowling, fielding, boundaries, qualification —
 * keeps working unchanged. Do not reimplement the maths elsewhere.
 *
 * Contract: pure, synchronous, never throws on a malformed match, and returns
 * `[]` when there is nothing to read.
 */
export function inningsForMatch(match) {
  const innings = match?.innings;
  return Array.isArray(innings) ? innings : [];
}

const idOf = (value) => {
  if (!value) return null;
  if (typeof value === "object") return value._id ? String(value._id) : null;
  return String(value);
};

const nameOf = (value) => {
  if (!value || typeof value !== "object") return "";
  return value.name || value.shortName || "";
};

function oversText(balls) {
  const safe = Number(balls) || 0;
  return `${Math.floor(safe / 6)}.${safe % 6}`;
}

function isOutEntry(entry) {
  if (entry.isOut === true) return true;
  if (entry.isOut === false) return false;
  // No explicit flag: a dismissalType string means dismissed.
  return Boolean(entry.dismissalType);
}

/**
 * A "did not bat" row (0 runs, 0 balls, not out, no dismissal) must not count as
 * an innings or drag an average down. An explicit `didNotBat`/`batted` flag wins;
 * otherwise the conventional all-zero row is treated as DNB. A batter dismissed
 * for 0, or retired, still counts even without facing a ball.
 */
export function isDidNotBat(entry) {
  if (!entry) return true;
  if (entry.didNotBat === true || entry.batted === false) return true;
  if (entry.didNotBat === false || entry.batted === true) return false;
  if (isOutEntry(entry)) return false;
  if (entry.isRetiredHurt === true || entry.isRetired === true) return false;
  return !(Number(entry.balls) > 0 || Number(entry.runs) > 0);
}

function extrasOf(innings) {
  const extras = innings?.extras || {};
  const explicitTotal = Number(extras.total);
  const total = Number.isFinite(explicitTotal)
    ? explicitTotal
    : ["wides", "noBalls", "byes", "legByes", "penalties"].reduce(
        (sum, key) => sum + (Number(extras[key]) || 0),
        0,
      );
  return {
    total,
    wides: Number(extras.wides) || 0,
    noBalls: Number(extras.noBalls) || 0,
  };
}

/**
 * One innings' totals, preferring the stored summary (`runs`/`wickets`/`balls`)
 * and falling back to the batting card + extras when a hand-built fixture only
 * carries rows. Shared by the team/tournament aggregates.
 */
export function inningsTotals(innings) {
  const batting = Array.isArray(innings?.batting) ? innings.batting : [];
  const bowling = Array.isArray(innings?.bowling) ? innings.bowling : [];
  const extras = extrasOf(innings);
  const batted = batting.filter((row) => !isDidNotBat(row));
  const battingRuns = batted.reduce((sum, row) => sum + (Number(row?.runs) || 0), 0);
  const fours = batted.reduce((sum, row) => sum + (Number(row?.fours) || 0), 0);
  const sixes = batted.reduce((sum, row) => sum + (Number(row?.sixes) || 0), 0);

  const declaredRuns = Number(innings?.runs);
  const runs = Number.isFinite(declaredRuns) ? declaredRuns : battingRuns + extras.total;
  const declaredWickets = Number(innings?.wickets);
  const wickets = Number.isFinite(declaredWickets)
    ? declaredWickets
    : batted.filter((row) => isOutEntry(row)).length;
  const declaredBalls = Number(innings?.balls);
  const balls =
    Number.isFinite(declaredBalls) && declaredBalls > 0
      ? declaredBalls
      : oversToBalls(innings?.overs);

  const extrasPresent = innings?.extras && typeof innings.extras === "object";
  return {
    runs,
    wickets,
    balls,
    fours,
    sixes,
    wides: extrasPresent ? extras.wides : bowling.reduce((sum, row) => sum + (Number(row?.wides) || 0), 0),
    noBalls: extrasPresent
      ? extras.noBalls
      : bowling.reduce((sum, row) => sum + (Number(row?.noBalls) || 0), 0),
  };
}

/**
 * Pure aggregation. See the module header for the exact input shape.
 * Never reads the database and never mutates its input.
 */
export function computeTournamentStats(input = {}) {
  const {
    matches = [],
    minBallsFaced = 30,
    minOvers = 5,
    limit = 50,
  } = input;

  const batting = new Map();
  const bowling = new Map();
  const fielding = new Map();
  const teams = new Map();
  const inningsScores = [];
  const bowlingSpells = [];
  let totalRuns = 0;
  let totalWickets = 0;
  let totalFours = 0;
  let totalSixes = 0;
  let totalBalls = 0;
  let totalWides = 0;
  let totalNoBalls = 0;

  // Counts a dismissal as a fielding credit for the non-batting team.
  const FIELDING_DISMISSALS = {
    caught: "catches",
    stumped: "stumpings",
    "run out": "runOuts",
  };

  const completed = matches.filter(
    (match) =>
      !isDraftMatch(match) &&
      (COMPLETED_STATUSES.includes(String(match?.status || "").toLowerCase()) ||
        COMPLETED_STATUSES.includes(String(match?.status || ""))),
  );

  const teamHintFor = (innings) => {
    const team = innings?.team;
    return {
      teamId: idOf(team),
      teamName: nameOf(team) || "",
      teamLogo: (team && typeof team === "object" && team.logo) || "",
    };
  };

  const ensureTeam = (teamId, name = "", logo = "") => {
    if (!teamId) return null;
    if (!teams.has(teamId)) {
      teams.set(teamId, {
        teamId,
        name: name || "",
        logo: logo || "",
        played: 0,
        won: 0,
        lost: 0,
        tied: 0,
        noResult: 0,
        runsFor: 0,
        runsAgainst: 0,
        wickets: 0,
        wicketsLost: 0,
        fours: 0,
        sixes: 0,
        ballsFaced: 0,
        ballsBowled: 0,
        highestTotal: null,
        lowestTotal: null,
      });
    }
    const row = teams.get(teamId);
    if (!row.name && name) row.name = name;
    if (!row.logo && logo) row.logo = logo;
    return row;
  };

  for (const match of completed) {
    const matchId = idOf(match);
    const matchTeams = (match.teams || [])
      .filter((team) => team && typeof team === "object")
      .map((team) => ({ id: idOf(team), name: nameOf(team), logo: team.logo || "" }));
    const winnerId = idOf(match.result?.winner);
    const resultType = String(match.result?.resultType || "").toLowerCase();
    const matchTeamIds = new Set();

    for (const innings of inningsForMatch(match)) {
      const hint = teamHintFor(innings);
      // The fielding side is the match team that is not batting this innings.
      const fieldingTeam =
        matchTeams.find((team) => team.id && team.id !== hint.teamId) ||
        matchTeams[0] || { id: null, name: "", logo: "" };
      const totals = inningsTotals(innings);

      if (hint.teamId) {
        matchTeamIds.add(hint.teamId);
        ensureTeam(hint.teamId, hint.teamName, hint.teamLogo);
      }
      if (fieldingTeam.id) {
        matchTeamIds.add(fieldingTeam.id);
        ensureTeam(fieldingTeam.id, fieldingTeam.name, fieldingTeam.logo);
      }

      totalRuns += totals.runs;
      totalWickets += totals.wickets;
      totalFours += totals.fours;
      totalSixes += totals.sixes;
      totalBalls += totals.balls;
      totalWides += totals.wides;
      totalNoBalls += totals.noBalls;

      const battingTeam = hint.teamId ? teams.get(hint.teamId) : null;
      if (battingTeam) {
        battingTeam.runsFor += totals.runs;
        battingTeam.wicketsLost += totals.wickets;
        battingTeam.fours += totals.fours;
        battingTeam.sixes += totals.sixes;
        battingTeam.ballsFaced += totals.balls;
        if (battingTeam.highestTotal == null || totals.runs > battingTeam.highestTotal) {
          battingTeam.highestTotal = totals.runs;
        }
        if (battingTeam.lowestTotal == null || totals.runs < battingTeam.lowestTotal) {
          battingTeam.lowestTotal = totals.runs;
        }
      }
      const bowlingTeam = fieldingTeam.id ? teams.get(fieldingTeam.id) : null;
      if (bowlingTeam && bowlingTeam.teamId !== hint.teamId) {
        bowlingTeam.runsAgainst += totals.runs;
        bowlingTeam.wickets += totals.wickets;
        bowlingTeam.ballsBowled += totals.balls;
      }

      for (const entry of innings.batting || []) {
        if (isDidNotBat(entry)) continue;
        const key = idOf(entry.player);
        if (!key) continue;
        const player = entry.player && typeof entry.player === "object" ? entry.player : {};

        if (!batting.has(key)) {
          batting.set(key, {
            playerId: key,
            name: player.name || "",
            imageUrl: player.imageUrl || "",
            teamId: hint.teamId,
            team: hint.teamName,
            teamLogo: hint.teamLogo,
            innings: 0,
            runs: 0,
            balls: 0,
            fours: 0,
            sixes: 0,
            notOuts: 0,
            highest: 0,
            highestNotOut: false,
            fifties: 0,
            hundreds: 0,
          });
        }
        const row = batting.get(key);
        const runs = Number(entry.runs) || 0;
        row.innings += 1;
        row.runs += runs;
        row.balls += Number(entry.balls) || 0;
        row.fours += Number(entry.fours) || 0;
        row.sixes += Number(entry.sixes) || 0;
        if (!isOutEntry(entry)) {
          row.notOuts += 1;
        }
        if (runs > row.highest || (runs === row.highest && !isOutEntry(entry) && !row.highestNotOut)) {
          row.highest = runs;
          row.highestNotOut = !isOutEntry(entry);
        }
        if (runs >= 100) row.hundreds += 1;
        else if (runs >= 50) row.fifties += 1;

        inningsScores.push({
          playerId: key,
          name: row.name,
          imageUrl: row.imageUrl,
          teamId: hint.teamId,
          team: hint.teamName,
          teamLogo: hint.teamLogo,
          matchId,
          runs,
          balls: Number(entry.balls) || 0,
          notOut: !isOutEntry(entry),
          fours: Number(entry.fours) || 0,
          sixes: Number(entry.sixes) || 0,
        });

        // Fielding credit: the fielder belongs to the team that is NOT batting.
        const credit = FIELDING_DISMISSALS[String(entry.dismissalType || "").toLowerCase()];
        const fielderId = idOf(entry.fielder);
        if (credit && fielderId) {
          if (!fielding.has(fielderId)) {
            const fielder = entry.fielder && typeof entry.fielder === "object" ? entry.fielder : {};
            fielding.set(fielderId, {
              playerId: fielderId,
              name: fielder.name || "",
              imageUrl: fielder.imageUrl || "",
              teamId: fieldingTeam.id,
              team: fieldingTeam.name,
              teamLogo: fieldingTeam.logo,
              matches: 0,
              catches: 0,
              stumpings: 0,
              runOuts: 0,
              _matchIds: new Set(),
            });
          }
          const fRow = fielding.get(fielderId);
          fRow[credit] += 1;
          fRow._matchIds.add(matchId || `anon-${fieldingTeam.id}`);
        }
      }

      for (const entry of innings.bowling || []) {
        const key = idOf(entry.player);
        if (!key) continue;
        const player = entry.player && typeof entry.player === "object" ? entry.player : {};
        if (!bowling.has(key)) {
          bowling.set(key, {
            playerId: key,
            name: player.name || "",
            imageUrl: player.imageUrl || "",
            teamId: hint.teamId,
            team: hint.teamName,
            teamLogo: hint.teamLogo,
            innings: 0,
            balls: 0,
            maidens: 0,
            runs: 0,
            wickets: 0,
            wides: 0,
            noBalls: 0,
            bestWickets: 0,
            bestRuns: 0,
            bestFigures: "-",
            fourWickets: 0,
            fiveWickets: 0,
          });
        }
        const row = bowling.get(key);
        const balls =
          Number.isFinite(Number(entry.balls)) && Number(entry.balls) > 0
            ? Number(entry.balls)
            : oversToBalls(entry.overs);
        const runs = Number(entry.runs) || 0;
        const wickets = Number(entry.wickets) || 0;
        const entryWides = Number(entry.wides) || 0;
        const entryNoBalls = Number(entry.noBalls) || 0;
        row.innings += 1;
        row.balls += balls;
        row.maidens += Number(entry.maidens) || 0;
        row.runs += runs;
        row.wickets += wickets;
        row.wides += entryWides;
        row.noBalls += entryNoBalls;
        if (wickets >= 5) row.fiveWickets += 1;
        else if (wickets >= 4) row.fourWickets += 1;
        const better =
          wickets > row.bestWickets ||
          (wickets === row.bestWickets && (row.bestFigures === "-" || runs < row.bestRuns));
        if (better) {
          row.bestWickets = wickets;
          row.bestRuns = runs;
          row.bestFigures = `${wickets}/${runs}`;
        }

        bowlingSpells.push({
          playerId: key,
          name: row.name,
          imageUrl: row.imageUrl,
          teamId: hint.teamId,
          team: hint.teamName,
          teamLogo: hint.teamLogo,
          matchId,
          wickets,
          runs,
          balls,
          figures: `${wickets}/${runs}`,
          maidens: Number(entry.maidens) || 0,
          wides: entryWides,
          noBalls: entryNoBalls,
        });
      }
    }

    // One "played" per team per completed match, then W/L/T/NR from the result.
    for (const teamId of matchTeamIds) {
      const row = ensureTeam(teamId);
      if (!row) continue;
      row.played += 1;
      if (resultType === "tie") row.tied += 1;
      else if (resultType === "no result" || resultType === "abandoned") row.noResult += 1;
      else if (winnerId) {
        if (winnerId === teamId) row.won += 1;
        else row.lost += 1;
      }
    }
  }

  const battingRows = [...batting.values()].map((row) => {
    const outs = row.innings - row.notOuts;
    return {
      ...row,
      average: outs > 0 ? Number((row.runs / outs).toFixed(2)) : null,
      strikeRate: row.balls > 0 ? Number(((row.runs / row.balls) * 100).toFixed(2)) : null,
      highestText: row.highestNotOut ? `${row.highest}*` : String(row.highest),
    };
  });

  const bowlingRows = [...bowling.values()].map((row) => {
    const oversValue = row.balls / 6;
    return {
      ...row,
      oversText: oversText(row.balls),
      average: row.wickets > 0 ? Number((row.runs / row.wickets).toFixed(2)) : null,
      economy: oversValue > 0 ? Number((row.runs / oversValue).toFixed(2)) : null,
      strikeRate: row.wickets > 0 ? Number(((row.balls / row.wickets) * 6).toFixed(1)) : null,
    };
  });

  const fieldingRows = [...fielding.values()].map((row) => {
    const { _matchIds, ...rest } = row;
    return {
      ...rest,
      matches: _matchIds instanceof Set ? _matchIds.size : row.matches || 0,
      total: row.catches + row.stumpings + row.runOuts,
    };
  });

  // One row per team that appears in a completed match. `runs`/`wickets` are the
  // Cricinfo-style "runs scored" and "wickets taken" columns; `runsFor`/
  // `runsAgainst` stay available for the detailed table.
  const teamStats = [...teams.values()]
    .map((row) => ({
      ...row,
      runs: row.runsFor,
      wickets: row.wickets,
      runsConceded: row.runsAgainst,
      highestTotalText: row.highestTotal == null ? null : String(row.highestTotal),
      lowestTotalText: row.lowestTotal == null ? null : String(row.lowestTotal),
      oversFacedText: oversText(row.ballsFaced),
      oversBowledText: oversText(row.ballsBowled),
      runRate: row.ballsFaced > 0 ? Number(((row.runsFor / row.ballsFaced) * 6).toFixed(2)) : null,
      economy: row.ballsBowled > 0 ? Number(((row.runsAgainst / row.ballsBowled) * 6).toFixed(2)) : null,
    }))
    .sort(
      (a, b) =>
        b.won - a.won ||
        (b.runRate ?? 0) - (a.runRate ?? 0) ||
        a.name.localeCompare(b.name),
    );

  const cap = Math.max(1, Number(limit) || 50);
  const take = (list) => list.slice(0, cap);

  const topRunScorers = take([...battingRows].sort((a, b) => b.runs - a.runs || b.highest - a.highest));
  const topWicketTakers = take(
    [...bowlingRows].sort((a, b) => b.wickets - a.wickets || a.runs - b.runs),
  );
  const highestScores = take(
    [...inningsScores]
      .filter((row) => row.balls > 0 || row.runs > 0)
      .sort((a, b) => b.runs - a.runs || a.balls - b.balls),
  );
  const bestBowling = take(
    [...bowlingSpells]
      .filter((row) => row.wickets > 0)
      .sort((a, b) => b.wickets - a.wickets || a.runs - b.runs),
  );
  const bestStrikeRates = take(
    battingRows
      .filter((row) => row.balls >= minBallsFaced && row.strikeRate != null)
      .sort((a, b) => b.strikeRate - a.strikeRate),
  );
  const bestEconomy = take(
    bowlingRows
      .filter((row) => row.balls >= Number(minOvers) * 6 && row.economy != null)
      .sort((a, b) => a.economy - b.economy),
  );
  const mostSixes = take(
    battingRows.filter((row) => row.sixes > 0).sort((a, b) => b.sixes - a.sixes),
  );
  const mostFours = take(
    battingRows.filter((row) => row.fours > 0).sort((a, b) => b.fours - a.fours),
  );
  // Fielding leaderboard, ranked by total dismissals (catches + stumpings + run outs).
  const topFielders = take(
    [...fieldingRows].sort((a, b) => b.total - a.total || b.catches - a.catches),
  );

  // A compact "boundary meter" for the Home / Stats hero: tournament-wide 4s and
  // 6s plus the top five hitters in each column. Shape is intentionally the one
  // the existing <BoundaryMeter /> component already consumes.
  const boundaryMeter = {
    sixes: battingRows.reduce((sum, row) => sum + (row.sixes || 0), 0),
    fours: battingRows.reduce((sum, row) => sum + (row.fours || 0), 0),
    mostSixes: mostSixes
      .slice(0, 5)
      .map((row) => ({ playerId: row.playerId, name: row.name, team: row.team, count: row.sixes })),
    mostFours: mostFours
      .slice(0, 5)
      .map((row) => ({ playerId: row.playerId, name: row.name, team: row.team, count: row.fours })),
  };

  const hasBatting = battingRows.length > 0;
  const hasBowling = bowlingRows.length > 0;
  const hasFielding = fieldingRows.length > 0;

  const tournamentTotals = {
    matches: completed.length,
    runs: totalRuns,
    wickets: totalWickets,
    fours: totalFours,
    sixes: totalSixes,
    balls: totalBalls,
    runRate: totalBalls > 0 ? Number(((totalRuns / totalBalls) * 6).toFixed(2)) : null,
    wides: totalWides,
    noBalls: totalNoBalls,
    hasWides: totalWides > 0,
    hasNoBalls: totalNoBalls > 0,
  };

  return {
    matchCount: completed.length,
    thresholds: { minBallsFaced: Number(minBallsFaced) || 0, minOvers: Number(minOvers) || 0 },
    topRunScorers,
    topWicketTakers,
    topFielders,
    highestScores,
    bestBowling,
    bestStrikeRates,
    bestEconomy,
    mostSixes,
    mostFours,
    teamStats,
    tournamentTotals,
    totalRuns,
    totalWickets,
    totalFours,
    totalSixes,
    totalWides,
    totalNoBalls,
    boundaryMeter,
    hasBatting,
    hasBowling,
    hasFielding,
    hasSixes: mostSixes.length > 0,
    hasFours: mostFours.length > 0,
    empty: !hasBatting && !hasBowling,
  };
}

/** Fields a populated player needs for a public stat row (no contact, no DOB). */
export const STATS_PLAYER_SELECT = "name imageUrl";
export const STATS_TEAM_SELECT = "name shortName logo isPublic";

/**
 * Loads the completed matches of one tournament with exactly the fields the
 * aggregator needs, then computes the stats. Public-safe: hidden/private and
 * reserved-test teams are dropped before aggregation.
 *
 * @param {object} tournament  Tournament document or lean object (must have _id).
 * @param {object} [opts]      { minBallsFaced, minOvers, limit }
 */
export async function gatherTournamentStats(tournament, opts = {}) {
  const tournamentId = tournament?._id || tournament;
  const hidden = new Set(await hiddenTeamIds());

  const matches = await Match.find({
    tournament: tournamentId,
    status: { $in: COMPLETED_STATUSES },
    manualDraft: { $ne: true },
  })
    .select(
      "status result manOfMatch teams innings.team innings.runs innings.wickets innings.balls innings.overs " +
        "innings.extras innings.batting.player innings.batting.runs " +
        "innings.batting.balls innings.batting.fours innings.batting.sixes innings.batting.isOut " +
        "innings.batting.dismissalType innings.batting.fielder innings.bowling.player innings.bowling.balls " +
        "innings.bowling.overs innings.bowling.maidens innings.bowling.runs innings.bowling.wickets " +
        "innings.bowling.wides innings.bowling.noBalls",
    )
    .populate("teams", STATS_TEAM_SELECT)
    .populate("innings.team", STATS_TEAM_SELECT)
    .populate("innings.batting.player", STATS_PLAYER_SELECT)
    .populate("innings.batting.fielder", STATS_PLAYER_SELECT)
    .populate("innings.bowling.player", STATS_PLAYER_SELECT)
    .lean();

  // Drop whole innings played by a hidden team so a private team's players
  // never appear in a public leaderboard. A completed match whose every innings
  // belonged to a hidden/test team then contributes zero data rows, so it is
  // also excluded from the public matchCount.
  const cleanMatches = matches
    .map((match) => ({
      ...match,
      innings: inningsForMatch(match).filter((innings) => {
        const team = innings.team;
        if (!team || typeof team !== "object") return true;
        if (hidden.has(String(team._id))) return false;
        return !isHiddenTeamDoc(team);
      }),
    }))
    .filter((match) => (match.innings || []).length > 0);

  const stats = computeTournamentStats({ matches: cleanMatches, ...opts });

  // Belt-and-braces: strip any row that still carries a reserved test name
  // (e.g. a player typed into a fixture team).
  const strip = (list) => (list || []).filter((row) => !isReservedTestName(row.name) && !isReservedTestName(row.team));
  const topFielders = strip(stats.topFielders);
  return {
    ...stats,
    topRunScorers: strip(stats.topRunScorers),
    topWicketTakers: strip(stats.topWicketTakers),
    topFielders,
    highestScores: strip(stats.highestScores),
    bestBowling: strip(stats.bestBowling),
    bestStrikeRates: strip(stats.bestStrikeRates),
    bestEconomy: strip(stats.bestEconomy),
    mostSixes: strip(stats.mostSixes),
    mostFours: strip(stats.mostFours),
    teamStats: strip(stats.teamStats),
    boundaryMeter: {
      ...stats.boundaryMeter,
      mostSixes: strip(stats.boundaryMeter?.mostSixes),
      mostFours: strip(stats.boundaryMeter?.mostFours),
    },
    hasFielding: topFielders.length > 0,
    hasTeamStats: (stats.teamStats || []).length > 0,
  };
}

/**
 * Form (last 5 results, newest first) and the next fixture per team, keyed by
 * team id, computed from a tournament's matches. Used by the Table tab.
 * Reuses the existing standings engine for points; this only derives the two
 * presentation-only columns ("Form", "Next").
 */
export function computeFormAndNext(matches = [], teamIds = []) {
  const form = new Map(teamIds.map((id) => [String(id), []]));
  const next = new Map();
  const now = Date.now();

  const ordered = [...matches].sort(
    (a, b) => new Date(a.startAt || 0).getTime() - new Date(b.startAt || 0).getTime(),
  );

  for (const match of ordered) {
    if (isDraftMatch(match)) continue;
    const ids = (match.teams || []).map((t) => String(t?._id || t));
    for (const id of ids) if (!form.has(id)) form.set(id, []);

    if (String(match.status) === "completed") {
      const resultType = match.result?.resultType;
      const winner = String(match.result?.winner?._id || match.result?.winner || "");
      for (const id of ids) {
        let ch = "NR";
        if (resultType === "tie") ch = "T";
        else if (winner && winner === id) ch = "W";
        else if (resultType === "normal") ch = "L";
        else if (resultType === "no result" || resultType === "abandoned") ch = "NR";
        else ch = "NR";
        form.get(id).push(ch);
      }
    } else if (
      String(match.status) !== "abandoned" &&
      !next.has(ids[0]) &&
      new Date(match.startAt || 0).getTime() >= now - 12 * 60 * 60 * 1000
    ) {
      for (const id of ids) {
        if (!next.has(id)) next.set(id, match);
      }
    }
  }

  return { form, next };
}

// ---------------------------------------------------------------------------
// Small in-process cache for the public stats payload
// ---------------------------------------------------------------------------
//
// A live server serves the same tournament to many phones, so the aggregate is
// reused for a few seconds. Every write path (manual publish, live completion,
// fixture recompute, content settings) calls `invalidateTournamentStatsCache`,
// so a published scorecard is never hidden behind a stale entry.

const statsCache = new Map();
export const STATS_TTL_MS = 15_000;

const statsCacheKey = (tournamentId, settings = {}) =>
  `${String(tournamentId)}:${Number(settings.minBallsFaced) || 0}:${Number(settings.minOvers) || 0}`;

export function readTournamentStatsCache(tournamentId, settings, now = Date.now()) {
  const entry = statsCache.get(statsCacheKey(tournamentId, settings));
  if (!entry || entry.expires <= now) return null;
  return entry.value;
}

export function writeTournamentStatsCache(tournamentId, settings, value, now = Date.now()) {
  statsCache.set(statsCacheKey(tournamentId, settings), { value, expires: now + STATS_TTL_MS });
  return value;
}

/** Drop one tournament's cached aggregates (all thresholds), or all of them. */
export function invalidateTournamentStatsCache(tournamentId) {
  if (!tournamentId) {
    statsCache.clear();
    return;
  }
  const prefix = `${String(tournamentId)}:`;
  for (const key of [...statsCache.keys()]) {
    if (key.startsWith(prefix)) statsCache.delete(key);
  }
}

export default {
  computeTournamentStats,
  gatherTournamentStats,
  computeFormAndNext,
  inningsForMatch,
  inningsTotals,
  oversToBalls,
  isDraftMatch,
  isDidNotBat,
  COMPLETED_STATUSES,
  readTournamentStatsCache,
  writeTournamentStatsCache,
  invalidateTournamentStatsCache,
};
