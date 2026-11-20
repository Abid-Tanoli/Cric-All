import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = process.env.JWT_SECRET || "admin-player-roles-test-secret";

import { startTestDb, stopTestDb } from "./helpers/testDb.js";
import adminRoutes from "../src/routes/adminRoutes.js";
import AuditLog from "../src/models/AuditLog.js";
import Admin from "../src/models/Admin.js";
import Membership from "../src/models/Membership.js";
import Player from "../src/models/Player.js";
import Team from "../src/models/Team.js";
import User from "../src/models/User.js";

let mongod;
let server;
let base;
let seq = 0;

const unique = (label) => `AdminRoles ${label} ${Date.now()}-${++seq}`;
const uniqueEmail = (label) => `admin-roles-${label}-${Date.now()}-${++seq}@example.test`;
const farId = () => new mongoose.Types.ObjectId().toString();

async function makeAdmin() {
  const admin = await Admin.create({
    name: unique("Admin"),
    email: uniqueEmail("admin"),
    password: "never-used-hash",
    role: "admin",
  });
  return jwt.sign({ id: String(admin._id) }, process.env.JWT_SECRET);
}

async function makeUser(overrides = {}) {
  const user = await User.create({
    name: unique("User"),
    email: uniqueEmail("user"),
    password: "password-123",
    role: "viewer",
    emailVerified: true,
    ...overrides,
  });
  return user;
}

async function req(method, path, { token, body } = {}) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

before(async () => {
  mongod = await startTestDb();
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRoutes);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Promise.all([
    Player.deleteMany({}),
    Team.deleteMany({}),
    User.deleteMany({}),
    Admin.deleteMany({}),
    Membership.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);
});

test("missing-role list finds blank, null, whitespace and invalid values only", async () => {
  const team = await Team.create({ name: unique("Public") });
  const values = [undefined, null, "", "   ", "Batter"];
  for (const role of values) {
    await Player.create({ name: unique(`Blank ${role}`), ...(role === undefined ? {} : { role }), team: team._id });
  }
  await Player.create({ name: unique("Valid"), role: "Batsman", team: team._id });

  const token = await makeAdmin();
  const res = await req("GET", "/api/admin/players/missing-role?limit=50", { token });

  assert.equal(res.status, 200);
  assert.equal(res.body.count, 5);
  assert.equal(res.body.players.length, 5);
  assert.ok(res.body.players.every((player) => "suggestedRole" in player));
  assert.ok(!res.body.players.some((player) => player.name.includes("Valid")));
});

test("hidden/test teams are excluded unless includeHidden=true", async () => {
  const visible = await Team.create({ name: unique("Visible") });
  const hidden = await Team.create({ name: unique("Hidden"), isPublic: false });
  const fixture = await Team.create({ name: `E2E_${unique("Fixture")}` });
  for (const team of [visible, hidden, fixture]) {
    await Player.create({ name: unique(`P ${team.name}`), team: team._id });
  }

  const token = await makeAdmin();
  const normal = await req("GET", "/api/admin/players/missing-role?limit=50", { token });
  assert.equal(normal.body.count, 1);
  assert.equal(String(normal.body.players[0].teams[0]._id), String(visible._id));

  const included = await req("GET", "/api/admin/players/missing-role?limit=50&includeHidden=true", { token });
  assert.equal(included.body.count, 3);
});

test("list supports search, team filter and pagination", async () => {
  const teamA = await Team.create({ name: unique("A") });
  const teamB = await Team.create({ name: unique("B") });
  await Player.create({ name: `${unique("Alpha")} One`, team: teamA._id });
  await Player.create({ name: `${unique("Alpha")} Two`, team: teamA._id });
  await Player.create({ name: unique("Beta"), team: teamB._id });
  const token = await makeAdmin();

  const teamFiltered = await req("GET", `/api/admin/players/missing-role?team=${teamA._id}`, { token });
  assert.equal(teamFiltered.body.count, 2);

  const searched = await req("GET", "/api/admin/players/missing-role?search=Alpha", { token });
  assert.equal(searched.body.count, 2);

  const paged = await req("GET", "/api/admin/players/missing-role?page=2&limit=1", { token });
  assert.equal(paged.body.currentPage, 2);
  assert.equal(paged.body.totalPages, 3);
  assert.equal(paged.body.players.length, 1);
});

