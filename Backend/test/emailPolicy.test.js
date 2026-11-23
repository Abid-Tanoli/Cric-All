import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeEmail,
  isValidEmailSyntax,
  isDisposableEmail,
  checkEmailPolicy,
  setMxLookupForTests,
  resetMxLookupForTests,
  DISPOSABLE_EMAIL_DOMAINS,
} from "../src/utils/emailPolicy.js";

test.afterEach(() => {
  resetMxLookupForTests();
  delete process.env.EMAIL_MX_CHECK;
});

test("normalizeEmail trims and lowercases; isValidEmailSyntax is strict", () => {
  assert.equal(normalizeEmail("  User@Example.COM "), "user@example.com");
  assert.equal(isValidEmailSyntax("user@example.com"), true);
  assert.equal(isValidEmailSyntax("user+tag@sub.example.co.uk"), true);
  for (const bad of ["", "user", "user@", "@example.com", "user@example", "user name@example.com", "a@b.c"]) {
    assert.equal(isValidEmailSyntax(bad), false, `${JSON.stringify(bad)} must be rejected`);
  }
});

test("small maintained disposable list is rejected case-insensitively", () => {
  assert.ok(DISPOSABLE_EMAIL_DOMAINS.length > 0 && DISPOSABLE_EMAIL_DOMAINS.length < 50);
  assert.equal(isDisposableEmail("someone@mailinator.com"), true);
  assert.equal(isDisposableEmail("SOMEONE@MAILINATOR.COM"), true);
  assert.equal(isDisposableEmail("someone@example.com"), false);
});

test("checkEmailPolicy rejects disposable addresses before any DNS lookup", async () => {
  setMxLookupForTests(() => { throw new Error("DNS must not be consulted"); });
  const result = await checkEmailPolicy("someone@MAILINATOR.COM");
  assert.deepEqual(result, { ok: false, reason: "DISPOSABLE_EMAIL" });
});

test("checkEmailPolicy rejects only when DNS proves there is no mail server", async () => {
  setMxLookupForTests(async () => false);
  assert.deepEqual(await checkEmailPolicy("nobody@definitely-no-mx.test"), {
    ok: false,
    reason: "NO_MX_RECORD",
  });

  setMxLookupForTests(async () => true);
  assert.deepEqual(await checkEmailPolicy("someone@example.com"), { ok: true });
});

test("DNS failure, timeout and thrown errors fail open", async () => {
  for (const verdict of ["unknown", "timeout", null, undefined]) {
    setMxLookupForTests(async () => verdict);
    assert.deepEqual(await checkEmailPolicy("someone@example.com"), { ok: true });
  }
  setMxLookupForTests(async () => { throw new Error("ENOTFOUND resolver"); });
  assert.deepEqual(await checkEmailPolicy("someone@example.com"), { ok: true });
});

test("EMAIL_MX_CHECK=false disables the DNS step entirely", async () => {
  process.env.EMAIL_MX_CHECK = "false";
  setMxLookupForTests(() => { throw new Error("DNS must not be consulted"); });
  assert.deepEqual(await checkEmailPolicy("someone@example.com"), { ok: true });
});
