// Tests for src/scripts/importSf1Result.js.
//
// Everything runs against a throwaway mongodb-memory-server database. The test
// seeds the real SF1 fixture through the shared fixture path, then exercises the
// importer's dry-run/apply/SKIP/blocked paths. No real environment is touched and
// the scorecard must stay a DRAFT until an owner publishes it.

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
  runImportSf1Result,
} from "../src/scripts/importSf1Result.js";

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

const ROSTERS = {
  "Baldia Zalmi": [
    "Nasir",
    "Taeem Khan",
    "Ejaz Swati",
    "Wali Amber",
    "Javeed Afridi",
    "Zahid Khan",
    "Lal Zada",
    "Saud Jin",
    "Ghufran",
    "Fazal Bajuri",
    "Danish Rao",
  ],
  "Sky Sports": [
    "Abdul Rehman",
    "Raheel",
    "Wajid",
    "Kamran Kamal",
    "Farooq",
    "Akbar Sadozai",
    "M. Shahnawaz",
    "Usman",
    "M. Zarnain",
  ],
  // Deliberately shares the Sky placeholder name. The importer must create a
  // second player on Sky Sports and leave this one on Orangi United untouched.
  "Orangi United": ["Ali (TBC)"],
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
    slug: `all-baldia-sf1-${seq}`,
    type: "knockout",
    format: "T20",
    venue: "Tahirabad Ground",
    startDate: new Date("2026-10-01T00:00:00.000Z"),
    endDate: new Date("2026-10-31T00:00:00.000Z"),
    teams: teams.map((team) => team._id),
    rules: { twelfthManEnabled: true },
  });

  // The shared fixture path only draws a semi-final from completed QF winners.
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
        { team: winner._id, runs: 150, wickets: 6, balls: 120, status: "completed" },
        { team: loser._id, runs: 140, wickets: 9, balls: 120, status: "completed" },
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
    baldia: byName.get("Baldia Zalmi"),
    sky: byName.get("Sky Sports"),
    orangi: byName.get("Orangi United"),
  };
}

const findPlayerOnTeam = async (teamId, name) =>
  Player.findOne({ team: teamId, name });

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

test("dry run validates the SF1 scorecard and writes nothing", async () => {
  const { tournament, sf1 } = await seedTournament();
  const linkedBefore = (await Tournament.findById(tournament._id).lean()).matches.map(String);

  const report = await runImportSf1Result({ apply: false, log: noLog });

  assert.equal(report.outcome, "DRY_RUN");
  assert.equal(report.blocked, false);
  assert.deepEqual(report.plan.errors, []);
  assert.equal(report.plan.innings[0].checks.total, 274);
  assert.equal(report.plan.innings[1].checks.total, 275);
  assert.deepEqual(
    report.placeholders.wouldCreate.map((row) => row.name).sort(),
    ["Ali (TBC)", "Attack (TBC)", "Attack 1 (TBC)"],
  );

  const unchanged = await Match.findById(sf1._id).lean();
  assert.equal(unchanged.source, "live");
  assert.equal(unchanged.manualDraft, false);
  assert.equal(unchanged.status, "upcoming");
  assert.equal(unchanged.innings[0].batting.length, 0);
  assert.equal(await Player.countDocuments({ name: "Attack (TBC)" }), 0);
  assert.equal(await Player.countDocuments({ name: "Attack 1 (TBC)" }), 0);
  assert.equal(
    (await Tournament.findById(tournament._id).lean()).matches.map(String).sort().join(","),
    linkedBefore.sort().join(","),
  );
});

// ---------------------------------------------------------------------------
// Apply in place
// ---------------------------------------------------------------------------

