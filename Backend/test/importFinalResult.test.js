// Tests for src/scripts/importFinalResult.js.
//
// Everything runs against a throwaway mongodb-memory-server database. The test
// seeds the real Final fixture through the shared createFinal path, then
// exercises the importer's dry-run/apply/SKIP/blocked paths. No real
// environment is touched and the scorecard must stay a DRAFT until an owner
// publishes it.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import Player from "../src/models/Player.js";
import Team from "../src/models/Team.js";
import Match from "../src/models/Match.js";
import Tournament from "../src/models/Tournament.js";
import Ball from "../src/models/Ball.js";
import Delivery from "../src/models/Delivery.js";
import { getTournamentFixtures, getTournament } from "../src/controllers/TournamentController.js";
import {
  getTournamentContent,
  getTournamentStandings,
  getTournamentStats,
} from "../src/controllers/TournamentContentController.js";
import { buildTournamentBracket } from "../src/services/tournamentBracket.js";
import { deriveTournamentPublicState } from "../src/services/tournamentPublicState.js";
import { gatherTournamentStats } from "../src/services/tournamentStats.js";
import { runCreateFinal } from "../src/scripts/createFinal.js";
import { runPublish } from "../src/scripts/publishManualMatches.js";
import { manualMatchToPayload } from "../src/controllers/manualScorecardController.js";
import {
  loadImportFiles,
  main,
  runImportFinalResult,
} from "../src/scripts/importFinalResult.js";

let mongod;
let seq = 0;
let activeFinalId = null;
const noLog = () => {};

// The production data file pins the live fixture _id. Tests seed their own
// throwaway Final, so they point the same guard at the seeded fixture.
const runImportFinal = (options = {}) =>
  runImportFinalResult({ expectedFinalId: activeFinalId, ...options });

const TOURNAMENT_NAME = "All Baldia T20 Hard Ball Cricket Tournament";
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

// Real squads as they exist in the live database. No "CREATE:" player is ever
// expected; every source name must resolve to one of these existing players.
const ROSTERS = {
  "Sky Sports": [
    "Abdul Rehman",
    "Raheel",
    "Wajid",
    "Kamran Kamal",
    "Akbar Sadozai",
    "M. Shahnawaz",
    "M. Zarnain",
    "M. Ali Qureshi",
    "Sharafat",
    "Usman",
    "Farooq",
  ],
  "Young Star": [
    "Abdul Salam",
    "Br. Aqal",
    "Ijaz Koistani",
    "Kamran Khan",
    "Luqman Khan",
    "Naveed Akhtar",
    "Saleem Agha",
    "Salman Khan",
    "Salman Khan JR",
    "Sulman Afridi",
    "Umar Afridi",
    "Usman Masood",
    "Zahid",
    "Dr. Suleman",
  ],
  // Deliberate duplicate names on a team that is NOT in the Final. Name
  // resolution must never leak across tournament teams.
  "Orangi Warriors": [
    "Raheel",
    "Farooq",
    "Hamza",
    "Yaseen",
    "Sabir",
    "Rehman",
    "Wajid",
  ],
};

