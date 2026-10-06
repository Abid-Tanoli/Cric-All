# Task 0 Report — Phases A–E

**Date:** 2026-10-06
**Base:** `d9ceafc` (pulled from `origin/master`, no local divergence)
**Environment:** CI-faithful — `node:20.20.2` (the exact major CI uses) against
`cric-all-e2e` on `127.0.0.1:27017`, not the local Node 24 install. This choice
matters: one defect found this round only reproduces on Node < 22.

---

## Phase A — Baseline

| Suite | Result | Where |
| --- | --- | --- |
| Backend (`npm test`) | **350 pass / 0 fail** (23 suites) | Node 20 container |
| E2E (`npm run test:e2e`) | **78 pass / 0 fail / 0 divergence**, 7/7 scenarios | Node 20 container |
| Smoke (`npm run test:smoke`) | **4 pass / 0 fail** | Node 20 container |
| Frontend/Admin | `npm ci` OK, **10/10**, `npm run build` OK | Node 20 container |
| Frontend/User | `npm ci` OK, **25/25**, `npm run build` OK | Node 20 container |

Lint: Frontend/Admin 0 errors (6 warnings); Frontend/User **76 pre-existing
errors**. CI does not run lint, so this is not a red-master risk and was left
alone deliberately.

The backend figure is 350, not the 344 previously quoted — 6 tests landed after
that number was written down.

**Defect found during Phase A:** the E2E suite reported **76 pass / 1 fail** on
Node 20 (`WebSocket is not defined` in Scenario 6), not the 78/78 previously
claimed. See Phase B.

## Phase B — WIP CI fixes completed

The three items in `5789d66` ("WIP … unverified") were each checked against the
file they name, not taken on trust:

1. **Start server before tests** — `.github/workflows/ci.yml:34` starts the
   server, `:43` waits on `/api/health` with `--retry-connrefused`, `:47` runs
   `npm test`, `:55` runs `npm run test:smoke`. Correct order.
2. **vitest `socket.io-client` alias** — `Frontend/User/vitest.config.js:13`
   resolves it to `node_modules/socket.io-client`. Present.
3. **E2E log path** — `Backend/test/e2e/lib/bootstrap.js:25-26` reads
   `E2E_BACKEND_LOG`, defaulting to `backend.log`. Present.

**New fix required (this round):** `Backend/test/e2e/lib/socket.js` built
`new WebSocket(...)` from Node's **global** `WebSocket`, which only exists from
Node 22 onward. On CI's Node 20 every socket scenario threw and the suite died
in Scenario 6. The earlier 78/78 claims were measured on local Node 24 and had
never been run on the CI runtime — CI has no E2E job, so nothing would have
caught it. It now falls back to `ws`, already present as engine.io's own
transport dependency, so **no dependency was added**. Verified: 78/78 twice more,
including after a clean `npm ci`.

Not done, deliberately:

- **No lint job in CI.** Frontend/User's 76 pre-existing errors would turn
  `master` red on the first push.
- **No new CI job for E2E.** Out of the stated scope for this task; the suite
  now passes on Node 20, but CI still does not exercise it.

## Phase C — Audit-commit verification

`10d6ae9` claims in-range `npm audit fix` with no `--force`. Checked two ways:

**Static.** The `packages[""]` entry (direct dependency specs) of all three
lockfiles is byte-identical between `10d6ae9^` and `10d6ae9`, so no declared
version range moved. No commit since `10d6ae9` touches any lockfile.

**Empirical.** `npm ci` from scratch in the clean container, then full re-runs:
backend **350/350**, E2E **78/78**, both frontends `npm ci` + test + build all
green. The audit fix introduced no runtime regression.

`npm audit` today (post-fix, live counts):

