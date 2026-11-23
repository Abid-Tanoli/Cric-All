// Tests for src/scripts/cleanupTestData.js.
//
// The script is destructive only with --apply, so these tests pin the whole
// safety chain: dry run writes nothing, a missing backup or a wrong --confirm
// refuses, real records (and anything a real record references) are untouched,
// one audit entry is written per collection, and a second run finds nothing.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";

import { startTestDb, stopTestDb } from "./helpers/testDb.js";
import {
  runCleanup,
  collectCleanupPlan,
  findFreshBackup,
  parseArgs,
} from "../src/scripts/cleanupTestData.js";
import User from "../src/models/User.js";
import Team from "../src/models/Team.js";
import TeamOrganization from "../src/models/TeamOrganization.js";
import Player from "../src/models/Player.js";
import TeamPlayerRanking from "../src/models/TeamPlayerRanking.js";
import Tournament from "../src/models/Tournament.js";
import Match from "../src/models/Match.js";
import Ball from "../src/models/Ball.js";
import Event from "../src/models/Event.js";
import Sponsor from "../src/models/Sponsor.js";
import CommunityPost from "../src/models/CommunityPost.js";
import CommunityComment from "../src/models/CommunityComment.js";
import IssueReport from "../src/models/IssueReport.js";
import Membership from "../src/models/Membership.js";
import AuditLog from "../src/models/AuditLog.js";

let mongod;
let seq = 0;
let backupDir;

const unique = (label) => `${label} ${Date.now()}-${++seq}`;

const lines = () => {
  const out = [];
  return { out, log: (line) => out.push(String(line)), text: () => out.join("\n") };
};

async function makeUser(overrides = {}) {
  return User.create({
    name: unique("Real User"),
    email: `real-${Date.now()}-${++seq}@example.test`,
    password: "password-123",
    ...overrides,
  });
}

async function makeBackup(name = "backup-test.archive.gz") {
  const file = path.join(backupDir, name);
  fs.writeFileSync(file, "archive");
  return file;
}

before(async () => {
  mongod = await startTestDb();
  backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "cricall-cleanup-backups-"));
});

after(async () => {
  fs.rmSync(backupDir, { recursive: true, force: true });
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  for (const file of fs.readdirSync(backupDir)) fs.rmSync(path.join(backupDir, file));
});

test("parseArgs only treats an exact --apply as destructive", () => {
  assert.deepEqual(parseArgs([]), { apply: false, confirm: null });
  assert.deepEqual(parseArgs(["--apply", "--confirm=12"]), { apply: true, confirm: 12 });
  assert.equal(parseArgs(["--confirm=abc"]).confirm, null);
});

test("findFreshBackup ignores missing dirs, wrong names and stale archives", async () => {
  assert.equal(await findFreshBackup({ dir: path.join(backupDir, "missing") }), null);

  const stale = path.join(backupDir, "backup-old.archive.gz");
  fs.writeFileSync(stale, "archive");
  const old = new Date(Date.now() - 31 * 60 * 1000);
  fs.utimesSync(stale, old, old);
  fs.writeFileSync(path.join(backupDir, "notes.txt"), "not a backup");

  assert.equal(await findFreshBackup({ dir: backupDir }), null);

  const fresh = await makeBackup();
  const found = await findFreshBackup({ dir: backupDir });
  assert.equal(found?.path, fresh);
});

test("dry run reports matching records and related children but writes nothing", async () => {
  const testTeam = await Team.create({ name: `TEST_Team ${Date.now()}` });
  const testPlayer = await Player.create({ name: `TEST_Player ${Date.now()}`, team: testTeam._id });
  const realTeam = await Team.create({ name: unique("Real Team") });
  const realPlayer = await Player.create({ name: unique("Real Player"), team: realTeam._id });

  const before = {
    teams: await Team.countDocuments(),
    players: await Player.countDocuments(),
  };
  const { out, log, text } = lines();

  const result = await runCleanup({ argv: [], backupDir, out: log });

  assert.equal(result.exitCode, 0);
  assert.ok(result.plan.total >= 2);
  assert.match(text(), /DRY RUN \(no writes\)/);
  assert.match(text(), /TEST_Team/);
  assert.match(text(), /TEST_Player/);
  assert.equal(await Team.countDocuments(), before.teams);
  assert.equal(await Player.countDocuments(), before.players);
  assert.ok(out.length > 0);
  assert.ok(await Team.findById(testTeam._id), "test team still exists after a dry run");
  assert.ok(await Player.findById(testPlayer._id));
  assert.ok(await Player.findById(realPlayer._id));
});

