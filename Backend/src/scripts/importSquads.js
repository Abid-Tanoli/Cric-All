// Bulk import of a tournament squads CSV: clubs (organizations), teams and
// players, for the Round "squads-2026-10" tournament.
//
// What it creates
// ---------------
//   * one TeamOrganization per distinct club value, type "club", active and
//     ownerless (owner: null), with NO Membership row. Admin-created orgs
//     today get a phantom Membership pointing at the platform Admin's id
//     (organizationController.createOrganization -> upsertMembership with
//     req.user._id). This script deliberately does not reproduce that bug: an
//     imported club is supervisory-only until a real owner is assigned with
//     src/scripts/setOrgOwner.js.
//   * one Team per distinct (club, team) pair, linked to its club through
//     organizationRef, public (isPublic: true). A team name that carries a
//     reserved test prefix is refused outright, so an imported real team can
//     never be hidden by the public-read test-name filter.
//   * one Player per CSV row, linked to its team (Player.team and the team's
//     players[] array are kept in step), with playingRole mapped from the CSV
//     `role` column. Rows whose role is blank get no playingRole from this
//     script: nothing is invented, and they are listed under "role to confirm"
//     (the model's own default then applies).
//   * Team.captain / Team.viceCaptain from the CSV is_captain / is_vice_captain
//     flags.
//
// What it does NOT do
// -------------------
//   * It never writes a Membership for an Admin id.
//   * It never invents stats, ages, photos, phone numbers or bio data.
//   * It never renames, merges or deletes anything.
//   * It never overwrites an existing record. A club/team/player that matches
//     an existing one (by the same normalized key the API uses) is reported as
//     "already exists" and left untouched.
//
// Idempotency
// -----------
// A re-run with --apply creates nothing new. Matching mirrors the API:
//   * club   -> case-folded, whitespace-collapsed name;
//   * team   -> (organizationRef, name), case-insensitive anchored regex,
//               exactly teamService.assertTeamNameAvailable / Team's partial
//               unique index;
//   * player -> (team, name), playerService.normalizePlayerName, exactly
//               playerService.assertPlayerNotDuplicate.
// Same-name players in DIFFERENT teams are different people and are all
// created; the duplicate rule is per team, so this is allowed.
//
// Usage
// -----
//   node src/scripts/importSquads.js --file <csv> --uri <mongodb-uri>            # dry run (default)
//   node src/scripts/importSquads.js --file <csv> --uri <mongodb-uri> --apply    # write
//
// Containerized deployments (the database hostname is a Docker service name
// such as `mongodb`, not loopback) must name it deliberately:
//
//   node src/scripts/importSquads.js \
//     --file /tmp/cricall-tournament-squads.csv \
//     --uri "$MONGO_URL" --allow-host mongodb --allow-database cric-all --apply
//
// The URI is passed explicitly on the command line. This script deliberately
// does NOT load .env, so it cannot pick up a connection string for an
// environment other than the one named, and it never prints the URI or its
// credentials.
//
// Two guards, both of which must pass (same shape as migrateTeamNameUniqueness):
//   1. the host must be loopback (127.0.0.1 / localhost / ::1), or named with
//      --allow-host=<name>;
//   2. the database must be the local throwaway database, or named with
//      --allow-database=<name>.
//
// The CSV is validated completely BEFORE the database is touched, so an
// invalid file fails without a single write.

import fs from "fs";
import mongoose from "mongoose";
import Team from "../models/Team.js";
import Player from "../models/Player.js";
import TeamOrganization from "../models/TeamOrganization.js";
import TeamCategory from "../models/TeamCategory.js";
import { createTeam } from "../services/teamService.js";
import { normalizePlayerName } from "../services/playerService.js";
import { generateOrgSlug } from "../services/membershipService.js";
import { getMongoTarget } from "../utils/mongoTarget.js";
import { isReservedTestName } from "../utils/publicProjection.js";

// No background index build while we re-read existing names and insert.
mongoose.set("autoIndex", false);

