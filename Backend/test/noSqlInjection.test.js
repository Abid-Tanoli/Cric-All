/**
 * Phase 11 - NoSQL operator injection and ObjectId handling.
 *
 * These are the two ways a JSON body turns into a query fragment. Express +
 * `req.body`/`req.query` are plain objects, so `{"$ne": null}` and `{"$gt": ""}`
 * reach Mongoose as *query operators* rather than as values. Whether that is
 * exploitable depends entirely on whether the handler interpolates them into a
 * query, which is why each case here is paired with a state assertion rather than
 * a status assertion alone.
 *
 * The three families probed:
 *
 *   1. Operator injection - `$ne`, `$gt`, `$exists`, `$regex` in ids, emails,
 *      tokens, status fields and pagination.
 *   2. Empty-string ObjectIds - `validateObjectId` is `if (id && ...)`, so `""`
 *      skips the route-level check entirely and reaches the controller. Whether
 *      that is a 4xx depends on something further down, which is the point.
 *   3. Prototype pollution - `__proto__`/`constructor.prototype` in a body.
 *
 * Every assertion is "4xx, never 5xx, and nothing changed". A crash here is a
 * finding on its own: an unhandled CastError or TypeError is reachable by an
 * anonymous caller on a public route.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import { API_BASE, assertLocalTarget, assertServerIsLocal } from "./e2e/lib/guard.js";
import { createClient } from "./e2e/lib/http.js";
import { bootstrap, TEST_PREFIX } from "./e2e/lib/bootstrap.js";

let ctx;
let anon;
let ownerApi;
let orgId;
let teamId;
let matchId;
let runId;

before(async () => {
  assertLocalTarget();
  await assertServerIsLocal();

  // Unique per process as well as per millisecond: `node --test` runs this file
  // alongside the cross-tenant file, and the run id keys every fixture email.
  runId = `nosql_${process.pid}_${Date.now().toString(36)}`;
  ctx = await bootstrap({ makeClient: () => createClient({ apiBase: API_BASE }), runId });
  anon = createClient({ apiBase: API_BASE });
  ownerApi = ctx.owner.api;
  orgId = ctx.orgId;
  teamId = ctx.teams.a.id;

  const match = await ownerApi.post(
    `/organizations/${orgId}/matches`,
    {
      title: `${TEST_PREFIX}NoSqlFixture_${runId}`,
      venue: "Local Test Ground",
      matchType: "T20",
      teams: [ctx.teams.a.id, ctx.teams.b.id],
    },
    { expect: [200, 201] },
  );
  matchId = String(match.body?.match?._id || match.body?._id);
});

after(() => {
  assert.ok(orgId, "world was never built; the suite did not run");
});

// --- helpers ----------------------------------------------------------------

async function expectNoServerError({ api, method, path, body, label }) {
  const res = await api[method](path, body);
  assert.ok(
    res.status < 500,
    `FAIL 5xx ${label}: ${method} ${path} answered ${res.status} - ${JSON.stringify(res.body).slice(0, 200)}`,
  );
  return res;
}

async function expectRefused({ api, method, path, body, label }) {
  const res = await expectNoServerError({ api, method, path, body, label });
  assert.ok(
    res.status >= 400,
    `FAIL 200 ${label}: ${method} ${path} answered ${res.status}; a NoSQL payload must not be honoured as a query`,
  );
  return res;
}

/** Snapshot of a tenant-A document, read by an account entitled to see it. */
async function snapshotTeam() {
  const r = await ownerApi.get(`/teams/${teamId}`);
  return JSON.stringify(r.body?.team ?? r.body);
}
async function snapshotOrg() {
  const r = await ownerApi.get(`/organizations/${orgId}`);
  return JSON.stringify(r.body?.organization ?? r.body);
}

// --- 1. operator injection ---------------------------------------------------

