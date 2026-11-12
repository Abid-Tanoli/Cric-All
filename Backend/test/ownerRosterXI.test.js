import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "owner-roster-xi-test-secret";

import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import Match from "../src/models/Match.js";
import Tournament from "../src/models/Tournament.js";
import Event from "../src/models/Event.js";
import SystemSettings, { setPlatformSettings } from "../src/models/SystemSettings.js";
import {
  setPlayingXI,
  setTwelfthMan,
  setImpactPlayer,
} from "../src/controllers/matchController.js";

// Phase 1: an organization owner runs a single match without the optional
// 15-player squad step. The Playing XI, 12th Man and Super Sub all come from the
// club's whole roster (Team.players), while a tournament squad still narrows the
// pool exactly as before.

let mongod;
let teamA;
let teamB;
let playersA;
let playersB;

const NAMES_A = Array.from({ length: 14 }, (_, index) => `Roster A Player ${index + 1}`);
const NAMES_B = Array.from({ length: 12 }, (_, index) => `Roster B Player ${index + 1}`);

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
    Event.deleteMany({}),
    SystemSettings.deleteMany({}),
  ]);

  teamA = await Team.create({ name: "Roster A", shortName: "RA", isPublic: true });
  teamB = await Team.create({ name: "Roster B", shortName: "RB", isPublic: true });

  playersA = await Player.insertMany(
    NAMES_A.map((name) => ({ name, team: teamA._id, isPublic: true }))
  );
  playersB = await Player.insertMany(
    NAMES_B.map((name) => ({ name, team: teamB._id, isPublic: true }))
  );

  teamA.players = playersA.map((player) => player._id);
  teamB.players = playersB.map((player) => player._id);
  await Promise.all([teamA.save(), teamB.save()]);
});

const makeMatch = (extra = {}) => Match.create({
  title: "Roster A vs Roster B",
  matchType: "T20",
  totalOvers: 20,
  startAt: new Date("2026-11-01T05:30:00.000Z"),
  teams: [teamA._id, teamB._id],
  status: "upcoming",
  innings: [{ team: teamA._id, status: "upcoming" }, { team: teamB._id, status: "upcoming" }],
  ...extra,
});

const call = async (handler, { params = {}, body = {} } = {}) => {
  const req = mockReq({ params, body });
  const res = mockRes();
  await handler(req, res);
  return res;
};

const ids = (list) => list.map((player) => String(player._id || player));

test("setPlayingXI accepts exactly 11 from the club roster with no squad15", async () => {
  const match = await makeMatch();
  const teamId = String(teamA._id);
  const params = { matchId: String(match._id) };

  const ten = await call(setPlayingXI, { params, body: { teamId, players: ids(playersA.slice(0, 10)) } });
  assert.equal(ten.statusCode, 400);

  const twelve = await call(setPlayingXI, { params, body: { teamId, players: ids(playersA.slice(0, 12)) } });
  assert.equal(twelve.statusCode, 400);

  const outsider = await call(setPlayingXI, { params, body: { teamId, players: ids([...playersA.slice(0, 10), playersB[0]]) } });
  assert.equal(outsider.statusCode, 400);
  assert.equal(outsider.body.code, "PLAYING_XI_NOT_IN_SQUAD");

  const eleven = await call(setPlayingXI, { params, body: { teamId, players: ids(playersA.slice(0, 11)) } });
  assert.equal(eleven.statusCode, 200);
  const saved = eleven.body.match.playingXI.find((entry) => String(entry.team._id || entry.team) === teamId);
  assert.equal((saved?.players || []).length, 11);
});

test("an empty squad15 entry does not block an XI chosen from the roster", async () => {
  const match = await makeMatch({ squad15: [{ team: teamA._id, players: [] }] });

  const res = await call(setPlayingXI, {
    params: { matchId: String(match._id) },
    body: { teamId: String(teamA._id), players: ids(playersA.slice(0, 11)) },
  });

  assert.equal(res.statusCode, 200);
});

test("12th Man and Super Sub can be nominated from the roster outside the XI", async () => {
  await setPlatformSettings({ enableSuperSub: true });
  const match = await makeMatch({ rules: { twelfthManEnabled: true } });
  const teamId = String(teamA._id);
  const params = { matchId: String(match._id) };

  const xi = await call(setPlayingXI, { params, body: { teamId, players: ids(playersA.slice(0, 11)) } });
  assert.equal(xi.statusCode, 200);

  const twelfth = await call(setTwelfthMan, {
    params,
    body: { teamId, playerId: String(playersA[11]._id) },
  });
  assert.equal(twelfth.statusCode, 200);
  const nominated = twelfth.body.match.twelfthMan.find(
    (entry) => String(entry.team._id || entry.team) === teamId
  );
  assert.equal(String(nominated.player._id || nominated.player), String(playersA[11]._id));

  const inXI = await call(setTwelfthMan, {
    params,
    body: { teamId, playerId: String(playersA[0]._id) },
  });
  assert.equal(inXI.statusCode, 400);
  assert.equal(inXI.body.code, "TWELFTH_MAN_IN_XI");

  const impact = await call(setImpactPlayer, {
    params,
    body: {
      teamId,
      playerId: String(playersA[11]._id),
      replacesPlayerId: String(playersA[0]._id),
    },
  });
  assert.equal(impact.statusCode, 200);
  const saved = impact.body.match.playingXI.find((entry) => String(entry.team._id || entry.team) === teamId);
  assert.equal(saved.players.some((player) => String(player._id || player) === String(playersA[11]._id)), true);
});

test("a tournament squad still narrows the XI pool", async () => {
  const squadPlayers = playersA.slice(0, 11);
  const tournament = await Tournament.create({
    name: "Roster Test Cup",
    startDate: new Date("2026-10-01T00:00:00Z"),
    endDate: new Date("2026-11-30T00:00:00Z"),
    teams: [teamA._id, teamB._id],
    tournamentSquads: [{ team: teamA._id, players: squadPlayers.map((player) => player._id) }],
  });
  const match = await makeMatch({ tournament: tournament._id });

  const outsideSquad = await call(setPlayingXI, {
    params: { matchId: String(match._id) },
    body: { teamId: String(teamA._id), players: ids([...squadPlayers.slice(0, 10), playersA[11]]) },
  });
  assert.equal(outsideSquad.statusCode, 400);
  assert.equal(outsideSquad.body.code, "PLAYING_XI_NOT_IN_SQUAD");

  const insideSquad = await call(setPlayingXI, {
    params: { matchId: String(match._id) },
    body: { teamId: String(teamA._id), players: ids(squadPlayers) },
  });
  assert.equal(insideSquad.statusCode, 200);
});
