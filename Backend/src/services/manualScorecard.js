// Manual (paper) scorecard entry.
//
// A club knockout match played off-platform is entered by an admin from the
// paper scorebook. Rather than fake ball-by-ball events, the entry is written
// straight into the same summary innings the live scorer maintains
// (`innings[].batting` / `innings[].bowling` / `innings[].extras` /
// `innings[].fallOfWickets`), which is exactly what the standings recompute
// (`tournamentService`), the series player-stats aggregate (`seriesController`)
// and the public scorecard (`matchController.getMatchSummary`) already read.
// The match is flagged `source: "manual"` so the UI can suppress live-only
// widgets, but no stats reader needs a special case.
//
// This module is pure: it validates and normalizes a request body into a Match
// patch. Persistence, audit and socket emits live in the controller.

const idOf = (value) => String(value?._id || value || "");

const toInt = (value, fallback = 0) => {
  if (value === "" || value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return NaN;
  if (!Number.isInteger(parsed)) return NaN;
  return parsed;
};

export const MANUAL_STAGES = ["group", "quarter_final", "semi_final", "final", "third_place"];

// Paper "how out" shorthand -> the structured code the stats aggregate knows.
const DISMISSAL_ALIASES = {
  b: "bowled",
  bowled: "bowled",
  c: "caught",
  caught: "caught",
  ct: "caught",
  lbw: "lbw",
  st: "stumped",
  stumped: "stumped",
  "run out": "run out",
  runout: "run out",
  "run_out": "run out",
  ro: "run out",
  "hit wicket": "hit wicket",
  hitwicket: "hit wicket",
  "hit_wicket": "hit wicket",
  "retired hurt": "retired hurt",
  "retired_hurt": "retired hurt",
  rh: "retired hurt",
  retired: "retired",
  obstructing: "obstructing the field",
  "obstructing the field": "obstructing the field",
};

export const normalizeDismissalType = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  return DISMISSAL_ALIASES[raw] || raw;
};

/**
 * Parse a printed over figure into balls.
 * "19.4" -> 19 completed overs + 4 balls = 118 balls. "12" -> 72 balls.
 * Rejects malformed input and a last-over ball count above 5.
 */
export function parseOvers(value) {
  if (value === "" || value == null) return { valid: true, overs: 0, ballsInOver: 0, balls: 0 };
  const str = String(value).trim();
  if (!/^\d{1,3}(\.\d)?$/.test(str)) {
    return { valid: false, reason: `Overs "${value}" must look like 12 or 19.4` };
  }
  const [whole, frac = "0"] = str.split(".");
  const overs = Number(whole);
  const ballsInOver = Number(frac);
  if (ballsInOver > 5) {
    return { valid: false, reason: `Overs "${value}" has more than 5 balls in the final over` };
  }
  return { valid: true, overs, ballsInOver, balls: overs * 6 + ballsInOver };
}

export const formatOversLabel = (balls = 0) => `${Math.floor(balls / 6)}.${balls % 6}`;

/**
 * Store a printed over figure as ONE number ("19.4" -> 19.4), the same unit the
 * live scoring engine writes into `innings.fallOfWickets[].overs`. Storing a ball
 * count here used to make the public scorecard print "13 ov" for 2.1 overs.
 */
export const toOverFigure = (parsed) =>
  parsed?.valid ? Number(`${parsed.overs}.${parsed.ballsInOver}`) : 0;

const pushError = (errors, path, message) => errors.push({ path, message });

/**
 * Validate + normalize a manual scorecard.
 *
 * ctx = {
 *   teamIds: [idA, idB],                 // the two teams (required)
 *   totalOvers: number,                  // innings quota
 *   squadByTeam: { [teamId]: string[] }  // allowed player ids; empty/absent => skip check
 *   requireComplete: boolean             // false for a saved draft
 * }
 *
 * Returns { ok, errors, data }. `data` is present only when ok.
 */
