// T1.4: an owner sets the points per result, and the points table follows at
// once instead of waiting for the next completed match or a manual recompute.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import Tournament from "../src/models/Tournament.js";
import Match from "../src/models/Match.js";
import Team from "../src/models/Team.js";
import { updateTournament } from "../src/controllers/TournamentController.js";
import { recomputeTournamentPoints } from "../src/services/tournamentService.js";

let mongod;
before(async () => { mongod = await startTestDb(); });
after(async () => { await stopTestDb(mongod); });
beforeEach(async () => {
  await Promise.all([Team.deleteMany({}), Match.deleteMany({}), Tournament.deleteMany({})]);
});

const startAt = new Date("2026-12-02T09:00:00Z");

// A beat B; B and C tied; C and A were washed out.
async function playedLeague() {
  const [A, B, C] = await Team.create([{ name: "Points Alpha" }, { name: "Points Bravo" }, { name: "Points Charlie" }]);
  const tournament = await Tournament.create({
    name: "Points League",
    startDate: new Date("2026-12-01T00:00:00Z"),
    endDate: new Date("2026-12-10T00:00:00Z"),
    type: "league",
    teams: [A._id, B._id, C._id],
  });
  const base = { matchType: "T20", totalOvers: 20, tournament: tournament._id, startAt, status: "completed" };
  const matches = await Match.create([
    {
      ...base,
      title: "Alpha v Bravo",
      teams: [A._id, B._id],
      result: { winner: A._id, resultType: "normal" },
      innings: [{ team: A._id, runs: 150, wickets: 5, balls: 120 }, { team: B._id, runs: 120, wickets: 9, balls: 120 }],
    },
    {
      ...base,
      title: "Bravo v Charlie",
      teams: [B._id, C._id],
      result: { resultType: "tie" },
      innings: [{ team: B._id, runs: 140, wickets: 6, balls: 120 }, { team: C._id, runs: 140, wickets: 7, balls: 120 }],
    },
    { ...base, title: "Charlie v Alpha", teams: [C._id, A._id], result: { resultType: "no result" }, innings: [] },
  ]);
  tournament.matches = matches.map((m) => m._id);
  await tournament.save();
  await recomputeTournamentPoints(tournament._id);
  return { tournament, A, B, C };
}

const pointsOf = (table, team) => table.find((row) => String(row.team?._id || row.team) === String(team._id))?.points;

async function update(tournamentId, body) {
  const res = mockRes();
  await updateTournament(
    mockReq({ user: { role: "admin" }, principalType: "admin", params: { id: String(tournamentId) }, body }),
    res,
  );
  return res;
}

test("the default 2/1/1 table before anything is changed", async () => {
  const { tournament, A, B, C } = await playedLeague();
  const { pointsTable } = await Tournament.findById(tournament._id).lean();
  assert.equal(pointsOf(pointsTable, A), 3, "win 2 + no result 1");
  assert.equal(pointsOf(pointsTable, B), 1, "tie 1");
  assert.equal(pointsOf(pointsTable, C), 2, "tie 1 + no result 1");
});

test("saving three new numbers stores them and rebuilds the table in the same request", async () => {
  const { tournament, A, B, C } = await playedLeague();

  const res = await update(tournament._id, { pointsConfig: { win: 4, tie: 2, noResult: 0 } });

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const answered = res.body.tournament;
  assert.deepEqual(
    { win: answered.pointsConfig.win, tie: answered.pointsConfig.tie, noResult: answered.pointsConfig.noResult },
    { win: 4, tie: 2, noResult: 0 },
  );
  assert.equal(pointsOf(answered.pointsTable, A), 4, "the response already has the new table");
  assert.equal(pointsOf(answered.pointsTable, B), 2);
  assert.equal(pointsOf(answered.pointsTable, C), 2);

  const stored = await Tournament.findById(tournament._id).lean();
  assert.equal(pointsOf(stored.pointsTable, A), 4);
  assert.equal(pointsOf(stored.pointsTable, C), 2, "tie 2 + no result 0");
});

test("an update that leaves the points alone does not touch the table", async () => {
  const { tournament, A } = await playedLeague();
  // Make the stored table stale on purpose: only a recompute would fix it.
  await Tournament.updateOne({ _id: tournament._id, "pointsTable.team": A._id }, { $set: { "pointsTable.$.points": 99 } });

  const res = await update(tournament._id, { venue: "National Stadium" });

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const stored = await Tournament.findById(tournament._id).lean();
  assert.equal(pointsOf(stored.pointsTable, A), 99);
});
