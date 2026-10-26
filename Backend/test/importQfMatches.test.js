// Tests for src/scripts/importQfMatches.js — the paper-scorecard reader and
// innings validator. The fixture is a tiny synthetic workbook built in memory
// (two innings, one batter out per innings). The real 100Percent workbook is
// never read here.
//
// What is pinned:
//   * both innings of a sheet are parsed, with the batting/bowling totals that
//     the operator typed into the scorebook;
//   * a consistent innings passes validation and derives byes/leg-byes from
//     innings total - bowler runs;
//   * a batting/extras mismatch and a bowler-runs overshoot are reported as
//     errors, because --apply must refuse them.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import * as xlsx from "xlsx";

import { startTestDb, stopTestDb } from "./helpers/testDb.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import { validateManualScorecard } from "../src/services/manualScorecard.js";
import {
  parseScorecardWorkbook,
  validateInnings,
  matchPlayerName,
  mappingFor,
  isSkippableBattingRow,
  parseCreateMappingValue,
  collectCreateSpecs,
  ensurePlaceholderPlayers,
} from "../src/scripts/importQfMatches.js";

const BATTING_HEADERS = [
  "#",
  "BATSMAN",
  "BALL BY BALL (DETAILS)",
  "DOTS (0/.)",
  "1s",
  "2s",
  "3s",
  "4s",
  "6s",
  "EXTRAS",
  "BALLS",
  "RUNS",
  "STATUS",
];

const BOWLING_HEADERS = [
  "#",
  "BOWLER",
  "OVER 1",
  "OVER 2",
  "OVER 3",
  "OVER 4",
  "DOTS",
  "4s GIVEN",
  "6s GIVEN",
  "EXTRAS (WD/N)",
  "OVERS",
  "RUNS CONCEDED",
  "WICKETS (W)",
];

const INNINGS = {
  first: {
    header: "1ST INNINGS - TINY (BATTING) vs TEST (BOWLING)",
    batting: [
      { name: "Alpha", balls: 6, runs: 12, fours: 1, sixes: 1, status: "Out" },
      { name: "Beta", balls: 6, runs: 18, fours: 1, sixes: 0, status: "Not Out" },
    ],
    extras: 2,
    total: 32,
    bowling: [{ name: "Bowler A", overs: 3, runs: 30, wickets: 1 }],
  },
  second: {
    header: "2ND INNINGS - TEST (BATTING) vs TINY (BOWLING)",
    batting: [
      { name: "Gamma", balls: 18, runs: 20, fours: 2, sixes: 0, status: "Out" },
      { name: "Delta", balls: 0, runs: 0, fours: 0, sixes: 0, status: "Not Out" },
    ],
    extras: 1,
    total: 21,
    bowling: [{ name: "Bowler B", overs: 3, runs: 21, wickets: 1 }],
  },
};

function battingRow(index, row) {
  const cells = new Array(13).fill(null);
  cells[0] = index;
  cells[1] = row.name;
  cells[7] = row.fours;
  cells[8] = row.sixes;
  cells[10] = row.balls;
  cells[11] = row.runs;
  cells[12] = row.status;
  return cells;
}

function battingTotalRow(innings) {
  const cells = new Array(17).fill(null);
  cells[0] = "TOTAL BATTING";
  cells[10] = innings.batting.reduce((sum, row) => sum + row.balls, 0);
  cells[11] = innings.batting.reduce((sum, row) => sum + row.runs, 0);
  cells[14] = innings.extras;
  cells[15] = "total";
  cells[16] = innings.total;
  return cells;
}

function bowlingRow(index, row) {
  const cells = new Array(13).fill(null);
  cells[0] = index;
  cells[1] = row.name;
  cells[10] = row.overs;
  cells[11] = row.runs;
  cells[12] = row.wickets;
  return cells;
}