async function seedTournament() {
  seq += 1;
  const teams = await Team.create(TEAM_NAMES.map((name) => ({ name })));
  const byName = new Map(teams.map((team) => [team.name, team]));

  for (const [teamName, playerNames] of Object.entries(ROSTERS)) {
    const team = byName.get(teamName);
    const players = await Player.create(
      playerNames.map((name) => ({ name, team: team._id, role: "" })),
    );
    team.players = players.map((player) => player._id);
    await team.save();
  }

  const tournament = await Tournament.create({
    name: TOURNAMENT_NAME,
    slug: `all-baldia-final-import-${seq}`,
    type: "knockout",
    format: "T20",
    venue: "Tahirabad Ground",
    startDate: new Date("2026-10-01T00:00:00.000Z"),
    endDate: new Date("2026-10-31T00:00:00.000Z"),
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
    status: "completed",
    source: "manual",
    manualDraft: false,
    startAt: new Date("2026-10-25T04:30:00.000Z"),
    result: {
      resultType: "normal",
      winner: byName.get("Sky Sports")._id,
      description: "Sky Sports won by 6 wickets",
    },
    innings: [
      { team: byName.get("Baldia Zalmi")._id, runs: 274, wickets: 5, balls: 120, status: "completed" },
      { team: byName.get("Sky Sports")._id, runs: 275, wickets: 4, balls: 114, status: "completed" },
    ],
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
    status: "completed",
    source: "manual",
    manualDraft: false,
    startAt: new Date("2026-10-25T05:00:00.000Z"),
    result: {
      resultType: "normal",
      winner: byName.get("Young Star")._id,
      description: "Young Star won by 6 wickets",
    },
    innings: [
      { team: byName.get("Khan Associates")._id, runs: 198, wickets: 9, balls: 114, status: "completed" },
      { team: byName.get("Young Star")._id, runs: 199, wickets: 4, balls: 102, status: "completed" },
    ],
  });

  tournament.matches = [sf1._id, sf2._id];
  await tournament.save();

  // Use the same creation path the operator uses; this pins the real Final
  // fixture shape: source live, two empty innings, teams [SF1 winner, SF2 winner].
  const created = await runCreateFinal({ apply: true, log: noLog });
  assert.equal(created.blocked, false);
  assert.ok(created.createdId);

  const final = await Match.findById(created.createdId);
  activeFinalId = String(final._id);
  assert.deepEqual(final.teams.map(String), [
    String(byName.get("Sky Sports")._id),
    String(byName.get("Young Star")._id),
  ]);

  return {
    tournament,
    teams,
    byName,
    sf1,
    sf2,
    final,
    sky: byName.get("Sky Sports"),
    youngStar: byName.get("Young Star"),
    orangi: byName.get("Orangi Warriors"),
  };
}

const findPlayerOnTeam = async (teamId, name) => Player.findOne({ team: teamId, name });
const playerName = async (id) => (await Player.findById(id).lean())?.name || null;

async function publicMatches(tournamentId) {
  return Match.find({ tournament: tournamentId, manualDraft: { $ne: true } })
    .populate("teams", "name shortName logo")
    .lean();
}

before(async () => {
  mongod = await startTestDb();
});

after(async () => {
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Promise.all([
    Player.deleteMany({}),
    Team.deleteMany({}),
    Match.deleteMany({}),
    Tournament.deleteMany({}),
    Ball.deleteMany({}),
    Delivery.deleteMany({}),
  ]);
});

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------

