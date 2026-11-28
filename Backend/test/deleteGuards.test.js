// B16: deleting a player must not orphan the records that name them, and
// deleting a match (directly, or through its event or tournament) must not leave
// its balls and other per-match rows behind.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import Player from "../src/models/Player.js";
import Team from "../src/models/Team.js";
import Match from "../src/models/Match.js";
import Ball from "../src/models/Ball.js";
import Delivery from "../src/models/Delivery.js";
import Event from "../src/models/Event.js";
import Tournament from "../src/models/Tournament.js";
import { deletePlayer, bulkDeletePlayers } from "../src/controllers/playerController.js";
import { deleteMatch } from "../src/controllers/matchController.js";
import { deleteEvent } from "../src/controllers/eventController.js";
import { deleteTournament } from "../src/controllers/TournamentController.js";
import { matchPlayerPaths } from "../src/services/playerReferences.js";
import { MATCH_DATA } from "../src/services/matchData.js";

let mongod;
before(async () => { mongod = await startTestDb(); });
after(async () => { await stopTestDb(mongod); });
beforeEach(async () => {
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).deleteMany({})));
});

const oid = () => new mongoose.Types.ObjectId();
const asAdmin = (extra) => mockReq({ user: { _id: oid(), role: "admin" }, principalType: "admin", ...extra });

// Raw inserts: each test stores only the fields it is about.
async function insert(Model, doc = {}) {
  const _id = doc._id || oid();
  await Model.collection.insertOne({ ...doc, _id });
  return _id;
}

async function callDeletePlayer(playerId) {
  const res = mockRes();
  await deletePlayer(asAdmin({ params: { id: String(playerId) } }), res);
  return res;
}

test("the Match paths checked come from the schema and cover innings, balls, the XI and awards", () => {
  const paths = matchPlayerPaths();
  for (const path of [
    "innings.batting.player",
    "innings.bowling.player",
    "innings.oversHistory.balls.bowler",
    "innings.fallOfWickets.player",
    "playingXI.players",
    "squad15.captain",
    "result.playerOfMatch",
    "superOvers.innings.batting.player",
  ]) {
    assert.ok(paths.includes(path), `missing ${path}`);
  }
});

test("a player who batted in a match is refused with 409 and kept", async () => {
  const playerId = await insert(Player, { name: "Ali Khan" });
  await insert(Match, { innings: [{ batting: [{ player: playerId, runs: 12 }] }] });

  const res = await callDeletePlayer(playerId);

  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, "PLAYER_HAS_HISTORY");
  assert.deepEqual(res.body.references, { matches: 1 });
  assert.match(res.body.message, /Ali Khan has cricket records \(1 match\)\. Merge this player/);
  assert.ok(await Player.findById(playerId), "the player is still there");
});

const otherReferences = [
  ["a ball they bowled", async (id) => insert(Ball, { matchId: oid(), bowler: id }), "balls"],
  ["a delivery they faced", async (id) => insert(Delivery, { matchId: oid(), batsmanId: id }), "deliveries"],
  ["a tournament award", async (id) => insert(Tournament, { name: "Cup", officialAwards: { bestBowler: id } }), "tournaments"],
  ["an event squad", async (id) => insert(Event, { name: "Series", eventSquads: [{ players: [id] }] }), "events"],
];
for (const [label, addReference, collection] of otherReferences) {
  test(`a player named in ${label} is refused and kept`, async () => {
    const playerId = await insert(Player, { name: "Referenced" });
    await addReference(playerId);

    const res = await callDeletePlayer(playerId);

    assert.equal(res.statusCode, 409, JSON.stringify(res.body));
    assert.equal(res.body.references[collection], 1);
    assert.ok(await Player.findById(playerId));
  });
}

test("a player with no records is deleted and leaves every squad list, team role and relation", async () => {
  const playerId = await insert(Player, { name: "Typo Entry" });
  const otherId = await insert(Player, { name: "Teammate", relations: [{ player: playerId, type: "brother" }] });
  const ownTeam = await insert(Team, { name: "Own", players: [playerId], captain: playerId });
  const otherTeam = await insert(Team, { name: "Other", players: [playerId, otherId], viceCaptain: playerId });
  await Player.collection.updateOne({ _id: playerId }, { $set: { team: ownTeam } });

  const res = await callDeletePlayer(playerId);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(await Player.findById(playerId), null);
  const own = await Team.collection.findOne({ _id: ownTeam });
  const other = await Team.collection.findOne({ _id: otherTeam });
  assert.deepEqual(own.players, []);
  assert.equal(own.captain, undefined);
  assert.deepEqual(other.players.map(String), [String(otherId)]);
  assert.equal(other.viceCaptain, undefined);
  assert.deepEqual((await Player.collection.findOne({ _id: otherId })).relations, []);
});

