// Import the 2026 All Baldia T20 quarter-finals from a paper-scorecard workbook
// into CricAll as DRAFT manual scorecards.
//
//   node src/scripts/importQfMatches.js                 # dry run (default)
//   node src/scripts/importQfMatches.js --apply         # write the DRAFT matches
//   node src/scripts/importQfMatches.js --file <xlsx>   # explicit workbook
//   node src/scripts/importQfMatches.js --force-test    # allow a *e2e NODE_ENV=test DB
//
// Sheets are mapped generically: a sheet named "Match N ..." is QF N. The two
// teams come from the innings title rows, so the same script accepts the
// original three-match workbook and the separate QF4 workbook.
//
// Safety and scope
// ---------------
//   * Dry run by default. --apply writes ONLY DRAFT manual matches in the
//     existing tournament. It never creates the tournament, never publishes,
//     never creates teams, and never creates semi-finals or a final.
//   * Every innings is validated against the scorebook totals before a write:
//       batsmen runs + extras                === innings total
//       bowler runs + derived byes/leg-byes  === innings total
//     A negative bye/leg-bye split, an unresolved player, an unknown team, an
//     existing non-manual fixture, or a validator error refuses --apply.
//   * Names are matched inside the team squad only. Exact names, unique first
//     name/nickname tokens and one-character spelling variants are accepted;
//     ambiguity is not guessed and is reported as UNRESOLVED.
//   * Optional disambiguation file: src/scripts/data/qfNameMap.json
//       { "Dr Aqal": "<player ObjectId or exact squad name>",
//         "Orangi Warriors::?": "<player ObjectId or exact squad name>",
//         "Sky Sports::Islam": "SKIP",
//         "Orangi United::Attaulla": "CREATE:Attaulla (TBC)" }
//     A "Team::Sheet name" key wins over a plain "Sheet name" key. "SKIP" drops
//     a did-not-bat / 0-ball 0-run batting row; it is rejected for any other row.
//     A blank sheet name can be resolved with a key such as "Team::?". A
//     "CREATE:<name>" value is the only way this script creates a player: with
//     --apply it creates that exact name on the mapped team (role blank) and
//     reuses an existing same-name player on later runs. Any other value must be
//     an existing player ObjectId or an exact squad name. Nothing outside an
//     explicit CREATE: entry is ever created.
//   * Re-running is safe: an existing tournament is reused, missing teams are
//     added, and an already-imported QF (same teams/slot) is skipped.
//   * The scorebook gives only combined wides/no-balls. The combined figure is
//     stored in extras.wides with noBalls=0; byes/leg-byes are derived as
//     innings total - bowler runs.
//   * There is no ball-type field on Tournament/Match. "Hard Ball" is carried by
//     the tournament name and T20 format; this is reported, not hidden.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import * as xlsx from "xlsx";
import Team from "../models/Team.js";
import Player from "../models/Player.js";
import Match from "../models/Match.js";
import Tournament from "../models/Tournament.js";
import SystemSettings from "../models/SystemSettings.js";
import { createManualMatch } from "../controllers/manualScorecardController.js";
import { validateManualScorecard, parseOvers } from "../services/manualScorecard.js";
import { getMongoTarget } from "../utils/mongoTarget.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(SCRIPT_DIR, "../..");
dotenv.config({ path: path.join(BACKEND_ROOT, ".env"), quiet: true });

mongoose.set("autoIndex", false);

const MAPPING_FILE = path.join(SCRIPT_DIR, "data", "qfNameMap.json");
const TOURNAMENT_NAME = "All Baldia T20 Hard Ball Cricket Tournament";
const CREATE_PREFIX = "CREATE:";
const PLACEHOLDER_ID_PREFIX = "placeholder-player:";
const TOTAL_OVERS = 20;
const STAGE = "quarter_final";
const STAGE_PREFIX = "QF";

const TOURNAMENT_TEAMS = [
  { name: "Ittehad Sports", aliases: ["Ittehad Sports"] },
  { name: "Baldia Zalmi", aliases: ["Baldia Zalmi"] },
  { name: "Sky Sports", aliases: ["Sky Sports"] },
  { name: "Orangi United", aliases: ["Orangi United"] },
  { name: "Young Star", aliases: ["Young Star"] },
  { name: "Khan Associates", aliases: ["Khan Associates", "KHAN ASSOCIATE", "Khan Associate"] },
  { name: "Family Stallions", aliases: ["Family Stallions", "Family Stallion"] },
  { name: "Orangi Warriors", aliases: ["Orangi Warriors", "Orangi Sports"] },
];

// The workbook carries the totals and the sheet title carries the date, but it
// does not carry the match result. These pinned expectations are optional: a
// new "Match N" sheet is still mapped to QF N and its result is derived from
// the two innings. When an entry exists it is a cross-check, never a source of
// numbers written to the database.
export const MATCH_EXPECTATIONS = {
  1: {
    date: "2026-10-11",
    innings: [
      { runs: 277, wickets: 7, overs: "20" },
      { runs: 155, wickets: 8, overs: "15.4" },
    ],
    result: { winner: "Young Star", margin: "122 runs" },
  },
  2: {
    date: "2026-10-11",
    innings: [
      { runs: 162, wickets: 10, overs: "17" },
      { runs: 163, wickets: 6, overs: "17.2" },
    ],
    result: { winner: "Sky Sports", margin: "4 wickets" },
  },
  3: {
    date: "2026-10-11",
    innings: [
      { runs: 279, wickets: 5, overs: "20" },
      { runs: 155, wickets: 10, overs: "15.4" },
    ],
    result: { winner: "Baldia Zalmi", margin: "124 runs" },
  },
  4: {
    date: "2026-10-18",
    innings: [
      { runs: 235, wickets: 10, overs: "20" },
      { runs: 232, wickets: 10, overs: "19.5" },
    ],
    result: { winner: "Khan Associates", margin: "3 runs" },
  },
};

const MONTHS = new Map([
  ["jan", 0],
  ["feb", 1],
  ["mar", 2],
  ["apr", 3],
  ["may", 4],
  ["jun", 5],
  ["jul", 6],
  ["aug", 7],
  ["sep", 8],
  ["oct", 9],
  ["nov", 10],
  ["dec", 11],
]);

export function matchNumberFromSheetName(sheetName) {
  const match = String(sheetName || "").match(/\bMatch\s*(\d+)\b/i);
  return match ? Number(match[1]) : 0;
}

export function stageLabelForMatch(matchNumber) {
  return `${STAGE_PREFIX}${Number(matchNumber)}`;
}

export function parseMatchDate(text) {
  const match = String(text || "").match(
    /\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})\b/i,
  );
  if (!match) return null;
  const day = Number(match[1]);
  const month = MONTHS.get(match[2].slice(0, 3).toLowerCase());
  const year = Number(match[3]);
  if (!Number.isInteger(day) || month === undefined || !Number.isInteger(year)) return null;
  const date = new Date(Date.UTC(year, month, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

const isoDate = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");

const HONORIFICS = new Set(["br", "dr", "mr", "mrs", "ms", "md", "muhammad", "mohammad", "mohammed"]);

const normalizeName = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const nameTokens = (value) => normalizeName(value).split(" ").filter(Boolean);

const normalizeTeamLabel = (value) =>
  nameTokens(value)
    .map((token) => (token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token))
    .join(" ");

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

export function isSkippableBattingRow(row) {
  if (Number(row.runs) !== 0 || Number(row.balls) !== 0) return false;
  const status = String(row.status || "").trim().toLowerCase();
  if (!status) return true;
  if (/^(dnb|did\s*not\s*bat)\b/.test(status)) return true;
  if (/^(not\s*out|retired\s*hurt|retired)\b/.test(status)) return true;
  return !/out/.test(status);
}

/**
 * Parse an explicit placeholder instruction from the name map.
 * "CREATE:Attaulla (TBC)" -> { name: "Attaulla (TBC)" }.
 * Anything that is not a CREATE: value returns null, so ordinary names, ids and
 * SKIP are never treated as player-creation instructions.
 */
export function parseCreateMappingValue(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.toUpperCase().startsWith(CREATE_PREFIX)) return null;
  const name = trimmed.slice(CREATE_PREFIX.length).trim();
  if (!name) return { name: "", error: "CREATE mapping needs a player name after CREATE:" };
  return { name };
}

const idOf = (value) => String(value?._id || value || "");

function argValue(flag) {
  const withEquals = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (withEquals) return withEquals.slice(flag.length + 1);
  const index = process.argv.indexOf(flag);
  if (index !== -1 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--")) {
    return process.argv[index + 1];
  }
  return undefined;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

function hasDifferingHonorific(sheetName, squadName) {
  const sheetTokens = nameTokens(sheetName);
  const squadTokens = nameTokens(squadName);
  const sheetHonorifics = sheetTokens.filter((token) => HONORIFICS.has(token));
  const squadHonorifics = squadTokens.filter((token) => HONORIFICS.has(token));
  if (!sheetHonorifics.length && !squadHonorifics.length) return false;
  return sheetHonorifics.join(" ") !== squadHonorifics.join(" ");
}

const toFiniteNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

// ---------------------------------------------------------------------------
// Workbook reading
// ---------------------------------------------------------------------------

function candidateWorkbookFiles(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.xlsx$/i.test(entry.name) && !entry.name.startsWith("~$"))
    .map((entry) => path.join(dir, entry.name));
}

export function findWorkbook(explicitPath) {
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    if (!fs.existsSync(resolved)) throw new Error(`Workbook not found: ${resolved}`);
    return { file: resolved, source: "--file" };
  }

  const home = os.homedir();
  const searchDirs = [
    { dir: path.join(home, "Desktop"), label: "Desktop" },
    { dir: path.join(home, "Downloads"), label: "Downloads" },
    { dir: path.join(SCRIPT_DIR, "data"), label: "script/data" },
    { dir: path.join(BACKEND_ROOT, "data"), label: "Backend/data" },
    { dir: path.join(process.cwd(), "data"), label: "cwd/data" },
  ];
  const scorecardPattern = /QF|Match\s*\d+|Match\d+|Cricket_Scorecards|AllBaldia/i;

  // Newest matching workbook wins. Desktop is searched first only to break ties.
  const candidates = [];
  searchDirs.forEach(({ dir, label }, order) => {
    for (const file of candidateWorkbookFiles(dir)) {
      const name = path.basename(file);
      if (!scorecardPattern.test(name)) continue;
      candidates.push({ file, label, order, mtimeMs: fs.statSync(file).mtimeMs });
    }
  });
  if (!candidates.length) {
    throw new Error(
      "No scorecard workbook found. Put Match4_QF4_import.xlsx (or a *QF*/*Match N* workbook) on the Desktop or in Downloads, or pass --file <xlsx>.",
    );
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || a.order - b.order);
  const [chosen, ...alternatives] = candidates;
  return {
    file: chosen.file,
    source: chosen.label,
    alternatives: alternatives.map((row) => row.file),
  };
}

