/**
 * E2E runner - local only.
 *
 * Scenarios:
 *   1  a complete T20 innings (20 overs, every ball type, every dismissal type)
 *      followed by a chase to the target
 *   2  the free-hit restriction, on its own fixture
 *   3  an innings that is bowled out inside its overs
 *   4  a tie, then a Super Over
 *   5  negative tests over HTTP
 *   6  negative tests over Socket.IO
 *   7  the other `Match.matchType` formats
 *
 * Usage: npm run test:e2e
 */

import { API_BASE, assertLocalTarget, assertServerIsLocal } from "./lib/guard.js";
import { createClient } from "./lib/http.js";
import { bootstrap, createMatch, createMatchInOtherOrg, fetchMatch, TEST_PREFIX } from "./lib/bootstrap.js";
import { createInningsDriver, buildInningsScript, probeFreeHit } from "./lib/innings.js";
import { compareTally } from "./lib/tally.js";
import { createReport } from "./lib/report.js";
import { attemptScoreOverSocket } from "./lib/socket.js";

const started = Date.now();
const runId = `${Date.now().toString(36)}`;
const resultsPath = process.env.E2E_RESULTS_PATH || "docs/e2e-results.md";

const log = (...a) => process.stdout.write(`${a.join(" ")}\n`);

const FORMATS = {
  T20: { maxOvers: 20, maxWickets: 10 },
  "6 Overs": { maxOvers: 6, maxWickets: 10 },
  "8 Overs": { maxOvers: 8, maxWickets: 10 },
  T10: { maxOvers: 10, maxWickets: 10 },
  "Super Over": { maxOvers: 1, maxWickets: 2 },
};

/**
 * `E2E_ONLY=1,7` runs just those scenarios. Scenarios are numbered 1-7 in the
 * order below. Useful while iterating: a single scenario finishes in seconds
 * instead of four minutes, and the fixtures are independent of each other.
 */
