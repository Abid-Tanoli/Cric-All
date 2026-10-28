// Tests for src/scripts/setBattingPositions.js — the operator backfill.
//
// The script is run as a child process against a throwaway
// `mongodb-memory-server` database, exactly as an operator would run it. The
// database name contains "test", so the script's own test-database guard is
// exercised too: every intentional run must pass --force-test.
//
// Pinned here:
//   * the whole plan is printed and nothing is written without --apply;
//   * --apply writes the position and a second run reports "unchanged";
//   * "clear" unsets a value;
//   * a name that does not resolve blocks every write;
//   * --file=value (equals form) is parsed, not treated as an unknown option;
//   * a test/e2e database is refused without --force-test;
//   * an unknown option is refused.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import {
  validateRows,
  findUnknownOptions,
  isTestTarget,
} from "../src/scripts/setBattingPositions.js";

const DB_NAME = "cric-all-batting-test";
const BACKEND_DIR = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = path.join("src", "scripts", "setBattingPositions.js");

let mongod;
let uri;
let tmpDir;

before(async () => {
  mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 30_000 } });
  uri = mongod.getUri(DB_NAME);
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "batting-positions-"));
  await mongoose.connect(uri, { dbName: DB_NAME });
  await Team.init();
  await Player.init();
});

after(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  }
  if (mongod) await mongod.stop();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await Promise.all([Team.deleteMany({}), Player.deleteMany({})]);
});

function writeCsv(name, lines) {
  const file = path.join(tmpDir, name);
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
  return file;
}

