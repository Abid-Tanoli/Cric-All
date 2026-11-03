import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import { startTestDb, stopTestDb } from "./helpers/testDb.js";
import AuditLog from "../src/models/AuditLog.js";
import Ball from "../src/models/Ball.js";
import Delivery from "../src/models/Delivery.js";
import Event from "../src/models/Event.js";
import Match from "../src/models/Match.js";
import Partnership from "../src/models/Partnership.js";
import Player from "../src/models/Player.js";
import Review from "../src/models/Review.js";
import Team from "../src/models/Team.js";
import TeamPlayerRanking from "../src/models/TeamPlayerRanking.js";
import Tournament from "../src/models/Tournament.js";
import { computeTournamentStats } from "../src/services/tournamentStats.js";
import {
  applyPlan,
  main as applyPlayerNamesMain,
  planNameChanges,
  validateDatabaseTarget,
} from "../src/scripts/applyPlayerNames.js";
import {
  collectPlayerReport,
  main as listPlaceholderPlayersMain,
} from "../src/scripts/listPlaceholderPlayers.js";
import {
  CSV_HEADERS,
  loadNameMapEntries,
  matchLabel,
  parseCsv,
  toCsv,
} from "../src/scripts/playerNameCleanup.js";

let mongod;
let sequence = 0;
const TOURNAMENT_NAME = "All Baldia T20 Hard Ball Cricket Tournament";

before(async () => {
  mongod = await startTestDb();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
});

after(async () => {
  await stopTestDb(mongod);
});

async function seedBase() {
  sequence += 1;
  const [team, otherTeam] = await Team.create([
    { name: `Cleanup Team ${sequence}` },
    { name: `Other Cleanup Team ${sequence}` },
  ]);
  return { team, otherTeam };
}

function answerRow(source, team, answer, extra = {}) {
  return {
    player_id: String(source._id),
    placeholder_name: source.name,
    team_name: team.name,
    real_name_or_existing_player_id: answer,
    ...extra,
  };
}

const statsShape = (matches) => JSON.parse(JSON.stringify(matches));

async function seedTournament(team, players) {
  const tournament = await Tournament.create({
    name: TOURNAMENT_NAME,
    slug: `player-cleanup-${sequence}`,
    type: "knockout",
    startDate: new Date("2026-01-01T00:00:00.000Z"),
    endDate: new Date("2026-12-31T00:00:00.000Z"),
    teams: [team._id],
    tournamentSquads: [{ team: team._id, players: players.map((player) => player._id) }],
  });
  return tournament;
}

test("review report is read-only and writes all identified placeholders to an answer-ready CSV shape", async () => {
  assert.equal(matchLabel({ title: "QF3: Sky Sports vs Young Star" }), "QF3");
  const { team } = await seedBase();
  const squad = await Player.create(
    Array.from({ length: 19 }, (_, index) => ({ name: `Registered ${sequence}-${index}`, team: team._id })),
  );
  const placeholder = await Player.create({ name: "Abrar (TBC)", team: team._id });
  team.players = [...squad, placeholder].map((player) => player._id);
  await team.save();
  const tournament = await seedTournament(team, squad);
  await Match.create({
    title: "QF1: test",
    stageLabel: "QF1",
    tournament: tournament._id,
    teams: [team._id],
    status: "completed",
    innings: [{
      batting: [{ player: placeholder._id, runs: 18, balls: 12 }],
      bowling: [{ player: placeholder._id, overs: 2.3, balls: 15, runs: 11, wickets: 2 }],
    }],
  });
  const before = {
    players: await Player.countDocuments(),
    teams: await Team.countDocuments(),
    matches: await Match.countDocuments(),
  };
  const report = await collectPlayerReport();
  const afterCounts = {
    players: await Player.countDocuments(),
    teams: await Team.countDocuments(),
    matches: await Match.countDocuments(),
  };

  assert.deepEqual(afterCounts, before);
  assert.equal(report.reviewRows.length, 1);
  assert.equal(report.reviewRows[0].player_id, String(placeholder._id));
  assert.equal(report.reviewRows[0].match_count, 1);
  assert.equal(report.reviewRows[0].match_labels, "QF1");
  assert.equal(report.reviewRows[0].runs_batted, 18);
  assert.equal(report.reviewRows[0].balls_batted, 12);
  assert.equal(report.reviewRows[0].overs_bowled, "2.3");
  assert.equal(report.reviewRows[0].runs_bowled, 11);
  assert.equal(report.reviewRows[0].wickets_bowled, 2);
  assert.equal(report.reviewRows[0].real_name_or_existing_player_id, "");
  assert.equal(report.tournament.tournamentSquads[0].players.length, 19);
  assert.ok(loadNameMapEntries().some((entry) => entry.matchLabel === "QF" && entry.sourceName === "S Haroo"));
});

