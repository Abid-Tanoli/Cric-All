// REQUIRE_VERIFIED_ACCOUNT kill switch.
//
// The verification requirement is ON by default and only the exact string
// "false" turns it off. These tests pin both the flag semantics and the
// middleware behaviour so the switch cannot silently weaken authentication
// (the 401 for a missing principal) while it relaxes identity verification.

import test from "node:test";
import assert from "node:assert/strict";

import {
  requireVerifiedEmail,
  isVerifiedAccountRequired,
} from "../src/middleware/authMiddleware.js";

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

/** Run `fn` with REQUIRE_VERIFIED_ACCOUNT set to `value` (null = unset). */
function withFlag(value, fn) {
  const saved = process.env.REQUIRE_VERIFIED_ACCOUNT;
  try {
    if (value === null) delete process.env.REQUIRE_VERIFIED_ACCOUNT;
    else process.env.REQUIRE_VERIFIED_ACCOUNT = value;
    return fn();
  } finally {
    if (saved === undefined) delete process.env.REQUIRE_VERIFIED_ACCOUNT;
    else process.env.REQUIRE_VERIFIED_ACCOUNT = saved;
  }
}

const unverifiedUser = { emailVerified: false, phoneVerified: false };
const verifiedUser = { emailVerified: true, phoneVerified: false };

test("REQUIRE_VERIFIED_ACCOUNT defaults to required when unset", () => {
  withFlag(null, () => assert.equal(isVerifiedAccountRequired(), true));
});

test("REQUIRE_VERIFIED_ACCOUNT=false disables the requirement (case/space insensitive)", () => {
  withFlag("false", () => assert.equal(isVerifiedAccountRequired(), false));
  withFlag("  FALSE ", () => assert.equal(isVerifiedAccountRequired(), false));
});

test("any value other than the literal false keeps the requirement on", () => {
  for (const value of ["true", "1", "0", "no", "yes", "False!", "", "off"]) {
    withFlag(value, () =>
      assert.equal(isVerifiedAccountRequired(), true, `"${value}" must keep verification required`),
    );
  }
});

test("flag true: an unverified authenticated user is blocked with 403 EMAIL_NOT_VERIFIED", () => {
  withFlag("true", () => {
    const { status, body, nextCalled } = callMiddleware(requireVerifiedEmail, {
      user: unverifiedUser,
      principalType: "user",
    });
    assert.equal(nextCalled, false);
    assert.equal(status, 403);
    assert.equal(body.code, "EMAIL_NOT_VERIFIED");
  });
});

test("flag false: an unverified authenticated user passes through", () => {
  withFlag("false", () => {
    const { status, body, nextCalled } = callMiddleware(requireVerifiedEmail, {
      user: unverifiedUser,
      principalType: "user",
    });
    assert.equal(nextCalled, true);
    assert.equal(status, 0);
    assert.equal(body, null);
  });
});

test("flag false still rejects an unauthenticated request with 401", () => {
  withFlag("false", () => {
    const { status, nextCalled } = callMiddleware(requireVerifiedEmail, {});
    assert.equal(nextCalled, false);
    assert.equal(status, 401);
  });
});

test("flag false still lets a verified user and a platform admin through", () => {
  withFlag("false", () => {
    assert.equal(
      callMiddleware(requireVerifiedEmail, { user: verifiedUser, principalType: "user" }).nextCalled,
      true,
    );
    assert.equal(
      callMiddleware(requireVerifiedEmail, { user: { role: "admin" }, principalType: "admin" }).nextCalled,
      true,
    );
  });
});
