import test, { before, after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";
process.env.FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
process.env.EMAIL_MX_CHECK = "false"; // unit tests must never touch DNS

import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import User from "../src/models/User.js";
import {
  registerUser,
  loginUser,
  verifyPhone,
  resendPhoneOtp,
} from "../src/controllers/authController.js";
import { requireVerifiedEmail } from "../src/middleware/authMiddleware.js";
import { normalizePhone, formatPhone } from "../src/utils/phone.js";
import { registerSchema, loginSchema, verifyPhoneSchema } from "../src/validators/authValidators.js";

let mongod;

before(async () => {
  mongod = await startTestDb();
});

after(async () => {
  await stopTestDb(mongod);
});

function identityProbe(user) {
  let called = false;
  const res = mockRes();
  requireVerifiedEmail({ user, principalType: "user" }, res, () => {
    called = true;
  });
  return { called, status: res.statusCode, code: res.body?.code };
}

test("phone normalization collapses every input format to one canonical value", () => {
  assert.equal(normalizePhone("0300 1234567"), "923001234567");
  assert.equal(normalizePhone("0300-1234567"), "923001234567");
  assert.equal(normalizePhone("+92-300-1234567"), "923001234567");
  assert.equal(normalizePhone("00923001234567"), "923001234567");
  assert.equal(normalizePhone("923001234567"), "923001234567");
  assert.equal(normalizePhone("3001234567"), "923001234567");
  assert.equal(normalizePhone("123"), null, "too short must be rejected");
  assert.equal(normalizePhone(""), null);
  assert.equal(normalizePhone(12345), null, "non-strings are rejected");
  assert.equal(formatPhone("923001234567"), "+923001234567");
});

test("register needs an email or a phone (never neither); login accepts either", () => {
  const base = { name: "Either", password: "password123" };

  assert.equal(registerSchema.safeParse({ ...base, phone: "0300 1234567" }).success, true);
  assert.equal(registerSchema.safeParse({ ...base, email: "either@example.com" }).success, true);
  assert.equal(registerSchema.safeParse(base).success, false);
  assert.equal(registerSchema.safeParse({ ...base, email: "", phone: "0300 1234567" }).success, true);

  assert.equal(loginSchema.safeParse({ identifier: "0300 1234567", password: "x" }).success, true);
  assert.equal(loginSchema.safeParse({ password: "x" }).success, false);
  assert.equal(verifyPhoneSchema.safeParse({ phone: "0300 1234567", otp: "12345" }).success, false);
  assert.equal(verifyPhoneSchema.safeParse({ phone: "0300 1234567", otp: "012345" }).success, true);
});

test("phone-only signup creates the account, normalizes the number and sends no SMS", async () => {
  const captured = [];
  const original = console.log;
  console.log = (...args) => captured.push(args.join(" "));
  let res;
  try {
    res = mockRes();
    await registerUser(
      mockReq({ body: { name: "Phone Only", phone: "0300-1111111", password: "password123" } }),
      res,
    );
  } finally {
    console.log = original;
  }

  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(res.body.user.phone, "923001111111");
  assert.equal(res.body.user.email, "");
  assert.equal(res.body.user.emailVerified, false);
  assert.equal(res.body.user.phoneVerified, false);
  assert.equal(res.body.requiresEmailVerification, false, "there is no address to verify");
  assert.equal(res.body.requiresPhoneVerification, false, "SMS/phone verification is deferred");
  assert.equal(res.body.verificationSent, false);
  assert.equal(res.body.phoneVerification, undefined, "no OTP payload is returned");

  const stored = await User.findOne({ phone: "923001111111" }).select("+phoneVerificationOtp");
  assert.ok(stored);
  assert.equal(stored.phoneVerificationOtp, undefined, "no OTP is ever issued");
  assert.equal(stored.phoneVerified, false);

  const logs = captured.join("\n");
  assert.doesNotMatch(logs, /sms|otp/i, "no SMS/OTP may be sent or logged");

  const blocked = identityProbe(stored);
  assert.equal(blocked.called, false);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.code, "EMAIL_NOT_VERIFIED");
});

