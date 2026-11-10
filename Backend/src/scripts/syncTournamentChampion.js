// Fill a tournament's missing champion/runner-up from its completed Final.
//
//   node src/scripts/syncTournamentChampion.js                     # dry run (default)
//   node src/scripts/syncTournamentChampion.js --apply             # write unset fields
//   node src/scripts/syncTournamentChampion.js --tournament <id>   # one tournament
//
// Safety and scope
// ---------------
//   * Dry run by default; --apply is the only way to write.
//   * Only a published (non-draft) Final with status "completed" and a decided
//     winner is used. Ties, draws, no-results and abandoned finals are skipped.
//   * The champion is the Final's winner; the runner-up is the other finalist.
//   * Stored winner/runnerUp values are never overwritten. Each field is written
//     only while it is still unset, so re-running --apply is idempotent.
//   * Every successful write records one audit entry.
//   * The Mongo URI is read from MONGO_URL and never printed.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import Match from "../models/Match.js";
import Tournament from "../models/Tournament.js";
import { recordAudit, SYSTEM_ACTOR } from "../utils/audit.js";
import { deriveCompletedFinalHonours } from "../services/tournamentPublicState.js";
import { getMongoTarget } from "../utils/mongoTarget.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(SCRIPT_DIR, "../..");
dotenv.config({ path: path.join(BACKEND_ROOT, ".env"), quiet: true });

mongoose.set("autoIndex", false);

const MATCH_FIELDS =
  "_id stage stageLabel round matchNumber status startAt teams result.winner " +
  "result.resultType result.margin result.isTie manualDraft isDraft";

const argValue = (argv, flag) => {
  const withEquals = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (withEquals) return withEquals.slice(flag.length + 1);
  const index = argv.indexOf(flag);
  if (index !== -1 && argv[index + 1] && !argv[index + 1].startsWith("--")) {
    return argv[index + 1];
  }
  return "";
};