function rowTexts(row) {
  return (row || []).map((cell) => String(cell ?? "").trim());
}

function findColumn(headerTexts, matcher) {
  return headerTexts.findIndex((text) => matcher(text));
}

function numericAt(row, index) {
  return index >= 0 ? toFiniteNumber(row[index]) : null;
}

function lastNumeric(row) {
  for (let i = row.length - 1; i >= 0; i -= 1) {
    const value = toFiniteNumber(row[i]);
    if (value !== null) return value;
  }
  return null;
}

export function parseInningsHeader(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  const vsAt = raw.toLowerCase().indexOf(" vs ");
  if (vsAt === -1) return null;
  const left = raw.slice(0, vsAt);
  const right = raw.slice(vsAt + 4);
  const roleOf = (part) => {
    const match = part.match(/\((BATTING|BOWLING)\)/i);
    return match ? match[1].toUpperCase() : "";
  };
  const teamOf = (part) =>
    part
      .replace(/^.*?INNINGS\s*-\s*/i, "")
      .replace(/\((BATTING|BOWLING)\)[\s\S]*$/i, "")
      .trim();
  const leftRole = roleOf(left);
  const rightRole = roleOf(right);
  const leftTeam = teamOf(left);
  const rightTeam = teamOf(right);
  if (!leftTeam || !rightTeam) return null;
  const battingTeam = leftRole === "BATTING" ? leftTeam : rightRole === "BATTING" ? rightTeam : "";
  const bowlingTeam = leftRole === "BOWLING" ? leftTeam : rightRole === "BOWLING" ? rightTeam : "";
  const inningsMatch = raw.match(/\b(1ST|2ND|FIRST|SECOND)\s+INNINGS\b/i);
  const inningsNumber = inningsMatch
    ? /^1|first/i.test(inningsMatch[1]) ? 1 : 2
    : 0;
  return { raw, battingTeam, bowlingTeam, inningsNumber };
}

function parseBattingSection(rows, headerRow) {
  // The sheet is scanned row by row; the batting card ends at TOTAL BATTING or
  // at the next BOWLING section, whichever comes first.
  const headers = rowTexts(rows[headerRow]);
  const columns = {
    name: findColumn(headers, (text) => /^BATSMAN$/i.test(text)),
    balls: findColumn(headers, (text) => /^BALLS$/i.test(text)),
    runs: findColumn(headers, (text) => /^RUNS$/i.test(text)),
    fours: findColumn(headers, (text) => /^4S|^FOURS$/i.test(text)),
    sixes: findColumn(headers, (text) => /^6S|^SIXES$/i.test(text)),
    status: findColumn(headers, (text) => /^STATUS$/i.test(text)),
  };
  const errors = [];
  for (const [key, index] of Object.entries(columns)) {
    if (index === -1) errors.push(`batting header is missing ${key}`);
  }
  const batting = [];
  let totalRow = -1;
  let total = null;
  for (let r = headerRow + 1; r < rows.length; r += 1) {
    const texts = rowTexts(rows[r]);
    if (texts.some((text) => /^TOTAL\s+BATTING$/i.test(text))) {
      totalRow = r;
      const labelIndex = texts.findIndex((text) => /^total\b/i.test(text));
      const extras =
        numericAt(rows[r], labelIndex - 1) ??
        numericAt(rows[r], 14);
      const runs =
        numericAt(rows[r], labelIndex + 1) ??
        numericAt(rows[r], 16) ??
        lastNumeric(rows[r]);
      const battingRuns = columns.runs >= 0 ? numericAt(rows[r], columns.runs) : null;
      const balls = columns.balls >= 0 ? numericAt(rows[r], columns.balls) : null;
      total = { battingRuns, extras, runs, balls, row: r + 1 };
      break;
    }
    if (texts.some((text) => /^BOWLING\b/i.test(text))) break;
    const name = columns.name >= 0 ? texts[columns.name] : "";
    if (!name) continue;
    batting.push({
      row: r + 1,
      name,
      balls: numericAt(rows[r], columns.balls) ?? 0,
      runs: numericAt(rows[r], columns.runs) ?? 0,
      fours: numericAt(rows[r], columns.fours) ?? 0,
      sixes: numericAt(rows[r], columns.sixes) ?? 0,
      status: columns.status >= 0 ? texts[columns.status] : "",
    });
  }
  if (!batting.length) errors.push("no batting rows found");
  if (!total) errors.push("TOTAL BATTING row not found");
  return { batting, total, totalRow, errors };
}

function parseBowlingSection(rows, headerRow) {
  const headers = rowTexts(rows[headerRow]);
  const columns = {
    name: findColumn(headers, (text) => /^BOWLER$/i.test(text)),
    overs: findColumn(headers, (text) => /^OVERS$/i.test(text)),
    runs: findColumn(headers, (text) => /^RUNS\s+CONCEDED$/i.test(text)),
    wickets: findColumn(headers, (text) => /^WICKETS/i.test(text)),
  };
  const errors = [];
  for (const [key, index] of Object.entries(columns)) {
    if (index === -1) errors.push(`bowling header is missing ${key}`);
  }
  const bowling = [];
  let total = null;
  const notes = [];
  for (let r = headerRow + 1; r < rows.length; r += 1) {
    const texts = rowTexts(rows[r]);
    if (texts.some((text) => /^TOTAL\s+BOWLING$/i.test(text))) {
      const labelIndex = texts.findIndex((text) => /^total\b/i.test(text));
      const overs =
        (columns.overs >= 0 ? numericAt(rows[r], columns.overs) : null) ??
        numericAt(rows[r], labelIndex - 1) ??
        numericAt(rows[r], 10);
      const runs =
        (columns.runs >= 0 ? numericAt(rows[r], columns.runs) : null) ??
        numericAt(rows[r], labelIndex - 2) ??
        lastNumeric(rows[r]);
      const wickets =
        (columns.wickets >= 0 ? numericAt(rows[r], columns.wickets) : null) ??
        numericAt(rows[r], labelIndex - 3) ??
        null;
      const noteCells = rowTexts(rows[r]).filter((text) => text && !/^total\b/i.test(text));
      total = { overs, runs, wickets, row: r + 1, noteCells };
      continue;
    }
    if (texts.some((text) => /INNINGS/i.test(text))) break;
    if (total) {
      const note = texts.filter(Boolean).join(" ").trim();
      if (note) notes.push({ row: r + 1, text: note });
      continue;
    }
    const name = columns.name >= 0 ? texts[columns.name] : "";
    if (!name) continue;
    bowling.push({
      row: r + 1,
      name,
      overs: columns.overs >= 0 ? texts[columns.overs] : "",
      oversValue: numericAt(rows[r], columns.overs),
      runs: numericAt(rows[r], columns.runs) ?? 0,
      wickets: numericAt(rows[r], columns.wickets) ?? 0,
    });
  }
  if (!bowling.length) errors.push("no bowling rows found");
  if (!total) errors.push("TOTAL BOWLING row not found");
  return { bowling, total, notes, errors };
}

export function parseScorecardWorkbook(buffer) {
  const workbook = xlsx.read(buffer, { type: "buffer", cellFormula: true, cellDates: true });
  const sheets = [];
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: null, blankrows: true });
    const texts = xlsx.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: "", blankrows: true });
    const matchNumber = matchNumberFromSheetName(sheetName);
    const sheetTitle = rowTexts(texts[0] || []).join(" ");
    if (!matchNumber) continue;

    const parsedInnings = [];
    for (let r = 0; r < texts.length; r += 1) {
      const line = rowTexts(texts[r]).filter(Boolean).join(" ");
      if (!/INNINGS/i.test(line) || !/\(BATTING\)/i.test(line)) continue;
      const header = parseInningsHeader(line);
      if (!header) continue;
      let battingHeader = -1;
      for (let b = r + 1; b < Math.min(r + 12, texts.length); b += 1) {
        if (rowTexts(texts[b]).some((text) => /^BATSMAN$/i.test(text))) {
          battingHeader = b;
          break;
        }
      }
      if (battingHeader === -1) continue;
      const battingSection = parseBattingSection(rows, battingHeader);
      let bowlingHeader = -1;
      for (let b = battingHeader + 1; b < Math.min(battingSection.totalRow + 12, texts.length); b += 1) {
        if (rowTexts(texts[b]).some((text) => /^BOWLER$/i.test(text))) {
          bowlingHeader = b;
          break;
        }
      }
      const bowlingSection =
        bowlingHeader === -1
          ? { bowling: [], total: null, notes: [], errors: ["bowling header not found"] }
          : parseBowlingSection(rows, bowlingHeader);
      parsedInnings.push({
        ...header,
        headerRow: r + 1,
        batting: battingSection.batting,
        battingTotal: battingSection.total,
        bowling: bowlingSection.bowling,
        bowlingTotal: bowlingSection.total,
        notes: bowlingSection.notes,
        errors: [...battingSection.errors, ...bowlingSection.errors],
      });
    }
    parsedInnings.sort((a, b) => a.inningsNumber - b.inningsNumber);
    sheets.push({
      sheetName,
      matchNumber,
      title: sheetTitle,
      matchDate: parseMatchDate(sheetTitle),
      innings: parsedInnings,
    });
  }
  sheets.sort((a, b) => a.matchNumber - b.matchNumber);
  return { sheets };
}

/**
 * Group sheets by the "Match N" prefix. A normal scorebook has one sheet per
 * match with both innings; if a workbook splits the two innings across sheets,
 * they are merged here and sorted by innings number.
 */
export function groupSheetsByMatch(sheets) {
  const byMatch = new Map();
  for (const sheet of sheets || []) {
    if (!sheet?.matchNumber) continue;
    if (!byMatch.has(sheet.matchNumber)) {
      byMatch.set(sheet.matchNumber, {
        matchNumber: sheet.matchNumber,
        sheetName: sheet.sheetName,
        title: sheet.title,
        matchDate: sheet.matchDate || parseMatchDate(sheet.title),
        innings: [],
      });
    }
    const target = byMatch.get(sheet.matchNumber);
    target.innings.push(...(sheet.innings || []));
    if (sheet.sheetName && !target.sheetName.includes(sheet.sheetName)) {
      target.sheetName = `${target.sheetName} | ${sheet.sheetName}`;
    }
    if (!target.matchDate && sheet.matchDate) target.matchDate = sheet.matchDate;
  }
  return [...byMatch.values()]
    .map((sheet) => ({
      ...sheet,
      innings: sheet.innings.slice().sort((a, b) => a.inningsNumber - b.inningsNumber),
    }))
    .sort((a, b) => a.matchNumber - b.matchNumber);
}

function readNumericOvers(total) {
  if (!total) return { value: null, label: "" };
  const noteText = (total.noteCells || []).join(" ");
  const noteMatch = noteText.match(/(\d{1,3}(?:\.\d)?)\s*overs?/i);
  if (noteMatch) return { value: noteMatch[1], label: noteText };
  if (total.overs === null || total.overs === undefined) return { value: null, label: noteText };
  return { value: String(total.overs), label: noteText };
}

