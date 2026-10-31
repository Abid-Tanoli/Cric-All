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

export function isOutEntry(entry) {
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

/**
 * Normalise one team reference to the tiny shape the stats layer needs.
 *
 * Match and innings team refs can be a bare ObjectId, a lean object or a
 * populated Mongoose document. `nameOf` already prefers `name` over
 * `shortName`, so the same helper works for every caller.
 */
export function teamRefOf(team) {
  if (!team) return { id: null, name: "", logo: "" };
  if (typeof team === "object") {
    return {
      id: idOf(team),
      name: nameOf(team),
      logo: team.logo || "",
    };
  }
  return { id: idOf(team), name: "", logo: "" };
}

/**
 * Every team attached to a fixture, normalised and de-duplicated.
 *
 * `match.teams` is the fixture order and must never be used to decide who was
 * batting: manual scorecards are stored in that order even when the other side
 * batted first. The innings' own `team` is the only batting-side hint; the
 * fielding side is the match team that is not batting.
 */
export function matchTeamRefs(match) {
  const refs = [];
  const seen = new Set();
  const add = (team) => {
    const ref = teamRefOf(team);
    if (!ref.id || seen.has(ref.id)) return;
    seen.add(ref.id);
    refs.push(ref);
  };
  for (const team of match?.teams || []) add(team);
  // A hand-built fixture occasionally omits `match.teams`; the innings still
  // names both sides, so use those as a fallback.
  for (const innings of inningsForMatch(match)) add(innings?.team);
  return refs;
}

/**
 * Which side a player represented for a batting, bowling or fielding row.
 *
 * - batting: the innings' batting team;
 * - bowling / fielding: the other team in the fixture.
 *
 * The fixture order (`match.teams[0]`, `[1]`) is deliberately irrelevant. A
 * manual scorecard stores innings in fixture order, and a live match stores
 * them in actual batting order; neither tells us who bowled without looking at
 * the innings' batting team.
 */
export function teamForInnings(match, innings, role = "batting") {
  const battingTeam = teamRefOf(innings?.team);
  if (role === "batting") return battingTeam;

  const matchTeams = matchTeamRefs(match);
  const fieldingTeam = matchTeams.find((team) => team.id && team.id !== battingTeam.id);
  if (fieldingTeam) return fieldingTeam;
  if (matchTeams.length > 0) return matchTeams[0];
  return { id: null, name: "", logo: "" };
}

/** Numeric match time with a stable id tie-break; used only for "latest team". */
function matchStamp(match) {
  const raw = match?.startAt || match?.updatedAt || match?.createdAt || 0;
  const time = new Date(raw).getTime();
  return {
    time: Number.isFinite(time) ? time : 0,
    tie: String(idOf(match) || ""),
  };
}

function isNewerStamp(a, b) {
  if (!b) return true;
  if (a.time !== b.time) return a.time > b.time;
  return a.tie >= b.tie;
}

function playedAtOf(match) {
  const raw = match?.startAt || match?.updatedAt || match?.createdAt || null;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Record that a player appeared for `team` in `match` and keep the row's
 * public team label on the most recent appearance. Career figures still span
 * every match; only the displayed team changes, which is the only honest
 * choice for a player who turned out for more than one side.
 *
 * Internal stamps are non-enumerable so a `{ ...row }` or `res.json(row)`
 * cannot leak implementation details.
 */
export function recordTeamAppearance(row, team, match) {
  if (!row || !team?.id) return row;
  const stamp = matchStamp(match);
  const playedAt = playedAtOf(match);

  if (!Array.isArray(row.teamsPlayedFor)) row.teamsPlayedFor = [];
  const existing = row.teamsPlayedFor.find((entry) => entry.teamId === team.id);
  if (existing) {
    const existingTime = existing.lastPlayedAt ? new Date(existing.lastPlayedAt).getTime() : 0;
    const nextTime = playedAt ? new Date(playedAt).getTime() : 0;
    if (nextTime >= existingTime) {
      existing.name = team.name || existing.name;
      existing.logo = team.logo || existing.logo;
      existing.lastPlayedAt = playedAt;
    }
  } else {
    row.teamsPlayedFor.push({
      teamId: team.id,
      name: team.name || "",
      logo: team.logo || "",
      lastPlayedAt: playedAt,
    });
  }

  if (!isNewerStamp(stamp, row._teamStamp)) return row;
  Object.defineProperty(row, "_teamStamp", {
    value: stamp,
    writable: true,
    enumerable: false,
    configurable: true,
  });
  row.teamId = team.id;
  row.team = team.name || "";
  row.teamLogo = team.logo || "";
  return row;
}

/** Latest team a player represented in one match (batting/bowling/fielding/squad). */
export function playerTeamInMatch(match, playerId) {
  const wanted = String(playerId || "");
  if (!wanted) return null;
  let found = null;

  for (const innings of inningsForMatch(match)) {
    const battingTeam = teamForInnings(match, innings, "batting");
    const fieldingTeam = teamForInnings(match, innings, "fielding");
    if ((innings.batting || []).some((row) => idOf(row.player) === wanted && !isDidNotBat(row))) {
      found = battingTeam;
    }
    if ((innings.bowling || []).some((row) => idOf(row.player) === wanted)) {
      found = fieldingTeam;
    }
    for (const row of innings.batting || []) {
      const credit = FIELDING_DISMISSALS[String(row?.dismissalType || "").toLowerCase()];
      if (credit && idOf(row?.fielder) === wanted) found = fieldingTeam;
    }
  }
  if (found) return found;

  // A selected player who neither batted nor bowled still has a team; this is
  // only a fallback for presentation (never for counting a match).
  for (const group of [...(match?.playingXI || []), ...(match?.squad15 || [])]) {
    if ((group.players || []).some((player) => idOf(player) === wanted)) {
      return teamRefOf(group.team);
    }
  }
  return null;
}

/**
 * Newest appearance first, so a consumer can render "also played for" without
 * re-implementing the date comparison. The row's `teamId`/`team` already point
 * at the first entry.
 */
function sortAppearances(row) {
  if (Array.isArray(row?.teamsPlayedFor) && row.teamsPlayedFor.length > 1) {
    row.teamsPlayedFor.sort((a, b) => {
      const aTime = a.lastPlayedAt ? new Date(a.lastPlayedAt).getTime() : 0;
      const bTime = b.lastPlayedAt ? new Date(b.lastPlayedAt).getTime() : 0;
      return bTime - aTime || String(a.teamId).localeCompare(String(b.teamId));
    });
  }
  return row;
}

/**
 * How many matches each player actually took part in.
 *
 * "Played" = batted (a real row, never a DNB row), bowled, took a recorded
 * fielding dismissal, or was named in the playing XI. Every completed,
 * non-draft match counts ONCE, even when the player batted and bowled in it.
 * This is THE rule behind every "Mat" column and the impact ranking, so the
 * numbers cannot disagree between two leaderboards.
 *
 * @returns {Map<string, Set<string>>} playerId -> set of match ids
 */
export function collectPlayedMatches(matches = []) {
  const played = new Map();
  const add = (playerId, matchId) => {
    if (!playerId) return;
    if (!played.has(playerId)) played.set(playerId, new Set());
    played.get(playerId).add(matchId || "anonymous");
  };

  for (const match of matches || []) {
    if (isDraftMatch(match)) continue;
    if (!COMPLETED_STATUSES.includes(String(match?.status || "").toLowerCase())) continue;
    const matchId = idOf(match);

    for (const innings of inningsForMatch(match)) {
      for (const row of innings.batting || []) {
        if (!isDidNotBat(row)) add(idOf(row.player), matchId);
        const credit = FIELDING_DISMISSALS[String(row?.dismissalType || "").toLowerCase()];
        if (credit) add(idOf(row?.fielder), matchId);
      }
      for (const row of innings.bowling || []) add(idOf(row.player), matchId);
    }

    // A selected player who neither batted nor bowled still played the match.
    for (const group of match.playingXI || []) {
      for (const player of group?.players || []) add(idOf(player), matchId);
    }
  }

  return played;
}

export const FIELDING_DISMISSALS = Object.freeze({
  caught: "catches",
  stumped: "stumpings",
  "run out": "runOuts",
  runout: "runOuts",
  run_out: "runOuts",
});

/**
 * Team represented by each player in their latest match in this result set.
 * The team is independent of the player's role in the match, so every
 * leaderboard row for a player who changed teams shows the same latest team.
 */
export function latestPlayerTeamAppearances(matches) {
  const appearances = new Map();

  for (const match of matches || []) {
    const participants = new Set();
    for (const innings of inningsForMatch(match)) {
      for (const row of innings.batting || []) {
        if (!isDidNotBat(row)) {
          const playerId = idOf(row.player);
          if (playerId) participants.add(playerId);
        }
        const credit = FIELDING_DISMISSALS[String(row?.dismissalType || "").toLowerCase()];
        const fielderId = credit ? idOf(row?.fielder) : null;
        if (fielderId) participants.add(fielderId);
      }
      for (const row of innings.bowling || []) {
        const playerId = idOf(row.player);
        if (playerId) participants.add(playerId);
      }
    }

    for (const playerId of participants) {
      const team = playerTeamInMatch(match, playerId);
      if (!team?.id) continue;
      if (!appearances.has(playerId)) appearances.set(playerId, { teamsPlayedFor: [] });
      recordTeamAppearance(appearances.get(playerId), team, match);
    }
  }

  return appearances;
}

/** Apply one player's latest match team to all their aggregated role rows. */
export function applyLatestPlayerTeamAppearances(rows, matches) {
  const appearances = latestPlayerTeamAppearances(matches);
  for (const row of rows || []) {
    const appearance = appearances.get(String(row?.playerId || ""));
    if (!appearance) continue;
    row.teamId = appearance.teamId;
    row.team = appearance.team;
    row.teamLogo = appearance.teamLogo;
    row.teamsPlayedFor = [...appearance.teamsPlayedFor];
  }
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

  const completed = matches.filter(
    (match) =>
      !isDraftMatch(match) &&
      (COMPLETED_STATUSES.includes(String(match?.status || "").toLowerCase()) ||
        COMPLETED_STATUSES.includes(String(match?.status || ""))),
  );

  const playedMatches = collectPlayedMatches(completed);
  const matchesPlayedOf = (playerId) => playedMatches.get(String(playerId || ""))?.size || 0;

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
    const winnerId = idOf(match.result?.winner);
    const resultType = String(match.result?.resultType || "").toLowerCase();
    const matchTeamIds = new Set();

    for (const innings of inningsForMatch(match)) {
      // Batting side comes from the innings itself. The fixture order is NOT a
      // reliable hint: a manual scorecard stores innings in fixture order, so
      // the side that batted first can be `teams[1]`.
      const battingTeam = teamForInnings(match, innings, "batting");
      const fieldingTeam = teamForInnings(match, innings, "fielding");
      const totals = inningsTotals(innings);

      if (battingTeam.id) {
        matchTeamIds.add(battingTeam.id);
        ensureTeam(battingTeam.id, battingTeam.name, battingTeam.logo);
      }
      if (fieldingTeam.id && fieldingTeam.id !== battingTeam.id) {
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

      const battingTeamRow = battingTeam.id ? teams.get(battingTeam.id) : null;
      if (battingTeamRow) {
        battingTeamRow.runsFor += totals.runs;
        battingTeamRow.wicketsLost += totals.wickets;
        battingTeamRow.fours += totals.fours;
        battingTeamRow.sixes += totals.sixes;
        battingTeamRow.ballsFaced += totals.balls;
        if (battingTeamRow.highestTotal == null || totals.runs > battingTeamRow.highestTotal) {
          battingTeamRow.highestTotal = totals.runs;
        }
        if (battingTeamRow.lowestTotal == null || totals.runs < battingTeamRow.lowestTotal) {
          battingTeamRow.lowestTotal = totals.runs;
        }
      }
      const bowlingTeamRow =
        fieldingTeam.id && fieldingTeam.id !== battingTeam.id ? teams.get(fieldingTeam.id) : null;
      if (bowlingTeamRow) {
        bowlingTeamRow.runsAgainst += totals.runs;
        bowlingTeamRow.wickets += totals.wickets;
        bowlingTeamRow.ballsBowled += totals.balls;
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
            teamId: battingTeam.id,
            team: battingTeam.name,
            teamLogo: battingTeam.logo,
            teamsPlayedFor: [],
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
        recordTeamAppearance(row, battingTeam, match);
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
          teamId: battingTeam.id,
          team: battingTeam.name,
          teamLogo: battingTeam.logo,
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
              teamsPlayedFor: [],
              matches: 0,
              catches: 0,
              stumpings: 0,
              runOuts: 0,
              _matchIds: new Set(),
            });
          }
          const fRow = fielding.get(fielderId);
          recordTeamAppearance(fRow, fieldingTeam, match);
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
            teamId: fieldingTeam.id,
            team: fieldingTeam.name,
            teamLogo: fieldingTeam.logo,
            teamsPlayedFor: [],
            innings: 0,
            balls: 0,
            maidens: 0,
            runs: 0,
            wickets: 0,
            dotBalls: 0,
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
        recordTeamAppearance(row, fieldingTeam, match);
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
        row.dotBalls += Number(entry.dotBalls ?? entry.dots) || 0;
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
          teamId: fieldingTeam.id,
          team: fieldingTeam.name,
          teamLogo: fieldingTeam.logo,
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

  applyLatestPlayerTeamAppearances(
    [...batting.values(), ...bowling.values(), ...fielding.values()],
    completed,
  );

  const battingRows = [...batting.values()].map((row) => {
    const outs = row.innings - row.notOuts;
    return sortAppearances({
      ...row,
      matches: matchesPlayedOf(row.playerId),
      average: outs > 0 ? Number((row.runs / outs).toFixed(2)) : null,
      strikeRate: row.balls > 0 ? Number(((row.runs / row.balls) * 100).toFixed(2)) : null,
      highestText: row.highestNotOut ? `${row.highest}*` : String(row.highest),
    });
  });

  const bowlingRows = [...bowling.values()].map((row) => {
    const oversValue = row.balls / 6;
    return sortAppearances({
      ...row,
      matches: matchesPlayedOf(row.playerId),
      oversText: oversText(row.balls),
      average: row.wickets > 0 ? Number((row.runs / row.wickets).toFixed(2)) : null,
      economy: oversValue > 0 ? Number((row.runs / oversValue).toFixed(2)) : null,
      strikeRate: row.wickets > 0 ? Number(((row.balls / row.wickets) * 6).toFixed(1)) : null,
    });
  });

  const fieldingRows = [...fielding.values()].map((row) => {
    const { _matchIds, ...rest } = row;
    return sortAppearances({
      ...rest,
      // Same "played" rule as the batting and bowling tables; the set of matches
      // in which the player actually took a dismissal is not the Mat column.
      matches: matchesPlayedOf(row.playerId),
      total: row.catches + row.stumpings + row.runOuts,
    });
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
    inningsScores
      .map((row) => ({ ...row, matches: matchesPlayedOf(row.playerId) }))
      .filter((row) => row.balls > 0 || row.runs > 0)
      .sort((a, b) => b.runs - a.runs || a.balls - b.balls),
  );
  const bestBowling = take(
    bowlingSpells
      .map((row) => ({ ...row, matches: matchesPlayedOf(row.playerId) }))
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
      "status startAt updatedAt createdAt result manOfMatch teams innings.team innings.runs innings.wickets innings.balls innings.overs " +
        "innings.extras innings.batting.player innings.batting.runs " +
        "innings.batting.balls innings.batting.fours innings.batting.sixes innings.batting.isOut " +
        "innings.batting.dismissalType innings.batting.fielder innings.bowling.player innings.bowling.balls " +
        "innings.bowling.overs innings.bowling.maidens innings.bowling.runs innings.bowling.wickets " +
        "innings.bowling.wides innings.bowling.noBalls playingXI.team playingXI.players",
    )
    .populate("teams", STATS_TEAM_SELECT)
    .populate("innings.team", STATS_TEAM_SELECT)
    .populate("innings.batting.player", STATS_PLAYER_SELECT)
    .populate("innings.batting.fielder", STATS_PLAYER_SELECT)
    .populate("innings.bowling.player", STATS_PLAYER_SELECT)
    .populate("manOfMatch", STATS_PLAYER_SELECT)
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

  // Player of the Tournament. The scoring module imports this file's helpers,
  // so it is loaded lazily here to keep the dependency one-way at module load.
  const { computeTournamentImpact } = await import("./tournamentImpact.js");
  const impact = computeTournamentImpact({ matches: cleanMatches });
  const impactRows = strip(impact.rows);
  impactRows.forEach((row, index) => {
    row.rank = index + 1;
  });
  const playerOfTournament = {
    ...impact,
    rows: impactRows,
    leader: impactRows[0] || null,
    hasData: impactRows.length > 0,
  };

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
    playerOfTournament,
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
  collectPlayedMatches,
  COMPLETED_STATUSES,
  readTournamentStatsCache,
  writeTournamentStatsCache,
  invalidateTournamentStatsCache,
};
