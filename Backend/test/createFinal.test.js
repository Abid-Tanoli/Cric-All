import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";

process.env.JWT_SECRET = process.env.JWT_SECRET || "create-final-test-secret";

import { startTestDb, stopTestDb } from "./helpers/testDb.js";
import Tournament from "../src/models/Tournament.js";
import Team from "../src/models/Team.js";
import Match from "../src/models/Match.js";
import tournamentContentRoutes from "../src/routes/tournamentContentRoutes.js";
import { buildTournamentBracket } from "../src/services/tournamentBracket.js";
import {
  TOURNAMENT_NAME,
  DEFAULT_FINAL_VENUE,
  FINAL_FIXTURE,
  parseOptions,
  matchCategoryForFinal,
  resolveFinalists,
  findExistingFinal,
  runCreateFinal,
} from "../src/scripts/createFinal.js";

// The final script is exercised against a throwaway mongodb-memory-server
// database. The default is asserted to write nothing, --apply is asserted to
// create exactly one normal fixture, and the public bracket/content endpoints
// are called over HTTP.

let mongod;
let server;
let base;
let seq = 0;

const noLog = () => {};

const TEAM_NAMES = [
  "Baldia Zalmi",
  "Sky Sports",
  "Young Star",
  "Khan Associates",
  "Orangi Warriors",
  "Orangi United",
  "Malir Friends",
  "Gulshan XI",
];

const teamDoc = (id, name) => ({ _id: id, name, shortName: name.slice(0, 3) });

const semiMatch = ({ id, label, teamA, teamB, winner, status = "completed", manualDraft = false }) => ({
  _id: id,
  stage: "semi_final",
  stageLabel: label,
  round: label,
  status,
  manualDraft,
  teams: [teamA, teamB],
  result: winner ? { resultType: "normal", winner: winner._id } : {},
  innings: [],
});