function bowlingTotalRow(innings) {
  const cells = new Array(13).fill(null);
  cells[0] = "TOTAL BOWLING";
  cells[10] = innings.bowling.reduce((sum, row) => sum + row.overs, 0);
  cells[11] = innings.bowling.reduce((sum, row) => sum + row.runs, 0);
  cells[12] = innings.bowling.reduce((sum, row) => sum + row.wickets, 0);
  return cells;
}

function buildWorkbook(innings = INNINGS) {
  const rows = [["CRICKET MATCH SCORECARD - TINY VS TEST (fixture)"], []];
  for (const [index, data] of Object.entries(innings)) {
    if (index === "second") rows.push([]);
    rows.push([data.header]);
    rows.push(BATTING_HEADERS);
    data.batting.forEach((row, position) => rows.push(battingRow(position + 1, row)));
    rows.push(battingTotalRow(data));
    rows.push([]);
    rows.push([`BOWLING - ${index === "first" ? "TEST" : "TINY"}`]);
    rows.push(BOWLING_HEADERS);
    data.bowling.forEach((row, position) => rows.push(bowlingRow(position + 1, row)));
    rows.push(bowlingTotalRow(data));
  }
  const worksheet = xlsx.utils.aoa_to_sheet(rows);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, "Match 1 - Tiny vs Test");
  return xlsx.write(workbook, { bookType: "xlsx", type: "buffer" });
}

test("reads both innings and their scorebook totals", () => {
  const { sheets } = parseScorecardWorkbook(buildWorkbook());
  assert.equal(sheets.length, 1);
  const [sheet] = sheets;
  assert.equal(sheet.matchNumber, 1);
  assert.equal(sheet.innings.length, 2);

  const [first, second] = sheet.innings;
  assert.equal(first.inningsNumber, 1);
  assert.equal(first.battingTeam, "TINY");
  assert.equal(first.bowlingTeam, "TEST");
  assert.equal(first.batting.length, 2);
  assert.equal(first.battingTotal.battingRuns, 30);
  assert.equal(first.battingTotal.extras, 2);
  assert.equal(first.battingTotal.runs, 32);
  assert.equal(first.bowlingTotal.overs, 3);
  assert.equal(first.bowlingTotal.runs, 30);
  assert.equal(first.bowlingTotal.wickets, 1);
  assert.deepEqual(first.notes, []);

  assert.equal(second.inningsNumber, 2);
  assert.equal(second.battingTeam, "TEST");
  assert.equal(second.bowlingTeam, "TINY");
  assert.equal(second.battingTotal.runs, 21);
  assert.equal(second.bowlingTotal.wickets, 1);
});

test("a consistent innings passes and derives byes from bowler runs", () => {
  const { sheets } = parseScorecardWorkbook(buildWorkbook());
  const result = validateInnings(sheets[0].innings[0], { runs: 32, wickets: 1, overs: "3" });
  assert.deepEqual(result.errors, []);
  assert.equal(result.model.runs, 32);
  assert.equal(result.model.wickets, 1);
  assert.equal(result.model.overs, "3");
  assert.equal(result.model.extras.byes, 2);
  assert.equal(result.model.extras.wides, 0);
  assert.equal(result.model.extras.noBalls, 0);
});

test("a run out is a dismissal but is not counted in the TOTAL BOWLING wicket cell", () => {
  const withRunOut = structuredClone(INNINGS);
  withRunOut.first.batting = [
    { name: "Alpha", balls: 6, runs: 12, fours: 1, sixes: 1, status: "Out" },
    { name: "Beta", balls: 6, runs: 18, fours: 1, sixes: 0, status: "Run Out" },
  ];
  const { sheets } = parseScorecardWorkbook(buildWorkbook(withRunOut));
  const result = validateInnings(sheets[0].innings[0], { runs: 32, wickets: 2, overs: "3" });
  assert.deepEqual(result.errors, []);
  assert.equal(result.model.wickets, 2);
  assert.equal(result.model.bowling[0].wickets, 1);
});

