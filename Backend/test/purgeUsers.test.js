// Tests for src/scripts/purgeUsers.js.
//
// Fresh in-memory data only, no network. These pin the safety chain: exact
// keep/protect arguments, a dry run that writes nothing, protected scorecard
// graphs that survive with only creator pointers cleared, opt-in org deletion,
// backup/confirm guards, the protected snapshot check, audits and idempotency.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";

import { startTestDb, stopTestDb } from "./helpers/testDb.js";
import {
  parseArgs,
  validateArgs,
  findFreshBackup,
  runPurge,
  AUDIT_USER,
  AUDIT_ORG,
} from "../src/scripts/purgeUsers.js";
import { ensureDefaultTeam } from "../src/services/teamService.js";

import User from "../src/models/User.js";
import Admin from "../src/models/Admin.js";
import Team from "../src/models/Team.js";
import TeamOrganization from "../src/models/TeamOrganization.js";
import Player from "../src/models/Player.js";
import TeamRanking from "../src/models/TeamRanking.js";
import TeamPlayerRanking from "../src/models/TeamPlayerRanking.js";
import Match from "../src/models/Match.js";
import Ball from "../src/models/Ball.js";
import Tournament from "../src/models/Tournament.js";
import TournamentMedia from "../src/models/TournamentMedia.js";
import Event from "../src/models/Event.js";
import CommunityPost from "../src/models/CommunityPost.js";
import IssueReport from "../src/models/IssueReport.js";
import Membership from "../src/models/Membership.js";
import Invitation from "../src/models/Invitation.js";
import HandlerRequest from "../src/models/HandlerRequest.js";
import MatchOfficial from "../src/models/MatchOfficial.js";
import AuditLog from "../src/models/AuditLog.js";

let mongod;
let seq = 0;
let backupDir;

const unique = (label) => `${label} ${Date.now()}-${++seq}`;
const lines = () => {
  const out = [];
  return { out, log: (line) => out.push(String(line)), text: () => out.join("\n") };
};

async function makeUser(label = "user") {
  return User.create({
    name: unique(label),
    email: `${label}-${Date.now()}-${++seq}@example.test`,
    password: "password-123",
  });
}

async function makeBackup() {
  const file = path.join(backupDir, "backup-test.archive.gz");
  fs.writeFileSync(file, "archive");
  return file;
}

const argsFor = (orgIds, extra = []) => [
  `--protect-orgs=${orgIds.join(",")}`,
  ...extra,
];

async function preview(orgIds, extra = []) {
  const capture = lines();
  const result = await runPurge({ argv: argsFor(orgIds, extra), backupDir, out: capture.log });
  return { result, capture };
}

/** A protected legacy org with a full scorecard graph. */
async function seedLegacy(user = null) {
  const org = await TeamOrganization.create({ name: unique("Legacy Org") });
  const team = await Team.create({ name: unique("Legacy XI"), organizationRef: org._id, organization: org.name });
  const player = await Player.create({
    name: unique("Legacy Player"),
    team: team._id,
    teamHistory: [{ team: team._id, isCurrent: true }],
    createdBy: user?._id || null,
  });
  await Team.updateOne({ _id: team._id }, { $set: { players: [player._id], managedBy: user?._id || null } });
  await TeamRanking.create({ team: team._id });
  await TeamPlayerRanking.create({ team: team._id, player: player._id });
  const match = await Match.create({ title: unique("Legacy Match"), teams: [team._id], organizationRef: org._id });
  const ball = await Ball.create({ matchId: match._id, over: 1, ball: 1, runs: 4 });
  const tournament = await Tournament.create({
    name: unique("Legacy Cup"),
    teams: [team._id],
    organizationRef: org._id,
    startDate: new Date("2026-10-01"),
    endDate: new Date("2026-10-10"),
  });
  const media = await TournamentMedia.create({
    tournament: tournament._id,
    kind: "photo",
    url: "/uploads/legacy-photo.png",
    caption: "protected upload",
  });
  const event = await Event.create({
    eventType: "single-match",
    name: unique("Legacy Event"),
    organization: org._id,
    teams: [team._id],
    createdBy: user?._id || null,
  });
  if (user) {
    await Membership.create({ organization: org._id, user: user._id, roles: ["owner"], status: "active" });
    await TeamOrganization.updateOne({ _id: org._id }, { $set: { owner: user._id, createdBy: user._id } });
  }
  return { org, team, player, match, ball, tournament, media, event };
}

before(async () => {
  mongod = await startTestDb();
  backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "cricall-purge-backups-"));
});

