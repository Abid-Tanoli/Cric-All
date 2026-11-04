import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import { startTestDb, stopTestDb } from "./helpers/testDb.js";
import AuditLog from "../src/models/AuditLog.js";
import Ball from "../src/models/Ball.js";
import Blog from "../src/models/Blog.js";
import CommunityPost from "../src/models/CommunityPost.js";
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
  previewMergeReferences,
  validateDatabaseTarget,
} from "../src/scripts/applyPlayerNames.js";
import { checkPlayerMergeIntegrity } from "../src/scripts/checkPlayerMergeIntegrity.js";
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
  // The original answer columns stay first so an older CSV remains valid.
  assert.deepEqual(CSV_HEADERS.slice(0, 15), [
    "player_id",
    "placeholder_name",
    "team_name",
    "source_name",
    "match_count",
    "match_labels",
    "runs_batted",
    "balls_batted",
    "overs_bowled",
    "runs_bowled",
    "wickets_bowled",
    "real_name_or_existing_player_id",
    "duplicate_same_team",
    "duplicate_across_teams",
    "allow_cross_team",
  ]);
  assert.deepEqual(CSV_HEADERS.slice(15), [
    "candidate_real_players",
    "candidates_by_match",
    "similar_names",
    "similar_names_other_teams",
    "match_context",
    "bowler_reconciliation",
    "team_conflict",
    "candidates_without_bowling_row",
    "candidates_without_batting_row",
  ]);
  // The placeholder itself is not a candidate; all 19 unused squad members are.
  assert.equal(report.reviewRows[0].candidate_real_players.split("; ").length, 19);
  assert.match(report.reviewRows[0].candidates_by_match, /^QF1: /);
});

test("report finds the SF1 CREATE placeholders even when Player.team is missing", async () => {
  sequence += 1;
  const team = await Team.create({ name: "Sky Sports" });
  const originalNames = [
    "Abrar (TBC)",
    "Afridi (TBC)",
    "Attaulla (TBC)",
    "MD (TBC)",
    "Unknown Bowler (TBC)",
    "Zahid (TBC)",
    "Rashid (TBC)",
    "Naveed (TBC)",
  ];
  const missingNames = ["Attack (TBC)", "Attack 1 (TBC)", "Ali (TBC)"];
  const originals = await Player.create(
    originalNames.map((name) => ({ name, team: team._id })),
  );
  // Reproduce the live SF1 rows: the public squad still lists them through
  // Team.players and the match scorecard, but Player.team is unset, so the old
  // Player.team-only query never made them report candidates.
  const missing = await Player.create(missingNames.map((name) => ({ name })));
  team.players = [...originals, ...missing].map((player) => player._id);
  await team.save();
  const tournament = await Tournament.create({
    name: TOURNAMENT_NAME,
    slug: `placeholder-coverage-${sequence}`,
    type: "knockout",
    startDate: new Date("2026-10-01T00:00:00.000Z"),
    endDate: new Date("2026-11-01T00:00:00.000Z"),
    teams: [team._id],
    tournamentSquads: [{
      team: team._id,
      players: originals.map((player) => player._id),
    }],
  });
  const match = await Match.create({
    title: "SF1: Sky Sports vs Baldia Zalmi",
    stage: "semi_final",
    stageLabel: "SF1",
    tournament: tournament._id,
    teams: [team._id],
    status: "completed",
    innings: [{
      team: team._id,
      batting: [
        { player: originals[0]._id, runs: 11, balls: 7 },
        { player: missing[0]._id, runs: 4, balls: 3 },
        { player: missing[1]._id, runs: 1, balls: 2 },
        { player: missing[2]._id, runs: 6, balls: 4 },
      ],
      bowling: [],
    }],
  });
  tournament.matches = [match._id];
  await tournament.save();

  const report = await collectPlayerReport();

  assert.equal(report.reviewRows.length, 11);
  assert.deepEqual(
    report.reviewRows.map((row) => row.placeholder_name).sort(),
    [...originalNames, ...missingNames].sort(),
  );
  for (const name of missingNames) {
    const row = report.reviewRows.find((entry) => entry.placeholder_name === name);
    assert.ok(row, `${name} must be reported`);
    assert.equal(row.team_name, "Sky Sports");
    assert.equal(row.match_labels, "SF1");
  }
  const attack = report.reviewRows.find((row) => row.placeholder_name === "Attack (TBC)");
  assert.match(attack.source_name, /SF1: Attack/);
  const ali = report.reviewRows.find((row) => row.placeholder_name === "Ali (TBC)");
  assert.match(ali.source_name, /SF1: Ali/);
});

