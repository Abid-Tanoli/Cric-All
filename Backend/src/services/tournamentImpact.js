import {
  COMPLETED_STATUSES,
  FIELDING_DISMISSALS,
  applyLatestPlayerTeamAppearances,
  collectPlayedMatches,
  inningsForMatch,
  isDidNotBat,
  isDraftMatch,
  isOutEntry,
  oversToBalls,
  teamForInnings,
} from "./tournamentStats.js";

// ---------------------------------------------------------------------------
// Tournament impact score ("Player of the Tournament")
// ---------------------------------------------------------------------------
//
// One number per player that rewards actually winning cricket rather than just
// volume: runs and wickets, boundary and milestone bonuses, economy relative to
// the tournament's own average, fielding where it was recorded, a bonus for
// contributing in a winning cause and for a man-of-the-match award.
//
// EVERY weight lives in `IMPACT_WEIGHTS` below. Change a number there and both
// the ranking and the public "How it's calculated" text (`impactExplanation`)
// follow; never hard-code a weight anywhere else.
//
// The score is built per match, then summed:
//
//   match points = batting + bowling + fielding
//   match points *= winMultiplier   when the player's side won that match
//   total        = sum(match points) + manOfMatch per award
//
// Fielding is only added when a ball-by-ball card recorded it. Manual
// scorecards have no fielder, so a manual-only player is never punished for the
// data the platform does not have (and no catch is ever invented).
// ---------------------------------------------------------------------------

export const IMPACT_WEIGHTS = Object.freeze({
  batting: Object.freeze({
    /** 1 point per run is the backbone of the score. */
    run: 1,
    four: 1,
    six: 2,
    /**
     * Highest milestone only (a 100 gets 32, not 8 + 16 + 32). Ordered high to
     * low; the first tier the innings reaches is used.
     */
    milestones: Object.freeze([
      Object.freeze({ runs: 100, points: 32 }),
      Object.freeze({ runs: 50, points: 16 }),
      Object.freeze({ runs: 30, points: 8 }),
    ]),
    /** Dismissed for a duck. */
    duck: -2,
    /** Strike-rate nudge, only once a batter has faced enough balls to matter. */
    strikeRate: Object.freeze({
      minBalls: 10,
      tiers: Object.freeze([
        Object.freeze({ min: 200, points: 4 }),
        Object.freeze({ min: 150, points: 2 }),
      ]),
      slowMax: 100,
      slowPoints: -2,
    }),
  }),
  bowling: Object.freeze({
    wicket: 25,
    maiden: 12,
    /**
     * (tournament average economy - bowler economy) * overs * weight.
     * Positive when he conceded fewer runs per over than the field, negative
     * when more. Weighted at 1 so two runs/over better over four overs is +8.
     */
    economyWeight: 1,
    /** Economy adjustment only after a full over. */
    minBallsForEconomy: 6,
    /** Bowling haul bonus, highest tier only. */
    hauls: Object.freeze([
      Object.freeze({ wickets: 5, points: 25 }),
      Object.freeze({ wickets: 3, points: 10 }),
    ]),
  }),
  fielding: Object.freeze({ catch: 8, runOut: 12, stumping: 10 }),
  team: Object.freeze({
    /** A player's match points are multiplied by this when his side won. */
    winMultiplier: 1.2,
  }),
  /** Flat bonus when the match's man of the match is this player. */
  manOfMatch: 20,
});

const idOf = (value) => {
  if (!value) return null;
  if (typeof value === "object") return value._id ? String(value._id) : null;
  return String(value);
};

const round2 = (value) => Number((Number(value) || 0).toFixed(2));

/** Aggregated counter name -> weight name. */
const FIELDING_WEIGHT_KEYS = Object.freeze({
  catches: "catch",
  stumpings: "stumping",
  runOuts: "runOut",
});

function isCompleted(match) {
  const status = String(match?.status || "").toLowerCase();
  return !isDraftMatch(match) && COMPLETED_STATUSES.includes(status);
}

function bowlingBallsOf(entry) {
  const balls = Number(entry?.balls);
  return Number.isFinite(balls) && balls > 0 ? balls : oversToBalls(entry?.overs);
}

