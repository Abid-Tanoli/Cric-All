/**
 * POST /api/admin/register hardening.
 *
 * The route used to be an unauthenticated, unthrottled POST that minted a
 * superadmin whenever the Admin collection happened to be empty. That is a
 * race for the whole platform: on a fresh deploy, whoever reaches it first owns
 * the Admin app. These tests pin the replacement behaviour, and the concurrency
 * case is the one that matters most - a `countDocuments() > 0` check cannot
 * prevent two simultaneous requests from both seeing an empty collection.
 *
 * Style follows the existing suites: a real throwaway MongoDB, controllers
 * invoked with mockReq/mockRes, plus a loopback-only Express app for the cases
 * that need real routing (the rate limiters).
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";

import test, { before, after, beforeEach, afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import Admin from "../src/models/Admin.js";
import { registerAdmin, adminRegistrationEnabled } from "../src/controllers/adminController.js";
import adminRouter from "../src/routes/adminRoutes.js";

let mongod;

const STRONG_PASSWORD = "OpencodeLocal!2026";

// The controller reads this from the environment at call time, which is what lets
// these tests flip it per case.
function setFlag(value) {
  if (value === undefined) delete process.env.ALLOW_ADMIN_REGISTER;
  else process.env.ALLOW_ADMIN_REGISTER = value;
}

function registerRequest({ name = "Bootstrap Admin", email = "opencode.test.admin@example.test", password = STRONG_PASSWORD } = {}) {
  return mockReq({ body: { name, email, password } });
}

const call = (req) => {
  const res = mockRes();
  return registerAdmin(req, res).then(() => res);
};

before(async () => {
  mongod = await startTestDb();
});

after(async () => {
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Admin.deleteMany({});
  setFlag(undefined);
});

afterEach(() => {
  setFlag(undefined);
});

// --- a) the feature flag ------------------------------------------------------

describe("ALLOW_ADMIN_REGISTER", () => {
  test("is off unless explicitly enabled", () => {
    setFlag(undefined);
    assert.equal(adminRegistrationEnabled(), false);
    setFlag("");
    assert.equal(adminRegistrationEnabled(), false);
    setFlag("false");
    assert.equal(adminRegistrationEnabled(), false);
    setFlag("0");
    assert.equal(adminRegistrationEnabled(), false);
    setFlag("no");
    assert.equal(adminRegistrationEnabled(), false);
    // A typo must fail closed, never open.
    setFlag("ture");
    assert.equal(adminRegistrationEnabled(), false);
  });

  test("recognises the affirmative spellings", () => {
    for (const v of ["true", "TRUE", " true ", "1", "yes"]) {
      setFlag(v);
      assert.equal(adminRegistrationEnabled(), true, `expected ${JSON.stringify(v)} to enable registration`);
    }
  });

  test("flag off + empty database still refuses", async () => {
    setFlag(undefined);
    assert.equal(await Admin.countDocuments(), 0, "precondition: the collection must be empty");

    const res = await call(registerRequest());

    assert.equal(res.statusCode, 403);
    assert.equal(await Admin.countDocuments(), 0, "a refused registration created an admin anyway");
  });

  test("flag off refuses even on a completely empty database", async () => {
    // This is the case that used to hand out a superadmin.
    setFlag("false");
    const res = await call(registerRequest({ email: "opencode.test.sneaky@example.test" }));
    assert.equal(res.statusCode, 403);
    assert.equal(await Admin.countDocuments(), 0);
  });
});

// --- b) + g) happy path and the dead branch ---------------------------------

describe("bootstrap success", () => {
  test("flag on + empty database creates a superadmin", async () => {
    setFlag("true");

    const res = await call(registerRequest({ email: "opencode.test.first@example.test" }));

    assert.equal(res.statusCode, 201);
    assert.ok(res.body?.token, "a 201 must carry a token");
    assert.equal(res.body?.user?.role, "superadmin");
    assert.equal(await Admin.countDocuments(), 1);

    const stored = await Admin.findOne({ email: "opencode.test.first@example.test" });
    assert.equal(stored.role, "superadmin");
    // The claim must not be selectable through a normal query.
    assert.equal(stored.bootstrapClaim, undefined);
  });

  test("the role can never be downgraded by the request body", async () => {
    setFlag("true");
    const res = await call(mockReq({ body: { name: "X", email: "opencode.test.role@example.test", password: STRONG_PASSWORD, role: "admin" } }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.user.role, "superadmin", "the bootstrap account was not a superadmin");
    assert.equal((await Admin.findOne({ email: "opencode.test.role@example.test" })).role, "superadmin");
  });

  test("the created password is bcrypt hashed, never stored in the clear", async () => {
    setFlag("true");
    await call(registerRequest({ email: "opencode.test.hash@example.test" }));
    const stored = await Admin.findOne({ email: "opencode.test.hash@example.test" }).select("+password");
    assert.notEqual(stored.password, STRONG_PASSWORD);
    assert.ok(stored.password.startsWith("$2"), "the password is not a bcrypt hash");
  });

  test("an admin already existing refuses regardless of the flag", async () => {
    await Admin.create({ name: "Existing", email: "opencode.test.existing@example.test", password: STRONG_PASSWORD });

    for (const flag of ["true", undefined, "false"]) {
      setFlag(flag);
      const res = await call(registerRequest({ email: "opencode.test.second@example.test" }));
      assert.equal(res.statusCode, 403, `flag ${String(flag)} should not reopen registration`);
      assert.equal(await Admin.countDocuments(), 1);
    }
  });

  test("the refusal message is identical in every closed case", async () => {
    // Otherwise the endpoint itself becomes an oracle: 403-with-one-text means
    // "no admins yet", 403-with-another means "flag off", and either tells an
    // attacker which half of the lock is missing.
    setFlag(undefined);
    const noFlag = await call(registerRequest({ email: "opencode.test.a@example.test" }));

    await Admin.create({ name: "Existing", email: "opencode.test.existing@example.test", password: STRONG_PASSWORD });
    setFlag("true");
    const hasAdmin = await call(registerRequest({ email: "opencode.test.b@example.test" }));

    assert.equal(noFlag.statusCode, hasAdmin.statusCode);
    assert.deepEqual(noFlag.body, hasAdmin.body);
  });

  test("validation still runs and still precedes creation", async () => {
    setFlag("true");
    for (const body of [
      { name: "X", email: "opencode.test.v1@example.test" },
      { name: "X", password: STRONG_PASSWORD },
      { name: "X", email: "opencode.test.v2@example.test", password: "short" },
    ]) {
      const res = await call(mockReq({ body }));
      assert.equal(res.statusCode, 400, `expected 400 for ${JSON.stringify(Object.keys(body))}`);
    }
    assert.equal(await Admin.countDocuments(), 0);
  });
});

// --- c) the race --------------------------------------------------------------

describe("concurrent bootstrap", () => {
  test("two simultaneous requests create exactly one admin", async () => {
    setFlag("true");
    const ATTEMPTS = 8;

    // Every request passes the countDocuments() check before any of them writes,
    // which is precisely the interleaving that used to produce two superadmins.
    const results = await Promise.all(
      Array.from({ length: ATTEMPTS }, (_, i) =>
        call(registerRequest({ name: `Racer ${i}`, email: `opencode.test.race${i}@example.test` })),
      ),
    );

    const created = results.filter((r) => r.statusCode === 201);
    const refused = results.filter((r) => r.statusCode === 403);

    assert.equal(created.length, 1, `expected exactly one 201, got ${created.length}`);
    assert.equal(refused.length, ATTEMPTS - 1, "every loser must be refused, not errored");
    assert.equal(await Admin.countDocuments(), 1, "more than one admin was created");

    const stored = await Admin.findOne();
    assert.equal(stored.role, "superadmin");
    // Exactly one document may carry the claim, or the unique index is not doing
    // its job and the test above passed by luck.
    assert.equal(await Admin.countDocuments({ bootstrapClaim: "first-admin" }), 1);
  });

  test("a refusal caused by the race is a 403, never a 500", async () => {
    setFlag("true");
    const results = await Promise.all([
      call(registerRequest({ email: "opencode.test.raceA@example.test" })),
      call(registerRequest({ email: "opencode.test.raceB@example.test" })),
    ]);
    for (const r of results) {
      assert.ok(r.statusCode !== 500, `a lost race produced ${r.statusCode}`);
      assert.ok(r.statusCode === 201 || r.statusCode === 403, `unexpected ${r.statusCode}`);
    }
  });
});

// --- e) no internal detail leaks ---------------------------------------------

describe("error responses", () => {
  test("an internal failure returns a generic 500 and no driver text", async () => {
    setFlag("true");
    const original = Admin.create;
    // Force a failure whose message would be a disclosure if echoed back.
    Admin.create = async () => {
      const err = new Error("E11000 duplicate key error collection: cricall.admins index: email_1 dup key: { email: \"someone@example.com\" }");
      err.code = 11099;
      throw err;
    };
    try {
      const res = await call(registerRequest({ email: "opencode.test.boom@example.test" }));
      assert.equal(res.statusCode, 500);
      assert.deepEqual(Object.keys(res.body), ["message"]);
      assert.equal(res.body.message, "Something went wrong. Please try again.");
      const serialised = JSON.stringify(res.body);
      assert.ok(!serialised.includes("E11000"), "the duplicate key error leaked");
      assert.ok(!serialised.includes("cricall.admins"), "the collection name leaked");
      assert.ok(!serialised.includes("someone@example.com"), "the conflicting value leaked");
      assert.ok(!serialised.includes("stack"), "a stack leaked");
    } finally {
      Admin.create = original;
    }
  });
});

// --- d) rate limiting, through real routing -----------------------------------

describe("rate limiting", () => {
  let server;
  let base;

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/admin", adminRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    // Loopback only, ephemeral port.
    base = `http://127.0.0.1:${server.address().port}/api/admin`;
  });

  after(() => {
    server?.close();
  });

  const post = (path, body) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body ?? {}),
    });

  test("POST /register is throttled", async () => {
    const seen = [];
    // Well past the 10-per-15-minute allowance.
    for (let i = 0; i < 13; i += 1) {
      seen.push((await post("/register", { name: "R", email: `opencode.test.rl${i}@example.test`, password: STRONG_PASSWORD })).status);
    }
    assert.ok(seen.includes(429), `expected a 429, saw ${seen.join(",")}`);
    // The refusals must come before anything is created.
    assert.equal(await Admin.countDocuments(), 0);
  });

  test("POST /login is throttled", async () => {
    const seen = [];
    for (let i = 0; i < 24; i += 1) {
      seen.push((await post("/login", { email: "nobody@example.test", password: "wrong-password" })).status);
    }
    assert.ok(seen.includes(429), `expected a 429, saw ${seen.join(",")}`);
  });

  test("POST /forgot-password is throttled", async () => {
    const seen = [];
    for (let i = 0; i < 8; i += 1) {
      seen.push((await post("/forgot-password", { email: "nobody@example.test" })).status);
    }
    assert.ok(seen.includes(429), `expected a 429, saw ${seen.join(",")}`);
  });

  test("POST /reset-password is throttled", async () => {
    const seen = [];
    for (let i = 0; i < 13; i += 1) {
      seen.push((await post(`/reset-password/token${i}`, { password: "NewPassword!2345" })).status);
    }
    assert.ok(seen.includes(429), `expected a 429, saw ${seen.join(",")}`);
  });

  test("a throttled request carries Retry-After", async () => {
    let limited = null;
    for (let i = 0; i < 14; i += 1) {
      const res = await post("/register", { name: "R", email: "opencode.test.ra@example.test", password: STRONG_PASSWORD });
      if (res.status === 429) {
        limited = res;
        break;
      }
    }
    assert.ok(limited, "expected a 429");
    assert.ok(limited.headers.get("retry-after"), "a throttled response must carry Retry-After");
  });
});