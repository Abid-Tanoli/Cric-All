import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";

import mongoose from "mongoose";
import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import Tournament from "../src/models/Tournament.js";
import Team from "../src/models/Team.js";
import Match from "../src/models/Match.js";
import {
  createTournamentMatch,
  findStageProgressionError,
  stageWinnerIds,
  normalizeStage,
} from "../src/controllers/TournamentController.js";
import {
  knockoutStageForRound,
  knockoutStageLabel,
} from "../src/services/tournamentService.js";

// P3: a knockout bracket. Round names come from the plan, an admin draws the
// semi-final and the final by hand, and the server refuses to draw them from
// anything other than the previous round's winners.

// --- pure helpers (no DB) ---------------------------------------------------

test("knockoutStageForRound names only the last three rounds", () => {
  assert.equal(knockoutStageForRound(1, 3), "quarter_final");
  assert.equal(knockoutStageForRound(2, 3), "semi_final");
  assert.equal(knockoutStageForRound(3, 3), "final");

  assert.equal(knockoutStageForRound(1, 2), "semi_final");
  assert.equal(knockoutStageForRound(2, 2), "final");

  assert.equal(knockoutStageForRound(1, 4), "", "a round of 16 is not a quarter-final");
  assert.equal(knockoutStageForRound(2, 4), "quarter_final");
});

test("knockoutStageLabel reads as QF1..QF4, SF1, SF2, Final", () => {
  assert.equal(knockoutStageLabel("quarter_final", 1), "QF1");
  assert.equal(knockoutStageLabel("quarter_final", 4), "QF4");
  assert.equal(knockoutStageLabel("semi_final", 2), "SF2");
  assert.equal(knockoutStageLabel("final", 1), "Final");
  assert.equal(knockoutStageLabel("", 1), "");
});

test("stageWinnerIds counts only completed winners at the requested stage", () => {
  const matches = [
    { stage: "quarter_final", status: "completed", result: { winner: "t1" } },
    { stage: "quarter_final", status: "completed", result: { winner: { _id: "t4" } } },
    { stage: "quarter_final", status: "live", result: { winner: "t7" } },
    { stage: "semi_final", status: "completed", result: { winner: "t9" } },
    { stage: "quarter_final", status: "completed", result: {} },
    null,
  ];
  const winners = stageWinnerIds(matches, "quarter_final");
  assert.deepEqual([...winners].sort(), ["t1", "t4"]);
  assert.equal(winners.has("t7"), false, "an unfinished tie has no winner yet");
  assert.equal(winners.has("t9"), false, "another stage's winner is not eligible");
});

test("a semi-final may only be drawn from quarter-final winners", () => {
  const existing = [
    { stage: "quarter_final", status: "completed", result: { winner: "a" } },
    { stage: "quarter_final", status: "completed", result: { winner: "b" } },
  ];
  assert.equal(
    findStageProgressionError({ stage: "semi_final", team1: "a", team2: "b", existingMatches: existing }),
    null,
  );

  const refused = findStageProgressionError({
    stage: "semi_final",
    team1: "a",
    team2: "c",
    existingMatches: existing,
  });
  assert.equal(refused?.reason, "team_not_advancing");
  assert.match(refused.message, /quarter-final/);
});

test("a final may only be drawn from semi-final winners", () => {
  const existing = [
    { stage: "semi_final", status: "completed", result: { winner: "x" } },
    { stage: "semi_final", status: "completed", result: { winner: "y" } },
  ];
  assert.equal(
    findStageProgressionError({ stage: "final", team1: "x", team2: "y", existingMatches: existing }),
    null,
  );
  assert.equal(
    findStageProgressionError({ stage: "final", team1: "x", team2: "q", existingMatches: existing })?.reason,
    "team_not_advancing",
  );
});

test("a knockout fixture is refused before its prior round has been played", () => {
  assert.equal(
    findStageProgressionError({ stage: "semi_final", team1: "a", team2: "b", existingMatches: [{ stage: "quarter_final", status: "upcoming" }] })?.reason,
    "no_prior_winner",
  );
  assert.equal(
    findStageProgressionError({ stage: "semi_final", team1: "a", team2: "b", existingMatches: [] })?.reason,
    "no_prior_stage",
  );
});

test("league, group and third-place fixtures are not gated", () => {
  assert.equal(findStageProgressionError({ stage: "", team1: "a", team2: "b", existingMatches: [] }), null);
  assert.equal(findStageProgressionError({ stage: "quarter_final", team1: "a", team2: "b", existingMatches: [] }), null);
  assert.equal(findStageProgressionError({ stage: "third_place", team1: "a", team2: "b", existingMatches: [] }), null);
  assert.equal(findStageProgressionError({ stage: "not_a_stage", team1: "a", team2: "b", existingMatches: [] }), null);

  assert.equal(normalizeStage("semi_final"), "semi_final");
  assert.equal(normalizeStage("banana"), "");
  assert.equal(normalizeStage(undefined), "");
});

// --- createTournamentMatch over a real throwaway database --------------------

let mongod;
let seq = 0;

before(async () => {
  mongod = await startTestDb();
});

after(async () => {
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Promise.all([
    Tournament.deleteMany({}),
    Team.deleteMany({}),
    Match.deleteMany({}),
  ]);
});

const unique = (label) => `OPENCODE_TEST P3 ${label} ${++seq}`;