| Project | Findings |
| --- | --- |
| Backend | **5** — `proxy-addr` (critical, fix available); `braces`/`chokidar`/`nodemon` (high, all via `nodemon`, fix is a semver-major bump); `xlsx` (high, no fix published) |
| Frontend/User | **4** — `vitest` (critical), `source-map-js` (high, fix available) |
| Frontend/Admin | **6** — `vitest` (critical), `react-router-dom` (moderate, fix is semver-major), `source-map-js` (high) |

`npm audit fix --force` was **never run**, per instruction. The three semver-major
upgrades (`nodemon`, `vitest`, `react-router-dom`) are each a separate decision
and are left for a later round.

## Phase D — WIP-clearing, compose fix, docs refresh

**`docker-compose.yml` was invalid YAML for compose.** `user-frontend` and
`admin-frontend` were declared at indent 0 — top-level keys *beside* `services:`
rather than inside it — so neither frontend service was part of the compose
model. Introduced by `53bc67b` and already present on the deployed `7a9cac0`.
Fixed by indenting exactly those two keys; **every other byte is untouched,
including the `5000/3000/3001` port mappings**, so a server carrying its own
port-remap patch still diffs cleanly. Verified: `docker compose config --quiet`
exits 0 and `--profile local-mongo config --services` lists all four services.

**Docs refreshed:**

- `docs/phase-status.md` — stale `HEAD = 7a9cac0` replaced; new "Task 0
  verification round" section added with the Phase A table; Phase 13 row updated
  for the compose fix; two new key findings (compose, `WebSocket`/Node 20).
- **Stale "local, uncommitted" annotations cleared.** Eight places described
  Round 5 work as uncommitted; it landed in `a6d4b60` long ago. Same for
  `docs/round5-report.md`'s status line and its "No commit / no push" constraint
  row.
- `Backend/docs/e2e-results.md` regenerated from the final verification run
  (`78 pass, 0 fail, 0 divergence`, 7/7 scenarios, 124.7s).

**Final verification before commit:** backend 350/350, E2E 78/78, smoke 4/4,
Admin 10/10 + build, User 25/25 + build — all on Node 20.

---

## Deliverable 1 — Last 13 commits in plain language

Newest first. `9a22474` is a merge and carries no files of its own.

| # | Commit | What it actually did |
| --- | --- | --- |
| 1 | `d9ceafc` | Made the E2E safety guard read `/proc` the Linux way instead of assuming a macOS layout, pointed CI's Mongo at loopback, and added unit tests that prove the guard refuses non-loopback sockets. |
| 2 | `5789d66` | Three CI repairs, committed as unverified: start the API before running tests, teach vitest where `socket.io-client` lives, and let the E2E log path be overridden. Verified in this round. |
| 3 | `a6d4b60` | The big one. All public Player/Team reads now pass one shared field whitelist, so DOB/gallery/videos/address stop leaking to anonymous callers. Team names became unique *per organisation* instead of globally (two partial unique indexes + app-level check), and `PUT /teams/:id` can no longer silently re-parent a team. `Team.isPublic` now defaults to `false`, and `GET /teams?search=` no longer overwrites the tenant filter. Includes 38 new tests and two migration scripts. |
| 4 | `1d8370c` | Trivial: a NUL byte in `validateObjectId.test.js` made git treat the whole file as binary, so it stopped diffing. Escaped it. |
| 5 | `9a22474` | Merge of Round 4B — no content of its own. |
| 6 | `fc6d785` | Moved CricAPI calls behind the backend (`VITE_CRICAPI_KEY` removed from the browser bundle), documented admin registration, and added the deployment matrix, `DEPLOYMENT.md`, and `CONTRIBUTING.md`. |
| 7 | `10d6ae9` | In-range `npm audit fix` across three lockfiles: backend 12→1, user 23→2, admin 17→4 advisories. No `--force`, no declared version range changed (verified in Phase C). |
| 8 | `b42e235` | One line: allow `mongodb-memory-server`'s install script so the test-only dependency can provision its own Mongo. |
| 9 | `0bae1c3` | Hardened admin bootstrap — registration gating, a `validateObjectId` middleware so malformed ids 400 instead of 500, and `createAdmin` plus its tests. Committed as not fully verified. |
| 10 | `623e9d2` | Phase 11 tests: cross-tenant isolation and NoSQL-injection cases, plus a token fix in the test harness so they exercise real permissions. |
| 11 | `32566a7` | Made the E2E runner report partial runs honestly — `E2E_ONLY` was parsed wrong and a filtered run could masquerade as a full one. Fixed and re-verified 78/78. |
| 12 | `cbb3886` | `docs/pre-launch-rotation-checklist.md` — the pre-launch credential rotation checklist. |
| 13 | `ccdc784` | Round 3 fixes: scoring guards honoured `score_match`, `ScoringEngine` corrections backed by an independent tally, orphaned-invitation cleanup, and the matching E2E helpers. |