test("a batting/extras mismatch is an error", () => {
  const broken = structuredClone(INNINGS);
  broken.first.extras = 0;
  const { sheets } = parseScorecardWorkbook(buildWorkbook(broken));
  const result = validateInnings(sheets[0].innings[0], { runs: 32, wickets: 1, overs: "3" });
  assert.ok(result.errors.some((message) => /extras \(0\).*innings total 32/.test(message)));
});

test("bowler runs that overshoot the innings total are an error", () => {
  const broken = structuredClone(INNINGS);
  broken.first.bowling[0].runs = 35;
  const { sheets } = parseScorecardWorkbook(buildWorkbook(broken));
  const result = validateInnings(sheets[0].innings[0], { runs: 32, wickets: 1, overs: "3" });
  assert.ok(result.errors.some((message) => /bowler runs \(35\) exceed the innings total \(32\)/.test(message)));
});

test("an ordinal name matches the marked second player", () => {
  const squad = [
    { _id: "1", name: "Salman Khan" },
    { _id: "2", name: "Salman Khan JR" },
  ];
  const result = matchPlayerName(squad, "Salman 2");
  assert.equal(result.status, "matched");
  assert.equal(result.player.name, "Salman Khan JR");
});

test("a bare duplicate first name stays ambiguous", () => {
  const squad = [
    { _id: "1", name: "Majid Afridi" },
    { _id: "2", name: "Majid Afridi (2)" },
  ];
  const result = matchPlayerName(squad, "Majid");
  assert.equal(result.status, "unresolved");
  assert.match(result.reason, /ambiguous between Majid Afridi, Majid Afridi \(2\)/);
});

test("a one-letter first-name variant matches only when unique in the squad", () => {
  const unique = matchPlayerName([{ _id: "1", name: "Mehmoodul Hassan" }], "Hasan");
  assert.equal(unique.status, "matched");
  assert.equal(unique.player.name, "Mehmoodul Hassan");

  const ambiguous = matchPlayerName(
    [
      { _id: "1", name: "Usman Afridi" },
      { _id: "2", name: "Qari Usman" },
    ],
    "Osman",
  );
  assert.equal(ambiguous.status, "unresolved");
});

test("an explicit name mapping wins over fuzzy matching", () => {
  const squad = [
    { _id: "1", name: "Br. Aqal" },
    { _id: "2", name: "Someone Else" },
  ];
  const result = matchPlayerName(squad, "Dr Aqal", { mappingValue: "Someone Else" });
  assert.equal(result.status, "matched");
  assert.equal(result.player.name, "Someone Else");
});

test("an explicit player id mapping resolves that squad player", () => {
  const playerId = "64b7f0c2a1b2c3d4e5f60718";
  const squad = [
    { _id: playerId, name: "Br. Aqal" },
    { _id: "64b7f0c2a1b2c3d4e5f60719", name: "Someone Else" },
  ];
  const result = matchPlayerName(squad, "Dr Aqal", { mappingValue: playerId });
  assert.equal(result.status, "matched");
  assert.equal(result.player._id, playerId);
  assert.equal(result.reason, "mapping id");
});

test("an explicit mapping resolves a blank scorebook name such as an unnamed bowler", () => {
  const playerId = "64b7f0c2a1b2c3d4e5f60718";
  const squad = [
    { _id: playerId, name: "Mystery Bowler" },
    { _id: "64b7f0c2a1b2c3d4e5f60719", name: "Someone Else" },
  ];
  assert.equal(mappingFor({ "Orangi United::?": "Mystery Bowler" }, "Orangi United", "?"), "Mystery Bowler");
  const result = matchPlayerName(squad, "", { mappingValue: "Mystery Bowler" });
  assert.equal(result.status, "matched");
  assert.equal(result.player._id, playerId);
  assert.equal(result.reason, "mapping name");
});

test("the Orangi Sports alias resolves mapping keys for Orangi Warriors", () => {
  const mapping = {
    "Orangi Sports::MAE": "M Ali",
    "Young Star::Salmen": "Salman Khan",
  };
  assert.equal(mappingFor(mapping, "Orangi Warriors", "MAE"), "M Ali");
  assert.equal(mappingFor(mapping, "Orangi Warriors", "Salmen"), null);
  assert.equal(mappingFor(mapping, "Young Star", "Salmen"), "Salman Khan");
});