// ---------------------------------------------------------------------------
// Validation and model building
// ---------------------------------------------------------------------------

function parseStatus(status) {
  const text = String(status || "").trim().toLowerCase();
  if (!text) return { isOut: false, dismissalType: "", error: "missing batting status" };
  if (/^not\s*out\b/.test(text)) return { isOut: false, dismissalType: "" };
  if (/run\s*out/.test(text)) return { isOut: true, dismissalType: "run out" };
  if (/retired\s*hurt/.test(text)) return { isOut: false, isRetiredHurt: true, dismissalType: "retired hurt" };
  if (/^retired\b/.test(text)) return { isOut: false, isRetired: true, dismissalType: "retired" };
  if (/^out\b/.test(text)) return { isOut: true, dismissalType: "" };
  return { isOut: false, dismissalType: "", error: `unknown batting status "${status}"` };
}

function sum(values) {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

export function validateInnings(raw, specInnings, options = {}) {
  const errors = [];
  const warnings = [];
  const add = (message) => errors.push(message);
  const warn = (message) => warnings.push(message);

  if (!raw) return { errors: ["innings is missing"], warnings, model: null };
  if (raw.errors?.length) errors.push(...raw.errors);

  const battingTotal = raw.battingTotal || {};
  const bowlingTotal = raw.bowlingTotal || {};
  const battingRuns = sum(raw.batting.map((row) => row.runs));
  const balls = sum(raw.batting.map((row) => row.balls));
  const bowlingRuns = sum(raw.bowling.map((row) => row.runs));
  const rawBowlingWickets = sum(raw.bowling.map((row) => row.wickets));

  if (battingTotal.battingRuns !== null && battingRuns !== battingTotal.battingRuns) {
    add(`batsman runs sum to ${battingRuns}, but the TOTAL BATTING cell says ${battingTotal.battingRuns}`);
  }
  if (battingTotal.balls !== null && balls !== battingTotal.balls) {
    add(`batsman balls sum to ${balls}, but the TOTAL BATTING cell says ${battingTotal.balls}`);
  }
  if (bowlingTotal.runs !== null && bowlingRuns !== bowlingTotal.runs) {
    add(`bowler runs sum to ${bowlingRuns}, but the TOTAL BOWLING cell says ${bowlingTotal.runs}`);
  }
  if (bowlingTotal.wickets !== null && rawBowlingWickets !== bowlingTotal.wickets) {
    add(`bowler wickets sum to ${rawBowlingWickets}, but the TOTAL BOWLING cell says ${bowlingTotal.wickets}`);
  }

  const inningsRuns = battingTotal.runs ?? bowlingTotal.runs;
  const extras = battingTotal.extras;
  if (inningsRuns === null || inningsRuns === undefined) add("innings total is missing");
  if (extras === null || extras === undefined) add("extras total is missing");
  if (Number.isFinite(inningsRuns) && Number.isFinite(extras) && battingRuns + extras !== inningsRuns) {
    add(`batsman runs (${battingRuns}) + extras (${extras}) = ${battingRuns + extras}, not the innings total ${inningsRuns}`);
  }
  if (Number.isFinite(inningsRuns) && Number.isFinite(bowlingRuns)) {
    const byes = inningsRuns - bowlingRuns;
    if (byes < 0) {
      add(`bowler runs (${bowlingRuns}) exceed the innings total (${inningsRuns}); byes/leg-byes would be ${byes}`);
    } else if (Number.isFinite(extras)) {
      const widesAndNoBalls = extras - byes;
      if (widesAndNoBalls < 0) {
        add(`extras (${extras}) are less than the ${byes} bye/leg-bye runs implied by bowler runs (${bowlingRuns}) vs total (${inningsRuns}); combined wides/no-balls would be ${widesAndNoBalls}`);
      }
      if (widesAndNoBalls + byes !== extras) {
        add(`extras split does not add up: wides/no-balls ${widesAndNoBalls} + byes/leg-byes ${byes} != ${extras}`);
      }
    }
  }

  const batting = [];
  raw.batting.forEach((row, index) => {
    const status = parseStatus(row.status);
    if (status.error) add(`batting row ${row.row} (${row.name}): ${status.error}`);
    batting.push({
      row: row.row,
      name: row.name,
      runs: row.runs,
      balls: row.balls,
      fours: row.fours,
      sixes: row.sixes,
      isOut: status.isOut,
      isRetiredHurt: status.isRetiredHurt === true,
      isRetired: status.isRetired === true,
      dismissalType: status.dismissalType,
      position: index + 1,
    });
  });
  const outCount = batting.filter((row) => row.isOut).length;
  const runOutCount = batting.filter((row) => row.dismissalType === "run out").length;
  if (specInnings) {
    if (inningsRuns !== specInnings.runs) add(`innings total is ${inningsRuns}, expected ${specInnings.runs}`);
    if (outCount !== specInnings.wickets) add(`batting card has ${outCount} dismissals, expected ${specInnings.wickets}`);
  }

  const bowling = raw.bowling.map((row) => ({ ...row }));
  for (const adjustment of options.adjustments || []) {
    const target = bowling.find(
      (row) => normalizeName(row.name) === normalizeName(adjustment.bowler),
    );
    if (!target) {
      add(`adjustment target bowler "${adjustment.bowler}" not found`);
    } else {
      target.rawWickets = target.wickets;
      target.wickets = adjustment.setWickets;
      target.adjusted = true;
      target.adjustmentReason = adjustment.reason;
    }
  }
  const bowlingWickets = sum(bowling.map((row) => row.wickets));
  const expectedBowlingWickets = outCount - runOutCount;
  if (bowlingWickets !== expectedBowlingWickets) {
    add(
      `bowler wickets (${bowlingWickets}) + run outs (${runOutCount}) do not equal the ${outCount} dismissed batsmen (expected ${expectedBowlingWickets} bowler wickets)`,
    );
  }
  // The TOTAL BOWLING wicket cell sums the bowlers' wickets only; a run out is
  // not credited to a bowler. Compare it with the bowler wickets, while the
  // dismissed-batsmen check above still accounts for the run outs.
  if (bowlingTotal.wickets !== null && bowlingWickets !== bowlingTotal.wickets) {
    add(
      `bowler wickets (${bowlingWickets}) do not equal the TOTAL BOWLING cell (${bowlingTotal.wickets})`,
    );
  }

  const overs = readNumericOvers(bowlingTotal);
  const parsedOvers = parseOvers(overs.value ?? "");
  if (!parsedOvers.valid) add(`innings overs: ${parsedOvers.reason}`);
  if (specInnings && overs.value !== String(specInnings.overs)) {
    add(`innings overs are "${overs.value}", expected "${specInnings.overs}"`);
  }
  const bowlerBalls = [];
  for (const row of bowling) {
    const parsed = parseOvers(row.overs);
    if (!parsed.valid && row.overs !== "") add(`bowler ${row.name} overs: ${parsed.reason}`);
    if (parsed.valid) bowlerBalls.push(parsed.balls);
  }
  const summedBowlerBalls = sum(bowlerBalls);
  if (parsedOvers.valid && summedBowlerBalls !== parsedOvers.balls) {
    add(`bowler overs sum to ${Math.floor(summedBowlerBalls / 6)}.${summedBowlerBalls % 6} (${summedBowlerBalls} balls), but the innings is recorded as ${overs.value} (${parsedOvers.balls} balls)`);
  }
  if (bowlingTotal.overs !== null && parsedOvers.valid) {
    const totalParsed = parseOvers(String(bowlingTotal.overs));
    if (totalParsed.valid && totalParsed.balls !== parsedOvers.balls) {
      add(`TOTAL BOWLING overs (${bowlingTotal.overs}) disagree with the innings overs note (${overs.value})`);
    }
  }

  const runOutNotes = (raw.notes || []).filter((note) => /run\s*out/i.test(note.text));
  if (runOutNotes.length && !runOutCount) {
    warn(`scorebook note says "${runOutNotes.map((note) => note.text).join("; ")}", but no batting row is marked Run Out; no wicket adjustment was made`);
  }
  if (outCount + batting.filter((row) => !row.isOut).length > 11) {
    warn(`batting card lists more than 11 players`);
  }
  const notOutCount = batting.filter((row) => !row.isOut && !row.isRetiredHurt && !row.isRetired).length;
  if (notOutCount > 2 && outCount + notOutCount === 11) {
    warn(`batting card has ${notOutCount} not-out batsmen; the sheet does not say which (if any) retired hurt`);
  }
  const zeroBallNotOuts = batting.filter((row) => !row.isOut && row.balls === 0 && row.runs === 0);
  if (zeroBallNotOuts.length) {
    warn(`zero-ball not-out rows (${zeroBallNotOuts.map((row) => row.name).join(", ")}) were kept exactly as listed; they may be did-not-bat rows`);
  }

  const byes = Number.isFinite(inningsRuns) && Number.isFinite(bowlingRuns) ? inningsRuns - bowlingRuns : null;
  const widesAndNoBalls = byes !== null && Number.isFinite(extras) ? extras - byes : null;
  const model = {
    batting,
    bowling,
    runs: inningsRuns,
    wickets: outCount,
    overs: overs.value,
    extras: {
      wides: widesAndNoBalls,
      noBalls: 0,
      byes,
      legByes: 0,
      penalties: 0,
    },
    raw: {
      battingRuns,
      battingBalls: balls,
      extras,
      bowlingRuns,
      bowlingWickets,
      rawBowlingWickets,
      overs: overs.value,
      oversNote: overs.label,
      notes: raw.notes || [],
    },
  };
  return { errors, warnings, model };
}

// ---------------------------------------------------------------------------
// Name matching
// ---------------------------------------------------------------------------

function teamLabelSet(teamName) {
  const normalized = normalizeName(teamName);
  const entry = TOURNAMENT_TEAMS.find((team) =>
    team.aliases.some((alias) => normalizeName(alias) === normalized),
  );
  return new Set((entry ? entry.aliases : [teamName]).map(normalizeName));
}

/**
 * Resolve a team label from an innings title ("ORANGI SPORTS", "Khan
 * Associates") to one of the resolved tournament team entries. Matching is
 * alias-aware and case/punctuation insensitive; ambiguity is never guessed.
 */
export function teamEntryForLabel(teams, label) {
  const normalized = normalizeTeamLabel(label);
  if (!normalized) return { entry: null, reason: "blank team label", matches: [] };
  const matches = (teams || []).filter((entry) =>
    [...(entry.aliases || []), entry.name]
      .filter(Boolean)
      .some((alias) => normalizeTeamLabel(alias) === normalized),
  );
  if (matches.length === 1) return { entry: matches[0], reason: "", matches };
  if (matches.length > 1) {
    return {
      entry: null,
      reason: `team label "${label}" is ambiguous between ${matches.map((row) => row.name).join(", ")}`,
      matches,
    };
  }
  return { entry: null, reason: `team label "${label}" does not match a tournament team`, matches: [] };
}

export function mappingFor(mapping, teamName, sheetName) {
  if (!mapping) return null;
  const teamLabels = teamLabelSet(teamName);
  const normalizedSheet = normalizeName(sheetName);
  let fallback = null;
  for (const [rawKey, value] of Object.entries(mapping)) {
    if (rawKey.startsWith("_")) continue;
    if (rawKey.includes("::")) {
      const [rawTeam, ...rest] = rawKey.split("::");
      if (teamLabels.has(normalizeName(rawTeam)) && normalizeName(rest.join("::")) === normalizedSheet) {
        return value;
      }
    } else if (rawKey === sheetName || normalizeName(rawKey) === normalizedSheet) {
      fallback = value;
    }
  }
  return fallback;
}

/**
 * Find every workbook row whose team-scoped mapping value is CREATE:<name>.
 * The result is de-duplicated by team + name, so "Sky Sports::Ali" used in the
 * batting and bowling rows produces a single placeholder player. This is a pure
 * read: it never creates anything.
 */
export function collectCreateSpecs({ parsed, teams, mapping, matches = null }) {
  const specs = new Map();
  const errors = [];
  const sheets = matches || groupSheetsByMatch(parsed?.sheets || []);
  for (const sheet of sheets) {
    const stageLabel = stageLabelForMatch(sheet.matchNumber);
    for (let index = 0; index < 2; index += 1) {
      const raw = sheet.innings?.[index];
      if (!raw) continue;
      const batting = teamEntryForLabel(teams, raw.battingTeam).entry;
      const bowling = teamEntryForLabel(teams, raw.bowlingTeam).entry;
      if (!batting?.team || !bowling?.team) continue;
      for (const [role, rows, squadTeam] of [
        ["batting", raw.batting || [], batting],
        ["bowling", raw.bowling || [], bowling],
      ]) {
        for (const row of rows) {
          const create = parseCreateMappingValue(mappingFor(mapping, squadTeam.name, row.name));
          if (!create) continue;
          if (create.error) {
            errors.push(
              `${stageLabel} innings ${index + 1} ${role} "${row.name}" (${squadTeam.name}, row ${row.row}): ${create.error}`,
            );
            continue;
          }
          const key = `${String(squadTeam.team._id)}::${normalizeName(create.name)}`;
          if (!specs.has(key)) {
            specs.set(key, {
              teamId: String(squadTeam.team._id),
              teamName: squadTeam.name,
              name: create.name,
              rows: [],
            });
          }
          specs.get(key).rows.push({
            matchNumber: sheet.matchNumber,
            innings: index + 1,
            role,
            team: squadTeam.name,
            sheetName: row.name,
            row: row.row,
          });
        }
      }
    }
  }
  return { specs: [...specs.values()], errors };
}

/** Keep CREATE: placeholders that belong to a match this run will actually create. */
export function createSpecsForPlan(specs, plan) {
  const createNumbers = new Set(
    (plan?.matches || []).filter((match) => match.action === "create").map((match) => match.spec.number),
  );
  return (specs || []).filter((spec) => (spec.rows || []).some((row) => createNumbers.has(row.matchNumber)));
}

function candidateForMapping(value, squad) {
  if (value && typeof value === "object") {
    if (value.playerId) value = value.playerId;
    else if (value.name) value = value.name;
  }
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (isObjectId(text)) {
    const player = squad.find((row) => String(row._id) === text);
    return player ? { player, reason: "mapping id" } : { error: `mapping id ${text} is not in the squad` };
  }
  const exact = squad.filter((row) => normalizeName(row.name) === normalizeName(text));
  if (exact.length === 1) return { player: exact[0], reason: "mapping name" };
  if (exact.length > 1) return { error: `mapping name "${text}" is ambiguous in the squad` };
  return { error: `mapping name "${text}" is not in the squad` };
}

export function matchPlayerName(squad, sheetName, options = {}) {
  const name = String(sheetName || "").trim();
  // A blank scorebook name (for example an unnamed bowler row) can still be
  // resolved by an explicit mapping entry, such as "Team::?" -> player id/name.
  const mapped = candidateForMapping(options.mappingValue, squad);
  if (mapped) {
    if (mapped.error) return { status: "error", reason: mapped.error, candidates: [] };
    return { status: "matched", player: mapped.player, score: 100, reason: mapped.reason, candidates: [] };
  }
  if (!name) return { status: "unresolved", reason: "blank name", candidates: [] };

  const target = normalizeName(name);
  if (!target) return { status: "unresolved", reason: "blank name", candidates: [] };
  const targetTokens = nameTokens(name);
  const ordinalMatch = target.match(/^(.*?)(?:\s+)(\d+)$/);
  const baseTarget = ordinalMatch ? ordinalMatch[1] : target;
  const baseTokens = ordinalMatch ? nameTokens(baseTarget) : targetTokens;
  const ordinal = ordinalMatch ? Number(ordinalMatch[2]) : null;

  // "Salman 2" style names: the trailing number disambiguates two squad
  // players who share a base name. Resolve against the squad directly, accept
  // the explicitly marked JR / II / (2) row, and never guess between the rest.
  if (ordinal !== null) {
    const baseMatches = squad.filter((player) => {
      const candidateTokens = nameTokens(player.name);
      return baseTokens.length > 0 && baseTokens.every((token) => candidateTokens.includes(token));
    });
    const baseCandidates = baseMatches.map((player) => ({ name: player.name, score: 90, reason: "base name" }));
    if (baseMatches.length === 1) {
      return {
        status: "matched",
        player: baseMatches[0],
        score: 88,
        reason: `ordinal ${ordinal} with the only base-name match`,
        candidates: baseCandidates,
      };
    }
    if (baseMatches.length > 1) {
      const marked = baseMatches.filter((player) =>
        /(?:^|\s)(?:jr|ii|2)$/.test(normalizeName(player.name)),
      );
      if (marked.length === 1) {
        return {
          status: "matched",
          player: marked[0],
          score: 92,
          reason: `ordinal ${ordinal} matches the marked second player`,
          candidates: baseCandidates,
        };
      }
      return {
        status: "unresolved",
        reason: `ambiguous base name "${baseTarget}" between ${baseMatches.map((player) => player.name).join(", ")}`,
        candidates: baseCandidates,
      };
    }
  }

  const scored = [];
  for (const player of squad) {
    const candidate = normalizeName(player.name);
    const candidateTokens = nameTokens(player.name);
    let score = 0;
    let reason = "";

    if (candidate === target) {
      score = 100;
      reason = "exact name";
    }

    if (!score && targetTokens.length) {
      const targetSubset = targetTokens.every((token) => candidateTokens.includes(token));
      const candidateSubset = candidateTokens.every((token) => targetTokens.includes(token));
      if (targetSubset || candidateSubset) {
        score = 90;
        reason = "unique name token";
      }
    }

    if (!score && !hasDifferingHonorific(name, player.name) && Math.min(target.length, candidate.length) >= 5) {
      const distance = levenshtein(target, candidate);
      if (distance <= 1) {
        score = 86;
        reason = `one-letter spelling variant (${distance})`;
      }
    }

    if (!score && baseTokens.length && candidateTokens.length) {
      const used = new Set();
      let exact = 0;
      let fuzzy = 0;
      let allMatched = true;
      for (const token of baseTokens) {
        let found = candidateTokens.findIndex((candidateToken, index) => !used.has(index) && candidateToken === token);
        if (found !== -1) {
          used.add(found);
          exact += 1;
          continue;
        }
        found = candidateTokens.findIndex(
          (candidateToken, index) =>
            !used.has(index) && token.length >= 4 && candidateToken.length >= 4 && levenshtein(token, candidateToken) <= 1,
        );
        if (found !== -1) {
          used.add(found);
          fuzzy += 1;
          continue;
        }
        allMatched = false;
        break;
      }
      if (allMatched && used.size === candidateTokens.length && (exact > 0 || fuzzy > 0)) {
        score = exact === baseTokens.length ? 82 : 78;
        reason = fuzzy ? "first-name/nickname token variant" : "name token";
        if (hasDifferingHonorific(name, player.name)) score = 0;
      }
    }

    // A one-word scorebook name ("Hasan", "Huzayfa", "Amjid", "Ejaz") can only
    // match one token of a longer squad name. Accept it only when exactly one
    // token in the whole squad is an exact or one-letter match, so a common
    // first name that occurs twice stays ambiguous.
    if (!score && ordinal === null && targetTokens.length === 1) {
      const token = targetTokens[0];
      if (token.length >= 4) {
        const tokenHits = candidateTokens.filter(
          (candidateToken) =>
            candidateToken.length >= 4 &&
            (candidateToken === token || levenshtein(token, candidateToken) <= 1),
        );
        if (tokenHits.length === 1 && !hasDifferingHonorific(name, player.name)) {
          score = 80;
          reason = tokenHits[0] === token ? "unique squad first name" : "one-letter squad first-name variant";
        }
      }
    }

    if (score) scored.push({ player, score, reason });
  }

  scored.sort((a, b) => b.score - a.score);
  const bestScore = scored[0]?.score || 0;
  const best = scored.filter((row) => row.score === bestScore);
  const candidates = scored.slice(0, 4).map((row) => ({ name: row.player.name, score: row.score, reason: row.reason }));
  if (bestScore >= 78 && best.length === 1) {
    return { status: "matched", player: best[0].player, score: bestScore, reason: best[0].reason, candidates };
  }
  if (best.length > 1) {
    return {
      status: "unresolved",
      reason: `ambiguous between ${best.map((row) => row.player.name).join(", ")}`,
      candidates,
    };
  }
  return { status: "unresolved", reason: "no high-confidence squad match", candidates };
}

// ---------------------------------------------------------------------------
// Database context and plan
// ---------------------------------------------------------------------------

function loadMappingFile() {
  if (!fs.existsSync(MAPPING_FILE)) return { file: MAPPING_FILE, exists: false, mapping: null };
  try {
    const parsed = JSON.parse(fs.readFileSync(MAPPING_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("the top level must be a JSON object");
    }
    return { file: MAPPING_FILE, exists: true, mapping: parsed };
  } catch (error) {
    throw new Error(`Could not read ${MAPPING_FILE}: ${error.message}`);
  }
}

async function resolveTeamAliases(aliases) {
  const queries = aliases.map((name) => ({
    name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
  }));
  const teams = await Team.find({ $or: queries })
    .select("name shortName organization organizationRef players isPublic")
    .lean();
  if (teams.length === 1) return { team: teams[0], ambiguous: [] };
  if (teams.length > 1) {
    return {
      team: null,
      ambiguous: teams.map((team) => ({
        id: String(team._id),
        name: team.name,
        organization: team.organization || "",
      })),
    };
  }
  return { team: null, ambiguous: [] };
}

async function resolveTournamentTeams() {
  const resolved = [];
  for (const entry of TOURNAMENT_TEAMS) {
    const result = await resolveTeamAliases(entry.aliases);
    resolved.push({ ...entry, ...result });
  }
  return resolved;
}

async function loadSquad(team) {
  const rosterIds = (team.players || []).map(idOf).filter(Boolean);
  let players = rosterIds.length
    ? await Player.find({ _id: { $in: rosterIds } }).select("name team").lean()
    : [];
  let source = "Team.players";
  let warning = "";
  if (!players.length) {
    players = await Player.find({ team: team._id }).select("name team").lean();
    source = "Player.team fallback";
    if (players.length) warning = "Team.players is empty; used Player.team roster instead";
  } else {
    const byId = new Map(players.map((player) => [String(player._id), player]));
    const missing = rosterIds.filter((id) => !byId.has(id));
    if (missing.length) {
      warning = `${missing.length} Team.players id(s) have no Player document and were ignored`;
    }
  }
  return {
    source,
    warning,
    players: players
      .filter((player) => player && player.name)
      .map((player) => ({ _id: String(player._id), name: player.name }))
      .sort((a, b) => normalizeName(a.name).localeCompare(normalizeName(b.name))),
  };
}

/**
 * Create the explicitly listed CREATE: placeholders, or reuse an existing player
 * with the same name in that team. `dryRun` performs only reads. New players are
 * intentionally minimal: name + team + blank role; no photo, creator, captain or
 * vice-captain. The player is attached to Team.players and Player.team, exactly
 * like the rest of the squad.
 */
export async function ensurePlaceholderPlayers(specs, { dryRun = false } = {}) {
  const result = { wouldCreate: [], created: [], reused: [], errors: [] };
  const unique = new Map();
  for (const spec of specs || []) {
    if (!spec?.teamId || !spec?.name) {
      result.errors.push(`invalid placeholder spec: ${JSON.stringify(spec)}`);
      continue;
    }
    const key = `${spec.teamId}::${normalizeName(spec.name)}`;
    if (!unique.has(key)) unique.set(key, spec);
  }

  for (const spec of unique.values()) {
    const team = await Team.findById(spec.teamId).select("name players").lean();
    if (!team) {
      result.errors.push(`team ${spec.teamName || spec.teamId} was not found`);
      continue;
    }
    const rosterIds = (team.players || []).map(idOf).filter(Boolean);
    const candidates = await Player.find({
      $or: [
        { team: team._id },
        ...(rosterIds.length ? [{ _id: { $in: rosterIds } }] : []),
      ],
    })
      .select("name team")
      .lean();
    const existing = candidates.find(
      (player) => normalizeName(player.name) === normalizeName(spec.name),
    );
    if (existing) {
      if (!dryRun && !rosterIds.includes(String(existing._id))) {
        await Team.updateOne({ _id: team._id }, { $addToSet: { players: existing._id } });
      }
      result.reused.push({ id: String(existing._id), name: existing.name, team: team.name });
      continue;
    }
    if (dryRun) {
      result.wouldCreate.push({ name: spec.name, team: team.name, teamId: String(team._id) });
      continue;
    }
    const player = await Player.create({ name: spec.name, team: team._id, role: "" });
    await Team.updateOne({ _id: team._id }, { $addToSet: { players: player._id } });
    result.created.push({ id: String(player._id), name: player.name, team: team.name });
  }
  return result;
}

function teamLabelMatches(label, teamSpec) {
  const normalized = normalizeTeamLabel(label);
  return [teamSpec.name, ...(teamSpec.aliases || [])]
    .filter(Boolean)
    .some((alias) => normalizeTeamLabel(alias) === normalized);
}

function deriveMatchResult(matchPlan) {
  const first = matchPlan.innings[0];
  const second = matchPlan.innings[1];
  const firstModel = first?.validation?.model;
  const secondModel = second?.validation?.model;
  if (!firstModel || !secondModel) return null;
  if (firstModel.runs === secondModel.runs) {
    return { winner: null, winnerName: null, margin: "", note: "Match tied.", resultType: "tie" };
  }
  if (secondModel.runs > firstModel.runs) {
    const wickets = Math.max(0, 10 - secondModel.wickets);
    const margin = `${wickets} wicket${wickets === 1 ? "" : "s"}`;
    return {
      winner: second.battingTeam,
      winnerName: second.battingTeam.name,
      margin,
      note: `${second.battingTeam.name} won by ${margin}.`,
      resultType: "normal",
    };
  }
  const runs = firstModel.runs - secondModel.runs;
  const margin = `${runs} run${runs === 1 ? "" : "s"}`;
  return {
    winner: first.battingTeam,
    winnerName: first.battingTeam.name,
    margin,
    note: `${first.battingTeam.name} won by ${margin}.`,
    resultType: "normal",
  };
}

function buildMatchPlan(sheet, context) {
  const { tournament, teams, squadByTeam, mapping, existingMatches } = context;
  const expectation = MATCH_EXPECTATIONS[sheet.matchNumber] || null;
  const stageLabel = stageLabelForMatch(sheet.matchNumber);
  const plan = {
    spec: {
      number: sheet.matchNumber,
      stageLabel,
      date: "",
      innings: expectation?.innings || [],
      result: expectation?.result || null,
      teamA: null,
      teamB: null,
    },
    sheet,
    teamA: null,
    teamB: null,
    innings: [],
    unresolved: [],
    errors: [],
    warnings: [],
    action: "create",
    existingMatch: null,
    payload: null,
    validator: null,
    result: null,
  };
  if (sheet.innings.length !== 2) {
    plan.errors.push(`sheet "${sheet.sheetName}" has ${sheet.innings.length} innings; expected 2`);
    plan.action = "blocked";
    return plan;
  }
  const [first, second] = sheet.innings;
  const teamALookup = teamEntryForLabel(teams, first.battingTeam);
  const teamBLookup = teamEntryForLabel(teams, first.bowlingTeam);
  if (!teamALookup.entry?.team) {
    plan.errors.push(teamALookup.reason || "first-innings batting team could not be resolved");
    plan.action = "blocked";
    return plan;
  }
  if (!teamBLookup.entry?.team) {
    plan.errors.push(teamBLookup.reason || "first-innings bowling team could not be resolved");
    plan.action = "blocked";
    return plan;
  }
  plan.teamA = teamALookup.entry.team;
  plan.teamB = teamBLookup.entry.team;
  plan.spec.teamA = { name: teamALookup.entry.name, aliases: teamALookup.entry.aliases || [] };
  plan.spec.teamB = { name: teamBLookup.entry.name, aliases: teamBLookup.entry.aliases || [] };

  const parsedDate = sheet.matchDate ? isoDate(sheet.matchDate) : "";
  if (!parsedDate) plan.errors.push(`sheet title "${sheet.title}" does not contain a match date`);
  if (expectation?.date && parsedDate && parsedDate !== expectation.date) {
    plan.errors.push(`sheet date ${parsedDate} does not match the expected ${expectation.date}`);
  }
  plan.spec.date = parsedDate || expectation?.date || "";
  if (!teamLabelMatches(second.battingTeam, plan.spec.teamB)) {
    plan.errors.push(
      `second-innings batting label "${second.battingTeam}" does not match the first-innings bowling team "${teamBLookup.entry.name}"`,
    );
  }
  if (!teamLabelMatches(second.bowlingTeam, plan.spec.teamA)) {
    plan.errors.push(
      `second-innings bowling label "${second.bowlingTeam}" does not match the first-innings batting team "${teamALookup.entry.name}"`,
    );
  }

  if (tournament) attachExistingMatchState(plan, existingMatches);
  if (plan.action !== "create") {
    if (plan.errors.length) plan.action = "blocked";
    return plan;
  }

  for (let index = 0; index < 2; index += 1) {
    const raw = sheet.innings[index];
    const battingLookup = teamEntryForLabel(teams, raw.battingTeam);
    const bowlingLookup = teamEntryForLabel(teams, raw.bowlingTeam);
    const team = battingLookup.entry?.team || null;
    const opponent = bowlingLookup.entry?.team || null;
    const inningsPlan = {
      index: index + 1,
      battingTeam: team,
      bowlingTeam: opponent,
      raw,
      mapping: [],
      validation: null,
      errors: [],
      warnings: [],
    };
    if (!team || !opponent) {
      inningsPlan.errors.push(
        `innings ${index + 1} has an unresolved team label ("${raw.battingTeam}" vs "${raw.bowlingTeam}")`,
      );
      plan.innings.push(inningsPlan);
      plan.errors.push(...inningsPlan.errors);
      continue;
    }
    const expectedBatting = index === 0 ? plan.spec.teamA : plan.spec.teamB;
    const expectedBowling = index === 0 ? plan.spec.teamB : plan.spec.teamA;
    if (!teamLabelMatches(raw.battingTeam, expectedBatting)) {
      inningsPlan.errors.push(
        `sheet batting label "${raw.battingTeam}" does not match the expected batting team "${expectedBatting.name}"; refusing to assign the innings to the wrong team`,
      );
    }
    if (!teamLabelMatches(raw.bowlingTeam, expectedBowling)) {
      inningsPlan.errors.push(
        `sheet bowling label "${raw.bowlingTeam}" does not match the expected bowling team "${expectedBowling.name}"; refusing to assign the innings to the wrong team`,
      );
    }
    const battingSquad = squadByTeam.get(String(team._id)) || { players: [], source: "", warning: "" };
    const bowlingSquad = squadByTeam.get(String(opponent._id)) || { players: [], source: "", warning: "" };
    if (!battingSquad.players.length) inningsPlan.errors.push(`batting squad for ${team.name} is empty`);
    if (!bowlingSquad.players.length) inningsPlan.errors.push(`bowling squad for ${opponent.name} is empty`);

    const mapRows = (rows, squad, role) =>
      rows.map((row) => {
        const squadTeam = role === "batting" ? team : opponent;
        const mappingValue = mappingFor(mapping, squadTeam.name, row.name);
        const create = parseCreateMappingValue(mappingValue);
        if (create) {
          let match;
          if (create.error) {
            match = { status: "error", reason: create.error, candidates: [] };
          } else {
            let player = squad.players.find(
              (candidate) => normalizeName(candidate.name) === normalizeName(create.name),
            );
            if (!player) {
              // Dry-run/plan placeholder: a stable id lets the manual validator
              // exercise the full payload without writing a Player document.
              player = {
                _id: `${PLACEHOLDER_ID_PREFIX}${squadTeam._id}:${normalizeName(create.name)}`,
                name: create.name,
                placeholder: true,
              };
              squad.players.push(player);
            }
            match = {
              status: "matched",
              player,
              score: 100,
              reason: player.placeholder ? "mapping CREATE placeholder" : "mapping CREATE (existing player)",
              candidates: [],
            };
          }
          if (match.status !== "matched") {
            inningsPlan.errors.push(
              `${role} "${row.name}" (${squadTeam.name}, sheet row ${row.row}) is ${match.status.toUpperCase()}: ${match.reason}`,
            );
            plan.unresolved.push({
              matchNumber: sheet.matchNumber,
              innings: index + 1,
              role,
              team: squadTeam.name,
              sheetName: row.name,
              row: row.row,
              reason: match.reason,
              candidates: [],
            });
          }
          return { ...row, role, match };
        }
        if (typeof mappingValue === "string" && mappingValue.trim().toUpperCase() === "SKIP") {
          const match =
            role === "batting" && isSkippableBattingRow(row)
              ? { status: "skipped", reason: "mapping SKIP (did-not-bat row dropped)", candidates: [] }
              : {
                  status: "error",
                  reason:
                    role === "batting"
                      ? "mapping SKIP is only allowed for a DNB/0-ball/0-run batsman"
                      : "mapping SKIP is only allowed for a batting row",
                  candidates: [],
                };
          if (match.status !== "skipped") {
            inningsPlan.errors.push(
              `${role} "${row.name}" (${squadTeam.name}, sheet row ${row.row}) is ${match.status.toUpperCase()}: ${match.reason}`,
            );
            plan.unresolved.push({
              matchNumber: sheet.matchNumber,
              innings: index + 1,
              role,
              team: squadTeam.name,
              sheetName: row.name,
              row: row.row,
              reason: match.reason,
              candidates: [],
            });
          }
          return { ...row, role, match };
        }
        const match = matchPlayerName(squad.players, row.name, { mappingValue });
        const mapped = { ...row, role, match };
        if (match.status !== "matched") {
          inningsPlan.errors.push(
            `${role} "${row.name}" (${squadTeam.name}, sheet row ${row.row}) is ${match.status.toUpperCase()}: ${match.reason}`,
          );
          plan.unresolved.push({
            matchNumber: sheet.matchNumber,
            innings: index + 1,
            role,
            team: squadTeam.name,
            sheetName: row.name,
            row: row.row,
            reason: match.reason,
            candidates: match.candidates || [],
          });
        }
        return mapped;
      });
    inningsPlan.mapping = [
      ...mapRows(raw.batting || [], battingSquad, "batting"),
      ...mapRows(raw.bowling || [], bowlingSquad, "bowling"),
    ];
    const skippedRows = new Set(
      inningsPlan.mapping
        .filter((row) => row.role === "batting" && row.match.status === "skipped")
        .map((row) => row.row),
    );
    const validationRaw = skippedRows.size
      ? { ...raw, batting: (raw.batting || []).filter((row) => !skippedRows.has(row.row)) }
      : raw;

    const validation = validateInnings(validationRaw, plan.spec.innings[index] || null);
    inningsPlan.validation = validation;
    inningsPlan.errors.push(...validation.errors);
    inningsPlan.warnings.push(...validation.warnings);
    if (battingSquad.warning) inningsPlan.warnings.push(battingSquad.warning);
    if (bowlingSquad.warning) inningsPlan.warnings.push(bowlingSquad.warning);
    plan.innings.push(inningsPlan);
    plan.errors.push(...inningsPlan.errors);
    plan.warnings.push(...inningsPlan.warnings);
  }

  if (plan.errors.length) {
    plan.action = "blocked";
    return plan;
  }

  const derived = deriveMatchResult(plan);
  if (!derived) {
    plan.errors.push("could not derive a match result from the two validated innings");
    plan.action = "blocked";
    return plan;
  }
  if (plan.spec.result) {
    const expectedWinner = teamEntryForLabel(teams, plan.spec.result.winner);
    if (!expectedWinner.entry?.team) {
      plan.errors.push(`expected winner "${plan.spec.result.winner}" could not be resolved`);
    } else if (!derived.winner || String(derived.winner._id) !== String(expectedWinner.entry.team._id)) {
      plan.errors.push(
        `expected winner ${expectedWinner.entry.name}, but the scorecard totals give ${derived.winnerName || "no winner"}`,
      );
    } else if (normalizeName(derived.margin) !== normalizeName(plan.spec.result.margin)) {
      plan.errors.push(
        `expected margin "${plan.spec.result.margin}", but the scorecard totals give "${derived.margin}"`,
      );
    }
    plan.result = {
      winner: expectedWinner.entry?.team || null,
      winnerName: expectedWinner.entry?.name || plan.spec.result.winner,
      margin: plan.spec.result.margin,
      note: `${expectedWinner.entry?.name || plan.spec.result.winner} won by ${plan.spec.result.margin}.`,
      resultType: "normal",
    };
  } else {
    plan.result = derived;
  }
  if (plan.errors.length) plan.action = "blocked";
  return plan;
}

function buildPayload(matchPlan, tournament) {
  const { spec, teamA, teamB } = matchPlan;
  if (!teamA || !teamB) return null;
  const innings = matchPlan.innings.map((inningsPlan) => {
    const validation = inningsPlan.validation;
    const model = validation?.model;
    if (!model) return null;
    const mappedByRoleRow = new Map(
      (inningsPlan.mapping || []).map((row) => [`${row.role}:${row.row}`, row]),
    );
    const playerId = (role, row) => {
      const mapped = mappedByRoleRow.get(`${role}:${row.row}`);
      return mapped?.match?.status === "matched" ? String(mapped.match.player._id) : "";
    };
    return {
      team: String(inningsPlan.battingTeam._id),
      runs: model.runs,
      wickets: model.wickets,
      overs: String(model.overs ?? ""),
      extras: model.extras,
      batting: model.batting.map((row) => ({
        player: playerId("batting", row),
        runs: row.runs,
        balls: row.balls,
        fours: row.fours,
        sixes: row.sixes,
        isOut: row.isOut,
        isRetiredHurt: row.isRetiredHurt,
        isRetired: row.isRetired,
        dismissalType: row.dismissalType,
        dismissalText: "",
      })),
      bowling: model.bowling.map((row) => ({
        player: playerId("bowling", row),
        overs: String(row.overs ?? ""),
        maidens: 0,
        runs: row.runs,
        wickets: row.wickets,
      })),
      fallOfWickets: [],
    };
  });
  if (innings.some((row) => !row)) return null;
  const result = matchPlan.result;
  if (!result?.resultType) return null;
  if (result.resultType === "normal" && !result.winner) return null;
  return {
    tournamentId: tournament ? String(tournament._id) : "",
    stage: STAGE,
    stageLabel: spec.stageLabel,
    round: spec.stageLabel,
    teamA: String(teamA._id),
    teamB: String(teamB._id),
    startAt: new Date(`${spec.date}T00:00:00.000Z`).toISOString(),
    totalOvers: TOTAL_OVERS,
    venue: "",
    title: `${spec.stageLabel}: ${teamA.name} vs ${teamB.name}`,
    matchCategory: "Club",
    tossWinner: "",
    tossDecision: "",
    draft: true,
    innings,
    result: {
      resultType: result.resultType,
      winner: result.winner ? String(result.winner._id) : "",
      margin: result.margin || "",
      note: result.note || "",
    },
    manOfMatch: "",
  };
}

function runModelValidation(payload, teamIds, squadByTeam) {
  if (!payload) return { ok: false, errors: [{ path: "payload", message: "payload could not be built" }] };
  return validateManualScorecard(payload, {
    teamIds,
    totalOvers: TOTAL_OVERS,
    squadByTeam,
    requireComplete: true,
  });
}

function summarizeExistingMatches(matches, teamA, teamB) {
  const wanted = new Set([String(teamA?._id), String(teamB?._id)]);
  return matches.filter((match) => {
    const ids = new Set((match.teams || []).map(idOf));
    if (ids.size !== wanted.size) return false;
    for (const id of wanted) if (!ids.has(id)) return false;
    return true;
  });
}

function attachExistingMatchState(matchPlan, allMatches) {
  const { teamA, teamB, spec } = matchPlan;
  if (!teamA || !teamB) return;
  const samePair = summarizeExistingMatches(allMatches, teamA, teamB);
  const slotMatches = allMatches.filter(
    (match) =>
      String(match.stage || "") === STAGE &&
      String(match.stageLabel || match.round || "") === spec.stageLabel,
  );
  if (slotMatches.length > 1) {
    matchPlan.errors.push(`${slotMatches.length} matches already use ${spec.stageLabel}; refusing to guess which one to use`);
    matchPlan.action = "blocked";
    return;
  }
  if (slotMatches.length === 1) {
    const existing = slotMatches[0];
    matchPlan.existingMatch = existing;
    const ids = new Set((existing.teams || []).map(idOf));
    const sameTeams = ids.size === 2 && ids.has(String(teamA._id)) && ids.has(String(teamB._id));
    if (!sameTeams) {
      matchPlan.errors.push(
        `${spec.stageLabel} is already used by match ${existing._id} (${existing.title || "untitled"}), which is not ${teamA.name} vs ${teamB.name}`,
      );
      matchPlan.action = "blocked";
      return;
    }
    if (existing.source !== "manual") {
      matchPlan.errors.push(
        `${spec.stageLabel} already exists as a non-manual match ${existing._id}; refusing to create a duplicate manual scorecard`,
      );
      matchPlan.action = "blocked";
      return;
    }
    matchPlan.action = "skip";
    if (existing.manualDraft === true) {
      matchPlan.warnings.push(`already imported as draft ${existing._id}`);
    } else {
      matchPlan.warnings.push(`already imported as a non-draft manual match ${existing._id}; left untouched`);
    }
    return;
  }

  if (samePair.length > 1) {
    matchPlan.errors.push(`${samePair.length} matches already exist for this team pair; refusing to guess which one to use`);
    matchPlan.action = "blocked";
    return;
  }
  if (samePair.length === 1) {
    const existing = samePair[0];
    matchPlan.existingMatch = existing;
    matchPlan.warnings.push(
      `existing match ${existing._id} has no ${spec.stageLabel} stage label; treating the only match for this team pair as already imported`,
    );
    if (existing.source === "manual") {
      matchPlan.action = "skip";
      if (existing.manualDraft === true) {
        matchPlan.warnings.push(`already imported as draft ${existing._id}`);
      } else {
        matchPlan.warnings.push(`already imported as a non-draft manual match ${existing._id}; left untouched`);
      }
    } else {
      matchPlan.errors.push(
        `a non-manual match ${existing._id} already exists for this team pair; refusing to create a duplicate manual scorecard`,
      );
      matchPlan.action = "blocked";
    }
  }
}

async function buildPlan(context) {
  const { parsed, tournament, teams, mapping, existingMatches } = context;
  const plan = { tournament, teams, matches: [], blockers: [], warnings: [], info: [], unresolved: [] };

  const squadByTeam = new Map();
  for (const entry of teams) {
    if (!entry.team) continue;
    squadByTeam.set(String(entry.team._id), await loadSquad(entry.team));
  }

  const sheets = groupSheetsByMatch(parsed.sheets || []);
  for (const sheet of sheets) {
    const matchPlan = buildMatchPlan(sheet, {
      tournament,
      teams,
      squadByTeam,
      mapping,
      existingMatches,
    });
    if (matchPlan.action === "create") {
      matchPlan.payload = buildPayload(matchPlan, tournament);
      if (!matchPlan.payload) {
        matchPlan.errors.push("could not build a manual-scorecard payload");
        matchPlan.action = "blocked";
      } else {
        const teamIds = [String(matchPlan.teamA._id), String(matchPlan.teamB._id)];
        const validator = runModelValidation(matchPlan.payload, teamIds, {
          [teamIds[0]]: (squadByTeam.get(teamIds[0])?.players || []).map((player) => String(player._id)),
          [teamIds[1]]: (squadByTeam.get(teamIds[1])?.players || []).map((player) => String(player._id)),
        });
        matchPlan.validator = validator;
        if (!validator.ok) {
          matchPlan.errors.push(
            ...validator.errors.map((error) => `manual validator ${error.path}: ${error.message}`),
          );
          matchPlan.action = "blocked";
        }
      }
    }
    const label = matchPlan.spec.stageLabel;
    if (matchPlan.errors.length) plan.blockers.push(...matchPlan.errors.map((error) => `${label}: ${error}`));
    plan.warnings.push(...matchPlan.warnings.map((warning) => `${label}: ${warning}`));
    plan.unresolved.push(...matchPlan.unresolved);
    plan.matches.push(matchPlan);
  }

  return plan;
}

function userTeamGaps(tournament, teams) {
  const existing = new Set((tournament?.teams || []).map(idOf));
  const missing = teams.filter((entry) => entry.team && !existing.has(String(entry.team._id)));
  return { existingCount: existing.size, missing };
}

function addEnvironmentChecks(plan, { tournament, resolvedTeams, platformSettings, requiredTeamNames = null }) {
  if (!tournament) {
    plan.blockers.push(`tournament "${TOURNAMENT_NAME}" was not found; this script never creates it`);
  } else {
    if (tournament.type !== "knockout") plan.blockers.push(`existing tournament type is "${tournament.type}", expected "knockout"`);
    if (tournament.format !== "T20") plan.blockers.push(`existing tournament format is "${tournament.format}", expected "T20"`);
  }
  if (!platformSettings.enableSuperSub) {
    plan.warnings.push(
      "the platform master switch enableSuperSub is OFF; the tournament rule will be ON but Super Sub is not effective until the platform setting is enabled",
    );
  }
  const required = requiredTeamNames ? resolvedTeams.filter((entry) => requiredTeamNames.has(entry.name)) : resolvedTeams;
  for (const entry of required) {
    if (!entry.team) {
      plan.blockers.push(
        entry.ambiguous.length
          ? `team ${entry.name} is ambiguous: ${entry.ambiguous.map((row) => `${row.name} ${row.id}`).join(", ")}`
          : `team ${entry.name} was not found; teams are never created by this script`,
      );
    }
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function formatCandidateList(candidates) {
  if (!candidates?.length) return "";
  return candidates
    .slice(0, 3)
    .map((candidate) => `${candidate.name} (${candidate.score})`)
    .join(", ");
}

function printPlan(plan, context, apply, placeholders = null) {
  console.log("");
  console.log("=== All Baldia T20 QF import =======================================");
  console.log(`  Mode            : ${apply ? "APPLY" : "DRY RUN (no writes)"}`);
  console.log(`  Workbook        : ${context.workbook.file}`);
  console.log(`  Workbook source : ${context.workbook.source}`);
  if (context.workbook.alternatives?.length) {
    console.log(`  Also found      : ${context.workbook.alternatives.join(", ")} (not used)`);
  }
  console.log(`  Sheets          : ${context.parsed.sheets.map((sheet) => sheet.sheetName).join(" | ")}`);
  console.log(`  Mapping file    : ${context.mapping.exists ? context.mapping.file : "(none)"}`);
  console.log(`  Database        : ${context.databaseName || "(unnamed)"}${context.forceTest ? " (test/e2e guard bypassed with --force-test)" : ""}`);
  console.log(`  Tournament      : ${plan.tournament ? `reuse ${plan.tournament._id}` : "MISSING"} "${TOURNAMENT_NAME}"`);
  console.log(
    `  Match dates     : ${plan.matches.map((row) => `${row.spec.stageLabel} ${row.spec.date || "?"}`).join(", ") || "(none)"} (00:00 UTC)`,
  );
  console.log(`  Format          : T20, knockout, 20 overs`);
  console.log(
    `  Super Sub rule  : ${
      plan.tournament
        ? `existing rules.twelfthManEnabled=${String(plan.tournament.rules?.twelfthManEnabled)}; --apply sets it ON`
        : "blocked: tournament must exist"
    }`,
  );
  console.log(`  Platform gate   : enableSuperSub=${context.platformSettings.enableSuperSub}`);
  console.log(`  Hard ball       : no Tournament/Match field; represented by the tournament name + T20 format`);
  if (placeholders && (placeholders.wouldCreate?.length || placeholders.created?.length || placeholders.reused?.length)) {
    console.log(`  Placeholders    :`);
    for (const row of placeholders.wouldCreate || []) {
      console.log(`    would create ${row.name} in ${row.team}`);
    }
    for (const row of placeholders.created || []) {
      console.log(`    created ${row.name} in ${row.team} -> ${row.id}`);
    }
    for (const row of placeholders.reused || []) {
      console.log(`    reused ${row.name} in ${row.team} -> ${row.id}`);
    }
  }

  const found = plan.teams.filter((entry) => entry.team).length;
  console.log(`  Teams           : ${found}/${plan.teams.length} resolved in the database`);
  for (const entry of plan.teams) {
    if (entry.team) {
      console.log(`    [team:ok] ${entry.name} -> ${entry.team._id} "${entry.team.name}"`);
    } else if (entry.ambiguous.length) {
      console.log(`    [team:AMBIGUOUS] ${entry.name}: ${entry.ambiguous.map((row) => `${row.name} (${row.organization || "no org"}) ${row.id}`).join(" | ")}`);
    } else {
      console.log(`    [team:MISSING] ${entry.name}`);
    }
  }
  if (plan.tournament) {
    const gaps = userTeamGaps(plan.tournament, plan.teams);
    console.log(`  Tournament teams: ${gaps.existingCount} present, ${gaps.missing.length} to add`);
    for (const gap of gaps.missing) console.log(`    + ${gap.name}`);
  }

  console.log("");
  console.log("CREATE/SKIP plan:");
  for (const matchPlan of plan.matches) {
    const { spec, teamA, teamB } = matchPlan;
    const pair = `${teamA?.name || spec.teamA?.name || "?"} vs ${teamB?.name || spec.teamB?.name || "?"}`;
    if (matchPlan.action === "create") {
      console.log(`  CREATE ${spec.stageLabel}  ${pair}  (${spec.date})`);
    } else if (matchPlan.action === "skip") {
      console.log(`  SKIP   ${spec.stageLabel}  ${pair}  (existing ${matchPlan.existingMatch?._id || "?"})`);
    } else {
      console.log(`  BLOCKED ${spec.stageLabel}  ${pair}`);
    }
  }

  console.log("");
  console.log("Validation table:");
  for (const matchPlan of plan.matches) {
    if (!matchPlan.innings.length) {
      console.log(`  ${matchPlan.spec.stageLabel}: not validated (${matchPlan.action.toUpperCase()})`);
      continue;
    }
    for (const inningsPlan of matchPlan.innings) {
      const model = inningsPlan.validation?.model;
      const raw = inningsPlan.raw;
      if (!model) {
        console.log(`  ${matchPlan.spec.stageLabel} innings ${inningsPlan.index}: FAIL (no model)`);
        continue;
      }
      const batting = model.raw.battingRuns;
      const extras = model.raw.extras;
      const total = model.runs;
      const bowling = model.raw.bowlingRuns;
      const byes = model.extras.byes;
      const status = inningsPlan.validation.errors.length ? "FAIL" : "OK";
      console.log(
        `  ${matchPlan.spec.stageLabel} innings ${inningsPlan.index}: batting ${batting} + extras ${extras} = ${total}; bowling ${bowling} + byes/leg-byes ${byes} = ${bowling + byes}; ${model.wickets} wickets; ${model.overs} overs — ${status}`,
      );
    }
  }

  console.log("");
  console.log("Matches:");
  for (const matchPlan of plan.matches) {
    const { spec, teamA, teamB } = matchPlan;
    console.log(`  ${spec.stageLabel}: ${teamA?.name || spec.teamA?.name} vs ${teamB?.name || spec.teamB?.name}`);
    console.log(`    date       : ${spec.date || "(missing)"}`);
    console.log(`    sheet      : ${matchPlan.sheet?.sheetName || "(missing)"}`);
    if (matchPlan.result) {
      console.log(`    result     : ${matchPlan.result.winnerName || "tie"} by ${matchPlan.result.margin || "n/a"}`);
    }
    if (matchPlan.existingMatch) {
      console.log(`    existing   : ${matchPlan.existingMatch._id} (source=${matchPlan.existingMatch.source || "live"}, draft=${matchPlan.existingMatch.manualDraft === true})`);
    }
    for (const inningsPlan of matchPlan.innings) {
      const model = inningsPlan.validation?.model;
      const raw = inningsPlan.raw;
      if (!raw) {
        console.log(`    innings ${inningsPlan.index}: MISSING`);
        continue;
      }
      const runs = model?.runs ?? raw.battingTotal?.runs ?? "?";
      const wickets = model?.wickets ?? "?";
      const overs = model?.overs ?? "?";
      console.log(`    innings ${inningsPlan.index}: ${inningsPlan.battingTeam?.name || "?"} ${runs}/${wickets} (${overs} ov) vs ${inningsPlan.bowlingTeam?.name || "?"}`);
      console.log(`      sheet totals: batting ${raw.battingTotal?.battingRuns ?? "?"} + extras ${raw.battingTotal?.extras ?? "?"} = ${raw.battingTotal?.runs ?? "?"}; bowling ${raw.bowlingTotal?.runs ?? "?"} runs, ${raw.bowlingTotal?.wickets ?? "?"} wkts, ${raw.bowlingTotal?.overs ?? "?"} ov`);
      if (model) {
        console.log(`      extras split: byes/leg-byes ${model.extras.byes} + combined wides/no-balls ${model.extras.wides} (noBalls stored as 0)`);
      }
      console.log("      mapping:");
      for (const row of inningsPlan.mapping) {
        const match = row.match;
        if (match.status === "matched") {
          console.log(`        [${row.role}] "${row.name}" -> ${match.player.name} (${match.score}: ${match.reason})`);
        } else if (match.status === "skipped") {
          console.log(`        [${row.role}] "${row.name}" -> SKIPPED (${match.reason})`);
        } else {
          console.log(`        [${row.role}] "${row.name}" -> ${match.status.toUpperCase()} — ${match.reason}`);
          const candidates = formatCandidateList(match.candidates);
          if (candidates) console.log(`                 closest: ${candidates}`);
        }
      }
      if (inningsPlan.validation?.errors?.length) {
        console.log("      validation: FAIL");
        for (const error of inningsPlan.validation.errors) console.log(`        - ${error}`);
      } else {
        console.log("      validation: OK (batting+extras and bowler runs+byes/leg-byes equal the innings total)");
      }
      for (const warning of inningsPlan.validation?.warnings || []) console.log(`      warning: ${warning}`);
    }
    if (matchPlan.validator) {
      if (matchPlan.validator.ok) {
        console.log("    manual validator: OK (players, duplicates, overs, totals)");
      } else {
        console.log("    manual validator: FAIL");
        for (const error of matchPlan.validator.errors) console.log(`      - ${error.path}: ${error.message}`);
      }
    }
    console.log(`    action     : ${matchPlan.action.toUpperCase()}`);
    if (matchPlan.action === "skip" && matchPlan.existingMatch) console.log(`    match id   : ${matchPlan.existingMatch._id}`);
    console.log("");
  }

  if (plan.unresolved.length) {
    console.log(`Unresolved names (${plan.unresolved.length}):`);
    for (const row of plan.unresolved) {
      console.log(`  - QF${row.matchNumber} innings ${row.innings} ${row.role} ${row.team} / "${row.sheetName}" (row ${row.row}) — ${row.reason}`);
      const candidates = formatCandidateList(row.candidates);
      if (candidates) console.log(`      closest: ${candidates}`);
    }
    console.log("");
  }
  if (plan.warnings.length) {
    console.log(`Warnings (${plan.warnings.length}):`);
    for (const warning of plan.warnings) console.log(`  - ${warning}`);
    console.log("");
  }
  if (plan.blockers.length) {
    console.log(`BLOCKERS (${plan.blockers.length}) — --apply would refuse:`);
    for (const blocker of plan.blockers) console.log(`  - ${blocker}`);
    console.log("");
  } else {
    console.log("No blockers. --apply would write the DRAFT match(es) marked CREATE; SKIP rows are left untouched.");
    console.log("");
  }
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

async function applyPlan(plan, context) {
  if (plan.blockers.length) {
    throw new Error(`${plan.blockers.length} blocker(s) found; refusing --apply. Fix the data/mapping first.`);
  }
  if (!plan.tournament) {
    throw new Error(`tournament "${TOURNAMENT_NAME}" was not found; this script never creates it`);
  }
  let tournament = plan.tournament;
  const created = { tournamentId: String(tournament._id), matchIds: [] };
  const addTeams = userTeamGaps(tournament, plan.teams).missing.map((entry) => entry.team._id);
  const update = {};
  if (addTeams.length) update.$addToSet = { teams: { $each: addTeams } };
  if (tournament.rules?.twelfthManEnabled !== true) {
    update.$set = { "rules.twelfthManEnabled": true };
  }
  if (Object.keys(update).length) {
    await Tournament.updateOne({ _id: tournament._id }, update);
    console.log(`Updated tournament ${tournament._id} (teams added: ${addTeams.length}, Super Sub: ON)`);
  } else {
    console.log(`Reusing tournament ${tournament._id} (no gaps)`);
  }
  tournament = await Tournament.findById(tournament._id);

  for (const matchPlan of plan.matches) {
    if (matchPlan.payload) matchPlan.payload.tournamentId = String(tournament._id);
  }

  for (const matchPlan of plan.matches) {
    if (matchPlan.action === "skip") {
      const existingId = matchPlan.existingMatch._id;
      const alreadyLinked = (tournament.matches || []).some((id) => String(id) === String(existingId));
      if (!alreadyLinked) {
        await Tournament.updateOne({ _id: tournament._id }, { $addToSet: { matches: existingId } });
        console.log(`Linked existing match ${existingId} into tournament ${tournament._id}`);
      }
      console.log(`Skipped ${matchPlan.spec.stageLabel}: existing match ${existingId}`);
      continue;
    }
    if (matchPlan.action !== "create") {
      throw new Error(`${matchPlan.spec.stageLabel} is not in a creatable state (${matchPlan.action})`);
    }
    const req = {
      body: matchPlan.payload,
      params: {},
      query: {},
      headers: {},
      ip: "",
      user: null,
    };
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };
    await createManualMatch(req, res);
    if (res.statusCode !== 201 || !res.body?.match) {
      const detail = res.body?.errorLines?.join("; ") || res.body?.message || `HTTP ${res.statusCode}`;
      throw new Error(`${matchPlan.spec.stageLabel} create failed: ${detail}`);
    }
    const match = res.body.match;
    if (match.source !== "manual" || match.manualDraft !== true || match.status !== "upcoming") {
      throw new Error(`${matchPlan.spec.stageLabel} created with unexpected state source=${match.source} draft=${match.manualDraft} status=${match.status}`);
    }
    if ((match.innings || []).some((innings) => innings.status !== "upcoming")) {
      throw new Error(`${matchPlan.spec.stageLabel} created with an innings that is not upcoming`);
    }
    created.matchIds.push(String(match._id));
    console.log(`Created ${matchPlan.spec.stageLabel} draft ${match._id}`);
  }
  return created;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function main(argv = process.argv) {
  const apply = argv.includes("--apply");
  const forceTest = argv.includes("--force-test");
  if (apply && argv.includes("--dry-run")) {
    throw new Error("Pass either --apply or --dry-run, not both.");
  }
  const uri = process.env.MONGO_URL;
  if (!uri) throw new Error("MONGO_URL is not set. The script does not print or accept the URI on the command line.");
  const { databaseName } = getMongoTarget(uri);
  if (!databaseName) throw new Error("MONGO_URL has no database name.");
  const isTestTarget = process.env.NODE_ENV === "test" || /e2e/i.test(databaseName);
  if (isTestTarget && !forceTest) {
    throw new Error(
      `Refusing a test/e2e database (${databaseName}${process.env.NODE_ENV === "test" ? ", NODE_ENV=test" : ""}). Pass --force-test only for a throwaway local database.`,
    );
  }

  const workbookInfo = findWorkbook(argValue("--file"));
  const mapping = loadMappingFile();
  const buffer = fs.readFileSync(workbookInfo.file);
  const parsed = parseScorecardWorkbook(buffer);
  if (parsed.sheets.length < 1) {
    throw new Error(`Expected at least 1 match sheet, found ${parsed.sheets.length}: ${parsed.sheets.map((sheet) => sheet.sheetName).join(", ") || "none"}`);
  }
  parsed.sheets = groupSheetsByMatch(parsed.sheets);

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });
  try {
    const resolvedTeams = await resolveTournamentTeams();
    const existingTournamentRows = await Tournament.find({
      name: { $regex: `^${escapeRegex(TOURNAMENT_NAME)}$`, $options: "i" },
    });
    if (existingTournamentRows.length > 1) {
      throw new Error(`${existingTournamentRows.length} tournaments match "${TOURNAMENT_NAME}"; refusing to guess which one to reuse`);
    }
    const tournament = existingTournamentRows[0] || null;
    if (!tournament) {
      throw new Error(`tournament "${TOURNAMENT_NAME}" was not found in ${databaseName}; aborting because this script never creates it`);
    }
    let existingMatches = [];
    if (tournament) {
      existingMatches = await Match.find({
        $or: [{ tournament: tournament._id }, { _id: { $in: tournament.matches || [] } }],
      })
        .select("title teams stage stageLabel round source manualDraft status startAt")
        .lean();
    }
    const platformRow = await SystemSettings.findOne({ key: "platform" }).lean();
    const platformSettings = {
      enableSuperSub: platformRow?.value?.enableSuperSub === true,
    };
    const requiredTeamNames = new Set();
    for (const sheet of parsed.sheets) {
      for (const innings of sheet.innings || []) {
        for (const label of [innings.battingTeam, innings.bowlingTeam]) {
          const entry = teamEntryForLabel(resolvedTeams, label).entry;
          if (entry) requiredTeamNames.add(entry.name);
        }
      }
    }
    const context = {
      workbook: workbookInfo,
      parsed,
      mapping,
      databaseName,
      forceTest,
      platformSettings,
    };
    const createPlan = collectCreateSpecs({
      parsed,
      teams: resolvedTeams,
      mapping: mapping.mapping,
    });
    let plan = await buildPlan({
      parsed,
      tournament,
      teams: resolvedTeams,
      mapping: mapping.mapping,
      existingMatches,
    });
    plan.blockers.push(...createPlan.errors);
    addEnvironmentChecks(plan, { tournament, resolvedTeams, platformSettings, requiredTeamNames });

    if (!apply) {
      // Explicit CREATE: mappings are only read here; nothing is written.
      const placeholders = await ensurePlaceholderPlayers(createSpecsForPlan(createPlan.specs, plan), { dryRun: true });
      plan.blockers.push(...placeholders.errors);
      printPlan(plan, context, false, placeholders);
      console.log("Dry run complete. Nothing was written.");
      if (plan.blockers.length) {
        console.log(`${plan.blockers.length} blocker(s) would prevent --apply.`);
      }
      return { apply: false, plan, created: null, placeholders };
    }

    // --apply: never write placeholder players for a plan that is already blocked.
    if (plan.blockers.length) {
      printPlan(plan, context, true);
      throw new Error(
        `${plan.blockers.length} blocker(s) found; refusing --apply. No placeholder players were created.`,
      );
    }

    const placeholders = await ensurePlaceholderPlayers(createSpecsForPlan(createPlan.specs, plan), { dryRun: false });
    if (placeholders.errors.length) {
      throw new Error(`could not ensure placeholder players: ${placeholders.errors.join("; ")}`);
    }
    if (placeholders.created.length || placeholders.reused.length) {
      // Real ids now exist, so rebuild the plan against the refreshed squads.
      const refreshedTeams = await resolveTournamentTeams();
      plan = await buildPlan({
        parsed,
        tournament,
        teams: refreshedTeams,
        mapping: mapping.mapping,
        existingMatches,
      });
      plan.blockers.push(...createPlan.errors);
      addEnvironmentChecks(plan, {
        tournament,
        resolvedTeams: refreshedTeams,
        platformSettings,
        requiredTeamNames,
      });
      if (plan.blockers.length) {
        printPlan(plan, context, true, placeholders);
        throw new Error(
          `${plan.blockers.length} blocker(s) found after placeholder setup; refusing --apply.`,
        );
      }
    }

    printPlan(plan, context, true, placeholders);
    const created = await applyPlan(plan, context);
    console.log("");
    console.log("APPLIED (drafts only; nothing was published).");
    console.log(`  tournament: ${created.tournamentId || context.planTournamentId || "(reused)"}`);
    console.log(`  matches   : ${created.matchIds.join(", ") || "(none created)"}`);
    return { apply: true, plan, created };
  } finally {
    await mongoose.disconnect();
  }
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error("");
    console.error(`REFUSING TO RUN: ${error.message}`);
    process.exitCode = 1;
  });
}
