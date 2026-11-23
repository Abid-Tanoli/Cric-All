import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";
process.env.FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
process.env.EMAIL_MX_CHECK = "false"; // unit tests must never touch DNS

import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import User from "../src/models/User.js";
import AuditLog from "../src/models/AuditLog.js";
import { registerUser, verifyEmail, resendVerification } from "../src/controllers/authController.js";
import { hashEmailCode, getEmailCodeExpiry, MAX_EMAIL_CODE_ATTEMPTS } from "../src/utils/emailVerification.js";
import {
  canSendVerification,
  recordVerificationSend,
  verificationSendLimit,
  userBucketKey,
  ipBucketKey,
} from "../src/utils/verificationBudget.js";
import { resetRateLimiterForTests } from "../src/middleware/rateLimiter.js";
import { setMxLookupForTests, resetMxLookupForTests } from "../src/utils/emailPolicy.js";

let mongod;

before(async () => {
  mongod = await startTestDb();
});

after(async () => {
  await stopTestDb(mongod);
});

beforeEach(async () => {
  resetRateLimiterForTests();
  resetMxLookupForTests();
  await Promise.all([User.deleteMany({}), AuditLog.deleteMany({})]);
});

async function makeUnverifiedUser(email = "code@example.com") {
  const code = "135790";
  const user = await User.create({
    name: "Code User",
    email,
    password: "password123",
    emailVerificationCode: hashEmailCode(code),
    emailVerificationExpires: getEmailCodeExpiry(),
  });
  return { user, code };
}

test("five wrong codes invalidate the secret; the correct code is then refused", async () => {
  const { user, code } = await makeUnverifiedUser();

  for (let attempt = 1; attempt <= MAX_EMAIL_CODE_ATTEMPTS; attempt++) {
    const res = mockRes();
    await verifyEmail(mockReq({ body: { email: user.email, code: "000000" } }), res);
    assert.equal(res.statusCode, 400, `attempt ${attempt}`);
    assert.equal(res.body.code, "VERIFY_CODE_INVALID");
  }

  const burned = await User.findById(user._id).select("+emailVerificationCode");
  assert.equal(burned.emailVerificationCode, undefined, "code must be burned after 5 misses");
  assert.equal(burned.emailVerificationAttempts, 0);
  assert.equal(burned.emailVerified, false);

  // Even the real code no longer works — a resend is required.
  const res = mockRes();
  await verifyEmail(mockReq({ body: { email: user.email, code } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "VERIFY_CODE_INVALID");
});

test("a correct code succeeds before the lockout is reached and is single-use", async () => {
  const { user, code } = await makeUnverifiedUser();

  await verifyEmail(mockReq({ body: { email: user.email, code: "999999" } }), mockRes());
  const res = mockRes();
  await verifyEmail(mockReq({ body: { email: user.email, code } }), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));

  const verified = await User.findById(user._id);
  assert.equal(verified.emailVerified, true);
  assert.ok(verified.emailVerifiedAt);
  assert.ok(await AuditLog.findOne({ action: "user.email_verified" }), "verification is audited");
});

test("resend cooldown is generic and does not rotate the code", async () => {
  const { user } = await makeUnverifiedUser();
  await User.updateOne({ _id: user._id }, { $set: { verificationSentAt: new Date() } });
  const before = await User.findById(user._id).select("+emailVerificationCode");

  const res = mockRes();
  await resendVerification(mockReq({ body: { email: user.email, ip: "127.0.0.1" } }), res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body.message, /new code has been sent/i);

  const after = await User.findById(user._id).select("+emailVerificationCode");
  assert.equal(after.emailVerificationCode, before.emailVerificationCode);
  assert.equal(after.verificationSentAt.getTime(), before.verificationSentAt.getTime());
});

test("hourly send budget is enforced per user and per IP from the shared limiter", async () => {
  const user = await User.create({
    name: "Budget User",
    email: "budget@example.com",
    password: "password123",
  });
  const req = { ip: "203.0.113.7" };
  const max = verificationSendLimit();
  assert.ok(max > 0 && max < 100, "sane default hourly cap");

  for (let i = 0; i < max; i++) {
    assert.equal(canSendVerification(user, req).allowed, true, `slot ${i + 1}`);
    assert.equal(recordVerificationSend(user, req), true);
  }
  assert.equal(canSendVerification(user, req).allowed, false, "next send is refused");

  // A different IP still has its own budget, but this user does not.
  assert.equal(canSendVerification(user, { ip: "203.0.113.99" }).allowed, false);
  // A different user from the saturated IP is refused too.
  assert.equal(canSendVerification({ _id: "someone-else" }, req).allowed, false);

  resetRateLimiterForTests();
  assert.equal(canSendVerification(user, req).allowed, true);
  assert.ok(userBucketKey(user).startsWith("email-verification:user:"));
  assert.ok(ipBucketKey(req).startsWith("email-verification:ip:"));
});

test("registration rejects a disposable address and a proven no-MX domain", async () => {
  const disposable = mockRes();
  await registerUser(
    mockReq({ body: { name: "Temp", email: "person@mailinator.com", password: "password123" } }),
    disposable,
  );
  assert.equal(disposable.statusCode, 400);
  assert.equal(disposable.body.code, "DISPOSABLE_EMAIL");

  // EMAIL_MX_CHECK=false in this file, so flip it on with an injected resolver
  // that returns a definitive "no mail server" verdict.
  process.env.EMAIL_MX_CHECK = "true";
  setMxLookupForTests(async () => false);
  try {
    const noMx = mockRes();
    await registerUser(
      mockReq({ body: { name: "No Mail", email: "person@no-mail.test", password: "password123" } }),
      noMx,
    );
    assert.equal(noMx.statusCode, 400);
    assert.equal(noMx.body.code, "NO_MX_RECORD");
    assert.equal(await User.countDocuments({}), 0, "neither rejected account is created");
  } finally {
    delete process.env.EMAIL_MX_CHECK;
    resetMxLookupForTests();
  }
});

test("DNS failure at signup fails open: the account is still created", async () => {
  process.env.EMAIL_MX_CHECK = "true";
  setMxLookupForTests(async () => {
    throw new Error("resolver timeout");
  });
  try {
    const res = mockRes();
    await registerUser(
      mockReq({ body: { name: "Resolver Down", email: "person@example.com", password: "password123" } }),
      res,
    );
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    assert.equal(res.body.verificationSent, true);
    assert.ok(await User.findOne({ email: "person@example.com" }));
  } finally {
    delete process.env.EMAIL_MX_CHECK;
    resetMxLookupForTests();
  }
});
