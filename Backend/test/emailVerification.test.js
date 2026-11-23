import test from "node:test";
import assert from "node:assert/strict";

process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "test-client-id.apps.googleusercontent.com";

import {
  generateEmailCode,
  hashEmailCode,
  isEmailCodeExpired,
  isEmailCoolingDown,
  EMAIL_CODE_EXPIRY_MS,
  RESEND_COOLDOWN_MS,
  MAX_EMAIL_CODE_ATTEMPTS,
  buildVerificationMail,
} from "../src/utils/emailVerification.js";
import {
  isResetTokenExpired,
  generateResetToken,
  hashResetToken,
} from "../src/utils/passwordReset.js";
import { sendMail } from "../src/utils/mailer.js";
import { registerSchema, forgotPasswordSchema, loginSchema } from "../src/validators/authValidators.js";
import { requireVerifiedEmail, requireAdmin } from "../src/middleware/authMiddleware.js";
import { verifyGoogleIdToken, GoogleVerificationError, __setGoogleVerifyImpl } from "../src/services/googleVerifier.js";

function callMiddleware(handler, req) {
  let status = 0;
  let body = null;
  let nextCalled = false;
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
  handler(req, res, () => {
    nextCalled = true;
  });
  return { status, body, nextCalled };
}

test("verification code is exactly 6 numeric digits, zero-padded", () => {
  for (let i = 0; i < 50; i++) {
    assert.match(generateEmailCode(), /^\d{6}$/);
  }
  // Zero padding is part of the contract (never shorten a leading-zero code).
  const raw = String(generateEmailCode());
  assert.equal(raw.padStart(6, "0").length, 6);
});

test("verification code is stored hashed, never raw", () => {
  const code = generateEmailCode();
  const hashed = hashEmailCode(code);
  assert.match(hashed, /^[0-9a-f]{64}$/);
  assert.notEqual(hashed, code);
  assert.equal(hashEmailCode(code), hashed, "hash must be stable");
  assert.notEqual(hashEmailCode(generateEmailCode()), hashed);
});

test("verification expiry defaults to 10 minutes and rejects missing/past expiries", () => {
  assert.equal(EMAIL_CODE_EXPIRY_MS(), 10 * 60 * 1000);
  assert.equal(isEmailCodeExpired(undefined), true, "missing expiry must count as expired");
  assert.equal(isEmailCodeExpired(null), true);
  assert.equal(isEmailCodeExpired(new Date(Date.now() + 60_000)), false);
  assert.equal(isEmailCodeExpired(new Date(Date.now() - 1_000)), true);
  assert.equal(isEmailCodeExpired("not-a-date"), true);
});

test("lockout threshold, cooldown length and mail template are pinned", () => {
  assert.equal(MAX_EMAIL_CODE_ATTEMPTS, 5);
  assert.equal(RESEND_COOLDOWN_MS, 60_000);

  const now = Date.now();
  assert.equal(isEmailCoolingDown(null, now), false);
  assert.equal(isEmailCoolingDown(new Date(now - 10_000), now), true);
  assert.equal(isEmailCoolingDown(new Date(now - 120_000), now), false);

  const mail = buildVerificationMail({ code: "004213", name: "Sara", minutes: 10 });
  assert.match(mail.subject, /CricAll/i);
  assert.match(mail.text, /004213/);
  assert.match(mail.text, /10 minutes/);
  assert.match(mail.text, /did not request this/i);
  assert.match(mail.text, /اپنا ای میل|تصدیقی کوڈ/); // Urdu text
  assert.match(mail.html, /004213/);
  assert.doesNotMatch(mail.html, /<img|tracking|beacon/i, "no tracking pixels");
});

test("reset token expiry treats a missing expiry as expired (regression)", () => {
  assert.equal(isResetTokenExpired(undefined), true);
  assert.equal(isResetTokenExpired(null), true);
  assert.equal(isResetTokenExpired(new Date(Date.now() + 60_000)), false);
  assert.equal(isResetTokenExpired(new Date(Date.now() - 1_000)), true);
  const token = generateResetToken();
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(hashResetToken(token).length, 64);
});