test("bulk-role rejects bad role, bad id, over 200 and any partial failure", async () => {
  const player = await Player.create({ name: unique("Target") });
  const token = await makeAdmin();
  const calls = [
    { updates: [{ playerId: String(player._id), role: "Wicketkeeper" }] },
    { updates: [{ playerId: "not-an-id", role: "Batsman" }] },
    { updates: Array.from({ length: 201 }, () => ({ playerId: farId(), role: "Batsman" })) },
    { updates: [{ playerId: String(player._id), role: "Batsman" }, { playerId: farId(), role: "Bowler" }] },
  ];

  for (const body of calls) {
    const res = await req("POST", "/api/admin/players/bulk-role", { token, body });
    assert.equal(res.status, 400);
    assert.ok(Array.isArray(res.body.errors) && res.body.errors.length > 0);
  }
  assert.equal((await Player.findById(player._id)).role, undefined);
  assert.equal(await AuditLog.countDocuments({}), 0);
});

test("dry-run reports changes without saving or auditing", async () => {
  const player = await Player.create({ name: unique("Dry"), role: "" });
  const token = await makeAdmin();
  const res = await req("POST", "/api/admin/players/bulk-role", {
    token,
    body: { dryRun: true, updates: [{ playerId: String(player._id), role: "Bowler" }] },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.dryRun, true);
  assert.deepEqual(
    { old: res.body.changes[0].oldRole, new: res.body.changes[0].newRole },
    { old: "", new: "Bowler" }
  );
  assert.equal((await Player.findById(player._id)).role, "");
  assert.equal(await AuditLog.countDocuments({}), 0);
});

test("real run changes only role, writes one audit entry and never applies suggestions", async () => {
  const player = await Player.create({
    name: unique("Real"),
    role: "Batter",
    playingRole: "Batsman",
    battingStyle: "Left-handed",
    stats: { runs: 10, wickets: 3, stumpings: 8, catches: 2, matches: 4 },
  });
  const token = await makeAdmin();

  const listed = await req("GET", "/api/admin/players/missing-role?limit=50", { token });
  const row = listed.body.players.find((item) => String(item._id) === String(player._id));
  assert.equal(row.suggestedRole, "Wicket-Keeper");

  const res = await req("POST", "/api/admin/players/bulk-role", {
    token,
    body: { updates: [{ playerId: String(player._id), role: "Batsman" }] },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.dryRun, false);

  const saved = await Player.findById(player._id);
  assert.equal(saved.role, "Batsman");
  assert.equal(saved.playingRole, "Batsman");
  assert.equal(saved.battingStyle, "Left-handed");
  assert.equal(saved.stats.runs, 10);
  assert.equal(saved.stats.wickets, 3);
  assert.equal(saved.stats.stumpings, 8);

  const audits = await AuditLog.find({});
  assert.equal(audits.length, 1);
  assert.equal(audits[0].actorType, "admin");
  assert.equal(audits[0].action, "player.bulk_role_updated");
  assert.equal(audits[0].metadata.count, 1);
  assert.equal(audits[0].metadata.changes[0].oldRole, "Batter");
  assert.equal(audits[0].metadata.changes[0].newRole, "Batsman");
});

test("non-admin and organization owner are denied 403", async () => {
  const viewer = await makeUser();
  const viewerToken = jwt.sign({ id: String(viewer._id), tv: 0 }, process.env.JWT_SECRET);
  const owner = await makeUser();
  await Membership.create({
    organization: new mongoose.Types.ObjectId(),
    user: owner._id,
    roles: ["owner"],
  });
  const ownerToken = jwt.sign({ id: String(owner._id), tv: 0 }, process.env.JWT_SECRET);
  const body = { updates: [{ playerId: farId(), role: "Batsman" }] };

  for (const token of [viewerToken, ownerToken]) {
    const list = await req("GET", "/api/admin/players/missing-role", { token });
    const update = await req("POST", "/api/admin/players/bulk-role", { token, body });
    assert.equal(list.status, 403);
    assert.equal(update.status, 403);
  }
  assert.equal(await AuditLog.countDocuments({}), 0);
});