export function parseOptions(argv = []) {
  const apply = argv.includes("--apply");
  if (apply && argv.includes("--dry-run")) {
    throw new Error("Pass either --apply or --dry-run, not both.");
  }

  const tournamentId = argValue(argv, "--tournament");
  const flagsWithValues = new Set(["--tournament"]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply" || arg === "--dry-run") continue;
    if (arg.startsWith("--tournament=")) continue;
    if (flagsWithValues.has(arg)) {
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (tournamentId && !mongoose.isValidObjectId(tournamentId)) {
    throw new Error("--tournament must be a valid tournament id.");
  }

  return { apply, tournamentId };
}

/**
 * Pure: decide what one tournament needs. No database access and no writes.
 *
 * @returns {{ outcome: string, reason: string, updates: object, derived: object|null }}
 */
export function planTournamentSync(tournament = {}, matches = []) {
  if (tournament.winner && tournament.runnerUp) {
    return {
      outcome: "SKIP_STORED",
      reason: "winner and runnerUp are already set",
      updates: {},
      derived: null,
    };
  }

  const derived = deriveCompletedFinalHonours(matches);
  if (!derived) {
    return {
      outcome: "SKIP_NO_FINAL",
      reason: "no completed Final with a decided winner",
      updates: {},
      derived: null,
    };
  }

  const updates = {};
  if (!tournament.winner) updates.winner = derived.winnerId;
  if (!tournament.runnerUp) updates.runnerUp = derived.runnerUpId;

  if (!Object.keys(updates).length) {
    return {
      outcome: "SKIP_STORED",
      reason: "winner and runnerUp are already set",
      updates,
      derived,
    };
  }

  return { outcome: "UPDATE", reason: "", updates, derived };
}

async function writeUnsetFields(tournamentId, updates = {}) {
  const written = {};
  for (const field of ["winner", "runnerUp"]) {
    const value = updates[field];
    if (!value) continue;
    // The filter repeats the "still unset" condition so a concurrent edit is
    // never overwritten by this script.
    const result = await Tournament.updateOne(
      {
        _id: tournamentId,
        $or: [{ [field]: null }, { [field]: { $exists: false } }],
      },
      { $set: { [field]: value } },
    );
    if (result.modifiedCount) written[field] = value;
  }
  return written;
}

/**
 * Export for tests/operator tooling; assumes an open mongoose connection.
 */
export async function runSyncTournamentChampion({
  apply = false,
  tournamentId = "",
  log = console.log,
} = {}) {
  if (tournamentId && !mongoose.isValidObjectId(tournamentId)) {
    throw new Error("--tournament must be a valid tournament id.");
  }

  const filter = tournamentId ? { _id: tournamentId } : {};
  const tournaments = await Tournament.find(filter)
    .select("_id name winner runnerUp")
    .sort({ name: 1 })
    .lean();

  const rows = [];
  for (const tournament of tournaments) {
    let plan;
    if (tournament.winner && tournament.runnerUp) {
      plan = planTournamentSync(tournament, []);
    } else {
      const matches = await Match.find({ tournament: tournament._id }).select(MATCH_FIELDS).lean();
      plan = planTournamentSync(tournament, matches);
    }

    let outcome = plan.outcome;
    let written = {};
    if (plan.outcome === "UPDATE") {
      if (!apply) {
        outcome = "WOULD_UPDATE";
      } else {
        written = await writeUnsetFields(tournament._id, plan.updates);
        outcome = Object.keys(written).length ? "UPDATED" : "SKIP_STORED";
        if (Object.keys(written).length) {
          await recordAudit({
            action: "tournament.champion_synced",
            targetType: "tournament",
            targetId: tournament._id,
            targetLabel: tournament.name,
            metadata: {
              winner: written.winner || undefined,
              runnerUp: written.runnerUp || undefined,
              finalMatchId: plan.derived?.final?._id || undefined,
              source: "completed_final",
            },
            actor: SYSTEM_ACTOR,
          });
        }
      }
    }

    rows.push({
      tournamentId: String(tournament._id),
      name: tournament.name,
      outcome,
      reason: outcome === "SKIP_STORED" && plan.outcome === "UPDATE"
        ? "fields were already set"
        : plan.reason,
      updates: plan.outcome === "UPDATE" ? (apply ? written : plan.updates) : {},
      finalMatchId: plan.derived?.final?._id ? String(plan.derived.final._id) : "",
    });
  }

  const counts = rows.reduce((acc, row) => {
    acc[row.outcome] = (acc[row.outcome] || 0) + 1;
    return acc;
  }, {});

  log(apply
    ? "syncTournamentChampion - APPLY (writing missing champion/runner-up)"
    : "syncTournamentChampion - DRY RUN (nothing will be written)");
  log(`Tournaments checked: ${rows.length}`);
  log("");
  for (const row of rows) {
    const fields = Object.keys(row.updates);
    const detail = fields.length ? ` [${fields.join(", ")}]` : "";
    const reason = row.reason ? ` - ${row.reason}` : "";
    log(`${row.outcome.padEnd(12)} ${row.name} (${row.tournamentId})${detail}${reason}`);
  }
  log("");
  log(`Summary: ${Object.entries(counts).map(([key, value]) => `${key}=${value}`).join(", ") || "no tournaments"}`);
  if (!apply && counts.WOULD_UPDATE) log("Re-run with --apply to write these values.");
  if (!apply) log("Dry run complete. Nothing was written.");

  return {
    apply,
    tournamentId,
    rows,
    counts,
    changed: rows.filter((row) => row.outcome === "UPDATED").length,
    wouldChange: rows.filter((row) => row.outcome === "WOULD_UPDATE").length,
  };
}

export async function main(argv = process.argv) {
  const { apply, tournamentId } = parseOptions(argv.slice(2));

  const uri = process.env.MONGO_URL;
  if (!uri) {
    throw new Error("MONGO_URL is not set. The script never prints or accepts the URI on the command line.");
  }
  const { databaseName } = getMongoTarget(uri);
  if (!databaseName) throw new Error("MONGO_URL has no explicit database name.");

  console.log(`Database: ${databaseName}`);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });
  try {
    return await runSyncTournamentChampion({ apply, tournamentId });
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
