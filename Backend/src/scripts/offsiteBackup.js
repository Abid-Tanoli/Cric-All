// Off-site (off-VPS) encrypted copy of the local backups.
//
// WHY THIS MECHANISM: AES-256-GCM encryption happens here in Node, then a plain
// `rclone copyto` ships the encrypted file to any rclone remote (Google Drive,
// Backblaze B2, SFTP, S3, ...). Chosen over the alternatives because:
//   * rclone is the only extra binary needed and it covers every free-tier
//     remote (Drive OAuth, B2 keys, plain SFTP) with one config file.
//   * The passphrase stays in a file on the server that this script reads at
//     run time (mode 600). `rclone crypt` would instead keep an obscured
//     password inside rclone.conf - a second secret to manage and rotate, and
//     obscuring is reversible, not encryption.
//   * GCM is authenticated, so a truncated or corrupted object fails to
//     decrypt instead of restoring silently damaged data. `openssl enc` has no
//     AEAD mode and would need a checksum sidecar.
//
// Everything here is gated by env vars and OFF by default, so an unconfigured
// VPS behaves exactly as before. A failure in this module never throws out to
// the caller: it logs a clear, secret-free message and returns the distinct
// exit code OFFSITE_FAILURE_EXIT_CODE so systemd marks the unit failed/warned
// while the local backup file stays on disk.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";

// Distinct exit code: local backup is fine, only the off-site copy failed.
export const OFFSITE_FAILURE_EXIT_CODE = 3;

export const DEFAULT_OFFSITE_RETENTION_DAYS = 30;
export const DEFAULT_OFFSITE_UPLOADS_MAX_MB = 2048;
export const MIN_PASSPHRASE_LENGTH = 12;

const MAGIC = Buffer.from("CRICALLBK1", "utf8");
const VERSION = 1;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + 1 + SALT_BYTES + IV_BYTES;

export function parseEnabledFlag(value) {
  // Only an explicit "true" / "1" turns the feature on. Absent, empty, "0",
  // "no", "false" and typos all mean OFF, so a mistake fails closed.
  return /^(true|1)$/i.test(String(value ?? "").trim());
}

export function parseRetentionDays(value, fallback = DEFAULT_OFFSITE_RETENTION_DAYS) {
  if (value === undefined || value === null || value === "") return fallback;
  const days = Number(value);
  if (!Number.isFinite(days) || days < 0) return fallback;
  return Math.floor(days);
}

// OFFSITE_UPLOADS_MAX_MB: 0 means "no limit"; unset/invalid falls back to the
// default so a typo cannot silently remove the safety limit.
export function parseUploadsMaxMb(value, fallback = DEFAULT_OFFSITE_UPLOADS_MAX_MB) {
  if (value === undefined || value === null || value === "") return fallback;
  const mb = Number(value);
  if (!Number.isFinite(mb) || mb < 0) return fallback;
  return Math.floor(mb);
}

export function exceedsSizeLimit(sizeBytes, maxMb) {
  if (!Number.isFinite(maxMb) || maxMb <= 0) return false;
  return sizeBytes > maxMb * 1024 * 1024;
}

export function parseOffsiteConfig(env = process.env) {
  const enabled = parseEnabledFlag(env.OFFSITE_BACKUP_ENABLED);
  const remote = String(env.OFFSITE_REMOTE ?? "").trim();
  const passphraseFile = String(env.OFFSITE_PASSPHRASE_FILE ?? "").trim();
  const retentionDays = parseRetentionDays(env.OFFSITE_RETENTION_DAYS);
  const uploadsMaxMb = parseUploadsMaxMb(env.OFFSITE_UPLOADS_MAX_MB);

  const problems = [];
  if (enabled) {
    if (!remote) {
      problems.push("OFFSITE_REMOTE is empty (expected an rclone target such as gdrive-crypt:cricall)");
    } else if (remote.startsWith("-")) {
      problems.push("OFFSITE_REMOTE must not start with '-'");
    }
    if (!passphraseFile) {
      problems.push("OFFSITE_PASSPHRASE_FILE is empty (expected an absolute path to a mode-600 file)");
    }
  }

  return { enabled, remote, passphraseFile, retentionDays, uploadsMaxMb, problems };
}