export function validateManualScorecard(input = {}, ctx = {}) {
  const errors = [];
  const {
    teamIds = [],
    totalOvers = 20,
    squadByTeam = {},
    requireComplete = true,
  } = ctx;

  const [teamAId, teamBId] = teamIds.map(idOf);
  const knownTeams = new Set([teamAId, teamBId].filter(Boolean));

  // --- Match level ---------------------------------------------------------
  const tossWinner = idOf(input.tossWinner);
  if (tossWinner && !knownTeams.has(tossWinner)) {
    pushError(errors, "tossWinner", "The toss winner must be one of the two teams.");
  }
  const tossDecision = input.tossDecision === "bowl" ? "bowl" : input.tossDecision === "bat" ? "bat" : "";

  const parsedTotalOvers = toInt(input.totalOvers ?? totalOvers, totalOvers);
  if (!Number.isFinite(parsedTotalOvers) || parsedTotalOvers < 1) {
    pushError(errors, "totalOvers", "Total overs must be a positive whole number.");
  }

  const stage = String(input.stage || "").trim();
  if (stage && !MANUAL_STAGES.includes(stage)) {
    pushError(errors, "stage", `Stage must be one of: ${MANUAL_STAGES.join(", ")}.`);
  }

  // --- Innings -------------------------------------------------------------
  const rawInnings = Array.isArray(input.innings) ? input.innings : [];
  const squadOf = (teamId) => {
    const key = idOf(teamId);
    const list = squadByTeam?.[key];
    if (!list || !list.length) return null; // unknown squad => cannot enforce
    return new Set(list.map(idOf));
  };

  const seenInningsTeams = new Set();
  const normalizedInnings = [];
  let teamWithData = 0;

  for (let i = 0; i < rawInnings.length; i += 1) {
    const raw = rawInnings[i] || {};
    const where = `innings[${i}]`;
    const team = idOf(raw.team);
    if (!team) {
      pushError(errors, `${where}.team`, "Each innings needs a batting team.");
      continue;
    }
    if (teamAId && teamBId && !knownTeams.has(team)) {
      pushError(errors, `${where}.team`, "The innings team must be one of the two teams.");
      continue;
    }
    if (seenInningsTeams.has(team)) {
      pushError(errors, `${where}.team`, "The same team cannot bat twice.");
      continue;
    }
    seenInningsTeams.add(team);

    const opponent = team === teamAId ? teamBId : teamAId;
    const battingSquad = squadOf(team);
    const bowlingSquad = squadOf(opponent);

    const batting = [];
    const battingSeen = new Set();
    const rawBatting = Array.isArray(raw.batting) ? raw.batting : [];
    if (rawBatting.length) teamWithData += 1;

    for (let b = 0; b < rawBatting.length; b += 1) {
      const row = rawBatting[b] || {};
      const bwhere = `${where}.batting[${b}]`;
      const player = idOf(row.player);
      if (!player) {
        pushError(errors, `${bwhere}.player`, "Every batting row needs a player.");
        continue;
      }
      if (battingSeen.has(player)) {
        pushError(errors, `${bwhere}.player`, "A player cannot appear twice in the same batting card.");
        continue;
      }
      battingSeen.add(player);
      if (battingSquad && !battingSquad.has(player)) {
        pushError(errors, `${bwhere}.player`, "This batsman is not in the selected team's squad.");
      }

      let dismissalType = normalizeDismissalType(row.dismissalType);
      let isRetiredHurt = row.isRetiredHurt === true || dismissalType === "retired hurt";
      let isRetired = row.isRetired === true || dismissalType === "retired";
      // "retired hurt"/"retired" are not wickets; the flag is the source of truth.
      let isOut = row.isOut === true || (Boolean(dismissalType) && !isRetiredHurt && !isRetired);
      if (isRetiredHurt || isRetired) isOut = false;
      if (!isOut && !isRetiredHurt && !isRetired) dismissalType = "";

      const runs = toInt(row.runs, 0);
      const balls = toInt(row.balls, 0);
      const fours = toInt(row.fours, 0);
      const sixes = toInt(row.sixes, 0);
      for (const [label, value] of [["runs", runs], ["balls", balls], ["fours", fours], ["sixes", sixes]]) {
        if (!Number.isFinite(value) || value < 0) pushError(errors, `${bwhere}.${label}`, `${label} must be a whole number of 0 or more.`);
      }
      if (Number.isFinite(runs) && Number.isFinite(fours) && Number.isFinite(sixes) && fours * 4 + sixes * 6 > runs) {
        pushError(errors, `${bwhere}.runs`, "Boundary runs (4s and 6s) cannot exceed the batsman's total runs.");
      }

      batting.push({
        player,
        runs,
        balls,
        fours,
        sixes,
        strikeRate: balls > 0 ? Number(((runs / balls) * 100).toFixed(2)) : 0,
        isOut,
        isRetiredHurt,
        isRetired,
        dismissalType,
        dismissalText: String(row.dismissalText || "").trim(),
        dismissedBy: idOf(row.dismissedBy) || null,
        fielder: idOf(row.fielder) || null,
        position: b + 1,
      });
    }

    const bowling = [];
    const bowlingSeen = new Set();
    const rawBowling = Array.isArray(raw.bowling) ? raw.bowling : [];
    for (let w = 0; w < rawBowling.length; w += 1) {
      const row = rawBowling[w] || {};
      const wwhere = `${where}.bowling[${w}]`;
      const player = idOf(row.player);
      if (!player) {
        pushError(errors, `${wwhere}.player`, "Every bowling row needs a player.");
        continue;
      }
      if (bowlingSeen.has(player)) {
        pushError(errors, `${wwhere}.player`, "A player cannot appear twice in the same bowling card.");
        continue;
      }
      bowlingSeen.add(player);
      if (bowlingSquad && !bowlingSquad.has(player)) {
        pushError(errors, `${wwhere}.player`, "This bowler is not in the opposing team's squad.");
      }

      const oversParsed = parseOvers(row.overs);
      if (!oversParsed.valid) pushError(errors, `${wwhere}.overs`, oversParsed.reason);

      const maidens = toInt(row.maidens, 0);
      const runs = toInt(row.runs, 0);
      const wickets = toInt(row.wickets, 0);
      const wides = toInt(row.wides, 0);
      const noBalls = toInt(row.noBalls, 0);
      for (const [label, value] of [["maidens", maidens], ["runs", runs], ["wickets", wickets], ["wides", wides], ["noBalls", noBalls]]) {
        if (!Number.isFinite(value) || value < 0) pushError(errors, `${wwhere}.${label}`, `${label} must be a whole number of 0 or more.`);
      }
      if (Number.isFinite(wickets) && wickets > 10) {
        pushError(errors, `${wwhere}.wickets`, "A bowler cannot take more than 10 wickets.");
      }
      const balls = oversParsed.valid ? oversParsed.balls : 0;
      bowling.push({
        player,
        overs: oversParsed.valid ? oversParsed.overs : 0,
        balls,
        maidens,
        runs,
        wickets,
        wides,
        noBalls,
        economy: balls > 0 ? Number(((runs / balls) * 6).toFixed(2)) : 0,
      });
    }

    const extrasInput = raw.extras || {};
    const extras = {
      wides: toInt(extrasInput.wides, 0),
      noBalls: toInt(extrasInput.noBalls, 0),
      byes: toInt(extrasInput.byes, 0),
      legByes: toInt(extrasInput.legByes, 0),
      penalties: toInt(extrasInput.penalties, 0),
    };
    for (const [label, value] of Object.entries(extras)) {
      if (!Number.isFinite(value) || value < 0) pushError(errors, `${where}.extras.${label}`, `Extras ${label} must be a whole number of 0 or more.`);
    }
    extras.total = extras.wides + extras.noBalls + extras.byes + extras.legByes + extras.penalties;

    const battingRuns = batting.reduce((sum, row) => sum + (Number.isFinite(row.runs) ? row.runs : 0), 0);
    const computedRuns = battingRuns + extras.total;
    const computedWickets = batting.filter((row) => row.isOut).length;

    const providedRuns = toInt(raw.runs, NaN);
    const providedWickets = toInt(raw.wickets, NaN);
    const oversParsed = parseOvers(raw.overs);
    if (!oversParsed.valid) pushError(errors, `${where}.overs`, oversParsed.reason);

    if (requireComplete) {
      if (Number.isFinite(providedRuns) && providedRuns !== computedRuns) {
        pushError(errors, `${where}.runs`, `Total ${providedRuns} does not equal batting runs (${battingRuns}) plus extras (${extras.total}) = ${computedRuns}.`);
      }
      if (Number.isFinite(providedWickets) && providedWickets !== computedWickets) {
        pushError(errors, `${where}.wickets`, `Wickets (${providedWickets}) do not match the ${computedWickets} dismissed batsman(s).`);
      }
      if (oversParsed.valid && parsedTotalOvers && oversParsed.overs > parsedTotalOvers) {
        pushError(errors, `${where}.overs`, `Overs (${raw.overs}) exceed the ${parsedTotalOvers}-over quota.`);
      }
    }

    const fallOfWickets = [];
    const rawFow = Array.isArray(raw.fallOfWickets) ? raw.fallOfWickets : [];
    let lastFowWicket = 0;
    for (let f = 0; f < rawFow.length; f += 1) {
      const row = rawFow[f] || {};
      const fwhere = `${where}.fallOfWickets[${f}]`;
      const fRuns = toInt(row.runs, 0);
      const fWickets = toInt(row.wickets, 0);
      if (!Number.isFinite(fRuns) || fRuns < 0) pushError(errors, `${fwhere}.runs`, "Fall-of-wicket runs must be 0 or more.");
      if (!Number.isFinite(fWickets) || fWickets < 1) pushError(errors, `${fwhere}.wickets`, "Fall-of-wicket wicket number must be 1 or more.");
      if (fWickets <= lastFowWicket) pushError(errors, `${fwhere}.wickets`, "Fall-of-wicket wicket numbers must increase.");
      if (requireComplete && fWickets > computedWickets) pushError(errors, `${fwhere}.wickets`, "Fall-of-wicket wicket number exceeds the number of wickets lost.");
      if (requireComplete && fRuns > computedRuns) pushError(errors, `${fwhere}.runs`, "Fall-of-wicket runs exceed the innings total.");
      const fOvers = parseOvers(row.overs);
      if (!fOvers.valid) pushError(errors, `${fwhere}.overs`, fOvers.reason);
      if (requireComplete && fOvers.valid && oversParsed.valid && oversParsed.balls > 0 && fOvers.balls > oversParsed.balls) {
        pushError(errors, `${fwhere}.overs`, "Fall-of-wicket over is past the end of the innings.");
      }
      lastFowWicket = fWickets;
      fallOfWickets.push({
        runs: fRuns,
        wickets: fWickets,
        player: idOf(row.player) || null,
        overs: toOverFigure(fOvers),
      });
    }

    normalizedInnings.push({
      team,
      runs: computedRuns,
      wickets: computedWickets,
      overs: oversParsed.valid ? oversParsed.overs : toInt(raw.overs, 0) || 0,
      balls: oversParsed.valid ? oversParsed.balls : 0,
      extras,
      batting,
      bowling,
      fallOfWickets,
      battingOrder: batting.map((row) => row.player),
      status: "completed",
    });
  }

  if (requireComplete) {
    if (rawInnings.length < 2) pushError(errors, "innings", "A published scorecard needs both innings.");
    for (const team of [teamAId, teamBId]) {
      if (team && !seenInningsTeams.has(team)) {
        pushError(errors, "innings", "Both teams must appear once in the scorecard.");
        break;
      }
    }
    if (teamWithData === 0) pushError(errors, "innings", "Enter at least one batting card before publishing.");
  }

  // --- Result --------------------------------------------------------------
  const resultInput = input.result || {};
  const resultTypeRaw = String(resultInput.resultType || "normal").trim().toLowerCase().replace(/\s+/g, "_");
  const resultTypeMap = { normal: "normal", tie: "tie", tied: "tie", no_result: "no result", noresult: "no result", abandoned: "abandoned" };
  const resultType = resultTypeMap[resultTypeRaw] || "normal";
  let winner = idOf(resultInput.winner);
  if (resultType === "normal") {
    if (!winner && requireComplete) {
      pushError(errors, "result.winner", "A completed match needs a winner (or mark it a tie / no result).");
    } else if (winner && !knownTeams.has(winner)) {
      pushError(errors, "result.winner", "The winner must be one of the two teams.");
    }
  } else {
    winner = ""; // tie / no result: no winner
  }

  const manOfMatch = idOf(input.manOfMatch);
  if (manOfMatch) {
    const knownSquads = [squadOf(teamAId), squadOf(teamBId)].filter(Boolean);
    if (knownSquads.length && !knownSquads.some((squad) => squad.has(manOfMatch))) {
      pushError(errors, "manOfMatch", "The player of the match must be in one of the two teams' squads.");
    }
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    errors: [],
    data: {
      innings: normalizedInnings,
      tossWinner: tossWinner || null,
      tossDecision,
      stage,
      stageLabel: String(input.stageLabel || "").trim(),
      totalOvers: parsedTotalOvers,
      result: {
        winner: winner || null,
        resultType,
        margin: String(resultInput.margin || "").trim(),
        description: String(resultInput.note || resultInput.description || "").trim(),
      },
      manOfMatch: manOfMatch || null,
    },
  };
}

export default { validateManualScorecard, parseOvers, normalizeDismissalType, formatOversLabel, MANUAL_STAGES };
