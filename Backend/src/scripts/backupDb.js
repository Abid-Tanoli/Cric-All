import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { getMongoTarget } from "../utils/mongoTarget.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const BACKUP_FILE_PREFIX = "backup-";
const BACKUP_FILE_EXT = ".archive.gz";
const DEFAULT_MONGO_CONTAINER = "cricall-mongo";
const DEFAULT_KEEP_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

// BACKUP_KEEP_DAYS is a retention window in days, not a file count. A value of
// 0 keeps only the newest archive; an unset/invalid value falls back to 14.
export function parseKeepDays(value = process.env.BACKUP_KEEP_DAYS) {
  if (value === undefined || value === null || value === "") return DEFAULT_KEEP_DAYS;
  const days = Number(value);
  if (!Number.isFinite(days) || days < 0) return DEFAULT_KEEP_DAYS;
  return days;
}

const keepDays = () => parseKeepDays();

function mongoUrl() {
  return process.env.MONGO_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
}

function backupDir() {
  return process.env.BACKUP_DIR || path.resolve(__dirname, "../../backups");
}

// Remove credentials and password values from text that may be logged. Both the
// Mongo URI userinfo and common password flags/assignments are masked.
export function redactSecrets(value) {
  if (value === undefined || value === null) return value;
  return String(value)
    .replace(/(mongodb(?:\+srv)?:\/\/)([^@\s/]+)@/gi, "$1***@")
    .replace(/([?&](?:password|pwd|pass|authMechanismProperties)=)([^&\s]+)/gi, "$1***")
    .replace(/(--password(?:=|\s+))([^\s]+)/gi, "$1***")
    .replace(/(\b(?:password|passwd|pwd)\b\s*[:=]\s*)([^\s,;]+)/gi, "$1***");
}

// Runs a tool that writes an archive to stdout and streams it to archivePath.
// Resolves only after the output file has been fully flushed and closed. On
// failure the partial file is removed so a fallback tool can start clean.
export function runToolWithArchive(command, args, archivePath) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      reject(new Error(redactSecrets(error.message)));
      return;
    }

    const out = fs.createWriteStream(archivePath);
    let stderr = "";
    let settled = false;
    let childClosed = false;
    let streamClosed = false;
    let exitCode = null;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGTERM");
      } catch {
        // The child may already have exited.
      }
      out.destroy();
      fs.unlink(archivePath, () => {});
      reject(new Error(redactSecrets(error.message)));
    };

    const settleIfComplete = () => {
      if (settled || !childClosed || !streamClosed) return;
      settled = true;
      if (exitCode === 0) {
        resolve();
        return;
      }
      fs.unlink(archivePath, () => {});
      reject(
        new Error(
          redactSecrets(`Command exited with code ${exitCode}: ${stderr.slice(0, 2000)}`)
        )
      );
    };

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdout.pipe(out);
    child.on("error", fail);
    out.on("error", fail);
    out.on("close", () => {
      streamClosed = true;
      settleIfComplete();
    });
    child.on("close", (code) => {
      childClosed = true;
      exitCode = code;
      out.end();
      settleIfComplete();
    });
  });
}

export async function runDockerBackup(
  container,
  uri,
  archivePath,
  { runTool = runToolWithArchive } = {}
) {
  await runTool(
    "docker",
    ["exec", container, "mongodump", "--uri", uri, "--gzip", "--archive"],
    archivePath
  );
}

export async function runHostMongodump(
  uri,
  archivePath,
  { runTool = runToolWithArchive } = {}
) {
  await runTool("mongodump", ["--uri", uri, "--gzip", "--archive"], archivePath);
}

// Deletes archives older than the retention window (in days). The newest
// archive is always kept, even if every backup is older than the window, so a
// stalled schedule never prunes the last usable backup.
export async function pruneOldBackups(
  dir,
  { now = Date.now(), days = keepDays() } = {}
) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir);
  } catch {
    return 0;
  }

  const backups = [];
  for (const name of entries) {
    if (!name.startsWith(BACKUP_FILE_PREFIX) || !name.endsWith(BACKUP_FILE_EXT)) continue;
    try {
      const stats = await fs.promises.stat(path.join(dir, name));
      backups.push({ name, mtimeMs: stats.mtimeMs });
    } catch {
      // A file removed between readdir and stat is already gone.
    }
  }

  backups.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));

  const cutoff = now - days * DAY_MS;
  const doomed = backups.slice(1).filter((backup) => backup.mtimeMs < cutoff);
  for (const backup of doomed) {
    await fs.promises.unlink(path.join(dir, backup.name)).catch(() => {});
  }
  return doomed.length;
}

function printSchedulingInstructions(repoBackendDir) {
  console.log(`
Scheduling (install on the VPS host, next to Docker):

1) Cron — run: crontab -e
   15 2 * * * cd ${repoBackendDir} && node src/scripts/backupDb.js >> ${repoBackendDir}/backups/backup.log 2>&1

2) systemd — copy Backend/backup/cricall-backup.service and cricall-backup.timer
   to /etc/systemd/system (adjust ExecStart to your repo path), then:
   sudo systemctl daemon-reload
   sudo systemctl enable --now cricall-backup.timer

Full instructions + the off-VPS copy follow-up: Backend/backup/README.md
`);
}

export async function main() {
  const url = mongoUrl();
  if (!url) {
    throw new Error("MONGO_URL / MONGODB_URI / MONGO_URI is required for a backup.");
  }

  const { host, databaseName } = getMongoTarget(url);
  if (!databaseName) {
    throw new Error("The Mongo URL must include a database name (e.g. .../cric-all).");
  }

  const dir = backupDir();
  await fs.promises.mkdir(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archivePath = path.join(dir, `${BACKUP_FILE_PREFIX}${databaseName}-${stamp}${BACKUP_FILE_EXT}`);

  const container = process.env.MONGO_CONTAINER_NAME || DEFAULT_MONGO_CONTAINER;
  let method = `mongodump (host)`;
  try {
    await runDockerBackup(container, url, archivePath);
    method = `docker exec ${container} mongodump`;
  } catch (dockerError) {
    try {
      await runHostMongodump(url, archivePath);
    } catch (hostError) {
      throw new Error(
        redactSecrets(
          `docker exec backup failed (${dockerError.message}) and host mongodump also failed (${hostError.message})`
        )
      );
    }
  }

  const pruned = await pruneOldBackups(dir);
  const sizeMb = (fs.statSync(archivePath).size / 1048576).toFixed(2);

  console.log(`Database: ${databaseName} (host now: ${host || "unknown"})`);
  console.log(`Method: ${method}`);
  console.log(`Backup written: ${archivePath} (${sizeMb} MB)`);
  console.log(
    `Retention: keeping backups newer than ${keepDays()} day(s) (newest always kept); pruned ${pruned} old file(s)`
  );

  if (process.argv.includes("--print-instructions")) {
    printSchedulingInstructions(path.resolve(__dirname, "..", ".."));
  }
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === __filename.toLowerCase();

if (isMain) {
  main().catch((error) => {
    console.error("Backup failed:", redactSecrets(error.message));
    process.exitCode = 1;
  });
}
