// Repair fall-of-wicket overs on manual scorecards: they were stored as a BALL
// COUNT (13) while the public scorecard reads them as a printed over figure, so
// "2.1 overs" was printed as "13.0 ov".
//
//   node src/scripts/fixFowOvers.js                  # dry run (default)
//   node src/scripts/fixFowOvers.js --apply          # write the conversions
//   node src/scripts/fixFowOvers.js --force-test     # allow a test/e2e DB
//   node src/scripts/fixFowOvers.js --match <id>     # one match (repeatable)
//   node src/scripts/fixFowOvers.js --tournament <id>
//
// Which values are converted
// --------------------------
// Only `source: "manual"` matches are touched: that is the writer that stored a
// ball count (services/manualScorecard.js). A per-innings decision, because one
// innings always used a single unit:
//
//   * an integer value is a ball-count candidate (an over figure with balls in
//     the final over is never an integer, e.g. 19.4);
//   * it is PROVABLE when reading it as completed overs would put the fall past
//     the end of the innings (value * 6 > the innings' total balls) — 30 and 38
//     in a 15-over innings cannot be overs;
//   * if any candidate in the innings is provable, every integer candidate in
//     that innings is converted (13 -> 2.1, 30 -> 5.0, 38 -> 6.2, 51 -> 8.3);
//   * otherwise the innings is listed under AMBIGUOUS and left untouched, as is
//     any innings whose converted sequence would run backwards.
//
// Idempotent: a converted value is always <= the innings' completed overs, so it
// can never look provable on a later run, and an over figure with balls in the
// final over (2.1) is not an integer. Re-running an applied fix prints "nothing
// to convert".
//
// Safety
// ------
//   * Dry run by default; --apply is the only way to write.
//   * Refuses a test/e2e database unless --force-test is passed.
//   * Prints before/after for every changed match and never prints the Mongo URI.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import Match from "../models/Match.js";
import Tournament from "../models/Tournament.js";
import { getMongoTarget } from "../utils/mongoTarget.js";
import { isTestTarget } from "./createSemiFinals.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(SCRIPT_DIR, "../..");
dotenv.config({ path: path.join(BACKEND_ROOT, ".env"), quiet: true });

mongoose.set("autoIndex", false);

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

export const overFigureFromBalls = (balls) => Math.floor(balls / 6) + (balls % 6) / 10;

export function inningsTotalBalls(innings = {}) {
  const balls = Number(innings.balls);
  if (Number.isFinite(balls) && balls > 0) return balls;
  const overs = Number(innings.overs);
  if (!Number.isFinite(overs) || overs <= 0) return 0;
  return Math.floor(overs) * 6 + Math.round((overs % 1) * 10);
}

const matchLabel = (match) => {
  const teams = (match?.teams || []).map((team) => team?.name || team?.shortName).filter(Boolean);
  const heading = teams.length === 2 ? `${teams[0]} vs ${teams[1]}` : (match?.title || String(match?._id || ""));
  const slot = match?.stageLabel || match?.stage || "";
  const tournament = match?.tournament?.name || "";
  return [slot, heading, tournament].filter(Boolean).join(" · ");
};

const overText = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value).toFixed(1) : "—");

/**
 * Plan the conversions for one match without writing anything.
 * Returns { changes: [{ inningsIndex, entryIndex, from, to }], ambiguous: [...] }.
 */
export function planFowOvers(match) {
  const changes = [];
  const ambiguous = [];
  if (match?.source !== "manual") return { changes, ambiguous };

  (match.innings || []).forEach((innings, inningsIndex) => {
    const rows = Array.isArray(innings?.fallOfWickets) ? innings.fallOfWickets : [];
    if (!rows.length) return;

    const totalBalls = inningsTotalBalls(innings);
    const candidates = rows
      .map((row, entryIndex) => ({ entryIndex, value: Number(row?.overs) }))
      .filter(({ value }) => Number.isFinite(value) && value > 0 && Number.isInteger(value));
    if (!candidates.length) return;

    const label = `innings ${inningsIndex + 1}`;
    if (!totalBalls) {
      ambiguous.push({ inningsIndex, reason: `${label}: innings balls are unknown, so a ball count cannot be proven` });
      return;
    }

    const provable = candidates.filter(({ value }) => value * 6 > totalBalls);
    if (!provable.length) {
      ambiguous.push({
        inningsIndex,
        reason: `${label}: ${candidates.map(({ value }) => value).join(", ")} fit both a ball count and an over figure within ${totalBalls} balls`,
      });
      return;
    }

    const planned = candidates.map(({ entryIndex, value }) => ({
      inningsIndex,
      entryIndex,
      from: value,
      to: overFigureFromBalls(value),
      balls: value,
    }));

    // Sanity: the repaired figures must still be non-decreasing over by over.
    const ballsAt = (row, entryIndex) => {
      const found = planned.find((rowIndex) => rowIndex.entryIndex === entryIndex);
      if (found) return found.balls;
      const value = Number(row?.overs);
      return Number.isFinite(value) && value > 0 ? Math.round(value * 6) : 0;
    };
    for (let index = 1; index < rows.length; index += 1) {
      if (ballsAt(rows[index], index) < ballsAt(rows[index - 1], index - 1)) {
        ambiguous.push({ inningsIndex, reason: `${label}: converting would make the fall of wickets run backwards` });
        return;
      }
    }
    if (planned.some((row) => row.balls > totalBalls)) {
      ambiguous.push({ inningsIndex, reason: `${label}: a fall is later than the innings' ${totalBalls} balls` });
      return;
    }

    changes.push(...planned.map(({ balls, ...rest }) => rest));
  });

  return { changes, ambiguous };
}