test("--apply without a fresh backup refuses and changes nothing", async () => {
  const team = await Team.create({ name: `TEST_NoBackup ${Date.now()}` });
  const { log, text } = lines();

  const result = await runCleanup({ argv: ["--apply", "--confirm=1"], backupDir, out: log });

  assert.equal(result.exitCode, 1);
  assert.match(text(), /no backup newer than 30 minutes/i);
  assert.match(text(), /npm run db:backup/);
  assert.ok(await Team.findById(team._id));
});

test("--apply with the wrong --confirm refuses and changes nothing", async () => {
  const team = await Team.create({ name: `TEST_WrongConfirm ${Date.now()}` });
  await makeBackup();
  const { log, text } = lines();

  const result = await runCleanup({ argv: ["--apply", "--confirm=999"], backupDir, out: log });

  assert.equal(result.exitCode, 1);
  assert.match(text(), /does not match the dry-run total/i);
  assert.ok(await Team.findById(team._id));
});

test("a test record referenced by real data is skipped, not deleted", async () => {
  const testTeam = await Team.create({ name: `TEST_Referenced ${Date.now()}` });
  const realPlayer = await Player.create({ name: unique("Real Attached Player"), team: testTeam._id });

  const testOrg = await TeamOrganization.create({ name: `TEST_Org ${Date.now()}` });
  const realOwner = await makeUser();
  await Membership.create({ organization: testOrg._id, user: realOwner._id, roles: ["owner"] });
  await TeamOrganization.updateOne({ _id: testOrg._id }, { $set: { owner: realOwner._id } });

  // A separate, unreferenced test player proves the apply path really ran.
  const unrelated = await Player.create({ name: `TEST_Unreferenced ${Date.now()}` });

  const plan = await collectCleanupPlan();
  assert.ok(plan.total > 0);
  const skippedTeams = plan.skipped.filter((entry) => entry.collection === "teams");
  const skippedOrgs = plan.skipped.filter((entry) => entry.collection === "teamorganizations");
  assert.ok(skippedTeams.some((entry) => entry.id === String(testTeam._id)));
  assert.ok(skippedOrgs.some((entry) => entry.id === String(testOrg._id)));

  const { log, text } = lines();
  await makeBackup();
  const result = await runCleanup({
    argv: ["--apply", `--confirm=${plan.total}`],
    backupDir,
    out: log,
  });
  assert.equal(result.exitCode, 0, text());
  assert.equal(await Player.countDocuments({ _id: unrelated._id }), 0);

  assert.ok(await Team.findById(testTeam._id), "a team holding a real player is skipped");
  assert.ok(await TeamOrganization.findById(testOrg._id), "an org with a real owner is skipped");
  assert.ok(await Player.findById(realPlayer._id));
  assert.ok(await TeamOrganization.findById(testOrg._id), "an org with a real owner is skipped");
});