test("dry run validates the Final scorecard and writes nothing", async () => {
  const { tournament, final, sky, youngStar, orangi } = await seedTournament();
  const original = await Match.findById(final._id).lean();
  const playerCountBefore = await Player.countDocuments({});
  const linkedBefore = (await Tournament.findById(tournament._id).lean()).matches.map(String);
  const sulman = await findPlayerOnTeam(youngStar._id, "Sulman Afridi");
  const skyRaheel = await findPlayerOnTeam(sky._id, "Raheel");
  const orangiRaheel = await findPlayerOnTeam(orangi._id, "Raheel");
  assert.ok(sulman);
  assert.ok(skyRaheel);
  assert.ok(orangiRaheel);

  const lines = [];
  const report = await runImportFinal({
    apply: false,
    log: (line) => lines.push(String(line ?? "")),
  });

  assert.equal(report.outcome, "DRY_RUN");
  assert.equal(report.blocked, false);
  assert.deepEqual(report.plan.errors, []);
  assert.equal(report.plan.innings[0].checks.total, 292);
  assert.equal(report.plan.innings[0].checks.bowlingTotal, 292);
  assert.equal(report.plan.innings[1].checks.total, 295);
  assert.equal(report.plan.innings[1].checks.bowlingTotal, 295);
  assert.equal(report.plan.innings[0].checks.inningsBalls, 120);
  assert.equal(report.plan.innings[1].checks.inningsBalls, 106);
  assert.equal(report.plan.innings[0].innings.batting.length, 9);
  assert.ok(
    report.plan.innings[0].validations.every((check) => check.ok),
    `innings 1 must have no FAIL: ${report.plan.innings[0].validations
      .filter((check) => !check.ok)
      .map((check) => `${check.label}: ${check.detail}`)
      .join("; ")}`,
  );
  assert.equal(report.plan.validator.ok, true);
  assert.ok(
    report.plan.mapping.every((row) => !row.error),
    `all names must resolve: ${report.plan.mapping
      .filter((row) => row.error)
      .map((row) => `${row.sourceName}: ${row.error}`)
      .join("; ")}`,
  );

  // Every batter/bowler/fielder must resolve inside the team that owns the
  // source row, even when another tournament team carries the same name.
  for (const row of report.plan.mapping.filter((mapping) => mapping.player)) {
    assert.equal(String(row.player.team), row.teamId, `${row.sourceName} must stay in ${row.team}`);
  }
  const drSulemanMapping = report.plan.mapping.find((row) => row.sourceName === "Dr Suleman");
  assert.equal(drSulemanMapping.player._id, String(sulman._id));
  assert.equal(drSulemanMapping.team, "Young Star");
  assert.equal(
    report.plan.manOfMatch.player._id,
    String(skyRaheel._id),
    "man of the match must be Sky Sports' Raheel, not Orangi Warriors' duplicate",
  );
  assert.equal(report.plan.manOfMatch.sourceTeam, "Sky Sports");
  assert.notEqual(report.plan.manOfMatch.player._id, String(orangiRaheel._id));

  const text = lines.join("\n");
  assert.match(text, /Young Star 292\/7 \(20.0\) vs Sky Sports 295\/1 \(17\.4\)/);
  assert.match(text, /PASS  batting \+ extras = total/);
  assert.match(text, /PASS  partnerships vs fall of wickets/);
  assert.doesNotMatch(text, /^ +FAIL  /m, "the validation section must contain no FAIL rows");
  assert.match(
    text,
    new RegExp(`\\[batting\\] "Dr Suleman" \\[Young Star\\] -> Sulman Afridi \\(${sulman._id}\\)`),
  );
  assert.match(
    text,
    new RegExp(
      `\\[man-of-match\\] "Raheel" \\[Sky Sports\\] -> Raheel \\(${skyRaheel._id}\\)`,
    ),
  );
  assert.match(text, /teams \(stored\)     : \[Young Star, Sky Sports\]/);
  assert.match(text, /players created    : none/);

  const unchanged = await Match.findById(final._id).lean();
  assert.equal(unchanged.source, "live");
  assert.equal(unchanged.manualDraft, false);
  assert.equal(unchanged.status, "upcoming");
  assert.equal(unchanged.innings[0].batting.length, 0);
  assert.equal(String(unchanged._id), String(original._id));
  assert.equal(await Player.countDocuments({}), playerCountBefore);
  assert.deepEqual(
    (await Tournament.findById(tournament._id).lean()).matches.map(String),
    linkedBefore,
  );
});

// ---------------------------------------------------------------------------
// Apply in place
// ---------------------------------------------------------------------------

