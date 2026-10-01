/**
 * Innings driver: pairs the independent tally with the server on every ball.
 *
 * The tally owns the strike. The driver never decides who is facing - it reads
 * `tally.onStrike` / `tally.nonStrike` and asks the server to score that ball.
 * The server keeps its *own* view of the strike inside the match document and,
 * once it has one, ignores the ids in the request (see `resolveActiveBatters`
 * in controllerAdapter.js). So after the first ball the two strike trackers run
 * side by side, and comparing them is a genuine assertion rather than a
 * tautology: a divergence is a real bug in the rotation logic.
 *
 * Only the assigned `score_handler` ever calls this.
 */

import { createTally } from "./tally.js";

export function createInningsDriver({
  api,
  matchId,
  inningsIndex = 0,
  maxOvers = 20,
  maxWickets = 10,
  name = "innings",
  target = null,
  bowlerIds,
  bowlerNames = {},
  batterPool,
  fielderPool = [],
} = {}) {
  const tally = createTally({ maxOvers, maxWickets, name, target });

  const bowlers = bowlerIds.filter(Boolean);
  const fielders = (fielderPool.length ? fielderPool : bowlers).filter(Boolean);
  let overNo = 0;
  let usedBatters = new Set();  const nextBatterQueue = [...(batterPool || [])];

  const currentBowler = () => bowlers[overNo % bowlers.length];

  tally.setBatters(nextBatterQueue[0], nextBatterQueue[1]);
  usedBatters.add(nextBatterQueue[0]);
  usedBatters.add(nextBatterQueue[1]);

  const observations = {
    deliveries: 0,
    serverRejected: [],
    strikeMismatches: [],
    wicketCancellations: [],
    freeHitBlocks: [],
    lastServerInnings: null,
    adopted: false,
  };

  /**
   * Adopts the opening pair the server already has for this innings.
   *
   * Who opens is a setup decision (the match creator picks the openers, and the
   * innings inherits `battingOrder` / `currentBatsman1-2`), not something this
   * suite should assert. What matters - and what the two trackers then compare
   * independently - is every rotation *after* the first ball. So before ball one
   * the tally takes the server's opening pair as given, and from then on the two
   * strike trackers are independent.
   */
  async function adoptServerOpeners() {
    if (observations.adopted) return;
    observations.adopted = true;
    let innings;
    try {
      const res = await api.get(`/matches/${matchId}`, { expect: 200 });
      innings = res.body?.match?.innings?.[inningsIndex] || res.body?.innings?.[inningsIndex];
    } catch {
      return; // fall back to the supplied pool
    }
    if (!innings) return;
    const id = (v) => String(v?._id || v || "");
    const order = (innings.battingOrder || []).map(id).filter(Boolean);
    const b1 = id(innings.onStrikeBatsman) || id(innings.currentBatsman1) || order[0];
    const b2 = id(innings.currentBatsman2) || order[1];
    if (b1 && b2 && String(b1) !== String(b2)) {
      tally.setBatters(b1, b2);
      usedBatters = new Set([b1, b2]);
      observations.adoptedOpeners = { onStrike: b1, nonStrike: b2, source: "server" };
    } else {
      observations.adoptedOpeners = { source: "local pool", onStrike: tally.onStrike, nonStrike: tally.nonStrike };
    }
  }

  async function send(intent) {
    await adoptServerOpeners();
    const onStrike = tally.onStrike;
    const nonStrike = tally.nonStrike;
    const bowlerId = intent.bowlerId || currentBowler();
    const bowlerName = bowlerNames[bowlerId] || bowlerId;

    // A catch, stumping or run-out needs a real fielder id, and the validator
    // rejects anything that is not an ObjectId.
    const needsFielder = ["caught", "stumped", "runOut"].includes(intent.wicketType);
    const fielderId = needsFielder
      ? intent.fielderId || fielders[(observations.deliveries + 1) % fielders.length]
      : null;

    // The incoming batter has to be named in the request, because the server
    // derives the new striker from `nextBatsmanId`.
    const nextBatsmanId = intent.isWicket
      ? nextBatterQueue.find((id) => !usedBatters.has(id)) || null
      : null;

    const dismissedPlayerId = intent.isWicket ? (intent.dismissedPlayerId || onStrike) : null;

    const payload = {
      inningsIndex,
      runs: intent.runs ?? 0,
      isWide: !!intent.isWide,
      isNoBall: !!intent.isNoBall,
      isBye: !!intent.isBye,
      isLegBye: !!intent.isLegBye,
      isWicket: !!intent.isWicket,
      wicketType: intent.wicketType || "",
      dismissedPlayerId,
      fielderId,
      batsmanOnStrikeId: onStrike,
      batsmanNonStrikeId: nonStrike,
      bowlerId,
      commentaryText: intent.commentaryText || "OPENCODE_TEST_ delivery",
      didCross: intent.didCross,
      nextBatsmanId,
    };

    const res = await api.post(`/matches/${matchId}/score`, payload, { expect: 200 });
    observations.deliveries += 1;

    const serverBall = res.body?.ball || {};
    const serverInnings = res.body?.innings || {};

    const mine = tally.feed({
      runs: intent.runs ?? 0,
      isWide: !!intent.isWide,
      isNoBall: !!intent.isNoBall,
      isBye: !!intent.isBye,
      isLegBye: !!intent.isLegBye,
      isWicket: !!intent.isWicket,
      wicketType: intent.wicketType,
      dismissedPlayerId,
      fielderId,
      didCross: intent.didCross,
      batsmanOnStrikeId: onStrike,
      batsmanNonStrikeId: nonStrike,
      bowlerId,
      bowlerName,
    });

    if (mine.wicket && nextBatsmanId) {
      tally.substituteBatter(mine.dismissedId, nextBatsmanId);
      if (nextBatsmanId) usedBatters.add(nextBatsmanId);
    }
    if (mine.overComplete) overNo += 1;

    // --- cross-check the server's own view of the strike -----------------
    const serverStrikerBefore = String(serverBall.batsmanOnStrike?._id || serverBall.batsmanOnStrike || "");
    if (serverStrikerBefore && serverStrikerBefore !== String(onStrike)) {
      observations.strikeMismatches.push({
        delivery: observations.deliveries,
        label: intent._label || "",
        field: "batsmanOnStrike (before)",
        mine: String(onStrike),
        server: serverStrikerBefore,
      });
    }
    const serverStrikerAfter = String(
      res.body?.strikerAfterId || serverInnings.onStrikeBatsman?._id || serverInnings.onStrikeBatsman || "",
    );
    if (serverStrikerAfter && serverStrikerAfter !== String(tally.onStrike)) {
      observations.strikeMismatches.push({
        delivery: observations.deliveries,
        label: intent._label || "",
        field: "onStrike (after)",
        mine: String(tally.onStrike),
        server: serverStrikerAfter,
      });
    }

    // A wicket the caller asked for that the engine refused is a *feature* on a
    // free hit; record it so the scenario can assert it happened.
    if (intent.isWicket && !serverBall.isWicket) {
      observations.wicketCancellations.push({
        delivery: observations.deliveries,
        wicketType: intent.wicketType,
        ballIsNoBall: !!serverBall.isNoBall,
        ballWasFreeHit: !!serverBall.isFreeHit,
      });
    }

    observations.lastServerInnings = serverInnings;
    return { mine, serverBall, serverInnings, status: res.status, payload };
  }

  return {
    tally,
    observations,
    send,
    get onStrike() {
      return tally.onStrike;
    },
    get nonStrike() {
      return tally.nonStrike;
    },
    get overNo() {
      return overNo;
    },
    snapshot: () => tally.snapshot(),
  };
}

