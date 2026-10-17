// Attach profile photos to the players created by importSquads.js for the
// "squads-2026-10" round, from an operator-supplied manifest of
// (team, player_name, file) rows.
//
// What it does
// ------------
//   * Reads a CSV manifest with the columns `team`, `player_name`, `file`.
//   * Resolves each row to exactly one Player that belongs to the import batch
//     created by src/scripts/importSquads.js (the eight ownerless club
//     organizations of the squads-2026-10 round -> their teams -> their
//     players). A row that does not resolve to exactly one player is reported,
//     never guessed, and never written.
//   * Stores the photo through the SAME code path the Admin upload uses:
//     utils/photoStore.js#storeImage (the local uploads directory, the
//     `<epoch>-<hex>-<base>.<ext>` filename scheme, the 5MB / JPEG-PNG-WebP
//     rules) and the same absolute URL the POST /api/upload/image endpoint
//     returns once PUBLIC_BACKEND_URL is set. No new storage scheme.
//   * Sets Player.imageUrl to the resulting absolute URL, exactly as the Admin
//     app does after an upload. The public player/team pages already render
//     `player.imageUrl` via SafeImage, so no frontend change is needed.
//
// What it deliberately does NOT do
// --------------------------------
//   * It never creates, renames or deletes a Player.
//   * It never touches a player outside the squads-2026-10 batch.
//   * It never deletes a file. If --force replaces an existing photo the
//     previous file is left on disk (sweep it with
//     `npm run db:cleanup-uploads:apply`, which only removes files no document
//     references).
//   * It never invents data and never guesses: an ambiguous match (a team or a
//     player name that matches more than one record) is skipped and reported.
//
// Idempotency
// -----------
//   * A re-run with --apply changes nothing: a player that already has a photo
//     is reported under "already have photo" and skipped.
//   * --force re-uploads for players that already have one.
//   * A dry run is the default and writes nothing (no file, no document).
//
// Batch scope
// -----------
//   There is no importBatch field on any model (see docs/SQUADS_IMPORT.md §7).
//   The batch is identified, exactly like that document's verify/rollback
//   queries, by the eight club organization names the import created. A player
//   is in scope only if its team is linked (Team.organizationRef) to one of
//   those clubs.
//
// Usage
// -----
//   node src/scripts/attachPlayerPhotos.js \
//     --manifest <csv> --dir <photos dir> --uri <mongodb-uri>            # dry run (default)
//   node src/scripts/attachPlayerPhotos.js \
//     --manifest <csv> --dir <photos dir> --uri <mongodb-uri> --apply    # write
//
//   --force re-uploads when a player already has a photo.
//
// Containerized deployments (the database hostname is a Docker service name
// such as `mongodb`, not loopback) must name it deliberately:
//
//   node src/scripts/attachPlayerPhotos.js \
//     --manifest /tmp/player-photos/manifest.csv \
//     --dir /tmp/player-photos \
//     --uri "$MONGO_URL" --allow-host mongodb --allow-database cric-all --apply
//
// The URI is passed explicitly on the command line. This script deliberately
// does NOT load .env, so it cannot pick up a connection string for an
// environment other than the one named, and it never prints the URI or its
// credentials.
//
// PUBLIC_BACKEND_URL must be set to the backend's public origin (the same value
// the Admin upload returns), because the stored URL must be absolute: the Admin
// app renders `player.imageUrl` in a raw <img>. The script fails fast if it is
// unset rather than guessing a host. In a container, pass it explicitly:
//
//   docker exec -e PUBLIC_BACKEND_URL=https://cricall.example.com cricall-backend \
//     sh -c 'node src/scripts/attachPlayerPhotos.js ... --apply'
//
// Two guards, both of which must pass (same shape as importSquads.js):
//   1. the host must be loopback (127.0.0.1 / localhost / ::1), or named with
//      --allow-host=<name>;
//   2. the database must be the local throwaway database, or named with
//      --allow-database=<name>.
//
// The manifest (and every referenced file's type and path) is validated
// completely BEFORE the database is touched, so an invalid manifest fails
// without a single write. Missing files are reported per row but are not fatal.