test("apply converts the existing Final fixture into a draft in place", async () => {
  const { tournament, final, sky, youngStar, orangi } = await seedTournament();
  const original = await Match.findById(final._id).lean();
  const matchCountBefore = await Match.countDocuments({});
  const playerCountBefore = await Player.countDocuments({});
  const linkedBefore = (await Tournament.findById(tournament._id).lean()).matches.map(String).sort();
  const sulman = await findPlayerOnTeam(youngStar._id, "Sulman Afridi");
  const skyRaheel = await findPlayerOnTeam(sky._id, "Raheel");
  const orangiRaheel = await findPlayerOnTeam(orangi._id, "Raheel");
  const lines = [];

  const report = await runImportFinal({
    apply: true,
    log: (line) => lines.push(String(line ?? "")),
  });
  assert.equal(report.outcome, "APPLIED");
  assert.equal(report.blocked, false);
  assert.match(
    lines.join("\n"),
    /scorecard  : Young Star 292\/7 vs Sky Sports 295\/1/,
    "the summary must follow the chronological/stored innings order",
  );

  // No duplicate Final and no new match document.
  assert.equal(await Match.countDocuments({}), matchCountBefore);
  assert.equal(await Match.countDocuments({ tournament: tournament._id, stage: "final" }), 1);

  const saved = await Match.findById(final._id).lean();
  assert.equal(String(saved._id), String(original._id));
  assert.equal(String(saved.tournament), String(tournament._id));
  assert.equal(saved.stage, "final");
  assert.equal(saved.stageLabel, "Final");
  assert.equal(saved.round, "Final");
  assert.equal(saved.title, original.title);
  assert.equal(saved.title, "Final: Sky Sports vs Young Star");
  assert.equal(saved.venue, original.venue);
  assert.equal(saved.startAt.toISOString(), original.startAt.toISOString());
  assert.equal(saved.totalOvers, 20);
  assert.equal(saved.matchCategory, "Club");

  // Stored order is deliberately changed so Admin opens Team A / innings 1 as
  // Young Star (who batted first), even though the original fixture listed Sky
  // Sports first.
  assert.deepEqual(saved.teams.map(String), [String(youngStar._id), String(sky._id)]);
  assert.deepEqual(original.teams.map(String), [String(sky._id), String(youngStar._id)]);

  // Draft, never published.
  assert.equal(saved.source, "manual");
  assert.equal(saved.manualDraft, true);
  assert.equal(saved.status, "upcoming");

  const [youngInnings, skyInnings] = saved.innings;
  assert.equal(String(youngInnings.team), String(youngStar._id));
  assert.equal(youngInnings.runs, 292);
  assert.equal(youngInnings.wickets, 7);
  assert.equal(youngInnings.balls, 120);
  assert.deepEqual(
    {
      wides: youngInnings.extras.wides,
      noBalls: youngInnings.extras.noBalls,
      byes: youngInnings.extras.byes,
      legByes: youngInnings.extras.legByes,
    },
    { wides: 9, noBalls: 0, byes: 0, legByes: 0 },
  );
  assert.equal(youngInnings.batting.length, 9);
  assert.equal(youngInnings.bowling.length, 8);
  assert.equal(youngInnings.fallOfWickets.length, 7);

  const zahid = youngInnings.batting.find((row) => row.runs === 34);
  assert.equal(zahid.dismissalType, "stumped");
  assert.equal(await playerName(zahid.fielder), "Sharafat");
  assert.equal(await playerName(zahid.dismissedBy), "Akbar Sadozai");

  const salman = youngInnings.batting.find((row) => row.runs === 81);
  assert.equal(await playerName(salman.fielder), "Abdul Rehman");
  assert.equal(await playerName(salman.dismissedBy), "Wajid");

  const ejaz = youngInnings.batting.find((row) => row.runs === 100);
  assert.equal(ejaz.isOut, true);
  assert.equal(ejaz.sixes, 14);
  // The scorebook bowler was "Kamran"; the merged card row is "Kamran Bhai".
  assert.equal(await playerName(ejaz.dismissedBy), "Kamran Kamal");
  const kamranSpell = youngInnings.bowling.find((row) => row.runs === 51);
  assert.equal(await playerName(kamranSpell.player), "Kamran Kamal");
  assert.equal(kamranSpell.balls, 18);
  assert.equal(kamranSpell.wickets, 1);

  const drSuleman = youngInnings.batting.find((row) => row.runs === 4);
  assert.equal(String(drSuleman.player), String(sulman._id));
  assert.equal(await playerName(drSuleman.player), "Sulman Afridi");

  assert.equal(youngInnings.fallOfWickets[0].runs, 102);
  assert.equal(youngInnings.fallOfWickets[0].wickets, 1);
  assert.equal(await playerName(youngInnings.fallOfWickets[0].player), "Salman Khan");

  assert.equal(String(skyInnings.team), String(sky._id));
  assert.equal(skyInnings.runs, 295);
  assert.equal(skyInnings.wickets, 1);
  assert.equal(skyInnings.balls, 106);
  assert.deepEqual(
    {
      wides: skyInnings.extras.wides,
      noBalls: skyInnings.extras.noBalls,
      byes: skyInnings.extras.byes,
      legByes: skyInnings.extras.legByes,
    },
    { wides: 9, noBalls: 0, byes: 0, legByes: 0 },
  );
  const raheel = skyInnings.batting.find((row) => row.runs === 154);
  assert.equal(raheel.isOut, false);
  assert.equal(raheel.sixes, 12);
  assert.equal(await playerName(raheel.player), "Raheel");

  assert.equal(saved.tossWinner, null);
  assert.ok(!saved.tossDecision);
  assert.equal(String(saved.result.winner), String(sky._id));
  assert.equal(saved.result.margin, "9 wickets");
  assert.equal(saved.result.resultType, "normal");
  assert.equal(saved.result.description, "Sky Sports won by 9 wickets (14 balls remaining).");
  assert.equal(String(saved.manOfMatch), String(skyRaheel._id));
  assert.equal(await playerName(saved.manOfMatch), "Raheel");
  assert.notEqual(String(saved.manOfMatch), String(orangiRaheel._id));

  // The player count must not move: this importer never creates anyone.
  assert.equal(await Player.countDocuments({}), playerCountBefore);
  const referenced = [
    ...youngInnings.batting.flatMap((row) => [row.player, row.dismissedBy, row.fielder]),
    ...youngInnings.bowling.map((row) => row.player),
    ...skyInnings.batting.flatMap((row) => [row.player, row.dismissedBy, row.fielder]),
    ...skyInnings.bowling.map((row) => row.player),
    saved.manOfMatch,
  ].filter(Boolean);
  for (const id of referenced) {
    assert.ok(await Player.findById(id).lean(), `referenced player ${id} must exist`);
    assert.doesNotMatch((await playerName(id)) || "", /\(TBC\)$/);
  }

  // Tournament link is unchanged and the draft is hidden from the public bracket.
  const linkedAfter = (await Tournament.findById(tournament._id).lean()).matches.map(String).sort();
  assert.deepEqual(linkedAfter, linkedBefore);

  // Admin's editor payload follows the stored order: Team A = Young Star.
  const payload = manualMatchToPayload(saved);
  assert.equal(payload.teamA, String(youngStar._id));
  assert.equal(payload.teamB, String(sky._id));
  assert.equal(payload.innings[0].team, String(youngStar._id));
  assert.equal(payload.innings[1].team, String(sky._id));

  const matches = await Match.find({ tournament: tournament._id })
    .populate("teams", "name shortName logo")
    .lean();
  const bracket = buildTournamentBracket(matches, { type: "knockout" });
  const finalStage = bracket.stages.find((stage) => stage.stage === "final");
  assert.equal(finalStage.matches[0].placeholder, true, "a draft Final stays a placeholder");
  assert.ok(finalStage.matches[0].teams.map((team) => team.name).includes("Young Star"));

  const beforeFixtures = mockRes();
  await getTournamentFixtures(mockReq({ params: { id: String(tournament._id) } }), beforeFixtures);
  assert.equal(beforeFixtures.statusCode, 200);
  assert.equal(beforeFixtures.body.some((match) => String(match._id) === String(final._id)), false);
});