## Deliverable 2 — Deploy checklist

Env var **names only**. No values, and none belong in the repo. The full
inventory with descriptions is `Backend/.env.example`; `DEPLOYMENT.md` has the
per-service setup and is the operative guide — this is the release gate that
sits in front of it.

### 1. Backend — required

```text
NODE_ENV=production
MONGO_URL=…                      # MONGODB_URI and MONGO_URI are accepted as aliases
REQUIRE_MONGO_DB_NAME=true
JWT_SECRET=…
CORS_ORIGINS=…
ALLOW_DESTRUCTIVE_DB_SEED=false
ALLOW_PRODUCTION_DB_RESET=false
ALLOW_DB_RESET=false
PORT=…
MAIL_DRIVER=…                    # console | smtp
```

Optional but commonly needed: `CLIENT_URL`, `ADMIN_URL`, `FRONTEND_URL`,
`PUBLIC_BACKEND_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
`SMTP_PASS`, `MAIL_FROM`, `GOOGLE_CLIENT_ID`, `LOG_LEVEL`, `SENTRY_DSN`.

Never set `ALLOW_*_RESET`/`ALLOW_*_SEED` to `true` in production — they are
the guards that keep a boot-time seed from wiping real data.

### 2. Frontends — required

```text
VITE_API_URL=…                   # absolute backend base URL
VITE_SOCKET_URL=…                # absolute backend origin, no /api
```

Optional: `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_MAPS_KEY`.

### 3. Migrations — read this before running anything

Two migrations are mandatory for any upgrade from `7a9cac0` (the deployed
revision, an ancestor of `HEAD`); both came in `a6d4b60`:

```sh
# 1. Team-name uniqueness: drops the old global unique index, builds two partial ones.
node src/scripts/migrateTeamNameUniqueness.js --uri <mongodb-uri>           # dry run
node src/scripts/migrateTeamNameUniqueness.js --uri <mongodb-uri> --apply

# 2. Team publication: backfills the isPublic field.
node src/scripts/migrateSetIsPublic.js --uri <mongodb-uri>                  # report only
node src/scripts/migrateSetIsPublic.js --uri <mongodb-uri> --set-public --apply
```

> **Both scripts are loopback-locked by design and will refuse a production
> database.** Each parses the URI and throws unless the host is exactly
> `127.0.0.1`, `localhost` or `::1`
> (`migrateTeamNameUniqueness.js:80-82`, `migrateSetIsPublic.js:108-112`).
> `--allow-database <name>` relaxes **only** the database-name check — it never
> relaxes the host check. The Atlas URI in `DEPLOYMENT.md`
> (`mongodb+srv://…`) is therefore rejected on the spot.
>
> Neither script reads `.env`; the URI must be passed explicitly on the command
> line.
>
> To run them against a remote database, tunnel it onto loopback first — e.g.
> `ssh -L 27017:<cluster-host>:27017 <host>` and then pass
> `--uri mongodb://127.0.0.1:27017/<db>`. The alternative is editing the guard,
> which is a deliberate code change and should be reviewed as one. Confirm the
> tunnel reaches the intended cluster before `--apply`.