import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import Player from "../models/Player.js";
import Team from "../models/Team.js";
import TeamOrganization from "../models/TeamOrganization.js";
import { normalizePlayerName } from "../services/playerService.js";
import { ensureUploadsDir, storeImage, uploadsDir } from "../utils/photoStore.js";
import { getMongoTarget } from "../utils/mongoTarget.js";

// No background index build while we read the batch and update players.
mongoose.set("autoIndex", false);

const EXPECTED_DATABASE = "cric-all-e2e";
const PHOTO_BATCH = "squads-2026-10";

// The eight club organizations the squads-2026-10 import created (one team per
// club, named identically). Matched case-folded / whitespace-collapsed, the
// same fold importSquads.js uses for club names.
const BATCH_CLUBS = [
  "Ittehad Sports",
  "Baldia Zalmi",
  "Sky Sports",
  "Orangi United",
  "Young Star",
  "Khan Associates",
  "Family Stallions",
  "Orangi Warriors",
];

const REQUIRED_HEADERS = ["team", "player_name", "file"];

// The upload path accepts exactly these mimetypes (uploadRoutes.js fileFilter +
// photoStore.js ALLOWED_EXTENSIONS). The manifest names a file, so the type is
// derived from its extension and refused here if it is not one of these.
const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const OUTCOME = {
  WILL_ATTACH: "will-attach",
  ALREADY: "already-have-photo",
  MISSING: "missing-file",
  UNMATCHED: "unmatched",
  AMBIGUOUS: "ambiguous",
  DUPLICATE: "duplicate",
};

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

// ---------------------------------------------------------------------------
// CSV parsing (same minimal RFC4180 reader as importSquads.js is not imported
// because that module runs its own main() on import; this copy is standalone).
// ---------------------------------------------------------------------------

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
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ""));
}

/**
 * Parses and structurally validates the manifest. Throws (listing every
 * problem) for a missing column or a row with a blank team/player/file, so a
 * malformed manifest never reaches the database.
 */
export function parseManifest(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error("The manifest is empty.");

  const header = rows[0].map((h) => String(h).trim().toLowerCase());
  const index = {};
  const headerProblems = [];
  for (const name of REQUIRED_HEADERS) {
    const at = header.indexOf(name);
    if (at === -1) headerProblems.push(`missing required column "${name}"`);
    index[name] = at;
  }
  if (headerProblems.length > 0) {
    throw new Error(`Invalid manifest header: ${headerProblems.join("; ")}. Required: ${REQUIRED_HEADERS.join(", ")}.`);
  }

  const records = [];
  const problems = [];
  for (let r = 1; r < rows.length; r += 1) {
    const line = r + 1;
    const cells = rows[r];
    const team = String(cells[index.team] ?? "").trim();
    const playerName = String(cells[index.player_name] ?? "").trim();
    const file = String(cells[index.file] ?? "").trim();
    if (!team || !playerName || !file) {
      problems.push(`line ${line}: team, player_name and file are all required`);
      continue;
    }
    records.push({ line, team, playerName, file });
  }
  if (problems.length > 0) {
    throw new Error(`Invalid manifest with ${problems.length} problem(s):\n  - ${problems.join("\n  - ")}`);
  }
  return records;
}

/**
 * Resolves a manifest `file` against the photos directory, refusing anything
 * that could escape it (`..`, an absolute path, an embedded NUL).
 */
export function resolvePhotoPath(dir, file) {
  if (typeof file !== "string" || file.includes("\0")) return null;
  const base = path.resolve(dir);
  const target = path.resolve(base, file);
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}

function mimeFor(file) {
  return MIME_BY_EXT[path.extname(file).toLowerCase()] || null;
}