test("a second apply is a SKIP and does not duplicate players or matches", async () => {
  const { tournament, final } = await seedTournament();
  const first = await runImportFinal({ apply: true, log: noLog });
  assert.equal(first.outcome, "APPLIED");

  const before = await Match.findById(final._id).lean();
  const playerCountBefore = await Player.countDocuments({});
  const second = await runImportFinal({ apply: true, log: noLog });

  assert.equal(second.outcome, "SKIP");
  assert.equal(second.blocked, false);
  const after = await Match.findById(final._id).lean();
  assert.equal(after.source, "manual");
  assert.equal(after.manualDraft, true);
  assert.equal(after.status, "upcoming");
  assert.equal(JSON.stringify(after.innings), JSON.stringify(before.innings));
  assert.equal(await Match.countDocuments({ tournament: tournament._id, stage: "final" }), 1);
  assert.equal(await Player.countDocuments({}), playerCountBefore);
});

// ---------------------------------------------------------------------------
// Names are resolved, never created
// ---------------------------------------------------------------------------

test("an unresolved name BLOCKS the write and prints existing candidates", async () => {
  const { final, sky } = await seedTournament();
  const ali = await findPlayerOnTeam(sky._id, "M. Ali Qureshi");
  assert.ok(ali);
  await Player.deleteOne({ _id: ali._id });
  await Team.updateOne({ _id: sky._id }, { $pull: { players: ali._id } });
  const playerCountBefore = await Player.countDocuments({});

  const lines = [];
  const report = await runImportFinal({
    apply: true,
    log: (line) => lines.push(String(line ?? "")),
  });

  assert.equal(report.blocked, true);
  assert.equal(report.outcome, "DRY_RUN");
  assert.match(
    report.plan.errors.join("\n"),
    /name map for "Ali" did not match any Sky Sports player/,
  );
  const text = lines.join("\n");
  assert.match(text, /candidates: /);
  assert.match(text, /M\. Shahnawaz/);
  assert.match(text, /unresolved names: [1-9]/);

  const unchanged = await Match.findById(final._id).lean();
  assert.equal(unchanged.source, "live");
  assert.equal(unchanged.manualDraft, false);
  assert.equal(await Player.countDocuments({}), playerCountBefore);
});