/**
 * Builds the delivery script for a full innings that touches every ball type
 * the engine classifies, plus every dismissal type the Laws allow.
 *
 * `wickets` is how many dismissals to place (kept under the wicket limit so the
 * innings is decided by overs, not by wickets).
 */
export function buildInningsScript({ legalBalls, wickets = 8, seed = 1 }) {
  const script = [];
  let legal = 0;
  let wicketCount = 0;
  let lastWasNoBall = false;
  let extraDoneForThisBall = false;

  // Deterministic pseudo-random so a failing run can be replayed exactly.
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };

  const dismissalCycle = ["bowled", "caught", "lbw", "stumped", "runOut"];

  while (legal < legalBalls) {
    const posInInnings = legal;

    // Every 17th legal ball is preceded by a non-legal delivery, cycling the
    // extras types so all four appear several times in a T20 innings. The
    // `extraDoneForThisBall` latch is what stops this branch re-firing forever:
    // a wide/bye/leg-bye consumes no legal ball, so `legal` does not move and
    // the loop would otherwise spin on the same condition.
    if (posInInnings > 0 && posInInnings % 17 === 0 && !extraDoneForThisBall) {
      const kind = Math.floor(posInInnings / 17) % 4;
      if (kind === 0) script.push({ isWide: true, runs: 0, _label: "wide +0" });
      else if (kind === 1) script.push({ isWide: true, runs: 1, _label: "wide +1" });
      else if (kind === 2) script.push({ isBye: true, runs: 1, _label: "bye 1" });
      else script.push({ isLegBye: true, runs: 2, _label: "leg-bye 2" });
      extraDoneForThisBall = true;
      continue;
    }
    extraDoneForThisBall = false;

    // No-balls: one plain, one hit for four (the classic "no-ball four" - the
    // run belongs to the batter and the extra is separate). Each is followed by
    // a legal delivery, so the free-hit flag is cleared again.
    //
    // A dismissal *on* the free hit is deliberately NOT attempted here. When the
    // server accepts it (it should not, Law 2.13.2 / the free-hit restriction)
    // the two strike trackers go permanently out of phase and every later
    // figure in the innings becomes meaningless. That rule is probed on its own
    // fixture in `probeFreeHit()` so one bug cannot blind the whole innings.
    if (posInInnings === 11 || posInInnings === 57) {
      script.push({ isNoBall: true, runs: 0, _label: "no-ball +0" });
      lastWasNoBall = true;
      legal += 1;
      continue;
    }
    if (posInInnings === 12 || posInInnings === 58) {
      script.push({ isNoBall: true, runs: 4, _label: "no-ball +4" });
      lastWasNoBall = true;
      legal += 1;
      continue;
    }

    // Clear the free-hit state with a legal, wicket-free ball.
    if (lastWasNoBall && wicketCount < wickets) {
      script.push({ runs: 1, _label: "free hit consumed by a legal single" });
      lastWasNoBall = false;
      legal += 1;
      continue;
    }
    lastWasNoBall = false;

    // Spread the real dismissals through the innings. The run-out takes the
    // striker: the engine always closes the striker's row (see
    // `_updateBattingStats`), so a run-out of the non-striker is probed
    // separately in the edge-case section instead of being mixed in here.
    if (wicketCount < wickets && legal > 0 && legal % Math.floor(legalBalls / (wickets + 1)) === 0) {
      const wicketType = dismissalCycle[wicketCount % dismissalCycle.length];
      script.push({
        runs: 0,
        isWicket: true,
        wicketType,
        _label: `wicket: ${wicketType}`,
      });
      wicketCount += 1;
      legal += 1;
      continue;
    }

    // Otherwise a run, on a distribution shaped like a real T20 innings
    // (mean ~1.1 runs a ball) so the total stays in the 130-170 range and the
    // chase in the next innings is actually achievable inside 20 overs.
    const roll = rnd();
    let runs;
    if (roll < 0.55) runs = 0;
    else if (roll < 0.72) runs = 1;
    else if (roll < 0.82) runs = 2;
    else if (roll < 0.86) runs = 3;
    else if (roll < 0.96) runs = 4;
    else runs = 6;
    script.push({ runs, _label: `run ${runs}` });
    legal += 1;
  }

  return script;
}

