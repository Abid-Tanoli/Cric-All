import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";

process.env.JWT_SECRET = process.env.JWT_SECRET || "create-semi-finals-test-secret";

import { startTestDb, stopTestDb } from "./helpers/testDb.js";
import Tournament from "../src/models/Tournament.js";
import Team from "../src/models/Team.js";
import Match from "../src/models/Match.js";
import tournamentContentRoutes from "../src/routes/tournamentContentRoutes.js";
import { buildTournamentBracket } from "../src/services/tournamentBracket.js";
import {
  TOURNAMENT_NAME,
  SEMI_FINALS,
  isTestTarget,
  resolveTeamByName,
  findExistingSemiFinal,
  matchCategoryFor,
  runCreateSemiFinals,
} from "../src/scripts/createSemiFinals.js";

// The semi-final script is exercised against a throwaway mongodb-memory-server
// database. Nothing connects to a real environment, the default is asserted to
// write nothing, and the public standings endpoint is called over HTTP.

let mongod;
let server;
let base;
let seq = 0;

const noLog = () => {};

async function seedTournament() {
  const names = [
    "Baldia Zalmi",
    "Sky Sports",
    "Young Star",
    "Khan Associates",
    "Orangi Warriors",
    "Orangi United",
    "Malir Friends",
    "Gulshan XI",
  ];
  const teams = await Team.create(names.map((name) => ({ name })));
  const byName = new Map(teams.map((team) => [team.name, team]));

  const tournament = await Tournament.create({
    name: TOURNAMENT_NAME,
    slug: `all-baldia-${++seq}`,
    type: "knockout",
    format: "T20",
    venue: "Tahirabad Ground",
    startDate: new Date("2026-10-01T00:00:00.000Z"),
    endDate: new Date("2026-10-31T00:00:00.000Z"),
    teams: teams.map((team) => team._id),
    rules: { twelfthManEnabled: true },
  });

  // The real QF winners: QF1 Young Star, QF2 Sky Sports, QF3 Baldia Zalmi,
  // QF4 Khan Associates.
  const qfWinners = ["Young Star", "Sky Sports", "Baldia Zalmi", "Khan Associates"];
  const losers = ["Orangi Warriors", "Orangi United", "Malir Friends", "Gulshan XI"];
  const qfIds = [];
  for (let index = 0; index < 4; index += 1) {
    const winner = byName.get(qfWinners[index]);
    const loser = byName.get(losers[index]);
    const match = await Match.create({
      title: `QF${index + 1}: ${winner.name} vs ${loser.name}`,
      matchNumber: index + 1,
      venue: "Tahirabad Ground",
      matchType: "T20",
      totalOvers: 20,
      matchCategory: "Club",
      matchSubcategory: TOURNAMENT_NAME,
      round: `QF${index + 1}`,
      stage: "quarter_final",
      stageLabel: `QF${index + 1}`,
      tournament: tournament._id,
      teams: [winner._id, loser._id],
      status: "completed",
      source: "manual",
      startAt: new Date("2026-10-18T04:30:00.000Z"),
      result: { resultType: "normal", winner: winner._id, description: `${winner.name} won` },
      innings: [
        { team: winner._id, runs: 150 + index, wickets: 6, balls: 120, status: "completed" },
        { team: loser._id, runs: 140 + index, wickets: 9, balls: 120, status: "completed" },
      ],
    });
    qfIds.push(match._id);
  }

  tournament.matches = qfIds;
  await tournament.save();
  return { tournament, teams, byName };
}

before(async () => {
  mongod = await startTestDb();
  const app = express();
  app.use(express.json());
  app.use("/api/tournaments", tournamentContentRoutes);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => {
    server?.closeAllConnections?.();
    server?.close(resolve);
  });
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Promise.all([Match.deleteMany({}), Tournament.deleteMany({}), Team.deleteMany({})]);
});

// ---------------------------------------------------------------------------
// Pure helper guards
// ---------------------------------------------------------------------------

test("the test/e2e DB guard catches e2e and test names but not production", () => {
  assert.equal(isTestTarget("cric-all-e2e", "production"), true);
  assert.equal(isTestTarget("cricall_test", "production"), true);
  assert.equal(isTestTarget("cric-all", "test"), true);
  assert.equal(isTestTarget("cric-all", "production"), false);
});

