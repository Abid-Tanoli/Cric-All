# Pre-Launch Credential Rotation Checklist

Scope: every credential CricAll uses, where it is set, how to rotate it, and the
order in which rotation must happen before launch.

**No secret values appear in this document — names, locations and procedures only.**

Evidence for every row below is taken from the working tree at the time of
writing: `Backend/.env`, `Backend/.env.example`, `docker-compose.yml`,
`docker-compose.test.yml`, `DEPLOYMENT.md`,
`DEPLOYMENT_DOCKER_RENDER.md`, and `process.env` / `import.meta.env` reads across
`Backend/src`, `Frontend/User`, `Frontend/Admin` and `scripts/`.

> `Backend/.env.atlas.bak` is cited in several rows below because the compromise
> it recorded is still real. The file itself **no longer exists** — it has been
> deleted from the working tree. Its absence does not reduce the severity of the
> underlying credentials.

---

## 1. Status summary — rotate these four before launch

These four are marked **COMPROMISED — rotate before launch** because the current
values are (a) present in cleartext in the local working tree in files that have
been read, copied, shared, and backed up outside the repo, and (b) in the case of
`JWT_SECRET`, a guessable default rather than a random secret. Treat all four as
public. Do not launch with any of them in place.

| # | Credential | Env var(s) | Why it is marked compromised |
|---|---|---|---|
| 1 | MongoDB Atlas database-user password | `MONGODB_URI` / `MONGO_URL` / `MONGO_URI` | Real password in cleartext in `Backend/.env`, and it was also duplicated in `Backend/.env.atlas.bak` (now deleted). The cluster is reachable from anywhere (`0.0.0.0/0` IP allow-list, per `DEPLOYMENT_DOCKER_RENDER.md` §7), so this password is the only thing protecting production data. |
| 2 | `JWT_SECRET` | `JWT_SECRET` | A guessable placeholder default is sitting in `Backend/.env`, and it was in the `.bak` copy too. Anyone who reads the repo can forge admin and scoring tokens. |
| 3 | RapidAPI key | `RAPIDAPI_KEY` | A real, working key value in cleartext in `Backend/.env`, and in `Backend/.env.atlas.bak` (now deleted). Quota is billable and the key enables the app's live-score polling. |
| 4 | Seed / admin password | `SEED_ADMIN_PASSWORD`, `ADMIN_PASSWORD` | A real password in cleartext in `Backend/.env` and the `.bak` copy, plus an additional admin email/password pair written as a trailing comment block in the same files. The seeded `Admin` document is a `superadmin`. |

**Also rotate, lower urgency:** all other credentials in §4 that hold a real
value rather than a placeholder. A placeholder is not a compromise, but it will
silently disable the feature it belongs to, so decide per feature: fill it in
properly or leave it blank. Never leave a literal placeholder such as
`your_api_key_here` in a production env file.

### Git history: no secret was ever committed, so do not rewrite it

Verified against all refs, not just the current branch:

- `Backend/.env` and `Backend/.env.atlas.bak` — **never committed.** Confirmed by
  `git log --all --diff-filter=A` returning nothing for either path. `.gitignore`
  excludes `.env` and `.env.*` (keeping only `!.env.example`).
- `Frontend/User/.env` and `Frontend/Admin/.env` — **were tracked historically**
  (added in `22bf2a7`/`ebf8915` and `22bf2a7`/`e47d38e`/`fd3a366`/`fe60157`), then
  untracked. Every value in every historical revision was classified as
  `localhost`, `127.0.0.1`, a Google `googleusercontent.com` client ID, an empty
  string, or a placeholder such as `your_...`/`example`. **No secret was ever
  committed**, so the history is safe to keep as-is.
- `docker-compose.test.yml:13` hardcodes a `JWT_SECRET` used only by the
  throwaway test container. It is a test fixture, not a production secret — leave
  it, do not "rotate" it, and never let it reach a production env file.

Consequence: **no history rewrite, no force-push, and no credential revocation
is needed for git.** The Frontend `.env` files being in history is a
hygiene finding (they should not have been tracked at all), not a breach.
Rotation is about the live values only.

