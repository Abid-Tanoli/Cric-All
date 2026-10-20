// Attach logos to existing teams from an operator-supplied manifest of
// (team, file) rows. One-off companion to attachPlayerPhotos.js, built on the
// same pattern: dry-run by default, --apply to write, idempotent, per-row
// reporting, and the exact same storage code path the Admin upload uses.
//
// What it does
// ------------
//   * Reads a CSV manifest with the columns `team`, `file`.
//   * Resolves each row to EXACTLY ONE existing Team by name (trimmed,
//     whitespace-collapsed, case-insensitive — the same fold the API uses).
//     A row that does not resolve to exactly one team is reported and never
//     written. Teams are NEVER created, renamed or deleted; a manifest can
//     only reach teams that already exist.
//   * Stores the logo through the SAME code path the Admin upload uses:
//     utils/photoStore.js#storeImage (the local uploads directory, the
//     `<epoch>-<hex>-<base>.<ext>` filename scheme, the JPEG-PNG-WebP rules)
//     and the same absolute URL the POST /api/upload/image endpoint returns
//     once PUBLIC_BACKEND_URL is set. No new storage scheme.
//   * Sets Team.logo to the resulting absolute URL, exactly as the Admin app
//     does after an upload. The Admin app renders `team.logo` in a raw <img>,
//     so the URL must be absolute — the script fails fast if PUBLIC_BACKEND_URL
//     is unset rather than guessing a host.
//   * Only teams listed in the manifest are ever touched. A team whose name
//     uses a reserved test prefix (utils/publicProjection.js) is skipped.
//
// What it deliberately does NOT do
// --------------------------------
//   * It never creates, renames or deletes a Team. Matching an existing team
//     is the only way in.
//   * It never touches a team that is not listed in the manifest.
//   * It never deletes a file. If --force replaces an existing logo the
//     previous file is left on disk (sweep it with
//     `npm run db:cleanup-uploads:apply`, which only removes files no document
//     references).
//   * It never invents data and never guesses: an ambiguous match (a team
//     name that matches more than one team, e.g. two organizations owning a
//     "Rising Stars") is reported and skipped.
//   * It never touches scoring code, players or the 12th Man rule.
//
// Idempotency
// -----------
//   * A re-run with --apply changes nothing: a team that already has a logo
//     is reported under "already has logo" and skipped.
//   * --force re-uploads for teams that already have a logo.
//   * --clear (with --apply) unsets Team.logo for exactly the teams listed in
//     the manifest — the documented rollback. It does not read or check the
//     image files at all.
//   * A dry run is the default and writes nothing (no file, no document).
//
// Exit code
// ---------
//   The script exits non-zero when any manifest row cannot be matched to
//   exactly one team, or any referenced file is missing, not a
//   png/jpg/webp, over 5 MB, or an unsafe path. Intentional skips (team
//   already has a logo, duplicate row, reserved test name) do not fail the
//   run.
//
// Usage
// -----
//   node src/scripts/attachTeamLogos.js \
//     --manifest <csv> --dir <logos dir> --uri <mongodb-uri>            # dry run (default)
//   node src/scripts/attachTeamLogos.js \
//     --manifest <csv> --dir <logos dir> --uri <mongodb-uri> --apply    # write
//
//   --force re-uploads when a team already has a logo.
//   --clear unsets the logo for the manifest's teams instead (rollback);
//           --dir is not needed with --clear.
//
// Containerized deployments (the database hostname is a Docker service name
// such as `mongodb`, not loopback) must name it deliberately:
//
//   node src/scripts/attachTeamLogos.js \
//     --manifest /tmp/team-logos/manifest.csv \
//     --dir /tmp/team-logos \
//     --uri "$MONGO_URL" --allow-host mongodb --allow-database cric-all --apply
//
// The URI is passed explicitly on the command line. This script deliberately
// does NOT load .env, so it cannot pick up a connection string for an
// environment other than the one named, and it never prints the URI or its
// credentials.
//
// PUBLIC_BACKEND_URL must be set to the backend's public origin (the same value
// the Admin upload returns), because the stored URL must be absolute: the Admin
// app renders `team.logo` in a raw <img>. The script fails fast if it is
// unset rather than guessing a host. In a container, pass it explicitly:
//
//   docker exec -e PUBLIC_BACKEND_URL=https://api.cricall.online cricall-backend \
//     sh -c 'node src/scripts/attachTeamLogos.js ... --apply'
//
// Two guards, both of which must pass (same shape as attachPlayerPhotos.js):
//   1. the host must be loopback (127.0.0.1 / localhost / ::1), or named with
//      --allow-host=<name>;
//   2. the database must be the local throwaway database, or named with
//      --allow-database=<name>.
//
// The manifest (and every referenced file's type, size and path) is validated
// completely BEFORE the database is touched, so an invalid manifest fails
// without a single write.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import Team from "../models/Team.js";
import { isReservedTestName } from "../utils/publicProjection.js";
import { ensureUploadsDir, storeImage, uploadsDir } from "../utils/photoStore.js";
import { getMongoTarget } from "../utils/mongoTarget.js";

