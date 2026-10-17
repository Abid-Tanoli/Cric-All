// Tests for src/scripts/attachPlayerPhotos.js — attaching profile photos to the
// squads-2026-10 players.
//
// The script is exercised the way an operator runs it: as a child process
// (`node src/scripts/attachPlayerPhotos.js ...`) pointed at a real throwaway
// `mongodb-memory-server` instance whose database is named
// `cric-all-photos-test`. Nothing here touches a developer, staging or
// production database, and no real photo is ever read or written:
//
//   * the photos directory is a temp folder holding a handful of tiny fake
//     JPEG files (never the real manifest or D:\cricall-player-photos);
//   * the uploads destination is redirected with UPLOADS_DIR to a temp folder,
//     so a run never writes into the repository tree.
//
// What is pinned:
//   * a dry run writes nothing (no file, no document);
//   * --apply stores each photo through the same uploads path and sets
//     Player.imageUrl to an absolute PUBLIC_BACKEND_URL-based URL;
//   * a second --apply skips every player that already has a photo;
//   * distinct duplicate-looking names ("Majid Afridi" vs "Majid Afridi (2)")
//     map to their own players and their own files;
//   * a row with no matching player and a row whose file is missing are both
//     reported, not guessed, and not written;
//   * both target guards (host and database) refuse a mistargeted URI.

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
import TeamOrganization from "../src/models/TeamOrganization.js";

const DB_NAME = "cric-all-photos-test";
const BACKEND_DIR = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = path.join("src", "scripts", "attachPlayerPhotos.js");
const PUBLIC_BASE = "https://cdn.example.test";

// A minimal JPEG-looking blob. storeImage only checks the declared mimetype
// (derived from the extension), so this is enough — and it is obviously not a
// real photograph.
const TINY_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

let mongod;
let uri;
let photoDir;
let uploadsDir;
let manifestFile;

const fileSafe = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// The batch fixtures: two of the eight clubs, with a duplicate-looking name pair
// inside one team and one player whose photo file is deliberately absent.
const FIXTURES = [
  {
    club: "Young Star",
    players: [
      { name: "Majid Afridi", photo: "young-star__01-majid-afridi.jpg" },
      { name: "Majid Afridi (2)", photo: "young-star__02-majid-afridi-2.jpg" },
      { name: "Br. Aqal", photo: "young-star__03-br-aqal.jpg" },
    ],
  },
  {
    club: "Baldia Zalmi",
    players: [
      { name: "Wali Amber", photo: "baldia-zalmi__01-wali-amber.jpg" },
      { name: "Nasir", photo: "baldia-zalmi__02-nasir.jpg" },
      { name: "Ghost Player", photo: "baldia-zalmi__03-ghost-player.jpg" },
    ],
  },
];

function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function writePhoto(name, bytes = TINY_JPEG) {
  fs.writeFileSync(path.join(photoDir, name), bytes);
}

const STANDARD_MANIFEST = [
  ["Young Star", "Majid Afridi", "young-star__01-majid-afridi.jpg"],
  ["Young Star", "Majid Afridi (2)", "young-star__02-majid-afridi-2.jpg"],
  ["Young Star", "Br. Aqal", "young-star__03-br-aqal.jpg"],
  ["Baldia Zalmi", "Wali Amber", "baldia-zalmi__01-wali-amber.jpg"],
  ["Baldia Zalmi", "Nasir", "baldia-zalmi__02-nasir.jpg"],
  // Ghost Player exists in the DB but its file is never written -> missing file.
  ["Baldia Zalmi", "Ghost Player", "baldia-zalmi__03-ghost-player.jpg"],
  // No player by this name exists; the file does exist, so the row is unmatched
  // because of the player, not the file.
  ["Young Star", "Nobody Here", "nobody-here.jpg"],
];

function writeManifest(rows, name = "manifest.csv") {
  const text = ["team,player_name,file", ...rows.map((r) => r.join(","))].join("\n") + "\n";
  const file = path.join(photoDir, name);
  fs.writeFileSync(file, text, "utf8");
  return file;
}

async function seed() {
  for (const { club, players } of FIXTURES) {
    const org = await TeamOrganization.create({
      name: club,
      slug: fileSafe(club),
      type: "club",
      owner: null,
    });
    const team = await Team.create({ name: club, organizationRef: org._id, isPublic: true });
    for (const { name, photo } of players) {
      const player = await Player.create({ name, team: team._id });
      if (photo && !photo.includes("ghost-player")) writePhoto(photo);
      await Team.updateOne({ _id: team._id }, { $addToSet: { players: player._id } });
    }
  }
  writePhoto("nobody-here.jpg");
}

