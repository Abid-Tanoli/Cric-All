// Tests for the optional off-site backup step (src/scripts/offsiteBackup.js),
// the uploads archiver's size gate and the restore confirmation guard.
//
// No network and no real rclone: every upload runs against an injected spawn
// stub, so these tests pin the env gating, the exact command construction, the
// "off-site failure keeps the local backup" contract, and that the passphrase
// never reaches the logs.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";

import {
  DEFAULT_OFFSITE_RETENTION_DAYS,
  DEFAULT_OFFSITE_UPLOADS_MAX_MB,
  OFFSITE_FAILURE_EXIT_CODE,
  buildRcloneCopyArgs,
  buildRcloneListArgs,
  buildRclonePruneArgs,
  decryptFile,
  encryptFile,
  exceedsSizeLimit,
  parseEnabledFlag,
  parseOffsiteConfig,
  parseUploadsMaxMb,
  redactOffsite,
  runOffsiteUpload,
} from "../src/scripts/offsiteBackup.js";

import {
  requireConfirm,
  buildTempRestoreArgs,
  buildRealRestoreArgs,
} from "../src/scripts/restoreFromOffsite.js";

import { uploadsArchiveName, uploadsArchiveArgs } from "../src/scripts/backupUploads.js";

const PASSPHRASE = "correct-horse-battery-staple-offsite";

function captureLog() {
  const lines = [];
  return {
    lines,
    log: {
      log: (message) => lines.push(String(message)),
      error: (message) => lines.push(String(message)),
    },
  };
}

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cricall-offsite-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Fake rclone child: emits output then closes with `code`.
function fakeSpawn({ code = 0, stdout = "", stderr = "", onCall } = {}) {
  const calls = [];
  const spawnImpl = (command, args) => {
    calls.push({ command, args });
    onCall?.(command, args, calls.length);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => {
      if (stdout) child.stdout.emit("data", Buffer.from(stdout));
      if (stderr) child.stderr.emit("data", Buffer.from(stderr));
      child.emit("close", code);
    });
    return child;
  };
  return { spawnImpl, calls };
}

function writeArchive(dir, name = "backup-cric-all-2026-11-23T02-15-00.archive.gz") {
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.from("pretend-mongodump-archive-bytes"));
  return file;
}

function writePassphrase(dir) {
  const file = path.join(dir, "offsite-passphrase");
  fs.writeFileSync(file, PASSPHRASE, { mode: 0o600 });
  return file;
}

const ENABLED_ENV = {
  OFFSITE_BACKUP_ENABLED: "true",
  OFFSITE_REMOTE: "cricall-offsite:cricall-backups",
  OFFSITE_PASSPHRASE_FILE: "/root/.config/cricall/offsite-passphrase",
};

// --- env gating -----------------------------------------------------------

test("offsite is disabled unless OFFSITE_BACKUP_ENABLED is true", () => {
  assert.equal(parseOffsiteConfig({}).enabled, false);
  assert.equal(parseOffsiteConfig({ OFFSITE_BACKUP_ENABLED: "" }).enabled, false);
  assert.equal(parseOffsiteConfig({ OFFSITE_BACKUP_ENABLED: "false" }).enabled, false);
  assert.equal(parseOffsiteConfig({ OFFSITE_BACKUP_ENABLED: "maybe" }).enabled, false);
  assert.equal(parseOffsiteConfig({ OFFSITE_BACKUP_ENABLED: "0" }).enabled, false);
  assert.equal(parseEnabledFlag("TRUE"), true);
  assert.equal(parseOffsiteConfig({ OFFSITE_BACKUP_ENABLED: "1" }).enabled, true);
});

test("a disabled offsite step does no work at all", async (t) => {
  const dir = tempDir(t);
  const archive = writeArchive(dir);
  const { spawnImpl, calls } = fakeSpawn();
  const captured = captureLog();

  const result = await runOffsiteUpload({
    localPath: archive,
    config: parseOffsiteConfig({}),
    spawnImpl,
    log: captured.log,
  });

  assert.equal(result.status, "disabled");
  assert.equal(result.code, 0);
  assert.equal(calls.length, 0, "rclone must not run while the feature is off");
  assert.ok(fs.existsSync(archive));
  assert.ok(captured.lines.some((line) => /disabled/.test(line)));
});

