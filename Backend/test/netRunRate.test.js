// T1.1: net run rate and no-result points.
//
// Reproduced before the fix:
//   * innings were mapped to teams by array position, so when teams[1] batted
//     first the winner got a negative NRR and the loser a positive one;
//   * every innings was charged the full quota, so a 10-over chase of 101 was
//     worth +0.05 instead of +5.10;
//   * abandoned matches gave no points.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { startTestDb, stopTestDb } from "./helpers/testDb.js";
import Team from "../src/models/Team.js";
import Match from "../src/models/Match.js";
import Tournament from "../src/models/Tournament.js";
import TeamRanking from "../src/models/TeamRanking.js";
import { recomputeTournamentPoints } from "../src/services/tournamentService.js";
import { computeTeamRanking } from "../src/services/rankingService.js";
import {
  chargedBalls,
  inningsBalls,
  matchRunTotals,
  netRunRate,
} from "../src/services/netRunRate.js";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test("overs come from legal balls, and '12.4' means 12 overs 4 balls", () => {
  assert.equal(inningsBalls({ balls: 76 }), 76);
  assert.equal(inningsBalls({ overs: "12.4" }), 76);
  assert.equal(inningsBalls({ overs: 12.4 }), 76);
  assert.equal(inningsBalls({ overs: 20 }), 120);
  assert.equal(inningsBalls({}), 0);
});

test("a side bowled out is charged the full quota", () => {
  const match = { totalOvers: 20, matchType: "T20" };
  assert.equal(chargedBalls({ wickets: 10, balls: 90 }, match), 120);
  assert.equal(chargedBalls({ wickets: 9, balls: 90 }, match), 90);
  assert.equal(chargedBalls({ wickets: 10, balls: 90 }, {}), 90, "no quota known: actual balls");
});

test("netRunRate handles empty sides and rounds to three places", () => {
  assert.equal(netRunRate({}), 0);
  assert.equal(netRunRate({ runsFor: 101, ballsFor: 60, runsAgainst: 100, ballsAgainst: 120 }), 5.1);
  assert.equal(netRunRate({ runsFor: 100, ballsFor: 120 }), 5);
});

test("matchRunTotals follows innings.team, not array order", () => {
  const a = "a".repeat(24);
  const b = "b".repeat(24);
  const totals = matchRunTotals({
    totalOvers: 20,
    teams: [a, b],
    innings: [
      { team: b, runs: 160, wickets: 5, balls: 120 },
      { team: a, runs: 100, wickets: 8, balls: 120 },
    ],
  });
  assert.deepEqual(totals.get(a), { runsFor: 100, ballsFor: 120, runsAgainst: 160, ballsAgainst: 120 });
  assert.deepEqual(totals.get(b), { runsFor: 160, ballsFor: 120, runsAgainst: 100, ballsAgainst: 120 });
});

// ---------------------------------------------------------------------------
// Points table and team rankings
// ---------------------------------------------------------------------------

let mongod;
let A;
let B;
let C;

before(async () => {
  mongod = await startTestDb();
});
after(async () => {
  await stopTestDb(mongod);
});
beforeEach(async () => {
  await Promise.all([Team.deleteMany({}), Match.deleteMany({}), Tournament.deleteMany({}), TeamRanking.deleteMany({})]);
  [A, B, C] = await Team.create([{ name: "NRR Alpha" }, { name: "NRR Bravo" }, { name: "NRR Charlie" }]);
});

let counter = 0;
async function league(teams, matches) {
  counter += 1;
  const tournament = await Tournament.create({
    name: `NRR League ${counter}`,
    startDate: new Date("2026-12-01T00:00:00Z"),
    endDate: new Date("2026-12-10T00:00:00Z"),
    type: "league",
    teams: teams.map((t) => t._id),
  });
  const docs = [];
  for (const m of matches) {
    docs.push(
      await Match.create({
        title: `NRR match ${docs.length + 1}`,
        matchType: "T20",
        totalOvers: 20,
        tournament: tournament._id,
        startAt: new Date("2026-12-02T09:00:00Z"),
        ...m,
      }),
    );
  }
  tournament.matches = docs.map((d) => d._id);
  await tournament.save();
  const recomputed = await recomputeTournamentPoints(tournament._id);
  const row = (team) => recomputed.pointsTable.find((r) => String(r.team) === String(team._id));
  return { row, matches: docs };
}

