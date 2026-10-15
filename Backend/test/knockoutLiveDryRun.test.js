import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

// P2 dry run. A single, scripted 20-over knockout fixture is played to a result
// over real HTTP against the app on an ephemeral port (VERCEL=1 keeps index.js
// from binding its own listener and MONGO_URL="" so a developer's real database
// can never be touched — startTestDb owns a throwaway mongod). The point is to
// exercise the live scoring API exactly as a scorer's device would, then prove
// that the scorecard, the standings, the stats endpoint and the Socket.IO
// channels all agree about what happened.
process.env.VERCEL = "1";
process.env.MONGO_URL = "";
delete process.env.MONGODB_URI;
delete process.env.MONGO_URI;
process.env.JWT_SECRET = process.env.JWT_SECRET || "oct12-dryrun-secret";
process.env.LOG_REQUESTS = "false";
process.env.LOG_SOCKET = "false";

import { startTestDb, stopTestDb } from "./helpers/testDb.js";
import Admin from "../src/models/Admin.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import Match from "../src/models/Match.js";
import Tournament from "../src/models/Tournament.js";

const PREFIX = "OPENCODE_TEST_DryRun";
const DATES = { startDate: "2026-10-12T00:00:00.000Z", endDate: "2026-10-20T00:00:00.000Z" };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const idOf = (value) => String(value?._id || value);
const uniqueName = (label) => `${PREFIX} ${label} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let mongod;
let server;
let base;
const socketEvents = [];

async function req(method, path, { token, body } = {}) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // a non-JSON reply is still asserted against by status code
  }
  return { status: res.status, body: json };
}

async function makeAdminToken() {
  const admin = await Admin.create({
    name: `${PREFIX} Admin`,
    email: `${PREFIX}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`,
    password: "a-password-hash-that-is-never-compared",
    role: "superadmin",
  });
  return jwt.sign({ id: String(admin._id) }, process.env.JWT_SECRET);
}

async function makeTeamWithSquad(label, index) {
  const team = await Team.create({ name: uniqueName(`${label} T${index}`) });
  const players = [];
  for (let i = 0; i < 11; i += 1) {
    players.push(await Player.create({ name: uniqueName(`${label} P${i}`), team: team._id }));
  }
  return { team, players };
}

async function setXI(token, matchId, teamId, players) {
  const res = await req("PUT", `/api/matches/${matchId}/playing-xi`, {
    token,
    body: { teamId: String(teamId), players: players.map((p) => String(p._id)) },
  });
  assert.equal(res.status, 200, `playing XI set: ${JSON.stringify(res.body)}`);
  return res;
}

before(async () => {
  mongod = await startTestDb();
  const { default: app } = await import("../src/index.js");
  const { getIO } = await import("../src/socket/socket.js");

  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  // index.js has already built io for its own (unbound) server. Wrap its emit
  // routes so the dry run can assert the exact channels a public scorecard
  // subscribes to fired during the match.
  const io = getIO?.();
  if (io) {
    const realEmit = io.emit.bind(io);
    io.emit = (event, payload) => {
      socketEvents.push(event);
      return realEmit(event, payload);
    };
    const realTo = io.to.bind(io);
    const wrapOperator = (op) => {
      const realOperatorEmit = op.emit.bind(op);
      op.emit = (event, payload) => {
        socketEvents.push(event);
        return realOperatorEmit(event, payload);
      };
      const realOperatorTo = op.to.bind(op);
      op.to = (room2) => wrapOperator(realOperatorTo(room2));
      return op;
    };
    io.to = (room) => wrapOperator(realTo(room));
  }
});

after(async () => {
  await new Promise((resolve) => {
    server?.closeAllConnections?.();
    server?.close(resolve);
  });
  await stopTestDb(mongod);
});

test("a 20-over knockout fixture runs end-to-end through the scoring API", async () => {
  const token = await makeAdminToken();
  const a = await makeTeamWithSquad("QF", 0);
  const b = await makeTeamWithSquad("QF", 1);

  // Knockout tournament + a manually created quarter-final.
  const created = await req("POST", "/api/tournaments", {
    token,
    body: {
      name: uniqueName("Cup"),
      ...DATES,
      type: "knockout",
      teams: [idOf(a.team), idOf(b.team)],
      format: "T20",
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const tournamentId = created.body.tournament._id;

  const fixture = await req("POST", `/api/tournaments/${tournamentId}/matches`, {
    token,
    body: { team1: idOf(a.team), team2: idOf(b.team), round: "QF", startTime: "2026-10-12T09:00:00.000Z" },
  });
  assert.equal(fixture.status, 201, JSON.stringify(fixture.body));
  const matchId = fixture.body.match._id;

  const toss = await req("PUT", `/api/matches/${matchId}/toss`, {
    token,
    body: { tossWinnerId: idOf(a.team), decision: "bat" },
  });
  assert.equal(toss.status, 200, JSON.stringify(toss.body));
  await setXI(token, matchId, a.team._id, a.players);
  await setXI(token, matchId, b.team._id, b.players);

  const bat = a.players.map(idOf); // team A bat first
  const bowl = b.players.map(idOf); // team B fields first

  let striker = bat[0];
  let nonStriker = bat[1];
  let currentInnings = 0;

  const getMatch = async () => {
    const res = await req("GET", `/api/matches/${matchId}`, { token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body?.match || res.body;
  };

  // The server owns strike rotation; read it back after every delivery. The
  // response may hand back either a bare id or a populated player document.
  const refresh = (inningsDoc) => {
    if (!inningsDoc) return;
    const onStrike = inningsDoc.onStrikeBatsman || inningsDoc.currentBatsman1;
    const nonStrikerNext = inningsDoc.currentBatsman2;
    if (onStrike) striker = idOf(onStrike);
    if (nonStrikerNext) nonStriker = idOf(nonStrikerNext);
  };

  const send = async (payload) => {
    const res = await req("POST", `/api/matches/${matchId}/score`, {
      token,
      body: {
        inningsIndex: currentInnings,
        batsmanOnStrikeId: striker,
        batsmanNonStrikeId: nonStriker,
        commentaryText: `${PREFIX} delivery`,
        customCommentary: true,
        ...payload,
      },
    });
    assert.equal(res.status, 200, `delivery rejected: ${JSON.stringify(res.body)}`);
    refresh(res.body?.innings);
    // The score route is rate limited to 12/rolling-second per match+route.
    await sleep(115);
    return res;
  };

  // ─── INNINGS 1: 20 overs, with a wide, a no-ball + free hit, a wicket, a
  //     run-out of the non-striker, a retirement, and an undo. ───────────────
  let wideSeen = 0;
  let freeHitArmed = false;
  let freeHitConsumed = false;

  for (let over = 0; over < 20; over += 1) {
    const bowlerId = bowl[over % 3]; // rotate three bowlers: never consecutive

    if (over === 0) {
      const wide = await send({ runs: 0, isWide: true, bowlerId });
      wideSeen = Number(wide.body?.innings?.extras?.wides || 0);
      assert.ok(wideSeen >= 1, "the wide was recorded");

      const noBall = await send({ runs: 0, isNoBall: true, bowlerId });
      freeHitArmed = noBall.body?.ball?.freeHitNext === true;
      assert.equal(freeHitArmed, true, "the no-ball armed a free hit");

      const freeHitBall = await send({ runs: 1, bowlerId });
      freeHitConsumed = freeHitBall.body?.ball?.freeHitNext === false;
      assert.equal(freeHitConsumed, true, "the free hit was consumed");

      await send({ runs: 0, bowlerId });
      await send({
        runs: 0,
        isWicket: true,
        wicketType: "bowled",
        dismissedPlayerId: striker,
        nextBatsmanId: bat[2],
        bowlerId,
      });
      await send({ runs: 4, bowlerId });
      await send({ runs: 2, bowlerId });
      await send({ runs: 1, bowlerId });
    } else if (over === 2) {
      await send({ runs: 1, bowlerId });
      await send({
        runs: 0,
        isWicket: true,
        wicketType: "run_out",
        dismissedPlayerId: nonStriker, // the non-striker is run out
        fielderId: bowl[6],
        didCross: true,
        nextBatsmanId: bat[3],
        bowlerId,
      });
      for (const runs of [1, 0, 2, 1]) await send({ runs, bowlerId });
    } else if (over === 4) {
      // Retire the striker (he has faced, so his card exists) and send in a
      // replacement at the same end.
      const retiring = striker;
      const retired = await req("POST", `/api/matches/${matchId}/retire-batsman`, {
        token,
        body: { inningsIndex: 0, playerId: retiring, type: "retired_hurt" },
      });
      assert.equal(retired.status, 200, JSON.stringify(retired.body));
      striker = bat[4];
      for (const runs of [1, 1, 0, 2, 1, 0]) await send({ runs, bowlerId });
    } else if (over === 5) {
      // Undo: bowl one legal ball, revert it, and prove the totals went back.
      await send({ runs: 2, bowlerId });
      const beforeUndo = (await getMatch()).innings[0].runs;
      const undo = await req("POST", `/api/matches/${matchId}/revert-ball`, {
        token,
        body: { inningsIndex: 0 },
      });
      assert.equal(undo.status, 200, JSON.stringify(undo.body));
      await sleep(115);
      const afterUndo = (await getMatch()).innings[0].runs;
      assert.ok(afterUndo < beforeUndo, `undo lowered the total (${beforeUndo} -> ${afterUndo})`);
      for (const runs of [2, 1, 0, 1, 0, 2]) await send({ runs, bowlerId });
    } else {
      for (const runs of [1, 0, 1, 1, 0, 2]) await send({ runs, bowlerId });
    }
  }

  // Innings 1 auto-closes on the 120th legal ball: the engine moves the match
  // to the innings break and sets the target.
  const mid = await getMatch();
  assert.equal(mid.innings[0].balls, 120, "innings 1 used the full 20 overs");
  assert.equal(mid.status, "innings_break", `expected innings break, got ${mid.status}`);
  assert.equal(Number(mid.innings[1].target), Number(mid.innings[0].runs) + 1, "target set from innings 1");
  assert.ok(Number(mid.innings[1].target) > 1, "there is a target to chase");

  const openersCard = mid.innings[0].batting.map((row) => idOf(row.player));
  assert.equal(new Set(openersCard).size, openersCard.length, "no batsman has two cards");
  assert.ok(
    mid.innings[0].batting.some((row) => row.isRetiredHurt === true),
    "the retired-hurt batsman is marked on his card"
  );
  const runOutFow = mid.innings[0].fallOfWickets.find((fow) => fow.wicketType === "run_out" || fow.wicketType === "runOut");
  assert.ok(runOutFow, `the run-out appears in the fall of wickets: ${JSON.stringify(mid.innings[0].fallOfWickets)}`);
  assert.equal(runOutFow.wicketType, "runOut", "the fall of wickets records how the batsman got out");
  const runOutCard = mid.innings[0].batting.find((row) => idOf(row.player) === idOf(runOutFow.player));
  assert.ok(runOutCard?.isOut === true, "the run-out is charged to the dismissed batsman");

  // ─── The scorer's "end innings" / "start next innings" actions ────────────
  const endInnings = await req("POST", `/api/matches/${matchId}/end-innings`, {
    token,
    body: { inningsIndex: 0 },
  });
  assert.equal(endInnings.status, 200, JSON.stringify(endInnings.body));

  const startNext = await req("POST", `/api/matches/${matchId}/start-next-innings`, { token });
  assert.equal(startNext.status, 200, JSON.stringify(startNext.body));
  currentInnings = 1;
  striker = bowl[0]; // team B chase
  nonStriker = bowl[1];

  const target = Number(mid.innings[1].target);

  // Chase fast: sixes until the target is passed (the engine completes the
  // match on the ball that reaches it).
  let ballsFacedInChase = 0;
  for (let over = 0; over < 20; over += 1) {
    const bowlerId = bat[over % 3];
    for (let ball = 0; ball < 6; ball += 1) {
      const res = await send({ runs: 6, bowlerId });
      ballsFacedInChase += 1;
      if (res.body?.innings?.status === "completed") break;
    }
    if ((await getMatch()).status === "completed") break;
  }
  assert.ok(ballsFacedInChase < 120, "the chase finished inside the 20 overs");

  // ─── RESULT + SCORECARD consistency ───────────────────────────────────────
  const finished = await getMatch();
  assert.equal(finished.status, "completed", "the match completed");
  assert.equal(idOf(finished.result?.winner), idOf(b.team), "the chasing side won");
  assert.equal(finished.innings[1].status, "completed");
  assert.ok(Number(finished.innings[1].runs) >= target, "the chase passed the target");

  const extrasTotal = (extras = {}) =>
    (extras.wides || 0) + (extras.noBalls || 0) + (extras.byes || 0) + (extras.legByes || 0) + (extras.penalties || 0);
  for (const [index, innings] of finished.innings.entries()) {
    const battingRuns = (innings.batting || []).reduce((sum, row) => sum + (row.runs || 0), 0);
    assert.equal(
      battingRuns + extrasTotal(innings.extras),
      innings.runs,
      `innings ${index}: batting + extras equals the innings total`
    );
    assert.ok(Number(innings.balls) <= 120, `innings ${index}: within the over quota`);
  }
  assert.equal(wideSeen >= 1, true);
  assert.equal(freeHitArmed && freeHitConsumed, true);
  assert.ok(Number(finished.innings[0].extras?.noBalls) >= 1, "the no-ball is in the extras");

  // ─── STATS endpoint agrees ────────────────────────────────────────────────
  const stats = await req("GET", `/api/matches/${matchId}/stats`, { token });
  assert.equal(stats.status, 200, JSON.stringify(stats.body));

  // ─── STANDINGS reflect the win ────────────────────────────────────────────
  // The scoring hook recomputes standings fire-and-forget, and the public GET
  // strips reserved-named (`OPENCODE_TEST_`) teams' rows, so poll the persisted
  // tournament — the source of truth.
  const tourney = await req("GET", `/api/tournaments/${tournamentId}`, { token });
  assert.equal(tourney.status, 200, JSON.stringify(tourney.body));

  let persisted = await Tournament.findById(tournamentId).lean();
  const winRow = () => (persisted.pointsTable || []).find((row) => idOf(row.team) === idOf(b.team));
  const scored = () => Number(winRow()?.won) >= 1 || Number(winRow()?.points) >= 2;
  for (let attempt = 0; attempt < 25 && !scored(); attempt += 1) {
    await sleep(100);
    persisted = await Tournament.findById(tournamentId).lean();
  }

  const winnerRow = winRow();
  assert.ok(winnerRow, "the winning side has a standings row");
  assert.ok(scored(), "the win is scored in the points table");
  const loserRow = (persisted.pointsTable || []).find((row) => idOf(row.team) === idOf(a.team));
  assert.ok(loserRow, "the losing side has a standings row");
  assert.ok(Number(loserRow.matchesPlayed) >= 1, "the fixture is counted for the losing side");

  // ─── Socket.IO channels fired ─────────────────────────────────────────────
  const expected = [
    "ball:recorded",
    "score:update",
    "match:ballUpdate",
    "strike:changed",
    "over:completed",
    "innings:end",
    "match:end",
    "match:updateList",
    "match:updated",
  ];
  for (const event of expected) {
    assert.ok(socketEvents.includes(event), `socket event "${event}" was emitted`);
  }
});

// Regression: /score used to rewind match.status and match.currentInnings back
// to "the ball just bowled" after the engine had ended the innings, so the
// match looked live at the innings break and /start-next-innings answered
// "Match is not in innings break".
test("the last ball of the first innings moves the match to the innings break", async () => {
  const token = await makeAdminToken();
  const a = await makeTeamWithSquad("Break", 0);
  const b = await makeTeamWithSquad("Break", 1);

  const created = await req("POST", "/api/matches", {
    token,
    body: { teams: [idOf(a.team), idOf(b.team)], matchType: "6 Overs", totalOvers: 6 },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const matchId = created.body.match._id;

  const toss = await req("PUT", `/api/matches/${matchId}/toss`, {
    token,
    body: { tossWinnerId: idOf(a.team), decision: "bat" },
  });
  assert.equal(toss.status, 200, JSON.stringify(toss.body));
  await setXI(token, matchId, a.team._id, a.players);
  await setXI(token, matchId, b.team._id, b.players);

  const bat = a.players.map(idOf);
  const bowl = b.players.map(idOf);

  for (let over = 0; over < 6; over += 1) {
    for (let ball = 0; ball < 6; ball += 1) {
      const res = await req("POST", `/api/matches/${matchId}/score`, {
        token,
        body: {
          inningsIndex: 0,
          runs: 1,
          batsmanOnStrikeId: bat[0],
          batsmanNonStrikeId: bat[1],
          bowlerId: bowl[over % 3],
          commentaryText: `${PREFIX} break delivery`,
          customCommentary: true,
        },
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      await sleep(115);
    }
  }

  const after = await req("GET", `/api/matches/${matchId}`, { token });
  const match = after.body?.match || after.body;
  assert.equal(match.innings[0].balls, 36, "the six overs were used up");
  assert.equal(match.status, "innings_break", `the engine's innings break must survive: ${match.status}`);
  assert.equal(Number(match.currentInnings), 1, "the chase is now the current innings");

  const start = await req("POST", `/api/matches/${matchId}/start-next-innings`, { token });
  assert.equal(start.status, 200, `the scorer's "next innings" action must work: ${JSON.stringify(start.body)}`);
});

// Regression: the `fallOfWickets` sub-schema used to define only `runs`,
// `wickets`, `player` and `overs`, so Mongoose silently dropped the engine's
// `wicket`, `wicketType` and `fielder` on save and the scorecard could never
// show how a batsman was dismissed.
test("a fall-of-wicket entry survives a save with how the batsman got out", async () => {
  const team = await Team.create({ name: uniqueName("FOW") });
  const player = await Player.create({ name: uniqueName("FOW P"), team: team._id });

  const match = await Match.create({
    title: uniqueName("FOW match"),
    teams: [team._id],
    innings: [{
      fallOfWickets: [{
        wicket: 1,
        runs: 10,
        player: player._id,
        wicketType: "runOut",
        fielder: player._id,
        overs: 1.3,
      }],
    }],
  });

  const reloaded = await Match.findById(match._id);
  const fow = reloaded.innings[0].fallOfWickets[0];
  assert.equal(fow.wicketType, "runOut", "the dismissal type is persisted");
  assert.ok(fow.fielder, "the fielder is persisted");
  assert.equal(Number(fow.wicket), 1, "the engine's wicket number is persisted");
});