test("decision-support columns list per-match candidates, similar names and bowling reconciliation", async () => {
  sequence += 1;
  const [sky, orangi] = await Team.create([
    { name: "Sky Sports" },
    { name: "Orangi United" },
  ]);
  const players = await Player.create([
    { name: "Abrar (TBC)", team: sky._id },
    { name: "Akbar Sadozai", team: sky._id },
    { name: "Batter One", team: sky._id },
    { name: "Bowler One", team: sky._id },
    { name: "XI Player", team: sky._id },
    { name: "Twelfth Player", team: sky._id },
    { name: "DNB Player", team: sky._id },
    { name: "Candidate A", team: sky._id },
    { name: "Candidate B", team: sky._id },
    { name: "Abrar", team: orangi._id },
    { name: "Orangi Batter", team: orangi._id },
  ]);
  const [
    placeholder,
    akbar,
    batterOne,
    bowlerOne,
    xiPlayer,
    twelfthPlayer,
    dnbPlayer,
    candidateA,
    candidateB,
    otherAbrar,
    orangiBatter,
  ] = players;
  sky.players = players.slice(0, 9).map((player) => player._id);
  orangi.players = [otherAbrar, orangiBatter].map((player) => player._id);
  await Promise.all([sky.save(), orangi.save()]);
  const tournament = await Tournament.create({
    name: TOURNAMENT_NAME,
    slug: `decision-support-${sequence}`,
    type: "knockout",
    startDate: new Date("2026-10-01T00:00:00.000Z"),
    endDate: new Date("2026-11-01T00:00:00.000Z"),
    teams: [sky._id, orangi._id],
    tournamentSquads: [
      { team: sky._id, players: sky.players },
      { team: orangi._id, players: orangi.players },
    ],
  });

  // QF1: only the placeholder has a Sky row, so nearly the whole squad is a
  // candidate there.
  const qf1 = await Match.create({
    title: "QF1: Sky Sports vs Orangi United",
    stage: "quarter_final",
    stageLabel: "QF1",
    tournament: tournament._id,
    teams: [sky._id, orangi._id],
    status: "completed",
    innings: [{
      team: sky._id,
      batting: [{ player: placeholder._id, runs: 10, balls: 8 }],
      bowling: [],
    }],
  });

  // QF2: the placeholder bowled 0.2 overs / 4 runs / 1 wicket. Every other
  // Sky row (batting, bowling, DNB, XI, twelfth man) must be excluded from the
  // QF2 candidate list.
  const qf2 = await Match.create({
    title: "QF2: Sky Sports vs Orangi United",
    stage: "quarter_final",
    stageLabel: "QF2",
    tournament: tournament._id,
    teams: [sky._id, orangi._id],
    status: "completed",
    playingXI: [{ team: sky._id, players: [xiPlayer._id] }],
    twelfthMan: [{ team: sky._id, player: twelfthPlayer._id }],
    innings: [
      {
        team: sky._id,
        batting: [
          { player: placeholder._id, runs: 5, balls: 4 },
          { player: batterOne._id, runs: 7, balls: 5 },
          // An all-zero, not-out batting row is the DNB list representation.
          { player: dnbPlayer._id },
        ],
        bowling: [],
      },
      {
        team: orangi._id,
        runs: 60,
        wickets: 5,
        balls: 62,
        overs: 10.2,
        extras: { wides: 2, noBalls: 2, byes: 0, legByes: 0, penalties: 0, total: 4 },
        batting: [
          { player: orangiBatter._id, runs: 30, balls: 25, isOut: true, dismissalType: "bowled" },
          { player: otherAbrar._id, runs: 20, balls: 20, isOut: true, dismissalType: "caught" },
        ],
        bowling: [
          { player: placeholder._id, overs: 0.2, balls: 2, runs: 4, wickets: 1 },
          { player: bowlerOne._id, overs: 4, balls: 24, runs: 24, wickets: 2 },
          { player: candidateA._id, overs: 6, balls: 36, runs: 32, wickets: 2 },
        ],
      },
    ],
  });
  tournament.matches = [qf1._id, qf2._id];
  await tournament.save();

  const report = await collectPlayerReport();

  assert.equal(report.reviewRows.length, 1);
  const [row] = report.reviewRows;
  assert.equal(row.placeholder_name, "Abrar (TBC)");
  assert.equal(row.real_name_or_existing_player_id, "");

  // QF1 has no row for Candidate A; QF2 does. The intersection must therefore
  // drop Candidate A while still listing them in the per-match column.
  assert.ok(row.candidate_real_players.includes("Akbar Sadozai"));
  assert.ok(row.candidate_real_players.includes("Candidate B"));
  assert.ok(!row.candidate_real_players.includes("Candidate A"));
  for (const excluded of [
    "Batter One",
    "Bowler One",
    "XI Player",
    "Twelfth Player",
    "DNB Player",
    "Abrar (TBC)",
  ]) {
    assert.ok(
      !row.candidate_real_players.includes(excluded),
      `${excluded} has a row in a match and must not be an intersection candidate`,
    );
  }
  const [qf1Candidates, qf2Candidates] = row.candidates_by_match.split(" | ");
  assert.match(qf1Candidates, /^QF1: /);
  assert.match(qf2Candidates, /^QF2: /);
  assert.ok(qf1Candidates.includes("Candidate A"));
  assert.ok(!qf2Candidates.includes("Candidate A"));
  assert.ok(qf2Candidates.includes("Candidate B"));
  assert.ok(qf2Candidates.includes("Akbar Sadozai"));
  assert.ok(!qf2Candidates.includes("Batter One"));

  assert.ok(row.similar_names.includes("Akbar Sadozai"));
  assert.ok(row.similar_names.includes("edit distance 2"));
  assert.ok(row.similar_names_other_teams.includes("Orangi United: Abrar ["));
  assert.ok(!row.similar_names_other_teams.includes("Abrar (TBC)"));

  assert.match(row.match_context, /QF1: Sky Sports vs Orangi United; innings: Sky Sports \(batting card\)/);
  assert.match(
    row.match_context,
    /QF2: Sky Sports vs Orangi United; innings: Sky Sports \(batting card\); Sky Sports \(bowling card\)/,
  );

  assert.match(row.bowler_reconciliation, /^QF2: /);
  assert.ok(row.bowler_reconciliation.includes(
    "Orangi United batting 60/5 (10.2 ov; extras 4: w2 nb2 b0 lb0 p0)",
  ));
  assert.ok(row.bowler_reconciliation.includes("Sky Sports bowling 10.2 ov / 60 r / 5 w"));
  assert.ok(row.bowler_reconciliation.includes("team reconciled"));
  assert.ok(row.bowler_reconciliation.includes("placeholder 0.2 ov / 4 r / 1 w"));
  assert.ok(row.bowler_reconciliation.includes(
    "without placeholder unreconciled 0.2 ov / +4 r / +1 w",
  ));
});