test("enabled but misconfigured reports problems and uploads nothing", async (t) => {
  const dir = tempDir(t);
  const archive = writeArchive(dir);
  const { spawnImpl, calls } = fakeSpawn();
  const captured = captureLog();

  const result = await runOffsiteUpload({
    localPath: archive,
    config: parseOffsiteConfig({ OFFSITE_BACKUP_ENABLED: "true" }),
    spawnImpl,
    log: captured.log,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.code, OFFSITE_FAILURE_EXIT_CODE);
  assert.equal(calls.length, 0);
  assert.ok(fs.existsSync(archive), "local backup must survive a misconfiguration");
  assert.ok(captured.lines.some((line) => /OFFSITE_REMOTE is empty/.test(line)));
  assert.ok(captured.lines.some((line) => /OFFSITE_PASSPHRASE_FILE is empty/.test(line)));
});

test("retention and uploads size limits parse safely", () => {
  assert.equal(parseOffsiteConfig({}).retentionDays, DEFAULT_OFFSITE_RETENTION_DAYS);
  assert.equal(parseOffsiteConfig({ OFFSITE_RETENTION_DAYS: "90" }).retentionDays, 90);
  assert.equal(parseOffsiteConfig({ OFFSITE_RETENTION_DAYS: "0" }).retentionDays, 0);
  assert.equal(parseOffsiteConfig({ OFFSITE_RETENTION_DAYS: "nope" }).retentionDays, 30);
  assert.equal(parseUploadsMaxMb(""), DEFAULT_OFFSITE_UPLOADS_MAX_MB);
  assert.equal(parseUploadsMaxMb("50"), 50);
  assert.equal(parseUploadsMaxMb("-1"), DEFAULT_OFFSITE_UPLOADS_MAX_MB);
  assert.equal(exceedsSizeLimit(60 * 1024 * 1024, 50), true);
  assert.equal(exceedsSizeLimit(10 * 1024 * 1024, 50), false);
  assert.equal(exceedsSizeLimit(999 * 1024 * 1024, 0), false, "0 means no limit");
});

// --- command construction -------------------------------------------------

test("upload command is a rclone copyto of the encrypted file, with no secrets", () => {
  const config = parseOffsiteConfig(ENABLED_ENV);
  const args = buildRcloneCopyArgs(config, "/opt/cricall/Backend/backups/.backup.enc.tmp", "backup-cric-all-x.archive.gz.enc");

  assert.equal(args[0], "copyto");
  assert.equal(args[1], "/opt/cricall/Backend/backups/.backup.enc.tmp");
  assert.equal(args[2], "cricall-offsite:cricall-backups/backup-cric-all-x.archive.gz.enc");
  assert.ok(!args.includes("--password"));
  assert.ok(!args.includes("--password-command"));
  assert.ok(args.every((arg) => !arg.includes(PASSPHRASE)));
});

test("remote retention deletes only our objects older than the window", () => {
  const config = parseOffsiteConfig({ ...ENABLED_ENV, OFFSITE_RETENTION_DAYS: "45" });
  const args = buildRclonePruneArgs(config, "backup-*.enc");

  assert.deepEqual(args.slice(0, 2), ["delete", "cricall-offsite:cricall-backups"]);
  assert.equal(args[args.indexOf("--include") + 1], "backup-*.enc");
  assert.equal(args[args.indexOf("--min-age") + 1], "45d");
  assert.ok(!args.join(" ").includes("password"));
});

test("list command is scoped to encrypted objects", () => {
  const config = parseOffsiteConfig(ENABLED_ENV);
  const args = buildRcloneListArgs(config, "*.enc");
  assert.equal(args[0], "lsf");
  assert.equal(args[1], "cricall-offsite:cricall-backups");
  assert.equal(args[args.indexOf("--include") + 1], "*.enc");
});

// --- encryption -----------------------------------------------------------

test("encrypt/decrypt round-trips and rejects a wrong passphrase", async (t) => {
  const dir = tempDir(t);
  const source = path.join(dir, "backup.archive.gz");
  const enc = path.join(dir, "backup.archive.gz.enc");
  const out = path.join(dir, "backup.roundtrip.gz");
  const payload = Buffer.from("mongodump-archive-fixture".repeat(100));
  fs.writeFileSync(source, payload);

  await encryptFile(source, enc, PASSPHRASE);
  await decryptFile(enc, out, PASSPHRASE);
  assert.ok(fs.readFileSync(out).equals(payload));

  await assert.rejects(decryptFile(enc, path.join(dir, "nope.gz"), "wrong-passphrase-1"), {
    message: /decryption failed/,
  });
  assert.ok(!fs.existsSync(path.join(dir, "nope.gz")), "partial plaintext must be removed");
});

test("a tampered encrypted file fails authentication", async (t) => {
  const dir = tempDir(t);
  const source = path.join(dir, "backup.archive.gz");
  const enc = path.join(dir, "backup.archive.gz.enc");
  fs.writeFileSync(source, Buffer.from("payload".repeat(64)));
  await encryptFile(source, enc, PASSPHRASE);

  const bytes = fs.readFileSync(enc);
  bytes[bytes.length - 40] ^= 0xff;
  fs.writeFileSync(enc, bytes);

  await assert.rejects(decryptFile(enc, path.join(dir, "tampered.gz"), PASSPHRASE), {
    message: /decryption failed|magic header/,
  });
});

// --- failure handling and secret-free logs --------------------------------

test("a successful upload leaves the local backup and removes the temp copy", async (t) => {
  const dir = tempDir(t);
  const archive = writeArchive(dir);
  const remote = writePassphrase(dir);
  const { spawnImpl, calls } = fakeSpawn({ stdout: "Transferred: 1 KiB / 1 KiB" });
  const captured = captureLog();

  const result = await runOffsiteUpload({
    localPath: archive,
    config: parseOffsiteConfig({ ...ENABLED_ENV, OFFSITE_PASSPHRASE_FILE: remote }),
    spawnImpl,
    log: captured.log,
  });

  assert.equal(result.status, "uploaded");
  assert.equal(result.code, 0);
  assert.ok(fs.existsSync(archive), "local backup must remain after a successful upload");
  assert.equal(calls.length, 2, "one copyto plus one retention delete");
  assert.equal(calls[0].command, "rclone");
  assert.deepEqual(fs.readdirSync(dir).sort(), ["backup-cric-all-2026-11-23T02-15-00.archive.gz", "offsite-passphrase"]);
  assert.ok(captured.lines.some((line) => /uploaded .*\.enc/.test(line)));
  for (const line of captured.lines) assert.ok(!line.includes(PASSPHRASE), "passphrase leaked into logs");
});

test("an rclone failure keeps the local backup and returns the distinct exit code", async (t) => {
  const dir = tempDir(t);
  const archive = writeArchive(dir);
  const before = fs.readFileSync(archive);
  const { spawnImpl } = fakeSpawn({
    code: 1,
    stderr: "ERROR: googleapi: 403 forbidden (password=not-the-real-secret)",
  });
  const captured = captureLog();

  const result = await runOffsiteUpload({
    localPath: archive,
    config: parseOffsiteConfig(ENABLED_ENV),
    passphrase: PASSPHRASE,
    spawnImpl,
    log: captured.log,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.code, OFFSITE_FAILURE_EXIT_CODE);
  assert.ok(fs.existsSync(archive), "local backup must survive an upload failure");
  assert.ok(fs.readFileSync(archive).equals(before), "local backup must not be modified");
  assert.deepEqual(fs.readdirSync(dir), [path.basename(archive)], "no temp .enc file left behind");
  assert.ok(captured.lines.some((line) => /off-site copy failed; the LOCAL database backup is intact/.test(line)));
  for (const line of captured.lines) {
    assert.ok(!line.includes(PASSPHRASE), "passphrase leaked into logs");
    assert.ok(!line.includes("not-the-real-secret"), "password= value leaked into logs");
  }
});

test("a missing passphrase file fails safely with a clear message", async (t) => {
  const dir = tempDir(t);
  const archive = writeArchive(dir);
  const { spawnImpl, calls } = fakeSpawn();
  const captured = captureLog();

  const result = await runOffsiteUpload({
    localPath: archive,
    config: parseOffsiteConfig({
      ...ENABLED_ENV,
      OFFSITE_PASSPHRASE_FILE: path.join(dir, "does-not-exist"),
    }),
    spawnImpl,
    log: captured.log,
  });

  assert.equal(result.code, OFFSITE_FAILURE_EXIT_CODE);
  assert.equal(calls.length, 0);
  assert.ok(fs.existsSync(archive));
  assert.ok(captured.lines.some((line) => /cannot read OFFSITE_PASSPHRASE_FILE/.test(line)));
});

test("a too-short passphrase is refused before any rclone call", async (t) => {
  const dir = tempDir(t);
  const archive = writeArchive(dir);
  const { spawnImpl, calls } = fakeSpawn();
  const captured = captureLog();

  const result = await runOffsiteUpload({
    localPath: archive,
    config: parseOffsiteConfig(ENABLED_ENV),
    passphrase: "short",
    spawnImpl,
    log: captured.log,
  });

  assert.equal(result.code, OFFSITE_FAILURE_EXIT_CODE);
  assert.equal(calls.length, 0);
  assert.ok(fs.existsSync(archive));
  assert.ok(captured.lines.some((line) => /shorter than 12 characters/.test(line)));
});

test("redactOffsite masks passphrases and password arguments", () => {
  const text = redactOffsite(
    `rclone failed --password ${PASSPHRASE} and passphrase=${PASSPHRASE}`,
    [PASSPHRASE]
  );
  assert.ok(!text.includes(PASSPHRASE));
  assert.match(text, /\*\*\*/);
});

// --- uploads volume ------------------------------------------------------

test("uploads archive names and commands target the volume, not the database", () => {
  const name = uploadsArchiveName(new Date("2026-11-23T03:15:00.000Z"));
  assert.equal(name, "uploads-2026-11-23T03-15-00-000Z.tar.gz");

  const container = uploadsArchiveArgs({});
  assert.equal(container.command, "docker");
  assert.deepEqual(container.args, [
    "exec",
    "cricall-backend",
    "tar",
    "czf",
    "-",
    "-C",
    "/app/uploads",
    ".",
  ]);

  const host = uploadsArchiveArgs({ UPLOADS_SOURCE_DIR: "/srv/uploads" });
  assert.equal(host.command, "tar");
  assert.deepEqual(host.args, ["czf", "-", "-C", "/srv/uploads", "."]);
});

// --- restore guard -------------------------------------------------------

test("restore refuses to touch the live database without --confirm", () => {
  assert.throws(() => requireConfirm({}), /without --confirm/);
  assert.throws(() => requireConfirm({ confirm: false }), /without --confirm/);
  assert.doesNotThrow(() => requireConfirm({ confirm: true }));
});

test("temp restore renames namespaces and the real restore needs --drop", () => {
  const base = { container: "cricall-mongo", uri: "mongodb://localhost:27017/cric-all" };

  const temp = buildTempRestoreArgs({ ...base, sourceDb: "cric-all", tempDb: "cric-all-restore-temp" });
  assert.equal(temp[temp.indexOf("--nsFrom") + 1], "cric-all.*");
  assert.equal(temp[temp.indexOf("--nsTo") + 1], "cric-all-restore-temp.*");
  assert.ok(!temp.includes("--drop"), "the temp restore must never drop live data");

  const real = buildRealRestoreArgs({ ...base, sourceDb: "cric-all", targetDb: "cric-all" });
  assert.ok(real.includes("--drop"));
  assert.equal(real[real.indexOf("--nsTo") + 1], "cric-all.*");
});