test("apply converts the existing SF1 fixture into a draft scorecard in place", async () => {
  const { tournament, sf1, baldia, sky } = await seedTournament();
  const original = await Match.findById(sf1._id).lean();
  const matchCountBefore = await Match.countDocuments({});
  const linkedBefore = (await Tournament.findById(tournament._id).lean()).matches.map(String).sort();

  const report = await runImportSf1Result({ apply: true, log: noLog });
  assert.equal(report.outcome, "APPLIED");
  assert.equal(report.blocked, false);

  // No duplicate SF1 and no new match document.
  assert.equal(await Match.countDocuments({}), matchCountBefore);
  assert.equal(
    await Match.countDocuments({ tournament: tournament._id, stage: "semi_final" }),
    2,
  );

  const saved = await Match.findById(sf1._id).lean();
  assert.equal(String(saved._id), String(original._id));
  assert.equal(String(saved.tournament), String(tournament._id));
  assert.equal(saved.stage, "semi_final");
  assert.equal(saved.stageLabel, "SF1");
  assert.equal(saved.round, "SF1");
  assert.equal(saved.title, "SF1: Baldia Zalmi vs Sky Sports");
  assert.equal(saved.venue, "Tahirabad Ground");
  assert.equal(saved.startAt.toISOString(), original.startAt.toISOString());
  assert.deepEqual(saved.teams.map(String), original.teams.map(String));
  assert.equal(saved.totalOvers, 20);
  assert.equal(saved.matchCategory, "Club");

  // Draft, never published.
  assert.equal(saved.source, "manual");
  assert.equal(saved.manualDraft, true);
  assert.equal(saved.status, "upcoming");

  const [first, second] = saved.innings;
  assert.equal(String(first.team), String(baldia._id));
  assert.equal(first.runs, 274);
  assert.equal(first.wickets, 5);
  assert.equal(first.balls, 120);
  assert.equal(first.extras.wides, 30);
  assert.equal(first.extras.noBalls, 0);
  assert.equal(first.batting.length, 7);
  assert.equal(first.bowling.length, 11);
  assert.equal(first.fallOfWickets.length, 5);

  assert.equal(String(second.team), String(sky._id));
  assert.equal(second.runs, 275);
  assert.equal(second.wickets, 4);
  assert.equal(second.balls, 114);
  assert.deepEqual(
    {
      wides: second.extras.wides,
      noBalls: second.extras.noBalls,
      byes: second.extras.byes,
      legByes: second.extras.legByes,
    },
    { wides: 10, noBalls: 2, byes: 4, legByes: 1 },
  );
  assert.equal(second.batting.length, 6);
  assert.equal(second.bowling.length, 7);
  assert.equal(second.fallOfWickets.length, 4);

  assert.equal(String(saved.tossWinner), String(baldia._id));
  assert.equal(saved.tossDecision, "bat");
  assert.equal(String(saved.result.winner), String(sky._id));
  assert.equal(saved.result.margin, "6 wickets");
  assert.equal(saved.result.resultType, "normal");
  assert.equal(saved.manOfMatch, null);
  assert.equal(saved.result.description, "Sky Sports won by 6 wickets (6 balls remaining).");

  // Tournament link is unchanged and the draft is hidden from the public bracket.
  const linkedAfter = (await Tournament.findById(tournament._id).lean()).matches.map(String).sort();
  assert.deepEqual(linkedAfter, linkedBefore);

  const matches = await Match.find({ tournament: tournament._id }).populate("teams", "name shortName logo").lean();
  const bracket = buildTournamentBracket(matches, { type: "knockout" });
  const semiFinal = bracket.stages.find((stage) => stage.stage === "semi_final");
  const publishedSemis = semiFinal.matches.filter((card) => !card.placeholder);
  assert.equal(publishedSemis.length, 1, "only the undrafted SF2 is public");
  assert.equal(publishedSemis[0].stageLabel, "SF2");
});

test("a second apply is a SKIP and does not duplicate players or matches", async () => {
  const { tournament, sf1 } = await seedTournament();
  const first = await runImportSf1Result({ apply: true, log: noLog });
  assert.equal(first.outcome, "APPLIED");

  const before = await Match.findById(sf1._id).lean();
  const second = await runImportSf1Result({ apply: true, log: noLog });

  assert.equal(second.outcome, "SKIP");
  assert.equal(second.blocked, false);
  const after = await Match.findById(sf1._id).lean();
  assert.equal(after.source, "manual");
  assert.equal(after.manualDraft, true);
  assert.equal(after.status, "upcoming");
  assert.equal(JSON.stringify(after.innings), JSON.stringify(before.innings));
  assert.equal(await Match.countDocuments({ tournament: tournament._id, stage: "semi_final" }), 2);
  assert.equal(await Player.countDocuments({ name: "Attack (TBC)" }), 1);
  assert.equal(await Player.countDocuments({ name: "Attack 1 (TBC)" }), 1);
  assert.equal(await Player.countDocuments({ name: "Ali (TBC)" }), 2);
});