test("bowlers resolve to their squad even when Player.team is wrong or unset", async () => {
  sequence += 1;
  const [sky, orangi, baldia] = await Team.create([
    { name: "Sky Sports" },
    { name: "Orangi United" },
    { name: "Baldia Zalmi" },
  ]);
  const players = await Player.create([
    // Correctly linked Sky players.
    { name: "Abrar (TBC)", team: sky._id },
    { name: "Akbar Sadozai", team: sky._id },
    { name: "Sky Free Candidate", team: sky._id },
    { name: "Sky Batter", team: sky._id },
    { name: "Sky Bowler", team: sky._id },
    { name: "Sky Completer", team: sky._id },
    // The three live SF1/QF2 placeholders: present in Sky's roster, but their
    // Player.team link is stale or missing.
    { name: "Ali (TBC)", team: orangi._id },
    { name: "Attack (TBC)" },
    { name: "Attack 1 (TBC)", team: baldia._id },
    // Only the scorecard knows this one: no roster, squad or Player.team link.
    { name: "Shadow Bowler (TBC)" },
    { name: "Orangi Batter", team: orangi._id },
    { name: "Orangi Bowler", team: orangi._id },
    { name: "Baldia Batter", team: baldia._id },
    { name: "Baldia Bowler", team: baldia._id },
  ]);
  const [
    abrar,
    akbar,
    skyFree,
    skyBatter,
    skyBowler,
    skyCompleter,
    ali,
    attack,
    attack1,
    shadowBowler,
    orangiBatter,
    orangiBowler,
    baldiaBatter,
    baldiaBowler,
  ] = players;

  sky.players = [abrar, akbar, skyFree, skyBatter, skyBowler, skyCompleter, ali, attack, attack1]
    .map((player) => player._id);
  orangi.players = [orangiBatter, orangiBowler].map((player) => player._id);
  baldia.players = [baldiaBatter, baldiaBowler].map((player) => player._id);
  await Promise.all([sky.save(), orangi.save(), baldia.save()]);

  const tournament = await Tournament.create({
    name: TOURNAMENT_NAME,
    slug: `team-resolution-${sequence}`,
    type: "knockout",
    startDate: new Date("2026-10-01T00:00:00.000Z"),
    endDate: new Date("2026-11-01T00:00:00.000Z"),
    teams: [sky._id, orangi._id, baldia._id],
    // Ali/Attack/Attack 1 are deliberately not in the tournament squad: their
    // Sky membership comes from Team.players (the DB squad fallback).
    tournamentSquads: [
      { team: sky._id, players: [abrar, akbar, skyFree, skyBatter, skyBowler, skyCompleter].map((player) => player._id) },
      { team: orangi._id, players: orangi.players },
      { team: baldia._id, players: baldia.players },
    ],
  });

  const qf2 = await Match.create({
    title: "QF2: Sky Sports vs Orangi United",
    stage: "quarter_final",
    stageLabel: "QF2",
    tournament: tournament._id,
    teams: [sky._id, orangi._id],
    status: "completed",
    innings: [
      {
        team: sky._id,
        runs: 120,
        wickets: 6,
        balls: 120,
        overs: 20,
        extras: { wides: 4, noBalls: 2, byes: 0, legByes: 0, penalties: 0, total: 6 },
        batting: [
          { player: abrar._id, runs: 30, balls: 20, isOut: true, dismissalType: "caught" },
          { player: akbar._id, runs: 20, balls: 20, isOut: true, dismissalType: "bowled" },
          { player: ali._id, runs: 15, balls: 10 },
          { player: skyBatter._id, runs: 5, balls: 5 },
        ],
        bowling: [
          { player: orangiBowler._id, overs: 10, balls: 60, runs: 60, wickets: 3 },
        ],
      },
      {
        team: orangi._id,
        runs: 60,
        wickets: 5,
        balls: 62,
        overs: 10.2,
        extras: { wides: 2, noBalls: 2, byes: 0, legByes: 0, penalties: 0, total: 4 },
        batting: [
          { player: orangiBatter._id, runs: 30, balls: 25, isOut: true, dismissalType: "bowled" },
        ],
        bowling: [
          { player: ali._id, overs: 0.2, balls: 2, runs: 4, wickets: 1 },
          { player: abrar._id, overs: 2, balls: 12, runs: 10, wickets: 1 },
          { player: skyBowler._id, overs: 4, balls: 24, runs: 24, wickets: 2 },
          { player: shadowBowler._id, overs: 1, balls: 6, runs: 5, wickets: 0 },
          { player: skyCompleter._id, overs: 3, balls: 18, runs: 17, wickets: 1 },
        ],
      },
    ],
  });

  const sf1 = await Match.create({
    title: "SF1: Sky Sports vs Baldia Zalmi",
    stage: "semi_final",
    stageLabel: "SF1",
    tournament: tournament._id,
    teams: [sky._id, baldia._id],
    status: "completed",
    innings: [
      {
        team: sky._id,
        runs: 80,
        wickets: 4,
        balls: 60,
        overs: 10,
        extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalties: 0, total: 0 },
        batting: [
          { player: skyBatter._id, runs: 40, balls: 30, isOut: true, dismissalType: "caught" },
        ],
        bowling: [
          { player: baldiaBowler._id, overs: 10, balls: 60, runs: 80, wickets: 4 },
        ],
      },
      {
        team: baldia._id,
        runs: 50,
        wickets: 6,
        balls: 60,
        overs: 10,
        extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalties: 0, total: 0 },
        batting: [
          { player: baldiaBatter._id, runs: 30, balls: 25, isOut: true, dismissalType: "bowled" },
        ],
        bowling: [
          { player: attack._id, overs: 4, balls: 24, runs: 22, wickets: 2 },
          { player: attack1._id, overs: 4, balls: 24, runs: 18, wickets: 3 },
          { player: skyBowler._id, overs: 2, balls: 12, runs: 10, wickets: 1 },
        ],
      },
    ],
  });
  tournament.matches = [qf2._id, sf1._id];
  await tournament.save();

  const report = await collectPlayerReport();
  const byName = new Map(report.reviewRows.map((row) => [row.placeholder_name, row]));

  for (const name of ["Ali (TBC)", "Attack (TBC)", "Attack 1 (TBC)", "Shadow Bowler (TBC)"]) {
    const row = byName.get(name);
    assert.ok(row, `${name} must be reported`);
    assert.equal(row.team_name, "Sky Sports", `${name} must resolve to Sky Sports`);
  }

  const aliRow = byName.get("Ali (TBC)");
  assert.ok(aliRow.candidate_real_players.includes("Sky Free Candidate"));
  assert.ok(!aliRow.candidate_real_players.includes("Orangi Batter"));
  assert.ok(!aliRow.candidate_real_players.includes("Baldia Batter"));
  // The stale Player.team is visible instead of silently ignored.
  assert.ok(aliRow.team_conflict.includes("Player.team=Orangi United"));
  assert.ok(aliRow.team_conflict.includes("Team.players=Sky Sports"));
  assert.ok(aliRow.team_conflict.includes("CREATE map=Sky Sports"));

  const attackRow = byName.get("Attack (TBC)");
  assert.ok(attackRow.candidate_real_players.includes("Akbar Sadozai"));
  assert.ok(attackRow.candidate_real_players.includes("Sky Free Candidate"));
  assert.ok(!attackRow.candidate_real_players.includes("Baldia Batter"));
  assert.equal(attackRow.team_conflict, "");

  const attack1Row = byName.get("Attack 1 (TBC)");
  assert.ok(attack1Row.candidate_real_players.includes("Sky Free Candidate"));
  assert.ok(!attack1Row.candidate_real_players.includes("Baldia Batter"));
  assert.ok(attack1Row.team_conflict.includes("Player.team=Baldia Zalmi"));

  // The scorecard-only placeholder is a bowler in Baldia's innings, so the
  // fielding side is Sky Sports, not Baldia Zalmi.
  const shadowRow = byName.get("Shadow Bowler (TBC)");
  assert.equal(shadowRow.team_conflict, "");
  assert.match(shadowRow.match_context, /Sky Sports \(bowling card\)/);

  // Abrar batted and bowled in QF2. Akbar batted but did not bowl, so the
  // strict candidates exclude him while the looser bowling column lists him.
  const abrarRow = byName.get("Abrar (TBC)");
  assert.ok(!abrarRow.candidate_real_players.includes("Akbar Sadozai"));
  assert.ok(abrarRow.candidates_without_bowling_row.includes("Akbar Sadozai"));
  assert.ok(abrarRow.candidates_without_bowling_row.includes("Sky Free Candidate"));
  assert.ok(!abrarRow.candidates_without_bowling_row.includes("Sky Bowler"));
  assert.ok(abrarRow.candidates_without_batting_row.includes("Sky Bowler"));

  // Reconciliation labels the bowling side from the scorecard, not the stale
  // Player.team on Ali.
  assert.match(aliRow.bowler_reconciliation, /^QF2: /);
  assert.ok(aliRow.bowler_reconciliation.includes(
    "Orangi United batting 60/5 (10.2 ov; extras 4: w2 nb2 b0 lb0 p0)",
  ));
  assert.ok(aliRow.bowler_reconciliation.includes("Sky Sports bowling 10.2 ov / 60 r / 5 w"));
  assert.ok(!aliRow.bowler_reconciliation.includes("Orangi United bowling"));
  assert.ok(aliRow.bowler_reconciliation.includes(
    "without placeholder unreconciled 0.2 ov / +4 r / +1 w",
  ));
  assert.match(attackRow.bowler_reconciliation, /^SF1: Baldia Zalmi batting 50\/6 /);
  assert.ok(attackRow.bowler_reconciliation.includes("Sky Sports bowling 10.0 ov / 50 r / 6 w"));
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
  const [target, source, relationOwner, otherRelation] = await Player.create([
    { name: "Existing Squad Player", team: team._id, stats: { runs: 10, matches: 1 } },
    { name: "Guessed (TBC)", team: team._id, stats: { runs: 5, matches: 1 } },
    { name: "Relation Owner", team: team._id, relations: [] },
    { name: "Other Relation", team: team._id },
  ]);
  relationOwner.relations = [
    { player: source._id, relationType: "Brother" },
    { player: otherRelation._id, relationType: "Friend" },
  ];
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
    result: { playerOfMatch: source._id },
    batsmanOnStrike: source._id,
    batsmanNonStrike: source._id,
    bowler: source._id,
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
  assert.equal(String(updatedMatch.result.playerOfMatch), String(target._id));
  assert.equal(String(updatedMatch.batsmanOnStrike), String(target._id));
  assert.equal(String(updatedMatch.batsmanNonStrike), String(target._id));
  assert.equal(String(updatedMatch.bowler), String(target._id));
  assert.equal(String(updatedMatch.innings[0].batting[0].player), String(target._id));
  assert.equal(String(updatedMatch.innings[0].bowling[0].player), String(target._id));
  assert.equal(String(updatedMatch.innings[0].fallOfWickets[0].fielder), String(target._id));
  assert.equal(String(updatedEvent.eventSquads[0].captain), String(target._id));
  assert.deepEqual(updatedTournament.tournamentSquads[0].players.map(String), [String(target._id)]);
  assert.equal(String(updatedTeam.captain), String(target._id));
  assert.equal(String(updatedRelationOwner.relations[0].player), String(target._id));
  assert.equal(String(updatedRelationOwner.relations[1].player), String(otherRelation._id));
  assert.equal(String((await Delivery.findById(delivery._id)).fielderId), String(target._id));
  assert.equal(String((await Ball.findById(ball._id)).batsman), String(target._id));
  assert.equal(String((await Partnership.findById(partnership._id)).batsman1Id), String(target._id));
  assert.equal(String((await Review.findById(review._id)).playerReviewed), String(target._id));
  assert.equal(updatedRanking.teamRuns, 5);
  assert.equal((await Player.findById(target._id)).stats.runs, 15);
  assert.ok(statsBefore.topRunScorers.some((row) => row.playerId === String(source._id) && row.runs === 5));
  assert.ok(statsAfter.topRunScorers.some((row) => row.playerId === String(target._id) && row.runs === 15));

  const auditLogs = await AuditLog.find({ action: "player.name_cleanup" });
  assert.equal(auditLogs[0].metadata.status, "completed");
  assert.ok(auditLogs[0].metadata.counts.deliveries >= 1);
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