test("rename keeps the same id and all existing player stats", async () => {
  const { team } = await seedBase();
  const [source] = await Player.create([{
    name: "Review Pending (TBC)",
    team: team._id,
    stats: { runs: 43, wickets: 2, matches: 3, highScore: 31, average: 14.33 },
  }]);
  const originalId = String(source._id);
  const originalStats = JSON.parse(JSON.stringify(source.stats));
  const plan = [{
    sourceId: originalId,
    targetId: originalId,
    action: "rename",
    before: source.name,
    after: "Reviewed Real Name",
    answer: "Reviewed Real Name",
  }];

  await applyPlan(plan);
  const renamed = await Player.findById(originalId);
  assert.equal(String(renamed._id), originalId);
  assert.equal(renamed.name, "Reviewed Real Name");
  assert.deepEqual(JSON.parse(JSON.stringify(renamed.stats)), originalStats);
});

test("merge repoints match and model references and public stats stay summed under the target", async () => {
  const { team } = await seedBase();
  const [target, source, relationOwner] = await Player.create([
    { name: "Existing Squad Player", team: team._id, stats: { runs: 10, matches: 1 } },
    { name: "Guessed (TBC)", team: team._id, stats: { runs: 5, matches: 1 } },
    { name: "Relation Owner", team: team._id, relations: [] },
  ]);
  relationOwner.relations = [{ player: source._id, relationType: "Brother" }];
  await relationOwner.save();
  team.players = [target._id, source._id];
  team.captain = source._id;
  await team.save();
  const tournament = await seedTournament(team, [target, source]);
  const event = await Event.create({
    eventType: "tournament",
    name: TOURNAMENT_NAME,
    teams: [team._id],
    eventSquads: [{ team: team._id, players: [target._id, source._id], captain: source._id }],
  });
  const targetMatch = await Match.create({
    title: "Existing player match",
    tournament: tournament._id,
    event: event._id,
    teams: [team._id],
    status: "completed",
    innings: [{ batting: [{ player: target._id, runs: 10, balls: 8 }], bowling: [] }],
  });
  const sourceMatch = await Match.create({
    title: "Placeholder match",
    stageLabel: "SF1",
    tournament: tournament._id,
    event: event._id,
    teams: [team._id],
    status: "completed",
    manOfMatch: source._id,
    playingXI: [{ team: team._id, players: [source._id] }],
    innings: [{
      batting: [{ player: source._id, runs: 5, balls: 4, dismissedBy: source._id, fielder: source._id }],
      bowling: [{ player: source._id, overs: 1, balls: 6, runs: 4, wickets: 1 }],
      fallOfWickets: [{ player: source._id, fielder: source._id }],
    }],
  });
  const delivery = await Delivery.create({
    matchId: sourceMatch._id,
    inning: 1,
    overNumber: 1,
    ballNumber: 1,
    batsmanId: source._id,
    bowlerId: source._id,
    nonStrikerId: source._id,
    fielderId: source._id,
  });
  const ball = await Ball.create({
    matchId: sourceMatch._id,
    over: 1,
    ball: 1,
    batsman: source._id,
    bowler: source._id,
    fieldedBy: source._id,
  });
  const partnership = await Partnership.create({
    matchId: sourceMatch._id,
    inning: 1,
    wicketNumber: 1,
    batsman1Id: source._id,
    batsman2Id: target._id,
    runs: 5,
  });
  const review = await Review.create({
    matchId: sourceMatch._id,
    inning: 1,
    overBall: "1.1",
    requestedBy: "batting_team",
    decisionChallenged: "out",
    playerReviewed: source._id,
  });
  const ranking = await TeamPlayerRanking.create({
    team: team._id,
    player: source._id,
    teamRuns: 5,
    teamMatches: 1,
  });
  const statsBefore = computeTournamentStats({
    matches: statsShape([targetMatch, sourceMatch]),
    minBallsFaced: 0,
    minOvers: 0,
  });
  const { plan, errors } = await planNameChanges({
    rows: [answerRow(source, team, "Existing Squad Player")],
    players: await Player.find({}),
    teams: await Team.find({}),
    matches: await Match.find({}),
  });
  assert.deepEqual(errors, []);

  const result = await applyPlan(plan);
  assert.match(result[0].result, /merged/);
  const updatedMatch = await Match.findById(sourceMatch._id);
  const updatedEvent = await Event.findById(event._id);
  const updatedTournament = await Tournament.findById(tournament._id);
  const updatedTeam = await Team.findById(team._id);
  const updatedRelationOwner = await Player.findById(relationOwner._id);
  const updatedRanking = await TeamPlayerRanking.findOne({ team: team._id, player: target._id });
  const statsAfter = computeTournamentStats({
    matches: statsShape(await Match.find({ tournament: tournament._id }).lean()),
    minBallsFaced: 0,
    minOvers: 0,
  });

  assert.equal(await Player.findById(source._id), null);
  assert.equal(String(updatedMatch.manOfMatch), String(target._id));
  assert.equal(String(updatedMatch.innings[0].batting[0].player), String(target._id));
  assert.equal(String(updatedMatch.innings[0].bowling[0].player), String(target._id));
  assert.equal(String(updatedMatch.innings[0].fallOfWickets[0].fielder), String(target._id));
  assert.equal(String(updatedEvent.eventSquads[0].captain), String(target._id));
  assert.deepEqual(updatedTournament.tournamentSquads[0].players.map(String), [String(target._id)]);
  assert.equal(String(updatedTeam.captain), String(target._id));
  assert.equal(String(updatedRelationOwner.relations[0].player), String(target._id));
  assert.equal(String((await Delivery.findById(delivery._id)).fielderId), String(target._id));
  assert.equal(String((await Ball.findById(ball._id)).batsman), String(target._id));
  assert.equal(String((await Partnership.findById(partnership._id)).batsman1Id), String(target._id));
  assert.equal(String((await Review.findById(review._id)).playerReviewed), String(target._id));
  assert.equal(updatedRanking.teamRuns, 5);
  assert.equal((await Player.findById(target._id)).stats.runs, 15);
  assert.ok(statsBefore.topRunScorers.some((row) => row.playerId === String(source._id) && row.runs === 5));
  assert.ok(statsAfter.topRunScorers.some((row) => row.playerId === String(target._id) && row.runs === 15));

  const auditLogs = await AuditLog.find({ action: "player.name_cleanup" });
  const repeated = await planNameChanges({
    rows: [answerRow(source, team, "Existing Squad Player")],
    players: await Player.find({}),
    teams: await Team.find({}),
    matches: await Match.find({}),
    auditLogs,
  });
  assert.deepEqual(repeated.errors, []);
  assert.equal(repeated.plan[0].action, "already-applied");
});

