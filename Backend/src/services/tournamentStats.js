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
// (If the other branch persists a manual scorecard somewhere else, adapt it into
// this shape once and pass it in — do not reimplement the maths.)
//
// Only matches whose `status` is in `COMPLETED_STATUSES` contribute, so a live
// match never half-counts. `manually entered` and `ball-by-ball` matches follow
// exactly the same path.

/** Match statuses that contribute to career figures. */
export const COMPLETED_STATUSES = Object.freeze(["completed"]);

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
  const inningsScores = [];
  const bowlingSpells = [];

  // Counts a dismissal as a fielding credit for the non-batting team.
  const FIELDING_DISMISSALS = {
    caught: "catches",
    stumped: "stumpings",
    "run out": "runOuts",
  };

  const completed = matches.filter((match) =>
    COMPLETED_STATUSES.includes(String(match?.status || "").toLowerCase())
    || COMPLETED_STATUSES.includes(String(match?.status || "")),
  );

  const teamHintFor = (innings) => {
    const team = innings?.team;
    return {
      teamId: idOf(team),
      teamName: nameOf(team) || "",
      teamLogo: (team && typeof team === "object" && team.logo) || "",
    };
  };

  for (const match of completed) {
    const matchId = idOf(match);
    const matchTeams = (match.teams || [])
      .filter((team) => team && typeof team === "object")
      .map((team) => ({ id: idOf(team), name: nameOf(team), logo: team.logo || "" }));
    for (const innings of match.innings || []) {
      const hint = teamHintFor(innings);
      // The fielding side is the match team that is not batting this innings.
      const fieldingTeam =
        matchTeams.find((team) => team.id && team.id !== hint.teamId) ||
        matchTeams[0] || { id: null, name: "", logo: "" };

      for (const entry of innings.batting || []) {
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
            bestWickets: 0,
            bestRuns: 0,
            bestFigures: "-",
            fourWickets: 0,
            fiveWickets: 0,
          });
        }
        const row = bowling.get(key);
        const balls = Number(entry.balls) || Math.round((Number(entry.overs) || 0) * 6);
        const runs = Number(entry.runs) || 0;
        const wickets = Number(entry.wickets) || 0;
        row.innings += 1;
        row.balls += balls;
        row.maidens += Number(entry.maidens) || 0;
        row.runs += runs;
        row.wickets += wickets;
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
        });
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

  const matches = await Match.find({ tournament: tournamentId, status: { $in: COMPLETED_STATUSES } })
    .select(
      "status result manOfMatch teams innings.team innings.batting.player innings.batting.runs " +
        "innings.batting.balls innings.batting.fours innings.batting.sixes innings.batting.isOut " +
        "innings.batting.dismissalType innings.batting.fielder innings.bowling.player innings.bowling.balls " +
        "innings.bowling.overs innings.bowling.maidens innings.bowling.runs innings.bowling.wickets",
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
      innings: (match.innings || []).filter((innings) => {
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
    boundaryMeter: {
      ...stats.boundaryMeter,
      mostSixes: strip(stats.boundaryMeter?.mostSixes),
      mostFours: strip(stats.boundaryMeter?.mostFours),
    },
    hasFielding: topFielders.length > 0,
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

export default { computeTournamentStats, gatherTournamentStats, computeFormAndNext, COMPLETED_STATUSES };