test("SKIP is allowed only for a did-not-bat / 0-ball 0-run batsman", () => {
  assert.equal(isSkippableBattingRow({ runs: 0, balls: 0, status: "DNB" }), true);
  assert.equal(isSkippableBattingRow({ runs: 0, balls: 0, status: "Not Out" }), true);
  assert.equal(isSkippableBattingRow({ runs: 0, balls: 0, status: "" }), true);
  assert.equal(isSkippableBattingRow({ runs: 0, balls: 1, status: "Not Out" }), false);
  assert.equal(isSkippableBattingRow({ runs: 4, balls: 0, status: "Not Out" }), false);
  assert.equal(isSkippableBattingRow({ runs: 0, balls: 0, status: "Out" }), false);
});

// ---------------------------------------------------------------------------
// CREATE:<name> placeholders
// ---------------------------------------------------------------------------

test("only CREATE: mapping values are player-creation instructions", () => {
  assert.deepEqual(parseCreateMappingValue("CREATE:Zahid (TBC)"), { name: "Zahid (TBC)" });
  assert.deepEqual(parseCreateMappingValue("  create:Ali (TBC)  "), { name: "Ali (TBC)" });
  assert.equal(parseCreateMappingValue("Salman Khan"), null);
  assert.equal(parseCreateMappingValue("SKIP"), null);
  assert.equal(parseCreateMappingValue("64b7f0c2a1b2c3d4e5f60718"), null);
  assert.equal(parseCreateMappingValue(undefined), null);
  assert.match(parseCreateMappingValue("CREATE:").error, /needs a player name/);
});

test("the Sky Sports::Ali CREATE mapping is one spec for its batting and bowling rows", () => {
  const orangi = { _id: "team-orangi", name: "Orangi United" };
  const sky = { _id: "team-sky", name: "Sky Sports" };
  const parsed = {
    sheets: [
      {
        matchNumber: 2,
        innings: [
          // QF2 innings 1: Sky Sports is the bowling side.
          { batting: [], bowling: [{ name: "Ali", row: 25 }] },
          // QF2 innings 2: Sky Sports is the batting side.
          { batting: [{ name: "Ali", row: 38 }], bowling: [] },
        ],
      },
    ],
  };
  const { specs, errors } = collectCreateSpecs({
    parsed,
    teams: [
      { name: "Orangi United", team: orangi },
      { name: "Sky Sports", team: sky },
    ],
    mapping: { "Sky Sports::Ali": "CREATE:Ali (TBC)" },
  });
  assert.deepEqual(errors, []);
  assert.equal(specs.length, 1);
  assert.equal(specs[0].name, "Ali (TBC)");
  assert.equal(specs[0].teamId, "team-sky");
  assert.equal(specs[0].rows.length, 2);
  assert.deepEqual(
    specs[0].rows.map((row) => `${row.role}:${row.row}`).sort(),
    ["batting:38", "bowling:25"],
  );
});

test("a CREATE: value with no name is reported, not silently ignored", () => {
  const parsed = {
    sheets: [
      {
        matchNumber: 1,
        innings: [
          { batting: [{ name: "Zahid", row: 4 }], bowling: [] },
          { batting: [], bowling: [] },
        ],
      },
    ],
  };
  const { specs, errors } = collectCreateSpecs({
    parsed,
    teams: [
      { name: "Young Star", team: { _id: "team-young", name: "Young Star" } },
      { name: "Family Stallions", team: { _id: "team-stallions", name: "Family Stallions" } },
    ],
    mapping: { "Young Star::Zahid": "CREATE:" },
  });
  assert.equal(specs.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /needs a player name/);
});

let mongod = null;
before(async () => {
  mongod = await startTestDb();
});
after(async () => {
  await stopTestDb(mongod);
});