test("merge changes only the matching player field in every direct-reference collection", async () => {
  const { team } = await seedBase();
  const [target, source, otherBatter, otherBowler, otherFielder] = await Player.create([
    { name: "Existing Player", team: team._id },
    { name: "Placeholder (TBC)", team: team._id },
    { name: "Other Batter", team: team._id },
    { name: "Other Bowler", team: team._id },
    { name: "Other Fielder", team: team._id },
  ]);
  const match = await Match.create({ title: "Reference isolation", teams: [team._id] });
  const playerIds = {
    batsmanId: otherBatter._id,
    bowlerId: otherBowler._id,
    nonStrikerId: target._id,
    fielderId: otherFielder._id,
  };
  const deliveryFields = Object.keys(playerIds);
  const deliveries = [];
  for (const field of deliveryFields) {
    deliveries.push(await Delivery.create({
      matchId: match._id,
      inning: 1,
      overNumber: 1,
      ballNumber: deliveries.length + 1,
      ...playerIds,
      [field]: source._id,
    }));
  }

  const ballFields = {
    batsman: otherBatter._id,
    bowler: otherBowler._id,
    fieldedBy: otherFielder._id,
  };
  const balls = [];
  for (const field of Object.keys(ballFields)) {
    balls.push(await Ball.create({
      matchId: match._id,
      over: 1,
      ball: balls.length + 1,
      ...ballFields,
      [field]: source._id,
    }));
  }

  const partnerships = [];
  for (const field of ["batsman1Id", "batsman2Id"]) {
    partnerships.push(await Partnership.create({
      matchId: match._id,
      inning: 1,
      wicketNumber: partnerships.length + 1,
      batsman1Id: otherBatter._id,
      batsman2Id: otherFielder._id,
      [field]: source._id,
    }));
  }
  const review = await Review.create({
    matchId: match._id,
    inning: 1,
    overBall: "1.1",
    requestedBy: "batting_team",
    decisionChallenged: "out",
    playerReviewed: source._id,
  });
  const blog = await Blog.create({
    title: "Player article",
    content: "Article",
    relatedType: "Player",
    relatedId: source._id,
  });
  const post = await CommunityPost.create({
    authorUser: new mongoose.Types.ObjectId(),
    subject: { type: "player", ref: source._id },
    kind: "photo",
    title: "Player post",
  });

  const { plan, errors } = await planNameChanges({
    rows: [answerRow(source, team, "Existing Player")],
    players: await Player.find({}),
    teams: await Team.find({}),
    matches: await Match.find({}),
  });
  assert.deepEqual(errors, []);
  await applyPlan(plan);

  for (const [index, field] of deliveryFields.entries()) {
    const updated = await Delivery.findById(deliveries[index]._id).lean();
    assert.equal(String(updated[field]), String(target._id));
    for (const untouchedField of deliveryFields.filter((entry) => entry !== field)) {
      assert.equal(String(updated[untouchedField]), String(playerIds[untouchedField]));
    }
  }
  for (const [index, field] of Object.keys(ballFields).entries()) {
    const updated = await Ball.findById(balls[index]._id).lean();
    assert.equal(String(updated[field]), String(target._id));
    for (const untouchedField of Object.keys(ballFields).filter((entry) => entry !== field)) {
      assert.equal(String(updated[untouchedField]), String(ballFields[untouchedField]));
    }
  }
  for (const [index, field] of ["batsman1Id", "batsman2Id"].entries()) {
    const updated = await Partnership.findById(partnerships[index]._id).lean();
    assert.equal(String(updated[field]), String(target._id));
    assert.equal(
      String(updated[field === "batsman1Id" ? "batsman2Id" : "batsman1Id"]),
      String(field === "batsman1Id" ? otherFielder._id : otherBatter._id),
    );
  }
  assert.equal(String((await Review.findById(review._id)).playerReviewed), String(target._id));
  assert.equal(String((await Blog.findById(blog._id)).relatedId), String(target._id));
  assert.equal(String((await CommunityPost.findById(post._id)).subject.ref), String(target._id));

  const preview = await previewMergeReferences([String(target._id)]);
  assert.ok(preview.some((entry) => entry.collection === Blog.collection.collectionName && entry.field === "relatedId"));
  assert.ok(preview.some((entry) => entry.collection === CommunityPost.collection.collectionName && entry.field === "subject.ref"));
});

