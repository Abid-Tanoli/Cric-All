import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import Match from "../src/models/Match.js";
import Player from "../src/models/Player.js";
import Team from "../src/models/Team.js";
import Ball from "../src/models/Ball.js";
import Delivery from "../src/models/Delivery.js";
import validate from "../src/middleware/validate.js";
import { updateScoreSchema, revertLastBallSchema } from "../src/validators/scoreValidators.js";
import { updateScore, revertLastBall } from "../src/controllers/scoreController.js";
import { __setAiCommentaryEnabledForTests } from "../src/services/aiCommentary.js";

// B6 / TRD 5.2 / 08-TEST-PLAN 2: a ball is recorded once, however many times
// the scorer's phone sends it. Every request here goes through the route's zod
// validator first, then the controller, because a field the schema does not
// declare is stripped before the controller ever sees it.

let mongod;
const ids = {};

before(async () => {
  mongod = await startTestDb();
  __setAiCommentaryEnabledForTests(false);

  const [teamA, teamB] = await Team.create([{ name: "Retry A" }, { name: "Retry B" }]);
  ids.teamA = teamA._id;
  ids.teamB = teamB._id;

  const names = ["bat1", "bat2", "bat3", "bowl1", "bowl2"];
  const players = await Player.create(names.map((name) => ({ name })));
  names.forEach((name, i) => {
    ids[name] = players[i]._id;
  });
});

after(async () => {
  await stopTestDb(mongod);
});

function inningsDoc(teamId, overrides = {}) {
  return {
    team: teamId,
    runs: 0,
    wickets: 0,
    balls: 0,
    overs: 0,
    status: "upcoming",
    extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalties: 0, total: 0 },
    oversHistory: [],
    batting: [],
    bowling: [],
    partnerships: [],
    fallOfWickets: [],
    ...overrides,
  };
}

async function newMatch({ inningsIndex = 0, target = 0 } = {}) {
  const innings = [
    inningsDoc(ids.teamA, inningsIndex === 0 ? { status: "live" } : { status: "completed", runs: target - 1, balls: 120 }),
    inningsDoc(ids.teamB, inningsIndex === 1 ? { status: "live", target } : { status: "upcoming" }),
  ];
  const live = innings[inningsIndex];
  live.currentBatsman1 = ids.bat1;
  live.currentBatsman2 = ids.bat2;
  live.onStrikeBatsman = ids.bat1;
  live.currentBowler = ids.bowl1;
  if (target > 0) live.requiredRunRate = Number((target / 20).toFixed(2));

  return Match.create({
    title: `retry-${Date.now()}-${Math.random()}`,
    matchType: "T20",
    teams: [ids.teamA, ids.teamB],
    totalOvers: 20,
    status: "live",
    currentInnings: inningsIndex,
    innings,
  });
}

/** Run the validator, then the controller, the way the route does. */
function throughValidator(schema, reqFields) {
  const req = mockReq(reqFields);
  const res = mockRes();
  let passed = false;
  validate(schema)(req, res, () => {
    passed = true;
  });
  return { req, res, passed };
}

function scoreRequest(matchId, body = {}) {
  const { req, res, passed } = throughValidator(updateScoreSchema, {
    params: { matchId: String(matchId) },
    body: {
      inningsIndex: 0,
      runs: 0,
      batsmanOnStrikeId: String(ids.bat1),
      batsmanNonStrikeId: String(ids.bat2),
      bowlerId: String(ids.bowl1),
      ...body,
    },
  });
  assert.ok(passed, `validator rejected the ball: ${JSON.stringify(res.body)}`);
  return { req, res };
}

async function score(matchId, body) {
  const { req, res } = scoreRequest(matchId, body);
  await updateScore(req, res);
  return res;
}

async function undo(matchId, body = {}) {
  const { req, res, passed } = throughValidator(revertLastBallSchema, {
    params: { matchId: String(matchId) },
    body: { inningsIndex: 0, ...body },
  });
  assert.ok(passed, `validator rejected the undo: ${JSON.stringify(res.body)}`);
  await revertLastBall(req, res);
  return res;
}

async function stored(matchId, inningsIndex = 0) {
  const doc = await Match.findById(matchId).lean();
  const inn = doc.innings[inningsIndex];
  const balls = (inn.oversHistory || []).flatMap((o) => o.balls || []);
  return { doc, inn, balls };
}

// ---------------------------------------------------------------------------
// The schemas
// ---------------------------------------------------------------------------

