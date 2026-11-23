import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = process.env.JWT_SECRET || "admin-email-verify-test-secret";
process.env.EMAIL_MX_CHECK = "false";

import { startTestDb, stopTestDb } from "./helpers/testDb.js";
import adminRoutes from "../src/routes/adminRoutes.js";
import Admin from "../src/models/Admin.js";
import User from "../src/models/User.js";
import AuditLog from "../src/models/AuditLog.js";

let mongod;
let server;
let base;
let seq = 0;
const unique = (label) => `admin-ev-${label}-${Date.now()}-${++seq}@example.test`;

async function makeAdmin(role = "admin") {
  const admin = await Admin.create({
    name: `Support ${++seq}`,
    email: unique("admin"),
    password: "never-used-hash",
    role,
  });
  return jwt.sign({ id: String(admin._id) }, process.env.JWT_SECRET);
}

async function api(method, path, { token, body } = {}) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
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
  await new Promise((resolve) => server.close(resolve));
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Promise.all([Admin.deleteMany({}), User.deleteMany({}), AuditLog.deleteMany({})]);
});

test("support list shows emailVerified and never exposes verification secrets", async () => {
  const token = await makeAdmin();
  await User.create({
    name: "Unverified Person",
    email: unique("unverified"),
    password: "password123",
    emailVerified: false,
    emailVerificationCode: "super-secret-hash",
  });
  await User.create({
    name: "Verified Person",
    email: unique("verified"),
    password: "password123",
    emailVerified: true,
  });

  const res = await api("GET", "/api/admin/users?limit=10", { token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.total, 2);
  const unverified = res.body.users.find((u) => u.name === "Unverified Person");
  const verified = res.body.users.find((u) => u.name === "Verified Person");
  assert.equal(unverified.emailVerified, false);
  assert.equal(verified.emailVerified, true);
  const raw = JSON.stringify(res.body);
  assert.doesNotMatch(raw, /super-secret-hash|emailVerificationCode|verificationCode/);
});

test("manual mark-verified writes an audit entry and clears any outstanding code", async () => {
  const token = await makeAdmin();
  const user = await User.create({
    name: "Needs Help",
    email: unique("help"),
    password: "password123",
    emailVerified: false,
    emailVerificationCode: "hash-that-must-be-cleared",
    emailVerificationExpires: new Date(Date.now() + 60000),
  });

  const res = await api("POST", `/api/admin/users/${user._id}/mark-email-verified`, {
    token,
    body: { note: "Mailbox outage confirmed by support" },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.user.emailVerified, true);
  assert.equal(res.body.alreadyVerified, false);

  const stored = await User.findById(user._id).select("+emailVerificationCode");
  assert.equal(stored.emailVerified, true);
  assert.ok(stored.emailVerifiedAt);
  assert.equal(stored.emailVerificationCode, undefined, "no stale code is left behind");

  const audit = await AuditLog.findOne({ action: "admin.user_email_verified" });
  assert.ok(audit, "the override is audited");
  assert.equal(audit.actorType, "admin");
  assert.equal(audit.targetId, String(user._id));
  assert.equal(audit.metadata.manual, true);
  assert.equal(audit.metadata.note, "Mailbox outage confirmed by support");
});

test("marking an already-verified account is a no-op that still audits", async () => {
  const token = await makeAdmin();
  const user = await User.create({
    name: "Already Done",
    email: unique("done"),
    password: "password123",
    emailVerified: true,
  });
  const res = await api("POST", `/api/admin/users/${user._id}/mark-email-verified`, { token, body: {} });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.alreadyVerified, true);
  assert.equal(await AuditLog.countDocuments({ action: "admin.user_email_verified" }), 1);
});

test("support endpoints reject anonymous and non-admin callers", async () => {
  const user = await User.create({
    name: "Intruder",
    email: unique("intruder"),
    password: "password123",
    role: "viewer", // an ordinary User must never reach platform-admin support tools
    emailVerified: true,
  });
  const userToken = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET);

  const listAnon = await api("GET", "/api/admin/users");
  assert.equal(listAnon.status, 401);
  const listUser = await api("GET", "/api/admin/users", { token: userToken });
  assert.equal(listUser.status, 403);
  const markUser = await api("POST", `/api/admin/users/${user._id}/mark-email-verified`, { token: userToken, body: {} });
  assert.equal(markUser.status, 403);
  assert.equal(await AuditLog.countDocuments({}), 0, "no override was recorded");
});

test("a superadmin can also use the support override and admin login is untouched", async () => {
  const token = await makeAdmin("superadmin");
  const user = await User.create({
    name: "Superadmin Case",
    email: unique("super"),
    password: "password123",
    emailVerified: false,
  });
  const res = await api("POST", `/api/admin/users/${user._id}/mark-email-verified`, { token, body: {} });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  // Admin login remains its own route; this feature never touches it.
  const login = await api("POST", "/api/admin/login", { body: { email: "missing@example.test", password: "x" } });
  assert.ok([400, 401, 429].includes(login.status), `unexpected admin login status ${login.status}`);
});