// Masks the passphrase and any password-shaped argument before anything is
// printed. `secrets` are the raw values loaded from disk.
export function redactOffsite(value, secrets = []) {
  let text = String(value ?? "");
  for (const secret of secrets) {
    if (!secret) continue;
    text = text.split(secret).join("***");
  }
  return text
    .replace(/(--password(?:=| ))(\S+)/gi, "$1***")
    .replace(/(--passphrase(?:-file)?(?:=| ))(\S+)/gi, "$1***")
    .replace(/(\b(?:passphrase|password|passwd|pwd)\b\s*[:=]\s*)([^\s,;]+)/gi, "$1***");
}

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(Buffer.from(passphrase, "utf8"), salt, 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 96 * 1024 * 1024,
  });
}

// File layout: magic | version | salt | iv | ciphertext | gcm tag
export async function encryptFile(srcPath, destPath, passphrase) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  const header = Buffer.concat([MAGIC, Buffer.from([VERSION]), salt, iv]);

  const out = fs.createWriteStream(destPath, { flags: "w", mode: 0o600 });
  out.write(header);
  await pipeline(fs.createReadStream(srcPath), cipher, out, { end: false });
  await new Promise((resolve, reject) => {
    out.once("error", reject);
    out.end(resolve);
  });
  await fs.promises.appendFile(destPath, cipher.getAuthTag());
}

export async function decryptFile(encPath, destPath, passphrase) {
  const stats = await fs.promises.stat(encPath);
  if (stats.size <= HEADER_BYTES + TAG_BYTES) {
    throw new Error("encrypted file is too small to be a CricAll off-site backup");
  }

  const handle = await fs.promises.open(encPath, "r");
  const head = Buffer.alloc(HEADER_BYTES);
  const tag = Buffer.alloc(TAG_BYTES);
  try {
    await handle.read(head, 0, HEADER_BYTES, 0);
    await handle.read(tag, 0, TAG_BYTES, stats.size - TAG_BYTES);
  } finally {
    await handle.close();
  }

  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("not a CricAll off-site backup (magic header mismatch)");
  }
  const salt = head.subarray(MAGIC.length + 1, MAGIC.length + 1 + SALT_BYTES);
  const iv = head.subarray(MAGIC.length + 1 + SALT_BYTES, HEADER_BYTES);
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  decipher.setAuthTag(tag);

  try {
    await pipeline(
      fs.createReadStream(encPath, { start: HEADER_BYTES, end: stats.size - TAG_BYTES - 1 }),
      decipher,
      fs.createWriteStream(destPath, { mode: 0o600 })
    );
  } catch {
    await fs.promises.unlink(destPath).catch(() => {});
    throw new Error(
      "decryption failed: wrong passphrase or corrupted file (AES-GCM authentication failed)"
    );
  }
}

function remoteRoot(config) {
  return String(config.remote).replace(/\/+$/, "");
}

export function buildRcloneCopyArgs(config, localEncPath, objectName) {
  // Only the remote name appears here; credentials live in rclone.conf.
  return [
    "copyto",
    localEncPath,
    `${remoteRoot(config)}/${objectName}`,
    "--retries",
    "3",
    "--low-level-retries",
    "5",
    "--stats-one-line",
    "--log-level",
    "INFO",
  ];
}

export function buildRclonePruneArgs(config, include) {
  return [
    "delete",
    remoteRoot(config),
    "--include",
    include,
    "--min-age",
    `${config.retentionDays}d`,
    "--rmdirs",
    "--stats-one-line",
  ];
}

export function buildRcloneListArgs(config, include) {
  return ["lsf", remoteRoot(config), "--include", include, "--files-only"];
}

export function buildRcloneDownloadArgs(config, objectName, outPath) {
  return ["copyto", `${remoteRoot(config)}/${objectName}`, outPath, "--retries", "3"];
}

// Runs rclone and resolves with its output. Rejects with a message that has
// already been stripped of anything secret-shaped by the caller.
export function runRclone(args, { spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl("rclone", args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      reject(new Error(error.message));
      return;
    }

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      const hint = error.code === "ENOENT" ? " (is rclone installed?)" : "";
      reject(new Error(`${error.message}${hint}`));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`rclone exited with code ${code}: ${stderr.slice(0, 2000)}`));
    });
  });
}

