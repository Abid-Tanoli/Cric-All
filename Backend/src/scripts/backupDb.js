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

const keepCount = () => Math.max(1, Number(process.env.BACKUP_KEEP_DAYS) || 14);

function mongoUrl() {
  return process.env.MONGO_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
}

function backupDir() {
  return process.env.BACKUP_DIR || path.resolve(__dirname, "../../backups");
}

// Runs a tool that writes an archive to stdout and streams it to archivePath.
// On failure the partial file is removed so a fallback tool can start clean.
function runToolWithArchive(command, args, archivePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out = fs.createWriteStream(archivePath);
    let stderr = "";
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      out.destroy();
      fs.unlink(archivePath, () => {});
      reject(error);
    };

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdout.pipe(out);
    child.on("error", fail);
    out.on("error", fail);
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      out.end();
      if (code === 0) {
        resolve();
      } else {
        fs.unlink(archivePath, () => {});
        reject(new Error(`Command exited with code ${code}: ${stderr.slice(0, 2000)}`));
      }
    });
  });
}

async function runDockerBackup(container, databaseName, archivePath) {
  await runToolWithArchive("docker", [
    "exec", container,
    "mongodump", "--db", databaseName, "--gzip", "--archive"
  ], archivePath);
}

async function runHostMongodump(uri, archivePath) {
  await runToolWithArchive("mongodump", ["--uri", uri, "--gzip", "--archive"], archivePath);
}

async function pruneOldBackups(dir) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir);
  } catch {
    return 0;
  }

  const backups = entries
    .filter((name) => name.startsWith(BACKUP_FILE_PREFIX) && name.endsWith(BACKUP_FILE_EXT))
    .sort()
    .reverse(); // ISO-format timestamps sort lexicographically = newest first

  const keep = keepCount();
  const doomed = backups.slice(keep);
  for (const name of doomed) {
    await fs.promises.unlink(path.join(dir, name)).catch(() => {});
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

async function main() {
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
    await runDockerBackup(container, databaseName, archivePath);
    method = `docker exec ${container} mongodump`;
  } catch (dockerError) {
    try {
      await runHostMongodump(url, archivePath);
    } catch (hostError) {
      throw new Error(
        `docker exec backup failed (${dockerError.message}) and host mongodump also failed (${hostError.message})`
      );
    }
  }

  const pruned = await pruneOldBackups(dir);
  const sizeMb = (fs.statSync(archivePath).size / 1048576).toFixed(2);

  console.log(`Database: ${databaseName} (host now: ${host || "unknown"})`);
  console.log(`Method: ${method}`);
  console.log(`Backup written: ${archivePath} (${sizeMb} MB)`);
  console.log(`Retention: keeping last ${keepCount()} backup(s); pruned ${pruned} old file(s)`);

  if (process.argv.includes("--print-instructions")) {
    printSchedulingInstructions(path.resolve(__dirname, "..", ".."));
  }
}

main().catch((error) => {
  console.error("Backup failed:", error.message);
  process.exitCode = 1;
});