test("team resolution is exact-name only and ambiguity is refused", async () => {
  const teams = [
    { _id: "t1", name: "Baldia Zalmi" },
    { _id: "t2", name: "Sky Sports" },
    { _id: "t3", name: "Sky  Sports" },
  ];
  assert.equal(resolveTeamByName(teams, "baldia zalmi").team._id, "t1");
  assert.match(resolveTeamByName(teams, "Baldia").error, /not found/);
  assert.match(resolveTeamByName(teams, "Sky Sports").error, /ambiguous/);
});

test("an existing semi-final is skipped by label or by pair, and a conflicting label is blocked", () => {
  const existing = [
    {
      _id: "m1",
      stage: "semi_final",
      stageLabel: "SF1",
      teams: ["a", "b"],
    },
  ];
  assert.equal(
    findExistingSemiFinal(existing, { teamIds: ["a", "b"], stageLabel: "SF1" }).action,
    "skip",
  );
  assert.equal(
    findExistingSemiFinal(existing, { teamIds: ["a", "b"], stageLabel: "SF2" }).action,
    "skip",
  );
  assert.equal(
    findExistingSemiFinal(existing, { teamIds: ["c", "d"], stageLabel: "SF1" }).action,
    "blocked",
  );
  assert.equal(
    findExistingSemiFinal(existing, { teamIds: ["c", "d"], stageLabel: "SF2" }).action,
    "none",
  );
});

test("the match category follows the existing QFs", () => {
  assert.equal(matchCategoryFor([]), "Club");
  assert.equal(
    matchCategoryFor([
      { stage: "quarter_final", matchCategory: "Organization" },
      { stage: "quarter_final", matchCategory: "Organization" },
      { stage: "semi_final", matchCategory: "School" },
    ]),
    "Organization",
  );
});

// ---------------------------------------------------------------------------
// Dry run / apply / idempotent re-run
// ---------------------------------------------------------------------------

test("dry run prints CREATE for both semi-finals and writes nothing", async () => {
  const { tournament } = await seedTournament();

  const report = await runCreateSemiFinals({ apply: false, log: noLog });
  assert.equal(report.blocked, false);
  assert.deepEqual(
    report.rows.map((row) => [row.stageLabel, row.outcome, row.pair]),
    [
      ["SF1", "CREATE", "Baldia Zalmi vs Sky Sports"],
      ["SF2", "CREATE", "Young Star vs Khan Associates"],
    ],
  );
  assert.equal(await Match.countDocuments({ stage: "semi_final" }), 0);
  const fresh = await Tournament.findById(tournament._id).lean();
  assert.equal(fresh.matches.length, 4, "only the QFs are linked");
});

test("apply creates SF1 and SF2 through the shared fixture path", async () => {
  const { tournament } = await seedTournament();

  const report = await runCreateSemiFinals({ apply: true, log: noLog });
  assert.equal(report.blocked, false);
  assert.equal(report.createdIds.length, 2);
  assert.deepEqual(
    report.rows.map((row) => row.outcome),
    ["CREATED", "CREATED"],
  );

  const semis = await Match.find({ tournament: tournament._id, stage: "semi_final" })
    .populate("teams", "name")
    .sort({ startAt: 1 })
    .lean();
  assert.equal(semis.length, 2);

  const sf1 = semis[0];
  assert.equal(sf1.stageLabel, "SF1");
  assert.equal(sf1.round, "SF1");
  assert.equal(sf1.title, "SF1: Baldia Zalmi vs Sky Sports");
  assert.deepEqual(sf1.teams.map((team) => team.name), ["Baldia Zalmi", "Sky Sports"]);
  assert.equal(sf1.startAt.toISOString(), "2026-10-25T04:30:00.000Z");
  assert.equal(sf1.venue, "Tahirabad Ground");

  const sf2 = semis[1];
  assert.equal(sf2.stageLabel, "SF2");
  assert.equal(sf2.round, "SF2");
  assert.equal(sf2.title, "SF2: Young Star vs Khan Associates");
  assert.deepEqual(sf2.teams.map((team) => team.name), ["Young Star", "Khan Associates"]);
  assert.equal(sf2.startAt.toISOString(), "2026-10-25T05:00:00.000Z");

  for (const match of semis) {
    assert.equal(match.status, "upcoming");
    assert.equal(match.source, "live");
    assert.equal(match.manualDraft, false);
    assert.equal(match.matchType, "T20");
    assert.equal(match.totalOvers, 20);
    assert.equal(match.matchCategory, "Club");
    assert.equal(match.matchSubcategory, TOURNAMENT_NAME);
    assert.equal(match.innings.length, 2);
    assert.equal(match.result?.winner, undefined);
    assert.equal(match.tossWinner, undefined);
  }

  const fresh = await Tournament.findById(tournament._id).lean();
  assert.equal(fresh.matches.length, 6, "both semi-finals are linked to the tournament");
  assert.deepEqual(
    fresh.matches.map(String).sort(),
    [...report.createdIds, ...(await Match.find({ stage: "quarter_final" }).select("_id").lean()).map((m) => String(m._id))].sort(),
  );
  assert.equal(fresh.rules.twelfthManEnabled, true, "the tournament rule is untouched");
});