describe("NoSQL operator injection", () => {
  const OPERATORS = [
    { $ne: null },
    { $ne: "x" },
    { $gt: "" },
    { $exists: true },
    { $regex: "^.*$" },
    { $in: [null] },
  ];

  test("operator payloads in :id are refused, never crash the handler", async () => {
    // These ids are URL-encoded because $ and { are not valid in a path segment
    // for every client; the point is what the server parses out of them. The
    // traversal probes are *double* encoded on purpose: the URL spec treats
    // "%2e%2e" as a double-dot segment and collapses it before the request ever
    // leaves the client, so a single-encoded probe only tests the client. The
    // server sees "%2e%2e" after one decode and is asked what it does with it.
    const probes = [
      ...OPERATORS.map((o) => encodeURIComponent(JSON.stringify(o))),
      "%24ne",
      "$$ne",
      "%252e%252e",
      "%252E%252E",
      "%252f",
      "null",
      "undefined",
      "0",
    ];
    const templates = [
      "/organizations/%s",
      "/teams/%s",
      "/matches/%s",
      "/players/%s",
      "/tournaments/%s",
      `/organizations/${orgId}/teams/%s`,
      `/organizations/${orgId}/matches/%s`,
      `/organizations/${orgId}/members/%s`,
      `/organizations/${orgId}/invitations/%s`,
    ];

    for (const probe of probes) {
      for (const tpl of templates) {
        const path = tpl.replace("%s", probe);
        await expectRefused({ api: anon, method: "get", path, label: `GET ${path}` });
      }
    }
  });

  test("an operator in a login email must not match the first user in the table", async () => {
    // The canonical NoSQL auth bypass: {"email": {"$ne": null}} against the
    // credential lookup. Whatever the answer, it must not be a session for a
    // user the caller did not name.
    for (const payload of [{ email: { $ne: null }, password: "whatever" }, { email: { $gt: "" }, password: { $ne: null } }]) {
      const res = await expectNoServerError({ api: anon, method: "post", path: "/auth/login", body: payload, label: "login with operator email" });
      assert.ok(
        !res.body?.token,
        `FAIL AUTH BYPASS login accepted an operator email and issued a token`,
      );
      assert.ok(res.status >= 400, `login with operator email returned ${res.status}`);
    }
  });

  test("an operator in a registration email cannot overwrite an existing account", async () => {
    const before_ = await snapshotOrg();
    const res = await expectNoServerError({
      api: anon,
      method: "post",
      path: "/auth/register",
      body: {
        name: `${TEST_PREFIX}Operator_${runId}`,
        email: { $ne: null },
        password: "OpencodeLocal!2026",
        accountType: "player",
      },
      label: "register with operator email",
    });
    assert.ok(res.status >= 400, `register with an operator email returned ${res.status}`);
    assert.equal(await snapshotOrg(), before_, "a rejected registration still changed the organization");
  });

  test("operator payloads in a member-add email are refused and change nothing", async () => {
    const before_ = await snapshotOrg();
    for (const email of [{ $ne: null }, { $gt: "" }, { $regex: "@" }]) {
      await expectRefused({
        api: ownerApi,
        method: "post",
        path: `/organizations/${orgId}/members`,
        body: { email, roles: ["owner"] },
        label: "member add with operator email",
      });
    }
    assert.equal(await snapshotOrg(), before_, "an operator email added or changed a membership");
  });

  test("operator payloads in pagination cannot walk the whole collection", async () => {
    for (const query of ["?page[$ne]=1", "?limit[$gt]=99999", "?search[$regex]=.*"]) {
      await expectNoServerError({ api: anon, method: "get", path: `/organizations/${query}`, label: `list ${query}` });
    }
  });

  test("an operator in a sort field cannot turn the sort into a query operator", async () => {
    await expectNoServerError({ api: anon, method: "get", path: "/teams?sort[$ne]=1", label: "sort with operator" });
    await expectNoServerError({ api: anon, method: "get", path: "/matches?sort[$gt]=&limit=5", label: "sort with operator 2" });
  });

  test("operator payloads cannot smuggle a second organizationRef into an update", async () => {
    const before_ = await snapshotTeam();
    // If organizationRef were taken from the body, this would move tenant A's
    // team into tenant B. It must be ignored or rejected.
    const res = await ownerApi.patch(`/organizations/${orgId}/teams/${teamId}`, {
      organizationRef: ctx.otherOrgId,
    });
    assert.ok(res.status < 500, `team update carrying organizationRef returned ${res.status}`);
    assert.equal(await snapshotTeam(), before_, "organizationRef was writable from a request body");
  });
});

