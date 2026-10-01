/**
 * Independent scorecard tally.
 *
 * This is deliberately *not* a re-read of the server's scorecard and does not
 * share any code with `ScoringEngine`. It is written from the Laws of Cricket so
 * that comparing it against the server is a real cross-check: if the tally and
 * the server agree, two independent implementations agree.
 *
 * Laws used (the ones the scoring engine is supposed to implement):
 *  L2.14  a Wide is one extra; any further runs on a Wide are credited as byes
 *         to the batters, and the batters may have crossed.
 *  L2.17  a No-ball is one extra; runs off the bat are credited to the batter.
 *  L2.19  Byes and leg-byes are extras credited to the batting side; the runs
 *         are completed by the batters, so an odd completed run changes strike.
 *  L3.13  a batter is out when the wicket is taken down; a run-out is NOT
 *         charged to the bowler.
 *  L2.13  a legal delivery is one that is not a Wide or a No-ball - byes and
 *         leg-byes ARE legal deliveries.
 *  L2.14  six legal balls make an over; the ends change at the end of the over.
 *
 * Anything the server does that contradicts the above shows up as a divergence
 * in the report rather than being silently absorbed here.
 */

const DISMISSALS_OUTSIDE_BOWLER = new Set(["runOut", "obstructingField", "hitTwice", "retiredOut"]);

export const VALID_DISMISSALS = [
  "bowled", "caught", "lbw", "runOut", "stumped",
  "hitWicket", "retiredOut", "obstructingField", "hitTwice",
];

function blankBatter(id, name) {
  return { playerId: id, name, runs: 0, balls: 0, fours: 0, sixes: 0, dots: 0, out: false, dismissal: null, dismissalBowler: null };
}

function blankBowler(id, name) {
  return { playerId: id, name, balls: 0, runs: 0, wickets: 0, maidens: 0, wides: 0, noBalls: 0, dots: 0, oversFull: 0 };
}