/**
 * The origin the public and Admin SPAs load uploads from — the same base
 * `uploadController.getPublicUploadUrl(req)` computes once PUBLIC_BACKEND_URL is
 * set. The script has no HTTP request of its own, so it requires the configured
 * override rather than guessing a host: an absolute URL is what makes both
 * `SafeImage` (public pages) and the Admin app's raw `<img>` render the photo.
 */
export function publicUploadBase(env = process.env) {
  const base = (env.PUBLIC_BACKEND_URL || "").replace(/\/+$/, "");
  if (!base) {
    throw new Error(
      "PUBLIC_BACKEND_URL is not set, so the stored photo URL cannot be made absolute. " +
        "Set it to the backend's public origin (the value the Admin upload returns), " +
        "e.g. PUBLIC_BACKEND_URL=https://cricall.example.com.",
    );
  }
  return base;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/**
 * Resolves every manifest row against the squads-2026-10 batch. Read-only.
 * Each row gets exactly one `outcome`. A player already carrying a photo is an
 * ALREADY row unless `force` is set, in which case it is re-uploaded.
 */
async function buildPlan(rows, { force }) {
  const plan = {
    rows,
    willAttach: [],
    alreadyHavePhoto: [],
    missingFile: [],
    unmatched: [],
    ambiguous: [],
    duplicate: [],
    clubOrgs: [],
    teams: [],
  };

  // 1. The eight batch clubs.
  const orgs = await TeamOrganization.find({}).select("name type owner").lean();
  const batchFolds = new Set(BATCH_CLUBS.map(foldName));
  const orgsByName = new Map();
  for (const org of orgs) {
    const key = foldName(org.name);
    if (!batchFolds.has(key)) continue;
    if (!orgsByName.has(key)) orgsByName.set(key, []);
    orgsByName.get(key).push(org);
  }
  plan.clubOrgs = orgsByName;

  const clubIds = [];
  for (const fold of batchFolds) {
    const list = orgsByName.get(fold) || [];
    if (list.length === 1) clubIds.push(list[0]._id);
  }

  // 2. Their teams, indexed by folded name.
  const teams = clubIds.length
    ? await Team.find({ organizationRef: { $in: clubIds } }).select("name organizationRef").lean()
    : [];
  plan.teams = teams;
  const orgNameById = new Map(orgs.map((o) => [String(o._id), o.name]));
  const teamsByFold = new Map();
  for (const team of teams) {
    const key = foldName(team.name);
    if (!teamsByFold.has(key)) teamsByFold.set(key, []);
    teamsByFold.get(key).push(team);
  }

  // 3. Each manifest row -> at most one player.
  for (const row of rows) {
    row.club = "";
    row.teamId = null;
    row.playerId = null;
    row.existingImageUrl = "";
    row.reason = "";

    if (row.duplicate) {
      row.outcome = OUTCOME.DUPLICATE;
      plan.duplicate.push(row);
      continue;
    }

    const teamCandidates = teamsByFold.get(foldName(row.team)) || [];
    if (teamCandidates.length === 0) {
      row.reason = `no team "${row.team}" in the ${PHOTO_BATCH} batch`;
      row.outcome = OUTCOME.UNMATCHED;
      plan.unmatched.push(row);
      continue;
    }
    if (teamCandidates.length > 1) {
      row.reason = `team "${row.team}" matches ${teamCandidates.length} batch teams`;
      row.outcome = OUTCOME.AMBIGUOUS;
      plan.ambiguous.push(row);
      continue;
    }

    const team = teamCandidates[0];
    row.teamId = team._id;
    row.club = orgNameById.get(String(team.organizationRef)) || "";

    const roster = await Player.find({ team: team._id }).select("name imageUrl").lean();
    const wanted = normalizePlayerName(row.playerName);
    const playerMatches = roster.filter((p) => normalizePlayerName(p.name) === wanted);

    if (playerMatches.length === 0) {
      row.reason = `no player named "${row.playerName}" in team "${row.team}"`;
      row.outcome = OUTCOME.UNMATCHED;
      plan.unmatched.push(row);
      continue;
    }
    if (playerMatches.length > 1) {
      row.reason = `"${row.playerName}" matches ${playerMatches.length} players in team "${row.team}"`;
      row.outcome = OUTCOME.AMBIGUOUS;
      plan.ambiguous.push(row);
      continue;
    }

    const player = playerMatches[0];
    row.playerId = player._id;
    row.existingImageUrl = player.imageUrl || "";

    if (row.missing) {
      row.outcome = OUTCOME.MISSING;
      plan.missingFile.push(row);
    } else if (row.existingImageUrl && !force) {
      row.outcome = OUTCOME.ALREADY;
      plan.alreadyHavePhoto.push(row);
    } else {
      row.outcome = OUTCOME.WILL_ATTACH;
      plan.willAttach.push(row);
    }
  }

  return plan;
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

async function executePlan(plan, publicBase) {
  ensureUploadsDir();
  const base = publicBase;
  const summary = { attached: 0, errors: [], stored: [] };

  for (const row of plan.willAttach) {
    try {
      const buffer = await fs.promises.readFile(row.full);
      const { url } = await storeImage(buffer, row.mime, path.basename(row.file));
      const imageUrl = `${base}${url}`;
      await Player.updateOne({ _id: row.playerId }, { $set: { imageUrl } });
      row.storedImageUrl = imageUrl;
      summary.attached += 1;
      if (summary.stored.length < 5) summary.stored.push({ row, imageUrl });
    } catch (error) {
      summary.errors.push(`${row.team} / ${row.playerName}: ${error.message}`);
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printRow(tag, row) {
  const where = row.club && row.club !== row.team ? `${row.team} (club: ${row.club})` : row.team;
  const detail = row.reason ? `  (${row.reason})` : row.file ? `  <- ${row.file}` : "";
  console.log(`  [${tag}] ${where} / ${row.playerName}${detail}`);
}

function printPlan(plan, apply, force) {
  const matched = plan.willAttach.length + plan.alreadyHavePhoto.length + plan.missingFile.length;
  const clubsFound = [...plan.clubOrgs.entries()].filter(([, list]) => list.length === 1).length;

  console.log("");
  console.log("=== player photos attach (squads-2026-10) =====================");
  console.log(`  Photo batch   : ${PHOTO_BATCH}`);
  console.log(`  Mode          : ${apply ? "APPLY (--apply)" : "DRY RUN (no writes)"}`);
  console.log(`  Force         : ${force ? "yes (re-upload existing photos)" : "no (players with a photo are skipped)"}`);
  console.log(`  Manifest rows : ${plan.rows.length}`);
  console.log(`  Matched       : ${matched}`);
  console.log(`    will attach        : ${plan.willAttach.length}`);
  console.log(`    already have photo : ${plan.alreadyHavePhoto.length}`);
  console.log(`    missing file       : ${plan.missingFile.length}`);
  console.log(`  Unmatched     : ${plan.unmatched.length}`);
  console.log(`  Ambiguous     : ${plan.ambiguous.length}`);
  console.log(`  Duplicate rows: ${plan.duplicate.length}`);
  console.log(`  Batch clubs found : ${clubsFound}/${BATCH_CLUBS.length}`);
  console.log(`  Batch teams found : ${plan.teams.length}`);
  console.log("");

  for (const row of plan.willAttach) printRow("attach", row);
  for (const row of plan.alreadyHavePhoto) printRow("has-photo", row);
  for (const row of plan.missingFile) printRow("missing-file", row);
  for (const row of plan.unmatched) {
    console.log(`  [unmatched] line ${row.line}: ${row.team} / ${row.playerName}  (${row.reason})`);
  }
  for (const row of plan.ambiguous) {
    console.log(`  [ambiguous] line ${row.line}: ${row.team} / ${row.playerName}  (${row.reason})`);
  }
  for (const row of plan.duplicate) {
    console.log(`  [duplicate] line ${row.line}: ${row.team} / ${row.playerName}`);
  }
  console.log("");
}

function printApplyResult(summary) {
  console.log("APPLIED.");
  console.log(`  Photos attached : ${summary.attached}`);
  console.log(`  Errors          : ${summary.errors.length}`);
  console.log(`  Stored in       : ${uploadsDir}`);

  if (summary.stored.length > 0) {
    console.log("");
    console.log("  Sample stored URLs:");
    for (const { row, imageUrl } of summary.stored) {
      console.log(`    ${row.team} / ${row.playerName} -> ${imageUrl}`);
    }
  }

  if (summary.errors.length > 0) {
    console.log("");
    console.log("Errors:");
    for (const error of summary.errors) console.log(`  - ${error}`);
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const manifestPath = argValue("--manifest");
  if (!manifestPath) throw new Error("No manifest file. Pass --manifest <csv path>.");
  const dir = argValue("--dir");
  if (!dir) throw new Error("No photos directory. Pass --dir <photos dir>.");
  const apply = process.argv.includes("--apply");
  const force = process.argv.includes("--force");

  // Guard first, so a mistargeted URI is refused before the manifest is read.
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
      `Refusing to attach photos into a non-local MongoDB target: "${hostname}". ` +
        "Loopback only by default. Pass --allow-host=<name> if you really mean " +
        "another host, e.g. a Docker service name on an internal network.",
    );
  }
  const allowedDatabase = argValue("--allow-database") || EXPECTED_DATABASE;
  if (databaseName !== allowedDatabase) {
    throw new Error(
      `Refusing to attach photos into database "${databaseName}". Expected "${allowedDatabase}". ` +
        "Point --uri at the local throwaway database, or pass --allow-database=<name> deliberately.",
    );
  }

  // The stored URL must be absolute; require the configured public origin up
  // front so we fail before touching the database (or the manifest).
  const publicBase = publicUploadBase();

  // Validate the whole manifest before opening a connection.
  let records;
  try {
    records = parseManifest(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error(`Manifest file not found: ${manifestPath}`);
    }
    throw error;
  }

  // Resolve file paths/types and detect duplicate manifest rows (no DB yet).
  const structuralProblems = [];
  const rows = records.map((record) => {
    const full = resolvePhotoPath(dir, record.file);
    if (!full) {
      structuralProblems.push(`line ${record.line}: unsafe file path "${record.file}"`);
      return { ...record, full: null, mime: null, missing: true, duplicate: false };
    }
    const mime = mimeFor(record.file);
    if (!mime) {
      structuralProblems.push(
        `line ${record.line}: unsupported file type "${path.extname(record.file)}" for "${record.file}" ` +
          "(only .jpg/.jpeg/.png/.webp)",
      );
      return { ...record, full, mime: null, missing: true, duplicate: false };
    }
    return { ...record, full, mime, missing: !fs.existsSync(full), duplicate: false };
  });

  if (structuralProblems.length > 0) {
    throw new Error(
      `Manifest validation failed with ${structuralProblems.length} problem(s):\n  - ${structuralProblems.join("\n  - ")}`,
    );
  }

  const firstSeen = new Map();
  rows.forEach((row, index) => {
    const key = `${foldName(row.team)}::${normalizePlayerName(row.playerName)}`;
    if (firstSeen.has(key)) {
      rows[firstSeen.get(key)].duplicate = true;
      row.duplicate = true;
    } else {
      firstSeen.set(key, index);
    }
  });

  console.log("");
  console.log(`Target database: ${databaseName || "(unnamed)"} (host guard passed)`);
  console.log(`Manifest file: ${manifestPath}`);
  console.log(`Photos dir   : ${dir}`);

  await mongoose.connect(url, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });
  try {
    const plan = await buildPlan(rows, { force });
    printPlan(plan, apply, force);

    if (!apply) {
      console.log("Dry run complete. Nothing was written. Re-run with --apply to write.");
      return;
    }

    const result = await executePlan(plan, publicBase);
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