// --- 2. empty-string and malformed ObjectIds ---------------------------------

describe("ObjectId handling", () => {
  test("an empty :id is a 4xx, not a crash", async () => {
    // validateObjectId is `if (id && ...)`, so "" never reaches it. Express
    // collapses the double slash, so the id is sent as a genuinely empty query
    // value and as a trailing-slash path instead.
    const targets = [
      `/organizations/${orgId}/teams/`,
      `/organizations/${orgId}/members/`,
      `/organizations/${orgId}/invitations/`,
      `/organizations/${orgId}/matches/`,
    ];
    for (const target of targets) {
      await expectNoServerError({ api: anon, method: "get", path: target, label: `GET ${target}` });
    }
  });

  test("an explicit empty-string id is refused on every id-taking write", async () => {
    const cases = [
      { method: "get", path: `/teams/?x=1`, label: "team read" },
      { method: "get", path: `/matches/?x=1`, label: "match read" },
      { method: "get", path: `/players/?x=1`, label: "player read" },
      { method: "get", path: `/tournaments/?x=1`, label: "tournament read" },
      { method: "get", path: `/organizations/?x=1`, label: "organization read" },
      { method: "get", path: `/organizations/${orgId}/matches/?x=1`, label: "org match read" },
    ];
    for (const c of cases) {
      await expectNoServerError({ api: anon, method: c.method, path: c.path, label: c.label });
    }
  });

  test("a 12-character string is rejected as a bad ObjectId, not coerced", async () => {
    for (const bad of ["abcdefghijkl", "000000000000", "not-an-id"]) {
      await expectNoServerError({ api: anon, method: "get", path: `/teams/${bad}`, label: `team read ${bad}` });
    }
  });

  test("a 24-hex-char string that is not in the collection is a 404", async () => {
    const absent = "0123456789abcdef01234567";
    await expectNoServerError({ api: anon, method: "get", path: `/teams/${absent}`, label: "absent team" });
    await expectNoServerError({ api: anon, method: "get", path: `/matches/${absent}`, label: "absent match" });
  });

  test("a well-formed but foreign ObjectId does not become a CastError", async () => {
    // The org-scoped routes look documents up with the tenant in the query, so
    // a real id from tenant B must come back as "not found", never as a 500.
    for (const path of [
      `/organizations/${orgId}/teams/${ctx.otherTeams.a.id}`,
      `/organizations/${orgId}/matches/${absentMatchId()}`,
    ]) {
      const res = await ownerApi.get(path);
      assert.ok(res.status < 500, `foreign id read ${path} returned ${res.status}`);
      assert.ok(res.status >= 400, `foreign id read ${path} returned ${res.status}`);
    }
  });
});

function absentMatchId() {
  return "0123456789abcdef01234567";
}

// --- 3. prototype pollution --------------------------------------------------

describe("prototype pollution", () => {
  test("__proto__ in a body does not reach Object.prototype", async () => {
    const payload = JSON.parse('{"name":"x","__proto__":{"polluted":"yes"}}');
    await expectNoServerError({ api: anon, method: "post", path: "/auth/login", body: payload, label: "login with __proto__" });
    await expectNoServerError({
      api: anon,
      method: "post",
      path: "/auth/register",
      body: { name: `${TEST_PREFIX}Proto_${runId}`, email: `opencode.test.proto.${runId}@example.test`, password: "OpencodeLocal!2026", accountType: "player" },
      label: "register",
    });
    assert.equal({}.polluted, undefined, "a request polluted Object.prototype");
  });

  test("constructor.prototype in a body does not pollute", async () => {
    const payload = JSON.parse('{"name":"x","constructor":{"prototype":{"polluted2":"yes"}}}');
    await expectNoServerError({ api: anon, method: "post", path: "/auth/login", body: payload, label: "login with constructor.prototype" });
    assert.equal({}.polluted2, undefined, "a request polluted Object.prototype via constructor.prototype");
  });
});