---

## 2. The three places a value can be set

| Location | What it is | How it is loaded | Rotation cost |
|---|---|---|---|
| **Local `Backend/.env`** | Developer machine, gitignored. Currently holds the four compromised values. | `dotenv` at backend start; also `docker compose` `env_file` default (`docker-compose.yml:11-12`) | Free. Edit locally, never commit. |
| **VPS / production `.env`** | The deployment host's `Backend/.env`. Pointed at by `BACKEND_ENV_FILE`, falling back to `./Backend/.env`. | Same file mechanism, in the container | Medium: edit, then redeploy (§5). |
| **`docker-compose` build args** | `VITE_API_URL`, `VITE_SOCKET_URL`, `VITE_GOOGLE_CLIENT_ID` (`docker-compose.yml:24-26, 44-46`) | Baked into the frontend image **at build time** by Vite | Expensive: rebuild image, push, then redeploy. A value in here cannot be changed by editing an env file at runtime. |

`DEPLOYMENT_DOCKER_RENDER.md` documents the same three values as Render dashboard
environment variables instead of a file. Treat the dashboard as the VPS `.env`
for every step in §5 — the sequence and the build-arg caveat are identical.

**The build-arg rule is the single most common rotation mistake in this project:**
`VITE_GOOGLE_CLIENT_ID` exists in three places (backend `.env`, and as a build arg
for *both* frontend images). Rotating it without rebuilding and redeploying both
images leaves the old value live in the browser bundle.

---

## 3. Order of operations — every credential, every time

Rotation is a strict sequence. Skipping or reordering the steps is how a
half-rotated deploy happens.

1. **Rotate at the provider.** Mint the new value first: Atlas, RapidAPI, the
   mail provider, Google Cloud, Google APIs, the AI provider. Keep the old value
   live until the smoke test passes — that is the rollback.
2. **Update the VPS `.env`.** Write the new value into every location listed in
   §4 for that credential. Update the local `Backend/.env` in the same pass so
   the two do not drift.
3. **Redeploy.** `docker compose up -d --build` on the VPS, or the Render
   equivalent. For any `VITE_*` value, rebuild **and push** the frontend images
   first, then redeploy — Render does not pick up a new image behind an existing
   tag on its own.
4. **Smoke test.** Run §7. Do not proceed until it passes.
5. **Invalidate old sessions.** Only meaningful for `JWT_SECRET` — see §6.

### Provider-side step detail, per credential