test("when the second-listed team bats first, the winner still gets the positive NRR", async () => {
  const { row } = await league([A, B], [
    {
      teams: [A._id, B._id],
      status: "completed",
      result: { winner: B._id, resultType: "normal" },
      innings: [
        { team: B._id, runs: 160, wickets: 5, balls: 120 },
        { team: A._id, runs: 100, wickets: 8, balls: 120 },
      ],
    },
  ]);
  assert.equal(row(B).points, 2);
  assert.equal(row(B).netRunRate, 3);
  assert.equal(row(A).netRunRate, -3);
  assert.equal(row(B).for, 160);
  assert.equal(row(B).against, 100);
  assert.equal(row(A).wicketsAgainst, 8, "A lost 8 wickets");
  assert.equal(row(B).wicketsFor, 8, "B took 8 wickets");
});

test("an early chase is charged only the overs it took", async () => {
  const { row } = await league([A, B], [
    {
      teams: [A._id, B._id],
      status: "completed",
      result: { winner: B._id, resultType: "normal" },
      innings: [
        { team: A._id, runs: 100, wickets: 5, balls: 120 },
        { team: B._id, runs: 101, wickets: 0, balls: 60 },
      ],
    },
  ]);
  assert.equal(row(B).netRunRate, 5.1);
  assert.equal(row(A).netRunRate, -5.1);
});

test("a side bowled out early is charged its full 20 overs", async () => {
  const { row } = await league([A, B], [
    {
      teams: [A._id, B._id],
      status: "completed",
      result: { winner: B._id, resultType: "normal" },
      innings: [
        { team: A._id, runs: 90, wickets: 10, balls: 90 },
        { team: B._id, runs: 91, wickets: 2, balls: 60 },
      ],
    },
  ]);
  // A: 90/20 - 91/10 = 4.5 - 9.1; B: 91/10 - 90/20 = 9.1 - 4.5
  assert.equal(row(A).netRunRate, -4.6);
  assert.equal(row(B).netRunRate, 4.6);
});

test("manual scorecards with only an overs figure use real overs", async () => {
  const { row } = await league([A, B], [
    {
      teams: [A._id, B._id],
      status: "completed",
      source: "manual",
      result: { winner: A._id, resultType: "normal" },
      innings: [
        { team: A._id, runs: 120, wickets: 9, overs: 20 },
        { team: B._id, runs: 95, wickets: 7, overs: "12.4" },
      ],
    },
  ]);
  // A: 120/20 - 95/(76/6) = 6 - 7.5 = -1.5 ; B: +1.5
  assert.equal(row(A).netRunRate, -1.5);
  assert.equal(row(B).netRunRate, 1.5);
});

test("an abandoned match gives both sides the no-result points and leaves NRR alone", async () => {
  const { row } = await league([A, B], [
    {
      teams: [A._id, B._id],
      status: "abandoned",
      result: { resultType: "no result" },
      innings: [{ team: A._id, runs: 40, wickets: 1, balls: 30 }],
    },
  ]);
  for (const team of [A, B]) {
    assert.equal(row(team).matchesPlayed, 1);
    assert.equal(row(team).noResult, 1);
    assert.equal(row(team).points, 1);
    assert.equal(row(team).netRunRate, 0);
    assert.equal(row(team).for, 0);
    assert.deepEqual([...row(team).seriesForm], ["NR"]);
  }
});

