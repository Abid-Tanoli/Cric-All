// Create the two All Baldia T20 semi-finals as normal scheduled tournament
// fixtures.
//
//   node src/scripts/createSemiFinals.js              # dry run (default)
//   node src/scripts/createSemiFinals.js --apply      # write the fixtures
//   node src/scripts/createSemiFinals.js --force-test # allow a test/e2e DB
//
// The fixtures are created through services/tournamentFixture.js - the same
// creation path the Admin "add fixture" endpoint uses - so they have the normal
// shape: status "upcoming", source "live", no manualDraft, two empty innings
// ready for the toss, and a link in Tournament.matches.
//
// Safety and scope
// ---------------
//   * Dry run by default; --apply is the only way to write.
//   * Looks the tournament up by name and refuses to create it.
//   * Resolves exactly four teams by name inside that tournament.
//   * Skips a semi-final that already exists by stageLabel or by team pair +
//     semi-final stage (idempotent re-runs).
//   * Never publishes, completes, scores, changes rules or touches QFs.
//   * Refuses a test/e2e database unless --force-test is passed.
//   * The Mongo URI is read from MONGO_URL and never printed.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import Match from "../models/Match.js";
import Tournament from "../models/Tournament.js";
import { createTournamentFixture } from "../services/tournamentFixture.js";
import { getMongoTarget } from "../utils/mongoTarget.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(SCRIPT_DIR, "../..");
dotenv.config({ path: path.join(BACKEND_ROOT, ".env"), quiet: true });

mongoose.set("autoIndex", false);

export const TOURNAMENT_NAME = "All Baldia T20 Hard Ball Cricket Tournament";
export const DEFAULT_MATCH_CATEGORY = "Club";

// The official poster times. Pakistan is UTC+5, so 9:30 AM PKT is 04:30 UTC
// and 10:00 AM PKT is 05:00 UTC. Both dates are Sunday 25 October 2026.
export const SEMI_FINALS = Object.freeze([
  {
    stageLabel: "SF1",
    teamA: "Baldia Zalmi",
    teamB: "Sky Sports",
    startTime: "2026-10-25T04:30:00.000Z",
    venue: "Tahirabad Ground",
  },
  {
    stageLabel: "SF2",
    teamA: "Young Star",
    teamB: "Khan Associates",
    startTime: "2026-10-25T05:00:00.000Z",
    venue: "Tahirabad Ground",
  },
]);

const idOf = (value) => String(value?._id || value || "");

/** Case/punctuation-insensitive name key; never used to "guess" a team. */
export function normalizeTeamName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isTestTarget(databaseName, nodeEnv = process.env.NODE_ENV) {
  const db = String(databaseName || "");
  return (
    nodeEnv === "test" ||
    /(^|[-_])e2e($|[-_])/i.test(db) ||
    /(^|[-_])test($|[-_])/i.test(db)
  );
}

/** Resolve one tournament team by its stored name. Ambiguity is refused. */
export function resolveTeamByName(teams = [], name) {
  const wanted = normalizeTeamName(name);
  const matches = (teams || []).filter((team) => normalizeTeamName(team?.name) === wanted);
  if (matches.length === 1) return { team: matches[0] };
  if (matches.length === 0) {
    return { error: `team "${name}" was not found in the tournament` };
  }
  return { error: `team name "${name}" is ambiguous (${matches.length} tournament teams match)` };
}

const samePair = (teams, teamIds) => {
  const ids = (teams || []).map(idOf).filter(Boolean).sort();
  const wanted = (teamIds || []).map(String).filter(Boolean).sort();
  return ids.length === 2 && wanted.length === 2 && ids[0] === wanted[0] && ids[1] === wanted[1];
};

const pairLabel = (match) =>
  (match?.teams || [])
    .map((team) => team?.name || team?.shortName || idOf(team))
    .filter(Boolean)
    .join(" vs ");

/**
 * Find an existing semi-final for this slot. A label match or a team-pair
 * match is enough to skip; a label reused by a different pair is blocked.
 */