test("apply deletes exact test records and their children, leaves real data, audits each collection, and is idempotent", async () => {
  const testUser = await User.create({
    name: `OPENCODE_TEST_User ${Date.now()}`,
    email: `opencode_test_${Date.now()}@example.test`,
    password: "password-123",
  });
  const testOrg = await TeamOrganization.create({ name: `TEST_OrgForCleanup ${Date.now()}` });
  await Membership.create({ organization: testOrg._id, user: testUser._id, roles: ["owner"] });
  await TeamOrganization.updateOne({ _id: testOrg._id }, { $set: { owner: testUser._id } });

  const testTeam = await Team.create({ name: `TEST_TeamForCleanup ${Date.now()}` });
  const testPlayer = await Player.create({ name: `TEST_PlayerForCleanup ${Date.now()}`, team: testTeam._id });
  await TeamPlayerRanking.create({ team: testTeam._id, player: testPlayer._id });

  const testTournament = await Tournament.create({
    name: `TEST_Cup ${Date.now()}`,
    teams: [testTeam._id],
    startDate: new Date("2026-10-01"),
    endDate: new Date("2026-10-10"),
  });
  const testMatch = await Match.create({
    title: `TEST_Final ${Date.now()}`,
    tournament: testTournament._id,
    teams: [testTeam._id],
  });
  await Ball.create({ matchId: testMatch._id, over: 1, ball: 1, runs: 4 });
  const testEvent = await Event.create({ eventType: "single-match", name: `TEST_Event ${Date.now()}` });
  const testSponsor = await Sponsor.create({
    name: `TEST_Sponsor ${Date.now()}`,
    logoUrl: "/uploads/test-sponsor.png",
  });
  const realAuthor = await makeUser();
  const testPost = await CommunityPost.create({
    title: `TEST_Post ${Date.now()}`,
    authorUser: realAuthor._id,
    kind: "article",
    subject: { type: "user", ref: realAuthor._id },
  });
  await CommunityComment.create({ post: testPost._id, author: realAuthor._id, body: "test comment" });
  const realOrg = await TeamOrganization.create({ name: unique("Real Org") });
  await IssueReport.create({
    organization: realOrg._id,
    reporter: realAuthor._id,
    type: "issue",
    subject: `TEST_Issue ${Date.now()}`,
    description: "fixture",
  });

  const realTeam = await Team.create({ name: unique("Real Team") });
  const realPlayer = await Player.create({ name: unique("Real Player"), team: realTeam._id });
  const realMatch = await Match.create({ title: unique("Real Match"), teams: [realTeam._id] });
  await Ball.create({ matchId: realMatch._id, over: 1, ball: 1, runs: 1 });

  const plan = await collectCleanupPlan();
  assert.ok(plan.total >= 10, `expected a full plan, got ${plan.total}`);

  await makeBackup();
  const { log, text } = lines();
  const result = await runCleanup({
    argv: ["--apply", `--confirm=${plan.total}`],
    backupDir,
    out: log,
  });
  assert.equal(result.exitCode, 0, text());

  assert.equal(await User.countDocuments({ name: /^OPENCODE_TEST/ }), 0);
  assert.equal(await Team.countDocuments({ name: /^TEST_/ }), 0);
  assert.equal(await Player.countDocuments({ name: /^TEST_/ }), 0);
  assert.equal(await Tournament.countDocuments({ name: /^TEST_/ }), 0);
  assert.equal(await Match.countDocuments({ title: /^TEST_/ }), 0);
  assert.equal(await Ball.countDocuments({ matchId: testMatch._id }), 0);
  assert.equal(await Event.countDocuments({ name: /^TEST_/ }), 0);
  assert.equal(await Sponsor.countDocuments({ name: /^TEST_/ }), 0);
  assert.equal(await CommunityPost.countDocuments({ title: /^TEST_/ }), 0);
  assert.equal(await CommunityComment.countDocuments({ post: testPost._id }), 0);
  assert.equal(await IssueReport.countDocuments({ subject: /^TEST_/ }), 0);
  assert.equal(await TeamPlayerRanking.countDocuments({ team: testTeam._id }), 0);

  // Real data, and its ball events, survive.
  assert.ok(await Team.findById(realTeam._id));
  assert.ok(await Player.findById(realPlayer._id));
  assert.ok(await Match.findById(realMatch._id));
  assert.equal(await Ball.countDocuments({ matchId: realMatch._id }), 1);
  assert.ok(await TeamOrganization.findById(realOrg._id));

  const audit = await AuditLog.find({ action: "testdata.cleanup" }).lean();
  assert.ok(audit.length > 0, "one audit entry per removed collection");
  assert.ok(audit.every((entry) => entry.actorType === "system"));
  assert.ok(audit.every((entry) => Array.isArray(entry.metadata.ids) && entry.metadata.ids.length > 0));
  assert.equal(new Set(audit.map((entry) => entry.metadata.collection)).size, audit.length);

  // Idempotent: a second dry run finds nothing.
  const { log: secondLog, text: secondText } = lines();
  const second = await runCleanup({ argv: [], backupDir, out: secondLog });
  assert.equal(second.exitCode, 0);
  assert.equal(second.plan.total, 0);
  assert.match(secondText(), /Nothing matches the test-data prefix rules/);
});