test("cross-team merges require both explicit row and command-line authorization", async () => {
  const { team, otherTeam } = await seedBase();
  const [source, target] = await Player.create([
    { name: "Placeholder (TBC)", team: team._id },
    { name: "Actual Player", team: otherTeam._id },
  ]);
  const row = answerRow(source, team, "Actual Player", { allow_cross_team: "--allow-cross-team" });
  const args = {
    rows: [row],
    players: [source, target],
    teams: [team, otherTeam],
    matches: [],
  };
  const blocked = await planNameChanges(args);
  assert.ok(blocked.errors.some((error) => error.includes("allow_cross_team")));
  const allowed = await planNameChanges({ ...args, allowCrossTeam: true });
  assert.deepEqual(allowed.errors, []);
  assert.equal(allowed.plan[0].crossTeam, true);
});

test("merge is blocked before writes when it would create duplicate batting rows in one innings", async () => {
  const { team } = await seedBase();
  const [source, target] = await Player.create([
    { name: "Placeholder (TBC)", team: team._id },
    { name: "Existing", team: team._id },
  ]);
  const match = {
    _id: "match-1",
    title: "SF1",
    innings: [{
      batting: [{ player: source._id, runs: 2 }, { player: target._id, runs: 8 }],
      bowling: [],
    }],
  };
  const before = await Player.countDocuments();
  const result = await planNameChanges({
    rows: [answerRow(source, team, "Existing")],
    players: [source, target],
    teams: [team],
    matches: [match],
  });

  assert.ok(result.errors.some((error) => error.includes("duplicate batting rows")));
  assert.equal(await Player.countDocuments(), before);
  assert.equal((await Player.findById(source._id)).name, "Placeholder (TBC)");
});