// No background index build while we read teams and update logos.
mongoose.set("autoIndex", false);

const EXPECTED_DATABASE = "cric-all-e2e";

const REQUIRED_HEADERS = ["team", "file"];

// The upload path accepts exactly these mimetypes (uploadRoutes.js fileFilter +
// photoStore.js ALLOWED_EXTENSIONS). The manifest names a file, so the type is
// derived from its extension and refused here if it is not one of these.
const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

// Same 5 MB cap the Admin upload enforces (multer limits.fileSize). storeImage
// itself does not check size — the HTTP layer does — so the script enforces it.
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

const OUTCOME = {
  ATTACH: "attach",
  WILL_CLEAR: "will-clear",
  HAS_LOGO: "has-logo",
  NOTHING_TO_CLEAR: "nothing-to-clear",
  RESERVED: "reserved",
  DUPLICATE: "duplicate",
  UNMATCHED: "unmatched",
  AMBIGUOUS: "ambiguous",
  MISSING: "missing-file",
  BAD_TYPE: "bad-type",
  OVERSIZE: "oversize",
  UNSAFE_PATH: "unsafe-path",
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
export function foldName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// CSV parsing (standalone copy of the minimal RFC4180 reader used by
// attachPlayerPhotos.js; that module runs its own main() on import).
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
 * problem) for a missing column or a row with a blank team/file, so a
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
    const file = String(cells[index.file] ?? "").trim();
    if (!team || !file) {
      problems.push(`line ${line}: team and file are both required`);
      continue;
    }
    records.push({ line, team, file });
  }
  if (problems.length > 0) {
    throw new Error(`Invalid manifest with ${problems.length} problem(s):\n  - ${problems.join("\n  - ")}`);
  }
  return records;
}

/**
 * Resolves a manifest `file` against the logos directory, refusing anything
 * that could escape it (`..`, an absolute path, an embedded NUL).
 */