test("updateScoreSchema keeps a UUID clientBallId and still accepts a ball without one", () => {
  const id = randomUUID();
  const base = {
    inningsIndex: 0,
    batsmanOnStrikeId: String(ids.bat1),
    batsmanNonStrikeId: String(ids.bat2),
    bowlerId: String(ids.bowl1),
  };
  assert.equal(updateScoreSchema.parse({ ...base, clientBallId: id }).clientBallId, id);
  assert.equal(updateScoreSchema.parse(base).clientBallId, undefined, "an old client sends no id");
  assert.equal(updateScoreSchema.safeParse({ ...base, clientBallId: "ball-1" }).success, false, "the id must be a UUID");
});

test("revertLastBallSchema keeps a UUID clientActionId and still accepts an undo without one", () => {
  const id = randomUUID();
  assert.equal(revertLastBallSchema.parse({ inningsIndex: 0, clientActionId: id }).clientActionId, id);
  assert.equal(revertLastBallSchema.parse({ inningsIndex: 0 }).clientActionId, undefined);
  assert.equal(revertLastBallSchema.safeParse({ inningsIndex: 0, clientActionId: "undo-1" }).success, false);
});

// ---------------------------------------------------------------------------
// One ball, one record
// ---------------------------------------------------------------------------

test("the same ball sent twice is recorded once, and the retry answers 200 duplicate", async () => {
  const match = await newMatch();
  const clientBallId = randomUUID();

  const first = await score(match._id, { runs: 4, clientBallId });
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.notEqual(first.body.duplicate, true);

  const retry = await score(match._id, { runs: 4, clientBallId });
  assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
  assert.equal(retry.body.duplicate, true, "the retry is reported as a duplicate");
  assert.equal(retry.body.innings.runs, 4, "the retry returns the current score");
  assert.equal(retry.body.innings.balls, 1);
  assert.equal(String(retry.body.ball?.clientBallId), clientBallId, "the retry returns the ball that was recorded");

  const { inn, balls } = await stored(match._id);
  assert.equal(inn.runs, 4);
  assert.equal(inn.balls, 1);
  assert.equal(balls.length, 1);
  assert.equal(balls[0].clientBallId, clientBallId, "the id is saved on the ball");
  assert.equal(inn.batting.find((b) => String(b.player) === String(ids.bat1))?.runs, 4, "the batter is credited once");
  assert.equal(inn.bowling.find((b) => String(b.player) === String(ids.bowl1))?.balls, 1, "the bowler is charged once");

  assert.equal(await Delivery.countDocuments({ matchId: match._id }), 1, "no second Delivery row");
  assert.equal(await Ball.countDocuments({ matchId: match._id }), 1, "no second Ball row");
});

test("two copies of one ball sent at the same moment record one ball", async () => {
  const match = await newMatch();
  const clientBallId = randomUUID();
  const a = scoreRequest(match._id, { runs: 1, clientBallId });
  const b = scoreRequest(match._id, { runs: 1, clientBallId });

  await Promise.all([updateScore(a.req, a.res), updateScore(b.req, b.res)]);

  const recorded = [a.res, b.res].filter((r) => r.statusCode === 200 && r.body?.duplicate !== true);
  assert.equal(recorded.length, 1, `exactly one copy records the ball: ${[a.res.statusCode, b.res.statusCode]}`);
  for (const r of [a.res, b.res]) {
    assert.ok(
      r.statusCode === 200 || (r.statusCode === 409 && r.body?.code === "SCORING_IN_PROGRESS"),
      `the other copy is a duplicate or told to retry: ${r.statusCode} ${JSON.stringify(r.body)}`,
    );
  }

  const retry = await score(match._id, { runs: 1, clientBallId });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.duplicate, true, "a later retry of either copy is a duplicate");

  const { inn, balls } = await stored(match._id);
  assert.equal(inn.runs, 1);
  assert.equal(inn.balls, 1);
  assert.equal(balls.length, 1);
});

test("an old client that sends no clientBallId still records every ball", async () => {
  const match = await newMatch();
  const first = await score(match._id, { runs: 2 });
  const second = await score(match._id, { runs: 2 });
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.equal(second.statusCode, 200, JSON.stringify(second.body));
  assert.notEqual(second.body.duplicate, true);

  const { inn, balls } = await stored(match._id);
  assert.equal(inn.runs, 4);
  assert.equal(inn.balls, 2);
  assert.equal(balls.length, 2);
});

