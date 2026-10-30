// Tests for src/scripts/importSf2Result.js.
//
// Everything runs against a throwaway mongodb-memory-server database. The test
// seeds the real SF2 fixture through the shared fixture path, then exercises
// the importer's dry-run/apply/SKIP/blocked paths. No real environment is
// touched and the scorecard must stay a DRAFT until an owner publishes it.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import Player from "../src/models/Player.js";
import Team from "../src/models/Team.js";
import Match from "../src/models/Match.js";
import Tournament from "../src/models/Tournament.js";
import { getTournamentFixtures } from "../src/controllers/TournamentController.js";
import {
  getTournamentStandings,
  getTournamentStats,
} from "../src/controllers/TournamentContentController.js";
import { buildTournamentBracket } from "../src/services/tournamentBracket.js";
import { gatherTournamentStats } from "../src/services/tournamentStats.js";
import { runCreateSemiFinals } from "../src/scripts/createSemiFinals.js";
import { runPublish } from "../src/scripts/publishManualMatches.js";
import {
  loadImportFiles,
  main,
  runImportSf2Result,
} from "../src/scripts/importSf2Result.js";

let mongod;
let seq = 0;
const noLog = () => {};

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

// Real squads as they exist in the live database. Zahid (TBC) is deliberately
// already present: the importer must reuse it on Young Star, not create a
// second placeholder. Khan Associates' Shani and Player3 are absent, so they
// must become team-scoped placeholders.
const ROSTERS = {
  "Young Star": [
    "Abdul Salam",
    "Br. Aqal",
    "Ijaz Koistani",
    "Kamran Khan",
    "Khan Aziz",
    "Luqman Khan",
    "Majid Afridi",
    "Majid Afridi (2)",
    "Naveed Akhtar",
    "Saleem Agha",
    "Salman Khan",
    "Salman Khan JR",
    "Sulman Afridi",
    "Umar Afridi",
    "Usman Masood",
    "Zahid (TBC)",
  ],
  "Khan Associates": [
    "Abdullah",
    "Hamza Khan",
    "Hussain",
    "N. Imran",
    "Parveez Butt",
    "Qari Sajjad",
    "Raheem",
    "Saad",
    "Sabir",
    "Saleem",
    "Shan",
    "SM Khan",
    "Taj Afridi",
    "Umar",
    "Waqar Kundi",
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
    slug: `all-baldia-sf2-${seq}`,
    type: "knockout",
    format: "T20",
    venue: "Tahirabad Ground",
    startDate: new Date("2026-10-01T00:00:00.000Z"),
    endDate: new Date("2026-10-31T00:00:00.000Z"),
    teams: teams.map((team) => team._id),
    rules: { twelfthManEnabled: true },
  });

  // The shared fixture path only draws a semi-final from completed QF winners.
  // The QF innings intentionally carry no batting rows so the SF2 player stats
  // are easy to assert (Ijaz's 94 is the only big score).
  const qfResults = [
    ["Young Star", "Orangi Warriors"],
    ["Sky Sports", "Orangi United"],
    ["Baldia Zalmi", "Malir Friends"],
    ["Khan Associates", "Gulshan XI"],
  ];
  const qfIds = [];
  for (let index = 0; index < qfResults.length; index += 1) {
    const [winnerName, loserName] = qfResults[index];
    const winner = byName.get(winnerName);
    const loser = byName.get(loserName);
    const qf = await Match.create({
      title: `QF${index + 1}: ${winnerName} vs ${loserName}`,
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
      result: { resultType: "normal", winner: winner._id, description: `${winnerName} won` },
      innings: [
        { team: winner._id, runs: 150 + index, wickets: 6, balls: 120, status: "completed" },
        { team: loser._id, runs: 140 + index, wickets: 9, balls: 120, status: "completed" },
      ],
    });
    qfIds.push(qf._id);
  }
  tournament.matches = qfIds;
  await tournament.save();

  // Use the same creation path the operator uses; this pins the fixture shape
  // (source live, two empty innings, linked in Tournament.matches).
  const created = await runCreateSemiFinals({ apply: true, log: noLog });
  assert.equal(created.blocked, false);

  const sf1 = await Match.findOne({
    tournament: tournament._id,
    stage: "semi_final",
    stageLabel: "SF1",
  });
  const sf2 = await Match.findOne({
    tournament: tournament._id,
    stage: "semi_final",
    stageLabel: "SF2",
  });
  assert.ok(sf1 && sf2);

  return {
    tournament,
    teams,
    byName,
    sf1,
    sf2,
    youngStar: byName.get("Young Star"),
    khan: byName.get("Khan Associates"),
  };
}