test("a name that matches two squad players is ambiguous and BLOCKS", async () => {
  const { final, youngStar } = await seedTournament();
  const extra = await Player.create({ name: "Zahid (TBC)", team: youngStar._id, role: "" });
  await Team.updateOne({ _id: youngStar._id }, { $addToSet: { players: extra._id } });

  const report = await runImportFinal({ apply: true, log: noLog });

  assert.equal(report.blocked, true);
  assert.match(
    report.plan.errors.join("\n"),
    /name map for "ZAHID SR" matches more than one Young Star player/,
  );
  const unchanged = await Match.findById(final._id).lean();
  assert.equal(unchanged.source, "live");
  assert.equal(await Player.countDocuments({ name: "Zahid (TBC)" }), 1);
});

test("man-of-the-match ambiguity stays inside its named team and prints ids", async () => {
  const { final, sky, orangi } = await seedTournament();
  const orangiRaheel = await findPlayerOnTeam(orangi._id, "Raheel");
  const extra = await Player.create({ name: "Raheel", team: sky._id, role: "" });
  await Team.updateOne({ _id: sky._id }, { $addToSet: { players: extra._id } });
  const lines = [];

  const report = await runImportFinal({
    apply: true,
    log: (line) => lines.push(String(line ?? "")),
  });

  assert.equal(report.blocked, true);
  assert.match(
    report.plan.errors.join("\n"),
    /man of the match "Raheel" is ambiguous in Sky Sports's squad/,
  );
  const text = lines.join("\n");
  assert.match(text, new RegExp(`Raheel \\(${extra._id}, Sky Sports\\)`));
  assert.doesNotMatch(text, new RegExp(orangiRaheel._id));
  const unchanged = await Match.findById(final._id).lean();
  assert.equal(unchanged.source, "live");
  assert.equal(await Player.countDocuments({ name: "Raheel", team: sky._id }), 2);
});

test("a CREATE: mapping is rejected and no player is created", async () => {
  const { final } = await seedTournament();
  const { data, mapping } = loadImportFiles();
  mapping["Sky Sports::Akbar"] = "CREATE:New Bowler";
  const playerCountBefore = await Player.countDocuments({});

  const report = await runImportFinal({
    apply: true,
    log: noLog,
    data,
    nameMap: mapping,
  });

  assert.equal(report.blocked, true);
  assert.match(report.plan.errors.join("\n"), /CREATE: value; this importer never creates players/);
  assert.equal(await Player.countDocuments({ name: "New Bowler" }), 0);
  assert.equal(await Player.countDocuments({}), playerCountBefore);
  const unchanged = await Match.findById(final._id).lean();
  assert.equal(unchanged.source, "live");
});

// ---------------------------------------------------------------------------
// Validation failures
// ---------------------------------------------------------------------------

test("a scorecard total that does not reconcile BLOCKS before any write", async () => {
  const { final } = await seedTournament();
  const { data, mapping } = loadImportFiles();
  data.innings[0].runs = 293; // batting 283 + extras 9 is 292

  const report = await runImportFinal({
    apply: true,
    log: noLog,
    data,
    nameMap: mapping,
  });

  assert.equal(report.blocked, true);
  assert.match(
    report.plan.errors.join("\n"),
    /batting \+ extras = total: batting 283 \+ extras 9 = 292, expected 293/,
  );
  const unchanged = await Match.findById(final._id).lean();
  assert.equal(unchanged.source, "live");
  assert.equal(unchanged.manualDraft, false);
});

test("partnership/FOW validation catches a cumulative mismatch", async () => {
  const { final } = await seedTournament();
  const { data, mapping } = loadImportFiles();
  data.innings[0].partnerships[0].runs = 103;

  const report = await runImportFinal({
    apply: true,
    log: noLog,
    data,
    nameMap: mapping,
  });

  assert.equal(report.blocked, true);
  assert.match(
    report.plan.errors.join("\n"),
    /partnership 1: cumulative runs 103 do not equal fall-of-wicket 1 at 102/,
  );
  const unchanged = await Match.findById(final._id).lean();
  assert.equal(unchanged.source, "live");
});

// ---------------------------------------------------------------------------
// Blocked fixture states
// ---------------------------------------------------------------------------

