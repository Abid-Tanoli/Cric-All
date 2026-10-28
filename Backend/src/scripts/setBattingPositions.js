// Backfill Player.battingPosition from a small operator CSV.
//
//   node src/scripts/setBattingPositions.js --file positions.csv --uri <mongo-uri>              # dry run
//   node src/scripts/setBattingPositions.js --file positions.csv --uri <mongo-uri> --apply      # write
//   ... --force-test                                                                            # allow e2e/test DB
//
// CSV columns (header names are case-insensitive; `player_name` and
// `batting_position` are accepted as aliases):
//
//   team,player,battingPosition
//   "Northside Cricket Club XI",P001,opener
//   "Northside Cricket Club XI",P006,middle_order
//   "Riverside Cricket Club XI",64f0...c1a,clear
//
// `player` is a player name (matched exactly after NFKC + case-fold +
// whitespace-collapse, the same rule the squads importer and duplicate
// prevention use) or a 24-hex ObjectId. An id must belong to the named team.
// `battingPosition` is opener / middle_order / lower_order / tailender, or
// `clear` / `none` to remove a value. Anything else is refused; nothing is
// guessed.
//
// Safety:
//   * dry run by default; only --apply writes;
//   * the whole file is resolved and printed before any write, and one unknown
//     or ambiguous row blocks every write;
//   * refuses a non-loopback MongoDB host unless --allow-host is named;
//   * refuses a test/e2e database unless --force-test is passed;
//   * does not load .env and never prints the URI or credentials;
//   * only touches Player.battingPosition — roles, teams and stats are untouched.

import fs from "fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import mongoose from "mongoose";
import Player from "../models/Player.js";
import Team from "../models/Team.js";
import { normalizePlayerName } from "../services/playerService.js";
import { getMongoTarget } from "../utils/mongoTarget.js";
import { parseCsv } from "./importSquads.js";
import {
  BATTING_POSITIONS,
  normalizeBattingPosition,
} from "../constants/battingPositions.js";

mongoose.set("autoIndex", false);

const EXPECTED_DATABASE = "cric-all-e2e";
const COLUMNS = ["team", "player", "battingPosition"];
const VALUE_OPTIONS = new Set(["--file", "--uri", "--allow-host", "--allow-database"]);
const FLAG_OPTIONS = new Set(["--apply", "--dry-run", "--force-test"]);
const ALLOWED_OPTIONS = new Set([...VALUE_OPTIONS, ...FLAG_OPTIONS]);
const HEADER_ALIASES = {
  team: ["team"],
  player: ["player", "player_name", "name"],
  battingPosition: ["battingposition", "batting_position", "position"],
};
const CLEAR_VALUES = new Set(["clear", "none", "unset", ""]);

function argValue(flag, argv = process.argv) {
  const withEquals = argv.find((a) => a.startsWith(`${flag}=`));
  if (withEquals) return withEquals.slice(flag.length + 1);
  const index = argv.indexOf(flag);
  if (index !== -1 && argv[index + 1] && !argv[index + 1].startsWith("--")) {
    return argv[index + 1];
  }
  return undefined;
}

export function findUnknownOptions(args) {
  const unknown = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg : arg.slice(0, equals);
    const inlineValue = equals === -1 ? undefined : arg.slice(equals + 1);
    if (!ALLOWED_OPTIONS.has(name)) {
      unknown.push(arg);
      continue;
    }
    if (VALUE_OPTIONS.has(name)) {
      if (inlineValue !== undefined) {
        if (!inlineValue) unknown.push(arg);
      } else if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        i += 1; // value for this option, not an option itself
      }
    } else if (inlineValue !== undefined) {
      unknown.push(arg); // --apply=... / --force-test=... take no value
    }
  }
  return unknown;
}

export function isTestTarget(databaseName, nodeEnv = process.env.NODE_ENV) {
  const db = String(databaseName || "");
  return (
    nodeEnv === "test" ||
    /(^|[-_])e2e($|[-_])/i.test(db) ||
    /(^|[-_])test($|[-_])/i.test(db)
  );
}

function normalizeHeader(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_/g, "");
}

/**
 * Turn raw CSV rows into validated records. Throws before any database work
 * when the file itself is malformed.
 */