const findPlayerOnTeam = async (teamId, name) =>
  Player.findOne({ team: teamId, name });

async function moveZahidToKhan(youngStar, khan) {
  const zahid = await findPlayerOnTeam(youngStar._id, "Zahid (TBC)");
  assert.ok(zahid);
  await Player.updateOne({ _id: zahid._id }, { team: khan._id });
  await Team.updateOne({ _id: khan._id }, { $addToSet: { players: zahid._id } });
  // Young Star's roster still contains the id on purpose: the importer must
  // ignore it because Player.team now points at Khan Associates.
  return zahid;
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
  ]);
});

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------

test("dry run validates the SF2 scorecard and writes nothing", async () => {
  const { tournament, sf2 } = await seedTournament();
  const linkedBefore = (await Tournament.findById(tournament._id).lean()).matches.map(String);

  const report = await runImportSf2Result({ apply: false, log: noLog });

  assert.equal(report.outcome, "DRY_RUN");
  assert.equal(report.blocked, false);
  assert.deepEqual(report.plan.errors, []);
  assert.equal(report.plan.innings[0].checks.total, 198);
  assert.equal(report.plan.innings[1].checks.total, 199);
  assert.equal(report.plan.innings[0].checks.bowlingTotal, 198);
  assert.equal(report.plan.innings[1].checks.bowlingTotal, 199);
  assert.deepEqual(
    report.placeholders.wouldCreate.map((row) => row.name).sort(),
    ["Player3 (TBC)", "Shani (TBC)"],
  );

  const unchanged = await Match.findById(sf2._id).lean();
  assert.equal(unchanged.source, "live");
  assert.equal(unchanged.manualDraft, false);
  assert.equal(unchanged.status, "upcoming");
  assert.equal(unchanged.innings[0].batting.length, 0);
  assert.equal(await Player.countDocuments({ name: "Player3 (TBC)" }), 0);
  assert.equal(await Player.countDocuments({ name: "Shani (TBC)" }), 0);
  assert.equal(
    (await Tournament.findById(tournament._id).lean()).matches.map(String).sort().join(","),
    linkedBefore.sort().join(","),
  );
});

// ---------------------------------------------------------------------------
// Apply in place
// ---------------------------------------------------------------------------