// ---------------------------------------------------------------------------
// Placeholders are team-scoped
// ---------------------------------------------------------------------------

test("placeholders are created on Sky Sports and Orangi United's Ali is untouched", async () => {
  const { sky, orangi } = await seedTournament();
  const orangiAli = await findPlayerOnTeam(orangi._id, "Ali (TBC)");
  assert.ok(orangiAli);

  const report = await runImportSf1Result({ apply: true, log: noLog });
  assert.equal(report.outcome, "APPLIED");

  const freshOrangiAli = await Player.findById(orangiAli._id).lean();
  assert.equal(freshOrangiAli.name, "Ali (TBC)");
  assert.equal(String(freshOrangiAli.team), String(orangi._id));

  for (const name of ["Attack (TBC)", "Attack 1 (TBC)", "Ali (TBC)"]) {
    const skyPlayer = await findPlayerOnTeam(sky._id, name);
    assert.ok(skyPlayer, `${name} should exist on Sky Sports`);
    assert.notEqual(String(skyPlayer._id), String(orangiAli._id));
  }

  const freshSky = await Team.findById(sky._id).lean();
  const skyPlayerIds = new Set(freshSky.players.map(String));
  for (const name of ["Attack (TBC)", "Attack 1 (TBC)", "Ali (TBC)"]) {
    const player = await findPlayerOnTeam(sky._id, name);
    assert.equal(skyPlayerIds.has(String(player._id)), true, `${name} is in Sky's Team.players`);
  }

  const freshOrangi = await Team.findById(orangi._id).lean();
  assert.equal(freshOrangi.players.map(String).includes(String(orangiAli._id)), true);
  assert.equal(freshOrangi.players.map(String).includes(String((await findPlayerOnTeam(sky._id, "Ali (TBC)"))._id)), false);
});

test("Orangi United's Ali (TBC) is not reused even when Sky's roster is contaminated", async () => {
  const { sky, orangi } = await seedTournament();
  const orangiAli = await findPlayerOnTeam(orangi._id, "Ali (TBC)");
  assert.ok(orangiAli);
  // Reproduce the live QF contamination: Sky's roster contains Orangi's player id.
  await Team.updateOne({ _id: sky._id }, { $addToSet: { players: orangiAli._id } });

  const lines = [];
  const report = await runImportSf1Result({
    apply: true,
    log: (line) => lines.push(String(line ?? "")),
  });
  assert.equal(report.outcome, "APPLIED");
  assert.equal(report.blocked, false);

  const skyAli = await findPlayerOnTeam(sky._id, "Ali (TBC)");
  assert.ok(skyAli, "Sky Sports must get its own Ali (TBC)");
  assert.notEqual(String(skyAli._id), String(orangiAli._id));
  assert.equal(String(skyAli.team), String(sky._id));
  assert.equal(await Player.countDocuments({ name: "Ali (TBC)" }), 2);

  const freshOrangiAli = await Player.findById(orangiAli._id).lean();
  assert.equal(freshOrangiAli.name, "Ali (TBC)");
  assert.equal(String(freshOrangiAli.team), String(orangi._id));
  const freshOrangi = await Team.findById(orangi._id).lean();
  assert.equal(freshOrangi.players.map(String).includes(String(skyAli._id)), false);

  assert.match(
    lines.join("\n"),
    /\[bowling\] "Ali" \[Sky Sports\] -> Ali \(TBC\)/,
    "the name map must print the expected team next to the mapping",
  );
});

test("a name map that points to another team's player is BLOCKED", async () => {
  const { sf1, orangi } = await seedTournament();
  const orangiAli = await findPlayerOnTeam(orangi._id, "Ali (TBC)");
  const { data, mapping } = loadImportFiles();
  mapping["Sky Sports::Ali"] = "Ali (TBC)";

  const report = await runImportSf1Result({
    apply: true,
    log: noLog,
    data,
    nameMap: mapping,
  });

  assert.equal(report.blocked, true);
  assert.match(
    report.plan.errors.join("\n"),
    /points to player "Ali \(TBC\)" of Orangi United; expected a player in Sky Sports/,
  );
  const unchanged = await Match.findById(sf1._id).lean();
  assert.equal(unchanged.source, "live");
  assert.equal(unchanged.manualDraft, false);
  assert.equal(await Player.countDocuments({ name: "Ali (TBC)" }), 1);
  assert.equal(String((await Player.findById(orangiAli._id).lean()).team), String(orangi._id));
});

