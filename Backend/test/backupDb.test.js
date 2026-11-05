// Tests for src/scripts/backupDb.js.
//
// Pinned here:
//   * the docker path uses the full Mongo URL with `--uri` (not `--db`);
//   * Mongo credentials/passwords are redacted from command output and errors;
//   * BACKUP_KEEP_DAYS is a real retention window in days, not a file count,
//     and the newest archive is never pruned.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  parseKeepDays,
  pruneOldBackups,
  redactSecrets,
  runDockerBackup,
  runToolWithArchive,
} from "../src/scripts/backupDb.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const FAKE_PASSWORD = "placeholder-password-not-a-real-secret";
const FAKE_URI = `mongodb://backup_user:${FAKE_PASSWORD}@mongo.example:27017/cric-all?authSource=admin`;

test("runDockerBackup passes the full Mongo URL with --uri instead of --db", async () => {
  let captured;
  const archivePath = path.join(os.tmpdir(), "cricall-backup-args-test.archive.gz");

  await runDockerBackup("cricall-mongo", FAKE_URI, archivePath, {
    runTool: async (command, args, target) => {
      captured = { command, args, target };
    },
  });

  assert.equal(captured.command, "docker");
  assert.equal(captured.target, archivePath);
  assert.deepEqual(captured.args.slice(0, 4), ["exec", "cricall-mongo", "mongodump", "--uri"]);
  assert.equal(captured.args[4], FAKE_URI);
  assert.ok(captured.args.includes("--gzip"));
  assert.ok(captured.args.includes("--archive"));
  assert.ok(!captured.args.includes("--db"));
  assert.ok(!captured.args.some((arg) => arg === "cric-all"));
});

test("redactSecrets masks the URI userinfo and password assignments", () => {
  const redacted = redactSecrets(
    `failed for ${FAKE_URI} --password ${FAKE_PASSWORD} password=${FAKE_PASSWORD}`
  );

  assert.ok(!redacted.includes(FAKE_PASSWORD), "password must not survive redaction");
  assert.ok(!redacted.includes("backup_user:"), "URI userinfo must not survive redaction");
  assert.match(redacted, /mongodb:\/\/\*\*\*@mongo\.example:27017\/cric-all/);
});

test("tool failures are redacted before the error is returned", async () => {
  const archivePath = path.join(os.tmpdir(), "cricall-backup-redaction-test.archive.gz");
  const script = [
    'process.stdout.write("partial archive");',
    `process.stderr.write(${JSON.stringify(`mongodump failed for ${FAKE_URI}`)});`,
    "process.exit(7);",
  ].join(" ");

  await assert.rejects(
    runToolWithArchive(process.execPath, ["-e", script], archivePath),
    (error) => {
      assert.ok(!error.message.includes(FAKE_PASSWORD));
      assert.match(error.message, /mongodb:\/\/\*\*\*@mongo\.example/);
      assert.match(error.message, /code 7/);
      return true;
    }
  );
});

test("parseKeepDays treats BACKUP_KEEP_DAYS as days and falls back safely", () => {
  assert.equal(parseKeepDays("7"), 7);
  assert.equal(parseKeepDays("0"), 0);
  assert.equal(parseKeepDays(""), 14);
  assert.equal(parseKeepDays(undefined), 14);
  assert.equal(parseKeepDays("not-a-number"), 14);
  assert.equal(parseKeepDays("-3"), 14);
});

test("pruneOldBackups removes archives older than the day window", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cricall-backup-retention-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const now = Date.UTC(2026, 10, 5, 12, 0, 0);
  const files = [
    ["backup-cric-all-20-days.archive.gz", 20],
    ["backup-cric-all-10-days.archive.gz", 10],
    ["backup-cric-all-4-days.archive.gz", 4],
    ["backup-cric-all-2-days.archive.gz", 2],
    ["backup-cric-all-1-day.archive.gz", 1],
  ];
  for (const [name, ageDays] of files) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, "archive");
    const mtime = new Date(now - ageDays * DAY_MS);
    fs.utimesSync(file, mtime, mtime);
  }

  const ignored = ["notes.txt", "backup-cric-all-not-an-archive.txt"];
  for (const name of ignored) fs.writeFileSync(path.join(dir, name), "keep me");

  const pruned = await pruneOldBackups(dir, { now, days: 3 });

  assert.equal(pruned, 3);
  assert.deepEqual(fs.readdirSync(dir).sort(), [
    "backup-cric-all-1-day.archive.gz",
    "backup-cric-all-2-days.archive.gz",
    "backup-cric-all-not-an-archive.txt",
    "notes.txt",
  ]);
});

test("pruneOldBackups always keeps the newest archive, even when all are expired", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cricall-backup-newest-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const now = Date.UTC(2026, 10, 5, 12, 0, 0);
  for (const [name, ageDays] of [
    ["backup-cric-all-40-days.archive.gz", 40],
    ["backup-cric-all-30-days.archive.gz", 30],
  ]) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, "archive");
    const mtime = new Date(now - ageDays * DAY_MS);
    fs.utimesSync(file, mtime, mtime);
  }

  const pruned = await pruneOldBackups(dir, { now, days: 3 });

  assert.equal(pruned, 1);
  assert.deepEqual(fs.readdirSync(dir), ["backup-cric-all-30-days.archive.gz"]);
});