const EXPECTED_DATABASE = "cric-all-e2e";
const IMPORT_BATCH = "squads-2026-10";
const ORG_TYPE = "club";
const TEAM_CATEGORY = "Club";
const EXPECTED_TEAMS = 8;
const EXPECTED_ROWS_PER_TEAM = 15;
const REQUIRED_HEADERS = [
  "club",
  "team",
  "player_name",
  "role",
  "is_captain",
  "is_vice_captain",
  "note",
];

// CSV text -> Player.playingRole. The platform enum is
// ["Batsman","Bowler","All-Rounder","Batting-All-Rounder",
//  "Bowling-All-Rounder","Wicket-Keeper"] (models/Player.js,
// validators/playerValidators.js). "Batsman / Wicket Keeper" has no combined
// member, so it maps to "Wicket-Keeper" (the keeper is the distinguishing role).
// A key here is already case-folded and whitespace-collapsed.
const ROLE_ALIASES = new Map([
  ["batsman", "Batsman"],
  ["batsman/wicket keeper", "Wicket-Keeper"],
  ["batsman / wicket keeper", "Wicket-Keeper"],
  ["batsman/wicket-keeper", "Wicket-Keeper"],
  ["batsman / wicket-keeper", "Wicket-Keeper"],
  ["bowler", "Bowler"],
  ["all rounder", "All-Rounder"],
  ["all-rounder", "All-Rounder"],
  ["allrounder", "All-Rounder"],
  ["wicket keeper", "Wicket-Keeper"],
  ["wicket-keeper", "Wicket-Keeper"],
  ["wicketkeeper", "Wicket-Keeper"],
]);

function argValue(flag) {
  const withEquals = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (withEquals) return withEquals.slice(flag.length + 1);
  const index = process.argv.indexOf(flag);
  if (index !== -1 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--")) {
    return process.argv[index + 1];
  }
  return undefined;
}

/** Case-folded, whitespace-collapsed name. Matches how the API folds names. */
function foldName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeRoleKey(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function parseYesNo(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "") return false;
  if (["yes", "y", "true", "1"].includes(v)) return true;
  if (["no", "n", "false", "0"].includes(v)) return false;
  return null; // invalid
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

/**
 * Minimal RFC4180-style reader. A double quote is only special at the start of
 * a field; anywhere else it is a literal character (the real squads file has
 * unquoted notes containing stray double quotes, so treating every quote as a
 * delimiter would corrupt them).
 */
export function parseCsv(text) {
  let source = text;
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1); // strip BOM

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    if (inQuotes) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"' && field === "") {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully empty trailing rows.
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ""));
}

// ---------------------------------------------------------------------------
// Validation (runs before any database work)
// ---------------------------------------------------------------------------

/**
 * Turns raw rows into a validated, grouped model. Throws an Error whose message
 * lists every problem found, so one run tells the operator everything that is
 * wrong with the file.
 */
