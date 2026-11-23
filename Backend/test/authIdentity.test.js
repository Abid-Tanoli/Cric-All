import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";
process.env.FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

import mongoose from "mongoose";
import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import User from "../src/models/User.js";
import { registerUser, loginUser, verifyEmail, resendVerification, changeVerificationEmail, resetPassword, forgotPassword } from "../src/controllers/authController.js";
import { protect, requireVerifiedEmail } from "../src/middleware/authMiddleware.js";
import { generateToken } from "../src/utils/jwt.js";
import { hashEmailCode, generateEmailCode, getEmailCodeExpiry, invalidateEmailCode } from "../src/utils/emailVerification.js";
import { resetRateLimiterForTests } from "../src/middleware/rateLimiter.js";
import validate from "../src/middleware/validate.js";
import { forgotPasswordSchema } from "../src/validators/authValidators.js";

let mongod;

before(async () => {
  mongod = await startTestDb();
});

after(async () => {
  await stopTestDb(mongod);
});

beforeEach(() => {
  // Hourly user/IP send budgets are process-local; isolate every test.
  resetRateLimiterForTests();
});

// MAIL_DRIVER=console writes the code into the backend log. Capture it so the
// test uses the exact code that was issued (never a code stored in the DB).
async function captureEmailCode(fn) {
  const captured = [];
  const original = console.log;
  console.log = (...args) => captured.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  // The console driver logs JSON, so the code is preceded by an escaped "\\n"
  // (whose "n" is a word character) — use digit boundaries, not \\b.
  const match = captured.join("\n").match(/(?<!\d)(\d{6})(?!\d)/);
  return match ? match[1] : null;
}

function nextCalled() {
  let called = false;
  const res = mockRes();
  return {
    res,
    get called() {
      return called;
    },
    next() {
      called = true;
    },
  };
}

test("register creates an unverified account and mails a 6-digit code", async () => {
  const req = mockReq({
    body: {
      name: "Verify Tester",
      email: "  Verify@Example.COM ",
      password: "password123",
      accountType: "handler",
      organizationCategory: "Club",
      organizationName: "OpenCode CC",
    },
  });
  const res = mockRes();

  const code = await captureEmailCode(() => registerUser(req, res));

  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(res.body.user.email, "verify@example.com", "email must be normalized");
  assert.equal(res.body.user.emailVerified, false);
  assert.equal(res.body.requiresEmailVerification, true);
  assert.equal(res.body.requiresPhoneVerification, false, "no SMS/fake phone step");

  const stored = await User.findOne({ email: "verify@example.com" }).select("+emailVerificationCode");
  assert.ok(stored, "user persisted");
  assert.equal(stored.emailVerified, false);
  assert.equal(stored.passwordSet, true);
  assert.equal(stored.status, "active");
  assert.ok(code, "the console mail driver must contain the raw code");
  assert.match(code, /^\d{6}$/);
  assert.equal(stored.emailVerificationCode, hashEmailCode(code), "only the hash is stored");
  assert.notEqual(stored.emailVerificationCode, code);
  assert.ok(stored.emailVerificationExpires > new Date());
  assert.ok(stored.emailVerificationExpires <= new Date(Date.now() + 10 * 60 * 1000 + 1000));

  // Privileged action blocked while unverified.
  const blocked = nextCalled();
  requireVerifiedEmail({ user: stored, principalType: "user" }, blocked.res, blocked.next);
  assert.equal(blocked.called, false);
  assert.equal(blocked.res.statusCode, 403);
  assert.equal(blocked.res.body.code, "EMAIL_NOT_VERIFIED");

  // Verify with the mailed code.
  const verifyRes = mockRes();
  await verifyEmail(mockReq({ body: { email: "  VERIFY@example.com ", code } }), verifyRes);
  assert.equal(verifyRes.statusCode, 200, JSON.stringify(verifyRes.body));

  const afterVerify = await User.findOne({ email: "verify@example.com" }).select("+emailVerificationCode");
  assert.equal(afterVerify.emailVerified, true);
  assert.ok(afterVerify.emailVerifiedAt);
  assert.equal(afterVerify.emailVerificationCode, undefined, "code must be single-use");

  const allowed = nextCalled();
  requireVerifiedEmail({ user: afterVerify, principalType: "user" }, allowed.res, allowed.next);
  assert.equal(allowed.called, true);

  // Re-using the same code must fail.
  const reuseRes = mockRes();
  await verifyEmail(mockReq({ body: { email: "verify@example.com", code } }), reuseRes);
  assert.equal(reuseRes.statusCode, 400);
  assert.equal(reuseRes.body.code, "VERIFY_CODE_INVALID");
});

