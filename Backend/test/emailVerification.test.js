import test from "node:test";
import assert from "node:assert/strict";

process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "test-client-id.apps.googleusercontent.com";

import {
  generateVerificationToken,
  hashVerificationToken,
  isVerificationExpired,
  isVerificationCoolingDown,
  VERIFICATION_TOKEN_EXPIRY_MS,
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

test("verification token is 64 hex chars and unique", () => {
  const a = generateVerificationToken();
  const b = generateVerificationToken();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
});

test("verification token is stored hashed, never raw", () => {
  const token = generateVerificationToken();
  const hashed = hashVerificationToken(token);
  assert.equal(hashed.length, 64);
  assert.notEqual(hashed, token);
  assert.equal(hashVerificationToken(token), hashed, "hash must be stable");
  assert.notEqual(hashVerificationToken(generateVerificationToken()), hashed);
});

test("verification expiry defaults to 24h and rejects missing/past expiries", () => {
  assert.equal(VERIFICATION_TOKEN_EXPIRY_MS, 24 * 60 * 60 * 1000);
  assert.equal(isVerificationExpired(undefined), true, "missing expiry must count as expired");
  assert.equal(isVerificationExpired(null), true);
  assert.equal(isVerificationExpired(new Date(Date.now() + 60_000)), false);
  assert.equal(isVerificationExpired(new Date(Date.now() - 1_000)), true);
  assert.equal(isVerificationExpired("not-a-date"), true);
});

test("verification resend cool-down blocks within 60s and allows after", () => {
  const now = Date.now();
  assert.equal(isVerificationCoolingDown(null, now), false);
  assert.equal(isVerificationCoolingDown(new Date(now - 10_000), now), true);
  assert.equal(isVerificationCoolingDown(new Date(now - 120_000), now), false);
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

test("console mail driver writes the message to the server log", async () => {
  const captured = [];
  const original = console.log;
  console.log = (...args) => captured.push(args.join(" "));
  try {
    const result = await sendMail({
      to: "dev@example.com",
      subject: "Verify your CricAll email address",
      text: "Open http://localhost:5173/verify-email/abc123",
    });
    assert.equal(result.driver, "console");
    assert.equal(result.delivered, true);
  } finally {
    console.log = original;
  }
  const joined = captured.join("\n");
  assert.match(joined, /verify-email\/abc123/, "the link must land in the log");
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

test("register schema strips unexpected keys and applies defaults", () => {
  const result = registerSchema.safeParse({
    name: "  Test User ",
    email: "  USER@Example.COM ",
    password: "password123",
    accountType: "handler",
    $gt: "",
    evil: { $ne: 1 },
  });
  assert.equal(result.success, true);
  assert.equal(result.data.email, "USER@Example.COM");
  assert.equal(result.data.accountType, "handler");
  assert.equal(result.data.$gt, undefined);
  assert.equal(result.data.evil, undefined);
  assert.equal(result.data.organizationName, "");
});

test("forgot-password schema rejects object email (injection guard)", () => {
  assert.equal(forgotPasswordSchema.safeParse({ email: { $regex: "^a" } }).success, false);
  assert.equal(forgotPasswordSchema.safeParse({ email: "a@b.com" }).success, true);
});

test("login schema requires a string password", () => {
  assert.equal(loginSchema.safeParse({ email: "a@b.com" }).success, false);
  assert.equal(loginSchema.safeParse({ email: "a@b.com", password: { $ne: 1 } }).success, false);
});

test("requireVerifiedEmail: unverified user is blocked with 403 EMAIL_NOT_VERIFIED", () => {
  const { status, body, nextCalled } = callMiddleware(requireVerifiedEmail, {
    user: { emailVerified: false },
    principalType: "user",
  });
  assert.equal(nextCalled, false);
  assert.equal(status, 403);
  assert.equal(body.code, "EMAIL_NOT_VERIFIED");
});

test("requireVerifiedEmail: verified user and platform admin pass", () => {
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
