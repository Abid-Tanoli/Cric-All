import test, { before, after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "test-client-id.apps.googleusercontent.com";

import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import User from "../src/models/User.js";
import { googleLogin, googleAdminLogin } from "../src/controllers/googleAuthController.js";
import { __setGoogleVerifyImpl } from "../src/services/googleVerifier.js";
import { generateToken } from "../src/utils/jwt.js";
import { protect } from "../src/middleware/authMiddleware.js";

let mongod;

before(async () => {
  mongod = await startTestDb();
});

after(async () => {
  __setGoogleVerifyImpl(null);
  await stopTestDb(mongod);
});

const basePayload = {
  sub: "g-sub-001",
  email: "Googler@Example.com",
  email_verified: true,
  aud: process.env.GOOGLE_CLIENT_ID,
  iss: "https://accounts.google.com",
  exp: Math.floor(Date.now() / 1000) + 3600,
  name: "Googler",
  picture: "https://example.com/pic.png",
};

function mockVerifier(overrides = {}) {
  __setGoogleVerifyImpl(async () => ({ ...basePayload, ...overrides }));
}

async function probeProtect(token) {
  const result = { status: 0, body: null, next: false };
  const res = {
    status(code) {
      result.status = code;
      return this;
    },
    json(payload) {
      result.body = payload;
      return this;
    },
  };
  await protect({ headers: { authorization: `Bearer ${token}` } }, res, () => {
    result.next = true;
  });
  return result;
}

test("new Google identity creates exactly one verified, passwordless account", async () => {
  mockVerifier();
  const res = mockRes();
  await googleLogin(mockReq({ body: { credential: "id-token" } }), res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.ok(res.body.token);
  assert.equal(res.body.user.email, "googler@example.com");
  assert.equal(res.body.user.emailVerified, true);

  const users = await User.find({ email: "googler@example.com" });
  assert.equal(users.length, 1, "never two accounts for one email");
  assert.equal(users[0].passwordSet, false);
  assert.equal(users[0].emailVerified, true);
  assert.deepEqual(
    users[0].authProviders.map((p) => p.provider),
    ["google"],
  );

  // Second sign-in with the same identity must not create a duplicate.
  const second = mockRes();
  await googleLogin(mockReq({ body: { credential: "id-token" } }), second);
  assert.equal(second.statusCode, 200);
  assert.equal(await User.countDocuments({ email: "googler@example.com" }), 1);
});

test("Google links to an existing VERIFIED password account and keeps the password", async () => {
  const existing = await User.create({
    name: "Verified Password",
    email: "verified@example.com",
    password: "password123",
    emailVerified: true,
    emailVerifiedAt: new Date(),
  });

  mockVerifier({ sub: "g-sub-verified", email: "verified@example.com" });
  const res = mockRes();
  await googleLogin(mockReq({ body: { credential: "id-token" } }), res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const user = await User.findById(existing._id).select("+password");
  assert.equal(user.googleId, "g-sub-verified");
  assert.equal(user.emailVerified, true);
  assert.equal(user.passwordSet, true, "password must survive");
  assert.ok(await user.comparePassword("password123"));
  assert.equal(user.tokenVersion, 0, "no session invalidation needed");
  assert.ok(user.authProviders.some((p) => p.provider === "google" && p.providerUserId === "g-sub-verified"));
  assert.equal(await User.countDocuments({ email: "verified@example.com" }), 1);
});

test("Google linking to an UNVERIFIED password account verifies it and kills the old password", async () => {
  const victim = await User.create({
    name: "Pre Registered",
    email: "realowner@example.com",
    password: "attackerpass1",
    emailVerified: false,
  });
  const sessionBefore = generateToken(victim);

  mockVerifier({ sub: "g-sub-owner", email: "realowner@example.com" });
  const res = mockRes();
  await googleLogin(mockReq({ body: { credential: "id-token" } }), res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.user.emailVerified, true);
  assert.ok(res.body.notice, "the user must be told the password was removed");

  const user = await User.findById(victim._id).select("+password");
  assert.equal(user.emailVerified, true);
  assert.ok(user.emailVerifiedAt);
  assert.equal(user.passwordSet, false);
  assert.equal(user.password, undefined, "password must be removed");
  assert.equal(user.tokenVersion, 1, "old sessions must die");
  assert.equal(user.googleId, "g-sub-owner");
  assert.equal(await User.countDocuments({ email: "realowner@example.com" }), 1);

  const oldSession = await probeProtect(sessionBefore);
  assert.equal(oldSession.next, false, "pre-link sessions must be rejected");
  assert.equal(oldSession.status, 401);
});

test("password login for the de-passworded account fails cleanly", async () => {
  const res = mockRes();
  const { loginUser } = await import("../src/controllers/authController.js");
  await loginUser(mockReq({ body: { email: "realowner@example.com", password: "attackerpass1" } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "Invalid credentials");
});

test("a mismatched googleId on the same email is a 409, not a hijack", async () => {
  await User.create({
    name: "Linked Elsewhere",
    email: "linked@example.com",
    googleId: "g-sub-original",
    emailVerified: true,
  });

  mockVerifier({ sub: "g-sub-attacker", email: "linked@example.com" });
  const res = mockRes();
  await googleLogin(mockReq({ body: { credential: "id-token" } }), res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "GOOGLE_ID_CONFLICT");

  const user = await User.findOne({ email: "linked@example.com" });
  assert.equal(user.googleId, "g-sub-original", "original link must not be overwritten");
});

test("invalid Google tokens are rejected before any database work", async () => {
  const cases = [
    [{ ...basePayload, aud: "other-client.apps.googleusercontent.com" }, 401],
    [{ ...basePayload, email_verified: false }, 401],
    [{ ...basePayload, exp: Math.floor(Date.now() / 1000) - 30 }, 401],
    [{ ...basePayload, iss: "https://evil.example.com" }, 401],
    [{ ...basePayload, email: undefined }, 401],
  ];

  for (const [payload, expected] of cases) {
    mockVerifier(payload);
    const res = mockRes();
    await googleLogin(mockReq({ body: { credential: "id-token" } }), res);
    assert.equal(res.statusCode, expected, JSON.stringify(payload));
  }

  // Missing credential never reaches the verifier.
  const missing = mockRes();
  await googleLogin(mockReq({ body: {} }), missing);
  assert.equal(missing.statusCode, 400);
});

test("missing GOOGLE_CLIENT_ID fails closed with 503", async () => {
  const saved = process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_ID;
  mockVerifier({ ...basePayload, aud: undefined });
  try {
    const res = mockRes();
    await googleLogin(mockReq({ body: { credential: "id-token" } }), res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, "GOOGLE_CLIENT_ID_MISSING");
  } finally {
    process.env.GOOGLE_CLIENT_ID = saved;
    mockVerifier();
  }
});

test("admin Google login still requires an admin/scorer role for existing users", async () => {
  await User.create({
    name: "Plain Viewer",
    email: "plainviewer@example.com",
    password: "password123",
    role: "viewer",
    emailVerified: true,
  });
  mockVerifier({ sub: "g-sub-plain", email: "plainviewer@example.com" });
  const denied = mockRes();
  await googleAdminLogin(mockReq({ body: { credential: "id-token" } }), denied);
  assert.equal(denied.statusCode, 403);

  await User.create({
    name: "Scorer",
    email: "scorer@example.com",
    password: "password123",
    role: "scorer",
    accountType: "handler",
    emailVerified: true,
  });
  mockVerifier({ sub: "g-sub-scorer", email: "scorer@example.com" });
  const allowed = mockRes();
  await googleAdminLogin(mockReq({ body: { credential: "id-token" } }), allowed);
  assert.equal(allowed.statusCode, 200, JSON.stringify(allowed.body));
  assert.equal(allowed.body.user.role, "scorer");
});
