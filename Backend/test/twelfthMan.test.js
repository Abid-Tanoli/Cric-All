import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";

import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import Match from "../src/models/Match.js";
import Tournament from "../src/models/Tournament.js";
import SystemSettings, { setPlatformSettings } from "../src/models/SystemSettings.js";
import { setImpactPlayer } from "../src/controllers/matchController.js";
import { setBowler } from "../src/controllers/scoreController.js";

let mongod;
let teamA;
let teamB;

before(async () => {
  mongod = await startTestDb();
});

after(async () => {
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Promise.all([
    Team.deleteMany({}),
    Player.deleteMany({}),
    Match.deleteMany({}),
    Tournament.deleteMany({}),
    SystemSettings.deleteMany({}),
  ]);
  teamA = await Team.create({ name: "12th Team A", isPublic: true });
  teamB = await Team.create({ name: "12th Team B", isPublic: true });
});

async function seedMatch(extra = {}) {
  const batters = await Player.insertMany([
    { name: "XI Player One" },
    { name: "XI Player Two" },
  ]);
  const sub = await Player.create({ name: "Twelfth Man" });

  const match = await Match.create({
    title: "12th Man Fixture",
    teams: [teamA._id, teamB._id],
    playingXI: [{ team: teamA._id, players: batters.map((p) => p._id) }],
    twelfthMan: [{ team: teamA._id, player: sub._id }],
    ...extra,
  });

  return { match, xi: batters, sub };
}

function apply(body, matchId) {
  const req = mockReq({ params: { matchId: String(matchId) }, body });
  const res = mockRes();
  return setImpactPlayer(req, res).then(() => res);
}

function swapBody({ xi, sub }) {
  return { teamId: teamA._id, playerId: sub._id, replacesPlayerId: xi[0]._id };
}

test("master switch off blocks the rule even when the match enables it", async () => {
  const { match, xi, sub } = await seedMatch({ rules: { twelfthManEnabled: true } });
  const res = await apply(swapBody({ xi, sub }), match._id);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "TWELFTH_MAN_DISABLED");
});

test("scope isolation: enabling one match does not enable another", async () => {
  await setPlatformSettings({ enableSuperSub: true });
  const a = await seedMatch({ rules: { twelfthManEnabled: true } });
  const b = await seedMatch({ rules: { twelfthManEnabled: false } });

  const ok = await apply(swapBody(a), a.match._id);
  assert.equal(ok.statusCode, 200);

  const blocked = await apply(swapBody(b), b.match._id);
  assert.equal(blocked.statusCode, 403);
  assert.equal(blocked.body.code, "TWELFTH_MAN_DISABLED");
});

test("tournament scope: matches inherit the tournament rule, matched override wins", async () => {
  await setPlatformSettings({ enableSuperSub: true });
  const tournament = await Tournament.create({
    name: "12th Cup",
    startDate: new Date(),
    endDate: new Date(Date.now() + 86400000),
    rules: { twelfthManEnabled: true },
  });
  const other = await Tournament.create({
    name: "No 12th Cup",
    startDate: new Date(),
    endDate: new Date(Date.now() + 86400000),
    rules: { twelfthManEnabled: false },
  });

  const inherits = await seedMatch({ tournament: tournament._id });
  const inheritsRes = await apply(swapBody(inherits), inherits.match._id);
  assert.equal(inheritsRes.statusCode, 200);

  const otherMatch = await seedMatch({ tournament: other._id });
  const otherRes = await apply(swapBody(otherMatch), otherMatch.match._id);
  assert.equal(otherRes.statusCode, 403);

  const explicitOff = await seedMatch({
    tournament: tournament._id,
    rules: { twelfthManEnabled: false },
  });
  const offRes = await apply(swapBody(explicitOff), explicitOff.match._id);
  assert.equal(offRes.statusCode, 403);
});