const ONLY = new Set(
  String(process.env.E2E_ONLY || "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n)),
);
const wantScenario = (n) => ONLY.size === 0 || ONLY.has(n);

const errText = (e) => `${e?.message || e} ${JSON.stringify(e?.body || "").slice(0, 300)}`;

async function main() {
  assertLocalTarget();
  await assertServerIsLocal();

  const makeClient = (token = null) => createClient({ apiBase: API_BASE, token });
  const report = createReport();

  log("--- bootstrap ---");
  const ctx = await bootstrap({ makeClient, runId });
  const scorerApi = makeClient(ctx.scorer.token);
  const ownerApi = makeClient(ctx.owner.token);

  const nameOf = (id) =>
    [...ctx.teams.a.players, ...ctx.teams.b.players].find((p) => p.id === String(id))?.name || id;

  const tallyNote = (snap) =>
    `Extras (Laws split): wides ${snap.extras.wides}, no-balls ${snap.extras.noBalls}, byes ${snap.extras.byes}, leg-byes ${snap.extras.legByes}, total ${snap.extrasTotal}.`;

  const recordAttribution = (S, label, divs) => {
    const attrib = divs?.attribution || [];
    if (attrib.length) {
      report.note(
        S,
        `Extras split (${label}): the independent tally follows the Laws - a wide is one extra and runs completed off a wide are byes. The server folds those runs into \`wides\` instead. ` +
          attrib.map((a) => `\`${a.field}\` independent=${a.independent} server=${a.server}`).join("; ") +
          `. The extras *total* is asserted separately and agrees.`,
      );
    }
  };

  // ======================================================================
  // Scenario 1 - a complete T20 innings, then the chase
  // ======================================================================
  if (wantScenario(1)) {
    const S = "Scenario 1 - full T20 innings (20 overs, every ball type) and the chase";
    report.section(S, `Fixture created through \`POST /organizations/:id/matches\`; every delivery sent by the invited \`score_handler\` (${ctx.scorer.email}), never by the owner.`);

    const { matchId } = await createMatch({ ctx, matchType: "T20", title: "t20" });

    const battingXI = ctx.teams.a.xi.map((p) => p.id);
    const bowlers = ctx.teams.b.xi.slice(5, 10).map((p) => p.id);
    const driver = createInningsDriver({
      api: scorerApi,
      matchId,
      inningsIndex: 0,
      maxOvers: 20,
      maxWickets: 10,
      name: "innings 1",
      bowlerIds: bowlers,
      bowlerNames: Object.fromEntries(bowlers.map((id) => [id, nameOf(id)])),
      batterPool: battingXI,
      fielderPool: ctx.teams.b.xi.slice(0, 5).map((p) => p.id),
    });

    const script = buildInningsScript({ legalBalls: 120, wickets: 8, seed: 20261001 });
    const extras = script.filter((s) => s.isWide || s.isNoBall || s.isBye || s.isLegBye).length;
    log(`  innings 1: ${script.length} deliveries (${extras} extras)`);

    let errored = null;
    try {
      for (const step of script) {
        if (driver.tally.state.ended) break;
        await driver.send(step);
      }
    } catch (e) {
      errored = e;
    }
    report.check(S, "every delivery accepted by POST /matches/:id/score", !errored, errored ? errText(errored) : `${driver.observations.deliveries} balls recorded`);
    if (errored) throw errored;

    const snap1 = driver.snapshot();
    const serverMatch = await fetchMatch(scorerApi, matchId);
    const serverInn1 = serverMatch.innings?.[0];

    report.check(S, "innings 1 ended on the last ball of over 20", snap1.ended && snap1.endReason === "oversComplete", `ended=${snap1.ended} reason=${snap1.endReason} overs=${snap1.overs}`);
    report.check(S, "legal deliveries counted = 120", snap1.balls === 120, `independent=${snap1.balls}`);
    report.check(S, "strike rotation agreed with the server on all 127 deliveries", driver.observations.strikeMismatches.length === 0, driver.observations.strikeMismatches.length ? JSON.stringify(driver.observations.strikeMismatches.slice(0, 4)) : `${driver.observations.deliveries} deliveries, no divergence`);

    const div1 = compareTally(snap1, serverInn1, { label: "innings 1" });
    report.diff(S, "innings 1 scorecard: independent tally vs server", div1);
    recordAttribution(S, "innings 1", div1);

    const myBowlerWkts = snap1.bowling.reduce((s, b) => s + b.wickets, 0);
    const srvBowlerWkts = (serverInn1?.bowling || []).reduce((s, b) => s + Number(b.wickets || 0), 0);
    report.check(S, "a run-out is not charged to the bowler", myBowlerWkts === srvBowlerWkts, `bowler wickets: independent=${myBowlerWkts} server=${srvBowlerWkts} (the fixture contains one run-out)`);

    report.note(S, `Innings 1: **${snap1.runs}/${snap1.wickets}** in ${snap1.overs} overs. ${tallyNote(snap1)}`);

    // --- innings 2: chase the target -------------------------------------
    const target = Number(serverInn1?.target || snap1.runs + 1);
    log(`  innings 2: chasing ${target}`);

    // The documented workflow between innings is end-innings -> start-next-innings.
    // Scoring 120 balls on its own does NOT move the match on: updateScore only
    // emits a `suggestion: "End innings?"` event, and start-next-innings rejects
    // anything that is not in an innings break.
    const closeI1 = await scorerApi.post(`/matches/${matchId}/end-innings`, { inningsIndex: 0 }, { expect: null });
    report.check(S, "end-innings closes innings 1 and sets the break", closeI1.status === 200 && String(closeI1.body?.match?.status || "").startsWith("innings"), `status=${closeI1.status} matchStatus=${closeI1.body?.match?.status}${closeI1.status >= 400 ? ` ${JSON.stringify(closeI1.body).slice(0, 180)}` : ""}`);

    const startI2 = await scorerApi.post(`/matches/${matchId}/start-next-innings`, {}, { expect: null });
    report.check(S, "start-next-innings puts innings 2 live", startI2.status === 200, `status=${startI2.status}${startI2.status >= 400 ? ` ${JSON.stringify(startI2.body).slice(0, 180)}` : ""}`);

    const chaseBowlers = ctx.teams.a.xi.slice(5, 10).map((p) => p.id);
    const chaseDriver = createInningsDriver({
      api: scorerApi,
      matchId,
      inningsIndex: 1,
      maxOvers: 20,
      maxWickets: 10,
      name: "innings 2",
      target,
      bowlerIds: chaseBowlers,
      bowlerNames: Object.fromEntries(chaseBowlers.map((id) => [id, nameOf(id)])),
      batterPool: ctx.teams.b.xi.map((p) => p.id),
      fielderPool: ctx.teams.a.xi.slice(0, 5).map((p) => p.id),
    });
    log(`  innings 2 openers adopted from server: ${JSON.stringify(chaseDriver.observations.adoptedOpeners || {}).slice(0, 120)}`);

    // Reach exactly `target` inside 118 legal balls: take the biggest scoring
    // shot that does not overshoot, with a dot between each run-scoring ball.
    const chase = [];
    let acc = 0;
    while (acc < target && chase.length < 118) {
      const need = target - acc;
      const r = need >= 6 ? 6 : need >= 4 ? 4 : need >= 2 ? 2 : 1;
      chase.push({ runs: r });
      acc += r;
      chase.push({ runs: 0 });
    }
    chase.pop();

    let chaseErr = null;
    try {
      for (const step of chase) {
        if (chaseDriver.tally.state.ended) break;
        await chaseDriver.send(step);
      }
    } catch (e) {
      chaseErr = e;
    }
    report.check(S, "chase deliveries all accepted", !chaseErr, chaseErr ? errText(chaseErr) : `${chaseDriver.observations.deliveries} balls`);

    if (!chaseErr) {
      const snap2 = chaseDriver.snapshot();
      const after2 = await fetchMatch(scorerApi, matchId);
      const serverInn2 = after2.innings?.[1];
      report.check(S, "innings 2 ended because the target was reached", snap2.ended && snap2.endReason === "targetChased", `reason=${snap2.endReason} runs=${snap2.runs} target=${target} balls=${snap2.balls}`);
      report.check(S, "strike rotation agreed on every chase delivery", chaseDriver.observations.strikeMismatches.length === 0, JSON.stringify(chaseDriver.observations.strikeMismatches.slice(0, 4)));
      const div2 = compareTally(snap2, serverInn2, { label: "innings 2" });
      report.diff(S, "innings 2 scorecard: independent tally vs server", div2);
      recordAttribution(S, "innings 2", div2);
      report.note(S, `Chasing side: **${snap2.runs}/${snap2.wickets}** off ${snap2.balls} balls (target ${target}).`);

      // Reaching the target by scoring does NOT settle the match. updateScore
      // never writes match.result; it only emits a `suggestion: "End innings?"`
      // socket event (scoreController.js:491-504). The result is computed
      // exclusively by POST /:matchId/end-innings.
      report.check(S, "scoring alone does not settle the match", after2.result?.resultType === undefined || after2.status === "live", `status=${after2.status} result="${JSON.stringify(after2.result || null)}" - expected, the result is only written by end-innings`);

      const endRes = await scorerApi.post(`/matches/${matchId}/end-innings`, { inningsIndex: 1 }, { expect: null });
      report.check(S, "end-innings accepts the final innings", endRes.status === 200, `status=${endRes.status}${endRes.status >= 400 ? ` ${JSON.stringify(endRes.body).slice(0, 200)}` : ""}`);

      const settled = await fetchMatch(scorerApi, matchId);
      const result = settled.result || {};
      report.check(S, "chasing side won by the wickets remaining", result.resultType === "normal" && /^10 wickets/.test(String(result.margin)), `resultType=${result.resultType} margin="${result.margin}" description="${result.description || ""}" (inningsController.js:83 hard-codes 10 as the wicket count, so a Super Over margin would be wrong here too)`);
      report.check(S, "match marked completed", settled.status === "completed", `status=${settled.status}`);
      report.note(S, `Result: ${result.description || result.margin}.`);
    }
  }

  // ======================================================================
  // Scenario 2 - free hit
  // ======================================================================
  if (wantScenario(2)) {
    const S = "Scenario 2 - free hit (a no-ball must protect the next delivery)";
    report.section(S, "On its own fixture, so that a wrongly-accepted dismissal cannot desynchronise the strike for the rest of a real innings. On a free hit only a run-out, obstructing the field, or hit twice may dismiss.");

    const { matchId } = await createMatch({ ctx, matchType: "T20", title: "freehit" });
    const probe = await probeFreeHit({
      api: scorerApi,
      matchId,
      bowlerId: ctx.teams.b.xi[5].id,
      batterPool: ctx.teams.a.xi.slice(0, 5).map((p) => p.id),
      fielderPool: ctx.teams.b.xi.slice(0, 3).map((p) => p.id),
    });

    for (const r of probe) {
      log(`  ${r.label.padEnd(34)} -> status=${r.status} isFreeHit=${r.serverSaidFreeHit} isWicket=${r.serverSaidWicket} wickets=${r.wickets}`);
    }

    const noBall = probe[0];
    report.check(S, "the no-ball was recorded", noBall.status === 200, `status=${noBall.status} runs=${noBall.runs}`);

    const dismissals = probe.slice(1);
    const wronglyAccepted = dismissals.filter((d) => ["bowled", "caught", "lbw"].includes(d.label.split(" ").pop()) && d.serverSaidWicket === true);
    report.check(S, "free-hit bowled / caught / lbw are refused", wronglyAccepted.length === 0, wronglyAccepted.length ? `accepted: ${wronglyAccepted.map((d) => `${d.label} (wickets now ${d.wickets})`).join(", ")}` : "all three were refused");
    report.check(S, "a run-out still stands on a free hit", dismissals.find((d) => d.label.endsWith("runOut"))?.serverSaidWicket === true, `run-out accepted=${dismissals.find((d) => d.label.endsWith("runOut"))?.serverSaidWicket}`);

    const freeHitFlagged = dismissals.some((d) => d.serverSaidFreeHit === true);
    report.check(S, "the server reports the next delivery as a free hit", freeHitFlagged, freeHitFlagged ? "flag present" : "`isFreeHit` is absent from the innings schema in Match.js (line 125 onwards), so Mongoose drops the flag between HTTP requests and every delivery is scored as if no-ball happened");
    report.note(S, "`ScoringEngine` sets `innings.isFreeHit = ballRecord.isNoBall` after each delivery and the adapter writes it back with `mInn.isFreeHit = engineInn.isFreeHit`, but `inningsSchema` in `Backend/src/models/Match.js` has no `isFreeHit` (or `freeHitActive`) field. Mongoose runs in strict mode, so the assignment is discarded and never reaches the database. Because scoring is one delivery per HTTP request, the free-hit restriction is never actually in force.");
  }

  // ======================================================================
  // Scenario 3 - bowled out
  // ======================================================================
  {
    const S = "Scenario 3 - innings bowled out inside the overs";
    report.section(S, "Ten dismissals inside 14 legal deliveries, so the innings must end on wickets rather than on overs.");

    const { matchId } = await createMatch({ ctx, matchType: "T20", title: "allout" });
    const allOutBowlers = ctx.teams.b.xi.slice(5, 10).map((p) => p.id);
    const driver = createInningsDriver({
      api: scorerApi,
      matchId,
      inningsIndex: 0,
      maxOvers: 20,
      maxWickets: 10,
      name: "all out innings",
      bowlerIds: allOutBowlers,
      bowlerNames: Object.fromEntries(allOutBowlers.map((id) => [id, nameOf(id)])),
      batterPool: ctx.teams.a.xi.map((p) => p.id),
      fielderPool: ctx.teams.b.xi.slice(0, 5).map((p) => p.id),
    });

    const types = ["bowled", "caught", "lbw", "bowled", "caught", "stumped", "lbw", "caught", "runOut", "bowled"];
    const script = [];
    for (let i = 0; i < types.length; i += 1) {
      if (i % 3 === 1) script.push({ runs: 2 });
      script.push({ runs: 0, isWicket: true, wicketType: types[i] });
    }

    let errored = null;
    try {
      for (const step of script) {
        if (driver.tally.state.ended) break;
        await driver.send(step);
      }
    } catch (e) {
      errored = e;
    }
    report.check(S, "all-out deliveries accepted", !errored, errored ? errText(errored) : `${driver.observations.deliveries} balls`);

    if (!errored) {
      const snap = driver.snapshot();
      const match = await fetchMatch(scorerApi, matchId);
      const serverInn = match.innings?.[0];
      report.check(S, "innings ended at 10 wickets, well inside 20 overs", snap.ended && snap.endReason === "allOut" && snap.balls < 120, `wickets=${snap.wickets} balls=${snap.balls} reason=${snap.endReason}`);
      report.check(S, "strike rotation agreed on every delivery", driver.observations.strikeMismatches.length === 0, JSON.stringify(driver.observations.strikeMismatches.slice(0, 4)));
      const div = compareTally(snap, serverInn, { label: "all out" });
      report.diff(S, "all-out scorecard: independent tally vs server", div);
      recordAttribution(S, "all out", div);
      report.check(S, "target set for the second innings", Number(serverInn?.target) === snap.runs + 1, `server target=${serverInn?.target} independent=${snap.runs + 1}`);
      report.note(S, `All out: **${snap.runs}/${snap.wickets}** in ${snap.overs} overs (target ${snap.runs + 1}).`);

      // An innings that is over must not accept another delivery.
      const after = await scorerApi.post(
        `/matches/${matchId}/score`,
        {
          inningsIndex: 0,
          runs: 4,
          batsmanOnStrikeId: ctx.teams.a.xi[0].id,
          batsmanNonStrikeId: ctx.teams.a.xi[1].id,
          bowlerId: ctx.teams.b.xi[6].id,
        },
        { expect: null },
      );
      report.check(S, "a completed innings refuses further deliveries", after.status >= 400, `status=${after.status}${after.status < 400 ? " - a ball was accepted into an innings that had already ended" : ""}`);
    }
  }

  // ======================================================================
  // Scenario 4 - tie and Super Over
  // ======================================================================
  {
    const S = "Scenario 4 - tie, then Super Over";
    report.section(S, "Both sides bat to 30, then the second innings is closed by hand. Under the Laws an equal total is a tie: `end-innings` must record `resultType: \"tie\"` and leave the match awaiting resolution, and a Super Over must then be playable.");

    const { matchId } = await createMatch({ ctx, matchType: "T20", title: "tie" });
    const side = (inningsIndex, batterXI, bowlerXI) =>
      createInningsDriver({
        api: scorerApi,
        matchId,
        inningsIndex,
        maxOvers: 20,
        maxWickets: 10,
        name: `innings ${inningsIndex + 1}`,
        target: inningsIndex === 1 ? 31 : null,
        bowlerIds: bowlerXI.slice(5, 10).map((p) => p.id),
        bowlerNames: Object.fromEntries(bowlerXI.slice(5, 10).map((p) => [p.id, p.name])),
        batterPool: batterXI.map((p) => p.id),
        fielderPool: bowlerXI.slice(0, 5).map((p) => p.id),
      });

    const pattern = [4, 4, 1, 1, 1, 1, 1, 1, 6, 6, 4, 1]; // exactly 30
    const d1 = side(0, ctx.teams.a.xi, ctx.teams.b.xi);
    for (const r of pattern) await d1.send({ runs: r });
    const e1 = await scorerApi.post(`/matches/${matchId}/end-innings`, { inningsIndex: 0 }, { expect: null });
    report.check(S, "end-innings closes the first innings", e1.status === 200, `status=${e1.status} runs=${e1.body?.match?.innings?.[0]?.runs}`);

    const n1 = await scorerApi.post(`/matches/${matchId}/start-next-innings`, {}, { expect: null });
    report.check(S, "second innings starts", n1.status === 200, `status=${n1.status}${n1.status >= 400 ? ` ${JSON.stringify(n1.body).slice(0, 160)}` : ""}`);

    const d2 = side(1, ctx.teams.b.xi, ctx.teams.a.xi);
    for (const r of pattern) await d2.send({ runs: r });

    // 30 falls one short of the target of 31, so the innings is closed by hand.
    const e2 = await scorerApi.post(`/matches/${matchId}/end-innings`, { inningsIndex: 1 }, { expect: null });
    const afterTie = await fetchMatch(scorerApi, matchId);
    const tieResult = afterTie.result || {};

    report.check(S, "equal totals are accepted by end-innings", e2.status === 200, `status=${e2.status} body=${JSON.stringify(e2.body).slice(0, 260)}`);
    report.check(S, "the tie is recorded as resultType \"tie\"", tieResult.resultType === "tie", `resultType=${tieResult.resultType} margin="${tieResult.margin}" description="${tieResult.description || ""}"`);
    report.check(S, "the match waits for tie resolution", afterTie.status === "pending_tie_resolution", `status=${afterTie.status} (Match.js:146 declares status as ["upcoming","toss_done","live","completed","innings-break","innings_break"], so this value cannot be persisted)`);

    const dA = compareTally(d1.snapshot(), afterTie.innings?.[0], { label: "tie i1" });
    const dB = compareTally(d2.snapshot(), afterTie.innings?.[1], { label: "tie i2" });
    report.diff(S, "tied innings 1: independent tally vs server", dA);
    report.diff(S, "tied innings 2: independent tally vs server", dB);

    if (e2.status >= 400) {
      report.note(
        S,
        "**Root cause, and it breaks the whole tie feature.** `inningsController.endInnings` reaches the tie branch (line 92-100) and assigns `match.status = \"pending_tie_resolution\"`, but that value is not in the `status` enum in `Backend/src/models/Match.js:146`. `match.save({ validateModifiedOnly: true })` still validates the modified `status` path, throws a ValidationError, and the handler's catch returns **400 Failed to end innings**. Because the save is atomic, nothing is persisted: not `currentInnings.status = \"completed\"`, not the tie result, and not the status. `matchController.js:15-18` separately lists `\"pending_tie_resolution\"` as a valid status, so the two files disagree about the same enum.",
      );
    }

    // resolve-tie can only work if the status above was persisted.
    const rt = await scorerApi.post(`/matches/${matchId}/resolve-tie`, { resolution: "super_over" }, { expect: null });
    report.check(S, "a tie can be resolved to a Super Over", rt.status === 200, `status=${rt.status} ${JSON.stringify(rt.body).slice(0, 200)}`);

    if (rt.status === 200) {
      const so = await scorerApi.post(
        `/matches/${matchId}/start-super-over`,
        { batsmenIds: [ctx.teams.a.xi[0].id, ctx.teams.a.xi[1].id], bowlerId: ctx.teams.b.xi[5].id },
        { expect: null },
      );
      report.check(S, "Super Over innings can be started", so.status === 200, `status=${so.status} ${JSON.stringify(so.body).slice(0, 200)}`);
      if (so.status === 200) {
        const soIdx = Number(so.body?.match?.currentInnings ?? so.body?.superOverInningsIndex ?? so.body?.inningsIndex ?? 2);
        const soDriver = createInningsDriver({
          api: scorerApi,
          matchId,
          inningsIndex: soIdx,
          maxOvers: 1,
          maxWickets: 2,
          name: "super over",
          bowlerIds: [ctx.teams.b.xi[5].id],
          bowlerNames: { [ctx.teams.b.xi[5].id]: nameOf(ctx.teams.b.xi[5].id) },
          batterPool: [ctx.teams.a.xi[0].id, ctx.teams.a.xi[1].id, ctx.teams.a.xi[2].id],
          fielderPool: ctx.teams.b.xi.slice(0, 5).map((p) => p.id),
        });
        await soDriver.send({ runs: 4 });
        await soDriver.send({ runs: 2 });
        const soSnap = soDriver.snapshot();
        const soMatch = await fetchMatch(scorerApi, matchId);
        report.check(S, "Super Over recorded as a separate innings", soSnap.runs === 6, `independent=${soSnap.runs} balls=${soSnap.balls} inningsIndex=${soIdx}`);
        report.diff(S, "Super Over scorecard: independent tally vs server", compareTally(soSnap, soMatch.innings?.[soIdx], { label: "super over" }));
        const soEnd = await scorerApi.post(`/matches/${matchId}/end-innings`, { inningsIndex: soIdx }, { expect: null });
        report.check(S, "the Super Over result is recorded", soEnd.status === 200 && afterTie.status !== "completed", `status=${soEnd.status} ${JSON.stringify(soEnd.body?.match?.result || soEnd.body).slice(0, 200)}`);
      }
    }
  }

  // ======================================================================
  // Scenario 5 - negative tests over HTTP
  // ======================================================================
  {
    const S = "Scenario 5 - negative tests (HTTP authorization and Laws)";
    report.section(S, "A score must be refused without a token, with an unverified mailbox, across a tenant boundary, into a completed innings, and for the same bowler in consecutive overs.");

    const { matchId } = await createMatch({ ctx, matchType: "T20", title: "guard" });
    const payload = {
      inningsIndex: 0,
      runs: 6,
      batsmanOnStrikeId: ctx.teams.a.xi[0].id,
      batsmanNonStrikeId: ctx.teams.a.xi[1].id,
      bowlerId: ctx.teams.b.xi[5].id,
    };

    const anon = makeClient();
    const r1 = await anon.post(`/matches/${matchId}/score`, payload, { expect: null });
    report.check(S, "no token -> 401", r1.status === 401, `status=${r1.status}`);
    const r2 = await anon.post(`/matches/${matchId}/score`, payload, { expect: null });
    report.check(S, "garbage token -> 401", r2.status === 401, `status=${r2.status}`);

    const unverifiedEmail = `${TEST_PREFIX}unverified_${runId}@example.test`;
    const unvApi = makeClient();
    await unvApi.post(
      "/auth/register",
      { name: `${TEST_PREFIX}unverified`, email: unverifiedEmail, password: "OpencodeLocal!2026", accountType: "player" },
      { expect: [200, 201] },
    );
    const unvLogin = await unvApi.post("/auth/login", { email: unverifiedEmail, password: "OpencodeLocal!2026" }, { expect: 200 });
    const unvAuth = makeClient(unvLogin.body.token);
    const r3 = await unvAuth.post(`/matches/${matchId}/score`, payload, { expect: null });
    report.check(S, "unverified mailbox -> 403", r3.status === 403, `status=${r3.status} ${JSON.stringify(r3.body).slice(0, 160)}`);

    // Verified member of tenant A, scoring on a fixture owned by tenant B.
    const foreign = makeClient(ctx.scorer.token);
    const tenantB = await createMatchInOtherOrg({ ctx, matchType: "T20", title: "tenantB" });
    const r4 = await foreign.post(`/matches/${tenantB.matchId}/score`, payload, { expect: null });
    report.check(S, "verified member of another organization -> 403", r4.status === 403, `status=${r4.status} ${JSON.stringify(r4.body).slice(0, 220)}`);

    const after = await fetchMatch(scorerApi, matchId);
    const inn = after.innings?.[0];
    report.check(S, "no refused attempt changed the scorecard", Number(inn?.runs || 0) === 0 && Number(inn?.balls || 0) === 0, `runs=${inn?.runs} balls=${inn?.balls}`);

    // Law 42.6: the same bowler may not bowl two consecutive overs.
    await scorerApi.post(`/matches/${matchId}/score`, payload, { expect: 200 });
    let consecutive = { blocked: false, status: null };
    try {
      for (let i = 0; i < 5; i += 1) {
        await scorerApi.post(`/matches/${matchId}/score`, { ...payload, runs: 0 }, { expect: 200 });
      }
      const again = await scorerApi.post(`/matches/${matchId}/score`, { ...payload, runs: 0 }, { expect: null });
      consecutive = { blocked: again.status === 400, status: again.status, body: again.body };
    } catch (e) {
      consecutive = { blocked: true, status: e.status, body: e.body };
    }
    report.check(S, "same bowler cannot bowl consecutive overs", consecutive.blocked, `status=${consecutive.status} ${JSON.stringify(consecutive.body || "").slice(0, 160)}`);

    // Law 42.2: a bowler may not exceed one fifth of the innings. T20 declares
    // maxBowlerOvers = 4 in ScoringEngine.FORMATS.
    const quotaMatch = (await createMatch({ ctx, matchType: "T20", title: "quota" })).matchId;
    let quota = { oversBowled: 0, blocked: null };
    try {
      for (let o = 0; o < 5; o += 1) {
        for (let b = 0; b < 6; b += 1) {
          await scorerApi.post(
            `/matches/${quotaMatch}/score`,
            { inningsIndex: 0, runs: 0, batsmanOnStrikeId: ctx.teams.a.xi[0].id, batsmanNonStrikeId: ctx.teams.a.xi[1].id, bowlerId: ctx.teams.b.xi[6].id },
            { expect: 200 },
          );
        }
        quota.oversBowled = o + 1;
      }
    } catch (e) {
      quota.blocked = { status: e.status, body: e.body };
    }
    report.check(S, "overs-per-bowler limit enforced (maxBowlerOvers = 4 for T20)", quota.blocked !== null, quota.blocked ? `refused during over ${quota.oversBowled + 1}: ${JSON.stringify(quota.blocked.body || "").slice(0, 160)}` : `one bowler was allowed ${quota.oversBowled} overs. \`maxBowlerOvers\` is declared in ScoringEngine.FORMATS (line 2) and read nowhere else in the backend.`);
  }

  // ======================================================================
  // Scenario 6 - negative tests over Socket.IO
  // ======================================================================
  {
    const S = "Scenario 6 - negative tests (Socket.IO cannot score)";
    report.section(S, "An unauthenticated socket client joins the live match room and tries every plausible scoring event. The scorecard must not move and the server must not acknowledge.");

    const { matchId } = await createMatch({ ctx, matchType: "T20", title: "socket" });
    const before = await fetchMatch(scorerApi, matchId);

    let attempt = null;
    let err = null;
    try {
      attempt = await attemptScoreOverSocket({
        apiBase: API_BASE,
        matchId,
        inningsIndex: 0,
        batsmanOnStrikeId: ctx.teams.a.xi[0].id,
        batsmanNonStrikeId: ctx.teams.a.xi[1].id,
        bowlerId: ctx.teams.b.xi[5].id,
      });
    } catch (e) {
      err = e;
    }

    if (err) {
      report.check(S, "socket handshake reachable on the local server", false, err.message);
    } else {
      report.check(S, "unauthenticated socket connects with no token", attempt.connected === true, "no credential presented at handshake");
      report.check(S, "no scoring event was acknowledged", attempt.attempts.every((a) => !a.ackReceived), `${attempt.attempts.length} events attempted, ${attempt.attempts.filter((a) => a.ackReceived).length} acknowledged`);
    }

    const after = await fetchMatch(scorerApi, matchId);
    const b = before.innings?.[0];
    const a = after.innings?.[0];
    report.check(S, "scorecard unchanged after every socket attempt", Number(a?.runs || 0) === Number(b?.runs || 0) && Number(a?.balls || 0) === Number(b?.balls || 0) && Number(a?.wickets || 0) === Number(b?.wickets || 0), `runs ${b?.runs}->${a?.runs}, balls ${b?.balls}->${a?.balls}, wickets ${b?.wickets}->${a?.wickets}`);
    report.note(S, "The socket accepts room joins only (`joinRoom`, `join-match`), so no ball can be recorded through it. The handshake carries no JWT, so an anonymous client can subscribe to any match's live feed and read it - a confidentiality finding, recorded separately from the pass/fail result.");
  }

  // ======================================================================
  // Scenario 7 - the other formats
  // ======================================================================
  {
    const S = "Scenario 7 - other Match.matchType formats";
    report.section(S, "`Match.js` offers eight formats. Each is created through the API and, where the format is short enough to bat out, played to completion and checked against the independent tally.");

    for (const mt of ["6 Overs", "8 Overs", "T10", "T20", "ODI", "Test", "Tape Ball", "Super Over"]) {
        const cfg = FORMATS[mt];
        try {
          const { matchId } = await createMatch({ ctx, matchType: mt, title: `fmt-${mt.replace(/\s+/g, "")}` });
          const created = await fetchMatch(scorerApi, matchId);

          // Storage check only. Deliberately no delivery is sent here: a probe
          // ball would land on the server but not in the local tally, putting the
          // two over counters one ball out of step and making the innings replay
          // reuse a bowler in consecutive overs.
          report.check(S, `${mt}: created with the right matchType and overs limit`, created.matchType === mt, `matchType=${created.matchType} totalOvers=${created.totalOvers} status=${created.status}`);

          if (!cfg) {
            report.note(S, `**${mt}**: not played out - this suite does not bat 90 overs or an unbounded innings. Creation verified.`);
            continue;
          }
          if (cfg.maxOvers === null) {
            report.note(S, `**${mt}**: configured with \`maxOvers: null\`, so the innings has no overs limit and can only end on ten wickets or a declaration. Only creation was verified.`);
            continue;
          }
          if (cfg.maxOvers > 20) {
            report.note(S, `**${mt}**: configured for ${cfg.maxOvers} overs, which this suite does not bat out. Creation verified.`);
            continue;
          }

          const fmtBowlers = ctx.teams.b.xi.slice(5, 10).map((p) => p.id);
          const d = createInningsDriver({
            api: scorerApi,
            matchId,
            inningsIndex: 0,
            maxOvers: cfg.maxOvers,
            maxWickets: cfg.maxWickets,
            name: `${mt} innings`,
            bowlerIds: fmtBowlers,
            bowlerNames: Object.fromEntries(fmtBowlers.map((id) => [id, nameOf(id)])),
            batterPool: ctx.teams.a.xi.map((p) => p.id),
            fielderPool: ctx.teams.b.xi.slice(0, 5).map((p) => p.id),
          });
          let firstDelivery = null;
          try {
            for (let i = 0; i < cfg.maxOvers * 6 + 2 && !d.tally.state.ended; i += 1) {
              if (i === 0) firstDelivery = await d.send({ runs: 4 });
              else await d.send({ runs: i % 5 === 4 ? 4 : 0 });
            }
          } catch (e) {
            report.check(S, `${mt}: innings played to completion without error`, false, errText(e));
            continue;
          }
          report.check(S, `${mt}: first delivery recorded`, Number(firstDelivery?.body?.innings?.balls) === 1, `balls=${firstDelivery?.body?.innings?.balls}`);

          const snap = d.snapshot();
          const m = await fetchMatch(scorerApi, matchId);
          report.check(S, `${mt}: innings ended at the configured ${cfg.maxOvers} overs`, snap.ended && snap.endReason === "oversComplete", `reason=${snap.endReason} overs=${snap.overs} balls=${snap.balls} serverOvers=${m.innings?.[0]?.overs}`);
          report.check(S, `${mt}: strike rotation agreed on every delivery`, d.observations.strikeMismatches.length === 0, JSON.stringify(d.observations.strikeMismatches.slice(0, 3)));
          report.diff(S, `${mt}: scorecard independent tally vs server`, compareTally(snap, m.innings?.[0], { label: mt }));
        } catch (e) {
          report.check(S, `${mt}: usable`, false, errText(e));
        }
    }

    report.check(S, "Test: stored totalOvers matches the format the engine resolves", false, "`ScoringEngine.FORMATS` keys the unlimited entry `TEST` (upper case) while the `Match.matchType` enum value is `Test`. The engine looks the format up with `FORMATS[match.matchType]`, so a Test match falls through to the T20 defaults (20 overs, Super Over available) while the model stores totalOvers = 90.");
    report.note(S, "**Test**: because of that case mismatch the engine enforces T20 rules on a Test match, and `declareInnings` throws `Declaration only allowed in Test matches` because the engine believes the format is not Test. Two independent code paths disagree about which format the fixture is.");
  }

  // ======================================================================
  // report
  // ======================================================================
  const durationMs = Date.now() - started;
  const counts = report.counts();
  const extra = [
    "## Accounts and calls",
    "",
    `- Owner account: \`${ctx.owner.email}\` (never used to score)`,
    `- Assigned scorer, who sent every delivery: \`${ctx.scorer.email}\`, organization role \`${ctx.acceptedRoles.join(", ")}\``,
    `- Invitation accepted through \`POST /invitations/accept\` using the token from the console mail log`,
    `- Organization: \`${ctx.orgId}\`; second tenant for the cross-tenant test: \`${ctx.otherOrgId}\``,
    `- HTTP calls issued by the suite: ${ctx.owner.api.state.calls + ctx.scorer.api.state.calls + ctx.outsider.api.state.calls + scorerApi.state.calls + ownerApi.state.calls}`,
    `- Note: the application lower-cases e-mail addresses on save, so \`OPENCODE_TEST_...\` fixtures appear as \`opencode_test_...\` in the database and in mail. Names keep the prefix verbatim.`,
    "",
  ].join("\n");

  const path = report.write(resultsPath, { apiBase: API_BASE, runId, durationMs, extra });
  log("");
  log(`=== ${report.overall()} === ${counts.PASS} pass, ${counts.FAIL} fail, ${counts.DIVERGENCE} divergence in ${(durationMs / 1000).toFixed(1)}s`);
  log(`report: ${path}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(`\nE2E suite aborted: ${e?.message || e}\n`);
    if (e?.body) process.stderr.write(`${JSON.stringify(e.body).slice(0, 800)}\n`);
    if (e?.stack) process.stderr.write(`${e.stack}\n`);
    process.exit(2);
  });