/** Highest milestone an innings reached (0 when below the lowest tier). */
export function milestonePoints(runs, weights = IMPACT_WEIGHTS) {
  for (const tier of weights.batting.milestones) {
    if ((Number(runs) || 0) >= tier.runs) return tier.points;
  }
  return 0;
}

/** Strike-rate adjustment for one innings. */
export function strikeRatePoints(runs, balls, weights = IMPACT_WEIGHTS) {
  const sr = weights.batting.strikeRate;
  const faced = Number(balls) || 0;
  if (faced < sr.minBalls) return 0;
  const rate = ((Number(runs) || 0) / faced) * 100;
  for (const tier of sr.tiers) {
    if (rate >= tier.min) return tier.points;
  }
  if (rate < sr.slowMax) return sr.slowPoints;
  return 0;
}

/** Haul bonus for one bowling spell (highest tier only). */
export function haulPoints(wickets, weights = IMPACT_WEIGHTS) {
  for (const tier of weights.bowling.hauls) {
    if ((Number(wickets) || 0) >= tier.wickets) return tier.points;
  }
  return 0;
}

/**
 * Economy adjustment for one spell, relative to the tournament average.
 * Returns 0 when the tournament economy is unknown or the spell is shorter
 * than a full over (a single ball must not swing the ranking).
 */
export function economyAdjustment(runs, balls, tournamentEconomy, weights = IMPACT_WEIGHTS) {
  const bw = weights.bowling;
  const delivered = Number(balls) || 0;
  if (!tournamentEconomy || delivered < bw.minBallsForEconomy) return 0;
  const economy = (Number(runs) || 0) / (delivered / 6);
  const overs = delivered / 6;
  return (tournamentEconomy - economy) * overs * bw.economyWeight;
}

/**
 * Plain-English explanation generated FROM the constants, so the public text can
 * never drift from the numbers actually used.
 */
export function impactExplanation(weights = IMPACT_WEIGHTS) {
  const bat = weights.batting;
  const bowl = weights.bowling;
  const field = weights.fielding;
  const milestones = bat.milestones.map((tier) => `${tier.points} for ${tier.runs}+`).join(", ");
  const tiers = bat.strikeRate.tiers.map((tier) => `${tier.points} at ${tier.min}+`).join(", ");
  const hauls = bowl.hauls.map((tier) => `${tier.points} for ${tier.wickets}+`).join(", ");
  const win = Math.round((weights.team.winMultiplier - 1) * 100);

  return [
    `Batting: ${bat.run} point per run, plus ${bat.four} per four and ${bat.six} per six.`,
    `Milestones (the highest one counts): ${milestones} runs.`,
    `A duck costs ${Math.abs(bat.duck)} points.`,
    `Strike rate, after at least ${bat.strikeRate.minBalls} balls faced: ${tiers}; below ${bat.strikeRate.slowMax} costs ${Math.abs(
      bat.strikeRate.slowPoints,
    )}.`,
    `Bowling: ${bowl.wicket} points per wicket and ${bowl.maiden} per maiden.`,
    `Economy vs the tournament average, per full over bowled: (tournament economy - bowler economy) x ${bowl.economyWeight}.`,
    `Bowling hauls (the highest one counts): ${hauls} wickets.`,
    `Fielding, where the scorecard records it: ${field.catch} per catch, ${field.stumping} per stumping, ${field.runOut} per run out. Manual scorecards do not record fielders, so nobody loses points there.`,
    `Winning: everything a player earned in a match his team won is multiplied by ${weights.team.winMultiplier} (+${win}%).`,
    `Man of the Match: ${weights.manOfMatch} extra points.`,
  ];
}

/**
 * Compute the tournament impact ranking.
 *
 * @param {object} input
 * @param {object[]} input.matches  MatchLike[] (same shape tournamentStats reads).
 * @param {object}  [input.weights] Override `IMPACT_WEIGHTS` (tests / tuning).
 * @returns {{
 *   rows: object[], leader: object|null, weights: object, explanation: string[],
 *   tournamentEconomy: number|null, fieldingRecorded: boolean, hasData: boolean,
 * }}
 */
