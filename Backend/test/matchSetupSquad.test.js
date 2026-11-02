import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "match-setup-squad-test-secret";

import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import Match from "../src/models/Match.js";
import Tournament from "../src/models/Tournament.js";
import Event from "../src/models/Event.js";
import SystemSettings, { setPlatformSettings } from "../src/models/SystemSettings.js";
import {
  getMatchSquads,
  setPlayingXI,
  setTwelfthMan,
  updateToss,
  setOpeners,
  setImpactPlayer,
} from "../src/controllers/matchController.js";
import { setBowler } from "../src/controllers/scoreController.js";

// The Admin setup screen has to see the whole competition squad. These tests
// recreate the production shape that caused the 6-7 player cap: Team.players
// holds a short roster while the tournament/event squad holds all 19 players.

let mongod;
let teamA;
let teamB;
let tournament;
let players;

const NAMES = Array.from({ length: 19 }, (_, index) => `Squad Player ${index + 1}`);

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

  teamA = await Team.create({ name: "Sky Sports", shortName: "SKY", isPublic: true });
  teamB = await Team.create({ name: "Young Star", isPublic: true });
  players = await Player.insertMany(
    NAMES.map((name) => ({ name, team: teamA._id, isPublic: true }))
  );
  // Deliberately only seven players on the team record, the exact reason the
  // old picker stopped early.
  teamA.players = players.slice(0, 7).map((player) => player._id);
  await teamA.save();

  tournament = await Tournament.create({
    name: "Squad Test Cup",
    startDate: new Date("2026-10-01T00:00:00Z"),
    endDate: new Date("2026-11-30T00:00:00Z"),
    teams: [teamA._id, teamB._id],
    rules: { twelfthManEnabled: true },
    tournamentSquads: [{ team: teamA._id, players: players.map((player) => player._id) }],
  });
});