export async function resolveTargets({ matchIds = [], tournamentId = "" } = {}) {
  let query = { source: "manual", "innings.fallOfWickets.0": { $exists: true } };

  if (tournamentId) {
    if (!isObjectId(tournamentId)) throw new Error("--tournament must be a valid tournament id.");
    const tournament = await Tournament.findById(tournamentId).select("name").lean();
    if (!tournament) throw new Error("Tournament not found.");
    query = { ...query, tournament: tournament._id };
  }
  if (matchIds.length) {
    const ids = [...new Set(matchIds.map(String).map((value) => value.trim()).filter(Boolean))];
    const invalid = ids.filter((id) => !isObjectId(id));
    if (invalid.length) throw new Error(`Not valid match id(s): ${invalid.join(", ")}`);
    query = { ...query, _id: { $in: ids } };
  }

  return Match.find(query)
    .populate("teams", "name shortName")
    .populate("tournament", "name")
    .sort({ startAt: 1, createdAt: 1 });
}

/** Plan (and with apply, write) the conversions. The caller owns the connection. */
export async function runFix({ matchIds = [], tournamentId = "", apply = false, log = console.log } = {}) {
  const matches = await resolveTargets({ matchIds, tournamentId });
  const rows = [];

  for (const match of matches) {
    const plan = planFowOvers(match);
    if (!plan.changes.length) {
      rows.push({ match, outcome: plan.ambiguous.length ? "AMBIGUOUS" : "SKIP", plan });
      continue;
    }
    if (apply) {
      for (const change of plan.changes) {
        match.innings[change.inningsIndex].fallOfWickets[change.entryIndex].overs = change.to;
      }
      await match.save();
    }
    rows.push({ match, outcome: apply ? "FIXED" : "WOULD FIX", plan });
  }

  log(apply
    ? "fixFowOvers — APPLY (writing fall-of-wicket overs)"
    : "fixFowOvers — DRY RUN (nothing will be written)");
  log("");

  for (const row of rows) {
    log(`${row.outcome.padEnd(10)} ${matchLabel(row.match)} (${row.match._id})`);
    for (const change of row.plan.changes) {
      log(`  innings ${change.inningsIndex + 1} · fall ${change.entryIndex + 1}: ${overText(change.from)} -> ${overText(change.to)}`);
    }
    for (const entry of row.plan.ambiguous) log(`  ambiguous: ${entry.reason}`);
  }
  if (!rows.length) log("No manual match with a fall of wickets was found.");

  const counts = rows.reduce((acc, row) => {
    acc[row.outcome] = (acc[row.outcome] || 0) + 1;
    return acc;
  }, {});
  log("");
  log(`Summary: ${rows.length} match(es) — ${Object.entries(counts).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`);
  if (!apply && counts["WOULD FIX"]) log("Re-run with --apply to write these conversions.");
  if (counts.AMBIGUOUS) log("Ambiguous innings were left untouched; inspect them by hand.");

  return { apply, rows, counts };
}

function argValues(argv, flag) {
  return argv
    .map((arg, index) => (arg === flag ? argv[index + 1] : arg.startsWith(`${flag}=`) ? arg.slice(flag.length + 1) : ""))
    .filter(Boolean);
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const forceTest = argv.includes("--force-test");
  const matchIds = argValues(argv, "--match");
  const tournamentId = argValues(argv, "--tournament")[0] || "";

  const mongoUrl = process.env.MONGO_URL || "";
  if (!mongoUrl) throw new Error("MONGO_URL is not set (see Backend/.env).");
  const target = getMongoTarget(mongoUrl);
  if (!target.databaseName) throw new Error("MONGO_URL has no explicit database name.");
  if (!forceTest && isTestTarget(target.databaseName)) {
    throw new Error(`Refusing the test/e2e database "${target.databaseName}" without --force-test.`);
  }

  console.log(`Target database: ${target.databaseName} on ${target.host || "local"}`);
  await mongoose.connect(mongoUrl);
  try {
    await runFix({ matchIds, tournamentId, apply });
  } finally {
    await mongoose.disconnect();
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error) => {
    console.error(`fixFowOvers failed: ${error.message}`);
    process.exitCode = 1;
  });
}