function runScript(args) {
  const env = { ...process.env };
  delete env.MIGRATION_MONGO_URL;
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: BACKEND_DIR,
    env,
    encoding: "utf8",
  });
  return { code: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

const targetArgs = (file, extra = []) => [
  "--file", file,
  "--uri", uri,
  "--allow-database", DB_NAME,
  "--force-test",
  ...extra,
];

async function seed() {
  const team = await Team.create({ name: "Alpha XI" });
  const ann = await Player.create({ name: "Ann", team: team._id });
  const bea = await Player.create({ name: "Bea", team: team._id, battingPosition: "middle_order" });
  return { team, ann, bea };
}

// ---------------------------------------------------------------------------
// Pure parsing/validation
// ---------------------------------------------------------------------------

test("CSV validation accepts every position, blank/clear, and refuses unknowns", () => {
  const rows = [
    ["team", "player", "batting_position"],
    ["Alpha XI", "Ann", "Opener"],
    ["Alpha XI", "Bea", "middle order"],
    ["Alpha XI", "Cara", "clear"],
    ["Alpha XI", "Dee", ""],
  ];
  assert.throws(
    () => validateRows(rows),
    /empty battingPosition/,
    "a blank cell is a mistake; clearing must be explicit",
  );

  const valid = validateRows(rows.slice(0, 4));
  assert.deepStrictEqual(valid.map((r) => r.position), ["opener", "middle_order", ""]);

  assert.throws(
    () => validateRows([rows[0], ["Alpha XI", "Ann", "sweeper"]]),
    /unknown battingPosition "sweeper"/,
  );
});

test("value-taking flags in --name=value form are not unknown options", () => {
  assert.deepStrictEqual(
    findUnknownOptions([
      "--file=C:/tmp/p.csv",
      "--uri=mongodb://127.0.0.1:1/x",
      "--allow-database=x",
      "--force-test",
      "--apply",
    ]),
    [],
  );
  assert.deepStrictEqual(findUnknownOptions(["--file", "p.csv", "--uri", "x"]), []);
  assert.deepStrictEqual(findUnknownOptions(["--bogus"]), ["--bogus"]);
  assert.deepStrictEqual(findUnknownOptions(["--file="]), ["--file="]);
  assert.deepStrictEqual(findUnknownOptions(["--apply=yes"]), ["--apply=yes"]);
});

test("test/e2e database detection is case- and separator-aware", () => {
  assert.strictEqual(isTestTarget("cric-all-e2e"), true);
  assert.strictEqual(isTestTarget("cric_all_test"), true);
  assert.strictEqual(isTestTarget("contest"), false);
  assert.strictEqual(isTestTarget("cric-all", "test"), true);
});

// ---------------------------------------------------------------------------
// Dry run / apply
// ---------------------------------------------------------------------------

test("a dry run prints the whole plan and writes nothing", async () => {
  const { ann, bea } = await seed();
  const file = writeCsv("dry.csv", [
    "team,player,battingPosition",
    "Alpha XI,Ann,opener",
    "Alpha XI,Bea,clear",
  ]);

  const { code, stdout, stderr } = runScript(targetArgs(file));
  assert.strictEqual(code, 0, stderr || stdout);
  assert.match(stdout, /DRY RUN \(no writes\)/);
  assert.match(stdout, /\[SET\] Alpha XI \/ Ann .* not set -> opener/);
  assert.match(stdout, /\[CLEAR\] Alpha XI \/ Bea .* middle_order -> not set/);
  assert.match(stdout, /Nothing was written/);

  assert.strictEqual((await Player.findById(ann._id)).battingPosition, "");
  assert.strictEqual((await Player.findById(bea._id)).battingPosition, "middle_order");
});

test("--apply writes the plan, and a second apply reports unchanged", async () => {
  const { ann, bea } = await seed();
  const file = writeCsv("apply.csv", [
    "team,player,battingPosition",
    "Alpha XI,Ann,opener",
    "Alpha XI,Bea,clear",
  ]);

  const first = runScript(targetArgs(file, ["--apply"]));
  assert.strictEqual(first.code, 0, first.stderr || first.stdout);
  assert.match(first.stdout, /APPLIED\. 2 player\(s\) updated\./);
  assert.strictEqual((await Player.findById(ann._id)).battingPosition, "opener");
  assert.strictEqual((await Player.findById(bea._id)).battingPosition, "");

  const second = runScript(targetArgs(file, ["--apply"]));
  assert.strictEqual(second.code, 0, second.stderr || second.stdout);
  assert.match(second.stdout, /2 unchanged/);
  assert.match(second.stdout, /APPLIED\. 0 player\(s\) updated\./);
});

test("a name that does not resolve blocks every write", async () => {
  const { ann } = await seed();
  const file = writeCsv("unknown.csv", [
    "team,player,battingPosition",
    "Alpha XI,Ann,opener",
    "Alpha XI,Nobody,tailender",
  ]);

  const { code, stdout, stderr } = runScript(targetArgs(file, ["--apply"]));
  assert.strictEqual(code, 1, stderr || stdout);
  assert.match(stdout, /player "Nobody" was not found in team "Alpha XI"/);
  assert.match(stdout, /Refusing to write while any row is blocked/);
  assert.strictEqual((await Player.findById(ann._id)).battingPosition, "", "Ann was not written either");
});

test("--file=value / --uri=value / --allow-database=value work", async () => {
  await seed();
  const file = writeCsv("equals.csv", [
    "team,player,battingPosition",
    "Alpha XI,Ann,middle_order",
  ]);

  const { code, stdout, stderr } = runScript([
    `--file=${file}`,
    `--uri=${uri}`,
    `--allow-database=${DB_NAME}`,
    "--force-test",
  ]);
  assert.strictEqual(code, 0, stderr || stdout);
  assert.match(stdout, /Validated: 1 row\(s\)/);
  assert.match(stdout, /DRY RUN/);
});

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

test("a test/e2e database is refused without --force-test", async () => {
  const file = writeCsv("guard.csv", ["team,player,battingPosition", "Alpha XI,Ann,opener"]);
  const { code, stdout, stderr } = runScript([
    "--file", file,
    "--uri", uri,
    "--allow-database", DB_NAME,
  ]);

  assert.strictEqual(code, 1, stdout);
  assert.match(stderr, /Refusing a test\/e2e database/);
  assert.match(stderr, /--force-test/);
});

test("an unknown option is refused", async () => {
  const file = writeCsv("unknown-option.csv", ["team,player,battingPosition", "Alpha XI,Ann,opener"]);
  const { code, stdout, stderr } = runScript(targetArgs(file, ["--bogus"]));

  assert.strictEqual(code, 1, stdout);
  assert.match(stderr, /Unknown option\(s\): --bogus/);
});