const makeMatch = (extra = {}) => Match.create({
  title: "Sky Sports vs Young Star",
  matchType: "T20",
  totalOvers: 20,
  startAt: new Date("2026-11-01T05:30:00.000Z"),
  teams: [teamA._id, teamB._id],
  tournament: tournament._id,
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
const idOf = (value) => String(value?._id || value || "");

test("GET /matches/:id/squads returns the full tournament squad, not the 7-player roster", async () => {
  const match = await makeMatch();

  const res = await call(getMatchSquads, { params: { id: String(match._id) } });

  assert.equal(res.statusCode, 200);
  const sky = res.body.teams.find((row) => String(row.team._id) === String(teamA._id));
  assert.equal(sky.squadSource, "tournament");
  assert.equal(sky.squadSize, 19);
  assert.equal(sky.squad.length, 19);
  assert.deepEqual(
    sky.squad.map((player) => player.name).sort(),
    [...NAMES].sort(),
  );
});

test("GET /matches/:id/squads falls back to the event squad when there is no tournament squad", async () => {
  await Tournament.updateOne({ _id: tournament._id }, { $set: { tournamentSquads: [] } });
  const event = await Event.create({
    eventType: "tournament",
    name: "Squad Test Event",
    teams: [teamA._id, teamB._id],
    eventSquads: [{ team: teamA._id, players: players.map((player) => player._id) }],
  });
  const match = await makeMatch({ event: event._id });

  const res = await call(getMatchSquads, { params: { id: String(match._id) } });

  assert.equal(res.statusCode, 200);
  const sky = res.body.teams.find((row) => String(row.team._id) === String(teamA._id));
  assert.equal(sky.squadSource, "event");
  assert.equal(sky.squad.length, 19);
});

test("GET /matches/:id/squads exposes the effective 12th Man / Super Sub gate", async () => {
  const match = await makeMatch();

  const platformOff = await call(getMatchSquads, { params: { id: String(match._id) } });
  assert.equal(platformOff.body.rules.twelfthMan.enabled, false);
  assert.equal(platformOff.body.rules.twelfthMan.platformEnabled, false);

  await setPlatformSettings({ enableSuperSub: true });
  const bothOn = await call(getMatchSquads, { params: { id: String(match._id) } });
  assert.equal(bothOn.body.rules.twelfthMan.enabled, true);
  assert.equal(bothOn.body.rules.twelfthMan.source, "tournament");

  await Match.updateOne({ _id: match._id }, { $set: { "rules.twelfthManEnabled": false } });
  const matchOff = await call(getMatchSquads, { params: { id: String(match._id) } });
  assert.equal(matchOff.body.rules.twelfthMan.enabled, false);
  assert.equal(matchOff.body.rules.twelfthMan.source, "match");
});

test("setPlayingXI accepts exactly 11 unique players and rejects 10, 12 and duplicates", async () => {
  const match = await makeMatch();
  const teamId = String(teamA._id);

  const ten = await call(setPlayingXI, {
    params: { matchId: String(match._id) },
    body: { teamId, players: ids(players.slice(0, 10)) },
  });
  assert.equal(ten.statusCode, 400);

  const twelve = await call(setPlayingXI, {
    params: { matchId: String(match._id) },
    body: { teamId, players: ids(players.slice(0, 12)) },
  });
  assert.equal(twelve.statusCode, 400);

  const duplicate = await call(setPlayingXI, {
    params: { matchId: String(match._id) },
    body: { teamId, players: ids([...players.slice(0, 10), players[0]]) },
  });
  assert.equal(duplicate.statusCode, 400);
  assert.match(duplicate.body.message, /only once/i);

  const outsider = await Player.create({ name: "Outside The Squad" });
  const outsideSquad = await call(setPlayingXI, {
    params: { matchId: String(match._id) },
    body: { teamId, players: ids([...players.slice(0, 10), outsider]) },
  });
  assert.equal(outsideSquad.statusCode, 400);
  assert.equal(outsideSquad.body.code, "PLAYING_XI_NOT_IN_SQUAD");

  const eleven = await call(setPlayingXI, {
    params: { matchId: String(match._id) },
    body: { teamId, players: ids(players.slice(0, 11)) },
  });
  assert.equal(eleven.statusCode, 200);
});

test("the full local setup flow saves squads, XI, 12th Men, toss, openers and bowler", async () => {
  const playersB = await Player.insertMany(
    Array.from({ length: 15 }, (_, index) => ({
      name: `Young Star Player ${index + 1}`,
      team: teamB._id,
      isPublic: true,
    })),
  );
  teamB.players = playersB.slice(0, 7).map((player) => player._id);
  await teamB.save();

  const tournamentSquads = [
    { team: teamA._id, players: players.slice(0, 15).map((player) => player._id) },
    { team: teamB._id, players: playersB.map((player) => player._id) },
  ];
  await Tournament.updateOne(
    { _id: tournament._id },
    { $set: { rules: { twelfthManEnabled: true }, tournamentSquads } },
  );
  const event = await Event.create({
    eventType: "tournament",
    name: "Local Setup Event",
    teams: [teamA._id, teamB._id],
    eventSquads: tournamentSquads,
  });
  await setPlatformSettings({ enableSuperSub: true });

  const match = await makeMatch({ event: event._id });
  assert.deepEqual(match.playingXI, []);

  const squadRes = await call(getMatchSquads, { params: { id: String(match._id) } });
  assert.equal(squadRes.statusCode, 200);
  assert.equal(squadRes.body.rules.twelfthMan.enabled, true);
  assert.deepEqual(squadRes.body.teams.map((row) => row.squad.length), [15, 15]);
  assert.deepEqual(squadRes.body.teams.map((row) => row.squadSource), ["tournament", "tournament"]);

  const teamPlayers = [players, playersB];
  for (const [index, team] of [teamA, teamB].entries()) {
    const xi = teamPlayers[index].slice(0, 11);
    const xiRes = await call(setPlayingXI, {
      params: { matchId: String(match._id) },
      body: { teamId: String(team._id), players: ids(xi) },
    });
    assert.equal(xiRes.statusCode, 200, `step 2 saved ${team.name}'s XI`);

    const twelfthRes = await call(setTwelfthMan, {
      params: { matchId: String(match._id) },
      body: { teamId: String(team._id), playerId: String(teamPlayers[index][11]._id) },
    });
    assert.equal(twelfthRes.statusCode, 200, `step 2 nominated ${team.name}'s 12th Man`);
  }

  const tossRes = await call(updateToss, {
    params: { matchId: String(match._id) },
    body: { tossWinnerId: String(teamA._id), decision: "bat" },
  });
  assert.equal(tossRes.statusCode, 200, "step 3 saved the toss");
  assert.equal(tossRes.body.match.status, "toss_done");
  assert.equal(idOf(tossRes.body.match.innings[0].team), String(teamA._id));

  const openersRes = await call(setOpeners, {
    params: { matchId: String(match._id) },
    body: {
      inningsIndex: 0,
      batsman1Id: String(players[0]._id),
      batsman2Id: String(players[1]._id),
    },
  });
  assert.equal(openersRes.statusCode, 200, "step 4 saved the openers");

  const bowlerRes = await call(setBowler, {
    params: { matchId: String(match._id) },
    body: { inningsIndex: 0, bowlerId: String(playersB[0]._id) },
  });
  assert.equal(bowlerRes.statusCode, 200, "step 4 saved the opening bowler");
  assert.equal(
    idOf(bowlerRes.body.match.innings[0].currentBowler),
    String(playersB[0]._id),
  );
  assert.equal(
    idOf(openersRes.body.match.innings[0].currentBatsman1),
    String(players[0]._id),
  );

  const impactRes = await call(setImpactPlayer, {
    params: { matchId: String(match._id) },
    body: {
      teamId: String(teamA._id),
      playerId: String(players[11]._id),
      replacesPlayerId: String(players[1]._id),
    },
  });
  assert.equal(impactRes.statusCode, 200, "the existing 12th Man replacement remains usable");
  const savedXi = impactRes.body.match.playingXI.find((entry) => idOf(entry.team) === String(teamA._id));
  assert.equal(savedXi.players.some((player) => idOf(player) === String(players[11]._id)), true);
  assert.equal(savedXi.players.some((player) => idOf(player) === String(players[1]._id)), false);
});

test("setTwelfthMan only accepts a squad member who is outside the Playing XI", async () => {
  const match = await makeMatch({
    playingXI: [{ team: teamA._id, players: players.slice(0, 11).map((player) => player._id) }],
  });
  const teamId = String(teamA._id);

  const inXi = await call(setTwelfthMan, {
    params: { matchId: String(match._id) },
    body: { teamId, playerId: String(players[0]._id) },
  });
  assert.equal(inXi.statusCode, 400);
  assert.equal(inXi.body.code, "TWELFTH_MAN_IN_XI");

  const outsider = await Player.create({ name: "Outside The Squad" });
  const notInSquad = await call(setTwelfthMan, {
    params: { matchId: String(match._id) },
    body: { teamId, playerId: String(outsider._id) },
  });
  assert.equal(notInSquad.statusCode, 400);
  assert.equal(notInSquad.body.code, "TWELFTH_MAN_NOT_IN_SQUAD");

  const remaining = await call(setTwelfthMan, {
    params: { matchId: String(match._id) },
    body: { teamId, playerId: String(players[11]._id) },
  });
  assert.equal(remaining.statusCode, 200);
  assert.equal(
    String(remaining.body.match.twelfthMan[0].player?._id || remaining.body.match.twelfthMan[0].player),
    String(players[11]._id),
  );
});

test("setTwelfthMan can clear a nomination before the toss", async () => {
  const match = await makeMatch({
    twelfthMan: [{ team: teamA._id, player: players[11]._id }],
  });

  const res = await call(setTwelfthMan, {
    params: { matchId: String(match._id) },
    body: { teamId: String(teamA._id), playerId: null },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.match.twelfthMan.length, 0);
});
