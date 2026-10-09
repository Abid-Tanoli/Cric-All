import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";

import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import Match from "../src/models/Match.js";
import SystemSettings, {
  getPlatformSettings,
  setPlatformSettings,
} from "../src/models/SystemSettings.js";
import { setImpactPlayer } from "../src/controllers/matchController.js";

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
    SystemSettings.deleteMany({}),
  ]);
  teamA = await Team.create({ name: "Sub Team A", isPublic: true });
  teamB = await Team.create({ name: "Sub Team B", isPublic: true });
});

async function seedMatch() {
  const batters = await Player.insertMany([
    { name: "XI Player One" },
    { name: "XI Player Two" },
  ]);
  const sub = await Player.create({ name: "Twelfth Man" });

  const match = await Match.create({
    title: "Super Sub Fixture",
    teams: [teamA._id, teamB._id],
    playingXI: [{ team: teamA._id, players: batters.map((p) => p._id) }],
    twelfthMan: [{ team: teamA._id, player: sub._id }],
  });

  return { match, xi: batters, sub };
}

function run(body, matchId) {
  const req = mockReq({ params: { matchId: String(matchId) }, body });
  const res = mockRes();
  return setImpactPlayer(req, res).then(() => res);
}

test("the Super Sub rule is off by default", async () => {
  const settings = await getPlatformSettings();
  assert.equal(settings.enableSuperSub, false);
});

test("applying the rule while disabled is rejected and changes nothing", async () => {
  const { match, xi, sub } = await seedMatch();

  const res = await run(
    { teamId: teamA._id, playerId: sub._id, replacesPlayerId: xi[0]._id },
    match._id
  );

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "SUPER_SUB_DISABLED");

  const reloaded = await Match.findById(match._id);
  assert.deepEqual(
    reloaded.playingXI[0].players.map(String),
    xi.map((p) => String(p._id))
  );
  assert.equal(reloaded.impactPlayers.length, 0);
});

test("enabled: the 12th man replaces an XI player and is recorded", async () => {
  await setPlatformSettings({ enableSuperSub: true });
  const { match, xi, sub } = await seedMatch();

  const res = await run(
    { teamId: teamA._id, playerId: sub._id, replacesPlayerId: xi[0]._id },
    match._id
  );

  assert.equal(res.statusCode, 200);
  const reloaded = await Match.findById(match._id);
  const players = reloaded.playingXI[0].players.map(String);
  assert.ok(players.includes(String(sub._id)), "impact player joins the XI");
  assert.ok(!players.includes(String(xi[0]._id)), "replaced player leaves the XI");
  assert.deepEqual(players, [String(sub._id), String(xi[1]._id)]);

  assert.equal(reloaded.impactPlayers.length, 1);
  assert.equal(String(reloaded.impactPlayers[0].player), String(sub._id));
  assert.equal(String(reloaded.impactPlayers[0].replaces), String(xi[0]._id));
});

test("enabled: the incoming player must be the nominated 12th man", async () => {
  await setPlatformSettings({ enableSuperSub: true });
  const { match, xi } = await seedMatch();
  const random = await Player.create({ name: "Random Player" });

  const res = await run(
    { teamId: teamA._id, playerId: random._id, replacesPlayerId: xi[0]._id },
    match._id
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "SUPER_SUB_NOT_TWELFTH_MAN");
});

test("enabled: the replaced player must be in the playing XI", async () => {
  await setPlatformSettings({ enableSuperSub: true });
  const { match, sub } = await seedMatch();
  const outsider = await Player.create({ name: "Not In XI" });

  const res = await run(
    { teamId: teamA._id, playerId: sub._id, replacesPlayerId: outsider._id },
    match._id
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "SUPER_SUB_REPLACED_NOT_IN_XI");
});

test("enabled: a team may only use the Super Sub once", async () => {
  await setPlatformSettings({ enableSuperSub: true });
  const { match, xi, sub } = await seedMatch();

  const first = await run(
    { teamId: teamA._id, playerId: sub._id, replacesPlayerId: xi[0]._id },
    match._id
  );
  assert.equal(first.statusCode, 200);

  const second = await run(
    { teamId: teamA._id, playerId: sub._id, replacesPlayerId: xi[1]._id },
    match._id
  );
  assert.equal(second.statusCode, 400);
  assert.equal(second.body.code, "SUPER_SUB_ALREADY_USED");
});