after(async () => {
  fs.rmSync(backupDir, { recursive: true, force: true });
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  for (const file of fs.readdirSync(backupDir)) fs.rmSync(path.join(backupDir, file));
  seq = 0;
});

test("parseArgs and validateArgs require exactly one keep option and at least one protected org", () => {
  assert.deepEqual(parseArgs([]), {
    apply: false, confirm: null, keep: [], keepNone: false, protectOrgs: [], deleteOwnedOrgs: false,
  });
  assert.deepEqual(parseArgs(["--keep=A@x.com,b@x.com", "--protect-orgs=a,b", "--keep-none", "--delete-owned-orgs", "--apply", "--confirm=4"]), {
    apply: true,
    confirm: 4,
    keep: ["A@x.com", "b@x.com"],
    keepNone: true,
    protectOrgs: ["a", "b"],
    deleteOwnedOrgs: true,
  });
  assert.equal(parseArgs(["--confirm=abc"]).confirm, null);

  assert.equal(validateArgs(parseArgs([])).length, 2);
  assert.equal(validateArgs(parseArgs(["--keep-none"])).length, 1);
  assert.equal(validateArgs(parseArgs(["--keep=a@x.com", "--keep-none", `--protect-orgs=${new mongoose.Types.ObjectId()}`])).length, 1);
  assert.equal(validateArgs(parseArgs(["--keep=a@x.com", "--protect-orgs=not-an-id"])).length, 1);
  assert.deepEqual(validateArgs(parseArgs(["--keep-none", `--protect-orgs=${new mongoose.Types.ObjectId()}`])), []);
});

test("findFreshBackup ignores stale/missing archives", async () => {
  assert.equal(await findFreshBackup({ dir: path.join(backupDir, "missing") }), null);
  const stale = path.join(backupDir, "backup-old.archive.gz");
  fs.writeFileSync(stale, "archive");
  const old = new Date(Date.now() - 31 * 60 * 1000);
  fs.utimesSync(stale, old, old);
  assert.equal(await findFreshBackup({ dir: backupDir }), null);
  const fresh = await makeBackup();
  assert.equal((await findFreshBackup({ dir: backupDir })).path, fresh);
});

test("dry run marks every user KEEP/DELETE and writes nothing", async () => {
  const keeper = await makeUser("keep");
  const doomed = await makeUser("doom");
  const legacy = await seedLegacy(doomed);

  const capture = lines();
  const dry = await runPurge({
    argv: [`--keep=${keeper.email}`, `--protect-orgs=${legacy.org._id}`],
    backupDir,
    out: capture.log,
  });
  assert.equal(dry.exitCode, 0);
  const text = capture.text();
  assert.match(text, /DRY RUN \(no writes\)/);
  assert.match(text, new RegExp(`${keeper.email}[^\\n]*KEEP`));
  assert.match(text, new RegExp(`${doomed.email}[^\\n]*DELETE`));
  assert.match(text, /Protected snapshot/);
  assert.match(text, /Total to delete \(users \+ organizations \+ teams\):/);
  assert.match(text, /teams=1 players=1 matches=1 tournaments=1/);

  assert.ok(await User.findById(doomed._id));
  assert.ok(await Team.findById(legacy.team._id));
  assert.ok(await Ball.findById(legacy.ball._id));
  assert.equal(await AuditLog.countDocuments(), 0);
});