before(async () => {
  // A cold first run (unpacking the bundled mongod) can exceed the upstream
  // 10s default, so allow a generous window.
  mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  uri = mongod.getUri(DB_NAME);
  photoDir = fs.mkdtempSync(path.join(os.tmpdir(), "player-photos-"));
  uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "player-uploads-"));
  await mongoose.connect(uri, { dbName: DB_NAME });
  await Promise.all([Team.init(), Player.init(), TeamOrganization.init()]);
});

after(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  }
  if (mongod) await mongod.stop();
  if (photoDir) fs.rmSync(photoDir, { recursive: true, force: true });
  if (uploadsDir) fs.rmSync(uploadsDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await Promise.all([Team.deleteMany({}), Player.deleteMany({}), TeamOrganization.deleteMany({})]);
  resetDir(photoDir);
  resetDir(uploadsDir);
  await seed();
  manifestFile = writeManifest(STANDARD_MANIFEST);
});

// ---------------------------------------------------------------------------
// Running the script
// ---------------------------------------------------------------------------

function runScript(args, extraEnv = {}) {
  const env = {
    ...process.env,
    UPLOADS_DIR: uploadsDir,
    PUBLIC_BACKEND_URL: PUBLIC_BASE,
    ...extraEnv,
  };
  delete env.MIGRATION_MONGO_URL; // the script must not discover a URI by accident
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: BACKEND_DIR,
    env,
    encoding: "utf8",
  });
  return { code: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

const targetArgs = (manifest = manifestFile) => [
  "--manifest", manifest,
  "--dir", photoDir,
  "--uri", uri,
  "--allow-database", DB_NAME,
];

const dryRun = (manifest) => runScript(targetArgs(manifest));
const apply = (manifest, extra = []) => runScript([...targetArgs(manifest), "--apply", ...extra]);

async function playerByName(name) {
  return Player.findOne({ name }).lean();
}

function uploadFilenames() {
  return fs.readdirSync(uploadsDir);
}

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------

test("a dry run validates the manifest and writes nothing", async () => {
  const { code, stdout, stderr } = dryRun();
  assert.strictEqual(code, 0, stderr || stdout);

  assert.match(stdout, /DRY RUN/);
  assert.match(stdout, /will attach\s+: 5/);
  assert.match(stdout, /already have photo\s+: 0/);
  assert.match(stdout, /missing file\s+: 1/);
  assert.match(stdout, /Unmatched\s+: 1/);
  assert.match(stdout, /Nothing was written/);

  // No document was touched and no file was written.
  assert.strictEqual(await Player.countDocuments({ imageUrl: { $ne: "" } }), 0);
  assert.deepStrictEqual(uploadFilenames(), []);
});

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

test("apply stores the photos and sets an absolute imageUrl on each matched player", async () => {
  const { code, stdout, stderr } = apply();
  assert.strictEqual(code, 0, stderr || stdout);
  assert.match(stdout, /APPLIED\./);
  assert.match(stdout, /Photos attached\s+: 5/);

  const expected = [
    "Majid Afridi",
    "Majid Afridi (2)",
    "Br. Aqal",
    "Wali Amber",
    "Nasir",
  ];
  for (const name of expected) {
    const player = await playerByName(name);
    assert.match(player.imageUrl, new RegExp(`^${PUBLIC_BASE}/uploads/`), `${name} must get an absolute URL`);
    const stored = path.basename(player.imageUrl);
    assert.ok(fs.existsSync(path.join(uploadsDir, stored)), `${name}'s file must exist on disk`);
  }

  // The missing-file row and the unmatched row were not written.
  assert.strictEqual((await playerByName("Ghost Player")).imageUrl, "");
  assert.strictEqual(await Player.countDocuments({ imageUrl: { $ne: "" } }), 5);
  assert.strictEqual(uploadFilenames().length, 5);
});

test("a second apply skips every player that already has a photo", async () => {
  const first = apply();
  assert.strictEqual(first.code, 0, first.stderr);
  const afterFirst = uploadFilenames().length;

  const second = apply();
  assert.strictEqual(second.code, 0, second.stderr);
  assert.match(second.stdout, /will attach\s+: 0/);
  assert.match(second.stdout, /already have photo\s+: 5/);
  assert.match(second.stdout, /Photos attached\s+: 0/);
  assert.strictEqual(uploadFilenames().length, afterFirst, "a re-run must not add files");
});

test("--force re-uploads for a player that already has a photo", async () => {
  const first = apply();
  assert.strictEqual(first.code, 0, first.stderr);

  const forced = apply(manifestFile, ["--force"]);
  assert.strictEqual(forced.code, 0, forced.stderr);
  assert.match(forced.stdout, /will attach\s+: 5/);
  assert.match(forced.stdout, /Photos attached\s+: 5/);
});

test('distinct "(2)" names map to their own players and their own photos', async () => {
  const { code, stderr } = apply();
  assert.strictEqual(code, 0, stderr);

  const plain = await playerByName("Majid Afridi");
  const dup = await playerByName("Majid Afridi (2)");

  assert.ok(plain.imageUrl, "Majid Afridi must have a photo");
  assert.ok(dup.imageUrl, "Majid Afridi (2) must have a photo");
  assert.notStrictEqual(plain.imageUrl, dup.imageUrl, "the two players get different files");
  assert.ok(dup.imageUrl.includes("majid-afridi-2"), "(2) player points at the -2 file");
  assert.ok(plain.imageUrl.includes("majid-afridi"), "plain player points at its own file");
  assert.ok(!plain.imageUrl.includes("majid-afridi-2"), "plain player does not point at the (2) file");
});

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

test("an unmatched row is reported and never written", async () => {
  const { code, stdout } = dryRun();
  assert.strictEqual(code, 0);
  assert.match(stdout, /Unmatched\s+: 1/);
  assert.match(stdout, /Nobody Here/);
  assert.match(stdout, /no player named "Nobody Here"/);
});

test("a missing photo file is reported and never written", async () => {
  const { code, stdout } = dryRun();
  assert.strictEqual(code, 0);
  assert.match(stdout, /missing file\s+: 1/);
  assert.match(stdout, /Ghost Player/);
});

test("a duplicate manifest row is reported", async () => {
  const dupManifest = writeManifest([
    ...STANDARD_MANIFEST,
    ["Young Star", "Br. Aqal", "young-star__03-br-aqal.jpg"],
  ], "duplicate.csv");

  const { code, stdout } = dryRun(dupManifest);
  assert.strictEqual(code, 0);
  assert.match(stdout, /Duplicate rows:\s+2/);
  assert.match(stdout, /\[duplicate\]/);
});

test("an ambiguous player name is reported and not guessed", async () => {
  // A second player whose name folds to the same value inside the same team.
  const team = await Team.findOne({ name: "Young Star" });
  await Player.create({ name: "majid afridi", team: team._id });

  const { code, stdout } = dryRun();
  assert.strictEqual(code, 0);
  assert.match(stdout, /Ambiguous\s+: 1/);
  assert.match(stdout, /\[ambiguous\]/);
});

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

test("a non-local MongoDB host is refused", () => {
  const { code, stderr } = runScript([
    "--manifest", manifestFile,
    "--dir", photoDir,
    "--uri", `mongodb://example.com:27017/${DB_NAME}`,
    "--allow-database", DB_NAME,
  ]);
  assert.strictEqual(code, 1);
  assert.match(stderr, /non-local MongoDB target/);
});

test("a database other than the allowed one is refused", () => {
  const { code, stderr } = runScript([
    "--manifest", manifestFile,
    "--dir", photoDir,
    "--uri", "mongodb://127.0.0.1:1/some_other_database",
  ]);
  assert.strictEqual(code, 1);
  assert.match(stderr, /Refusing to attach photos into database "some_other_database"/);
  assert.match(stderr, /Expected "cric-all-e2e"/);
});

test("a missing --manifest is refused", () => {
  const { code, stderr } = runScript(["--dir", photoDir, "--uri", uri, "--allow-database", DB_NAME]);
  assert.strictEqual(code, 1);
  assert.match(stderr, /No manifest file/);
});

test("a missing --dir is refused", () => {
  const { code, stderr } = runScript(["--manifest", manifestFile, "--uri", uri, "--allow-database", DB_NAME]);
  assert.strictEqual(code, 1);
  assert.match(stderr, /No photos directory/);
});
