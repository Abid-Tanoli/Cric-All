import test, { before, after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";
process.env.FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import User from "../src/models/User.js";
import {
  registerUser,
  loginUser,
  verifyPhone,
  resendPhoneOtp,
} from "../src/controllers/authController.js";
import { requireVerifiedEmail } from "../src/middleware/authMiddleware.js";
import { hashOtp, MAX_OTP_ATTEMPTS } from "../src/utils/phoneVerification.js";
import { normalizePhone, formatPhone } from "../src/utils/phone.js";
import { registerSchema, loginSchema, verifyPhoneSchema } from "../src/validators/authValidators.js";

let mongod;

before(async () => {
  mongod = await startTestDb();
});

after(async () => {
  await stopTestDb(mongod);
});

// The console SMS driver writes the message through console.log; capture it so
// the test can use the exact OTP that was issued (mirrors captureVerificationLink).
async function captureIssuedOtp(fn) {
  const captured = [];
  const original = console.log;
  console.log = (...args) => captured.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  const match = captured.join("\n").match(/verification code is (\d{6})/);
  return match ? match[1] : null;
}

function identityProbe(user) {
  let called = false;
  const res = mockRes();
  requireVerifiedEmail({ user, principalType: "user" }, res, () => {
    called = true;
  });
  return { called, status: res.statusCode, code: res.body?.code };
}

/** A code that is guaranteed to differ from the issued one. */
const wrongCode = (otp) => String((Number(otp) + 1) % 1_000_000).padStart(6, "0");

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

  const phoneOnly = registerSchema.safeParse({ ...base, phone: "0300 1234567" });
  assert.equal(phoneOnly.success, true, JSON.stringify(phoneOnly.error?.issues));

  const emailOnly = registerSchema.safeParse({ ...base, email: "either@example.com" });
  assert.equal(emailOnly.success, true);

  const both = registerSchema.safeParse({ ...base, email: "either@example.com", phone: "+923001234567" });
  assert.equal(both.success, true);

  const neither = registerSchema.safeParse(base);
  assert.equal(neither.success, false, "signup with neither identifier must be rejected");

  // Legacy clients post `email: ""` / `phone: ""` — treated as absent, not invalid.
  const emptyStrings = registerSchema.safeParse({ ...base, email: "", phone: "0300 1234567" });
  assert.equal(emptyStrings.success, true, JSON.stringify(emptyStrings.error?.issues));

  const loginByIdentifier = loginSchema.safeParse({ identifier: "0300 1234567", password: "x" });
  assert.equal(loginByIdentifier.success, true);
  assert.equal(loginSchema.safeParse({ password: "x" }).success, false, "login needs an identifier");

  assert.equal(
    verifyPhoneSchema.safeParse({ phone: "0300 1234567", otp: "12345" }).success,
    false,
    "a 5-digit code must fail validation before touching the DB",
  );
  assert.equal(verifyPhoneSchema.safeParse({ phone: "0300 1234567", otp: "012345" }).success, true);
});

test("phone-only signup creates the account, normalizes the number, and issues an OTP", async () => {
  const res = mockRes();
  const otp = await captureIssuedOtp(() =>
    registerUser(
      mockReq({ body: { name: "Phone Only", phone: "0300-1111111", password: "password123" } }),
      res,
    ),
  );

  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(res.body.user.phone, "923001111111", "stored digits-only with country code");
  assert.equal(res.body.user.email, "", "no email, empty string in the payload");
  assert.equal(res.body.user.emailVerified, false);
  assert.equal(res.body.user.phoneVerified, false);
  assert.equal(res.body.requiresEmailVerification, false, "there is no address to verify");
  assert.equal(res.body.requiresPhoneVerification, true);
  assert.equal(res.body.verificationSent, false, "no email means no email verification attempt");
  assert.equal(res.body.phoneVerification.sent, true);
  assert.equal(res.body.phoneVerification.channel, "console", "dev driver until an SMS provider exists");
  assert.ok(otp, "the OTP must be written to the server log for development");

  const stored = await User.findOne({ phone: "923001111111" }).select("+phoneVerificationOtp");
  assert.ok(stored, "user persisted");
  assert.notEqual(stored.phoneVerificationOtp, otp, "the raw OTP must never be stored");
  assert.equal(stored.phoneVerificationOtp, hashOtp(otp), "only the SHA-256 hash is stored");
  assert.ok(stored.phoneVerificationExpires > new Date(), "the code expires");

  // Privileged actions stay blocked until the number is verified.
  const blocked = identityProbe(stored);
  assert.equal(blocked.called, false);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.code, "EMAIL_NOT_VERIFIED");
});