test("a fixture that already has live scoring data is refused", async () => {
  const { final, sky } = await seedTournament();
  await Match.updateOne(
    { _id: final._id },
    {
      status: "live",
      "innings.0.runs": 12,
      "innings.0.balls": 6,
      "innings.0.batting": [{ player: sky._id, runs: 12, balls: 6, isOut: false }],
    },
  );

  const lines = [];
  const report = await runImportFinal({
    apply: true,
    log: (line) => lines.push(String(line ?? "")),
  });

  assert.equal(report.blocked, true);
  assert.match(lines.join("\n"), /not an empty upcoming fixture/);
  const unchanged = await Match.findById(final._id).lean();
  assert.equal(unchanged.source, "live");
  assert.equal(unchanged.status, "live");
  assert.equal(unchanged.innings[0].runs, 12);
});

test("a completed fixture is refused instead of being overwritten", async () => {
  const { final, sky } = await seedTournament();
  await Match.updateOne(
    { _id: final._id },
    {
      status: "completed",
      result: { resultType: "normal", winner: sky._id, description: "Already played" },
    },
  );

  const report = await runImportFinal({ apply: true, log: noLog });

  assert.equal(report.blocked, true);
  const unchanged = await Match.findById(final._id).lean();
  assert.equal(unchanged.status, "completed");
  assert.equal(unchanged.source, "live");
});

test("an empty fixture with ball-by-ball rows is refused", async () => {
  const { final } = await seedTournament();
  await Ball.create({ matchId: final._id });

  const report = await runImportFinal({ apply: true, log: noLog });

  assert.equal(report.blocked, true);
  const unchanged = await Match.findById(final._id).lean();
  assert.equal(unchanged.source, "live");
  assert.equal(unchanged.status, "upcoming");
});

// ---------------------------------------------------------------------------
// Publish and public read-only state
// ---------------------------------------------------------------------------