test("test-database flag rejects remote and non-e2e targets", () => {
  assert.throws(
    () => validateDatabaseTarget("mongodb://localhost:27017/cric-all-e2e"),
    /without --force-test/,
  );
  assert.throws(
    () => validateDatabaseTarget("mongodb://example.invalid:27017/cric-all-e2e", { forceTest: true }),
    /local loopback cric-all-e2e/,
  );
  assert.doesNotThrow(() =>
    validateDatabaseTarget("mongodb://127.0.0.1:27017/cric-all-e2e", { forceTest: true }),
  );
});

test("both CLI workflows run end-to-end on local cric-all-e2e with rename, merge, and public stats checks", async () => {
  await mongoose.disconnect();
  const uri = new URL(mongod.getUri());
  uri.pathname = "/cric-all-e2e";
  const mongoUrl = uri.toString();
  const oldMongoUrl = process.env.MONGO_URL;
  const csvPath = path.join(os.tmpdir(), `cleanup-e2e-${Date.now()}.csv`);
  const filledCsvPath = path.join(os.tmpdir(), `cleanup-e2e-filled-${Date.now()}.csv`);
  process.env.MONGO_URL = mongoUrl;

  try {
    await mongoose.connect(mongoUrl);
    const [sky, youngStar] = await Team.create([
      { name: "Sky Sports" },
      { name: "Young Star" },
    ]);
    const registered = await Player.create(
      Array.from({ length: 19 }, (_, index) => ({
        name: `Sky Squad ${index + 1}`,
        team: sky._id,
      })).concat(
        Array.from({ length: 15 }, (_, index) => ({
          name: `Young Squad ${index + 1}`,
          team: youngStar._id,
        })),
      ),
    );
    const sourceRename = await Player.create({ name: "Abrar (TBC)", team: sky._id });
    const sourceMerge = await Player.create({ name: "Ali (TBC)", team: sky._id });
    const existing = await Player.create({ name: "Existing Squad Player", team: sky._id });
    sky.players = [...registered.slice(0, 19), sourceRename, sourceMerge, existing].map((player) => player._id);
    youngStar.players = registered.slice(19).map((player) => player._id);
    await Promise.all([sky.save(), youngStar.save()]);
    const tournament = await Tournament.create({
      name: TOURNAMENT_NAME,
      slug: "cleanup-cli-e2e",
      type: "knockout",
      startDate: new Date("2026-10-01T00:00:00.000Z"),
      endDate: new Date("2026-11-01T00:00:00.000Z"),
      teams: [sky._id, youngStar._id],
      tournamentSquads: [
        { team: sky._id, players: registered.slice(0, 19).map((player) => player._id) },
        { team: youngStar._id, players: registered.slice(19).map((player) => player._id) },
      ],
    });
    const [qf1, qf2] = await Match.create([
      {
        title: "QF1: Sky Sports vs Young Star",
        stage: "quarter_final",
        stageLabel: "QF1",
        tournament: tournament._id,
        teams: [sky._id, youngStar._id],
        status: "completed",
        innings: [{ batting: [
          { player: sourceRename._id, runs: 11, balls: 7 },
          { player: existing._id, runs: 5, balls: 4 },
        ], bowling: [] }],
      },
      {
        title: "QF2: Sky Sports vs Young Star",
        stage: "quarter_final",
        stageLabel: "QF2",
        tournament: tournament._id,
        teams: [sky._id, youngStar._id],
        status: "completed",
        innings: [{ batting: [{ player: sourceMerge._id, runs: 3, balls: 2 }], bowling: [] }],
      },
    ]);
    tournament.matches = [qf1._id, qf2._id];
    await tournament.save();
    await mongoose.disconnect();

    console.log("\nDisposable database CLI run: cric-all-e2e");
    await listPlaceholderPlayersMain(["--output", csvPath]);
    const originalRows = parseCsv(fs.readFileSync(csvPath, "utf8"));
    assert.equal(originalRows.length, 2);
    const filledRows = originalRows.map((row) => ({
      ...row,
      real_name_or_existing_player_id: row.placeholder_name === "Abrar (TBC)"
        ? "Abrar Khan"
        : "Existing Squad Player",
    }));
    fs.writeFileSync(filledCsvPath, toCsv(CSV_HEADERS, filledRows), "utf8");

    await applyPlayerNamesMain(["--file", filledCsvPath, "--force-test"]);
    await mongoose.connect(mongoUrl);
    assert.equal((await Player.findById(sourceRename._id)).name, "Abrar (TBC)");
    assert.equal((await Player.findById(sourceMerge._id)).name, "Ali (TBC)");
    assert.equal(await AuditLog.countDocuments({ action: "player.name_cleanup" }), 0);
    const beforeStats = computeTournamentStats({
      matches: statsShape(await Match.find({ tournament: tournament._id }).lean()),
      minBallsFaced: 0,
      minOvers: 0,
    });
    await mongoose.disconnect();

    await applyPlayerNamesMain(["--file", filledCsvPath, "--force-test", "--apply"]);
    await mongoose.connect(mongoUrl);
    const afterStats = computeTournamentStats({
      matches: statsShape(await Match.find({ tournament: tournament._id }).lean()),
      minBallsFaced: 0,
      minOvers: 0,
    });
    assert.equal((await Player.findById(sourceRename._id)).name, "Abrar Khan");
    assert.equal(await Player.findById(sourceMerge._id), null);
    assert.ok(beforeStats.topRunScorers.some((row) =>
      row.playerId === String(sourceMerge._id) && row.runs === 3,
    ));
    assert.ok(afterStats.topRunScorers.some((row) =>
      row.playerId === String(existing._id) && row.runs === 8,
    ));
    assert.ok(afterStats.topRunScorers.some((row) =>
      row.playerId === String(sourceRename._id) && row.runs === 11,
    ));
    assert.equal((await Player.findById(sourceRename._id)).name, "Abrar Khan");
    console.log("Public tournament stats: merge target rose from 5+3 runs across two players to 8 under the existing player; renamed player retained 11 runs.");
  } finally {
    await mongoose.disconnect();
    if (oldMongoUrl === undefined) delete process.env.MONGO_URL;
    else process.env.MONGO_URL = oldMongoUrl;
    fs.rmSync(csvPath, { force: true });
    fs.rmSync(filledCsvPath, { force: true });
    await mongoose.connect(mongod.getUri(), { dbName: "cricall_test" });
  }
});