test("integrity checker is read-only and groups all player references with suspicious ball rows", async () => {
  const { team } = await seedBase();
  const [target, source, otherPlayer] = await Player.create([
    { name: "Target Player", team: team._id },
    { name: "Placeholder (TBC)", team: team._id },
    { name: "Other Player", team: team._id },
  ]);
  const match = await Match.create({
    title: "Integrity check match",
    teams: [team._id],
    source: "live",
    innings: [{ batting: [{ player: source._id }], bowling: [] }],
  });
  const delivery = await Delivery.create({
    matchId: match._id,
    inning: 1,
    overNumber: 1,
    ballNumber: 1,
    batsmanId: source._id,
    bowlerId: source._id,
    nonStrikerId: otherPlayer._id,
  });
  const suspiciousDelivery = await Delivery.create({
    matchId: match._id,
    inning: 1,
    overNumber: 1,
    ballNumber: 2,
    batsmanId: source._id,
    bowlerId: otherPlayer._id,
    nonStrikerId: otherPlayer._id,
  });
  const ball = await Ball.create({
    matchId: match._id,
    over: 1,
    ball: 1,
    batsman: source._id,
    bowler: otherPlayer._id,
  });
  const partnership = await Partnership.create({
    matchId: match._id,
    inning: 1,
    wicketNumber: 1,
    batsman1Id: source._id,
    batsman2Id: otherPlayer._id,
  });
  const review = await Review.create({
    matchId: match._id,
    inning: 1,
    overBall: "1.1",
    requestedBy: "batting_team",
    decisionChallenged: "out",
    playerReviewed: source._id,
  });
  const legacyReference = await mongoose.connection.db.collection("legacyPlayerRefs").insertOne({
    matchId: match._id,
    player: source._id,
  });
  const countsBefore = {
    players: await Player.countDocuments(),
    matches: await Match.countDocuments(),
    deliveries: await Delivery.countDocuments(),
    balls: await Ball.countDocuments(),
    partnerships: await Partnership.countDocuments(),
    reviews: await Review.countDocuments(),
  };

  const report = await checkPlayerMergeIntegrity({ playerId: String(source._id) });

  assert.deepEqual({
    players: await Player.countDocuments(),
    matches: await Match.countDocuments(),
    deliveries: await Delivery.countDocuments(),
    balls: await Ball.countDocuments(),
    partnerships: await Partnership.countDocuments(),
    reviews: await Review.countDocuments(),
  }, countsBefore);
  assert.equal(report.matches.length, 1);
  assert.equal(report.matches[0].matchId, String(match._id));
  assert.equal(report.matches[0].nonManual, true);
  assert.ok(report.matches[0].references.some((entry) =>
    entry.collection === Delivery.collection.collectionName &&
    entry.documentId === String(delivery._id) &&
    entry.field === "batsmanId"));
  for (const [collection, document] of [
    [Delivery.collection.collectionName, suspiciousDelivery],
    [Ball.collection.collectionName, ball],
    [Partnership.collection.collectionName, partnership],
    [Review.collection.collectionName, review],
  ]) {
    assert.ok(report.matches[0].references.some((entry) =>
      entry.collection === collection && entry.documentId === String(document._id)));
  }
  assert.ok(report.matches[0].suspicious.some((entry) => entry.code === "SAME_BATSMAN_AND_BOWLER"));
  assert.ok(report.matches[0].suspicious.some((entry) => entry.code === "BOWLER_IS_NON_STRIKER"));
  assert.ok(report.matches[0].references.some((entry) =>
    entry.collection === Match.collection.collectionName &&
    entry.field === "innings[0].batting[0].player"));
  assert.ok(report.matches[0].references.some((entry) =>
    entry.collection === "legacyPlayerRefs" &&
    entry.documentId === String(legacyReference.insertedId) &&
    entry.field === "player"));
  assert.ok(report.otherReferences.some((entry) =>
    entry.collection === "legacyPlayerRefs" &&
    entry.fields.includes("player")));
  assert.notEqual(String(target._id), String(source._id));
});