export function findExistingSemiFinal(existingMatches = [], { teamIds = [], stageLabel } = {}) {
  const semis = (existingMatches || []).filter(
    (match) => String(match?.stage || "") === "semi_final",
  );
  const wantedLabel = String(stageLabel || "").trim().toLowerCase();

  const byLabel = semis.filter(
    (match) => String(match?.stageLabel || "").trim().toLowerCase() === wantedLabel,
  );
  const byPair = semis.filter((match) => samePair(match?.teams, teamIds));

  if (byLabel.length > 1) {
    return {
      action: "blocked",
      reason: `${stageLabel} is used by ${byLabel.length} existing semi-finals; refusing to guess`,
    };
  }
  if (byPair.length > 1) {
    return {
      action: "blocked",
      reason: `${pairLabel(byPair[0])} already appears in ${byPair.length} semi-finals; refusing to guess`,
    };
  }

  const labelMatch = byLabel[0] || null;
  const pairMatch = byPair[0] || null;
  if (labelMatch && pairMatch && idOf(labelMatch) !== idOf(pairMatch)) {
    return {
      action: "blocked",
      reason: `${stageLabel} and ${pairLabel(pairMatch)} point at different existing matches`,
    };
  }

  const existing = labelMatch || pairMatch;
  if (!existing) return { action: "none" };

  if (labelMatch && !samePair(labelMatch.teams, teamIds)) {
    return {
      action: "blocked",
      reason: `${stageLabel} already exists as ${pairLabel(labelMatch)} (${idOf(labelMatch)})`,
    };
  }

  return {
    action: "skip",
    match: existing,
    reason: labelMatch ? `existing ${stageLabel}` : "existing semi-final for this team pair",
  };
}

