// Create the All Baldia T20 final as a normal scheduled tournament fixture.
//
//   node src/scripts/createFinal.js                    # dry run (default)
//   node src/scripts/createFinal.js --apply            # write the fixture
//   node src/scripts/createFinal.js --force-test       # allow a test/e2e DB
//   node src/scripts/createFinal.js --venue "Ground"   # override the venue
//
// The fixture goes through services/tournamentFixture.js - the same creation
// path the Admin "add fixture" endpoint and createSemiFinals.js use - so it has
// the normal shape: status "upcoming", source "live", no manualDraft, two empty
// innings ready for the toss, and a link in Tournament.matches.
//
// Safety and scope
// ---------------
//   * Dry run by default; --apply is the only way to write.
//   * Looks the tournament up by name and refuses to create it.
//   * Resolves the two finalists from the winners of the COMPLETED SF1 and SF2
//     fixtures. No team id or winner is hardcoded.
//   * Blocks if either semi-final is missing, unpublished/draft, incomplete or
//     has no winner.
//   * Skips when a Final already exists (idempotent re-runs); more than one
//     existing Final is treated as ambiguous and blocked.
//   * Never publishes, completes, scores, changes rules or touches the semis.
//   * The Mongo URI is read from MONGO_URL and never printed.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import Match from "../models/Match.js";
import Tournament from "../models/Tournament.js";
import { createTournamentFixture } from "../services/tournamentFixture.js";
import { normalizeBracketStage } from "../services/tournamentBracket.js";
import { getMongoTarget } from "../utils/mongoTarget.js";
import {
  TOURNAMENT_NAME,
  isTestTarget,
  matchCategoryFor,
} from "./createSemiFinals.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(SCRIPT_DIR, "../..");
dotenv.config({ path: path.join(BACKEND_ROOT, ".env"), quiet: true });

mongoose.set("autoIndex", false);

export { TOURNAMENT_NAME };

export const DEFAULT_FINAL_VENUE = "Tahirabad Ground";

// Sunday 1 November 2026, 10:30 AM Pakistan time (UTC+5).
export const FINAL_FIXTURE = Object.freeze({
  stage: "final",
  stageLabel: "Final",
  round: "Final",
  startTime: "2026-11-01T05:30:00.000Z",
  matchType: "T20",
  totalOvers: 20,
});

const idOf = (value) => String(value?._id || value || "");

const isDraft = (match) => match?.manualDraft === true || match?.isDraft === true;

const pairLabel = (match) =>
  (match?.teams || [])
    .map((team) => team?.name || team?.shortName || idOf(team))
    .filter(Boolean)
    .join(" vs ");

/**
 * Use the category the tournament's semi-finals were created with. This keeps
 * the final in the same competition category even if the QFs used another one.
 */
