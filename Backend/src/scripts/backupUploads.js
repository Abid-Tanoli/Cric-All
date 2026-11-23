// Weekly encrypted off-site archive of the uploads_data Docker volume.
//
// uploads_data is NOT part of mongodump: it holds user/team/player images that
// the database only references by filename. This script tars it, checks the
// size against OFFSITE_UPLOADS_MAX_MB, then reuses the same encrypt + rclone
// upload path as the nightly database backup (src/scripts/offsiteBackup.js).
//
// Nothing runs unless OFFSITE_BACKUP_ENABLED=true. An off-site failure exits
// with code 3 and leaves the local tarball in place.

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

import { runToolWithArchive, redactSecrets } from "./backupDb.js";
import {
  OFFSITE_FAILURE_EXIT_CODE,
  exceedsSizeLimit,
  parseOffsiteConfig,
  runOffsiteUpload,
} from "./offsiteBackup.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const DEFAULT_UPLOADS_CONTAINER = "cricall-backend";
const DEFAULT_UPLOADS_CONTAINER_PATH = "/app/uploads";
const UPLOADS_PREFIX = "uploads-";
const UPLOADS_SUFFIX = ".tar.gz";

function backupDir() {
  return process.env.BACKUP_DIR || path.resolve(__dirname, "../../backups");
}

export function uploadsArchiveName(now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `${UPLOADS_PREFIX}${stamp}${UPLOADS_SUFFIX}`;
}

export function uploadsArchiveArgs(env = process.env) {
  const container = env.UPLOADS_CONTAINER_NAME || DEFAULT_UPLOADS_CONTAINER;
  const containerPath = env.UPLOADS_CONTAINER_PATH || DEFAULT_UPLOADS_CONTAINER_PATH;
  // UPLOADS_SOURCE_DIR is for boxes where the volume is mounted on the host
  // (or for a manual test run) instead of running inside a container.
  if (env.UPLOADS_SOURCE_DIR) {
    return { command: "tar", args: ["czf", "-", "-C", env.UPLOADS_SOURCE_DIR, "."] };
  }
  return { command: "docker", args: ["exec", container, "tar", "czf", "-", "-C", containerPath, "."] };
}

export async function pruneLocalUploadsArchives(dir, { keep = 1 } = {}) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir);
  } catch {
    return 0;
  }

  const archives = [];
  for (const name of entries) {
    if (!name.startsWith(UPLOADS_PREFIX) || !name.endsWith(UPLOADS_SUFFIX)) continue;
    try {
      const stats = await fs.promises.stat(path.join(dir, name));
      archives.push({ name, mtimeMs: stats.mtimeMs });
    } catch {
      // Removed between readdir and stat.
    }
  }

  archives.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
  const doomed = archives.slice(Math.max(0, keep));
  for (const archive of doomed) {
    await fs.promises.unlink(path.join(dir, archive.name)).catch(() => {});
  }
  return doomed.length;
}

export async function main({
  env = process.env,
  now = new Date(),
  runTool = runToolWithArchive,
  upload = runOffsiteUpload,
  log = console,
} = {}) {
  const config = parseOffsiteConfig(env);
  if (!config.enabled) {
    log.log("[uploads-backup] disabled (OFFSITE_BACKUP_ENABLED is not \"true\"); nothing archived");
    return 0;
  }

  const dir = backupDir();
  await fs.promises.mkdir(dir, { recursive: true });
  const archivePath = path.join(dir, uploadsArchiveName(now));

  const { command, args } = uploadsArchiveArgs(env);
  log.log(`[uploads-backup] archiving uploads with: ${command} ${args.join(" ")}`);
  try {
    await runTool(command, args, archivePath);
  } catch (error) {
    await fs.promises.unlink(archivePath).catch(() => {});
    log.error(`[uploads-backup] archive failed: ${redactSecrets(error.message)}`);
    return 1;
  }

  const sizeBytes = fs.statSync(archivePath).size;
  const sizeMb = (sizeBytes / 1048576).toFixed(2);
  if (exceedsSizeLimit(sizeBytes, config.uploadsMaxMb)) {
    await fs.promises.unlink(archivePath).catch(() => {});
    log.log(
      `[uploads-backup] archive is ${sizeMb} MB, above OFFSITE_UPLOADS_MAX_MB=${config.uploadsMaxMb}; ` +
        "skipping the off-site upload and removing the local tarball"
    );
    return 0;
  }

  log.log(`[uploads-backup] archive written: ${archivePath} (${sizeMb} MB)`);
  await pruneLocalUploadsArchives(dir, { keep: 1 });

  const result = await upload({
    localPath: archivePath,
    include: "uploads-*.enc",
    kind: "uploads",
    config,
    log,
  });
  if (result.code !== 0) {
    log.error(
      `[uploads-backup] off-site upload failed (exit ${OFFSITE_FAILURE_EXIT_CODE}); the local archive is intact`
    );
  }
  return result.code;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === __filename.toLowerCase();

if (isMain) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error("[uploads-backup] failed:", redactSecrets(error.message));
      process.exitCode = 1;
    });
}
