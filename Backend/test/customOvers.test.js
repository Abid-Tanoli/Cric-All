// T1.3 (B17): an owner can set any number of overs (1-50), a ball type and a
// bowler quota. "Custom" carries the overs; every other type keeps its own.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import Match from "../src/models/Match.js";
import Team from "../src/models/Team.js";
import Tournament from "../src/models/Tournament.js";
import { createOrgMatchSchema, updateOrgMatchSchema } from "../src/validators/matchValidators.js";
import { ScoringEngine } from "../src/services/scoring/ScoringEngine.js";
import { getBowlerQuota } from "../src/services/scoring/bowlerRules.js";
import { createTournament, updateTournament, applyTournamentFixtures } from "../src/controllers/TournamentController.js";

const id = () => new mongoose.Types.ObjectId().toString();
const teams = [id(), id()];
const issues = (schema, body) => {
  const parsed = schema.safeParse(body);
  return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
};

// ---------------------------------------------------------------------------
// Validator: totalOvers only with Custom
// ---------------------------------------------------------------------------

test("a Custom fixture with 7 overs, a ball type and a quota is accepted", () => {
  assert.deepEqual(issues(createOrgMatchSchema, { teams, matchType: "Custom", totalOvers: 7, ballType: "tape", maxBowlerOvers: 2 }), []);
});

test("overs are refused with any other match type, so a T20 cannot be 5 overs", () => {
  assert.deepEqual(issues(createOrgMatchSchema, { teams, matchType: "T20", totalOvers: 5 }), [
    "totalOvers: Overs can be set only with the Custom match type",
  ]);
  assert.deepEqual(issues(createOrgMatchSchema, { teams, totalOvers: 5 }), [
    "totalOvers: Overs can be set only with the Custom match type",
  ]);
});

test("Custom needs whole overs from 1 to 50 and a quota no bigger than the overs", () => {
  assert.deepEqual(issues(createOrgMatchSchema, { teams, matchType: "Custom" }), [
    "totalOvers: A Custom match needs its number of overs (1-50)",
  ]);
  for (const bad of [0, 51, 7.5]) {
    assert.equal(issues(createOrgMatchSchema, { teams, matchType: "Custom", totalOvers: bad }).length, 1, `overs ${bad}`);
  }
  assert.deepEqual(issues(createOrgMatchSchema, { teams, matchType: "Custom", totalOvers: 7, maxBowlerOvers: 8 }), [
    "maxBowlerOvers: A bowler cannot bowl more overs than the match has",
  ]);
  assert.equal(issues(createOrgMatchSchema, { teams, ballType: "leather" }).length, 1);
});

test("an update changes overs only together with matchType Custom", () => {
  assert.deepEqual(issues(updateOrgMatchSchema, { matchType: "Custom", totalOvers: 12 }), []);
  assert.deepEqual(issues(updateOrgMatchSchema, { totalOvers: 12 }), [
    "totalOvers: Overs can be set only with the Custom match type",
  ]);
  assert.deepEqual(issues(updateOrgMatchSchema, { ballType: "tennis" }), []);
});

// ---------------------------------------------------------------------------
// Engine: a 7-over match from the first ball to the result
// ---------------------------------------------------------------------------

function freshMatch(matchType, totalOvers) {
  const side = (team, a, b) => ({
    team, runs: 0, wickets: 0, balls: 0, overs: 0, status: "upcoming", extras: {},
    batting: [{ player: a, runs: 0, balls: 0 }, { player: b, runs: 0, balls: 0 }],
    bowling: [], oversHistory: [], fallOfWickets: [], partnerships: [],
    currentBatsman1: a, currentBatsman2: b, onStrikeBatsman: a, currentBowler: null,
  });
  return {
    matchType, totalOvers, status: "upcoming", currentInnings: 0, teams: ["A", "B"],
    innings: [side("A", "a1", "a2"), side("B", "b1", "b2")],
  };
}

// `runs` off every legal ball, bowlers changing each over.
function bat(engine, inningsIndex, maxBalls, runs) {
  for (let ball = 0; ball < maxBalls; ball += 1) {
    const innings = engine.match.innings[inningsIndex];
    if (innings.status === "completed" || engine.match.status === "completed") break;
    engine.processDelivery({
      inningsIndex,
      runs,
      bowler: Math.floor(innings.balls / 6) % 2 === 0 ? "x1" : "x2",
      batsmanOnStrike: innings.onStrikeBatsman,
    });
  }
}

test("a Custom 7-over match ends its first innings at 42 balls and is settled by the chase", () => {
  const engine = new ScoringEngine(freshMatch("Custom", 7));

  bat(engine, 0, 60, 1);
  const first = engine.match.innings[0];
  assert.equal(first.balls, 42, "the first innings stops at 7 overs");
  assert.equal(first.runs, 42);
  assert.equal(first.status, "completed");
  assert.equal(engine.match.innings[1].target, 43);
  assert.equal(engine.match.status, "innings_break");

  bat(engine, 1, 60, 2);
  const second = engine.match.innings[1];
  assert.equal(second.runs, 44, "the chase stops the ball the target is passed");
  assert.equal(second.balls, 22);
  assert.equal(engine.match.status, "completed");
  assert.equal(engine.match.result?.margin, "10 wickets");
  assert.match(engine.match.result?.description || "", /\(20 balls remaining\)/, "balls left are counted from the 7 overs");
});

