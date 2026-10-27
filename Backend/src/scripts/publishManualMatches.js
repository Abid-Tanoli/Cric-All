// Publish stored DRAFT manual scorecards without re-entering their numbers.
//
//   node src/scripts/publishManualMatches.js <matchId> [<matchId> ...]   # dry run
//   node src/scripts/publishManualMatches.js --tournament <id>           # dry run
//   node src/scripts/publishManualMatches.js <matchId> --apply           # write
//
// Dry run is the default and writes nothing. --apply uses the SAME
// manualScorecardController.publishManualMatch() path as the Admin form's
// Publish button: validate -> manualDraft=false/status=completed -> recompute
// tournament points -> invalidate the public stats cache.
//
// Safety:
//   * only `source: "manual"` drafts are ever selected;
//   * an already-published match is SKIPped (idempotent re-runs);
//   * validation failures refuse the write and are printed per match;
//   * the Mongo URI is read from MONGO_URL and never printed.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import Match from "../models/Match.js";
import Tournament from "../models/Tournament.js";
import { publishManualMatch } from "../controllers/manualScorecardController.js";
import { getMongoTarget } from "../utils/mongoTarget.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(SCRIPT_DIR, "../..");
dotenv.config({ path: path.join(BACKEND_ROOT, ".env"), quiet: true });

mongoose.set("autoIndex", false);

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const uniqueIds = (values) => [...new Set(values.map(String).map((value) => value.trim()).filter(Boolean))];

const matchLabel = (match) => {
  const teams = (match?.teams || []).map((team) => team?.name || team?.shortName).filter(Boolean);
  const heading = teams.length === 2 ? `${teams[0]} vs ${teams[1]}` : (match?.title || String(match?._id || ""));
  const slot = match?.stageLabel || match?.stage || "";
  const tournament = match?.tournament?.name || "";
  return [slot, heading, tournament].filter(Boolean).join(" · ");
};

const errorSummary = (result) => {
  const lines = (result?.errors || []).map((error) => `${error.path}: ${error.message}`);
  if (lines.length) return lines.slice(0, 4).join("; ") + (lines.length > 4 ? `; +${lines.length - 4} more` : "");
  return result?.message || "unknown validation error";
};

/** Export for tests/operator tooling; assumes an open mongoose connection. */
export async function resolveTargetMatches({ matchIds = [], tournamentId = "" } = {}) {
  if (tournamentId) {
    if (!isObjectId(tournamentId)) throw new Error("--tournament must be a valid tournament id.");
    const tournament = await Tournament.findById(tournamentId).select("name").lean();
    if (!tournament) throw new Error("Tournament not found.");
    const matches = await Match.find({
      tournament: tournamentId,
      source: "manual",
      manualDraft: true,
    })
      .populate("teams", "name shortName")
      .populate("tournament", "name")
      .sort({ startAt: 1, createdAt: 1 });
    return { tournament, matches, missingIds: [] };
  }

  const ids = uniqueIds(matchIds);
  if (!ids.length) throw new Error("Pass at least one match id, or --tournament <id>.");
  const invalid = ids.filter((id) => !isObjectId(id));
  if (invalid.length) throw new Error(`Not valid match id(s): ${invalid.join(", ")}`);

  const found = await Match.find({ _id: { $in: ids } })
    .populate("teams", "name shortName")
    .populate("tournament", "name");
  const byId = new Map(found.map((match) => [String(match._id), match]));
  return {
    tournament: null,
    matches: ids.map((id) => byId.get(id)).filter(Boolean),
    missingIds: ids.filter((id) => !byId.has(id)),
  };
}

/**
 * Publish/validate the selected drafts. Assumes the caller owns the mongoose
 * connection (main() handles it; tests call this directly).
 */
export async function runPublish({ matchIds = [], tournamentId = "", apply = false, log = console.log } = {}) {
  const { tournament, matches, missingIds } = await resolveTargetMatches({ matchIds, tournamentId });
  const rows = missingIds.map((id) => ({ id, outcome: "BLOCKED", reason: "match not found" }));

  for (const match of matches) {
    const result = await publishManualMatch(match._id, { dryRun: !apply });
    if (result.skipped) {
      rows.push({ id: String(match._id), match, outcome: "SKIP", reason: result.message || "already published" });
    } else if (!result.ok) {
      rows.push({ id: String(match._id), match, outcome: "BLOCKED", reason: errorSummary(result) });
    } else {
      rows.push({
        id: String(match._id),
        match,
        outcome: apply ? "PUBLISHED" : "WOULD PUBLISH",
        reason: "",
      });
    }
  }

  log(apply
    ? "publishManualMatches — APPLY (writing published matches)"
    : "publishManualMatches — DRY RUN (nothing will be written)");
  if (tournament) log(`Tournament: ${tournament.name} (${tournament._id})`);
  log("");

  if (!matches.length && !missingIds.length) {
    log("No draft manual matches found.");
  }

  for (const row of rows) {
    const label = row.match ? matchLabel(row.match) : row.id;
    log(`${row.outcome.padEnd(13)} ${label}${row.reason ? ` — ${row.reason}` : ""}`);
  }

  const counts = rows.reduce((acc, row) => {
    acc[row.outcome] = (acc[row.outcome] || 0) + 1;
    return acc;
  }, {});
  const blocked = counts.BLOCKED || 0;
  log("");
  log(`Summary: ${rows.length} match(es) — ${Object.entries(counts).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`);
  if (!apply && counts["WOULD PUBLISH"]) {
    log("Re-run with --apply to publish the validated drafts.");
  }
  if (blocked) log(`${blocked} match(es) blocked; they were not written.`);

  return { apply, rows, counts, blocked };
}

function argValue(argv, flag) {
  const withEquals = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (withEquals) return withEquals.slice(flag.length + 1);
  const index = argv.indexOf(flag);
  if (index !== -1 && argv[index + 1] && !argv[index + 1].startsWith("--")) return argv[index + 1];
  return "";
}

export async function main(argv = process.argv) {
  const args = argv.slice(2);
  const apply = args.includes("--apply");
  const dryRun = args.includes("--dry-run");
  if (apply && dryRun) throw new Error("Pass either --apply or --dry-run, not both.");

  const tournamentId = argValue(args, "--tournament");
  const flagsWithValues = new Set(["--tournament"]);
  const matchIds = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--apply" || arg === "--dry-run") continue;
    if (arg.startsWith("--tournament=")) continue;
    if (flagsWithValues.has(arg)) { i += 1; continue; }
    if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    matchIds.push(arg);
  }
  if (tournamentId && matchIds.length) {
    throw new Error("Pass match ids or --tournament, not both.");
  }
  if (!tournamentId && !matchIds.length) {
    throw new Error("Usage: node src/scripts/publishManualMatches.js <matchId...> [--apply] | --tournament <id> [--apply]");
  }

  const uri = process.env.MONGO_URL;
  if (!uri) throw new Error("MONGO_URL is not set. The script never prints or accepts the URI on the command line.");
  const { databaseName } = getMongoTarget(uri);
  if (!databaseName) throw new Error("MONGO_URL has no explicit database name.");

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });
  try {
    const report = await runPublish({ matchIds, tournamentId, apply });
    if (report.blocked) process.exitCode = 1;
    return report;
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