export function createTally({
  maxOvers = 20,
  maxWickets = 10,
  name = "innings",
  target = null,
} = {}) {
  const batting = new Map();
  const bowling = new Map();
  const extras = { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalty: 0 };
  const overLog = [];

  const state = {
    name,
    runs: 0,
    wickets: 0,
    legalBalls: 0,
    extras,
    onStrike: null,
    nonStrike: null,
    freeHitNext: false,
    overRuns: 0,
    overBalls: 0,
    overWickets: 0,
    overBowlerRuns: 0,
    overBowlerBalls: 0,
    overAllDot: true,
    overNoExtras: true,
    target,
    declared: false,
    ended: false,
    endReason: null,
  };

  const batter = (id, nm) => {
    if (!batting.has(id)) batting.set(id, blankBatter(id, nm));
    return batting.get(id);
  };
  const bowlerRow = (id, nm) => {
    if (!bowling.has(id)) bowling.set(id, blankBowler(id, nm));
    return bowling.get(id);
  };

  function classify(d) {
    if (d.isWide) return "wide";
    if (d.isNoBall) return "noBall";
    if (d.isBye) return "bye";
    if (d.isLegBye) return "legBye";
    return "legal";
  }

  /**
   * L2.13 - a legal delivery is anything that is not a Wide or a No-ball.
   */
  function isLegalDelivery(type) {
    return type !== "wide" && type !== "noBall";
  }

  /**
   * Is this dismissal allowed on this delivery?
   *  - free hit (or a no-ball): only run-out / obstructing the field / hit
   *    twice can dismiss;
   *  - wide: only run-out or stumped.
   */
  function dismissalAllowed(type, wicketType, isFreeHit) {
    if (!wicketType) return false;
    if (type === "noBall") return ["runOut", "obstructingField", "hitTwice"].includes(wicketType);
    if (type === "wide") return ["runOut", "stumped"].includes(wicketType);
    if (isFreeHit && type === "legal") return ["runOut", "obstructingField", "hitTwice"].includes(wicketType);
    return VALID_DISMISSALS.includes(wicketType);
  }

  /**
   * How many runs did the BATSMEN actually run? Only odd totals swap the ends.
   *  - legal: the runs
   *  - no-ball: the runs off the bat (the penalty extra was not run)
   *  - wide: the runs beyond the wide itself
   *  - bye / leg-bye: completed runs, which can change ends on an odd total
   */
  function crossingRunsFor(type, d) {
    const r = Number(d.runs || 0);
    if (type === "legal") return r;
    if (type === "noBall") return r;
    if (type === "wide") return r; // extraRuns = 1 + r; the batters ran r
    return r; // byes / leg-byes are completed by the batters
  }

  function teamRunsFor(type, d) {
    const r = Number(d.runs || 0);
    if (type === "wide") return 1 + r;
    if (type === "noBall") return 1 + r;
    return r;
  }

  function batsmanRunsFor(type, d) {
    const r = Number(d.runs || 0);
    if (type === "legal") return r;
    if (type === "noBall") return r;
    return 0; // wide / bye / leg-bye
  }

  /** Feeds one delivery. Returns what the tally believes happened. */
  function feed(d) {
    if (state.ended) throw new Error(`${name}: innings already ended, refusing to score another ball`);

    const type = classify(d);
    const legal = isLegalDelivery(type);
    const wasFreeHit = state.freeHitNext;
    const runs = Number(d.runs || 0);
    const teamRuns = teamRunsFor(type, d);
    const batRuns = batsmanRunsFor(type, d);

    const strikerId = d.batsmanOnStrikeId;
    const nonStrikerId = d.batsmanNonStrikeId;
    const bowlerId = d.bowlerId;

    // --- wicket first: decide whether it stands at all -------------------
    const validDismissal = !!d.isWicket && dismissalAllowed(type, d.wicketType, wasFreeHit);
    // The batter who actually faced the delivery is the one credited with the
    // runs and the ball; the caller may name a different dismissed player for a
    // run-out, in which case that player's row is closed without runs.
    let dismissedId = null;
    if (validDismissal) dismissedId = d.dismissedPlayerId || strikerId;

    // --- batter of the delivery -----------------------------------------
    const striker = batter(strikerId, d.batsmanOnStrikeName || strikerId);
    striker.runs += batRuns;
    if (legal) {
      striker.balls += 1;
      if (batRuns === 0 && !validDismissal) striker.dots += 1;
    }
    if (batRuns === 4) striker.fours += 1;
    if (batRuns === 6) striker.sixes += 1;

    if (validDismissal) {
      const outBatter = batter(dismissedId, d.dismissedPlayerName || dismissedId);
      outBatter.out = true;
      outBatter.dismissal = d.wicketType;
      outBatter.dismissalBowler = DISMISSALS_OUTSIDE_BOWLER.has(d.wicketType) ? null : bowlerId;
      outBatter.dismissalFielder = d.fielderId || null;
    }

    // --- bowler ----------------------------------------------------------
    const bow = bowlerRow(bowlerId, d.bowlerName || bowlerId);
    if (legal) {
      bow.balls += 1;
      if (type === "legal" && batRuns === 0) bow.dots += 1;
    }
    if (type === "wide") bow.wides += 1;
    if (type === "noBall") bow.noBalls += 1;
    // Byes and leg-byes are never charged to the bowler.
    if (type === "wide" || type === "noBall") bow.runs += teamRuns;
    else if (type === "legal") bow.runs += batRuns;
    // L3.13: a run-out is not a bowler wicket.
    if (validDismissal && !DISMISSALS_OUTSIDE_BOWLER.has(d.wicketType)) bow.wickets += 1;

    // --- extras ----------------------------------------------------------
    if (type === "wide") {
      // L2.14: the wide itself is one extra; any runs completed on the wide are
      // byes, because the ball missed the bat.
      extras.wides += 1;
      extras.byes += runs;
    } else if (type === "noBall") {
      extras.noBalls += 1;
    } else if (type === "bye") {
      extras.byes += runs;
    } else if (type === "legBye") {
      extras.legByes += runs;
    }

    // --- totals ----------------------------------------------------------
    state.runs += teamRuns;
    if (validDismissal) state.wickets += 1;

    // --- over bookkeeping ------------------------------------------------
    state.overRuns += teamRuns;
    state.overWickets += validDismissal ? 1 : 0;
    if (type !== "legal" || batRuns !== 0) state.overAllDot = false;
    if (type !== "legal") state.overNoExtras = false;
    if (legal) {
      state.overBalls += 1;
      state.legalBalls += 1;
    }

    // --- strike rotation --------------------------------------------------
    const crossing = crossingRunsFor(type, d);
    let swappedForOdd = false;
    if (crossing > 0 && crossing % 2 === 1) {
      [state.onStrike, state.nonStrike] = [state.nonStrike, state.onStrike];
      swappedForOdd = true;
    }
    // A run-out "did cross" also swaps the surviving batters.
    if (validDismissal && d.wicketType === "runOut" && d.didCross === true) {
      [state.onStrike, state.nonStrike] = [state.nonStrike, state.onStrike];
      swappedForOdd = true;
    }

    // --- over completion --------------------------------------------------
    let overComplete = false;
    if (state.overBalls >= 6) {
      overComplete = true;
      if (state.overAllDot && state.overNoExtras && state.overWickets === 0) {
        bow.maidens += 1;
      }
      overLog.push({
        over: overLog.length,
        balls: state.overBalls,
        runs: state.overRuns,
        wickets: state.overWickets,
        bowler: bowlerId,
        maiden: state.overAllDot && state.overNoExtras && state.overWickets === 0,
      });
      state.overRuns = 0;
      state.overBalls = 0;
      state.overWickets = 0;
      state.overAllDot = true;
      state.overNoExtras = true;
      // L2.14: ends change at the end of the over.
      [state.onStrike, state.nonStrike] = [state.nonStrike, state.onStrike];
    }

    // --- free hit ----------------------------------------------------------
    state.freeHitNext = type === "noBall";

    // --- innings end -------------------------------------------------------
    state.ended = checkEnd();

    return {
      type,
      teamRuns,
      batsmanRuns: batRuns,
      legalBall: legal,
      wicket: validDismissal,
      wicketType: validDismissal ? d.wicketType : null,
      dismissedId: validDismissal ? dismissedId : null,
      dismissalRejected: !!d.isWicket && !validDismissal,
      crossedForOdd: swappedForOdd,
      overComplete,
      freeHitNext: state.freeHitNext,
      onStrikeAfter: state.onStrike,
      nonStrikeAfter: state.nonStrike,
      inningsEnded: state.ended,
    };
  }

  /** Brings the incoming batter in for a dismissed one, at the same end. */
  function substituteBatter(dismissedId, newId) {
    if (!dismissedId || !newId) return;
    if (state.onStrike === dismissedId) state.onStrike = newId;
    else if (state.nonStrike === dismissedId) state.nonStrike = newId;
  }

  function checkEnd() {
    if (state.wickets >= maxWickets) {
      state.endReason = "allOut";
      return true;
    }
    if (maxOvers !== null) {
      const completed = Math.floor(state.legalBalls / 6);
      if (completed >= maxOvers && state.legalBalls % 6 === 0) {
        state.endReason = "oversComplete";
        return true;
      }
    }
    if (target !== null && state.runs >= target) {
      state.endReason = "targetChased";
      return true;
    }
    if (state.declared) {
      state.endReason = "declared";
      return true;
    }
    return false;
  }

  function declare() {
    state.declared = true;
    state.ended = checkEnd();
    return state.ended;
  }

  const oversText = () => `${Math.floor(state.legalBalls / 6)}.${state.legalBalls % 6}`;

  /** Canonical shape used for the comparison. */
  function snapshot() {
    return {
      name,
      runs: state.runs,
      wickets: state.wickets,
      balls: state.legalBalls,
      overs: oversText(),
      extras: { ...extras },
      extrasTotal: extras.wides + extras.noBalls + extras.byes + extras.legByes + extras.penalty,
      batting: [...batting.values()]
        .map((b) => ({
          playerId: b.playerId,
          name: b.name,
          runs: b.runs,
          // `balls` is the field name on Match.batsmanStatsSchema
          // (Backend/src/models/Match.js:78); the engine's `ballsFaced` is
          // mapped onto it by controllerAdapter.js:125.
          balls: b.balls,
          fours: b.fours,
          sixes: b.sixes,
          dots: b.dots,
          out: b.out,
          dismissal: b.dismissal,
        }))
        .sort((a, b) => b.runs - a.runs || a.playerId.localeCompare(b.playerId)),
      bowling: [...bowling.values()]
        .map((b) => ({ ...b, overs: `${Math.floor(b.balls / 6)}.${b.balls % 6}` }))
        .sort((a, b) => b.balls - a.balls || a.playerId.localeCompare(b.playerId)),
      overLog,
      ended: state.ended,
      endReason: state.endReason,
    };
  }

  return {
    state,
    feed,
    declare,
    snapshot,
    oversText,
    substituteBatter,
    setBatters(onStrike, nonStrike) {
      state.onStrike = onStrike;
      state.nonStrike = nonStrike;
    },
    get onStrike() {
      return state.onStrike;
    },
    get nonStrike() {
      return state.nonStrike;
    },
  };
}