/** Use the category the tournament's existing QFs were imported with. */
export function matchCategoryFor(existingMatches = []) {
  const counts = new Map();
  for (const match of existingMatches || []) {
    if (String(match?.stage || "") !== "quarter_final") continue;
    const value = String(match?.matchCategory || "").trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  if (!counts.size) return DEFAULT_MATCH_CATEGORY;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

async function loadTournamentByName(name) {
  const tournaments = await Tournament.find({ name }).populate("teams", "name shortName");
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
      "title matchNumber teams stage stageLabel round status startAt matchCategory matchType totalOvers source manualDraft",
    )
    .populate("teams", "name shortName")
    .sort({ matchNumber: 1 })
    .lean();
}

/**
 * Build the CREATE/SKIP plan and, when `apply` is true, write the fixtures.
 * Assumes the caller owns the mongoose connection.
 */
export async function runCreateSemiFinals({
  apply = false,
  log = console.log,
  tournamentName = TOURNAMENT_NAME,
} = {}) {
  const tournament = await loadTournamentByName(tournamentName);
  const existingMatches = await loadExistingMatches(tournament);
  const matchCategory = matchCategoryFor(existingMatches);

  const rows = [];
  for (const spec of SEMI_FINALS) {
    const pair = `${spec.teamA} vs ${spec.teamB}`;
    const row = {
      stageLabel: spec.stageLabel,
      pair,
      startTime: spec.startTime,
      venue: spec.venue,
      outcome: "CREATE",
      matchId: "",
      existingId: "",
      reason: "",
      match: null,
    };

    const teamA = resolveTeamByName(tournament.teams, spec.teamA);
    const teamB = resolveTeamByName(tournament.teams, spec.teamB);
    if (teamA.error || teamB.error) {
      row.outcome = "BLOCKED";
      row.reason = [teamA.error, teamB.error].filter(Boolean).join("; ");
      rows.push(row);
      continue;
    }

    const teamIds = [idOf(teamA.team), idOf(teamB.team)];
    const existing = findExistingSemiFinal(existingMatches, {
      teamIds,
      stageLabel: spec.stageLabel,
    });
    if (existing.action === "skip") {
      row.outcome = "SKIP";
      row.existingId = idOf(existing.match);
      row.reason = existing.reason;
      row.match = existing.match;
      rows.push(row);
      continue;
    }
    if (existing.action === "blocked") {
      row.outcome = "BLOCKED";
      row.reason = existing.reason;
      rows.push(row);
      continue;
    }

    try {
      const planned = await createTournamentFixture({
        tournamentId: tournament._id,
        team1: teamIds[0],
        team2: teamIds[1],
        venue: spec.venue,
        startTime: spec.startTime,
        matchType: "T20",
        matchCategory,
        matchSubcategory: tournament.name,
        round: spec.stageLabel,
        group: "",
        stage: "semi_final",
        stageLabel: spec.stageLabel,
        title: `${spec.stageLabel}: ${teamA.team.name} vs ${teamB.team.name}`,
        dryRun: true,
      });
      row.match = planned.match;
    } catch (error) {
      row.outcome = "BLOCKED";
      row.reason = error.message;
    }
    rows.push(row);
  }

  const blockedBeforeWrite = rows.some((row) => row.outcome === "BLOCKED");
  if (apply && !blockedBeforeWrite) {
    for (const row of rows) {
      if (row.outcome !== "CREATE") continue;
      const planned = row.match;
      const spec = SEMI_FINALS.find((item) => item.stageLabel === row.stageLabel);
      const teamIds = (planned?.teams || []).map(idOf);
      try {
        const created = await createTournamentFixture({
          tournamentId: tournament._id,
          team1: teamIds[0],
          team2: teamIds[1],
          venue: spec.venue,
          startTime: spec.startTime,
          matchType: "T20",
          matchCategory,
          matchSubcategory: tournament.name,
          round: spec.stageLabel,
          group: "",
          stage: "semi_final",
          stageLabel: spec.stageLabel,
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
  }

  const counts = rows.reduce((acc, row) => {
    acc[row.outcome] = (acc[row.outcome] || 0) + 1;
    return acc;
  }, {});
  const createdIds = rows.map((row) => row.matchId).filter(Boolean);
  const blocked = (counts.BLOCKED || 0) > 0;

  log(apply
    ? "createSemiFinals - APPLY (writing the semi-final fixtures)"
    : "createSemiFinals - DRY RUN (nothing will be written)");
  log(`Tournament: ${tournament.name} (${tournament._id})`);
  log(`Match category: ${matchCategory}`);
  log("");
  for (const row of rows) {
    const suffix = row.reason ? ` - ${row.reason}` : "";
    log(
      `${row.outcome.padEnd(7)} ${row.stageLabel}  ${row.pair}  ${row.startTime}  ${row.venue}${suffix}`,
    );
    if (row.matchId) log(`        id: ${row.matchId}`);
    if (row.existingId) log(`        existing id: ${row.existingId}`);
  }
  log("");
  log(
    `Summary: ${rows.length} semi-final(s) - ${Object.entries(counts)
      .map(([key, value]) => `${key}=${value}`)
      .join(", ")}`,
  );
  if (apply && blockedBeforeWrite) {
    log("Refusing to write any fixture while an item is blocked; nothing was changed.");
  }
  if (!apply && counts.CREATE) {
    log("Re-run with --apply to write these fixtures.");
  }
  if (apply && createdIds.length) {
    log(`Created ids: ${createdIds.join(", ")}`);
  }
  if (!apply) log("Dry run complete. Nothing was written.");

  return { apply, tournament, rows, counts, createdIds, blocked };
}

export async function main(argv = process.argv) {
  const args = argv.slice(2);
  const apply = args.includes("--apply");
  const forceTest = args.includes("--force-test");
  if (apply && args.includes("--dry-run")) {
    throw new Error("Pass either --apply or --dry-run, not both.");
  }
  const unknown = args.filter(
    (arg) => !["--apply", "--dry-run", "--force-test"].includes(arg),
  );
  if (unknown.length) throw new Error(`Unknown option(s): ${unknown.join(", ")}`);

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
    const report = await runCreateSemiFinals({ apply });
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