test("phone verification endpoints are explicitly deferred and never flip phoneVerified", async () => {
  const user = await User.create({
    name: "Deferred Phone",
    phone: "923002222222",
    password: "password123",
  });

  const verify = mockRes();
  await verifyPhone(mockReq({ body: { phone: "0300 2222 222", otp: "123456" } }), verify);
  assert.equal(verify.statusCode, 400);
  assert.equal(verify.body.code, "PHONE_VERIFICATION_DEFERRED");

  const resend = mockRes();
  await resendPhoneOtp(mockReq({ body: { phone: "0300-2222222" } }), resend);
  assert.equal(resend.statusCode, 400);
  assert.equal(resend.body.code, "PHONE_VERIFICATION_DEFERRED");

  const stored = await User.findById(user._id);
  assert.equal(stored.phoneVerified, false);
  assert.equal(stored.phoneVerificationOtp, undefined);
});

test("a legacy phoneVerified account still does not satisfy the email-only gate", async () => {
  const user = await User.create({
    name: "Legacy Phone Verified",
    phone: "923003333333",
    password: "password123",
    phoneVerified: true,
    phoneVerifiedAt: new Date(),
  });
  const probe = identityProbe(user);
  assert.equal(probe.called, false, "migration must grandfather these accounts, not the gate");
  assert.equal(probe.status, 403);
});

test("login accepts a phone number in any format through any supported key", async () => {
  const reg = mockRes();
  await registerUser(
    mockReq({ body: { name: "Phone Login", phone: "0300-6666666", password: "password123" } }),
    reg,
  );
  assert.equal(reg.statusCode, 201, JSON.stringify(reg.body));

  const byIdentifier = mockRes();
  await loginUser(
    mockReq({ body: { identifier: "+92 300 6666666", password: "password123" } }),
    byIdentifier,
  );
  assert.equal(byIdentifier.statusCode, 200, JSON.stringify(byIdentifier.body));
  assert.ok(byIdentifier.body.token);
  assert.equal(byIdentifier.body.user.phone, "923006666666");
  assert.equal(byIdentifier.body.user.phoneVerified, false);

  const byLegacyKey = mockRes();
  await loginUser(mockReq({ body: { email: "0300 6666666", password: "password123" } }), byLegacyKey);
  assert.equal(byLegacyKey.statusCode, 200, JSON.stringify(byLegacyKey.body));

  const wrongPassword = mockRes();
  await loginUser(
    mockReq({ body: { identifier: "03006666666", password: "wrong-password" } }),
    wrongPassword,
  );
  assert.equal(wrongPassword.statusCode, 400);
  assert.equal(wrongPassword.body.message, "Invalid credentials");
});

test("the same phone number in a different format cannot register twice", async () => {
  const first = mockRes();
  await registerUser(
    mockReq({ body: { name: "Unique Phone", phone: "+923007777777", password: "password123" } }),
    first,
  );
  assert.equal(first.statusCode, 201, JSON.stringify(first.body));

  const second = mockRes();
  await registerUser(
    mockReq({ body: { name: "Unique Phone 2", phone: "0300-7777777", password: "password456" } }),
    second,
  );
  assert.equal(second.statusCode, 409, JSON.stringify(second.body));
  assert.equal(second.body.code, "PHONE_TAKEN");
  assert.equal(await User.countDocuments({ phone: "923007777777" }), 1);
});

test("email and phone can be given together; only the email code opens the gate", async () => {
  const captured = [];
  const original = console.log;
  console.log = (...args) => captured.push(args.join(" "));
  let reg;
  try {
    reg = mockRes();
    await registerUser(
      mockReq({
        body: {
          name: "Both Identifiers",
          email: "both@example.com",
          phone: "0300-8888888",
          password: "password123",
        },
      }),
      reg,
    );
  } finally {
    console.log = original;
  }
  assert.equal(reg.statusCode, 201, JSON.stringify(reg.body));
  assert.equal(reg.body.requiresEmailVerification, true);
  assert.equal(reg.body.requiresPhoneVerification, false);
  assert.equal(reg.body.verificationSent, true, "the email code is sent");
  assert.doesNotMatch(captured.join("\n"), /sms|otp/i, "no SMS is sent");

  const stored = await User.findOne({ email: "both@example.com" }).select("+emailVerificationCode");
  assert.ok(stored.emailVerificationCode, "the email code is stored hashed");
  assert.equal(stored.phoneVerified, false);
  assert.equal(identityProbe(stored).called, false, "phone number alone does not verify the account");
});