test("bulk delete refuses the whole batch when one player has records, and deletes nobody", async () => {
  const clean = await insert(Player, { name: "Clean" });
  const scored = await insert(Player, { name: "Scored" });
  await insert(Ball, { matchId: oid(), batsman: scored });

  const res = mockRes();
  await bulkDeletePlayers(asAdmin({ body: { playerIds: [String(clean), String(scored)] } }), res);

  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, "PLAYER_HAS_HISTORY");
  assert.deepEqual(res.body.blocked.map((p) => p.name), ["Scored"]);
  assert.match(res.body.message, /1 selected player has cricket records \(Scored\)\..*Nothing was deleted\./);
  assert.equal(await Player.countDocuments({ _id: { $in: [clean, scored] } }), 2);
});

test("bulk delete removes players without records from their teams", async () => {
  const a = await insert(Player, { name: "A" });
  const b = await insert(Player, { name: "B" });
  const team = await insert(Team, { name: "T", players: [a, b], captain: a });

  const res = mockRes();
  await bulkDeletePlayers(asAdmin({ body: { playerIds: [String(a), String(b)] } }), res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.deletedCount, 2);
  const saved = await Team.collection.findOne({ _id: team });
  assert.deepEqual(saved.players, []);
  assert.equal(saved.captain, undefined);
});

async function seedMatchData(matchId) {
  for (const { model, field } of MATCH_DATA) await insert(model, { [field]: matchId });
}
async function matchDataLeft(matchId) {
  let left = 0;
  for (const { model, field } of MATCH_DATA) left += await model.countDocuments({ [field]: matchId });
  return left;
}

test("deleting a match removes its balls and other per-match rows, and only its own", async () => {
  const doomed = await insert(Match, { title: "Doomed" });
  const kept = await insert(Match, { title: "Kept" });
  await seedMatchData(doomed);
  await insert(Ball, { matchId: kept });
  const event = await insert(Event, { name: "Series", matches: [doomed, kept] });

  const res = mockRes();
  await deleteMatch(asAdmin({ params: { id: String(doomed) } }), res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(await matchDataLeft(doomed), 0, "no per-match row of the deleted match is left");
  assert.equal(await Ball.countDocuments({ matchId: kept }), 1, "another match keeps its balls");
  assert.deepEqual((await Event.collection.findOne({ _id: event })).matches.map(String), [String(kept)]);
});

test("deleting an event removes the balls of every match it deletes", async () => {
  const eventId = oid();
  const listed = await insert(Match, { title: "Listed" });
  const linked = await insert(Match, { title: "Linked", tournament: eventId });
  const unrelated = await insert(Match, { title: "Unrelated" });
  await insert(Event, { _id: eventId, name: "Series", matches: [listed] });
  for (const id of [listed, linked, unrelated]) await insert(Ball, { matchId: id });

  const res = mockRes();
  await deleteEvent(asAdmin({ params: { id: String(eventId) } }), res);

  assert.ok(res.statusCode < 300, JSON.stringify(res.body));
  assert.equal(await Match.countDocuments({ _id: { $in: [listed, linked] } }), 0);
  assert.equal(await Ball.countDocuments({ matchId: { $in: [listed, linked] } }), 0);
  assert.equal(await Ball.countDocuments({ matchId: unrelated }), 1);
});

test("deleting a tournament removes the balls of its matches", async () => {
  const matchId = await insert(Match, { title: "Final" });
  const tournamentId = await insert(Tournament, { name: "Cup", matches: [matchId] });
  await seedMatchData(matchId);

  const res = mockRes();
  await deleteTournament(asAdmin({ params: { id: String(tournamentId) } }), res);

  assert.ok(res.statusCode < 300, JSON.stringify(res.body));
  assert.equal(await Match.countDocuments({ _id: matchId }), 0);
  assert.equal(await matchDataLeft(matchId), 0);
});
