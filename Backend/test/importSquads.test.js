// Tests for src/scripts/importSquads.js — the tournament squads bulk import.
//
// The script is exercised the way an operator runs it: as a child process
// (`node src/scripts/importSquads.js ...`) pointed at a real, throwaway
// `mongodb-memory-server` instance whose database is named
// `cric-all-import-test`, exactly like the operator-facing guard requires.
// Nothing here touches a developer, staging or production database.
//
// The fixture CSV is generated in the OS temp directory. It is a fake file with
// non-reserved names (the script refuses reserved test prefixes outright), and
// it is never copied into the repository. The real tournament file lives outside
// the repo and is only used for a manual dry run.
//
// What is pinned:
//   * a dry run validates the whole file and writes nothing;
//   * --apply creates 8 ownerless, Membership-free clubs, 8 public teams linked
//     to their club, and 120 players linked to their team;
//   * a second --apply creates nothing (idempotent);
//   * the CSV role column is mapped onto Player.playingRole; a blank role is
//     reported ("role to confirm"), never invented;
//   * captain / vice-captain come from the CSV flags;
//   * the same player name in two different teams is two people and both are
//     created (the duplicate rule is per team);
//   * an invalid file aborts before a single write;
//   * a reserved test-name prefix is refused;
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
import Membership from "../src/models/Membership.js";
import TeamCategory from "../src/models/TeamCategory.js";

const DB_NAME = "cric-all-import-test";
const BACKEND_DIR = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = path.join("src", "scripts", "importSquads.js");

let mongod;
let uri;
let tmpDir;

before(async () => {
  mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 30_000 } });
  uri = mongod.getUri(DB_NAME);
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "squads-import-"));
  await mongoose.connect(uri, { dbName: DB_NAME });
  // Build the partial unique indexes up front so the child process (which runs
  // with autoIndex disabled) still validates against a fully indexed collection.
  await Promise.all([Team.init(), Player.init(), TeamOrganization.init()]);
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
  await Promise.all([
    Team.deleteMany({}),
    Player.deleteMany({}),
    TeamOrganization.deleteMany({}),
    Membership.deleteMany({}),
    TeamCategory.deleteMany({}),
  ]);
  await TeamCategory.seedDefaults();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CLUBS = [
  "Northside Cricket Club",
  "Riverside Cricket Club",
  "Eastgate Cricket Club",
  "Westend Cricket Club",
  "Harbour Cricket Club",
  "Hilltop Cricket Club",
  "Lakeview Cricket Club",
  "Gardens Cricket Club",
];

// Two blank entries per team, so the "role to confirm" path is exercised:
// 8 teams × 2 = 16 rows with no role.
const ROLE_CYCLE = [
  "Batsman", "Bowler", "All Rounder", "Wicket Keeper", "Batsman / Wicket Keeper",
  "", "Batsman", "Bowler", "All Rounder", "Batsman",
  "", "Bowler", "Wicket Keeper", "Batsman", "All Rounder",
];

const HEADER = ["club", "team", "player_name", "role", "is_captain", "is_vice_captain", "note"];

/**
 * A valid 8-team × 15-player CSV. Player names are per-team unique, except the
 * deliberate cross-team duplicates, and no name carries a reserved prefix.
 *
 * @param {{reservedPlayer?: boolean}} [opts]
 */
function buildRows({ reservedPlayer = false } = {}) {
  const rows = [HEADER.slice()];
  CLUBS.forEach((club, i) => {
    const team = `${club} XI`;
    const names = [];
    for (let n = 1; n <= 15; n += 1) names.push(`P${i}${String(n).padStart(2, "0")}`);

    // Same person-looking names in different teams: two "Hamza", two "Yaseen".
    if (i === 0) { names[13] = "Hamza"; names[14] = "Yaseen"; }
    if (i === 1) { names[10] = "Hamza"; }
    if (i === 2) { names[12] = "Yaseen"; }

    // A reserved prefix on the first row of the first team.
    if (reservedPlayer && i === 0) names[0] = "E2E_ShouldNeverImport";

    names.forEach((name, idx) => {
      const n = idx + 1;
      let note = "";
      // A bare double quote that is NOT at the start of the field: the parser
      // must keep it literally (the real file has notes shaped like this).
      if (i === 0 && idx === 2) note = 'scored "well" in trials';
      if (i === 1 && idx === 3) note = "joined late";
      rows.push([
        club,
        team,
        name,
        ROLE_CYCLE[idx],
        n === 1 ? "yes" : "no",
        n === 2 ? "yes" : "no",
        note,
      ]);
    });
  });
  return rows;
}