export function matchCategoryForFinal(existingMatches = []) {
  const counts = new Map();
  for (const match of existingMatches || []) {
    if (normalizeBracketStage(match) !== "semi_final") continue;
    const value = String(match?.matchCategory || "").trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  if (!counts.size) return matchCategoryFor(existingMatches);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function winnerOfSemiFinal(match, label, tournamentTeams = []) {
  if (!match) return { error: `${label} was not found in this tournament` };
  if (isDraft(match)) {
    return { error: `${label} is still an unpublished draft; publish its result first` };
  }
  const status = String(match.status || "upcoming");
  if (status !== "completed") {
    return { error: `${label} is not completed (status: ${status})` };
  }

  const winnerId = idOf(match.result?.winner);
  if (!winnerId) return { error: `${label} is completed but has no winner` };

  const team = (tournamentTeams || []).find((row) => idOf(row) === winnerId);
  if (!team) {
    return { error: `${label} winner ${winnerId} is not one of this tournament's teams` };
  }
  return { match, team, teamId: winnerId, label };
}

/**
 * Pure: resolve SF1 and SF2 winners from the tournament's matches.
 * Returns { finalists: [SF1 winner, SF2 winner] } or { error }.
 */
export function resolveFinalists(existingMatches = [], tournamentTeams = []) {
  const semis = (existingMatches || []).filter(
    (match) => normalizeBracketStage(match) === "semi_final",
  );
  if (!semis.length) {
    return { error: "No semi-finals were found in this tournament; create SF1 and SF2 first" };
  }
  if (semis.length > 2) {
    return {
      error: `Found ${semis.length} semi-finals; refusing to guess which two feed the final`,
    };
  }

  const sorted = [...semis].sort(
    (a, b) =>
      new Date(a.startAt || 0).getTime() - new Date(b.startAt || 0).getTime() ||
      (Number(a.matchNumber) || 0) - (Number(b.matchNumber) || 0),
  );
  const byLabel = (label) =>
    semis.filter(
      (match) => String(match.stageLabel || "").trim().toLowerCase() === label.toLowerCase(),
    );

  const sf1Matches = byLabel("SF1");
  const sf2Matches = byLabel("SF2");
  if (sf1Matches.length > 1) {
    return { error: `${sf1Matches.length} semi-finals are labelled SF1; refusing to guess` };
  }
  if (sf2Matches.length > 1) {
    return { error: `${sf2Matches.length} semi-finals are labelled SF2; refusing to guess` };
  }

  let sf1 = sf1Matches[0] || null;
  let sf2 = sf2Matches[0] || null;
  // Legacy fixtures may have no SF labels. With exactly two semis, their
  // schedule order is unambiguous, so use it without inventing a third match.
  if (semis.length === 2) {
    if (!sf1) sf1 = sorted[0];
    if (!sf2) sf2 = sorted.find((match) => match !== sf1) || null;
  }

  const first = winnerOfSemiFinal(sf1, "SF1", tournamentTeams);
  if (first.error) return { error: first.error };
  const second = winnerOfSemiFinal(sf2, "SF2", tournamentTeams);
  if (second.error) return { error: second.error };

  if (first.teamId === second.teamId) {
    return { error: "SF1 and SF2 resolved to the same winner; refusing to create the final" };
  }
  return { finalists: [first, second] };
}

/** Pure: detect an existing Final. More than one is ambiguous. */
export function findExistingFinal(existingMatches = []) {
  const finals = (existingMatches || []).filter(
    (match) => normalizeBracketStage(match) === "final",
  );
  if (finals.length > 1) {
    return {
      action: "blocked",
      reason: `${finals.length} finals already exist; refusing to guess which one is current`,
    };
  }
  if (finals.length === 1) {
    return {
      action: "skip",
      match: finals[0],
      reason: `existing Final${pairLabel(finals[0]) ? ` (${pairLabel(finals[0])})` : ""}`,
    };
  }
  return { action: "none" };
}

export function parseOptions(args = []) {
  let apply = false;
  let dryRun = false;
  let forceTest = false;
  let venue = DEFAULT_FINAL_VENUE;
  const unknown = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--force-test") forceTest = true;
    else if (arg === "--venue") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--venue needs a value.");
      venue = value;
      index += 1;
    } else if (arg.startsWith("--venue=")) {
      venue = arg.slice("--venue=".length);
      if (!venue) throw new Error("--venue needs a value.");
    } else unknown.push(arg);
  }

  if (unknown.length) throw new Error(`Unknown option(s): ${unknown.join(", ")}`);
  if (apply && dryRun) throw new Error("Pass either --apply or --dry-run, not both.");
  return { apply, forceTest, venue: venue.trim() };
}

async function loadTournamentByName(name) {
  const tournaments = await Tournament.find({ name }).populate("teams", "name shortName logo");
  if (!tournaments.length) {
    throw new Error(`tournament "${name}" was not found; this script never creates it`);
  }
  if (tournaments.length > 1) {
    throw new Error(
      `${tournaments.length} tournaments are named "${name}"; refusing to guess which one to use`,
    );
  }
  return tournaments[0];
}

async function loadExistingMatches(tournament) {
  return Match.find({
    $or: [{ tournament: tournament._id }, { _id: { $in: tournament.matches || [] } }],
  })
    .select(
      "title matchNumber teams stage stageLabel round status startAt matchCategory matchType totalOvers source manualDraft result.winner",
    )
    .populate("teams", "name shortName logo")
    .sort({ matchNumber: 1 })
    .lean();
}

/**
 * Build the CREATE/SKIP plan and, when `apply` is true, write the fixture.
 * Assumes the caller owns the mongoose connection.
 */