test("a failed merge records partial counts, aborts later rows and blocks a silent retry", async () => {
  const { team } = await seedBase();
  const [target, source, laterRename] = await Player.create([
    { name: "Existing Player", team: team._id },
    { name: "Placeholder (TBC)", team: team._id },
    { name: "Another Placeholder (TBC)", team: team._id },
  ]);
  const match = await Match.create({ title: "Partial merge", teams: [team._id] });
  const delivery = await Delivery.create({
    matchId: match._id,
    inning: 1,
    overNumber: 1,
    ballNumber: 1,
    batsmanId: source._id,
    bowlerId: target._id,
    nonStrikerId: target._id,
  });
  const { plan, errors } = await planNameChanges({
    rows: [
      answerRow(source, team, "Existing Player"),
      answerRow(laterRename, team, "Renamed Later"),
    ],
    players: await Player.find({}),
    teams: await Team.find({}),
    matches: await Match.find({}),
  });
  assert.deepEqual(errors, []);

  const originalUpdateMany = Delivery.updateMany;
  Delivery.updateMany = async function (filter, ...rest) {
    if (filter.fielderId) throw new Error("simulated failure");
    return originalUpdateMany.call(this, filter, ...rest);
  };
  try {
    await assert.rejects(
      applyPlan(plan),
      /Merge aborted.*No later rows were processed.*Partial collection counts: \{"deliveries":1\}.*Failed to rewrite deliveries\.fielderId/,
    );
  } finally {
    Delivery.updateMany = originalUpdateMany;
  }

  assert.equal(String((await Delivery.findById(delivery._id)).batsmanId), String(target._id));
  assert.ok(await Player.findById(source._id));
  assert.equal((await Player.findById(laterRename._id)).name, "Another Placeholder (TBC)");
  const audit = await AuditLog.findOne({ action: "player.name_cleanup" }).lean();
  assert.equal(audit.metadata.status, "partial");
  assert.deepEqual(audit.metadata.counts, { deliveries: 1 });
  const retry = await planNameChanges({
    rows: [answerRow(source, team, "Existing Player")],
    players: await Player.find({}),
    teams: await Team.find({}),
    matches: await Match.find({}),
    auditLogs: [audit],
  });
  assert.match(retry.errors[0], /prior partial merge.*reconciled/i);
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
    // Two CREATE placeholders plus the completed match's existing player, who
    // is not in the DB tournament squad (criterion (c) of the report).
    assert.equal(originalRows.length, 3);
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