test("a late retry of an earlier ball is still a duplicate after more balls are bowled", async () => {
  const match = await newMatch();
  const idA = randomUUID();
  const idB = randomUUID();
  const idC = randomUUID();

  assert.equal((await score(match._id, { runs: 1, clientBallId: idA })).statusCode, 200);
  assert.equal((await score(match._id, { runs: 0, isWide: true, clientBallId: idB })).statusCode, 200);
  assert.equal((await score(match._id, { runs: 6, clientBallId: idC })).statusCode, 200);

  const lateRetry = await score(match._id, { runs: 1, clientBallId: idA });
  assert.equal(lateRetry.statusCode, 200);
  assert.equal(lateRetry.body.duplicate, true, "the first ball's id survived the later balls");
  assert.equal(lateRetry.body.isOverComplete, false, "an old ball does not report the over as complete");
  assert.equal(lateRetry.body.shouldEndInnings, false);

  const { inn, balls } = await stored(match._id);
  assert.deepEqual(balls.map((ball) => ball.clientBallId), [idA, idB, idC], "every ball keeps its own id");
  assert.equal(inn.runs, 8, "1 + wide 1 + 6");
  assert.equal(inn.balls, 2, "the wide is not a legal ball");
});

test("the ball that completes an over keeps its id, and its retry reports the completed over", async () => {
  const match = await newMatch();
  let lastId = null;
  for (let i = 0; i < 6; i += 1) {
    lastId = randomUUID();
    const res = await score(match._id, { runs: 0, clientBallId: lastId });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  }
  const retry = await score(match._id, { runs: 0, clientBallId: lastId });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.duplicate, true);
  assert.equal(retry.body.isOverComplete, true, "the scorer is told the over is over, as on the first answer");

  const { inn, balls } = await stored(match._id);
  assert.equal(inn.balls, 6);
  assert.equal(balls.length, 6);
});

test("a retry of the ball that won the chase answers 200 duplicate, not 409", async () => {
  const match = await newMatch({ inningsIndex: 1, target: 4 });
  const clientBallId = randomUUID();

  const winner = await score(match._id, { inningsIndex: 1, runs: 4, clientBallId });
  assert.equal(winner.statusCode, 200, JSON.stringify(winner.body));
  assert.equal(winner.body.shouldEndInnings, true);

  const retry = await score(match._id, { inningsIndex: 1, runs: 4, clientBallId });
  assert.equal(retry.statusCode, 200, `the lost answer must not turn into an error: ${JSON.stringify(retry.body)}`);
  assert.equal(retry.body.duplicate, true);
  assert.equal(retry.body.shouldEndInnings, true);

  const { inn, balls } = await stored(match._id, 1);
  assert.equal(inn.runs, 4);
  assert.equal(balls.length, 1);
});

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

test("the same undo sent twice takes back one ball", async () => {
  const match = await newMatch();
  await score(match._id, { runs: 1, clientBallId: randomUUID() });
  await score(match._id, { runs: 4, clientBallId: randomUUID() });

  const clientActionId = randomUUID();
  const first = await undo(match._id, { clientActionId });
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.notEqual(first.body.duplicate, true);

  const retry = await undo(match._id, { clientActionId });
  assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
  assert.equal(retry.body.duplicate, true, "the retried undo is reported as a duplicate");
  assert.equal(retry.body.match.innings[0].runs, 1, "the retry returns the current score");

  const { inn, balls } = await stored(match._id);
  assert.equal(inn.runs, 1, "only the 4 was taken back");
  assert.equal(inn.balls, 1);
  assert.equal(balls.length, 1);
});

test("a retried undo of the only ball answers 200 duplicate, not 'No balls to revert'", async () => {
  const match = await newMatch();
  await score(match._id, { runs: 2, clientBallId: randomUUID() });

  const clientActionId = randomUUID();
  assert.equal((await undo(match._id, { clientActionId })).statusCode, 200);
  const retry = await undo(match._id, { clientActionId });
  assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
  assert.equal(retry.body.duplicate, true);

  const { inn, balls } = await stored(match._id);
  assert.equal(inn.runs, 0);
  assert.equal(balls.length, 0);
});

test("an old client's undo without clientActionId still takes back a ball each time", async () => {
  const match = await newMatch();
  await score(match._id, { runs: 1 });
  await score(match._id, { runs: 2 });
  await score(match._id, { runs: 3 });

  assert.equal((await undo(match._id)).statusCode, 200);
  assert.equal((await undo(match._id)).statusCode, 200);

  const { inn, balls } = await stored(match._id);
  assert.equal(inn.runs, 1);
  assert.equal(balls.length, 1);
});

test("after an undo the next ball with a new id is recorded", async () => {
  const match = await newMatch();
  await score(match._id, { runs: 6, clientBallId: randomUUID() });
  await undo(match._id, { clientActionId: randomUUID() });

  const next = await score(match._id, { runs: 1, clientBallId: randomUUID() });
  assert.equal(next.statusCode, 200);
  assert.notEqual(next.body.duplicate, true);

  const { inn, balls } = await stored(match._id);
  assert.equal(inn.runs, 1);
  assert.equal(balls.length, 1);
});