test("timing: rejected mid-over when the last ball was not a wicket", async () => {
  await setPlatformSettings({ enableSuperSub: true });
  const { match, xi, sub } = await seedMatch({
    rules: { twelfthManEnabled: true },
    currentInnings: 0,
    innings: [{
      team: teamB._id,
      balls: 3,
      oversHistory: [{
        overNumber: 0,
        balls: [
          { ballNumber: 1, isWicket: false },
          { ballNumber: 2, isWicket: false },
          { ballNumber: 3, isWicket: false },
        ],
      }],
    }],
  });

  const res = await apply(swapBody({ xi, sub }), match._id);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "TWELFTH_MAN_BAD_TIMING");
});

test("once per team, and the replaced player leaves the XI (cannot bat or bowl)", async () => {
  await setPlatformSettings({ enableSuperSub: true });
  const { match, xi, sub } = await seedMatch({ rules: { twelfthManEnabled: true } });

  const first = await apply(swapBody({ xi, sub }), match._id);
  assert.equal(first.statusCode, 200);

  const reloaded = await Match.findById(match._id);
  const players = reloaded.playingXI[0].players.map(String);
  assert.ok(players.includes(String(sub._id)));
  assert.ok(!players.includes(String(xi[0]._id)), "replaced player is no longer in the XI");

  const second = await apply(
    { teamId: teamA._id, playerId: sub._id, replacesPlayerId: xi[1]._id },
    match._id
  );
  assert.equal(second.statusCode, 400);
  assert.equal(second.body.code, "TWELFTH_MAN_ALREADY_USED");
});

test("bowlingXI is kept in sync on the swap", async () => {
  await setPlatformSettings({ enableSuperSub: true });
  const { match, xi, sub } = await seedMatch({ rules: { twelfthManEnabled: true } });
  match.bowlingXI = [{ team: teamA._id, players: xi.map((p) => p._id) }];
  await match.save();

  const res = await apply(swapBody({ xi, sub }), match._id);
  assert.equal(res.statusCode, 200);

  const reloaded = await Match.findById(match._id);
  const bowling = reloaded.bowlingXI[0].players.map(String);
  assert.ok(!bowling.includes(String(xi[0]._id)), "replaced player removed from bowling XI");
  assert.ok(bowling.includes(String(sub._id)), "incoming player added to bowling XI");
});

test("mid-over fielding swap blocks the incoming player from bowling the rest of the over", async () => {
  await setPlatformSettings({ enableSuperSub: true });
  const { match, xi, sub } = await seedMatch({
    rules: { twelfthManEnabled: true },
    currentInnings: 0,
    innings: [{
      team: teamB._id, // teamA is fielding
      balls: 1,
      oversHistory: [{
        overNumber: 0,
        balls: [{ ballNumber: 1, isWicket: true, wicketCancelled: false }],
      }],
    }],
  });

  const swap = await apply(swapBody({ xi, sub }), match._id);
  assert.equal(swap.statusCode, 200);

  const reloaded = await Match.findById(match._id);
  assert.equal(reloaded.innings[0].twelfthManBowlBlock.overNumber, 0);
  assert.equal(String(reloaded.innings[0].twelfthManBowlBlock.player), String(sub._id));

  const req = mockReq({ params: { matchId: String(match._id) }, body: { inningsIndex: 0, bowlerId: sub._id } });
  const res = mockRes();
  await setBowler(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "TWELFTH_MAN_CANNOT_BOWL_OVER");
});

test("end of an over is a legal window even without a wicket", async () => {
  await setPlatformSettings({ enableSuperSub: true });
  const { match, xi, sub } = await seedMatch({
    rules: { twelfthManEnabled: true },
    currentInnings: 0,
    innings: [{
      team: teamB._id,
      balls: 6,
      oversHistory: [{ overNumber: 0, balls: [{ ballNumber: 6, isWicket: false }] }],
    }],
  });

  const res = await apply(swapBody({ xi, sub }), match._id);
  assert.equal(res.statusCode, 200);
});