async function makeQf({ tournament, a, b, winner, matchNumber = 1, status = "completed" }) {
  return Match.create({
    title: unique("QF"),
    matchNumber,
    venue: "OPENCODE_TEST Ground",
    matchType: "T20",
    round: `QF${matchNumber}`,
    stage: "quarter_final",
    stageLabel: `QF${matchNumber}`,
    tournament: tournament._id,
    teams: [a, b],
    startAt: new Date("2026-10-11"),
    status,
    result: status === "completed" ? { winner, description: "won", resultType: "normal" } : undefined,
  });
}

async function makeKnockoutTournament() {
  const teams = await Team.create([
    { name: unique("A") },
    { name: unique("B") },
    { name: unique("C") },
    { name: unique("D") },
  ]);
  const tournament = await Tournament.create({
    name: unique("Cup"),
    type: "knockout",
    startDate: new Date("2026-10-01"),
    endDate: new Date("2026-10-31"),
    teams: teams.map((t) => t._id),
  });
  return { tournament, teams };
}

test("a semi-final from quarter-final winners is accepted and stays a TBD fixture", async () => {
  const { tournament, teams } = await makeKnockoutTournament();
  await makeQf({ tournament, a: teams[0]._id, b: teams[1]._id, winner: teams[0]._id, matchNumber: 1 });
  await makeQf({ tournament, a: teams[2]._id, b: teams[3]._id, winner: teams[2]._id, matchNumber: 2 });

  const res = mockRes();
  await createTournamentMatch(
    mockReq({
      params: { tournamentId: String(tournament._id) },
      body: { team1: String(teams[0]._id), team2: String(teams[2]._id), stage: "semi_final", stageLabel: "SF1" },
      user: { _id: new mongoose.Types.ObjectId(), name: "OPENCODE_TEST Admin" },
    }),
    res,
  );

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.match.stage, "semi_final");
  assert.equal(res.body.match.stageLabel, "SF1");
  assert.equal(res.body.match.startAt, null, "a fixture with no date stays TBD");

  const qfCount = await Match.countDocuments({ tournament: tournament._id, stage: "quarter_final" });
  assert.equal(qfCount, 2, "the quarter-finals are untouched");
});

test("a semi-final drawn from a team that did not win is refused", async () => {
  const { tournament, teams } = await makeKnockoutTournament();
  await makeQf({ tournament, a: teams[0]._id, b: teams[1]._id, winner: teams[0]._id, matchNumber: 1 });
  await makeQf({ tournament, a: teams[2]._id, b: teams[3]._id, winner: teams[2]._id, matchNumber: 2 });

  const res = mockRes();
  await createTournamentMatch(
    mockReq({
      params: { tournamentId: String(tournament._id) },
      // teams[3] is in the tournament but lost its quarter-final.
      body: { team1: String(teams[0]._id), team2: String(teams[3]._id), stage: "semi_final" },
      user: { _id: new mongoose.Types.ObjectId(), name: "OPENCODE_TEST Admin" },
    }),
    res,
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.reason, "team_not_advancing");
  assert.equal(await Match.countDocuments({ stage: "semi_final" }), 0, "nothing was written");
});

test("drawing the same semi-final twice is refused as a duplicate", async () => {
  const { tournament, teams } = await makeKnockoutTournament();
  await makeQf({ tournament, a: teams[0]._id, b: teams[1]._id, winner: teams[0]._id, matchNumber: 1 });
  await makeQf({ tournament, a: teams[2]._id, b: teams[3]._id, winner: teams[2]._id, matchNumber: 2 });

  const draw = async () => {
    const res = mockRes();
    await createTournamentMatch(
      mockReq({
        params: { tournamentId: String(tournament._id) },
        body: { team1: String(teams[0]._id), team2: String(teams[2]._id), stage: "semi_final" },
        user: { _id: new mongoose.Types.ObjectId(), name: "OPENCODE_TEST Admin" },
      }),
      res,
    );
    return res;
  };

  const first = await draw();
  const second = await draw();

  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 409, "the second draw of the same pair is a duplicate");
  assert.equal(second.body.reason, "duplicate");
  assert.equal(await Match.countDocuments({ stage: "semi_final" }), 1, "only one semi-final exists");
});

test("the final cannot be drawn while the semi-finals are unplayed", async () => {
  const { tournament, teams } = await makeKnockoutTournament();
  // An unplayed semi-final: the stage exists but has no winner yet.
  await Match.create({
    title: unique("SF"),
    matchNumber: 5,
    venue: "OPENCODE_TEST Ground",
    matchType: "T20",
    stage: "semi_final",
    stageLabel: "SF1",
    round: "semi_final",
    tournament: tournament._id,
    teams: [teams[0]._id, teams[1]._id],
    status: "upcoming",
  });

  const res = mockRes();
  await createTournamentMatch(
    mockReq({
      params: { tournamentId: String(tournament._id) },
      body: { team1: String(teams[0]._id), team2: String(teams[1]._id), stage: "final" },
      user: { _id: new mongoose.Types.ObjectId(), name: "OPENCODE_TEST Admin" },
    }),
    res,
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.reason, "no_prior_winner");
  assert.match(res.body.message, /semi-final/);
});

test("an ordinary fixture keeps its behaviour: no stage, no date means now", async () => {
  const { tournament, teams } = await makeKnockoutTournament();

  const res = mockRes();
  await createTournamentMatch(
    mockReq({
      params: { tournamentId: String(tournament._id) },
      body: { team1: String(teams[0]._id), team2: String(teams[1]._id) },
      user: { _id: new mongoose.Types.ObjectId(), name: "OPENCODE_TEST Admin" },
    }),
    res,
  );

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.match.stage, "");
  assert.equal(res.body.match.round, 1);
  assert.ok(res.body.match.startAt instanceof Date, "a non-knockout fixture still defaults to now");
});