function readPassphrase(passphraseFile) {
  const stats = fs.statSync(passphraseFile);
  const passphrase = fs.readFileSync(passphraseFile, "utf8").trim();
  return { passphrase, stats };
}

/**
 * Encrypt `localPath` and upload it to the configured rclone remote.
 *
 * Never throws and never touches `localPath`: on any failure the local backup
 * stays exactly where it was, and the result carries OFFSITE_FAILURE_EXIT_CODE.
 *
 * @returns {{status: "disabled"|"uploaded"|"failed", code: number, objectName?: string}}
 */
export async function runOffsiteUpload({
  localPath,
  include = "backup-*.enc",
  kind = "database",
  config = parseOffsiteConfig(),
  passphrase = null,
  spawnImpl = spawn,
  log = console,
} = {}) {
  const say = (message) => log.log(`[offsite] ${message}`);
  const warn = (message) => log.error(`[offsite] ${message}`);

  if (!config.enabled) {
    say("disabled (OFFSITE_BACKUP_ENABLED is not \"true\"); nothing uploaded");
    return { status: "disabled", code: 0 };
  }

  if (config.problems.length) {
    for (const problem of config.problems) warn(`misconfigured: ${problem}`);
    warn(`off-site copy skipped; the local ${kind} backup is intact at ${localPath}`);
    return { status: "failed", code: OFFSITE_FAILURE_EXIT_CODE };
  }

  let secret = passphrase;
  let encPath = null;
  try {
    if (!localPath || !fs.existsSync(localPath)) {
      warn(`local file not found (${localPath || "no path"}); nothing uploaded`);
      return { status: "failed", code: OFFSITE_FAILURE_EXIT_CODE };
    }

    if (secret === null) {
      let stats;
      try {
        ({ passphrase: secret, stats } = readPassphrase(config.passphraseFile));
      } catch (error) {
        warn(
          `cannot read OFFSITE_PASSPHRASE_FILE (${config.passphraseFile}): ${redactOffsite(
            error.code || error.message
          )}`
        );
        warn(`off-site copy skipped; the local ${kind} backup is intact at ${localPath}`);
        return { status: "failed", code: OFFSITE_FAILURE_EXIT_CODE };
      }
      if (process.platform !== "win32" && (stats.mode & 0o077) !== 0) {
        warn(
          `OFFSITE_PASSPHRASE_FILE (${config.passphraseFile}) is readable by group/other; run: chmod 600 ${config.passphraseFile}`
        );
      }
    }

    if (!secret || secret.length < MIN_PASSPHRASE_LENGTH) {
      warn(
        `passphrase is missing or shorter than ${MIN_PASSPHRASE_LENGTH} characters; refusing to upload`
      );
      warn(`off-site copy skipped; the local ${kind} backup is intact at ${localPath}`);
      return { status: "failed", code: OFFSITE_FAILURE_EXIT_CODE };
    }

    const objectName = `${path.basename(localPath)}.enc`;
    encPath = path.join(path.dirname(localPath), `.${path.basename(localPath)}.enc.tmp`);

    await encryptFile(localPath, encPath, secret);
    await runRclone(buildRcloneCopyArgs(config, encPath, objectName), { spawnImpl });
    say(`uploaded ${objectName} to ${remoteRoot(config)}`);

    if (config.retentionDays > 0) {
      try {
        await runRclone(buildRclonePruneArgs(config, include), { spawnImpl });
        say(`remote retention: removed ${include} objects older than ${config.retentionDays} day(s)`);
      } catch (error) {
        warn(
          `remote retention failed (upload succeeded, local backup intact): ${redactOffsite(
            error.message,
            [secret]
          )}`
        );
      }
    }

    return { status: "uploaded", code: 0, objectName };
  } catch (error) {
    warn(
      `off-site copy failed; the LOCAL ${kind} backup is intact at ${localPath}: ${redactOffsite(
        error.message,
        [secret]
      )}`
    );
    return { status: "failed", code: OFFSITE_FAILURE_EXIT_CODE };
  } finally {
    if (encPath) await fs.promises.unlink(encPath).catch(() => {});
  }
}