export async function runCreateFinal({
  apply = false,
  log = console.log,
  tournamentName = TOURNAMENT_NAME,
  venue = DEFAULT_FINAL_VENUE,
} = {}) {
  const tournament = await loadTournamentByName(tournamentName);
  const existingMatches = await loadExistingMatches(tournament);
  const matchCategory = matchCategoryForFinal(existingMatches);

  const row = {
    stageLabel: FINAL_FIXTURE.stageLabel,
    pair: "",
    startTime: FINAL_FIXTURE.startTime,
    venue,
    outcome: "CREATE",
    matchId: "",
    existingId: "",
    reason: "",
    match: null,
  };
  const rows = [row];

  const existing = findExistingFinal(existingMatches);
  if (existing.action === "skip") {
    row.outcome = "SKIP";
    row.existingId = idOf(existing.match);
    row.reason = existing.reason;
    row.match = existing.match;
    row.pair = pairLabel(existing.match);
  } else if (existing.action === "blocked") {
    row.outcome = "BLOCKED";
    row.reason = existing.reason;
  } else {
    const resolved = resolveFinalists(existingMatches, tournament.teams || []);
    if (resolved.error) {
      row.outcome = "BLOCKED";
      row.reason = resolved.error;
    } else {
      const [first, second] = resolved.finalists;
      row.pair = `${first.team.name} vs ${second.team.name}`;
      try {
        const planned = await createTournamentFixture({
          tournamentId: tournament._id,
          team1: first.teamId,
          team2: second.teamId,
          venue,
          startTime: FINAL_FIXTURE.startTime,
          matchType: FINAL_FIXTURE.matchType,
          matchCategory,
          matchSubcategory: tournament.name,
          round: FINAL_FIXTURE.round,
          group: "",
          stage: FINAL_FIXTURE.stage,
          stageLabel: FINAL_FIXTURE.stageLabel,
          title: `${FINAL_FIXTURE.stageLabel}: ${first.team.name} vs ${second.team.name}`,
          dryRun: true,
        });
        row.match = planned.match;
      } catch (error) {
        row.outcome = "BLOCKED";
        row.reason = error.message;
      }
    }
  }

  const blockedBeforeWrite = rows.some((item) => item.outcome === "BLOCKED");
  if (apply && !blockedBeforeWrite && row.outcome === "CREATE") {
    const planned = row.match;
    const teamIds = (planned?.teams || []).map(idOf);
    try {
      const created = await createTournamentFixture({
        tournamentId: tournament._id,
        team1: teamIds[0],
        team2: teamIds[1],
        venue,
        startTime: FINAL_FIXTURE.startTime,
        matchType: FINAL_FIXTURE.matchType,
        matchCategory,
        matchSubcategory: tournament.name,
        round: FINAL_FIXTURE.round,
        group: "",
        stage: FINAL_FIXTURE.stage,
        stageLabel: FINAL_FIXTURE.stageLabel,
        title: planned.title,
        dryRun: false,
      });
      row.outcome = "CREATED";
      row.matchId = idOf(created.match);
      row.match = created.match;
    } catch (error) {
      row.outcome = "BLOCKED";
      row.reason = error.message;
    }
  }

  const counts = rows.reduce((acc, item) => {
    acc[item.outcome] = (acc[item.outcome] || 0) + 1;
    return acc;
  }, {});
  const createdIds = rows.map((item) => item.matchId).filter(Boolean);
  const blocked = (counts.BLOCKED || 0) > 0;

  log(apply
    ? "createFinal - APPLY (writing the final fixture)"
    : "createFinal - DRY RUN (nothing will be written)");
  log(`Tournament: ${tournament.name} (${tournament._id})`);
  log(`Match category: ${matchCategory}`);
  log("");
  for (const item of rows) {
    const suffix = item.reason ? ` - ${item.reason}` : "";
    const pair = item.pair || "(finalists not resolved)";
    log(`${item.outcome.padEnd(7)} ${item.stageLabel}  ${pair}  ${item.startTime}  ${item.venue}${suffix}`);
    if (item.matchId) log(`        id: ${item.matchId}`);
    if (item.existingId) log(`        existing id: ${item.existingId}`);
  }
  log("");
  log(
    `Summary: ${rows.length} final(s) - ${Object.entries(counts)
      .map(([key, value]) => `${key}=${value}`)
      .join(", ")}`,
  );
  if (apply && blockedBeforeWrite) {
    log("Refusing to write the final while it is blocked; nothing was changed.");
  }
  if (!apply && counts.CREATE) log("Re-run with --apply to write this fixture.");
  if (apply && createdIds.length) log(`Created ids: ${createdIds.join(", ")}`);
  if (!apply) log("Dry run complete. Nothing was written.");

  return {
    apply,
    tournament,
    row,
    rows,
    counts,
    createdIds,
    createdId: createdIds[0] || "",
    blocked,
  };
}

export async function main(argv = process.argv) {
  const { apply, forceTest, venue } = parseOptions(argv.slice(2));

  const uri = process.env.MONGO_URL;
  if (!uri) {
    throw new Error("MONGO_URL is not set. The script never prints or accepts the URI on the command line.");
  }
  const { databaseName } = getMongoTarget(uri);
  if (!databaseName) throw new Error("MONGO_URL has no explicit database name.");

  if (isTestTarget(databaseName) && !forceTest) {
    throw new Error(
      `Refusing a test/e2e database (${databaseName}${
        process.env.NODE_ENV === "test" ? ", NODE_ENV=test" : ""
      }). Pass --force-test only for a throwaway local database.`,
    );
  }

  console.log(`Database: ${databaseName}`);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });
  try {
    const report = await runCreateFinal({ apply, venue });
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
