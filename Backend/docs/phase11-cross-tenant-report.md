# Phase 11 - Cross-Tenant Authorization & Injection Audit (Local Only)

Scope: local `cric-all-e2e` on loopback. The guard verified the server was
PID-local on port 5000 with only loopback Mongo peers before any run. No remote
system was contacted and `Backend/.env` was never read.

## Result

| Suite | Before | After |
| --- | --- | --- |
| Backend (`npm test`) | 220 tests, 206 pass, 14 skipped, 0 fail | **306 tests, 306 pass, 0 skipped, 0 fail** |
| E2E (`npm run test:e2e`) | 78 pass, 0 fail, 7/7 scenarios | **78 pass, 0 fail, 7/7 scenarios** |

New coverage: 86 tests in four suites.

| Suite | Tests | Purpose |
| --- | --- | --- |
| `test/crossTenant.test.js` | 39 | 7 principals x 7 resources x 4 verbs |
| `test/noSqlInjection.test.js` | 14 | operator injection, ObjectId handling, prototype pollution |
| `test/adminBootstrap.test.js` | 18 | first-admin flag gate, atomic claim, concurrent registration |
| `test/validateObjectId.test.js` | 15 | empty/whitespace/malformed id parameters, no 500s |

**Findings requiring a code fix: none.** No IDOR and no attacker-reachable 5xx
was found in the audited surface, so nothing in `src/` was changed. That is a
negative result and is reported as such rather than padded with hardening.

## The 14 previously-skipped tests were not a real baseline

The recorded baseline of `206 pass / 14 skipped` was misleading. All 14 skips are
in `auth-api.test.js` and are gated on a live server at
`process.env.BASE_URL || "http://localhost:5000/api"`; the server simply was not
running when that number was taken. With it up, the pre-existing suite is
`220 pass / 0 skipped`, and `306 = 220 + 86` confirms the security suites are
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

## Closed finding: unauthenticated first-admin bootstrap

`POST /api/admin/register` is unauthenticated and public. When the Admin
collection is empty it creates the first administrator and grants it
`superadmin`, then closes permanently.

- **Impact as found:** on a fresh or wiped deployment, whoever reached the
  endpoint first owned the platform, and there was no rate limiter on
  `/api/admin/*`.
- **Now fixed, three ways:**
  1. `ALLOW_ADMIN_REGISTER` gates the route and defaults to **off**. Absent,
     empty, `false`, `0` and `no` all mean off, so a typo fails closed. The flag
     is read from the *server's* environment, so a test process cannot enable it
     for an already-running server.
  2. The route is rate limited to 10 per 15 minutes, alongside limits on the
     other `/api/admin/*` credential routes.
  3. The claim itself is atomic. A unique sparse index `uniq_admin_bootstrap_claim`
     arbitrates it, so two simultaneous registrations cannot both win - a
     `countDocuments()` check could not promise that, because both requests
     observe the empty collection before either writes. The duplicate key is
     translated into the same 403 as every other closed case, so the endpoint
     cannot be used as an existence oracle.
- **The supported procedure is now out-of-band:** `npm run admin:create`, which
  claims the same index from a script and never opens an HTTP window. See
  `docs/first-admin-bootstrap.md`.
- Covered by `test/adminBootstrap.test.js` (18 tests), including a concurrency
  test that fires simultaneous registrations at an empty collection.

## Closed finding: empty-string ObjectId parameters

`Backend/src/middleware/validateObjectId.js` was `if (id && ...)`, so an empty
string skipped the route-level check entirely and reached the controller. The
audited endpoints still answered 4xx - the global error handler maps Mongoose
`CastError` to 400, and org-scoped lookups miss and 404 - so this was never
reachable as a crash, but it did rely on downstream luck.

The guard is now `typeof id === "string"` plus a trimmed-emptiness check, so an
empty, whitespace-only or missing parameter is refused at the route. Whitespace
matters: `" "` was previously truthy, so it passed the old check and then failed
the `ObjectId` cast. Covered by `test/validateObjectId.test.js` (15 tests),
including a control that demonstrates the same route returning 500 without the
middleware, so the test is known to be load-bearing.

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

## The cell matrix: 7 resources x 4 verbs x 7 principals

196 cells. Every cell is either **A** (ASSERTED - a test makes the request and
checks the verdict) or **N** (N/A - the cell cannot express a rule, or asserting
it would consume a fixture the rest of the suite measures against). Every N
carries its reason. There is no third state.

How the original 31 tests left 37 cells uncovered without saying so: they
attacked a victim from *outside* its tenant and used the entitled readers only as
snapshot ground truth. A snapshot helper tolerates a 403 - it just stringifies the
error body - so "the owner was locked out" and "the snapshot is working" produced
identical output. Widening any `requireOrgPermission` on a read route to
`requireOrgMembership` would also have stayed green.

