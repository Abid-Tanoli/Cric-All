// T1.5: a league can play every pair twice and end with a final. Tri-series
// case: 3 teams -> 6 league fixtures + a final (1st v 2nd on the table).

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import Tournament from "../src/models/Tournament.js";
import Match from "../src/models/Match.js";
import Team from "../src/models/Team.js";
import { applyTournamentFixtures } from "../src/controllers/TournamentController.js";
import { fixturePairKey, planTournamentFixtures } from "../src/services/tournamentService.js";

const ids = (n) => Array.from({ length: n }, () => new mongoose.Types.ObjectId());
const concrete = (plan) => plan.matches.filter((m) => !m.isTbd);
const pairCounts = (matches) => {
  const counts = new Map();
  for (const m of matches) {
    const key = fixturePairKey(m.team1 ?? m.teams?.[0], m.team2 ?? m.teams?.[1]);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
};

test("one leg stays as before: 3 teams, 3 fixtures", () => {
  const plan = planTournamentFixtures({ teams: ids(3), type: "league" });
  assert.equal(plan.legs, 1);
  assert.equal(plan.totalMatches, 3);
  assert.ok([...pairCounts(concrete(plan)).values()].every((n) => n === 1));
});

test("a double round plays every pair twice, the second leg swapped and after the first", () => {
  const plan = planTournamentFixtures({ teams: ids(3), type: "league" }, { legs: 2 });

  assert.equal(plan.legs, 2);
  assert.equal(plan.totalMatches, 6);
  const fixtures = concrete(plan);
  assert.ok([...pairCounts(fixtures).values()].every((n) => n === 2), "each pair twice");

  const firstLeg = fixtures.slice(0, 3);
  const secondLeg = fixtures.slice(3);
  assert.ok(Math.max(...firstLeg.map((m) => m.round)) < Math.min(...secondLeg.map((m) => m.round)), "leg 2 rounds follow leg 1");
  for (const m of secondLeg) {
    const first = firstLeg.find((f) => fixturePairKey(f.team1, f.team2) === fixturePairKey(m.team1, m.team2));
    assert.equal(String(m.team1), String(first.team2), "the order is swapped in leg 2");
  }
});

test("3 teams, double round and a final: 6 fixtures plus a to-be-decided final", () => {
  const plan = planTournamentFixtures({ teams: ids(3), type: "league" }, { legs: 2, withFinal: true });

  assert.equal(plan.totalMatches, 6);
  const finals = plan.matches.filter((m) => m.stage === "final");
  assert.equal(finals.length, 1);
  const [final] = finals;
  assert.equal(final.isTbd, true);
  assert.equal(final.stageLabel, "Final");
  assert.deepEqual(final.seeds, ["1st on the points table", "2nd on the points table"]);
  assert.ok(final.round > Math.max(...concrete(plan).map((m) => m.round)), "the final comes last");
  assert.equal(final.matchNumber, plan.matches.length, "numbered after every league row");
});

test("a group stage can be doubled too; a final there is left to the knockout fixtures", () => {
  const [a, b, c, d] = ids(4);
  const plan = planTournamentFixtures(
    { type: "group-stage", groups: [{ name: "A", teams: [a, b] }, { name: "B", teams: [c, d] }] },
    { format: "group", legs: 2, withFinal: true },
  );
  assert.equal(plan.totalMatches, 4, "2 groups x 1 pair x 2 legs");
  assert.equal(plan.matches.filter((m) => m.stage === "final").length, 0);
  assert.match(plan.warnings.join(" "), /final after a group stage/);
});

let mongod;
before(async () => { mongod = await startTestDb(); });
after(async () => { await stopTestDb(mongod); });
beforeEach(async () => {
  await Promise.all([Team.deleteMany({}), Match.deleteMany({}), Tournament.deleteMany({})]);
});

async function triSeries() {
  const teams = await Team.create([{ name: "Tri Alpha" }, { name: "Tri Bravo" }, { name: "Tri Charlie" }]);
  return Tournament.create({
    name: "Tri Series",
    startDate: new Date("2026-12-01T00:00:00Z"),
    endDate: new Date("2026-12-10T00:00:00Z"),
    type: "league",
    format: "T20",
    teams: teams.map((t) => t._id),
  });
}

async function apply(tournament, body) {
  const res = mockRes();
  await applyTournamentFixtures(
    mockReq({ user: { role: "admin" }, principalType: "admin", params: { id: String(tournament._id) }, body: { startAt: "2026-12-02T09:00:00Z", ...body } }),
    res,
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body;
}

test("apply creates the 6 double-round fixtures, never the final, and a second apply adds nothing", async () => {
  const tournament = await triSeries();

  const first = await apply(tournament, { legs: 2, withFinal: true });
  assert.equal(first.applied, 6);
  const stored = await Match.find({ tournament: tournament._id }).lean();
  assert.equal(stored.length, 6);
  assert.ok([...pairCounts(stored).values()].every((n) => n === 2));
  assert.equal(stored.filter((m) => m.stage === "final").length, 0, "the final waits for the table");

  const again = await apply(tournament, { legs: 2, withFinal: true });
  assert.equal(again.applied, 0);
  assert.equal(again.skipped.length, 6);
  assert.equal(await Match.countDocuments({ tournament: tournament._id }), 6);
});

test("a second leg can be added to a league that was applied with one", async () => {
  const tournament = await triSeries();

  assert.equal((await apply(tournament, { legs: 1 })).applied, 3);
  const second = await apply(tournament, { legs: 2 });

  assert.equal(second.applied, 3, "only the missing second meetings");
  assert.equal(second.skipped.length, 3);
  const stored = await Match.find({ tournament: tournament._id }).lean();
  assert.ok([...pairCounts(stored).values()].every((n) => n === 2));
  assert.equal((await Tournament.findById(tournament._id)).matches.length, 6);
});