export function validateRows(rows) {
  if (!rows.length) throw new Error("The CSV is empty.");

  const header = rows[0].map(normalizeHeader);
  const index = {};
  const problems = [];
  for (const column of COLUMNS) {
    const at = header.findIndex((h) => HEADER_ALIASES[column].includes(h));
    if (at === -1) problems.push(`missing required column "${column}"`);
    index[column] = at;
  }
  const known = new Set(Object.values(HEADER_ALIASES).flat());
  header.forEach((h, i) => {
    if (h && !known.has(h)) problems.push(`unknown column "${rows[0][i]}" at position ${i + 1}`);
  });
  if (problems.length) throw new Error(`Invalid CSV header: ${problems.join("; ")}.`);

  const records = [];
  for (let r = 1; r < rows.length; r += 1) {
    const line = r + 1;
    const cells = rows[r];
    if (cells.length !== header.length) {
      problems.push(`line ${line}: expected ${header.length} columns, found ${cells.length}`);
      continue;
    }

    const team = String(cells[index.team] ?? "").trim();
    const player = String(cells[index.player] ?? "").trim();
    const rawPosition = String(cells[index.battingPosition] ?? "").trim();

    if (!team) problems.push(`line ${line}: empty team`);
    if (!player) problems.push(`line ${line}: empty player`);

    let position;
    if (!rawPosition) {
      problems.push(`line ${line}: empty battingPosition (use "clear" to unset)`);
    } else if (CLEAR_VALUES.has(rawPosition.toLowerCase())) {
      position = "";
    } else {
      position = normalizeBattingPosition(rawPosition);
      if (position === null) {
        problems.push(
          `line ${line}: unknown battingPosition "${rawPosition}" (allowed: ` +
            `${BATTING_POSITIONS.join(", ")}, clear)`,
        );
      }
    }

    records.push({ line, team, player, position });
  }

  if (problems.length) {
    throw new Error(`CSV validation failed with ${problems.length} problem(s):\n  - ${problems.join("\n  - ")}`);
  }
  return records;
}

/** Resolve every row against the database and build a no-write plan. */
export async function buildPlan(records) {
  const plan = { rows: [], errors: [] };
  const teams = await Team.find({}, { name: 1 }).lean();
  const teamsByName = new Map();
  for (const team of teams) {
    const key = normalizePlayerName(team.name);
    if (!teamsByName.has(key)) teamsByName.set(key, []);
    teamsByName.get(key).push(team);
  }

  for (const record of records) {
    const teamKey = normalizePlayerName(record.team);
    const matches = teamsByName.get(teamKey) || [];
    if (matches.length === 0) {
      plan.errors.push(`line ${record.line}: team "${record.team}" was not found`);
      continue;
    }
    if (matches.length > 1) {
      plan.errors.push(`line ${record.line}: team "${record.team}" is ambiguous (${matches.length} teams match)`);
      continue;
    }
    const team = matches[0];

    let player;
    if (mongoose.Types.ObjectId.isValid(record.player)) {
      player = await Player.findById(record.player).select("name team battingPosition").lean();
      if (!player) {
        plan.errors.push(`line ${record.line}: player id ${record.player} was not found`);
        continue;
      }
      if (String(player.team || "") !== String(team._id)) {
        plan.errors.push(
          `line ${record.line}: player "${player.name}" (${record.player}) is not in team "${team.name}"`,
        );
        continue;
      }
    } else {
      const roster = await Player.find({ team: team._id }).select("name battingPosition").lean();
      const wanted = normalizePlayerName(record.player);
      const named = roster.filter((candidate) => normalizePlayerName(candidate.name) === wanted);
      if (named.length === 0) {
        plan.errors.push(`line ${record.line}: player "${record.player}" was not found in team "${team.name}"`);
        continue;
      }
      if (named.length > 1) {
        plan.errors.push(
          `line ${record.line}: player "${record.player}" is ambiguous in team "${team.name}" (${named.length} matches)`,
        );
        continue;
      }
      player = named[0];
    }

    const current = player.battingPosition || "";
    const status = current === record.position ? "unchanged" : record.position ? "set" : "clear";
    plan.rows.push({
      line: record.line,
      team: team.name,
      teamId: team._id,
      player: player.name,
      playerId: player._id,
      position: record.position,
      current,
      status,
    });
  }

  return plan;
}