export function computeTournamentImpact({ matches = [], weights = IMPACT_WEIGHTS } = {}) {
  const completed = (matches || []).filter(isCompleted);
  const played = collectPlayedMatches(completed);

  // ---- Pass 1: the tournament's own average economy ----------------------
  let econRuns = 0;
  let econBalls = 0;
  for (const match of completed) {
    for (const innings of inningsForMatch(match)) {
      for (const entry of innings.bowling || []) {
        if (!idOf(entry.player)) continue;
        econRuns += Number(entry.runs) || 0;
        econBalls += bowlingBallsOf(entry);
      }
    }
  }
  const tournamentEconomy = econBalls > 0 ? (econRuns / econBalls) * 6 : null;

  const players = new Map();
  let fieldingRecorded = false;

  const ensure = (playerId, playerRef, teamRef) => {
    if (!playerId) return null;
    if (!players.has(playerId)) {
      const ref = playerRef && typeof playerRef === "object" ? playerRef : {};
      players.set(playerId, {
        playerId,
        name: ref.name || "",
        imageUrl: ref.imageUrl || "",
        teamId: teamRef?.id || null,
        team: teamRef?.name || "",
        teamLogo: teamRef?.logo || "",
        teamsPlayedFor: [],
        matches: 0,
        innings: 0,
        runs: 0,
        balls: 0,
        fours: 0,
        sixes: 0,
        wickets: 0,
        ballsBowled: 0,
        maidens: 0,
        catches: 0,
        stumpings: 0,
        runOuts: 0,
        manOfMatchAwards: 0,
        impact: 0,
        breakdown: { batting: 0, bowling: 0, fielding: 0, winBonus: 0, manOfMatchBonus: 0 },
      });
    }
    const row = players.get(playerId);
    const ref = playerRef && typeof playerRef === "object" ? playerRef : {};
    if (!row.name && ref.name) row.name = ref.name;
    if (!row.imageUrl && ref.imageUrl) row.imageUrl = ref.imageUrl;
    // The final label comes from `applyLatestPlayerTeamAppearances` below; this
    // only seeds the team a row is first seen with.
    if (!row.teamId && teamRef?.id) {
      row.teamId = teamRef.id;
      row.team = teamRef.name || "";
      row.teamLogo = teamRef.logo || "";
    }
    return row;
  };

  for (const match of completed) {
    const matchId = idOf(match);
    const winnerId = idOf(match.result?.winner);
    const resultType = String(match.result?.resultType || "").toLowerCase();
    const decided = Boolean(winnerId) && !["tie", "no result", "abandoned"].includes(resultType);

    // Points earned in THIS match, so the win multiplier applies per match.
    const perMatch = new Map();
    const touch = (playerId) => {
      if (!perMatch.has(playerId)) {
        perMatch.set(playerId, { batting: 0, bowling: 0, fielding: 0, teamId: null });
      }
      return perMatch.get(playerId);
    };

    for (const innings of inningsForMatch(match)) {
      const battingTeam = teamForInnings(match, innings, "batting");
      const fieldingTeam = teamForInnings(match, innings, "fielding");

      for (const entry of innings.batting || []) {
        if (isDidNotBat(entry)) continue;
        const playerId = idOf(entry.player);
        if (!playerId) continue;
        const row = ensure(playerId, entry.player, battingTeam);
        const runs = Number(entry.runs) || 0;
        const balls = Number(entry.balls) || 0;
        const fours = Number(entry.fours) || 0;
        const sixes = Number(entry.sixes) || 0;

        let points =
          runs * weights.batting.run +
          fours * weights.batting.four +
          sixes * weights.batting.six +
          milestonePoints(runs, weights) +
          strikeRatePoints(runs, balls, weights);
        if (runs === 0 && isOutEntry(entry)) points += weights.batting.duck;

        row.innings += 1;
        row.runs += runs;
        row.balls += balls;
        row.fours += fours;
        row.sixes += sixes;
        row.breakdown.batting += points;

        const slot = touch(playerId);
        slot.batting += points;
        slot.teamId = battingTeam.id || slot.teamId;

        // Fielding credit belongs to the side that was NOT batting.
        const credit = FIELDING_DISMISSALS[String(entry.dismissalType || "").toLowerCase()];
        const fielderId = idOf(entry.fielder);
        if (credit && fielderId) {
          fieldingRecorded = true;
          const fielderRow = ensure(fielderId, entry.fielder, fieldingTeam);
          const pointsFor = weights.fielding[FIELDING_WEIGHT_KEYS[credit]] || 0;
          fielderRow[credit] += 1;
          fielderRow.breakdown.fielding += pointsFor;
          const fielderSlot = touch(fielderId);
          fielderSlot.fielding += pointsFor;
          fielderSlot.teamId = fieldingTeam.id || fielderSlot.teamId;
        }
      }

      for (const entry of innings.bowling || []) {
        const playerId = idOf(entry.player);
        if (!playerId) continue;
        const row = ensure(playerId, entry.player, fieldingTeam);
        const balls = bowlingBallsOf(entry);
        const runs = Number(entry.runs) || 0;
        const wickets = Number(entry.wickets) || 0;
        const maidens = Number(entry.maidens) || 0;

        const points =
          wickets * weights.bowling.wicket +
          maidens * weights.bowling.maiden +
          haulPoints(wickets, weights) +
          economyAdjustment(runs, balls, tournamentEconomy, weights);

        row.wickets += wickets;
        row.ballsBowled += balls;
        row.maidens += maidens;
        row.breakdown.bowling += points;

        const slot = touch(playerId);
        slot.bowling += points;
        slot.teamId = fieldingTeam.id || slot.teamId;
      }
    }

    const manOfMatchId = idOf(match.manOfMatch);
    if (manOfMatchId) {
      const row = ensure(manOfMatchId, match.manOfMatch, null);
      row.manOfMatchAwards += 1;
      row.breakdown.manOfMatchBonus += weights.manOfMatch;
      // The bonus is flat (not multiplied by the win factor).
      row.impact += weights.manOfMatch;
    }

    for (const [playerId, slot] of perMatch) {
      const row = players.get(playerId);
      if (!row) continue;
      const earned = slot.batting + slot.bowling + slot.fielding;
      const won = decided && slot.teamId && slot.teamId === winnerId;
      if (won) {
        row.breakdown.winBonus += earned * (weights.team.winMultiplier - 1);
      }
      row.impact += won ? earned * weights.team.winMultiplier : earned;
    }
  }

  // Matches played: one per completed match in which the player appeared.
  for (const [playerId, row] of players) {
    row.matches = played.get(playerId)?.size || 0;
  }

  applyLatestPlayerTeamAppearances([...players.values()], completed);

  const rows = [...players.values()].map((row) => ({
    ...row,
    impact: round2(row.impact),
    breakdown: {
      batting: round2(row.breakdown.batting),
      bowling: round2(row.breakdown.bowling),
      fielding: round2(row.breakdown.fielding),
      winBonus: round2(row.breakdown.winBonus),
      manOfMatchBonus: round2(row.breakdown.manOfMatchBonus),
    },
    oversText: `${Math.floor(row.ballsBowled / 6)}.${row.ballsBowled % 6}`,
  }));

  rows.sort((a, b) => {
    if (b.impact !== a.impact) return b.impact - a.impact;
    const weightA = a.runs + a.wickets * 20;
    const weightB = b.runs + b.wickets * 20;
    if (weightB !== weightA) return weightB - weightA;
    if (a.matches !== b.matches) return a.matches - b.matches;
    return String(a.name).localeCompare(String(b.name));
  });
  rows.forEach((row, index) => {
    row.rank = index + 1;
  });

  return {
    rows,
    leader: rows[0] || null,
    weights,
    explanation: impactExplanation(weights),
    tournamentEconomy: tournamentEconomy == null ? null : round2(tournamentEconomy),
    fieldingRecorded,
    hasData: rows.length > 0,
  };
}

export default {
  IMPACT_WEIGHTS,
  computeTournamentImpact,
  impactExplanation,
  milestonePoints,
  strikeRatePoints,
  haulPoints,
  economyAdjustment,
};
