# Phase 11 - Cross-Tenant Authorization & Injection Audit (Local Only)

Scope: local `cric-all-e2e` on loopback. The guard verified the server was
PID-local on port 5000 with only loopback Mongo peers before any run. No remote
system was contacted and `Backend/.env` was never read.

## Result

| Suite | Before | After |
| --- | --- | --- |
| Backend (`npm test`) | 220 tests, 206 pass, 14 skipped, 0 fail | **265 tests, 265 pass, 0 skipped, 0 fail** |
| E2E (`npm run test:e2e`) | 78 pass, 0 fail, 7/7 scenarios | **78 pass, 0 fail, 7/7 scenarios** |

New coverage: 45 tests in two suites.

| Suite | Tests | Purpose |
| --- | --- | --- |
| `test/crossTenant.test.js` | 31 | 7 principals x 7 resources x 4 verbs |
| `test/noSqlInjection.test.js` | 14 | operator injection, ObjectId handling, prototype pollution |

**Findings requiring a code fix: none.** No IDOR and no attacker-reachable 5xx
was found in the audited surface, so nothing in `src/` was changed. That is a
negative result and is reported as such rather than padded with hardening.

## The 14 previously-skipped tests were not a real baseline

The recorded baseline of `206 pass / 14 skipped` was misleading. All 14 skips are
in `auth-api.test.js` and are gated on a live server at
`process.env.BASE_URL || "http://localhost:5000/api"`; the server simply was not
running when that number was taken. With it up, the pre-existing suite is
`220 pass / 0 skipped`, and `265 = 220 + 45` confirms the security suites are
additive with no regressions.

## Two harness bugs this audit surfaced

**1. Cross-account verification-token theft (fixed, real).**
`bootstrap.js` matched the *first* `verify-email` link in new log output. The
console mailer is one shared log, so as soon as two suites bootstrap
concurrently, each process consumes the other's single-use link and the loser
fails with `VERIFY_TOKEN_INVALID` - a flake that looks like a server bug and
isn't one. Every mail line carries the recipient in its `to` field, so
`waitForToken` now takes the address it is waiting for. This affects the E2E
runner too, not just the new suites.

**2. `probe@example.test` admin removed.**
An earlier probe registered a superadmin through the unauthenticated
`POST /api/admin/register`, and that endpoint cannot be undone through the API:
`DELETE /api/admin/:id` refuses to remove the caller. The local Admin collection
now holds one account, `opencode.test.admin.<runId>@example.test`. A non-prefixed
fixture is gone.

The registration window itself is re-opened by a direct write in
`test/helpers/localFixtures.js`. It is hardcoded to the disposable loopback
database, has no environment override, and writes **fixtures only** - never a
result. Every assertion in both suites goes through the HTTP API.

## Open finding: unauthenticated first-admin bootstrap (not fixed)

`POST /api/admin/register` is unauthenticated and unthrottled. When the Admin
collection is empty it creates the first administrator, and that account is
granted `superadmin`. It then closes permanently.

- **Impact:** on a fresh or wiped deployment, whoever reaches the endpoint first
  owns the platform. There is no rate limiter on `/api/admin/*`.
- **Why it is not fixed here:** a first-run bootstrap is presumably deliberate,
  and closing it correctly needs an environment-level seed or an out-of-band
  setup step. That is a deployment decision, not a local test fix, so it is
  escalated rather than silently changed.
- **Suggested fix:** rate-limit the route, restrict it to loopback or a
  `SETUP_TOKEN`, and seed the first admin from configuration instead of from a
  public POST.

## Hardening note (latent, not exploitable)

`Backend/src/middleware/validateObjectId.js` is `if (id && ...)`, so an empty
string skips the route-level check entirely and reaches the controller. The
audited endpoints still answer 4xx - the global error handler maps Mongoose
`CastError` to 400, and org-scoped lookups miss and 404 - so this is not
reachable as a crash. Tightening the guard to `typeof id === "string"` would
remove the reliance on downstream luck.

## Notable design confirmations

The org-scoped controllers genuinely scope their lookups rather than trusting the
URL, which is what makes the tenant boundary hold:
`orgTeamsController.js` uses `Team.findOne({ _id, organizationRef: req.org._id })`
and `orgMatchesController.js` does the same for matches and events. So another
tenant's document is a 404, and `organizationRef` can never be moved by a request
body - both asserted directly.

`GET /organizations/:id`, `/teams/:id`, `/matches/:id` and `/tournaments/:id`
are public by design. Those cells in the matrix record "allowed" rather than
asserting a privacy rule the product never made. A suspended account still reads
them, which is correct: suspension is an authentication verdict, not a visibility
one, and that distinction is now pinned by a test.

`POST /organizations/:id/invitations` has no update verb for anybody. Invitations
are immutable and can only be revoked, and a test asserts that no principal -
including the owner and a platform admin - can PATCH one, so a future
owner-only PATCH cannot arrive unnoticed.

## How a denial is judged

A 4xx alone is not enough, because a route can reject a request and still perform
the mutation. Every denied write is asserted twice:

1. the response is 4xx (and never 5xx), and
2. the victim document, re-read through an account entitled to see it, is
   byte-identical afterwards.

Private reads are asserted by payload, not status: the response body must not
contain the victim tenant's private identifiers. 404 is preferred over 403 for
another tenant's document, since its existence is not the caller's business;
403 is accepted because it is still a refusal, 2xx never is.

## Reproduce

```
npm test            # 265 pass
npm run test:e2e    # 78 pass, 7/7 scenarios, guard enforced
```

Both suites need the local backend up on `127.0.0.1:5000` with
`MAIL_DRIVER=console`, and read `E2E_BACKEND_LOG` (default
`%TEMP%\opencode\local-backend\backend.log`).