| Credential | Step 1: rotate at the provider | Step 2: update | Step 3: redeploy |
|---|---|---|---|
| Atlas password | Atlas → Project → **Access** → Database Access → Edit user → new password. Note: the old password keeps working until you edit the user. | `MONGODB_URI` (or `MONGO_URL`/`MONGO_URI`) in VPS `.env` **and** local `Backend/.env`. URL-encode special characters. (`Backend/.env.atlas.bak`, which held a second copy of the old password, has already been deleted — confirm it is still gone.) | Backend container restart. No frontend rebuild. |
| `JWT_SECRET` | Generate locally, do not use a memorable string: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. | `JWT_SECRET` in VPS `.env` and local `Backend/.env`. | Backend container restart. **Every browser session is logged out** — do this during a quiet window and tell support contacts. |
| RapidAPI | RapidAPI dashboard → the app → **Credentials** → Regenerate key. | `RAPIDAPI_KEY` in VPS `.env` and local `Backend/.env`. The `RAPIDAPI_*_PATHS` and `RAPIDAPI_CRICKET_HOST` values are not secrets and do not change. | Backend container restart. Confirm the live poller logs no auth errors. |
| SMTP | Mail provider → rotate the app password or client secret. If using a Google Workspace account, that is the account's **app password**, revoked in the security settings. | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, and `MAIL_DRIVER=smtp` in both env files. | Backend restart. Verify a real verification email arrives (not a log line — see the known defect in §5). |
| Google OAuth | Google Cloud Console → APIs & Services → Credentials → edit/create the OAuth 2.0 Client ID. Add the live origins to **Authorized JavaScript origins** (both frontend origins) and set the redirect URI. | `GOOGLE_CLIENT_ID` in VPS `.env` and local `Backend/.env`; `VITE_GOOGLE_CLIENT_ID` in local `Frontend/User/.env` and `Frontend/Admin/.env`, and in the `docker-compose` build args for both frontend services. | **Rebuild and push both frontend images**, then redeploy them and the backend. The backend compares against the same ID, so a mismatch silently hides the Google buttons. |
| YouTube | Google Cloud Console → the API key → **Credentials** → regenerate. Restrict it to the YouTube Data API v3 and to your server egress IP. | `YOUTUBE_API_KEY` in both env files. | Backend restart. |
| AI keys | Anthropic console → API key → rotate. Same for OpenAI. Revoke the old key after the new one is verified. | `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY`, plus `AI_PROVIDER` and `AI_MODEL` in both env files. | Backend restart. |
| Seed / admin password | There is no external provider — this is a value in your own database. | `SEED_ADMIN_PASSWORD` (used by `Backend/src/seed/seedAdmin.js` and `seedAll.js`) and `ADMIN_NAME`/`ADMIN_EMAIL`/`ADMIN_PASSWORD` (used by `npm run admin:create`) in both env files. | See §6 — the `Admin` document in the database is what actually holds the credential. Changing the env file alone changes nothing. |
| CricAPI (legacy) | cricketdata.org account → regenerate the API key. | `CRICKET_API_KEY` in both env files. **`VITE_CRICAPI_KEY` no longer exists** — the user frontend now calls the backend's `/api/international/*` proxy (see §4.2), so the key is server-side only. | Backend restart. No frontend rebuild is needed for this credential any more. |
| Google Maps | Google Cloud Console → Maps JavaScript API key → restrict by HTTP referrer to the admin origin, then regenerate. | `VITE_GOOGLE_MAPS_KEY` in `Frontend/Admin/.env`. | **Rebuild and push the admin frontend image**, then redeploy. |
| Sentry | Sentry → project settings → Client Keys (DSN) → rotate. | `SENTRY_DSN` in both env files. | Backend restart. |

**Never do this:** paste a secret into a `docker build --build-arg` command line
in a shared shell or a committed script. `scripts/docker-build-*.ps1` take the
API and socket URLs as parameters; keep client IDs out of the same habit by
passing them through the same non-logged route or by exporting them in the
session only.

---

## 4. Full credential inventory

Names only. "Set in" lists the files that must change for that credential.

### 4.1 Backend secrets — VPS `.env` / local `Backend/.env`