**Why each is needed — what actually breaks if you skip it:**

- **`migrateTeamNameUniqueness` (skip ⇒ Phase 4 stays half-inert).** Measured on
  a live server, not inferred:

  - The two new partial indexes *are* built automatically — `db.js:19` sets no
    `autoIndex: false` and `mongoose.get("autoIndex")` is `true`. But the model
    is compiled **lazily**: nothing builds team indexes until the first request
    touches a team route. Checking indexes immediately after boot shows only
    `_id_`, which is misleading. After one `GET /api/teams` all 17 indexes
    appear, including `organizationRef_1_name_1_unique` and
    `name_1_orgless_unique`.
  - Mongoose never drops an index it no longer declares. I created a legacy
    global `name_1` unique index (exactly what a pre-Round-5 production database
    has), restarted the app, and the index was still there.
  - With that legacy index present, two organisations writing the same team name
    fail at the database: `E11000 duplicate key error … index: name_1`. The
    application check now permits it, so the write is refused from underneath
    the app. Dropping `name_1` is the entire point of this script.

  It reports duplicates rather than merging or deleting anything — a duplicate
  name is a business decision only an operator can make. `--apply` only drops the
  obsolete index and builds the two replacements.

- **`migrateSetIsPublic` (skip ⇒ some teams stay invisible).** `listTeams`
  queries with `.lean()`, which bypasses schema defaults, and Mongo does not
  match a *missing* field against `{ isPublic: true }`. So a legacy document
  with no `isPublic` field never appears on the public list no matter what the
  schema default says. Use `--set-public`, which writes only to documents
  missing the field and never touches one that already has an opinion.
  (`--force-private` is the opposite and is destructive to visibility; `--apply`
  requires a mode, so a bare `--apply` is rejected.)

Back up first: `node src/scripts/backupDb.js`. Run both scripts dry and read the
output before `--apply`.

Conditional, only if the data shows the problem:

| Script | Trigger | Flag |
| --- | --- | --- |
| `migrateUserEmailVerification.js` | accounts predating email verification | `--apply` (grandfathers existing users by default; `--require-verification` opts in) |
| `migrateOrgMemberships.js` | org membership rows to repair | `--apply`, `--rollback` |
| `backfillEventOrganization.js` | events missing an organisation | `--apply` |
| `setOrgOwner.js` | organisations with no owner | `--apply`, `--list-unowned` |
| `auditOrgOwnership.js` | ownership audit (report only) | — |
| `cleanupOrphanedInvitations.js` | dead invitation rows | `--apply` |
| `cleanupOrphanedUploads.js` | upload files with no record | `--apply` |

### 4. Pull / rebuild / release order

```text
0. git pull on the deploy host, and confirm the working tree is clean
1. BACKUP the database (backupDb.js) — before any migration, not after
2. MIGRATE, on loopback via the tunnel described above:
     migrateTeamNameUniqueness (dry run, then --apply)
     migrateSetIsPublic        (report, then --set-public --apply)
3. BUILD the backend image and the two frontend images
4. RELEASE the backend container first; wait on GET /api/health → 200
5. RELEASE Frontend/User, then Frontend/Admin
6. SMOKE — /api/health, login, a scored delivery, a live score update,
           and a hard refresh on a deep React Router URL (SPA fallback)
           plus one cross-org duplicate team name (proves the old global
           index really was dropped, not just hidden by the app check)
7. Only then promote to production
```

Backends before frontends: the frontends fail loudly at runtime against an old
API, whereas the API tolerates old clients. Roll back in reverse (frontends,
then backend) and keep the pre-migration backup until step 6 passes.

If deploying the compose topology instead of Vercel, `docker compose config
--quiet` must exit 0 first — it did not before the Phase D fix.