test("verify-phone accepts the issued OTP once, then the gate opens", async () => {
  const reg = mockRes();
  const otp = await captureIssuedOtp(() =>
    registerUser(
      mockReq({ body: { name: "Verify Phone", phone: "0300-2222222", password: "password123" } }),
      reg,
    ),
  );
  assert.equal(reg.statusCode, 201, JSON.stringify(reg.body));
  assert.ok(otp);

  const res = mockRes();
  await verifyPhone(mockReq({ body: { phone: "0300 2222 222", otp } }), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.user.phoneVerified, true);

  const after = await User.findOne({ phone: "923002222222" }).select("+phoneVerificationOtp");
  assert.equal(after.phoneVerified, true);
  assert.ok(after.phoneVerifiedAt);
  assert.equal(after.phoneVerificationOtp, undefined, "the code must be single-use");
  assert.equal(after.phoneVerificationExpires, undefined);

  const allowed = identityProbe(after);
  assert.equal(allowed.called, true, "phone verification must satisfy the identity gate");

  // Replaying the same code must fail.
  const reuse = mockRes();
  await verifyPhone(mockReq({ body: { phone: "0300-2222222", otp } }), reuse);
  assert.equal(reuse.statusCode, 400);
  assert.equal(reuse.body.code, "OTP_INVALID");
});