test("console mail driver writes the 6-digit code to the server log", async () => {
  const captured = [];
  const original = console.log;
  console.log = (...args) => captured.push(args.join(" "));
  try {
    const mail = buildVerificationMail({ code: "123456" });
    const result = await sendMail({
      to: "dev@example.com",
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    assert.equal(result.driver, "console");
    assert.equal(result.delivered, true);
  } finally {
    console.log = original;
  }
  const joined = captured.join("\n");
  assert.match(joined, /123456/, "the code must land in the console driver log");
  assert.match(joined, /dev@example\.com/);
});

test("sendMail without a recipient is a no-op", async () => {
  const result = await sendMail({ to: "", subject: "x", text: "y" });
  assert.equal(result.delivered, false);
  assert.equal(result.driver, "none");
});

test("register schema rejects NoSQL operator objects in email", () => {
  const result = registerSchema.safeParse({
    name: "Test",
    email: { $ne: "" },
    password: "password123",
  });
  assert.equal(result.success, false);
});

test("register schema uses strict syntax, lowercases and strips unexpected keys", () => {
  const result = registerSchema.safeParse({
    name: "  Test User ",
    email: "  USER@Example.COM ",
    password: "password123",
    accountType: "handler",
    $gt: "",
    evil: { $ne: 1 },
  });
  assert.equal(result.success, true);
  assert.equal(result.data.email, "user@example.com");
  assert.equal(result.data.accountType, "handler");
  assert.equal(result.data.$gt, undefined);
  assert.equal(result.data.evil, undefined);
  assert.equal(result.data.organizationName, "");
});

test("register schema rejects obviously invalid email syntax", () => {
  for (const email of ["not-an-email", "a@b", "a@@b.com", "a b@example.com", "a@localhost"]) {
    assert.equal(
      registerSchema.safeParse({ name: "T", email, password: "password123" }).success,
      false,
      `${email} must be rejected`,
    );
  }
});

test("forgot-password schema rejects object email (injection guard)", () => {
  assert.equal(forgotPasswordSchema.safeParse({ email: { $regex: "^a" } }).success, false);
  assert.equal(forgotPasswordSchema.safeParse({ email: "a@b.com" }).success, true);
});

test("login schema requires a string password", () => {
  assert.equal(loginSchema.safeParse({ email: "a@b.com" }).success, false);
  assert.equal(loginSchema.safeParse({ email: "a@b.com", password: { $ne: 1 } }).success, false);
});

test("requireVerifiedEmail: email-only gate blocks unverified and phone-only users", () => {
  const unverified = callMiddleware(requireVerifiedEmail, {
    user: { emailVerified: false, phoneVerified: true },
    principalType: "user",
  });
  assert.equal(unverified.nextCalled, false);
  assert.equal(unverified.status, 403);
  assert.equal(unverified.body.code, "EMAIL_NOT_VERIFIED");
});

test("requireVerifiedEmail: verified email and platform admin pass", () => {
  assert.equal(callMiddleware(requireVerifiedEmail, { user: { emailVerified: true }, principalType: "user" }).nextCalled, true);
  assert.equal(callMiddleware(requireVerifiedEmail, { user: { role: "admin" }, principalType: "admin" }).nextCalled, true);
  assert.equal(callMiddleware(requireVerifiedEmail, {}).status, 401);
});

test("requireAdmin still behaves exactly as before", () => {
  assert.equal(callMiddleware(requireAdmin, {}).status, 401);
  assert.equal(callMiddleware(requireAdmin, { user: { role: "viewer" } }).status, 403);
  assert.equal(callMiddleware(requireAdmin, { user: { role: "admin" } }).nextCalled, true);
});

const validPayload = {
  sub: "google-sub-123",
  email: "Person@Example.com",
  email_verified: true,
  aud: process.env.GOOGLE_CLIENT_ID,
  iss: "https://accounts.google.com",
  exp: Math.floor(Date.now() / 1000) + 3600,
  name: "Person",
  picture: "https://example.com/p.png",
};

test("google verifier accepts a valid token and normalizes the email", async () => {
  __setGoogleVerifyImpl(async () => ({ ...validPayload }));
  const identity = await verifyGoogleIdToken("some-id-token");
  assert.equal(identity.email, "person@example.com");
  assert.equal(identity.googleId, "google-sub-123");
  assert.equal(identity.name, "Person");
  __setGoogleVerifyImpl(null);
});

test("google verifier rejects an audience mismatch", async () => {
  __setGoogleVerifyImpl(async () => ({ ...validPayload, aud: "someone-elses-client.apps.googleusercontent.com" }));
  await assert.rejects(
    () => verifyGoogleIdToken("some-id-token"),
    (err) => err instanceof GoogleVerificationError && err.code === "AUDIENCE_MISMATCH",
  );
  __setGoogleVerifyImpl(null);
});

test("google verifier rejects an unverified email", async () => {
  __setGoogleVerifyImpl(async () => ({ ...validPayload, email_verified: false }));
  await assert.rejects(
    () => verifyGoogleIdToken("some-id-token"),
    (err) => err instanceof GoogleVerificationError && err.code === "EMAIL_UNVERIFIED",
  );
  __setGoogleVerifyImpl(null);
});

test("google verifier rejects an expired token", async () => {
  __setGoogleVerifyImpl(async () => ({ ...validPayload, exp: Math.floor(Date.now() / 1000) - 60 }));
  await assert.rejects(
    () => verifyGoogleIdToken("some-id-token"),
    (err) => err instanceof GoogleVerificationError && err.code === "TOKEN_EXPIRED",
  );
  __setGoogleVerifyImpl(null);
});

test("google verifier rejects a foreign issuer", async () => {
  __setGoogleVerifyImpl(async () => ({ ...validPayload, iss: "https://evil.example.com" }));
  await assert.rejects(
    () => verifyGoogleIdToken("some-id-token"),
    (err) => err instanceof GoogleVerificationError && err.code === "ISSUER_INVALID",
  );
  __setGoogleVerifyImpl(null);
});

test("google verifier fails closed when GOOGLE_CLIENT_ID is missing", async () => {
  const saved = process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_ID;
  __setGoogleVerifyImpl(async () => ({ ...validPayload, aud: undefined }));
  try {
    await assert.rejects(
      () => verifyGoogleIdToken("some-id-token"),
      (err) => err instanceof GoogleVerificationError && err.code === "GOOGLE_CLIENT_ID_MISSING",
    );
  } finally {
    process.env.GOOGLE_CLIENT_ID = saved;
    __setGoogleVerifyImpl(null);
  }
});

test("google verifier rejects a missing credential", async () => {
  await assert.rejects(
    () => verifyGoogleIdToken(""),
    (err) => err instanceof GoogleVerificationError && err.code === "CREDENTIAL_INVALID",
  );
});