test("apply converts the existing SF2 fixture into a draft scorecard in place", async () => {
  const { tournament, sf2, youngStar, khan } = await seedTournament();
  const original = await Match.findById(sf2._id).lean();
  const matchCountBefore = await Match.countDocuments({});
  const linkedBefore = (await Tournament.findById(tournament._id).lean()).matches.map(String).sort();
  const statsBefore = await gatherTournamentStats(tournament);
  const lines = [];

  const report = await runImportSf2Result({
    apply: true,
    log: (line) => lines.push(String(line ?? "")),
  });
  assert.equal(report.outcome, "APPLIED");
  assert.equal(report.blocked, false);
  assert.match(
    lines.join("\n"),
    /scorecard  : Young Star 199\/4 vs Khan Associates 198\/9/,
    "the summary must follow the saved innings/team order",
  );

  // No duplicate SF2 and no new match document.
  assert.equal(await Match.countDocuments({}), matchCountBefore);
  assert.equal(
    await Match.countDocuments({ tournament: tournament._id, stage: "semi_final" }),
    2,
  );

  const saved = await Match.findById(sf2._id).lean();
  assert.equal(String(saved._id), String(original._id));
  assert.equal(String(saved.tournament), String(tournament._id));
  assert.equal(saved.stage, "semi_final");
  assert.equal(saved.stageLabel, "SF2");
  assert.equal(saved.round, "SF2");
  assert.equal(saved.title, "SF2: Young Star vs Khan Associates");
  assert.equal(saved.venue, "Tahirabad Ground");
  assert.equal(saved.startAt.toISOString(), original.startAt.toISOString());
  assert.deepEqual(saved.teams.map(String), original.teams.map(String));
  assert.equal(saved.totalOvers, 20);
  assert.equal(saved.matchCategory, "Club");

  // Draft, never published.
  assert.equal(saved.source, "manual");
  assert.equal(saved.manualDraft, true);
  assert.equal(saved.status, "upcoming");

  // applyInnings stores innings in fixture team order: Young Star then Khan.
  const [youngInnings, khanInnings] = saved.innings;
  assert.equal(String(youngInnings.team), String(youngStar._id));
  assert.equal(youngInnings.runs, 199);
  assert.equal(youngInnings.wickets, 4);
  assert.equal(youngInnings.balls, 90);
  assert.deepEqual(
    {
      wides: youngInnings.extras.wides,
      noBalls: youngInnings.extras.noBalls,
      byes: youngInnings.extras.byes,
      legByes: youngInnings.extras.legByes,
    },
    { wides: 17, noBalls: 5, byes: 1, legByes: 1 },
  );
  assert.equal(youngInnings.batting.length, 6);
  assert.equal(youngInnings.bowling.length, 7);
  assert.equal(youngInnings.fallOfWickets.length, 4);
  const ijaz = youngInnings.batting.find((row) => row.runs === 94);
  assert.ok(ijaz);
  assert.equal(ijaz.sixes, 13);
  assert.equal(ijaz.isOut, false);
  const player3 = youngInnings.bowling.find((row) => row.runs === 3);
  assert.ok(player3);
  assert.equal(player3.balls, 0);

  assert.equal(String(khanInnings.team), String(khan._id));
  assert.equal(khanInnings.runs, 198);
  assert.equal(khanInnings.wickets, 9);
  assert.equal(khanInnings.balls, 114);
  assert.deepEqual(
    {
      wides: khanInnings.extras.wides,
      noBalls: khanInnings.extras.noBalls,
      byes: khanInnings.extras.byes,
      legByes: khanInnings.extras.legByes,
    },
    { wides: 11, noBalls: 0, byes: 8, legByes: 0 },
  );
  assert.equal(khanInnings.batting.length, 10);
  assert.equal(khanInnings.bowling.length, 5);
  assert.equal(khanInnings.fallOfWickets.length, 9);
  assert.ok(khanInnings.fallOfWickets.every((row) => row.player == null));
  assert.ok(khanInnings.fallOfWickets.every((row) => row.overs === 0));
  assert.ok(
    khanInnings.batting.filter((row) => row.isOut).every((row) => row.dismissalType === "out"),
  );
  assert.ok(
    khanInnings.batting.filter((row) => row.isOut).every((row) => !row.dismissedBy && !row.fielder),
  );

  assert.equal(saved.tossWinner, null);
  assert.ok(!saved.tossDecision);
  assert.equal(String(saved.result.winner), String(youngStar._id));
  assert.equal(saved.result.margin, "6 wickets");
  assert.equal(saved.result.resultType, "normal");
  assert.equal(saved.manOfMatch, null);
  assert.equal(saved.result.description, "Young Star won by 6 wickets (30 balls remaining).");

  // Tournament link is unchanged and the draft is hidden from the public bracket.
  const linkedAfter = (await Tournament.findById(tournament._id).lean()).matches.map(String).sort();
  assert.deepEqual(linkedAfter, linkedBefore);

  const matches = await Match.find({ tournament: tournament._id }).populate("teams", "name shortName logo").lean();
  const bracket = buildTournamentBracket(matches, { type: "knockout" });
  const semiFinal = bracket.stages.find((stage) => stage.stage === "semi_final");
  const publishedSemis = semiFinal.matches.filter((card) => !card.placeholder);
  assert.equal(publishedSemis.length, 1, "only the undrafted SF1 is public");
  assert.equal(publishedSemis[0].stageLabel, "SF1");

  const statsAfter = await gatherTournamentStats(tournament);
  assert.equal(statsAfter.totalRuns, statsBefore.totalRuns, "the draft must not change hub stats");

  const beforeFixtures = mockRes();
  await getTournamentFixtures(mockReq({ params: { id: String(tournament._id) } }), beforeFixtures);
  assert.equal(beforeFixtures.statusCode, 200);
  assert.equal(beforeFixtures.body.some((match) => String(match._id) === String(sf2._id)), false);
});