test("duplicate registration with different casing is rejected with 409", async () => {
  const first = mockRes();
  await registerUser(
    mockReq({ body: { name: "Case User", email: "CaseUser@Test.com", password: "password123" } }),
    first,
  );
  assert.equal(first.statusCode, 201, JSON.stringify(first.body));

  const second = mockRes();
  await registerUser(
    mockReq({ body: { name: "Case User 2", email: "  caseuser@test.COM ", password: "password456" } }),
    second,
  );
  assert.equal(second.statusCode, 409, JSON.stringify(second.body));
  assert.equal(second.body.code, "EMAIL_TAKEN");

  const count = await User.countDocuments({ email: "caseuser@test.com" });
  assert.equal(count, 1, "exactly one account per normalized email");
});

test("an expired verification code is rejected", async () => {
  const code = "123456";
  const user = await User.create({
    name: "Expired User",
    email: "expired@example.com",
    password: "password123",
    emailVerificationCode: hashEmailCode(code),
    emailVerificationExpires: new Date(Date.now() - 1000),
  });

  const res = mockRes();
  await verifyEmail(mockReq({ body: { email: "expired@example.com", code } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "VERIFY_CODE_INVALID");

  const stored = await User.findById(user._id);
  assert.equal(stored.emailVerified, false);
});

test("resend-verification is generic and enforces the 60s cooldown without leaking", async () => {
  // Unknown email → same generic 200 as a real one.
  const unknown = mockRes();
  await resendVerification(mockReq({ body: { email: "nobody@example.com" } }), unknown);
  assert.equal(unknown.statusCode, 200);
  assert.ok(!JSON.stringify(unknown.body).includes("nobody@example.com"));

  // Fresh registration → immediate resend is a generic 200 but sends nothing.
  const reg = mockRes();
  await registerUser(
    mockReq({ body: { name: "Cooldown", email: "cooldown@example.com", password: "password123" } }),
    reg,
  );
  assert.equal(reg.statusCode, 201, JSON.stringify(reg.body));
  const before = await User.findOne({ email: "cooldown@example.com" });
  const sentAt = before.verificationSentAt;

  const resend = mockRes();
  await resendVerification(mockReq({ body: { email: "cooldown@example.com" } }), resend);
  assert.equal(resend.statusCode, 200);
  assert.deepEqual(resend.body, unknown.body, "responses must not reveal account existence");
  const after = await User.findOne({ email: "cooldown@example.com" });
  assert.equal(after.verificationSentAt.getTime(), sentAt.getTime(), "no mail sent during cooldown");

  // Already verified → generic 200, no new code.
  await User.updateOne({ email: "verify@example.com" }, { $set: { emailVerified: true, verificationSentAt: null } });
  const verified = mockRes();
  await resendVerification(mockReq({ body: { email: "verify@example.com" } }), verified);
  assert.equal(verified.statusCode, 200);
  assert.deepEqual(verified.body, unknown.body);
});

test("suspended accounts cannot log in and are rejected by protect", async () => {
  const reg = mockRes();
  await registerUser(
    mockReq({ body: { name: "Suspended", email: "suspended@example.com", password: "password123" } }),
    reg,
  );
  assert.equal(reg.statusCode, 201, JSON.stringify(reg.body));

  await User.updateOne({ email: "suspended@example.com" }, { $set: { status: "suspended" } });

  const login = mockRes();
  await loginUser(mockReq({ body: { email: "suspended@example.com", password: "password123" } }), login);
  assert.equal(login.statusCode, 403);
  assert.equal(login.body.code, "ACCOUNT_SUSPENDED");

  // A previously issued token must also be rejected on every protected route.
  const user = await User.findOne({ email: "suspended@example.com" });
  const token = generateToken(user);
  const req = { headers: { authorization: `Bearer ${token}` } };
  const probe = { statusCode: 0, body: null };
  const res = {
    status(code) {
      probe.statusCode = code;
      return this;
    },
    json(payload) {
      probe.body = payload;
      return this;
    },
  };
  let nextHit = false;
  await protect(req, res, () => {
    nextHit = true;
  });
  assert.equal(nextHit, false);
  assert.equal(probe.statusCode, 403);
  assert.equal(probe.body.code, "ACCOUNT_SUSPENDED");
});

test("password reset invalidates every previously issued token", async () => {
  const reg = mockRes();
  await registerUser(
    mockReq({ body: { name: "Resetter", email: "resetter@example.com", password: "password123" } }),
    reg,
  );
  const user = await User.findOne({ email: "resetter@example.com" });
  const oldToken = generateToken(user);

  // Issue a reset through the real flow so the token lands in the log.
  const forgot = mockRes();
  let resetToken = null;
  const captured = [];
  const original = console.log;
  console.log = (...args) => captured.push(args.join(" "));
  try {
    await forgotPassword(mockReq({ body: { email: "resetter@example.com" } }), forgot);
  } finally {
    console.log = original;
  }
  const match = captured.join("\n").match(/reset-password\/([0-9a-f]{64})/);
  resetToken = match ? match[1] : null;
  assert.equal(forgot.statusCode, 200);
  assert.ok(resetToken, "reset link must be written to the server log");

  const reset = mockRes();
  await resetPassword(mockReq({ params: { token: resetToken }, body: { password: "newpassword123" } }), reset);
  assert.equal(reset.statusCode, 200, JSON.stringify(reset.body));

  const reloaded = await User.findOne({ email: "resetter@example.com" }).select("+password");
  assert.equal(reloaded.tokenVersion, 1);
  assert.equal(await reloaded.comparePassword("newpassword123"), true);

  const probe = { statusCode: 0, body: null };
  const res = {
    status(code) {
      probe.statusCode = code;
      return this;
    },
    json(payload) {
      probe.body = payload;
      return this;
    },
  };
  let nextHit = false;
  await protect({ headers: { authorization: `Bearer ${oldToken}` } }, res, () => {
    nextHit = true;
  });
  assert.equal(nextHit, false, "old token must be rejected after the version bump");
  assert.equal(probe.statusCode, 401);
  assert.equal(probe.body.code, "AUTH_TOKEN_VERSION_MISMATCH");

  // A fresh token works again.
  const newToken = generateToken(reloaded);
  let freshNext = false;
  await protect(
    { headers: { authorization: `Bearer ${newToken}` } },
    {
      status(code) {
        probe.statusCode = code;
        return this;
      },
      json(payload) {
        probe.body = payload;
        return this;
      },
    },
    () => {
      freshNext = true;
    },
  );
  assert.equal(freshNext, true);
});

test("passwordless (Google-only) accounts get invalid credentials, not a 500", async () => {
  await User.create({
    name: "Google Only",
    email: "googleonly@example.com",
    googleId: "google-sub-googleonly",
    emailVerified: true,
    passwordSet: false,
  });

  const res = mockRes();
  await loginUser(mockReq({ body: { email: "googleonly@example.com", password: "whatever123" } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "Invalid credentials");
});

test("forgot-password rejects a NoSQL operator in email before touching the DB", async () => {
  const middleware = validate(forgotPasswordSchema);
  let nextHit = false;
  let status = 0;
  let body = null;
  const req = mockReq({ body: { email: { $ne: "" } } });
  const res = {
    status(code) {
      status = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
  };
  middleware(req, res, () => {
    nextHit = true;
  });
  assert.equal(nextHit, false);
  assert.equal(status, 400);
  assert.equal(body.message, "Validation failed");
  assert.equal(typeof req.body.email, "object", "operator object must not reach the query");
});

test("verification code helpers never produce colliding hashes for distinct codes", async () => {
  const a = generateEmailCode();
  const b = generateEmailCode();
  assert.notEqual(hashEmailCode(a), hashEmailCode(b));
  assert.ok(getEmailCodeExpiry() > new Date());
  assert.equal(mongoose.connection.readyState, 1);
});

test("changing the verification email restarts the flow and invalidates the old code", async () => {
  const user = await User.create({
    name: "Change Email User",
    email: "old-address@example.com",
    password: "password123",
  });
  const oldCode = "654321";
  user.emailVerificationCode = hashEmailCode(oldCode);
  user.emailVerificationExpires = getEmailCodeExpiry();
  await user.save();

  const token = generateToken(user);
  let newCode = null;
  const res = mockRes();
  newCode = await captureEmailCode(() =>
    changeVerificationEmail(
      mockReq({ user, principalType: "user", token, body: { email: "  New.Address@Example.COM " } }),
      res,
    ),
  );

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.email, "new.address@example.com");
  assert.equal(res.body.user.emailVerified, false);
  assert.equal(res.body.user.email, "new.address@example.com");
  assert.match(newCode, /^\d{6}$/);

  const stored = await User.findById(user._id).select("+emailVerificationCode");
  assert.equal(stored.email, "new.address@example.com");
  assert.equal(stored.emailVerificationCode, hashEmailCode(newCode));
  assert.notEqual(stored.emailVerificationCode, hashEmailCode(oldCode), "old code must be gone");

  // The old address/code pair no longer verifies anything.
  const stale = mockRes();
  await verifyEmail(mockReq({ body: { email: "old-address@example.com", code: oldCode } }), stale);
  assert.equal(stale.statusCode, 400);
  assert.equal(stale.body.code, "VERIFY_CODE_INVALID");

  const fresh = mockRes();
  await verifyEmail(mockReq({ body: { email: "new.address@example.com", code: newCode } }), fresh);
  assert.equal(fresh.statusCode, 200, JSON.stringify(fresh.body));
});