export function resolveLogoPath(dir, file) {
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
 * override rather than guessing a host: an absolute URL is what makes the
 * Admin app's raw `<img src={team.logo}>` render the logo.
 */
export function publicUploadBase(env = process.env) {
  const base = (env.PUBLIC_BACKEND_URL || "").replace(/\/+$/, "");
  if (!base) {
    throw new Error(
      "PUBLIC_BACKEND_URL is not set, so the stored logo URL cannot be made absolute. " +
        "Set it to the backend's public origin (the value the Admin upload returns), " +
        "e.g. PUBLIC_BACKEND_URL=https://api.cricall.online.",
    );
  }
  return base;
}

/**
 * Validates every manifest row's file against the logos directory (read-only,
 * no database): unsafe paths, unsupported extensions, missing files and files
 * over 5 MB are flagged per row. In --clear mode no file is consulted at all,
 * because the manifest is only a list of teams to unset.
 */
export function inspectFiles(records, dir, { clear = false } = {}) {
  return records.map((record) => {
    const row = { ...record, full: null, mime: null, unsafe: false, badType: false, missing: false, oversize: false };
    if (clear) return row;

    const full = resolveLogoPath(dir, record.file);
    if (!full) {
      row.unsafe = true;
      return row;
    }
    row.full = full;

    const mime = mimeFor(record.file);
    if (!mime) {
      row.badType = true;
      return row;
    }
    row.mime = mime;

    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      row.missing = true;
      return row;
    }
    if (!stat.isFile()) {
      row.missing = true;
      return row;
    }
    if (stat.size > MAX_LOGO_BYTES) {
      row.oversize = true;
    }
    return row;
  });
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/**
 * Resolves every manifest row against the loaded teams. Read-only. Each row
 * gets exactly one `outcome`:
 *
 *   attach / will-clear        -> will be written under --apply
 *   has-logo / nothing-to-clear / reserved / duplicate -> intentional skip
 *   unmatched / ambiguous / missing-file / bad-type / oversize / unsafe-path
 *                              -> error; any of these makes the run exit
 *                                 non-zero and the row is never written
 *
 * `teams` is the full list of existing teams ({ _id, name, logo }); a team
 * not listed in the manifest simply never appears in the plan.
 */
export function planRows(rows, teams, { force = false, clear = false, isReserved = isReservedTestName } = {}) {
  const teamsByFold = new Map();
  for (const team of teams) {
    const key = foldName(team.name);
    if (!teamsByFold.has(key)) teamsByFold.set(key, []);
    teamsByFold.get(key).push(team);
  }

  const plan = {
    rows,
    attach: [],
    willClear: [],
    hasLogo: [],
    nothingToClear: [],
    reserved: [],
    duplicate: [],
    errors: [],
  };

  // A repeated team row would either double-write the same team under --force
  // or silently depend on row order, so BOTH rows of a duplicate pair are
  // reported and skipped (same rule as attachPlayerPhotos.js).
  const firstSeen = new Map();
  rows.forEach((row, index) => {
    const key = foldName(row.team);
    if (firstSeen.has(key)) {
      rows[firstSeen.get(key)].duplicate = true;
      row.duplicate = true;
    } else {
      firstSeen.set(key, index);
    }
  });

  for (const row of rows) {
    row.teamId = null;
    row.teamName = "";
    row.existingLogo = "";
    row.reason = "";

    if (isReserved(row.team)) {
      row.reason = `manifest team name "${row.team}" uses a reserved test prefix`;
      row.outcome = OUTCOME.RESERVED;
      plan.reserved.push(row);
      continue;
    }

    const candidates = teamsByFold.get(foldName(row.team)) || [];
    if (candidates.length === 0) {
      row.reason = `no team named "${row.team}"`;
      row.outcome = OUTCOME.UNMATCHED;
      plan.errors.push(row);
      continue;
    }
    if (candidates.length > 1) {
      row.reason = `team "${row.team}" matches ${candidates.length} teams`;
      row.outcome = OUTCOME.AMBIGUOUS;
      plan.errors.push(row);
      continue;
    }

    const team = candidates[0];
    row.teamId = team._id;
    row.teamName = team.name;
    row.existingLogo = team.logo || "";

    if (isReserved(team.name)) {
      row.reason = `team "${team.name}" uses a reserved test prefix`;
      row.outcome = OUTCOME.RESERVED;
      plan.reserved.push(row);
      continue;
    }

    if (row.duplicate) {
      row.reason = `duplicate manifest row for "${row.team}"`;
      row.outcome = OUTCOME.DUPLICATE;
      plan.duplicate.push(row);
      continue;
    }

    if (clear) {
      if (!row.existingLogo) {
        row.reason = "team has no logo to clear";
        row.outcome = OUTCOME.NOTHING_TO_CLEAR;
        plan.nothingToClear.push(row);
      } else {
        row.outcome = OUTCOME.WILL_CLEAR;
        plan.willClear.push(row);
      }
      continue;
    }

    if (row.unsafe) {
      row.reason = `unsafe file path "${row.file}"`;
      row.outcome = OUTCOME.UNSAFE_PATH;
      plan.errors.push(row);
      continue;
    }
    if (row.badType) {
      row.reason = `unsupported file type "${path.extname(row.file)}" (only .jpg/.jpeg/.png/.webp)`;
      row.outcome = OUTCOME.BAD_TYPE;
      plan.errors.push(row);
      continue;
    }
    if (row.missing) {
      row.reason = `file not found: ${row.file}`;
      row.outcome = OUTCOME.MISSING;
      plan.errors.push(row);
      continue;
    }
    if (row.oversize) {
      row.reason = `file is over ${MAX_LOGO_BYTES / (1024 * 1024)} MB`;
      row.outcome = OUTCOME.OVERSIZE;
      plan.errors.push(row);
      continue;
    }
    if (row.existingLogo && !force) {
      row.reason = "already has logo (use --force to replace)";
      row.outcome = OUTCOME.HAS_LOGO;
      plan.hasLogo.push(row);
      continue;
    }

    row.outcome = OUTCOME.ATTACH;
    plan.attach.push(row);
  }

  return plan;
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

async function executePlan(plan, publicBase) {
  ensureUploadsDir();
  const summary = { attached: 0, cleared: 0, errors: [], stored: [] };

  for (const row of plan.attach) {
    try {
      const buffer = await fs.promises.readFile(row.full);
      const { url } = await storeImage(buffer, row.mime, path.basename(row.file));
      const logoUrl = `${publicBase}${url}`;
      await Team.updateOne({ _id: row.teamId }, { $set: { logo: logoUrl } });
      row.storedLogoUrl = logoUrl;
      summary.attached += 1;
      if (summary.stored.length < 10) summary.stored.push({ row, logoUrl });
    } catch (error) {
      summary.errors.push(`${row.team}: ${error.message}`);
    }
  }

  for (const row of plan.willClear) {
    try {
      await Team.updateOne({ _id: row.teamId }, { $unset: { logo: "" } });
      summary.cleared += 1;
    } catch (error) {
      summary.errors.push(`${row.team}: ${error.message}`);
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printRow(tag, row) {
  const id = row.teamId ? String(row.teamId) : "-";
  const detail = row.reason ? `  (${row.reason})` : "";
  console.log(`  [${tag}] ${row.team}  id=${id}  file=${row.file}${detail}`);
}

function printPlan(plan, { apply, force, clear }) {
  const matched = plan.attach.length + plan.willClear.length + plan.hasLogo.length + plan.nothingToClear.length;

  console.log("");
  console.log(`=== team logos ${clear ? "clear" : "attach"} ==============================`);
  console.log(`  Mode          : ${apply ? "APPLY (--apply)" : "DRY RUN (no writes)"}${clear ? " / CLEAR" : ""}`);
  console.log(`  Force         : ${force ? "yes (replace existing logos)" : "no (teams with a logo are skipped)"}`);
  console.log(`  Manifest rows : ${plan.rows.length}`);
  console.log(`  Matched       : ${matched}`);
  if (clear) {
    console.log(`    will clear          : ${plan.willClear.length}`);
    console.log(`    nothing to clear    : ${plan.nothingToClear.length}`);
  } else {
    console.log(`    will attach         : ${plan.attach.length}`);
    console.log(`    already have logo   : ${plan.hasLogo.length}`);
  }
  console.log(`  Reserved skip : ${plan.reserved.length}`);
  console.log(`  Duplicate rows: ${plan.duplicate.length}`);
  console.log(`  Errors        : ${plan.errors.length}`);
  console.log("");

  if (clear) {
    for (const row of plan.willClear) printRow("clear", row);
    for (const row of plan.nothingToClear) printRow("skip", row);
  } else {
    for (const row of plan.attach) printRow("ok", row);
    for (const row of plan.hasLogo) printRow("skip", row);
  }
  for (const row of plan.reserved) printRow("skip", row);
  for (const row of plan.duplicate) printRow("skip", row);
  for (const row of plan.errors) printRow("error", row);
  console.log("");
}

function printApplyResult(summary, { clear }) {
  console.log("APPLIED.");
  if (clear) {
    console.log(`  Logos cleared : ${summary.cleared}`);
  } else {
    console.log(`  Logos attached: ${summary.attached}`);
    console.log(`  Stored in     : ${uploadsDir}`);
    if (summary.stored.length > 0) {
      console.log("");
      console.log("  Stored URLs:");
      for (const { row, logoUrl } of summary.stored) {
        console.log(`    ${row.team} -> ${logoUrl}`);
      }
    }
  }
  console.log(`  Errors        : ${summary.errors.length}`);
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
  const apply = process.argv.includes("--apply");
  const force = process.argv.includes("--force");
  const clear = process.argv.includes("--clear");
  const dir = argValue("--dir");
  if (!dir && !clear) throw new Error("No logos directory. Pass --dir <logos dir> (not needed with --clear).");

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
      `Refusing to attach logos into a non-local MongoDB target: "${hostname}". ` +
        "Loopback only by default. Pass --allow-host=<name> if you really mean " +
        "another host, e.g. a Docker service name on an internal network.",
    );
  }
  const allowedDatabase = argValue("--allow-database") || EXPECTED_DATABASE;
  if (databaseName !== allowedDatabase) {
    throw new Error(
      `Refusing to attach logos into database "${databaseName}". Expected "${allowedDatabase}". ` +
        "Point --uri at the local throwaway database, or pass --allow-database=<name> deliberately.",
    );
  }

  // The stored URL must be absolute; require the configured public origin up
  // front so we fail before touching the database (or the manifest). Clearing
  // writes no URL, so it does not need the override.
  const publicBase = clear ? "" : publicUploadBase();

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

  const rows = inspectFiles(records, dir, { clear });

  console.log("");
  console.log(`Target database: ${databaseName || "(unnamed)"} (host guard passed)`);
  console.log(`Manifest file  : ${manifestPath}`);
  if (!clear) console.log(`Logos dir      : ${dir}`);

  await mongoose.connect(url, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });
  try {
    const teams = await Team.find({}).select("name logo").lean();
    const plan = planRows(rows, teams, { force, clear });
    printPlan(plan, { apply, force, clear });

    let failed = plan.errors.length > 0;

    if (!apply) {
      console.log("Dry run complete. Nothing was written. Re-run with --apply to write.");
    } else {
      const result = await executePlan(plan, publicBase);
      printApplyResult(result, { clear });
      failed = failed || result.errors.length > 0;
    }

    if (failed) {
      console.log(
        "FINISHED WITH ERRORS: one or more rows could not be matched to exactly one team, " +
          "or their file was missing/invalid (see the [error] rows above). Nothing was guessed.",
      );
      return 1;
    }
    return 0;
  } finally {
    await mongoose.disconnect();
  }
}

// Only run when executed directly (`node src/scripts/attachTeamLogos.js`);
// the unit test imports the pure functions above without a database.
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main()
    .then((code) => {
      if (code) process.exitCode = code;
    })
    .catch((error) => {
      console.error("");
      console.error(`REFUSING TO RUN: ${error.message}`);
      process.exitCode = 1;
    });
}