test("a postponed match counts for nothing", async () => {
  const { row } = await league([A, B], [
    { teams: [A._id, B._id], status: "postponed", innings: [] },
  ]);
  assert.equal(row(A).matchesPlayed, 0);
  assert.equal(row(A).points, 0);
});

test("a tie settled by a super over gives the winner the points; NRR uses the main innings", async () => {
  const { row } = await league([A, B], [
    {
      teams: [A._id, B._id],
      status: "completed",
      result: { winner: A._id, resultType: "super_over" },
      innings: [
        { team: A._id, runs: 150, wickets: 6, balls: 120 },
        { team: B._id, runs: 150, wickets: 8, balls: 120 },
      ],
    },
  ]);
  assert.equal(row(A).points, 2);
  assert.equal(row(A).won, 1);
  assert.equal(row(B).lost, 1);
  assert.equal(row(A).netRunRate, 0);
});

test("a three-match table matches the hand calculation", async () => {
  const { row } = await league([A, B, C], [
    {
      teams: [A._id, B._id],
      status: "completed",
      result: { winner: A._id, resultType: "normal" },
      innings: [
        { team: A._id, runs: 160, wickets: 4, balls: 120 },
        { team: B._id, runs: 140, wickets: 9, balls: 120 },
      ],
    },
    {
      teams: [B._id, C._id],
      status: "completed",
      result: { winner: C._id, resultType: "normal" },
      innings: [
        { team: C._id, runs: 120, wickets: 10, balls: 102 },
        { team: B._id, runs: 110, wickets: 10, balls: 108 },
      ],
    },
    {
      teams: [C._id, A._id],
      status: "abandoned",
      result: { resultType: "no result" },
      innings: [],
    },
  ]);
  // A: 160/20 - 140/20 = 1.000; 3 points (win + no result)
  assert.equal(row(A).points, 3);
  assert.equal(row(A).netRunRate, 1);
  // B: scored 140+110 in 20+20 overs (bowled out -> 20), conceded 160+120 in 20+20
  //    (C bowled out -> 20): 250/40 - 280/40 = -0.75
  assert.equal(row(B).points, 0);
  assert.equal(row(B).netRunRate, -0.75);
  // C: 120/20 - 110/20 = 0.5; 3 points (win + no result)
  assert.equal(row(C).points, 3);
  assert.equal(row(C).netRunRate, 0.5);
});

test("recomputing twice gives the same table", async () => {
  const { matches } = await league([A, B], [
    {
      teams: [A._id, B._id],
      status: "completed",
      result: { winner: B._id, resultType: "normal" },
      innings: [
        { team: B._id, runs: 160, wickets: 5, balls: 120 },
        { team: A._id, runs: 100, wickets: 8, balls: 120 },
      ],
    },
  ]);
  const tournamentId = matches[0].tournament;
  const first = await recomputeTournamentPoints(tournamentId);
  const second = await recomputeTournamentPoints(tournamentId);
  const strip = (t) => t.pointsTable.map((r) => ({ team: String(r.team), points: r.points, nrr: r.netRunRate, played: r.matchesPlayed }));
  assert.deepEqual(strip(second), strip(first));
});

test("team rankings use the same NRR as the points table", async () => {
  await Match.create({
    title: "Ranking NRR",
    matchType: "T20",
    totalOvers: 20,
    teams: [A._id, B._id],
    startAt: new Date("2026-12-02T09:00:00Z"),
    status: "completed",
    result: { winner: B._id, resultType: "normal" },
    innings: [
      { team: A._id, runs: 90, wickets: 10, balls: 90 },
      { team: B._id, runs: 91, wickets: 2, balls: 60 },
    ],
  });
  await computeTeamRanking(String(A._id));
  await computeTeamRanking(String(B._id));
  const a = await TeamRanking.findOne({ team: A._id }).lean();
  const b = await TeamRanking.findOne({ team: B._id }).lean();
  assert.equal(a.netRunRate, -4.6);
  assert.equal(b.netRunRate, 4.6);
});
