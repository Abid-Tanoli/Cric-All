import {
  COMPLETED_STATUSES,
  FIELDING_DISMISSALS,
  applyLatestPlayerTeamAppearances,
  collectPlayedMatches,
  inningsForMatch,
  inningsTotals,
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
// the tournament's own average, fielding where it was recorded, how large a
// share of the team's runs/wickets the player produced, an unbeaten finish to a
// successful chase, a bonus for contributing in a winning cause and for a
// man-of-the-match award.
//
// EVERY weight lives in `IMPACT_WEIGHTS` below. Change a number there and both
// the ranking and the public "How points are calculated" text
// (`impactExplanation`) follow; never hard-code a weight anywhere else.
//
// The score is built per match, then summed:
//
//   match points = batting + bowling + fielding + teamShare + finishing
//   match points *= winMultiplier   when the player's side won that match
//   total        = sum(match points) + manOfMatch per award
//
// `teamShare` is the player's share of his side's runs in each innings plus his
// share of the wickets his side took. `finishing` is a small unbeaten-innings
// credit, plus a larger credit when that unbeaten innings completed a run
// chase. Both are earned in the same match as the underlying runs/wickets, so
// the win multiplier applies to them as well.
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
    /**
     * Share-of-team-runs bonus, per innings: (batter runs / team innings runs)
     * x this value. 20 means a player who scores half his side's runs earns a
     * 10-point bonus. It rewards the innings that actually built the total,
     * without turning a big total into a penalty for everyone else.
     */
    teamRunShare: 20,
    /**
     * A small credit for being unbeaten. It exists so an equal-run not-out
     * innings can never rank below the same innings with a dismissal; the duck
     * penalty already applies only when a batter was actually out.
     */
    notOut: 2,
    /**
     * Extra finishing credit when an unbeaten innings completed a successful
     * run chase (the side won by wickets). Chase detection uses the result
     * margin text because stored innings do not carry a reliable `target`.
     */
    chaseFinish: 12,
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
    /**
     * Share-of-team-wickets bonus, per innings: (bowler wickets / wickets the
     * bowling side took in that innings) x this value. A bowler who takes half
     * the side's wickets earns a 10-point bonus. Capped at one full share.
     */
    teamWicketShare: 20,
  }),
  fielding: Object.freeze({ catch: 8, runOut: 12, stumping: 10 }),
  team: Object.freeze({
    /**
     * Everything earned in a match the player's side won is multiplied by this
     * value, so winning runs and wickets are worth more than the same output in
     * a defeat. Context bonuses (team share, finishing) are multiplied too; the
     * man-of-the-match award is deliberately a flat addition.
     */
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
 * Whether the winner chased: a win "by wickets" means the side batting second
 * completed a target. Stored innings all carry `target: 0` today, so the result
 * margin/description is the only trustworthy signal. Returns false when no
 * margin is recorded rather than guessing.
 */
export function wonByWickets(match) {
  const margin = String(
    match?.result?.margin ?? match?.result?.description ?? match?.resultText ?? "",
  ).toLowerCase();
  return /wicket/.test(margin);
}

/**
 * Share of the team's innings runs, as impact points. A batter who scored 40 of
 * a 200 total gets 20% of `weights.batting.teamRunShare`; the bonus is capped at
 * one full share so malformed totals cannot invent points.
 */
export function teamRunSharePoints(runs, teamRuns, weights = IMPACT_WEIGHTS) {
  const total = Number(teamRuns) || 0;
  if (total <= 0) return 0;
  const share = Math.min(1, Math.max(0, (Number(runs) || 0) / total));
  return share * weights.batting.teamRunShare;
}

/**
 * Share of the wickets the bowling side took in an innings, as impact points.
 * Capped at one full share because a bowler's wicket column can occasionally
 * exceed the recorded team wickets in an incomplete manual card.
 */
export function teamWicketSharePoints(wickets, teamWickets, weights = IMPACT_WEIGHTS) {
  const total = Number(teamWickets) || 0;
  const taken = Number(wickets) || 0;
  if (total <= 0 || taken <= 0) return 0;
  const share = Math.min(1, taken / total);
  return share * weights.bowling.teamWicketShare;
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
    `Team share: up to ${bat.teamRunShare} points for your share of your team's runs in an innings, and up to ${bowl.teamWicketShare} for your share of the wickets your side took.`,
    `Finishing: ${bat.notOut} point${bat.notOut === 1 ? "" : "s"} for an unbeaten innings, plus ${bat.chaseFinish} more when that unbeaten innings completes a successful run chase. An unbeaten innings is never scored below the same runs after being dismissed.`,
    `Fielding, where the scorecard records it: ${field.catch} per catch, ${field.stumping} per stumping, ${field.runOut} per run out. Manual scorecards do not record fielders, so nobody loses points there.`,
    `Winning: runs, wickets and the context bonuses above are multiplied by ${weights.team.winMultiplier} (+${win}%) in a match your team won; the same output in a defeat keeps its base points.`,
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
        breakdown: {
          batting: 0,
          bowling: 0,
          fielding: 0,
          teamShare: 0,
          finishing: 0,
          winBonus: 0,
          manOfMatchBonus: 0,
        },
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
        perMatch.set(playerId, {
          batting: 0,
          bowling: 0,
          fielding: 0,
          teamShare: 0,
          finishing: 0,
          teamId: null,
        });
      }
      return perMatch.get(playerId);
    };

    for (const innings of inningsForMatch(match)) {
      const battingTeam = teamForInnings(match, innings, "batting");
      const fieldingTeam = teamForInnings(match, innings, "fielding");
      const totals = inningsTotals(innings);
      // A successful chase is a win by wickets. Only the side that batted in
      // this innings can earn the chase-finishing credit.
      const chaseWin =
        decided && battingTeam.id === winnerId && wonByWickets(match);

      for (const entry of innings.batting || []) {
        if (isDidNotBat(entry)) continue;
        const playerId = idOf(entry.player);
        if (!playerId) continue;
        const row = ensure(playerId, entry.player, battingTeam);
        const runs = Number(entry.runs) || 0;
        const balls = Number(entry.balls) || 0;
        const fours = Number(entry.fours) || 0;
        const sixes = Number(entry.sixes) || 0;
        const retired = entry.isRetiredHurt === true || entry.isRetired === true;
        const notOut = !isOutEntry(entry) && !retired;

        let points =
          runs * weights.batting.run +
          fours * weights.batting.four +
          sixes * weights.batting.six +
          milestonePoints(runs, weights) +
          strikeRatePoints(runs, balls, weights);
        if (runs === 0 && isOutEntry(entry)) points += weights.batting.duck;

        const sharePoints = teamRunSharePoints(runs, totals.runs, weights);
        let finishingPoints = notOut ? weights.batting.notOut : 0;
        if (notOut && chaseWin && runs > 0) {
          finishingPoints += weights.batting.chaseFinish;
        }

        row.innings += 1;
        row.runs += runs;
        row.balls += balls;
        row.fours += fours;
        row.sixes += sixes;
        row.breakdown.batting += points;
        row.breakdown.teamShare += sharePoints;
        row.breakdown.finishing += finishingPoints;

        const slot = touch(playerId);
        slot.batting += points;
        slot.teamShare += sharePoints;
        slot.finishing += finishingPoints;
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
        const sharePoints = teamWicketSharePoints(wickets, totals.wickets, weights);

        row.wickets += wickets;
        row.ballsBowled += balls;
        row.maidens += maidens;
        row.breakdown.bowling += points;
        row.breakdown.teamShare += sharePoints;

        const slot = touch(playerId);
        slot.bowling += points;
        slot.teamShare += sharePoints;
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
      const earned =
        slot.batting + slot.bowling + slot.fielding + slot.teamShare + slot.finishing;
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
      teamShare: round2(row.breakdown.teamShare),
      finishing: round2(row.breakdown.finishing),
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
  wonByWickets,
  teamRunSharePoints,
  teamWicketSharePoints,
};