test("apply keeps a protected scorecard graph, clears creator pointers, leaves admins alone, audits and is idempotent", async () => {
  const admin = await Admin.create({ name: "Super Admin", email: "admin@example.test", password: "password-123", role: "superadmin" });
  const keeper = await makeUser("keep");
  const doomed = await makeUser("doom");
  const legacy = await seedLegacy(doomed);
  const post = await CommunityPost.create({
    title: unique("Doomed Post"), authorUser: doomed._id, kind: "article",
    subject: { type: "user", ref: doomed._id },
  });
  const issue = await IssueReport.create({
    subject: unique("Doomed Issue"), reporter: doomed._id, organization: legacy.org._id,
    type: "issue", description: "fixture",
  });
  await Invitation.create({
    email: "new@example.test", organization: legacy.org._id, inviter: doomed._id,
    tokenHash: "test-token-hash", expiresAt: new Date(Date.now() + 60_000),
  });
  await HandlerRequest.create({ user: doomed._id, type: "team", status: "pending" });
  await MatchOfficial.create({ userId: doomed._id, matchId: legacy.match._id, role: "scorer" });

  const dry = await preview([legacy.org._id], [`--keep=${keeper.email}`, "--delete-owned-orgs"]);
  assert.equal(dry.result.exitCode, 0);
  assert.match(dry.capture.text(), /protected; kept, creator\/owner pointer cleared/);
  await makeBackup();
  const capture = lines();
  const applied = await runPurge({
    argv: [
      `--keep=${keeper.email}`, `--protect-orgs=${legacy.org._id}`, "--delete-owned-orgs",
      "--apply", `--confirm=${dry.result.plan.total}`,
    ],
    backupDir,
    out: capture.log,
  });
  assert.equal(applied.exitCode, 0, capture.text());

  assert.ok(await TeamOrganization.findById(legacy.org._id), "protected org survives");
  assert.ok(await Team.findById(legacy.team._id), "protected team survives");
  assert.ok(await Player.findById(legacy.player._id), "protected player survives");
  assert.ok(await Match.findById(legacy.match._id), "protected match survives");
  assert.ok(await Ball.findById(legacy.ball._id), "protected ball survives");
  assert.ok(await Tournament.findById(legacy.tournament._id), "protected tournament survives");
  assert.ok(await TournamentMedia.findById(legacy.media._id), "protected upload record survives");
  assert.ok(await Event.findById(legacy.event._id), "protected event survives");
  assert.equal(await TeamRanking.countDocuments({ team: legacy.team._id }), 1);
  assert.equal(await TeamPlayerRanking.countDocuments({ team: legacy.team._id }), 1);

  const org = await TeamOrganization.findById(legacy.org._id).lean();
  assert.equal(org.owner, null, "protected org owner pointer cleared");
  assert.equal(org.createdBy, null, "protected org creator pointer cleared");
  assert.equal((await Team.findById(legacy.team._id).lean()).managedBy, undefined);
  assert.equal((await Player.findById(legacy.player._id).lean()).createdBy, undefined);
  assert.equal((await Event.findById(legacy.event._id).lean()).createdBy, undefined);

  assert.equal(await User.countDocuments({ _id: doomed._id }), 0);
  assert.ok(await User.findById(keeper._id), "kept user survives");
  assert.equal(await Membership.countDocuments({ user: doomed._id }), 0);
  assert.equal(await Invitation.countDocuments({ inviter: doomed._id }), 0);
  assert.equal(await HandlerRequest.countDocuments({ user: doomed._id }), 0);
  assert.equal(await MatchOfficial.countDocuments({ userId: doomed._id }), 0);
  assert.equal(await CommunityPost.countDocuments({ authorUser: doomed._id }), 0);
  assert.equal(await CommunityPost.countDocuments({ _id: post._id }), 0);
  assert.equal(await IssueReport.countDocuments({ _id: issue._id }), 0);

  const unchangedAdmin = await Admin.findById(admin._id).lean();
  assert.equal(unchangedAdmin.name, "Super Admin");
  assert.equal(unchangedAdmin.role, "superadmin");
  assert.equal(await Admin.countDocuments(), 1);

  const userAudit = await AuditLog.find({ action: AUDIT_USER }).lean();
  assert.equal(userAudit.length, 1);
  assert.equal(userAudit[0].targetId, String(doomed._id));
  assert.equal(userAudit[0].actorType, "system");
  assert.equal(await AuditLog.countDocuments({ action: AUDIT_ORG }), 0);
  assert.deepEqual(applied.snapshotAfter, applied.plan.snapshotBefore);

  const second = await preview([legacy.org._id], [`--keep=${keeper.email}`, "--delete-owned-orgs"]);
  assert.equal(second.result.exitCode, 0);
  assert.equal(second.result.plan.total, 0);
  assert.match(second.capture.text(), /Nothing to delete/, second.capture.text());
});