| Coverage | Cells |
| --- | --- |
| ASSERTED before this round | 133 |
| Asserted nowhere and marked N/A nowhere | **37** |
| ASSERTED now | **170** |
| N/A with a stated reason | **26** |
| Total | 196 |

The 37 recovered cells are filled by 8 new tests appended to
`test/crossTenant.test.js` (31 -> 39). They were appended, not interleaved, so
every snapshot-based denial above has already run against an intact victim before
the new permitted writes execute.

Legend for the N cells that recur:

- **destructive** - the success path would delete a fixture the file's snapshots
  read. Asserting a denial is safe; asserting the success is not.
- **public** - the route has no tenant dimension, so there is no boundary to
  cross. Cross-referenced to the suite that does own it.
- **redundant** - the same gate is already asserted for this actor on another
  route in the same test; a per-cell copy would add no coverage.
- **no route** - the verb does not exist for this resource.

### 1. Organization
Read `GET /organizations/:id` and its private surfaces `/members`, `/invitations`,
`/audit-log`, `/teams/manage`, `/access`, `/overview`. Create `POST /organizations`.
Update `PUT /organizations/:id`. Delete `DELETE /organizations/:id`.

| Verb | anonymous | verified | orgAMember | orgBMember | owner | admin | suspended |
| --- | --- | --- | --- | --- | --- | --- | --- |
| read | **A** private surfaces leak-checked; base profile is public by design | **A** same | **A** *new* roster + overview 200; invitations / audit-log / teams-manage 403 | **A** | **A** *new* all six 200 | **A** *new* all six 200 | **A** private surfaces refused; base profile still 200 |
| create | **A** 401 | **A** *new* `player` account type refused | **A** *new* | **A** *new* | **A** bootstrap fixture | **N** writes a Membership whose `user` is an Admin `_id` - see the observation below, not pinned as correct | **A** *new* |
| update | **A** refused, victim intact | **A** | **A** no `manage_org` | **A** | **A** permitted | **A** *new* permitted | **A** refused |
| delete | **A** refused, victim intact | **A** | **A** | **A** | **N** destructive | **N** destructive | **A** |

### 2. Membership
Read `GET /organizations/:id/members`. Create `POST .../members`. Update
`PATCH .../members/:userId`. Delete `DELETE .../members/:userId`.

| Verb | anonymous | verified | orgAMember | orgBMember | owner | admin | suspended |
| --- | --- | --- | --- | --- | --- | --- | --- |
| read | **A** | **A** | **A** *new* 200 - any active member | **A** | **A** *new* | **A** *new* | **A** |
| create | **A** | **A** | **A** | **A** | **A** | **A** *new* | **A** |
| update | **A** | **A** | **A** | **A** + dedicated escalation test | **A** permitted | **A** *new* permitted | **A** |
| delete | **A** | **A** | **A** | **A** + dedicated eviction test | **N** destructive | **N** destructive | **A** |

### 3. Invitation
Read `GET /organizations/:id/invitations`. Create `POST .../invitations`.
Delete `DELETE .../invitations/:invitationId`.

| Verb | anonymous | verified | orgAMember | orgBMember | owner | admin | suspended |
| --- | --- | --- | --- | --- | --- | --- | --- |
| read | **A** | **A** | **A** *new* 403 - `score_handler` lacks `invite_members` | **A** | **A** *new* | **A** *new* | **A** |
| create | **A** | **A** | **A** | **A** | **A** bootstrap | **N** redundant | **A** |
| update | **N** no route | **N** no route | **N** no route | **N** no route | **N** no route | **N** no route | **N** no route |
| delete | **A** | **A** | **A** | **A** | **N** destructive | **N** destructive | **A** |

Invitations are immutable, so the update row is empty by design rather than by
omission. That is pinned explicitly: a test asserts that anonymous, the owner and
a platform admin are all refused a PATCH, so an owner-only update verb cannot
arrive later unnoticed.

### 4. Team
Read `GET /teams/:id` (public) and `GET /organizations/:id/teams/manage`
(private). Create `POST /organizations/:id/teams`. Update
`PATCH .../teams/:teamId` and `PUT /teams/:id`. Delete both.

| Verb | anonymous | verified | orgAMember | orgBMember | owner | admin | suspended |
| --- | --- | --- | --- | --- | --- | --- | --- |
| read | **A** manage view leak-checked | **A** | **A** *new* 403 on the manage view | **A** | **A** *new* | **A** *new* | **A** |
| create | **A** | **A** | **A** | **A** | **A** bootstrap | **A** *new* | **A** |
| update | **A** both routes | **A** both | **A** both | **A** both + confused-deputy variant | **A** tenant-scoped permitted | **A** *new* tenant + global | **A** |
| delete | **A** | **A** | **A** | **A** | **N** destructive | **N** destructive | **A** |