test("Tape Ball keeps today's behaviour: the engine does not end it on overs", () => {
  const engine = new ScoringEngine(freshMatch("Tape Ball", 8));
  bat(engine, 0, 48, 1);
  assert.equal(engine.match.innings[0].status, "live", "the scorer ends it, as before");
});

test("a Custom match cannot be declared like a Test", () => {
  const engine = new ScoringEngine(freshMatch("Custom", 7));
  assert.throws(() => engine.declareInnings(0), /Declaration only allowed in Test matches/);
});

test("the bowler quota of a Custom match is ceil(overs / 5) unless the owner set one", () => {
  assert.equal(getBowlerQuota({ matchType: "Custom", totalOvers: 7 }), 2);
  assert.equal(getBowlerQuota({ matchType: "Custom", totalOvers: 12 }), 3);
  assert.equal(getBowlerQuota({ matchType: "Custom", totalOvers: 7, maxBowlerOvers: 3 }), 3);
});

// ---------------------------------------------------------------------------
// Model and tournaments
// ---------------------------------------------------------------------------

let mongod;
before(async () => { mongod = await startTestDb(); });
after(async () => { await stopTestDb(mongod); });
beforeEach(async () => {
  await Promise.all([Match.deleteMany({}), Team.deleteMany({}), Tournament.deleteMany({})]);
});

test("saving keeps a Custom match's overs and turns its powerplay off; other types still set their own", async () => {
  const custom = await Match.create({ title: "Seven overs", matchType: "Custom", totalOvers: 7, ballType: "tape", teams });
  assert.equal(custom.totalOvers, 7);
  assert.equal(custom.ballType, "tape");
  assert.equal(custom.powerplayConfig.enabled, false);

  const t20 = await Match.create({ title: "Twenty overs", matchType: "T20", totalOvers: 7, teams });
  assert.equal(t20.totalOvers, 20, "the type wins for every non-Custom match");

  const broken = await Match.create({ title: "Bad overs", matchType: "Custom", totalOvers: 99, teams });
  assert.equal(broken.totalOvers, 20, "an impossible Custom value falls back to 20");
});

const asAdmin = (extra) => mockReq({ user: { role: "admin" }, principalType: "admin", ...extra });

async function createCustomTournament(body) {
  const sides = await Team.create([{ name: "Overs Alpha" }, { name: "Overs Bravo" }, { name: "Overs Charlie" }]);
  const res = mockRes();
  await createTournament(asAdmin({
    body: {
      name: "Twelve Over Cup",
      startDate: "2026-12-01",
      endDate: "2026-12-10",
      type: "league",
      teams: sides.map((t) => String(t._id)),
      ...body,
    },
  }), res);
  return res;
}

test("a Custom tournament keeps its overs and ball type, and its fixtures get them", async () => {
  const res = await createCustomTournament({ format: "Custom", totalOvers: 12, ballType: "tape" });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  const tournament = await Tournament.findOne({ name: "Twelve Over Cup" });
  assert.equal(tournament.totalOvers, 12);
  assert.equal(tournament.ballType, "tape");

  const applied = mockRes();
  await applyTournamentFixtures(asAdmin({ params: { id: String(tournament._id) }, body: { startAt: "2026-12-02T09:00:00Z" } }), applied);
  assert.equal(applied.statusCode, 200, JSON.stringify(applied.body));
  const fixtures = await Match.find({ tournament: tournament._id }).lean();
  assert.equal(fixtures.length, 3);
  for (const fixture of fixtures) {
    assert.equal(fixture.matchType, "Custom");
    assert.equal(fixture.totalOvers, 12);
    assert.equal(fixture.ballType, "tape");
  }
});

test("a tournament refuses Custom without overs, and overs with a fixed format", async () => {
  const missing = await createCustomTournament({ format: "Custom" });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.body.message, "A Custom tournament needs its number of overs (1-50)");

  await Team.deleteMany({});
  const fixed = await createCustomTournament({ format: "T20", totalOvers: 12 });
  assert.equal(fixed.statusCode, 400);
  assert.equal(fixed.body.message, "Overs can be set only with the Custom format");
});

test("switching a tournament to Custom stores the overs; switching back clears them", async () => {
  const created = await createCustomTournament({ format: "T20" });
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const tournament = await Tournament.findOne({ name: "Twelve Over Cup" });

  const toCustom = mockRes();
  await updateTournament(asAdmin({ params: { id: String(tournament._id) }, body: { format: "Custom", totalOvers: 15 } }), toCustom);
  assert.equal(toCustom.statusCode, 200, JSON.stringify(toCustom.body));
  assert.equal((await Tournament.findById(tournament._id)).totalOvers, 15);

  const back = mockRes();
  await updateTournament(asAdmin({ params: { id: String(tournament._id) }, body: { format: "T20" } }), back);
  assert.equal(back.statusCode, 200, JSON.stringify(back.body));
  assert.equal((await Tournament.findById(tournament._id)).totalOvers, null);
});