| Credential | Env var(s) | Set in | Status |
|---|---|---|---|
| MongoDB Atlas database user + password | `MONGODB_URI`, `MONGO_URL`, `MONGO_URI` | VPS `.env`, local `Backend/.env` (was also in `Backend/.env.atlas.bak`, now deleted) | **COMPROMISED — rotate before launch** |
| JWT signing secret | `JWT_SECRET` | VPS `.env`, local `Backend/.env` (test-only copy in `docker-compose.test.yml`) | **COMPROMISED — rotate before launch** |
| RapidAPI (Cricbuzz) key | `RAPIDAPI_KEY` | VPS `.env`, local `Backend/.env` | **COMPROMISED — rotate before launch** |
| Seed admin credentials | `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | VPS `.env`, local `Backend/.env` (consumed by `Backend/src/seed/seedAdmin.js`, `seedAll.js`) | **COMPROMISED — rotate before launch** |
| One-off admin bootstrap | `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | VPS `.env`, local `Backend/.env` (consumed by `npm run admin:create`) | Rotate with the seed admin; **remove from the production env file afterwards** — they are one-shot inputs, not runtime values |
| SMTP mail credentials | `MAIL_DRIVER`, `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | VPS `.env`, local `Backend/.env` | Rotate if a real value is present. Currently the local file carries unresolved placeholders and a duplicated `MAIL_DRIVER` — see §5 |
| Google OAuth client ID | `GOOGLE_CLIENT_ID` | VPS `.env`, local `Backend/.env` | Low severity (public client ID) but must match the frontend build arg exactly |
| YouTube Data API v3 key | `YOUTUBE_API_KEY` | VPS `.env`, local `Backend/.env` | Rotate if set |
| AI commentary — Anthropic | `ANTHROPIC_API_KEY`, plus `AI_PROVIDER`, `AI_MODEL` | VPS `.env`, local `Backend/.env` | Rotate if set |
| AI commentary — OpenAI | `OPENAI_API_KEY`, plus `AI_PROVIDER`, `AI_MODEL` | VPS `.env`, local `Backend/.env` | Rotate if set |
| CricAPI (legacy provider) | `CRICKET_API_KEY`, `CRICKET_API_PROVIDER` | VPS `.env`, local `Backend/.env` | Rotate if set |
| Sentry DSN | `SENTRY_DSN`, `ENABLE_CUSTOM_SENTRY` | VPS `.env`, local `Backend/.env` | Rotate if set |
| Object storage (optional) | `CLOUDINARY_URL`, `S3_BUCKET` (+ S3 key/secret implied) | VPS `.env`, local `Backend/.env` | Referenced by `Backend/src/utils/photoStore.js` but **absent from `Backend/.env.example`**. If you enable it, add it to the example file and rotate on schedule |

### 4.2 Frontend build-time values — `docker-compose` build args

These are compiled into the served JavaScript. Treat them as public. They cannot
be rotated by editing an env file on a running container.

| Value | Env var / build arg | Set in | Notes |
|---|---|---|---|
| Backend API base URL | `VITE_API_URL` | build arg in `docker-compose.yml:24,44`; `Frontend/User/.env`, `Frontend/Admin/.env` | Not a secret. Must end in `/api` |
| Socket.IO base URL | `VITE_SOCKET_URL` | build arg in `docker-compose.yml:25,45`; both frontend env files | Not a secret. Backend origin, no `/api` |
| Google OAuth client ID (User) | `VITE_GOOGLE_CLIENT_ID` | build arg in `docker-compose.yml:26`; `Frontend/User/.env` | Public by design; must equal backend `GOOGLE_CLIENT_ID` |
| Google OAuth client ID (Admin) | `VITE_GOOGLE_CLIENT_ID` | build arg in `docker-compose.yml:46`; `Frontend/Admin/.env` | Same value as the User frontend |
| ~~CricAPI key (User)~~ | ~~`VITE_CRICAPI_KEY`~~ | removed from `Frontend/User/.env` and `Frontend/User/.env.example` | **RESOLVED — no longer shipped.** The user frontend now fetches cricket data from the backend's `/api/international/*` proxy, which reads `CRICKET_API_KEY` server-side. Do not reintroduce this variable; Vite inlines `VITE_*` into the public bundle |
| Google Maps key (Admin) | `VITE_GOOGLE_MAPS_KEY` | `Frontend/Admin/.env` | Restrict by HTTP referrer before shipping |

### 4.3 Non-secret configuration in the same files

Listed so a rotation pass does not mistake them for credentials, and so a
sweep still confirms they were reviewed: `PORT`, `NODE_ENV`, `CORS_ORIGINS`,
`CLIENT_URL`, `ADMIN_URL`, `FRONTEND_URL`, `PUBLIC_BACKEND_URL`, `VERCEL`,
`LOG_LEVEL`, `LOG_REQUESTS`, `LOG_SOCKET`, `REQUIRE_MONGO_DB_NAME`,
`MONGO_MAX_POOL_SIZE`, `MONGO_MIN_POOL_SIZE`, `EMAIL_VERIFICATION_HOURS`,
`INVITATION_TTL_HOURS`, `ALLOW_DESTRUCTIVE_DB_SEED`,
`ALLOW_PRODUCTION_DB_RESET`, `ALLOW_DB_RESET`, `REQUIRE_ORG_APPROVAL`,
`REQUIRE_MEMBER_APPROVAL`, `ALLOW_ADMIN_REGISTER`, `ENABLE_EXTERNAL_SYNC`,
`ENABLE_ESPN_SYNC`,
`EXTERNAL_SYNC_BASE_URL`, `SYNC_INTERVAL`, `ENABLE_FREE_CRICBUZZ`,
`FREE_CRICBUZZ_BASE_URL`, `ENABLE_DEMO_CRICKET_DATA`, `CRICKET_POLL_INTERVAL`,
`CRICKET_NEWS_FEEDS`, the `RAPIDAPI_*_PATHS` path lists, `BACKUP_DIR`,
`BACKUP_KEEP_DAYS`, `MONGO_CONTAINER_NAME`.

Confirm all three destructive-op opt-ins (`ALLOW_DB_RESET`,
`ALLOW_DESTRUCTIVE_DB_SEED`, `ALLOW_PRODUCTION_DB_RESET`) are `false` on the
VPS before launch. They are not secrets, but they are the highest-consequence
values in the file.

**`ALLOW_ADMIN_REGISTER` is a fourth opt-in of the same kind, and it must be
`false` on the VPS.** It gates public self-registration into the *admin* role.
Absent or `false` means closed, which is the correct production posture — the
first admin is created deliberately with `npm run admin:create` instead. See
`Backend/docs/first-admin-bootstrap.md`. The only safe place to set it `true` is
a local or throwaway test database.

---

## 5. Known defects to fix during the rotation pass

These are not rotation steps, but each one will make a rotation look like it
succeeded when it did not. Fix them in the same pass.

1. **`Backend/.env` contains a duplicated `MAIL_DRIVER` key** (a `console` line
   followed by an `smtp` line) and literal placeholder values for `SMTP_HOST`,
   `SMTP_USER` and `SMTP_PASS`. dotenv takes the last occurrence, so `MAIL_DRIVER`
   resolves to `smtp` while the credentials are not real. Confirm the documented
   behaviour in `Backend/.env.example`: without valid `SMTP_*` values the server
   falls back to the console driver. **A verification email landing in the server
   log instead of an inbox is a failed smoke test, not a passing one.**
2. ~~**`Backend/.env.atlas.bak` is a second, unencrypted copy of every compromised
   value.**~~ **RESOLVED — the file has been deleted from the working tree.** It
   was never tracked by git, so nothing further is needed for git; just confirm
   it has not been re-created and is not present in any backup of the machine.
3. **The trailing comment block in the env files holds a second admin
   email/password pair.** Remove it and change that password too if it has ever
   been used.
4. **`MONGO_URL` vs `MONGODB_URI`.** The local env uses the legacy `MONGO_URL`;
   deployment docs use `MONGODB_URI`. `MONGO_URL`, `MONGO_URI` and `MONGODB_URI`
   are all accepted. Pick one name and use it in every file during the rotation
   so a future reader does not edit the variable that is not being read.

---

## 6. Invalidating old sessions

Only `JWT_SECRET` has a global invalidation lever, and it is a blunt one.

- **Changing `JWT_SECRET` logs out every user of both frontends at once.** Every
  already-issued token fails signature verification on the next request. This is
  the intended mechanism, not a side effect, and it is why `JWT_SECRET` is the
  last step rather than the first: doing it early means an unverified backend is
  rejecting traffic.
- **Tokens live 7 days** (`Backend/src/utils/jwt.js:16`). So the exposure window
  after a leaked `JWT_SECRET` is up to seven days, and that is the window this
  rotation is closing.
- **Per-user invalidation without a global logout:** a token embeds `tv`, the
  user's `tokenVersion` (`Backend/src/utils/jwt.js:13`), and `authMiddleware`
  rejects any token whose `tv` no longer matches (`Backend/src/middleware/authMiddleware.js:42`).
  A password reset (`authController.js:284`) and a Google relink
  (`googleAuthController.js:79`) both bump it. This is the right lever for the
  single compromised admin account, and it lets you rotate the admin password
  **without** logging out every other user.
- **Admins have no `tokenVersion`** — the `Admin` model (`Backend/src/models/Admin.js`)
  has no such field, so admin tokens always carry `tv: 0`. For the seeded admin
  account, `JWT_SECRET` rotation is the only session-invalidation lever. Sequence
  it accordingly: change the admin password first, then rotate `JWT_SECRET`, then
  redeploy, then smoke test.
- **Changing the seed admin password in the env file does nothing on its own.**
  `seedAdmin.js` refuses to reseed when an `Admin` document already exists, and
  `createAdmin.js` exits early if any admin exists. The password that matters
  lives in the database. Rotate it with the reset flow at
  `POST /api/admin/forgot-password` → `POST /api/admin/reset-password/:token`,
  or by an explicit update. Setting a new `SEED_ADMIN_PASSWORD` only affects
  databases that do not yet have an admin.
- **Other rotations need no session action.** RapidAPI, SMTP, YouTube, AI, CricAPI
  and Sentry keys are server-to-server credentials; rotating them cannot
  invalidate or mint a user session.

---

## 7. Smoke test — run after every redeploy, before signing off

Ordered so that a failure tells you which step broke.

| # | Check | How | Pass condition |
|---|---|---|---|
| 1 | Backend is up and not crash-looping | `Invoke-RestMethod https://<backend>/api/health` | `success: true` and the API-running message (`Backend/src/index.js:210`) |
| 2 | Backend reached the new database | Read the startup log | Connection success against the intended database name; `REQUIRE_MONGO_DB_NAME=true` is set so a name mismatch fails loudly |
| 3 | Mail driver is genuinely SMTP | Trigger an email verification | The message is **received**, not written to the log. This is the check that catches the §5.1 defect |
| 4 | Live score polling works | Trigger a live sync, or watch the poller | No RapidAPI auth/quota errors in the log; live matches render |
| 5 | Login and scoring work | Log in as the rotated admin, score a ball | Admin dashboard loads, a ball commits, the scorecard updates |
| 6 | Google sign-in still offered | Open both frontends | The Google button is **visible** and completes. A missing button means `GOOGLE_CLIENT_ID` and the frontend build arg disagree |
| 7 | Old sessions really are dead | Reuse a token captured before the rotation | `401`/unauthorized. If it still works, the new secret did not reach the running container |
| 8 | Automated suites | `npm test` in `Backend/`, then `npm run test:e2e` in `Backend/` | Both green. Full suite baseline is **306/306**, E2E baseline is **78/78** across 7/7 scenarios — see `Backend/docs/e2e-results.md` and `docs/phase-status.md` |

**Test suites need their own env.** `Backend/test` and the E2E runner use
`mongodb-memory-server`; they must not be pointed at the production cluster or
the production `.env`. `docker-compose.test.yml` exists for this and pins its own
throwaway values.

---

## 8. Sign-off

Do not launch until every row is checked and dated.

| Item | Owner | Done (date) | Verified by |
|---|---|---|---|
| Atlas password rotated, old user removed, `.env.atlas.bak` still absent | | | |
| Atlas IP allow-list restricted from `0.0.0.0/0` if a fixed egress IP exists | | | |
| `JWT_SECRET` replaced with a random value | | | |
| RapidAPI key regenerated, old key revoked | | | |
| Seed admin password rotated **in the database** | | | |
| `ADMIN_*` one-shot vars removed from the production env file | | | |
| Duplicate `MAIL_DRIVER` and `SMTP_*` placeholders fixed; real mail verified | | | |
| Google OAuth client ID consistent across backend env and both frontend images | | | |
| YouTube / AI / CricAPI / Sentry keys rotated **or** deliberately left blank | | | |
| `VITE_CRICAPI_KEY` absent from the user frontend env files and bundle | ✅ Done — proxied through the backend, var removed | | Re-verify on the next build |
| `ALLOW_ADMIN_REGISTER` confirmed absent/`false` on the VPS | | | |
| `xlsx` dependency exposure accepted or remediated — see §9 | | | |
| All three destructive-op opt-ins confirmed `false` on the VPS | | | |
| VPS `.env` and local `Backend/.env` compared line by line; no drift | | | |
| Smoke tests §7 rows 1–8 all pass | | | |
| Old sessions confirmed rejected; users told to re-authenticate | | | |

---

## 9. Dependency audit — `npm audit` results and open decisions

`npm audit fix` was run in each package **without** `--force`. That resolved every
non-breaking finding; three remain and all three need a human decision.

| Package | Before | After | High / Critical after |
|---|---|---|---|
| `Backend` | 12 (9 high) | **1** (1 high) | 1 high, 0 critical |
| `Frontend/User` | 23 (15 high) | **2** (0 high) | 0 |
| `Frontend/Admin` | 17 (9 high) | **4** (0 high) | 0 |

No `package.json` manifest was changed — only lockfiles moved, and only within
each package's existing semver ranges. Verified afterwards: Backend `306/306`,
E2E `78/78`, Admin `10/10`, both frontend builds succeed.

Notably, the two dependencies flagged for a possible breaking upgrade turned out
to need nothing: **`multer` reported no advisory at all** (it moved
`1.4.5-lts.1` → `1.4.5-lts.2` in-range), and **both `vite` advisories were fixed
by in-range patch bumps**, not a major upgrade.

### Open decision 1 — `xlsx` (Backend, high, no fix on npm)

- **Advisory:** prototype pollution (`GHSA-4r6h-8v6p-xvw6`) and ReDoS
  (`GHSA-5pgg-2g8v-p4x9`). Installed `xlsx@0.18.5`.
- **Reachable, not theoretical.** `Backend/src/controllers/bulkImportController.js`
  calls `xlsx.read(req.file.buffer)` on an uploaded spreadsheet at lines 12 and
  99, so a crafted `.xlsx` reaches the parser. The routes are admin-authenticated,
  which limits this to a malicious or compromised admin — but that is exactly the
  account this document assumes is compromised.
- **Why it is stuck:** SheetJS stopped publishing to the public npm registry.
  Every npm version is affected and `npm audit` reports "No fix available". The
  patched builds (0.19.3+ / 0.20.x) are only on SheetJS's own CDN.
- **Options:** (a) install from the official SheetJS CDN tarball
  (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`) — this is the real fix
  but adds a non-npm install source, which is a supply-chain decision, not a
  routine bump; (b) accept the risk and record why, given the route is
  admin-only; (c) disable bulk `.xlsx` upload until it is decided. **Not decided
  here — pick one before launch.**

### Open decision 2 — `vitest` 4.x → 5.x (both frontends, moderate)

`GHSA-82fw-gwwq-j7x9`, path traversal / arbitrary file read via
`@vitest/mocker`. **Moderate, dev-only** — it affects the test runner, not
anything shipped to users, so it does not block launch. The only fix is
`vitest@5.0.3`, a semver-major bump that will need the test suites updated.

### Open decision 3 — `react-router-dom` (Admin, moderate)

Open-redirect and arbitrary-constructor advisories, fixed in `7.18.4`, also a
semver-major bump. Dev-facing severity in this app because the affected paths are
SSR/hydration and RSC redirect handling that this SPA does not use — but the
router is a direct dependency of every page, so a major upgrade needs real
regression testing of navigation.

### Known pre-existing test gap (not a dependency issue)

`Frontend/User` has 2 of 7 vitest suites that cannot even be collected:
`Account.test.jsx` and `CreateOrganizationLabels.test.jsx` fail with
`Failed to resolve import "socket.io-client" from "../Shared/services/socket.js"`.
Cause: `Frontend/Shared/` has no `package.json` and no `node_modules`, so the
bare `socket.io-client` import inside it resolves relative to `Frontend/Shared/`
— outside the vitest root — and finds nothing, even though the package is
correctly installed in `Frontend/User/node_modules`. Production builds are
unaffected (Vite resolves it), only the test runner is. Fixing it means either
giving `Frontend/Shared` its own manifest or adding a vitest resolution alias;
that is a structural decision and was left alone.

---

### Non-negotiables

- No secret value is ever pasted into this document, a commit, a build command
  line, or a CI log.
- Rotation happens provider-side first, so there is always a working rollback
  value until the smoke test passes.
- `JWT_SECRET` rotates last, because it logs out everyone.
- A placeholder in a production env file is a failure, even when the value it
  guards is only optional. Blank it and disable the feature, or fill it in.