The confused-deputy variant is the strongest case in the row: a tenant-B member
aiming at a tenant-A team through *tenant B's own* org id, where every id is well
formed and every middleware check the caller does pass, does pass.

### 5. Player
Read `GET /players/:id`. Create `POST /players`. Update `PUT /players/:id`.
Delete `DELETE /players/:id`.

| Verb | anonymous | verified | orgAMember | orgBMember | owner | admin | suspended |
| --- | --- | --- | --- | --- | --- | --- | --- |
| read | **N** public | **N** public | **N** public | **N** public | **N** public | **N** public | **N** public |
| create | **A** *new* 401 | **A** permitted; team smuggling refused | **A** | **A** | **A** bootstrap creator | **A** asserted in `playerSelfService.test.js` | **A** *new* 403 suspended |
| update | **A** | **A** | **A** | **A** | **A** permitted, the creator | **A** *new* | **A** |
| delete | **A** | **A** | **A** | **A** | **A** | **N** destructive | **A** |

The read row is empty because a player profile is a public claim about a person,
not tenant-private data. The property that *is* private - that the response must
not disclose who owns the profile - is asserted in `playerSelfService.test.js`.

### 6. Match
Read `GET /matches/:id` (public) and `GET /organizations/:id/matches` (private).
Create `POST /organizations/:id/matches`. Update `PATCH .../matches/:matchId` and
`PUT /matches/:id`. Delete both.

| Verb | anonymous | verified | orgAMember | orgBMember | owner | admin | suspended |
| --- | --- | --- | --- | --- | --- | --- | --- |
| read | **A** tenant list leak-checked | **A** | **A** | **A** | **A** *new* | **A** *new* | **A** |
| create | **A** | **A** | **A** | **A** | **A** bootstrap | **N** redundant | **A** |
| update | **A** both routes | **A** both | **A** both | **A** both + `score_match` refused | **A** permitted | **A** *new* global | **A** |
| delete | **A** | **A** | **A** | **A** | **A** *new* throwaway fixture | **A** *new* second throwaway fixture, global route | **A** |

The `score_match` refusal is the one cell that proves the tenant is resolved from
`Match.organizationRef` and not from a client-supplied org id.

Two throwaway matches exist so that the owner path (`PATCH`-style, org-scoped
`DELETE`) and the platform-admin path (global `DELETE`) can both be proven
permitted without one consuming the other's fixture.

### 7. Tournament
Read `GET /tournaments/:id`. Create `POST /tournaments`. Update `PUT`. Delete
`DELETE`. Platform-wide, not tenant-owned: the only entitled principal is a
platform admin, on every verb.

| Verb | anonymous | verified | orgAMember | orgBMember | owner | admin | suspended |
| --- | --- | --- | --- | --- | --- | --- | --- |
| read | **A** public for all seven | **A** | **A** | **A** | **A** | **A** | **A** |
| create | **A** *new* 401 | **A** *new* | **A** *new* | **A** *new* | **A** *new* a club owner still cannot mint one | **A** bootstrap + *new* throwaway | **A** *new* |
| update | **A** | **A** | **A** | **A** | **A** | **A** *new* | **A** |
| delete | **A** | **A** | **A** | **A** | **A** | **A** *new* throwaway | **A** |

This is the only resource with no N cell: every principal can attempt every verb,
and every principal has a verdict.

## Observation (not fixed, not a test failure)

`POST /api/organizations` by a platform admin appears to write a corrupt owner
row. `authMiddleware.protect` resolves an Admin-collection token into
`req.user = <Admin document>`, and `organizationController.createOrganization`
then calls `upsertMembership({ user: req.user._id, ... })` unconditionally - the
`!platform` branch that rewrites `owner`/`createdBy` to `req.user._id` has no
counterpart that skips the membership write. The resulting Membership would carry
an Admin `_id` where `Membership.user` is meant to reference a `User`.

This is why the organization/create x admin cell is N rather than A. It was found
while filling the matrix, is a data-integrity issue rather than an authorization
one, and is **not** asserted as correct behaviour here. Fixing it means editing
`src/`, which needs a backend restart - see the round notes.

## Reproduce

```
npm test            # 306 pass
npm run test:e2e    # 78 pass, 7/7 scenarios, guard enforced
```

Both suites need the local backend up on `127.0.0.1:5000` with
`MAIL_DRIVER=console`, and read `E2E_BACKEND_LOG` (default
`%TEMP%\opencode\local-backend\backend.log`).
