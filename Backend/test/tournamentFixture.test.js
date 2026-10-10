import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { startTestDb, stopTestDb } from "./helpers/testDb.js";

import {
  validateTournamentTeamCount,
  findManualFixtureConflict,
} from "../src/controllers/TournamentController.js";
import {
  planTournamentFixtures,
  fixturePairKey,
  recomputeTournamentPoints,
} from "../src/services/tournamentService.js";
import Tournament from "../src/models/Tournament.js";
import Match from "../src/models/Match.js";
import Team from "../src/models/Team.js";

// ---------------------------------------------------------------------------
// Pure helpers (no DB)
// ---------------------------------------------------------------------------

test("team-count rule: knockout >=2, league >=3, group-stage/mixed >=4", () => {
  assert.equal(validateTournamentTeamCount("knockout", ["a", "b"], 2), null);
  assert.ok(validateTournamentTeamCount("knockout", ["a"], 1));

  assert.ok(validateTournamentTeamCount("league", ["a", "b"], 2), "league needs 3");
  assert.equal(validateTournamentTeamCount("league", ["a", "b", "c"], 3), null);

  assert.ok(validateTournamentTeamCount("group-stage", ["a", "b", "c"], 3));
  assert.equal(validateTournamentTeamCount("group-stage", ["a", "b", "c", "d"], 4), null);
  assert.equal(validateTournamentTeamCount("mixed", ["a", "b", "c", "d"], 4), null);
});

test("team-count rule rejects duplicate team ids", () => {
  assert.ok(validateTournamentTeamCount("league", ["a", "a", "b"], 3));
});

test("fixture pair key is unordered", () => {
  assert.equal(fixturePairKey("aaa", "bbb"), fixturePairKey("bbb", "aaa"));
});

test("manual fixture: same pair + same round + same group is a duplicate", () => {
  const t1 = new mongoose.Types.ObjectId();
  const t2 = new mongoose.Types.ObjectId();
  const existing = [{ teams: [t1, t2], round: 1, group: "", status: "upcoming" }];

  const dup = findManualFixtureConflict({ existingMatches: existing, team1: t1, team2: t2, round: 1, group: "" });
  assert.equal(dup?.reason, "duplicate");

  const otherRound = findManualFixtureConflict({ existingMatches: existing, team1: t2, team2: t1, round: 2, group: "" });
  assert.equal(otherRound, null, "a different round is allowed");
});

test("manual fixture: double-booking one team at the same startAt is rejected", () => {
  const t1 = new mongoose.Types.ObjectId();
  const t2 = new mongoose.Types.ObjectId();
  const t3 = new mongoose.Types.ObjectId();
  const startAt = new Date("2026-10-11T09:00:00Z");
  const existing = [{ teams: [t1, t2], round: 1, group: "", status: "upcoming", startAt }];

  const clash = findManualFixtureConflict({ existingMatches: existing, team1: t1, team2: t3, round: 2, group: "", startAt });
  assert.equal(clash?.reason, "double_booked");

  const noClash = findManualFixtureConflict({ existingMatches: existing, team1: t2, team2: t3, round: 3, group: "", startAt: new Date("2026-10-11T12:00:00Z") });
  assert.equal(noClash, null);
});

test("manual fixture: a completed match does not block double-booking", () => {
  const t1 = new mongoose.Types.ObjectId();
  const t2 = new mongoose.Types.ObjectId();
  const startAt = new Date("2026-10-11T09:00:00Z");
  const existing = [{ teams: [t1, t2], round: 1, group: "", status: "completed", startAt }];

  const clash = findManualFixtureConflict({ existingMatches: existing, team1: t1, team2: t2, round: 5, group: "", startAt });
  assert.equal(clash, null);
});

test("round-robin plan for N teams has N*(N-1)/2 unique pairs", () => {
  const teams = ["a", "b", "c", "d", "e"].map(() => new mongoose.Types.ObjectId());
  const plan = planTournamentFixtures({ teams, type: "league", format: "T20" });

  assert.equal(plan.totalMatches, (teams.length * (teams.length - 1)) / 2);
  assert.ok(plan.tbdMatches >= 1, "odd team count yields a bye");

  const seen = new Set();
  for (const m of plan.matches.filter((x) => !x.isTbd)) {
    const key = fixturePairKey(m.team1, m.team2);
    assert.ok(!seen.has(key), "no pair should repeat");
    seen.add(key);
  }
  assert.equal(seen.size, plan.totalMatches);
});

test("knockout plan pads to a power of two with byes on later rounds", () => {
  const teams = ["a", "b", "c"].map(() => new mongoose.Types.ObjectId());
  const plan = planTournamentFixtures({ teams, type: "knockout" });

  assert.equal(plan.format, "knockout");
  assert.ok(plan.tbdMatches >= 1, "3 teams -> one bye into a 4-slot bracket");
});

// ---------------------------------------------------------------------------
// Points recompute idempotency (real in-memory Mongo)
// ---------------------------------------------------------------------------

test("recomputeTournamentPoints is idempotent and never double-counts", async (t) => {
  const mongod = await startTestDb();
  t.after(async () => stopTestDb(mongod));

  const team1Doc = await Team.create({ name: "Oct11 Team A" });
  const team2Doc = await Team.create({ name: "Oct11 Team B" });
  const team1 = team1Doc._id;
  const team2 = team2Doc._id;

  const tournament = await Tournament.create({
    name: "Oct11 Idempotency Cup",
    startDate: new Date("2026-10-10T00:00:00Z"),
    endDate: new Date("2026-10-12T00:00:00Z"),
    type: "league",
    teams: [team1, team2],
    pointsConfig: { win: 2, tie: 1, noResult: 1 },
  });

  const match = await Match.create({
    title: "Idempotency Cup - Match 1",
    matchNumber: 1,
    matchType: "T20",
    totalOvers: 20,
    matchCategory: "Other",
    tournament: tournament._id,
    teams: [team1, team2],
    startAt: new Date("2026-10-11T09:00:00Z"),
    status: "completed",
    result: { winner: team1, resultType: "normal" },
    innings: [
      { runs: 100, wickets: 6, balls: 120 },
      { runs: 80, wickets: 8, balls: 120 },
    ],
  });

  tournament.matches.push(match._id);
  await tournament.save();

  const first = await recomputeTournamentPoints(tournament._id);
  const rowA1 = first.pointsTable.find((r) => String(r.team) === String(team1));
  const rowB1 = first.pointsTable.find((r) => String(r.team) === String(team2));
  assert.equal(rowA1.points, 2);
  assert.equal(rowA1.won, 1);
  assert.equal(rowA1.matchesPlayed, 1);
  assert.equal(rowB1.points, 0);
  assert.equal(rowB1.lost, 1);
  assert.equal(rowA1.netRunRate, 1);

  const second = await recomputeTournamentPoints(tournament._id);
  const rowA2 = second.pointsTable.find((r) => String(r.team) === String(team1));
  assert.equal(rowA2.points, 2, "second recompute must not double the points");
  assert.equal(rowA2.matchesPlayed, 1, "second recompute must not double matches played");
});