test("publishing the draft reveals the Final, derives completed, and crowns Sky Sports", async () => {
  const { tournament, final, sky, youngStar } = await seedTournament();
  const applied = await runImportFinal({ apply: true, log: noLog });
  assert.equal(applied.outcome, "APPLIED");

  const tournamentDoc = await Tournament.findById(tournament._id).lean();

  // Before publish: the draft Final is invisible, so the knockout is ongoing.
  const beforeMatches = await publicMatches(tournament._id);
  assert.equal(deriveTournamentPublicState(tournamentDoc, beforeMatches).status, "ongoing");
  const beforeBracket = buildTournamentBracket(beforeMatches, { type: "knockout" });
  const beforeFinal = beforeBracket.stages.find((stage) => stage.stage === "final").matches[0];
  assert.equal(beforeFinal.placeholder, true, "the draft Final must not be public");
  assert.deepEqual(
    beforeFinal.teams.map((team) => team.name).sort(),
    ["Sky Sports", "Young Star"],
  );

  const beforeContent = mockRes();
  await getTournamentContent(mockReq({ params: { id: String(tournament._id) } }), beforeContent);
  assert.equal(beforeContent.statusCode, 200);
  assert.equal(beforeContent.body.overview.status, "ongoing");

  const beforeHub = mockRes();
  await getTournament(mockReq({ params: { id: String(tournament._id) } }), beforeHub);
  assert.equal(beforeHub.statusCode, 200);
  assert.equal(
    (beforeHub.body.matches || []).some((match) => String(match._id) === String(final._id)),
    false,
  );

  const beforeFixtures = mockRes();
  await getTournamentFixtures(mockReq({ params: { id: String(tournament._id) } }), beforeFixtures);
  assert.equal(beforeFixtures.statusCode, 200);
  assert.equal(
    beforeFixtures.body.some((match) => String(match._id) === String(final._id)),
    false,
  );

  const statsBefore = await gatherTournamentStats(tournamentDoc);

  // Publish is the owner's step; it uses the same path as the Admin button.
  const publish = await runPublish({ matchIds: [String(final._id)], apply: true, log: noLog });
  assert.equal(publish.counts.PUBLISHED, 1);

  const published = await Match.findById(final._id).lean();
  assert.equal(published.manualDraft, false);
  assert.equal(published.status, "completed");

  // After publish: the Final is public, the bracket shows the result/winner and
  // the derived tournament status is completed.
  const afterMatches = await publicMatches(tournament._id);
  assert.equal(deriveTournamentPublicState(tournamentDoc, afterMatches).status, "completed");
  const afterBracket = buildTournamentBracket(afterMatches, { type: "knockout" });
  const afterFinal = afterBracket.stages.find((stage) => stage.stage === "final").matches[0];
  assert.equal(afterFinal.placeholder, false);
  assert.equal(afterFinal.stageLabel, "Final");
  assert.equal(afterFinal.winner._id, String(sky._id));
  assert.equal(afterFinal.result.winnerId, String(sky._id));
  assert.equal(
    afterFinal.result.description,
    "Sky Sports won by 9 wickets (14 balls remaining).",
  );
  assert.equal(afterBracket.champion._id, String(sky._id));
  assert.equal(afterBracket.champion.name, "Sky Sports");
  assert.deepEqual(afterFinal.teams.map((team) => team.name), ["Young Star", "Sky Sports"]);
  assert.equal(afterFinal.teams.find((team) => team.name === "Young Star").score.text, "292/7");
  assert.equal(afterFinal.teams.find((team) => team.name === "Sky Sports").score.text, "295/1");
  // The public title is preserved from the fixture even though the stored order
  // is now Young Star first. This is the known display-order gap.
  assert.equal(afterFinal.title, "Final: Sky Sports vs Young Star");

  const afterContent = mockRes();
  await getTournamentContent(mockReq({ params: { id: String(tournament._id) } }), afterContent);
  assert.equal(afterContent.statusCode, 200);
  assert.equal(afterContent.body.overview.status, "completed");

  const afterHub = mockRes();
  await getTournament(mockReq({ params: { id: String(tournament._id) } }), afterHub);
  assert.equal(afterHub.statusCode, 200);
  assert.ok(
    (afterHub.body.matches || []).some((match) => String(match._id) === String(final._id)),
    "the published Final must be on the public tournament page",
  );
  // Known gap: publishing does not write Tournament.winner/runnerUp.
  assert.equal(afterHub.body.winner, undefined);

  const afterFixtures = mockRes();
  await getTournamentFixtures(mockReq({ params: { id: String(tournament._id) } }), afterFixtures);
  const publicFinal = afterFixtures.body.find((match) => String(match._id) === String(final._id));
  assert.ok(publicFinal);
  assert.equal(publicFinal.status, "completed");

  const afterStandings = mockRes();
  await getTournamentStandings(mockReq({ params: { id: String(tournament._id) } }), afterStandings);
  assert.equal(afterStandings.statusCode, 200);
  const standingsFinal = afterStandings.body.bracket.stages
    .find((stage) => stage.stage === "final")
    .matches.find((card) => card.stageLabel === "Final");
  assert.equal(standingsFinal.winner._id, String(sky._id));

  const statsAfter = await gatherTournamentStats(tournamentDoc);
  assert.equal(statsAfter.totalRuns - statsBefore.totalRuns, 587);
  assert.ok(
    statsAfter.topRunScorers.some((row) => row.name === "Raheel" && row.runs === 154),
    "Raheel's 154 must enter the public aggregates",
  );
  assert.ok(
    statsAfter.topRunScorers.some((row) => row.name === "Ejaz" || row.name === "Ijaz Koistani"),
  );

  const contentStats = mockRes();
  contentStats.set = () => contentStats;
  await getTournamentStats(
    mockReq({ params: { id: String(tournament._id) }, query: { fresh: "1" } }),
    contentStats,
  );
  assert.equal(contentStats.statusCode, 200);
  assert.equal(contentStats.body.totalRuns, statsAfter.totalRuns);

  // Reference the resolved entities so the test documents the expected teams.
  assert.ok(afterFinal.teams.some((team) => team._id === String(youngStar._id)));
  assert.ok(afterFinal.teams.some((team) => team._id === String(sky._id)));
});

// ---------------------------------------------------------------------------
// CLI guard
// ---------------------------------------------------------------------------

test("the CLI refuses a test/e2e database without --force-test", async () => {
  const original = process.env.MONGO_URL;
  process.env.MONGO_URL = "mongodb://127.0.0.1:27017/cric-all-e2e";
  try {
    await assert.rejects(
      () => main(["node", "importFinalResult.js"]),
      /Refusing a test\/e2e database/,
    );
  } finally {
    process.env.MONGO_URL = original;
  }
});