test("a second apply is a SKIP and does not duplicate players or matches", async () => {
  const { tournament, sf2, youngStar, khan } = await seedTournament();
  const first = await runImportSf2Result({ apply: true, log: noLog });
  assert.equal(first.outcome, "APPLIED");

  const before = await Match.findById(sf2._id).lean();
  const second = await runImportSf2Result({ apply: true, log: noLog });

  assert.equal(second.outcome, "SKIP");
  assert.equal(second.blocked, false);
  const after = await Match.findById(sf2._id).lean();
  assert.equal(after.source, "manual");
  assert.equal(after.manualDraft, true);
  assert.equal(after.status, "upcoming");
  assert.equal(JSON.stringify(after.innings), JSON.stringify(before.innings));
  assert.equal(await Match.countDocuments({ tournament: tournament._id, stage: "semi_final" }), 2);
  assert.equal(await Player.countDocuments({ name: "Player3 (TBC)" }), 1);
  assert.equal(await Player.countDocuments({ name: "Shani (TBC)" }), 1);
  assert.equal(await Player.countDocuments({ name: "Zahid (TBC)" }), 1);
  assert.ok(await findPlayerOnTeam(khan._id, "Player3 (TBC)"));
  assert.ok(await findPlayerOnTeam(khan._id, "Shani (TBC)"));
  assert.ok(await findPlayerOnTeam(youngStar._id, "Zahid (TBC)"));
});

// ---------------------------------------------------------------------------
// Placeholders are team-scoped
// ---------------------------------------------------------------------------

test("placeholders are created on the right squads and never borrowed across teams", async () => {
  const { youngStar, khan } = await seedTournament();
  const report = await runImportSf2Result({ apply: true, log: noLog });
  assert.equal(report.outcome, "APPLIED");

  for (const name of ["Player3 (TBC)", "Shani (TBC)"]) {
    const player = await findPlayerOnTeam(khan._id, name);
    assert.ok(player, `${name} should exist on Khan Associates`);
    assert.equal(await findPlayerOnTeam(youngStar._id, name), null);
    const team = await Team.findById(khan._id).lean();
    assert.equal(team.players.map(String).includes(String(player._id)), true);
  }

  const zahid = await findPlayerOnTeam(youngStar._id, "Zahid (TBC)");
  assert.ok(zahid);
  assert.equal(await Player.countDocuments({ name: "Zahid (TBC)" }), 1);
  assert.equal(await findPlayerOnTeam(khan._id, "Zahid (TBC)"), null);
});

test("Young Star's Zahid (TBC) is not borrowed from another team", async () => {
  const { youngStar, khan } = await seedTournament();
  const khanZahid = await moveZahidToKhan(youngStar, khan);

  const lines = [];
  const report = await runImportSf2Result({
    apply: true,
    log: (line) => lines.push(String(line ?? "")),
  });
  assert.equal(report.outcome, "APPLIED");
  assert.equal(report.blocked, false);

  const youngZahid = await findPlayerOnTeam(youngStar._id, "Zahid (TBC)");
  assert.ok(youngZahid, "Young Star must get its own Zahid (TBC)");
  assert.notEqual(String(youngZahid._id), String(khanZahid._id));
  assert.equal(String(youngZahid.team), String(youngStar._id));
  assert.equal(await Player.countDocuments({ name: "Zahid (TBC)" }), 2);

  const freshKhanZahid = await Player.findById(khanZahid._id).lean();
  assert.equal(freshKhanZahid.name, "Zahid (TBC)");
  assert.equal(String(freshKhanZahid.team), String(khan._id));
  const freshKhan = await Team.findById(khan._id).lean();
  assert.equal(freshKhan.players.map(String).includes(String(youngZahid._id)), false);

  assert.match(
    lines.join("\n"),
    /\[batting\] "Zahid" \[Young Star\] -> Zahid \(TBC\)/,
    "the name map must print the expected team next to the mapping",
  );
});

test("a name map that points to another team's player is BLOCKED", async () => {
  const { sf2, youngStar, khan } = await seedTournament();
  const khanZahid = await moveZahidToKhan(youngStar, khan);
  const { data, mapping } = loadImportFiles();
  mapping["Young Star::Zahid"] = "Zahid (TBC)";

  const report = await runImportSf2Result({
    apply: true,
    log: noLog,
    data,
    nameMap: mapping,
  });

  assert.equal(report.blocked, true);
  assert.match(
    report.plan.errors.join("\n"),
    /points to player "Zahid \(TBC\)" of Khan Associates; expected a player in Young Star/,
  );
  const unchanged = await Match.findById(sf2._id).lean();
  assert.equal(unchanged.source, "live");
  assert.equal(unchanged.manualDraft, false);
  assert.equal(await Player.countDocuments({ name: "Zahid (TBC)" }), 1);
  assert.equal(String((await Player.findById(khanZahid._id).lean()).team), String(khan._id));
});