async function seedTournament({ sf1Status = "completed", sf2Status = "completed" } = {}) {
  const teams = await Team.create(TEAM_NAMES.map((name) => ({ name })));
  const byName = new Map(teams.map((team) => [team.name, team]));

  const tournament = await Tournament.create({
    name: TOURNAMENT_NAME,
    slug: `all-baldia-final-${++seq}`,
    type: "knockout",
    format: "T20",
    venue: "Tahirabad Ground",
    startDate: new Date("2026-10-11T00:00:00.000Z"),
    endDate: new Date("2026-10-11T00:00:00.000Z"),
    teams: teams.map((team) => team._id),
    rules: { twelfthManEnabled: true },
  });

  const sf1 = await Match.create({
    title: "SF1: Baldia Zalmi vs Sky Sports",
    matchNumber: 1,
    venue: "Tahirabad Ground",
    matchType: "T20",
    totalOvers: 20,
    matchCategory: "Club",
    matchSubcategory: TOURNAMENT_NAME,
    round: "SF1",
    stage: "semi_final",
    stageLabel: "SF1",
    tournament: tournament._id,
    teams: [byName.get("Baldia Zalmi")._id, byName.get("Sky Sports")._id],
    status: sf1Status,
    source: "manual",
    manualDraft: false,
    startAt: new Date("2026-10-25T04:30:00.000Z"),
    ...(sf1Status === "completed"
      ? {
          result: {
            resultType: "normal",
            winner: byName.get("Sky Sports")._id,
            description: "Sky Sports won by 6 wickets",
          },
          innings: [
            { team: byName.get("Baldia Zalmi")._id, runs: 274, wickets: 5, balls: 120, status: "completed" },
            { team: byName.get("Sky Sports")._id, runs: 275, wickets: 4, balls: 114, status: "completed" },
          ],
        }
      : {}),
  });

  const sf2 = await Match.create({
    title: "SF2: Young Star vs Khan Associates",
    matchNumber: 2,
    venue: "Tahirabad Ground",
    matchType: "T20",
    totalOvers: 20,
    matchCategory: "Club",
    matchSubcategory: TOURNAMENT_NAME,
    round: "SF2",
    stage: "semi_final",
    stageLabel: "SF2",
    tournament: tournament._id,
    teams: [byName.get("Young Star")._id, byName.get("Khan Associates")._id],
    status: sf2Status,
    source: "manual",
    manualDraft: false,
    startAt: new Date("2026-10-25T05:00:00.000Z"),
    ...(sf2Status === "completed"
      ? {
          result: {
            resultType: "normal",
            winner: byName.get("Young Star")._id,
            description: "Young Star won by 6 wickets",
          },
          innings: [
            { team: byName.get("Khan Associates")._id, runs: 198, wickets: 9, balls: 114, status: "completed" },
            { team: byName.get("Young Star")._id, runs: 199, wickets: 4, balls: 102, status: "completed" },
          ],
        }
      : {}),
  });

  tournament.matches = [sf1._id, sf2._id];
  await tournament.save();
  return { tournament, teams, byName, sf1, sf2 };
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
// Pure helpers
// ---------------------------------------------------------------------------

test("the CLI defaults to a dry run and accepts --venue without touching the pinned time", () => {
  assert.deepEqual(parseOptions([]), {
    apply: false,
    forceTest: false,
    venue: DEFAULT_FINAL_VENUE,
  });
  assert.deepEqual(parseOptions(["--apply", "--force-test"]), {
    apply: true,
    forceTest: true,
    venue: DEFAULT_FINAL_VENUE,
  });
  assert.equal(parseOptions(["--venue", "Bagh-e-Jinnah Ground"]).venue, "Bagh-e-Jinnah Ground");
  assert.equal(parseOptions(["--venue=Other Ground"]).venue, "Other Ground");
  assert.throws(() => parseOptions(["--apply", "--dry-run"]), /either --apply or --dry-run/);
  assert.throws(() => parseOptions(["--nope"]), /Unknown option/);
  assert.equal(FINAL_FIXTURE.startTime, "2026-11-01T05:30:00.000Z");
});

test("finalists come from the COMPLETED SF1/SF2 winners, and incomplete or draft semis block", () => {
  const sky = teamDoc("t1", "Sky Sports");
  const young = teamDoc("t2", "Young Star");
  const khan = teamDoc("t3", "Khan Associates");
  const baldia = teamDoc("t4", "Baldia Zalmi");
  const teams = [sky, young, khan, baldia];

  const sf1 = semiMatch({ id: "m1", label: "SF1", teamA: baldia, teamB: sky, winner: sky });
  const sf2 = semiMatch({ id: "m2", label: "SF2", teamA: young, teamB: khan, winner: young });
  const resolved = resolveFinalists([sf1, sf2], teams);
  assert.deepEqual(
    resolved.finalists.map((row) => [row.label, row.team.name]),
    [["SF1", "Sky Sports"], ["SF2", "Young Star"]],
  );

  const upcoming = { ...sf1, status: "upcoming", result: {} };
  assert.match(resolveFinalists([upcoming, sf2], teams).error, /SF1 is not completed/);

  const draft = { ...sf1, manualDraft: true };
  assert.match(resolveFinalists([draft, sf2], teams).error, /unpublished draft/);

  const noWinner = { ...sf1, result: {} };
  assert.match(resolveFinalists([noWinner, sf2], teams).error, /no winner/);

  assert.match(resolveFinalists([sf1], teams).error, /SF2 was not found/);

  const sameWinner = { ...sf2, result: { resultType: "normal", winner: sky._id } };
  assert.match(resolveFinalists([sf1, sameWinner], teams).error, /same winner/);
});

test("an existing final is skipped; multiple finals are ambiguous", () => {
  const final = { _id: "f1", stage: "final", stageLabel: "Final", teams: [] };
  assert.equal(findExistingFinal([]).action, "none");
  assert.equal(findExistingFinal([final]).action, "skip");
  assert.equal(findExistingFinal([final]).match._id, "f1");
  assert.equal(findExistingFinal([final, { ...final, _id: "f2" }]).action, "blocked");
});

test("the final category follows the semi-finals, then the QFs", () => {
  assert.equal(
    matchCategoryForFinal([
      { stage: "quarter_final", matchCategory: "School" },
      { stage: "semi_final", matchCategory: "Organization" },
      { stage: "semi_final", matchCategory: "Organization" },
    ]),
    "Organization",
  );
  assert.equal(
    matchCategoryForFinal([{ stage: "quarter_final", matchCategory: "School" }]),
    "School",
  );
  assert.equal(matchCategoryForFinal([]), "Club");
});

// ---------------------------------------------------------------------------
// Dry run / apply / idempotent re-run
// ---------------------------------------------------------------------------

test("dry run resolves Sky Sports vs Young Star and writes nothing", async () => {
  const { tournament } = await seedTournament();

  const report = await runCreateFinal({ apply: false, log: noLog });
  assert.equal(report.blocked, false);
  assert.equal(report.row.outcome, "CREATE");
  assert.equal(report.row.pair, "Sky Sports vs Young Star");
  assert.deepEqual(report.createdIds, []);
  assert.equal(await Match.countDocuments({ stage: "final" }), 0);
  const fresh = await Tournament.findById(tournament._id).lean();
  assert.equal(fresh.matches.length, 2, "only the semi-finals are linked");
});

test("apply creates exactly one normal final fixture with the pinned time, venue and teams", async () => {
  const { tournament } = await seedTournament();

  const report = await runCreateFinal({ apply: true, log: noLog });
  assert.equal(report.blocked, false);
  assert.equal(report.row.outcome, "CREATED");
  assert.equal(report.createdIds.length, 1);

  const finals = await Match.find({ tournament: tournament._id, stage: "final" })
    .populate("teams", "name")
    .lean();
  assert.equal(finals.length, 1);
  const final = finals[0];
  assert.equal(final.stage, "final");
  assert.equal(final.stageLabel, "Final");
  assert.equal(final.round, "Final");
  assert.equal(final.title, "Final: Sky Sports vs Young Star");
  assert.deepEqual(final.teams.map((team) => team.name), ["Sky Sports", "Young Star"]);
  assert.equal(final.startAt.toISOString(), "2026-11-01T05:30:00.000Z");
  assert.equal(final.venue, "Tahirabad Ground");
  assert.equal(final.status, "upcoming");
  assert.equal(final.source, "live");
  assert.equal(final.manualDraft, false);
  assert.equal(final.matchType, "T20");
  assert.equal(final.totalOvers, 20);
  assert.equal(final.matchCategory, "Club");
  assert.equal(final.matchSubcategory, TOURNAMENT_NAME);
  assert.equal(final.innings.length, 2);
  assert.equal(final.result?.winner, undefined);
  assert.equal(final.tossWinner, undefined);

  const fresh = await Tournament.findById(tournament._id).lean();
  assert.equal(fresh.matches.length, 3, "the final is linked to the tournament");
  assert.ok(fresh.matches.map(String).includes(report.createdId));
  assert.equal(fresh.rules.twelfthManEnabled, true, "the tournament rule is untouched");
});

test("a custom venue is used without changing the fixture time", async () => {
  await seedTournament();
  const report = await runCreateFinal({ apply: true, venue: "Bagh-e-Jinnah Ground", log: noLog });
  const final = await Match.findById(report.createdId).lean();
  assert.equal(final.venue, "Bagh-e-Jinnah Ground");
  assert.equal(final.startAt.toISOString(), FINAL_FIXTURE.startTime);
});

test("a second apply is idempotent and skips the existing final", async () => {
  await seedTournament();
  const first = await runCreateFinal({ apply: true, log: noLog });
  assert.equal(first.createdIds.length, 1);

  const second = await runCreateFinal({ apply: true, log: noLog });
  assert.equal(second.blocked, false);
  assert.equal(second.row.outcome, "SKIP");
  assert.equal(second.row.existingId, first.createdId);
  assert.equal(await Match.countDocuments({ stage: "final" }), 1);
});

test("apply is blocked and writes nothing when a semi-final is not completed", async () => {
  const { tournament } = await seedTournament({ sf2Status: "upcoming" });

  const report = await runCreateFinal({ apply: true, log: noLog });
  assert.equal(report.blocked, true);
  assert.equal(report.row.outcome, "BLOCKED");
  assert.match(report.row.reason, /SF2 is not completed/);
  assert.equal(await Match.countDocuments({ stage: "final" }), 0);
  const fresh = await Tournament.findById(tournament._id).lean();
  assert.equal(fresh.matches.length, 2);
});

// ---------------------------------------------------------------------------
// Public bracket + header state over HTTP
// ---------------------------------------------------------------------------

test("after apply the public bracket shows the upcoming final and the header state extends to 1 Nov", async () => {
  const { tournament } = await seedTournament();

  // Before the fixture exists the final is a neutral placeholder, never a W.
  const before = await fetch(`${base}/api/tournaments/${tournament._id}/standings`);
  const beforeBody = await before.json();
  const beforeFinal = beforeBody.bracket.stages.find((stage) => stage.stage === "final").matches[0];
  assert.equal(beforeFinal.placeholder, true);
  assert.equal(beforeFinal.label, "Finalists");
  assert.deepEqual(
    beforeFinal.teams.map((team) => [team.name, team.isWinner, team.score]),
    [["Sky Sports", false, null], ["Young Star", false, null]],
  );

  const report = await runCreateFinal({ apply: true, log: noLog });
  assert.equal(report.blocked, false);

  const res = await fetch(`${base}/api/tournaments/${tournament._id}/standings`);
  assert.equal(res.status, 200);
  const body = await res.json();
  const final = body.bracket.stages.find((stage) => stage.stage === "final").matches[0];
  assert.equal(final.placeholder, false);
  assert.equal(final.status, "upcoming");
  assert.equal(final.stageLabel, "Final");
  assert.equal(final.title, "Final: Sky Sports vs Young Star");
  assert.deepEqual(final.teams.map((team) => team.name), ["Sky Sports", "Young Star"]);
  assert.deepEqual(final.teams.map((team) => team.isWinner), [false, false]);
  assert.equal(final.teams[0].score, null, "an unplayed fixture has no result-looking score");
  assert.equal(final.startAt, "2026-11-01T05:30:00.000Z");
  assert.equal(final.venue, "Tahirabad Ground");
  assert.equal(body.bracket.champion, null);

  const content = await fetch(`${base}/api/tournaments/${tournament._id}/content`);
  assert.equal(content.status, 200);
  const contentBody = await content.json();
  assert.equal(contentBody.overview.status, "ongoing", "completed semis plus a scheduled final");
  assert.equal(
    new Date(contentBody.overview.endDate).toISOString(),
    "2026-11-01T05:30:00.000Z",
    "the header range can show the final date",
  );

  // The pure builder agrees with the HTTP projection.
  const matches = await Match.find({ tournament: tournament._id }).populate("teams", "name shortName logo").lean();
  const bracket = buildTournamentBracket(matches, { type: "knockout" });
  assert.equal(bracket.stages.find((stage) => stage.stage === "final").matches[0].teams[0].isWinner, false);
});