test("a second apply is idempotent and skips both semi-finals", async () => {
  const { tournament } = await seedTournament();
  const first = await runCreateSemiFinals({ apply: true, log: noLog });
  assert.equal(first.createdIds.length, 2);

  const second = await runCreateSemiFinals({ apply: true, log: noLog });
  assert.equal(second.blocked, false);
  assert.deepEqual(
    second.rows.map((row) => [row.stageLabel, row.outcome]),
    [
      ["SF1", "SKIP"],
      ["SF2", "SKIP"],
    ],
  );
  assert.deepEqual(
    second.rows.map((row) => row.existingId).sort(),
    [...first.createdIds].sort(),
  );
  assert.equal(await Match.countDocuments({ tournament: tournament._id, stage: "semi_final" }), 2);
});

// ---------------------------------------------------------------------------
// Public bracket over HTTP
// ---------------------------------------------------------------------------

test("the public standings bracket shows both semi-finals and both final placeholders", async () => {
  const { tournament } = await seedTournament();
  await runCreateSemiFinals({ apply: true, log: noLog });

  const res = await fetch(`${base}/api/tournaments/${tournament._id}/standings`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.bracket?.isKnockout, true);

  const stages = Object.fromEntries(body.bracket.stages.map((stage) => [stage.stage, stage]));
  assert.equal(stages.quarter_final.matches.length, 4);

  const semiFinals = stages.semi_final.matches;
  assert.equal(semiFinals.length, 2);
  const sf1 = semiFinals.find((match) => match.stageLabel === "SF1");
  const sf2 = semiFinals.find((match) => match.stageLabel === "SF2");
  assert.deepEqual(sf1.teams.map((team) => team.name), ["Baldia Zalmi", "Sky Sports"]);
  assert.deepEqual(sf2.teams.map((team) => team.name), ["Young Star", "Khan Associates"]);
  assert.equal(sf1.status, "upcoming");
  assert.equal(sf2.status, "upcoming");

  const qfWinners = stages.quarter_final.matches
    .map((match) => match.winner?.name)
    .filter(Boolean)
    .sort();
  assert.deepEqual(qfWinners, ["Baldia Zalmi", "Khan Associates", "Sky Sports", "Young Star"]);

  assert.equal(stages.final.matches.length, 1);
  const final = stages.final.matches[0];
  assert.equal(final.placeholder, true);
  assert.deepEqual(final.slots, ["Winner SF1", "Winner SF2"]);
  assert.equal(final.label, "Winner SF1 vs Winner SF2");
  assert.equal(body.bracket.champion, null);
});

test("buildTournamentBracket uses real semi-final labels in the final placeholder", async () => {
  const { tournament } = await seedTournament();
  await runCreateSemiFinals({ apply: true, log: noLog });
  const matches = await Match.find({ tournament: tournament._id }).populate("teams", "name shortName logo").lean();
  const bracket = buildTournamentBracket(matches, { type: "knockout" });
  const final = bracket.stages.find((stage) => stage.stage === "final").matches[0];
  assert.deepEqual(final.slots, ["Winner SF1", "Winner SF2"]);
  assert.equal(final.label, "Winner SF1 vs Winner SF2");
});

// Keep the exported fixture definition pinned to the poster; a future edit that
// moves a venue or time should fail loudly.
test("the pinned semi-final specs match the official poster", () => {
  assert.deepEqual(
    SEMI_FINALS.map(({ stageLabel, teamA, teamB, startTime, venue }) => ({
      stageLabel,
      teamA,
      teamB,
      startTime,
      venue,
    })),
    [
      {
        stageLabel: "SF1",
        teamA: "Baldia Zalmi",
        teamB: "Sky Sports",
        startTime: "2026-10-25T04:30:00.000Z",
        venue: "Tahirabad Ground",
      },
      {
        stageLabel: "SF2",
        teamA: "Young Star",
        teamB: "Khan Associates",
        startTime: "2026-10-25T05:00:00.000Z",
        venue: "Tahirabad Ground",
      },
    ],
  );
});