test("the plan prints the expected team on every name-map line", async () => {
  await seedTournament();
  const lines = [];
  const report = await runImportSf1Result({
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
    assert.match(line, /\[(Baldia Zalmi|Sky Sports)\] -> /, `missing team on: ${line}`);
  }
  assert.match(lines.join("\n"), /\[batting\] "Nasir lefti" \[Baldia Zalmi\] -> /);
  assert.match(lines.join("\n"), /\[batting\] "Rehman" \[Sky Sports\] -> /);
  assert.match(lines.join("\n"), /team safety : .*a mismatch BLOCKS/);
});

test("publishing the draft is the owner's step and reveals SF1 in the public bracket", async () => {
  const { tournament, sf1 } = await seedTournament();
  const applied = await runImportSf1Result({ apply: true, log: noLog });
  assert.equal(applied.outcome, "APPLIED");

  const statsBeforePublish = await gatherTournamentStats(tournament);
  assert.equal(statsBeforePublish.totalRuns, 1160);
  assert.equal(statsBeforePublish.matchCount, 4);

  const beforeFixtures = mockRes();
  await getTournamentFixtures(mockReq({ params: { id: String(tournament._id) } }), beforeFixtures);
  assert.equal(beforeFixtures.statusCode, 200);
  assert.equal(beforeFixtures.body.some((match) => String(match._id) === String(sf1._id)), false);

  const beforeStandings = mockRes();
  await getTournamentStandings(mockReq({ params: { id: String(tournament._id) } }), beforeStandings);
  const beforeSemiFinal = beforeStandings.body.bracket.stages.find((stage) => stage.stage === "semi_final");
  assert.deepEqual(beforeSemiFinal.matches.filter((match) => !match.placeholder).map((match) => match.stageLabel), ["SF2"]);

  const beforeStats = mockRes();
  beforeStats.set = () => beforeStats;
  await getTournamentStats(
    mockReq({ params: { id: String(tournament._id) }, query: { fresh: "1" } }),
    beforeStats,
  );
  assert.equal(beforeStats.statusCode, 200);
  assert.equal(beforeStats.body.totalRuns, 1160);

  // Before publish: hidden (draft) - already asserted above, re-check cheaply.
  const beforeMatches = await Match.find({ tournament: tournament._id }).populate("teams", "name shortName logo").lean();
  const beforeBracket = buildTournamentBracket(beforeMatches, { type: "knockout" });
  const beforeSemi = beforeBracket.stages.find((stage) => stage.stage === "semi_final");
  assert.equal(beforeSemi.matches.filter((card) => !card.placeholder).length, 1);

  const publish = await runPublish({ matchIds: [String(sf1._id)], apply: true, log: noLog });
  assert.equal(publish.counts.PUBLISHED, 1);

  const published = await Match.findById(sf1._id).lean();
  assert.equal(published.manualDraft, false);
  assert.equal(published.status, "completed");

  const afterMatches = await Match.find({ tournament: tournament._id }).populate("teams", "name shortName logo").lean();
  const afterBracket = buildTournamentBracket(afterMatches, { type: "knockout" });
  const afterSemi = afterBracket.stages.find((stage) => stage.stage === "semi_final");
  const sf1Card = afterSemi.matches.find((card) => card.stageLabel === "SF1");
  assert.ok(sf1Card, "SF1 is public after publish");
  assert.equal(sf1Card.winner._id, String(sf1Card.teams.find((team) => team.name === "Sky Sports")._id));
  assert.equal(sf1Card.teams.find((team) => team.name === "Baldia Zalmi").score.text, "274/5");
  assert.equal(sf1Card.teams.find((team) => team.name === "Sky Sports").score.text, "275/4");

  const finalStage = afterBracket.stages.find((stage) => stage.stage === "final");
  assert.equal(finalStage.matches[0].placeholder, true, "the Final fixture stays a placeholder until it is drawn");
  assert.deepEqual(finalStage.matches[0].teams.map((team) => team.name), ["Sky Sports", "Winner SF2"]);

  const statsAfterPublish = await gatherTournamentStats(tournament);
  assert.equal(statsAfterPublish.totalRuns - statsBeforePublish.totalRuns, 549);
  assert.ok(statsAfterPublish.topRunScorers.some((row) => row.name === "Abdul Rehman" && row.runs === 116));
  assert.ok(statsAfterPublish.topRunScorers.some((row) => row.name === "Ejaz Swati" && row.runs === 107));

  const afterFixtures = mockRes();
  await getTournamentFixtures(mockReq({ params: { id: String(tournament._id) } }), afterFixtures);
  const publicSf1 = afterFixtures.body.find((match) => String(match._id) === String(sf1._id));
  assert.ok(publicSf1);
  assert.equal(publicSf1.status, "completed");

  const afterStandings = mockRes();
  await getTournamentStandings(mockReq({ params: { id: String(tournament._id) } }), afterStandings);
  const finalPlaceholder = afterStandings.body.bracket.stages.find((stage) => stage.stage === "final").matches[0];
  assert.deepEqual(finalPlaceholder.teams.map((team) => team.name), ["Sky Sports", "Winner SF2"]);

  const afterStats = mockRes();
  afterStats.set = () => afterStats;
  await getTournamentStats(
    mockReq({ params: { id: String(tournament._id) }, query: { fresh: "1" } }),
    afterStats,
  );
  assert.equal(afterStats.body.totalRuns - beforeStats.body.totalRuns, 549);
  assert.ok(afterStats.body.topRunScorers.some((row) => row.name === "Abdul Rehman" && row.runs === 116));
  assert.ok(afterStats.body.topRunScorers.some((row) => row.name === "Ejaz Swati" && row.runs === 107));
});

// ---------------------------------------------------------------------------
// Blocked paths
// ---------------------------------------------------------------------------

test("a fixture whose teams are not Baldia Zalmi vs Sky Sports is BLOCKED", async () => {
  const { tournament, sf1, byName } = await seedTournament();
  await Match.updateOne(
    { _id: sf1._id },
    { teams: [byName.get("Young Star")._id, byName.get("Khan Associates")._id] },
  );

  const report = await runImportSf1Result({ apply: true, log: noLog });

  assert.equal(report.blocked, true);
  assert.equal(report.outcome, "DRY_RUN");
  assert.match(report.plan.errors.join("\n"), /expected Baldia Zalmi and Sky Sports/);
  const unchanged = await Match.findById(sf1._id).lean();
  assert.equal(unchanged.source, "live");
  assert.equal(unchanged.manualDraft, false);
  assert.equal(await Player.countDocuments({ name: "Attack (TBC)" }), 0);
  assert.equal(await Match.countDocuments({ tournament: tournament._id, stage: "semi_final" }), 2);
});

test("validation errors block the write before any draft or placeholder is saved", async () => {
  const { sf1 } = await seedTournament();
  const { data, mapping } = loadImportFiles();
  data.innings[0].runs = 275; // batting 244 + extras 30 is 274

  const report = await runImportSf1Result({
    apply: true,
    log: noLog,
    data,
    nameMap: mapping,
  });

  assert.equal(report.blocked, true);
  assert.match(report.plan.errors.join("\n"), /batting runs 244 \+ extras 30 = 274, expected 275/);
  const unchanged = await Match.findById(sf1._id).lean();
  assert.equal(unchanged.source, "live");
  assert.equal(unchanged.manualDraft, false);
  assert.equal(await Player.countDocuments({ name: "Attack (TBC)" }), 0);
});

test("a scored fixture is refused instead of being overwritten", async () => {
  const { sf1 } = await seedTournament();
  await Match.updateOne(
    { _id: sf1._id },
    {
      status: "live",
      "innings.0.runs": 12,
      "innings.0.balls": 6,
      "innings.0.batting": [{ player: sf1.teams[0], runs: 12, balls: 6, isOut: false }],
    },
  );

  const lines = [];
  const report = await runImportSf1Result({ apply: true, log: (line) => lines.push(String(line ?? "")) });

  assert.equal(report.blocked, true);
  assert.match(lines.join("\n"), /not an empty upcoming fixture/);
  const unchanged = await Match.findById(sf1._id).lean();
  assert.equal(unchanged.source, "live");
  assert.equal(unchanged.status, "live");
  assert.equal(unchanged.innings[0].runs, 12);
});
