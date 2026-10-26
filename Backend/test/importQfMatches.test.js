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

import test from "node:test";
import assert from "node:assert/strict";
import * as xlsx from "xlsx";

import { parseScorecardWorkbook, validateInnings, matchPlayerName, mappingFor, isSkippableBattingRow } from "../src/scripts/importQfMatches.js";

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