/** No field contains a comma, so rows are joined raw (notes keep bare quotes). */
function toCsv(rows) {
  return `${rows.map((r) => r.join(",")).join("\n")}\n`;
}

function writeFixture(name, rows) {
  const file = path.join(tmpDir, name);
  fs.writeFileSync(file, toCsv(rows), "utf8");
  return file;
}

/** Deep-clone rows so a mutation cannot leak into another test. */
const cloneRows = (rows) => rows.map((r) => r.slice());

const POSITION_CYCLE = ["opener", "middle_order", "lower_order", "tailender"];

/**
 * The original fixture plus the optional 8th column. Row 1 (P001) is opener,
 * row 2 middle_order, and so on, so a test can assert every stored value without
 * relying on per-row special cases.
 */
function withBattingPositions(rows = buildRows()) {
  const next = cloneRows(rows);
  next[0].push("batting_position");
  next.slice(1).forEach((row, index) => row.push(POSITION_CYCLE[index % POSITION_CYCLE.length]));
  return next;
}

// ---------------------------------------------------------------------------
// Running the script
// ---------------------------------------------------------------------------

function runScript(args) {
  const env = { ...process.env };
  delete env.MIGRATION_MONGO_URL; // the script must not discover a URI by accident
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: BACKEND_DIR,
    env,
    encoding: "utf8",
  });
  return { code: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

const targetArgs = (file) => ["--file", file, "--uri", uri, "--allow-database", DB_NAME];

function dryRun(file) {
  return runScript(targetArgs(file));
}

function apply(file) {
  return runScript([...targetArgs(file), "--apply"]);
}

async function counts() {
  return {
    clubs: await TeamOrganization.countDocuments(),
    teams: await Team.countDocuments(),
    players: await Player.countDocuments(),
    memberships: await Membership.countDocuments(),
  };
}

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------

test("a dry run validates the file and writes nothing", async () => {
  const file = writeFixture("valid.csv", buildRows());
  const { code, stdout, stderr } = dryRun(file);

  assert.strictEqual(code, 0, stderr || stdout);
  assert.match(stdout, /DRY RUN/);
  assert.match(stdout, /Nothing was written/);
  assert.match(stdout, /Validated: 8 clubs, 8 teams, 120 players\./);
  assert.match(stdout, /Clubs\s+: 8 to create, 0 already exist/);
  assert.match(stdout, /Teams\s+: 8 to create, 0 already exist/);
  assert.match(stdout, /Players\s+: 120 to create, 0 already exist/);

  assert.deepStrictEqual(await counts(), { clubs: 0, teams: 0, players: 0, memberships: 0 });
});

test("blank CSV roles are reported as 'role to confirm' and CSV notes are printed", async () => {
  const file = writeFixture("roles-notes.csv", buildRows());
  const { code, stdout } = dryRun(file);

  assert.strictEqual(code, 0);
  assert.match(stdout, /Role to confirm \(16\)/);
  assert.match(stdout, /Northside Cricket Club XI \/ P006 \(line \d+\)/);
  assert.match(stdout, /CSV notes \(2\)/);
  assert.match(stdout, /scored "well" in trials/);
});

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

test("apply creates 8 ownerless, Membership-free clubs, 8 public teams and 120 players", async () => {
  const file = writeFixture("valid.csv", buildRows());
  const { code, stdout, stderr } = apply(file);
  assert.strictEqual(code, 0, stderr || stdout);

  assert.deepStrictEqual(await counts(), {
    clubs: 8,
    teams: 8,
    players: 120,
    memberships: 0,
  });

  const clubs = await TeamOrganization.find().lean();
  for (const club of clubs) {
    assert.strictEqual(club.type, "club");
    assert.strictEqual(club.owner, null, `${club.name} must be ownerless`);
    assert.ok(club.slug, `${club.name} must have a slug`);
  }

  const teams = await Team.find().lean();
  for (const team of teams) {
    assert.strictEqual(team.isPublic, true, `${team.name} must be public`);
    assert.ok(team.organizationRef, `${team.name} must be linked to its club`);
    assert.strictEqual(team.players.length, 15, `${team.name} must carry its 15-player roster`);
    assert.ok(team.captain, `${team.name} must have a captain`);
    assert.ok(team.viceCaptain, `${team.name} must have a vice-captain`);
  }

  // Every player points at its team, and the team roster contains it.
  const players = await Player.find().lean();
  for (const player of players) assert.ok(player.team, `${player.name} must be linked to a team`);
});

test("CSV roles are mapped onto Player.playingRole", async () => {
  const file = writeFixture("valid.csv", buildRows());
  const { code, stderr } = apply(file);
  assert.strictEqual(code, 0, stderr);

  const team = await Team.findOne({ name: "Northside Cricket Club XI" });
  const byName = new Map((await Player.find({ team: team._id }).lean()).map((p) => [p.name, p]));

  assert.strictEqual(byName.get("P001").playingRole, "Batsman");
  assert.strictEqual(byName.get("P002").playingRole, "Bowler");
  assert.strictEqual(byName.get("P003").playingRole, "All-Rounder");
  assert.strictEqual(byName.get("P004").playingRole, "Wicket-Keeper");
  assert.strictEqual(byName.get("P005").playingRole, "Wicket-Keeper"); // "Batsman / Wicket Keeper"

  // A blank CSV role is not invented: the row was flagged as "role to confirm",
  // and playingRole is only the schema default.
  assert.strictEqual(byName.get("P006").playingRole, "Batsman");
});

test("the optional batting_position column is written when present", async () => {
  const file = writeFixture("positions.csv", withBattingPositions());

  const dry = dryRun(file);
  assert.strictEqual(dry.code, 0, dry.stderr || dry.stdout);
  assert.match(dry.stdout, /\[opener\]/, "the dry-run plan shows the position");
  assert.deepStrictEqual(await counts(), { clubs: 0, teams: 0, players: 0, memberships: 0 });

  const applied = apply(file);
  assert.strictEqual(applied.code, 0, applied.stderr || applied.stdout);

  const team = await Team.findOne({ name: "Northside Cricket Club XI" });
  const byName = new Map((await Player.find({ team: team._id }).lean()).map((p) => [p.name, p]));
  assert.strictEqual(byName.get("P001").battingPosition, "opener");
  assert.strictEqual(byName.get("P002").battingPosition, "middle_order");
  assert.strictEqual(byName.get("P003").battingPosition, "lower_order");
  assert.strictEqual(byName.get("P004").battingPosition, "tailender");
  assert.strictEqual(byName.get("P005").battingPosition, "opener");
});

test("a blank optional batting_position cell is left unset, never guessed", async () => {
  const rows = withBattingPositions();
  const row = rows.findIndex((r, i) => i > 0 && r[2] === "P001");
  rows[row][7] = "";
  const file = writeFixture("positions-blank.csv", rows);
  const { code, stderr } = apply(file);
  assert.strictEqual(code, 0, stderr);

  const player = await Player.findOne({ name: "P001" });
  assert.strictEqual(player.battingPosition, "");
});

test("an unknown batting_position value aborts before a single write", async () => {
  const rows = withBattingPositions();
  const row = rows.findIndex((r, i) => i > 0 && r[2] === "P001");
  rows[row][7] = "sweeper";
  const file = writeFixture("positions-bad.csv", rows);

  const { code, stderr } = apply(file);
  assert.strictEqual(code, 1, stderr);
  assert.match(stderr, /unknown batting_position "sweeper"/);
  assert.match(stderr, /allowed: opener, middle_order, lower_order, tailender/);
  assert.deepStrictEqual(await counts(), { clubs: 0, teams: 0, players: 0, memberships: 0 });
});

test("a 7-column file still works and writes no position", async () => {
  const file = writeFixture("valid.csv", buildRows());
  const { code, stderr } = apply(file);
  assert.strictEqual(code, 0, stderr);

  const player = await Player.findOne({ name: "P001" });
  assert.strictEqual(player.battingPosition, "", "the legacy shape is not backfilled");
});

test("captain and vice-captain are set from the CSV flags", async () => {
  const file = writeFixture("valid.csv", buildRows());
  const { code, stderr } = apply(file);
  assert.strictEqual(code, 0, stderr);

  const teams = await Team.find().lean();
  for (const team of teams) {
    const captain = await Player.findById(team.captain).lean();
    const vice = await Player.findById(team.viceCaptain).lean();
    assert.ok(captain, `${team.name} captain must resolve`);
    assert.ok(vice, `${team.name} vice-captain must resolve`);
    assert.strictEqual(String(captain.team), String(team._id));
    assert.strictEqual(String(vice.team), String(team._id));
    assert.match(captain.name, /01$/, `${team.name} captain should be its row 1`);
    assert.match(vice.name, /02$/, `${team.name} vice-captain should be its row 2`);
  }
});

test("the same name in two different teams is two players and both are created", async () => {
  const file = writeFixture("valid.csv", buildRows());
  const { code, stderr } = apply(file);
  assert.strictEqual(code, 0, stderr);

  const hamza = await Player.find({ name: "Hamza" }).lean();
  const yaseen = await Player.find({ name: "Yaseen" }).lean();

  assert.strictEqual(hamza.length, 2, "both Hamza rows must be kept");
  assert.strictEqual(yaseen.length, 2, "both Yaseen rows must be kept");
  assert.notStrictEqual(String(hamza[0].team), String(hamza[1].team), "the two Hamzas are in different teams");
  assert.notStrictEqual(String(yaseen[0].team), String(yaseen[1].team), "the two Yaseens are in different teams");
});

test("a second apply creates nothing (idempotent)", async () => {
  const file = writeFixture("valid.csv", buildRows());

  const first = apply(file);
  assert.strictEqual(first.code, 0, first.stderr);
  const afterFirst = await counts();
  assert.deepStrictEqual(afterFirst, { clubs: 8, teams: 8, players: 120, memberships: 0 });

  const second = apply(file);
  assert.strictEqual(second.code, 0, second.stderr);
  assert.match(second.stdout, /Clubs\s+: 0 to create, 8 already exist/);
  assert.match(second.stdout, /Teams\s+: 0 to create, 8 already exist/);
  assert.match(second.stdout, /Players\s+: 0 to create, 120 already exist/);
  assert.match(second.stdout, /created 0, already existed 8/); // clubs
  assert.match(second.stdout, /created 0, already existed 120/); // players

  assert.deepStrictEqual(await counts(), afterFirst, "a re-run changed nothing");
});

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

test("an invalid file aborts before a single write", async () => {
  // Team 0 loses a row: only 14 players.
  const short = cloneRows(buildRows());
  const header = short[0];
  const teamName = `${CLUBS[0]} XI`;
  const cutIndex = short.findIndex((r, i) => i > 0 && r[1] === teamName);
  short.splice(cutIndex, 1);

  const file = writeFixture("short.csv", short);
  const { code, stderr } = apply(file);

  assert.strictEqual(code, 1, stderr);
  assert.match(stderr, /REFUSING TO RUN/);
  assert.match(stderr, /CSV validation failed/);
  assert.match(stderr, /expected 15/);
  void header;

  assert.deepStrictEqual(await counts(), { clubs: 0, teams: 0, players: 0, memberships: 0 });
});

test("more than one captain in a team aborts before a single write", async () => {
  const rows = cloneRows(buildRows());
  const teamName = `${CLUBS[0]} XI`;
  const secondRow = rows.findIndex((r, i) => i > 0 && r[1] === teamName && r[2] === "P002");
  rows[secondRow][4] = "yes"; // a second captain

  const file = writeFixture("two-captains.csv", rows);
  const { code, stderr } = apply(file);

  assert.strictEqual(code, 1, stderr);
  assert.match(stderr, /has 2 captains, expected exactly 1/);
  assert.deepStrictEqual(await counts(), { clubs: 0, teams: 0, players: 0, memberships: 0 });
});

test("a reserved test-name prefix is refused before any write", async () => {
  const file = writeFixture("reserved.csv", buildRows({ reservedPlayer: true }));
  const { code, stderr } = apply(file);

  assert.strictEqual(code, 1, stderr);
  assert.match(stderr, /reserved test-name prefix/);
  assert.deepStrictEqual(await counts(), { clubs: 0, teams: 0, players: 0, memberships: 0 });
});

test("a non-local MongoDB host is refused", async () => {
  const file = writeFixture("valid.csv", buildRows());
  const { code, stderr } = runScript([
    "--file", file,
    "--uri", `mongodb://example.com:27017/${DB_NAME}`,
    "--allow-database", DB_NAME,
  ]);

  assert.strictEqual(code, 1);
  assert.match(stderr, /non-local MongoDB target/);
});

test("a database other than the allowed one is refused", async () => {
  const file = writeFixture("valid.csv", buildRows());
  const { code, stderr } = runScript([
    "--file", file,
    "--uri", "mongodb://127.0.0.1:1/some_other_database",
  ]);

  assert.strictEqual(code, 1);
  assert.match(stderr, /Refusing to import into database "some_other_database"/);
  assert.match(stderr, /Expected "cric-all-e2e"/);
});

test("a missing --file is refused", async () => {
  const { code, stderr } = runScript(["--uri", uri, "--allow-database", DB_NAME]);
  assert.strictEqual(code, 1);
  assert.match(stderr, /No CSV file/);
});

test("a missing connection string is refused", async () => {
  const file = writeFixture("valid.csv", buildRows());
  const { code, stderr } = runScript(["--file", file]);
  assert.strictEqual(code, 1);
  assert.match(stderr, /No connection string/);
});