export function validateSquads(rows) {
  const problems = [];
  if (rows.length === 0) {
    throw new Error("The CSV is empty.");
  }

  const header = rows[0].map((h) => String(h).trim().toLowerCase());
  const index = {};
  for (const name of REQUIRED_HEADERS) {
    const at = header.indexOf(name);
    if (at === -1) problems.push(`missing required column "${name}"`);
    index[name] = at;
  }
  if (problems.length > 0) {
    throw new Error(`Invalid CSV header: ${problems.join("; ")}.`);
  }

  const records = [];
  const teamsByKey = new Map();

  for (let r = 1; r < rows.length; r += 1) {
    const line = r + 1; // 1-based file line for the operator
    const cells = rows[r];
    if (cells.length !== REQUIRED_HEADERS.length) {
      problems.push(
        `line ${line}: expected ${REQUIRED_HEADERS.length} columns, found ${cells.length}`,
      );
      continue;
    }

    const club = String(cells[index.club] ?? "").trim();
    const team = String(cells[index.team] ?? "").trim();
    const playerName = String(cells[index.player_name] ?? "").trim();
    const roleRaw = String(cells[index.role] ?? "").trim();
    const note = String(cells[index.note] ?? "").trim();

    if (!club) problems.push(`line ${line}: empty club`);
    if (!team) problems.push(`line ${line}: empty team`);
    if (!playerName) problems.push(`line ${line}: empty player_name`);

    const isCaptain = parseYesNo(cells[index.is_captain]);
    const isViceCaptain = parseYesNo(cells[index.is_vice_captain]);
    if (isCaptain === null) problems.push(`line ${line}: is_captain must be yes/no, got "${cells[index.is_captain]}"`);
    if (isViceCaptain === null) {
      problems.push(`line ${line}: is_vice_captain must be yes/no, got "${cells[index.is_vice_captain]}"`);
    }

    let playingRole = null;
    if (roleRaw) {
      playingRole = ROLE_ALIASES.get(normalizeRoleKey(roleRaw)) || null;
      if (!playingRole) {
        problems.push(
          `line ${line}: unknown role "${roleRaw}" for ${playerName} ` +
            `(allowed: ${[...ROLE_ALIASES.values()].filter((v, i, a) => a.indexOf(v) === i).join(", ")})`,
        );
      }
    }

    for (const [label, value] of [
      ["club", club],
      ["team", team],
      ["player_name", playerName],
    ]) {
      if (value && isReservedTestName(value)) {
        problems.push(`line ${line}: ${label} "${value}" uses a reserved test-name prefix`);
      }
    }

    if (!club || !team || !playerName) continue;

    const key = `${foldName(club)}::${foldName(team)}`;
    if (!teamsByKey.has(key)) {
      teamsByKey.set(key, { key, club, name: team, records: [] });
    }
    teamsByKey.get(key).records.push({
      line,
      club,
      team,
      playerName,
      roleRaw,
      playingRole,
      isCaptain: isCaptain === true,
      isViceCaptain: isViceCaptain === true,
      note,
    });
  }

  const teams = [...teamsByKey.values()];

  // Exactly 8 teams, 15 rows each.
  if (teams.length !== EXPECTED_TEAMS) {
    problems.push(`expected exactly ${EXPECTED_TEAMS} teams, found ${teams.length}`);
  }
  for (const t of teams) {
    if (t.records.length !== EXPECTED_ROWS_PER_TEAM) {
      problems.push(
        `team "${t.name}" has ${t.records.length} players, expected ${EXPECTED_ROWS_PER_TEAM}`,
      );
    }
  }

  // Exactly one captain per team; at most one vice-captain.
  for (const t of teams) {
    const captains = t.records.filter((p) => p.isCaptain);
    const vices = t.records.filter((p) => p.isViceCaptain);
    if (captains.length !== 1) {
      problems.push(`team "${t.name}" has ${captains.length} captains, expected exactly 1`);
    }
    if (vices.length > 1) {
      problems.push(`team "${t.name}" has ${vices.length} vice-captains, expected at most 1`);
    }
    // A duplicate name inside one team is ambiguous for the per-team rule.
    const seen = new Map();
    for (const p of t.records) {
      const n = normalizePlayerName(p.playerName);
      if (seen.has(n)) {
        problems.push(`team "${t.name}" has a duplicate player name "${p.playerName}" (lines ${seen.get(n)} and ${p.line})`);
      } else {
        seen.set(n, p.line);
      }
    }
  }

  // Distinct clubs.
  const clubs = [...new Set(teams.map((t) => t.club))];
  if (clubs.length !== EXPECTED_TEAMS) {
    problems.push(`expected exactly ${EXPECTED_TEAMS} clubs, found ${clubs.length}`);
  }

  if (problems.length > 0) {
    throw new Error(`CSV validation failed with ${problems.length} problem(s):\n  - ${problems.join("\n  - ")}`);
  }

  const records2 = teams.flatMap((t) => t.records);
  return { clubs, teams, records: records2 };
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/** Anchored, escaped, case-insensitive team-name match — the API's rule. */
function teamNameQuery(name, organizationRef) {
  const escaped = String(name).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return { name: { $regex: `^${escaped}$`, $options: "i" }, organizationRef };
}

async function buildPlan({ clubs, teams }) {
  const plan = {
    clubs: [],
    teams: [],
    players: [],
    roleToConfirm: [],
    notes: [],
    conflicts: [],
  };

  const existingOrgs = await TeamOrganization.find({}, { name: 1, slug: 1, owner: 1, isActive: 1 }).lean();
  const orgByFold = new Map(existingOrgs.map((o) => [foldName(o.name), o]));

  for (const clubName of clubs) {
    const existing = orgByFold.get(foldName(clubName));
    if (existing) {
      plan.clubs.push({ name: clubName, status: "exists", id: existing._id, slug: existing.slug || "", owner: existing.owner || null });
    } else {
      plan.clubs.push({ name: clubName, status: "create", id: null, slug: await generateOrgSlug(clubName), owner: null });
    }
  }
  const clubByName = new Map(plan.clubs.map((c) => [foldName(c.name), c]));

  for (const team of teams) {
    const clubEntry = clubByName.get(foldName(team.club));
    let existingTeam = null;
    let roster = [];
    if (clubEntry.status === "exists") {
      existingTeam = await Team.findOne(teamNameQuery(team.name, clubEntry.id))
        .select("name captain viceCaptain isPublic players organizationRef")
        .lean();
    }
    if (existingTeam) {
      roster = await Player.find({ team: existingTeam._id }, { name: 1 }).lean();
    }

    const teamEntry = {
      key: team.key,
      club: team.club,
      clubEntry,
      name: team.name,
      status: existingTeam ? "exists" : "create",
      id: existingTeam ? existingTeam._id : null,
      existingCaptain: existingTeam ? existingTeam.captain : null,
      existingViceCaptain: existingTeam ? existingTeam.viceCaptain : null,
      existingIsPublic: existingTeam ? existingTeam.isPublic : null,
      records: team.records,
    };
    plan.teams.push(teamEntry);

    for (const rec of team.records) {
      const existingPlayer = roster.find((p) => normalizePlayerName(p.name) === normalizePlayerName(rec.playerName));
      plan.players.push({
        ...rec,
        teamKey: team.key,
        status: existingPlayer ? "exists" : "create",
        id: existingPlayer ? existingPlayer._id : null,
      });
      if (!rec.playingRole) {
        plan.roleToConfirm.push({ team: team.name, name: rec.playerName, line: rec.line });
      }
      if (rec.note) {
        plan.notes.push({ team: team.name, name: rec.playerName, line: rec.line, note: rec.note });
      }
    }
  }

  return plan;
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

async function executePlan(plan) {
  const summary = {
    clubsCreated: 0,
    clubsExisting: 0,
    teamsCreated: 0,
    teamsExisting: 0,
    playersCreated: 0,
    playersExisting: 0,
    captainsSet: 0,
    viceCaptainsSet: 0,
    rosterAdds: 0,
    conflicts: [],
  };
  const createdIds = { clubs: [], teams: [], players: [] };

  const clubCategory = await TeamCategory.findOne({ slug: ORG_TYPE }).lean();

  // 1. Clubs (ownerless organizations, no Membership).
  for (const club of plan.clubs) {
    if (club.status === "exists") {
      summary.clubsExisting += 1;
      continue;
    }
    const org = await TeamOrganization.create({
      name: club.name,
      slug: club.slug,
      type: ORG_TYPE,
      owner: null,
      createdBy: null,
      isActive: true,
      verificationStatus: "unverified",
    });
    club.id = org._id;
    club.status = "created";
    summary.clubsCreated += 1;
    createdIds.clubs.push(String(org._id));
  }

  // 2. Teams and their players.
  for (const team of plan.teams) {
    let teamDoc;
    if (team.status === "exists") {
      teamDoc = await Team.findById(team.id);
      summary.teamsExisting += 1;
    } else {
      teamDoc = await createTeam({
        name: team.name,
        organizationRef: team.clubEntry.id,
        organization: team.clubEntry.name,
        type: "local_team",
        category: TEAM_CATEGORY,
        categoryRef: clubCategory ? clubCategory._id : null,
        shortName: team.name.substring(0, 3).toUpperCase(),
        isPublic: true,
      });
      team.id = teamDoc._id;
      team.status = "created";
      summary.teamsCreated += 1;
      createdIds.teams.push(String(teamDoc._id));
    }

    const intendedIds = [];
    let captainId = null;
    let viceId = null;

    for (const player of plan.players.filter((p) => p.teamKey === team.key)) {
      let playerDoc;
      if (player.status === "exists") {
        playerDoc = await Player.findById(player.id);
        summary.playersExisting += 1;
      } else {
        const payload = { name: player.playerName, team: teamDoc._id };
        if (player.playingRole) payload.playingRole = player.playingRole;
        playerDoc = await Player.create(payload);
        player.id = playerDoc._id;
        player.status = "created";
        summary.playersCreated += 1;
        createdIds.players.push(String(playerDoc._id));
      }
      intendedIds.push(playerDoc._id);
      if (player.isCaptain) captainId = playerDoc._id;
      if (player.isViceCaptain) viceId = playerDoc._id;
    }

    if (intendedIds.length > 0) {
      const res = await Team.updateOne(
        { _id: teamDoc._id },
        { $addToSet: { players: { $each: intendedIds } } },
      );
      summary.rosterAdds += res.modifiedCount || 0;
    }

    // Captain / vice-captain. Never silently replace an existing appointment.
    const set = {};
    if (captainId) {
      if (!teamDoc.captain) set.captain = captainId;
      else if (String(teamDoc.captain) !== String(captainId)) {
        summary.conflicts.push(
          `team "${team.name}" already has a different captain; left as-is`,
        );
      }
    }
    if (viceId) {
      if (!teamDoc.viceCaptain) set.viceCaptain = viceId;
      else if (String(teamDoc.viceCaptain) !== String(viceId)) {
        summary.conflicts.push(
          `team "${team.name}" already has a different vice-captain; left as-is`,
        );
      }
    }
    if (Object.keys(set).length > 0) {
      await Team.updateOne({ _id: teamDoc._id }, { $set: set });
      if (set.captain) summary.captainsSet += 1;
      if (set.viceCaptain) summary.viceCaptainsSet += 1;
    }
  }

  return { summary, createdIds };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printPlan(plan, apply) {
  const created = (list) => list.filter((x) => x.status === "create").length;
  const existing = (list) => list.filter((x) => x.status === "exists").length;

  console.log("");
  console.log("=== squads import (clubs / teams / players) =======================");
  console.log(`  Import batch : ${IMPORT_BATCH}`);
  console.log(`  Mode         : ${apply ? "APPLY (--apply)" : "DRY RUN (no writes)"}`);
  console.log(`  Clubs        : ${created(plan.clubs)} to create, ${existing(plan.clubs)} already exist`);
  console.log(`  Teams        : ${created(plan.teams)} to create, ${existing(plan.teams)} already exist`);
  console.log(`  Players      : ${created(plan.players)} to create, ${existing(plan.players)} already exist`);
  console.log("");

  for (const club of plan.clubs) {
    const tag = club.status === "create" ? "CREATE" : "exists";
    console.log(`  [club:${tag}] ${club.name}${club.status === "create" ? `  (slug ${club.slug})` : ""}`);
    for (const team of plan.teams.filter((t) => foldName(t.club) === foldName(club.name))) {
      const teamTag = team.status === "create" ? "CREATE" : "exists";
      console.log(`    [team:${teamTag}] ${team.name}`);
      for (const player of plan.players.filter((p) => p.teamKey === team.key)) {
        const playerTag = player.status === "create" ? "CREATE" : "exists";
        const role = player.playingRole ? player.playingRole : "(role to confirm)";
        const marks = [player.isCaptain ? "C" : "", player.isViceCaptain ? "VC" : ""].filter(Boolean).join(",");
        console.log(`      [player:${playerTag}] ${player.playerName} — ${role}${marks ? ` [${marks}]` : ""}`);
      }
    }
  }

  if (plan.roleToConfirm.length > 0) {
    console.log("");
    console.log(`Role to confirm (${plan.roleToConfirm.length}) — blank in the CSV, nothing invented:`);
    for (const row of plan.roleToConfirm) {
      console.log(`  - ${row.team} / ${row.name} (line ${row.line})`);
    }
  }

  if (plan.notes.length > 0) {
    console.log("");
    console.log(`CSV notes (${plan.notes.length}) — Player has no admin-note field, so these are printed only:`);
    for (const row of plan.notes) {
      console.log(`  - ${row.team} / ${row.name}: ${row.note}`);
    }
  }

  console.log("");
}

function printApplyResult({ summary, createdIds }) {
  console.log("APPLIED.");
  console.log(`  Clubs   : created ${summary.clubsCreated}, already existed ${summary.clubsExisting}`);
  console.log(`  Teams   : created ${summary.teamsCreated}, already existed ${summary.teamsExisting}`);
  console.log(`  Players : created ${summary.playersCreated}, already existed ${summary.playersExisting}`);
  console.log(`  Captain rows set      : ${summary.captainsSet}`);
  console.log(`  Vice-captain rows set : ${summary.viceCaptainsSet}`);
  console.log(`  Roster links added    : ${summary.rosterAdds}`);

  if (summary.conflicts.length > 0) {
    console.log("");
    console.log("Conflicts (left untouched):");
    for (const conflict of summary.conflicts) console.log(`  - ${conflict}`);
  }

  console.log("");
  console.log("Created ids (for a precise rollback — see docs/SQUADS_IMPORT.md):");
  console.log(`  clubs   : ${createdIds.clubs.join(", ") || "(none)"}`);
  console.log(`  teams   : ${createdIds.teams.join(", ") || "(none)"}`);
  console.log(`  players : ${createdIds.players.length} id(s) not printed individually; look them up by team.`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const file = argValue("--file");
  if (!file) {
    throw new Error("No CSV file. Pass --file <csv path>.");
  }
  const apply = process.argv.includes("--apply");

  // Guard first, so a mistargeted URI is refused before the file is even read.
  const url = argValue("--uri") || process.env.MIGRATION_MONGO_URL;
  if (!url) {
    throw new Error(
      "No connection string. Pass --uri <mongodb-uri> explicitly (this script does not read .env), " +
        "or set MIGRATION_MONGO_URL.",
    );
  }

  const { host, databaseName } = getMongoTarget(url);
  const hostname = host.replace(/^.*@/, "").split(":")[0].replace(/^\[|\]$/g, "");
  const allowedHostname = argValue("--allow-host");
  if (!["127.0.0.1", "localhost", "::1", allowedHostname].includes(hostname)) {
    throw new Error(
      `Refusing to import into a non-local MongoDB target: "${hostname}". ` +
        "Loopback only by default. Pass --allow-host=<name> if you really mean " +
        "another host, e.g. a Docker service name on an internal network.",
    );
  }
  const allowedDatabase = argValue("--allow-database") || EXPECTED_DATABASE;
  if (databaseName !== allowedDatabase) {
    throw new Error(
      `Refusing to import into database "${databaseName}". Expected "${allowedDatabase}". ` +
        "Point --uri at the local throwaway database, or pass --allow-database=<name> deliberately.",
    );
  }

  // Validate the whole file before opening a connection: an invalid CSV must
  // never reach the database.
  let parsed;
  try {
    const text = fs.readFileSync(file, "utf8");
    parsed = validateSquads(parseCsv(text));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error(`CSV file not found: ${file}`);
    }
    throw error;
  }

  console.log("");
  console.log(`Target database: ${databaseName || "(unnamed)"} (host guard passed)`);
  console.log(`CSV file: ${file}`);
  console.log(
    `Validated: ${parsed.clubs.length} clubs, ${parsed.teams.length} teams, ${parsed.records.length} players.`,
  );

  await mongoose.connect(url, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });
  try {
    const plan = await buildPlan(parsed);
    printPlan(plan, apply);

    if (!apply) {
      console.log("Dry run complete. Nothing was written. Re-run with --apply to write.");
      return;
    }

    const result = await executePlan(plan);
    printApplyResult(result);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error("");
  console.error(`REFUSING TO RUN: ${error.message}`);
  process.exitCode = 1;
});