test("a test org and its auto-created default team are deleted only with --delete-owned-orgs", async () => {
  const keeper = await makeUser("keep");
  const doomed = await makeUser("doom");
  const protectedOrg = await TeamOrganization.create({ name: unique("Protected Legacy") });
  const org = await TeamOrganization.create({ name: unique("Test Club"), owner: doomed._id, createdBy: doomed._id });
  await Membership.create({ organization: org._id, user: doomed._id, roles: ["owner"], status: "active" });
  const { team } = await ensureDefaultTeam(org, doomed._id);
  const player = await Player.create({ name: unique("Test Player"), team: team._id, createdBy: doomed._id });
  await Invitation.create({
    email: "invitee@example.test", organization: org._id, inviter: doomed._id,
    tokenHash: "test-token-hash", expiresAt: new Date(Date.now() + 60_000),
  });

  const withoutFlag = await preview([protectedOrg._id], [`--keep=${keeper.email}`]);
  assert.equal(withoutFlag.result.plan.total, 0);
  assert.match(withoutFlag.capture.text(), /owns organization/);
  assert.match(withoutFlag.capture.text(), /DELETE — SKIPPED/);
  assert.ok(await User.findById(doomed._id));
  assert.ok(await TeamOrganization.findById(org._id));
  assert.ok(await Team.findById(team._id));

  const withFlag = await preview([protectedOrg._id], [`--keep=${keeper.email}`, "--delete-owned-orgs"]);
  assert.equal(withFlag.result.plan.total, 3, "user + organization + default team");
  assert.match(withFlag.capture.text(), /teams=1/);
  await makeBackup();
  const applied = await runPurge({
    argv: [
      `--keep=${keeper.email}`, `--protect-orgs=${protectedOrg._id}`, "--delete-owned-orgs",
      "--apply", `--confirm=${withFlag.result.plan.total}`,
    ],
    backupDir,
    out: lines().log,
  });
  assert.equal(applied.exitCode, 0);

  assert.equal(await User.countDocuments({ _id: doomed._id }), 0);
  assert.equal(await TeamOrganization.countDocuments({ _id: org._id }), 0);
  assert.equal(await Team.countDocuments({ _id: team._id }), 0);
  assert.equal(await Player.countDocuments({ _id: player._id }), 0);
  assert.equal(await Membership.countDocuments({ organization: org._id }), 0);
  assert.equal(await Invitation.countDocuments({ organization: org._id }), 0);
  assert.equal(await AuditLog.countDocuments({ action: AUDIT_USER }), 1);
  assert.equal(await AuditLog.countDocuments({ action: AUDIT_ORG }), 1);
});

test("refuses to run without keep/keep-none or protect-orgs", async () => {
  const capture = lines();
  const noKeep = await runPurge({ argv: ["--protect-orgs=" + new mongoose.Types.ObjectId()], backupDir, out: capture.log });
  assert.equal(noKeep.exitCode, 1);
  assert.match(capture.text(), /One of --keep=<emails or ids> or --keep-none is required/);

  const noProtect = lines();
  const result = await runPurge({ argv: ["--keep-none"], backupDir, out: noProtect.log });
  assert.equal(result.exitCode, 1);
  assert.match(noProtect.text(), /--protect-orgs=<organization ids> is required/);
  assert.equal(await User.countDocuments(), 0);
});

test("--apply refuses a wrong --confirm and a missing fresh backup without deleting anything", async () => {
  const doomed = await makeUser("doom");
  const legacy = await seedLegacy();
  const protect = `--protect-orgs=${legacy.org._id}`;

  const noBackup = lines();
  const missing = await runPurge({ argv: ["--keep-none", protect, "--delete-owned-orgs", "--apply", "--confirm=1"], backupDir, out: noBackup.log });
  assert.equal(missing.exitCode, 1);
  assert.match(noBackup.text(), /no backup newer than 30 minutes/);
  assert.ok(await User.findById(doomed._id));

  await makeBackup();
  const wrong = lines();
  const result = await runPurge({ argv: ["--keep-none", protect, "--delete-owned-orgs", "--apply", "--confirm=999"], backupDir, out: wrong.log });
  assert.equal(result.exitCode, 1);
  assert.match(wrong.text(), /does not match the dry-run total/);
  assert.ok(await User.findById(doomed._id));
});

test("a changed protected snapshot aborts with a non-zero exit", async () => {
  const keeper = await makeUser("keep");
  const doomed = await makeUser("doom");
  const legacy = await seedLegacy();
  const dry = await preview([legacy.org._id], [`--keep=${keeper.email}`, "--delete-owned-orgs"]);
  assert.ok(dry.result.plan.snapshotBefore.balls >= 1);
  await makeBackup();

  const applied = await runPurge({
    argv: [
      `--keep=${keeper.email}`, `--protect-orgs=${legacy.org._id}`, "--delete-owned-orgs",
      "--apply", `--confirm=${dry.result.plan.total}`,
    ],
    backupDir,
    out: lines().log,
    beforeApply: async () => { await Ball.deleteOne({ _id: legacy.ball._id }); },
  });

  assert.equal(applied.exitCode, 1);
  assert.ok(applied.changed.includes("balls"));
  assert.match(applied.changed.join(","), /balls/);
  assert.equal(await User.countDocuments({ _id: doomed._id }), 0, "apply ran before the snapshot check failed");
});