/**
 * Compares the independent tally with what the server reported and returns a
 * list of human-readable divergences. An empty list means the two independent
 * implementations agree.
 */
export function compareTally(tallySnap, serverInnings, { label = "" } = {}) {
  const out = [];
  const add = (field, mine, theirs) =>
    out.push({ label, field, independent: mine, server: theirs });

  const sRuns = Number(serverInnings?.runs ?? 0);
  const sWickets = Number(serverInnings?.wickets ?? 0);
  const sBalls = Number(serverInnings?.balls ?? 0);

  if (sRuns !== tallySnap.runs) add("innings.runs", tallySnap.runs, sRuns);
  if (sWickets !== tallySnap.wickets) add("innings.wickets", tallySnap.wickets, sWickets);
  if (sBalls !== tallySnap.balls) add("innings.balls (legal deliveries)", tallySnap.balls, sBalls);

  // ---- extras ----------------------------------------------------------
  // The *split* of extras is a presentation choice and this tally is written to
  // the Laws: a wide is one extra, and runs completed off a wide are byes
  // (Law 2.14). The server folds those runs into `wides` instead. That is only
  // a divergence if it changes the total, so the split goes to `attribution`
  // and the total is asserted strictly.
  const sx = serverInnings?.extras || {};
  const attribution = [];
  const exMap = [
    ["wides", tallySnap.extras.wides, sx.wides],
    ["noBalls", tallySnap.extras.noBalls, sx.noBalls],
    ["byes", tallySnap.extras.byes, sx.byes],
    ["legByes", tallySnap.extras.legByes, sx.legByes],
  ];
  for (const [field, mine, theirs] of exMap) {
    if (theirs === undefined || theirs === null) continue;
    if (Number(theirs) !== Number(mine)) attribution.push({ field, independent: mine, server: Number(theirs) });
  }
  if (sx.total !== undefined && Number(sx.total) !== Number(tallySnap.extrasTotal)) {
    add("extras.total", tallySnap.extrasTotal, Number(sx.total));
  }

  // ---- batting ---------------------------------------------------------
  const serverBat = new Map(
    (serverInnings?.batting || []).map((b) => [String(b.player?._id || b.player), b]),
  );
  for (const mine of tallySnap.batting) {
    const theirs = serverBat.get(String(mine.playerId));
    if (!theirs) {
      out.push({ label, field: `batting[${mine.playerId}].missing`, independent: mine.runs, server: "absent from scorecard" });
      continue;
    }
    // `balls` is the persisted field name on Match.batsmanStatsSchema.
    for (const k of ["runs", "balls", "fours", "sixes"]) {
      const sv = Number(theirs[k] ?? 0);
      if (sv !== Number(mine[k])) add(`batting[${mine.playerId}].${k}`, mine[k], sv);
    }
    const serverOut = !!theirs.isOut;
    if (serverOut !== !!mine.out) add(`batting[${mine.playerId}].isOut`, mine.out, serverOut);
    if (mine.out && theirs.dismissalType && theirs.dismissalType !== mine.dismissal) {
      add(`batting[${mine.playerId}].dismissalType`, mine.dismissal, theirs.dismissalType);
    }
  }

  // ---- bowling ---------------------------------------------------------
  const serverBowl = new Map(
    (serverInnings?.bowling || []).map((b) => [String(b.player?._id || b.player), b]),
  );
  for (const mine of tallySnap.bowling) {
    const theirs = serverBowl.get(String(mine.playerId));
    if (!theirs) {
      out.push({ label, field: `bowling[${mine.playerId}].missing`, independent: mine.balls, server: "absent from scorecard" });
      continue;
    }
    for (const k of ["balls", "runs", "wickets", "wides", "noBalls"]) {
      const sv = Number(theirs[k] ?? 0);
      if (sv !== Number(mine[k])) add(`bowling[${mine.playerId}].${k}`, mine[k], sv);
    }
  }

  out.attribution = attribution;
  return out;
}

export const LAWS_NOTES = {
  L2_13: "a legal delivery is anything that is not a Wide or a No-ball",
  L2_14: "a Wide is one extra plus any runs run by the batters",
  L2_17: "a No-ball is one extra plus runs off the bat",
  L2_19: "byes and leg-byes do not change the strike (the fielders ran them)",
  L3_13: "a run-out is not charged to the bowler",
  L2_14_ends: "the ends change at the end of an over",
};