test("the plan prints the expected team on every name-map line", async () => {
  await seedTournament();
  const lines = [];
  const report = await runImportSf2Result({
    apply: false,
    log: (line) => lines.push(String(line ?? "")),
  });
  assert.equal(report.blocked, false);

  const nameMapIndex = lines.indexOf("Name map:");
  assert.notEqual(nameMapIndex, -1);
  const mapLines = lines
    .slice(nameMapIndex + 1)
    .filter((line) => /^  \[(batting|bowling)\]/.test(line));
  assert.ok(mapLines.length > 0);
  for (const line of mapLines) {
    assert.match(line, /\[(Young Star|Khan Associates)\] -> /, `missing team on: ${line}`);
  }
  assert.match(lines.join("\n"), /\[batting\] "Zahid" \[Young Star\] -> Zahid \(TBC\)/);
  assert.match(lines.join("\n"), /team safety : .*a mismatch BLOCKS/);
});

test("publishing the draft is the owner's step and reveals SF2 in the public bracket", async () => {
  const { tournament, sf2, youngStar } = await seedTournament();
  const applied = await runImportSf2Result({ apply: true, log: noLog });
  assert.equal(applied.outcome, "APPLIED");

  const statsBeforePublish = await gatherTournamentStats(tournament);
  const beforeFixtures = mockRes();
  await getTournamentFixtures(mockReq({ params: { id: String(tournament._id) } }), beforeFixtures);
  assert.equal(beforeFixtures.statusCode, 200);
  assert.equal(beforeFixtures.body.some((match) => String(match._id) === String(sf2._id)), false);

  const beforeStandings = mockRes();
  await getTournamentStandings(mockReq({ params: { id: String(tournament._id) } }), beforeStandings);
  const beforeSemiFinal = beforeStandings.body.bracket.stages.find((stage) => stage.stage === "semi_final");
  assert.deepEqual(
    beforeSemiFinal.matches.filter((match) => !match.placeholder).map((match) => match.stageLabel),
    ["SF1"],
  );

  const beforeStats = mockRes();
  beforeStats.set = () => beforeStats;
  await getTournamentStats(
    mockReq({ params: { id: String(tournament._id) }, query: { fresh: "1" } }),
    beforeStats,
  );
  assert.equal(beforeStats.statusCode, 200);

  const publish = await runPublish({ matchIds: [String(sf2._id)], apply: true, log: noLog });
  assert.equal(publish.counts.PUBLISHED, 1);

  const published = await Match.findById(sf2._id).lean();
  assert.equal(published.manualDraft, false);
  assert.equal(published.status, "completed");

  const afterMatches = await Match.find({ tournament: tournament._id }).populate("teams", "name shortName logo").lean();
  const afterBracket = buildTournamentBracket(afterMatches, { type: "knockout" });
  const afterSemi = afterBracket.stages.find((stage) => stage.stage === "semi_final");
  const sf2Card = afterSemi.matches.find((card) => card.stageLabel === "SF2");
  assert.ok(sf2Card, "SF2 is public after publish");
  assert.equal(sf2Card.winner._id, String(youngStar._id));
  assert.equal(sf2Card.teams.find((team) => team.name === "Khan Associates").score.text, "198/9");
  assert.equal(sf2Card.teams.find((team) => team.name === "Young Star").score.text, "199/4");

  const finalStage = afterBracket.stages.find((stage) => stage.stage === "final");
  assert.equal(finalStage.matches[0].placeholder, true, "the Final fixture stays a placeholder until it is drawn");
  const finalNames = finalStage.matches[0].teams.map((team) => team.name);
  assert.ok(finalNames.includes("Young Star"), "Young Star must be in the Final slot");
  assert.equal(finalNames.some((name) => /TBD/i.test(name)), false);

  const statsAfterPublish = await gatherTournamentStats(tournament);
  assert.equal(statsAfterPublish.totalRuns - statsBeforePublish.totalRuns, 397);
  assert.ok(
    statsAfterPublish.topRunScorers.some((row) => row.name === "Ijaz Koistani" && row.runs === 94),
  );

  const afterFixtures = mockRes();
  await getTournamentFixtures(mockReq({ params: { id: String(tournament._id) } }), afterFixtures);
  const publicSf2 = afterFixtures.body.find((match) => String(match._id) === String(sf2._id));
  assert.ok(publicSf2);
  assert.equal(publicSf2.status, "completed");

  const afterStandings = mockRes();
  await getTournamentStandings(mockReq({ params: { id: String(tournament._id) } }), afterStandings);
  const finalPlaceholder = afterStandings.body.bracket.stages.find((stage) => stage.stage === "final").matches[0];
  assert.ok(finalPlaceholder.teams.map((team) => team.name).includes("Young Star"));

  const afterStats = mockRes();
  afterStats.set = () => afterStats;
  await getTournamentStats(
    mockReq({ params: { id: String(tournament._id) }, query: { fresh: "1" } }),
    afterStats,
  );
  assert.equal(afterStats.body.totalRuns - beforeStats.body.totalRuns, 397);
  assert.ok(afterStats.body.topRunScorers.some((row) => row.name === "Ijaz Koistani" && row.runs === 94));
});