function printPlan(plan, apply) {
  const count = (status) => plan.rows.filter((row) => row.status === status).length;
  console.log("");
  console.log("=== batting positions backfill ====================================");
  console.log(`  Mode   : ${apply ? "APPLY (--apply)" : "DRY RUN (no writes)"}`);
  console.log(`  Rows   : ${plan.rows.length} resolved, ${count("set")} to set, ${count("clear")} to clear, ${count("unchanged")} unchanged`);
  console.log("");
  for (const row of plan.rows) {
    const change = row.status === "unchanged"
      ? `unchanged (${row.current || "not set"})`
      : `${row.current || "not set"} -> ${row.position || "not set"}`;
    console.log(`  [${row.status.toUpperCase()}] ${row.team} / ${row.player} (line ${row.line}) — ${change}`);
  }
  if (plan.errors.length) {
    console.log("");
    console.log(`Blocked rows (${plan.errors.length}) — nothing will be written:`);
    for (const error of plan.errors) console.log(`  - ${error}`);
  }
  console.log("");
}

async function executePlan(plan) {
  let updated = 0;
  for (const row of plan.rows) {
    if (row.status === "unchanged") continue;
    await Player.updateOne({ _id: row.playerId }, { $set: { battingPosition: row.position } });
    updated += 1;
  }
  return { updated };
}

export async function main(argv = process.argv) {
  const args = argv.slice(2);
  const apply = args.includes("--apply");
  const forceTest = args.includes("--force-test");
  const unknown = findUnknownOptions(args);
  if (unknown.length) throw new Error(`Unknown option(s): ${unknown.join(", ")}`);
  if (apply && args.includes("--dry-run")) throw new Error("Pass either --apply or --dry-run, not both.");

  const file = argValue("--file", argv);
  if (!file) throw new Error("No CSV file. Pass --file <csv path>.");

  const url = argValue("--uri", argv) || process.env.MIGRATION_MONGO_URL;
  if (!url) {
    throw new Error(
      "No connection string. Pass --uri <mongodb-uri> explicitly (this script does not read .env), " +
        "or set MIGRATION_MONGO_URL.",
    );
  }

  const { host, databaseName } = getMongoTarget(url);
  const hostname = host.replace(/^.*@/, "").split(":")[0].replace(/^\[|\]$/g, "");
  const allowedHostname = argValue("--allow-host", argv);
  if (!["127.0.0.1", "localhost", "::1", allowedHostname].includes(hostname)) {
    throw new Error(
      `Refusing a non-local MongoDB target: "${hostname}". Loopback only by default. ` +
        "Pass --allow-host=<name> if you really mean another host.",
    );
  }
  const allowedDatabase = argValue("--allow-database", argv) || EXPECTED_DATABASE;
  if (databaseName !== allowedDatabase) {
    throw new Error(
      `Refusing database "${databaseName}". Expected "${allowedDatabase}". ` +
        "Pass --allow-database=<name> deliberately.",
    );
  }
  if (isTestTarget(databaseName) && !forceTest) {
    throw new Error(
      `Refusing a test/e2e database (${databaseName}${
        process.env.NODE_ENV === "test" ? ", NODE_ENV=test" : ""
      }). Pass --force-test only for a throwaway local database.`,
    );
  }

  let records;
  try {
    records = validateRows(parseCsv(fs.readFileSync(file, "utf8")));
  } catch (error) {
    if (error && error.code === "ENOENT") throw new Error(`CSV file not found: ${file}`);
    throw error;
  }

  console.log(`Target database: ${databaseName || "(unnamed)"} (host guard passed)`);
  console.log(`CSV file: ${file}`);
  console.log(`Validated: ${records.length} row(s).`);

  await mongoose.connect(url, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });
  try {
    const plan = await buildPlan(records);
    printPlan(plan, apply);

    if (plan.errors.length) {
      console.log("Refusing to write while any row is blocked; nothing was changed.");
      process.exitCode = 1;
      return { apply, plan, updated: 0, blocked: true };
    }
    if (!apply) {
      console.log("Dry run complete. Nothing was written. Re-run with --apply to write.");
      return { apply, plan, updated: 0, blocked: false };
    }

    const result = await executePlan(plan);
    console.log(`APPLIED. ${result.updated} player(s) updated.`);
    return { apply, plan, updated: result.updated, blocked: false };
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