test("an expired OTP is rejected even when the code is correct", async () => {
  const reg = mockRes();
  const otp = await captureIssuedOtp(() =>
    registerUser(
      mockReq({ body: { name: "Expired OTP", phone: "0300-3333333", password: "password123" } }),
      reg,
    ),
  );
  assert.equal(reg.statusCode, 201, JSON.stringify(reg.body));

  await User.updateOne(
    { phone: "923003333333" },
    { $set: { phoneVerificationExpires: new Date(Date.now() - 1000) } },
  );

  const res = mockRes();
  await verifyPhone(mockReq({ body: { phone: "0300-3333333", otp } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "OTP_INVALID");

  const stored = await User.findOne({ phone: "923003333333" });
  assert.equal(stored.phoneVerified, false);
});

test(`wrong codes are rejected and burn the OTP after ${MAX_OTP_ATTEMPTS} attempts`, async () => {
  const reg = mockRes();
  const otp = await captureIssuedOtp(() =>
    registerUser(
      mockReq({ body: { name: "Brute Force", phone: "0300-4444444", password: "password123" } }),
      reg,
    ),
  );
  assert.equal(reg.statusCode, 201, JSON.stringify(reg.body));
  assert.ok(otp);

  const bad = wrongCode(otp);
  for (let attempt = 1; attempt <= MAX_OTP_ATTEMPTS; attempt += 1) {
    const res = mockRes();
    await verifyPhone(mockReq({ body: { phone: "0300-4444444", otp: bad } }), res);
    assert.equal(res.statusCode, 400, `attempt ${attempt} must fail`);
    assert.equal(res.body.code, "OTP_INVALID");
    if (attempt === MAX_OTP_ATTEMPTS) {
      assert.match(res.body.message, /Too many incorrect attempts/i);
    }
  }

  const burned = await User.findOne({ phone: "923004444444" }).select("+phoneVerificationOtp");
  assert.equal(burned.phoneVerificationOtp, undefined, "the code must be invalidated");
  assert.equal(burned.phoneVerified, false);

  // Even the real code is dead now.
  const afterBurn = mockRes();
  await verifyPhone(mockReq({ body: { phone: "0300-4444444", otp } }), afterBurn);
  assert.equal(afterBurn.statusCode, 400);
  assert.equal(afterBurn.body.code, "OTP_INVALID");
});

test("resend-phone-otp is generic for unknown numbers and honors the per-account cooldown", async () => {
  // Unknown phone → same generic 200, no enumeration.
  const unknown = mockRes();
  await resendPhoneOtp(mockReq({ body: { phone: "03009999999" } }), unknown);
  assert.equal(unknown.statusCode, 200);
  assert.ok(!JSON.stringify(unknown.body).includes("03009999999"));

  // Fresh signup → immediate resend hits the cooldown.
  const reg = mockRes();
  await registerUser(
    mockReq({ body: { name: "Cooldown Phone", phone: "0300-5555555", password: "password123" } }),
    reg,
  );
  assert.equal(reg.statusCode, 201, JSON.stringify(reg.body));

  const resend = mockRes();
  await resendPhoneOtp(mockReq({ body: { phone: "0300-5555555" } }), resend);
  assert.equal(resend.statusCode, 429);
  assert.equal(resend.body.code, "RESEND_COOLDOWN");

  // Already verified → generic 200 again (no new code would be needed).
  await User.updateOne({ phone: "923005555555" }, { $set: { phoneVerified: true, phoneVerificationSentAt: null } });
  const verified = mockRes();
  await resendPhoneOtp(mockReq({ body: { phone: "0300-5555555" } }), verified);
  assert.equal(verified.statusCode, 200);
});

test("login accepts a phone number in any format through any supported key", async () => {
  const reg = mockRes();
  await registerUser(
    mockReq({ body: { name: "Phone Login", phone: "0300-6666666", password: "password123" } }),
    reg,
  );
  assert.equal(reg.statusCode, 201, JSON.stringify(reg.body));

  // `identifier` with the international format.
  const byIdentifier = mockRes();
  await loginUser(
    mockReq({ body: { identifier: "+92 300 6666666", password: "password123" } }),
    byIdentifier,
  );
  assert.equal(byIdentifier.statusCode, 200, JSON.stringify(byIdentifier.body));
  assert.ok(byIdentifier.body.token);
  assert.equal(byIdentifier.body.user.phone, "923006666666");
  assert.equal(byIdentifier.body.user.phoneVerified, false);

  // Legacy clients still post the number under `email`.
  const byLegacyKey = mockRes();
  await loginUser(
    mockReq({ body: { email: "0300 6666666", password: "password123" } }),
    byLegacyKey,
  );
  assert.equal(byLegacyKey.statusCode, 200, JSON.stringify(byLegacyKey.body));

  // Wrong password → generic failure, never a 500.
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

  const count = await User.countDocuments({ phone: "923007777777" });
  assert.equal(count, 1, "exactly one account per normalized phone");
});

test("email and phone can be given together and either one satisfies the gate", async () => {
  const reg = mockRes();
  const otp = await captureIssuedOtp(() =>
    registerUser(
      mockReq({
        body: {
          name: "Both Identifiers",
          email: "both@example.com",
          phone: "0300-8888888",
          password: "password123",
        },
      }),
      reg,
    ),
  );
  assert.equal(reg.statusCode, 201, JSON.stringify(reg.body));
  assert.equal(reg.body.requiresEmailVerification, true);
  assert.equal(reg.body.requiresPhoneVerification, true);
  assert.ok(reg.body.verificationSent, "the email link is still sent");
  assert.ok(otp, "the phone code is sent too");

  // Verifying ONLY the phone opens the gate — no second factor, no approval.
  const verify = mockRes();
  await verifyPhone(mockReq({ body: { phone: "0300-8888888", otp } }), verify);
  assert.equal(verify.statusCode, 200, JSON.stringify(verify.body));

  const stored = await User.findOne({ email: "both@example.com" });
  assert.equal(stored.emailVerified, false, "the email stays unverified");
  const allowed = identityProbe(stored);
  assert.equal(allowed.called, true, "phone verification alone must be enough");
});