// ---------------------------------------------------------------------------
// Blocked paths
// ---------------------------------------------------------------------------

test("a fixture whose teams are not Young Star vs Khan Associates is BLOCKED", async () => {
  const { tournament, sf2, byName } = await seedTournament();
  await Match.updateOne(
    { _id: sf2._id },
    { teams: [byName.get("Young Star")._id, byName.get("Baldia Zalmi")._id] },
  );

  const report = await runImportSf2Result({ apply: true, log: noLog });

  assert.equal(report.blocked, true);
  assert.equal(report.outcome, "DRY_RUN");
  assert.match(report.plan.errors.join("\n"), /expected Young Star and Khan Associates/);
  const unchanged = await Match.findById(sf2._id).lean();
  assert.equal(unchanged.source, "live");
  assert.equal(unchanged.manualDraft, false);
  assert.equal(await Player.countDocuments({ name: "Player3 (TBC)" }), 0);
  assert.equal(await Match.countDocuments({ tournament: tournament._id, stage: "semi_final" }), 2);
});

test("validation errors block the write before any draft or placeholder is saved", async () => {
  const { sf2 } = await seedTournament();
  const { data, mapping } = loadImportFiles();
  data.innings[0].runs = 199; // batting 179 + extras 19 is 198

  const report = await runImportSf2Result({
    apply: true,
    log: noLog,
    data,
    nameMap: mapping,
  });

  assert.equal(report.blocked, true);
  assert.match(report.plan.errors.join("\n"), /batting runs 179 \+ extras 19 = 198, expected 199/);
  const unchanged = await Match.findById(sf2._id).lean();
  assert.equal(unchanged.source, "live");
  assert.equal(unchanged.manualDraft, false);
  assert.equal(await Player.countDocuments({ name: "Player3 (TBC)" }), 0);
});

test("a scored fixture is refused instead of being overwritten", async () => {
  const { sf2 } = await seedTournament();
  await Match.updateOne(
    { _id: sf2._id },
    {
      status: "live",
      "innings.0.runs": 12,
      "innings.0.balls": 6,
      "innings.0.batting": [{ player: sf2.teams[0], runs: 12, balls: 6, isOut: false }],
    },
  );

  const lines = [];
  const report = await runImportSf2Result({ apply: true, log: (line) => lines.push(String(line ?? "")) });

  assert.equal(report.blocked, true);
  assert.match(lines.join("\n"), /not an empty upcoming fixture/);
  const unchanged = await Match.findById(sf2._id).lean();
  assert.equal(unchanged.source, "live");
  assert.equal(unchanged.status, "live");
  assert.equal(unchanged.innings[0].runs, 12);
});

test("the CLI refuses a test/e2e database without --force-test", async () => {
  const original = process.env.MONGO_URL;
  process.env.MONGO_URL = "mongodb://127.0.0.1:27017/cric-all-e2e";
  try {
    await assert.rejects(
      () => main(["node", "importSf2Result.js"]),
      /Refusing a test\/e2e database/,
    );
  } finally {
    process.env.MONGO_URL = original;
  }
});