/**
 * Dedicated free-hit probe, on its own fixture.
 *
 * Law 2.13.2 / Law 42.6: after a no-ball the next legal delivery is a free hit,
 * and on a free hit the only dismissals that stand are a run-out, obstructing
 * the field, or hit twice. This sends a no-ball and then attempts `bowled`,
 * `caught`, `lbw` and `runOut`, so the suite can show exactly which of them the
 * server lets through.
 *
 * Kept off the main innings because one wrongly-accepted dismissal desynchronises
 * the strike for the rest of the match and hides every later figure.
 */
export async function probeFreeHit({ api, matchId, bowlerId, batterPool, fielderPool }) {
  const striker = batterPool[0];
  const nonStriker = batterPool[1];
  const results = [];

  const send = async (payload, label) => {
    const res = await api.post(
      `/matches/${matchId}/score`,
      {
        inningsIndex: 0,
        batsmanOnStrikeId: striker,
        batsmanNonStrikeId: nonStriker,
        bowlerId,
        ...payload,
      },
      { expect: null },
    );
    results.push({
      label,
      status: res.status,
      serverSaidFreeHit: res.body?.ball?.isFreeHit ?? null,
      serverSaidWicket: res.body?.ball?.isWicket ?? null,
      wickets: res.body?.innings?.wickets ?? null,
      runs: res.body?.innings?.runs ?? null,
    });
    return res;
  };

  // Each dismissal probe must be the very next legal ball after a no-ball.
  // Otherwise the first attempted delivery consumes the free hit and later
  // probes would be ordinary balls rather than tests of the restriction.
  for (const wt of ["bowled", "caught", "lbw", "runOut"]) {
    await send({ isNoBall: true, runs: 0 }, `no-ball before ${wt} (should arm a free hit)`);
    await send(
      {
        runs: 0,
        isWicket: true,
        wicketType: wt,
        fielderId: ["caught", "runOut"].includes(wt) ? fielderPool[0] : null,
        dismissedPlayerId: striker,
        nextBatsmanId: batterPool[2],
      },
      `free hit, then ${wt}`,
    );
  }

  return results;
}