test("CREATE: dry run reports would-create but writes nothing", async () => {
  const team = await Team.create({ name: "OPENCODE_TEST CREATE Dry Run" });
  const result = await ensurePlaceholderPlayers(
    [{ teamId: String(team._id), teamName: team.name, name: "Zahid (TBC)" }],
    { dryRun: true },
  );

  assert.deepEqual(result.created, []);
  assert.equal(result.wouldCreate.length, 1);
  assert.equal(result.wouldCreate[0].name, "Zahid (TBC)");
  assert.equal(result.wouldCreate[0].team, team.name);
  assert.equal(await Player.countDocuments({ team: team._id }), 0);
  const afterRun = await Team.findById(team._id).lean();
  assert.equal((afterRun.players || []).length, 0);
});

test("CREATE: apply creates exactly one player, then a second apply reuses it", async () => {
  const team = await Team.create({ name: "OPENCODE_TEST CREATE Apply" });
  const spec = [{ teamId: String(team._id), teamName: team.name, name: "Afridi (TBC)" }];

  const first = await ensurePlaceholderPlayers(spec, { dryRun: false });
  assert.equal(first.created.length, 1);
  const createdId = first.created[0].id;
  const player = await Player.findById(createdId).lean();
  assert.equal(player.name, "Afridi (TBC)");
  assert.equal(player.role, "");
  assert.equal(String(player.team), String(team._id));
  assert.ok(!player.createdBy);
  assert.equal(player.imageUrl, "");

  const roster = await Team.findById(team._id).lean();
  assert.deepEqual((roster.players || []).map(String), [createdId]);
  assert.equal(roster.captain, null);
  assert.equal(roster.viceCaptain, null);

  const second = await ensurePlaceholderPlayers(spec, { dryRun: false });
  assert.deepEqual(second.created, []);
  assert.equal(second.reused.length, 1);
  assert.equal(second.reused[0].id, createdId);
  assert.equal(await Player.countDocuments({ team: team._id, name: "Afridi (TBC)" }), 1);
});

test("one shared CREATE: placeholder creates a single player for both rows", async () => {
  const orangi = await Team.create({ name: "Orangi United" });
  const sky = await Team.create({ name: "Sky Sports" });
  const { specs } = collectCreateSpecs({
    parsed: {
      sheets: [
        {
          matchNumber: 2,
          innings: [
            { batting: [], bowling: [{ name: "Ali", row: 25 }] },
            { batting: [{ name: "Ali", row: 38 }], bowling: [] },
          ],
        },
      ],
    },
    teams: [
      { name: "Orangi United", team: orangi },
      { name: "Sky Sports", team: sky },
    ],
    mapping: { "Sky Sports::Ali": "CREATE:Ali (TBC)" },
  });

  const result = await ensurePlaceholderPlayers(specs, { dryRun: false });
  assert.equal(result.created.length, 1);
  assert.equal(await Player.countDocuments({ team: sky._id, name: "Ali (TBC)" }), 1);
  const roster = await Team.findById(sky._id).lean();
  assert.deepEqual((roster.players || []).map(String), [result.created[0].id]);
});

test("the manual validator still refuses the same player twice in one innings", () => {
  const payload = {
    teamA: "team-a",
    teamB: "team-b",
    startAt: "2026-10-11T00:00:00Z",
    totalOvers: 20,
    innings: [
      {
        team: "team-a",
        batting: [
          { player: "player-a1", runs: 5, balls: 5, isOut: false },
          { player: "player-a1", runs: 3, balls: 4, isOut: false },
        ],
        bowling: [],
        extras: {},
      },
    ],
    result: { winner: "team-a", margin: "1 run", resultType: "normal" },
  };
  const result = validateManualScorecard(payload, {
    teamIds: ["team-a", "team-b"],
    totalOvers: 20,
    squadByTeam: {
      "team-a": ["player-a1", "player-a2"],
      "team-b": ["player-b1", "player-b2"],
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /twice/.test(error.message)));
});
