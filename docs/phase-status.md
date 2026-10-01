# Phase Status Table (0–13)
Repository: `C:\Users\Abid Tanoli\Desktop\Abid Web Development\Cric-All`
Commit(s): see commit hash column (HEAD = 7a9cac0)

All file paths are relative to repo root. Evidence includes file:line quotes where practical.

## Round 3 update — 2026-10-01

The Phase 9 and Phase 10 rows below predate this round and contain stale claims.
Current evidence and run results are recorded here and in
[`Backend/docs/scoring-guards.md`](../Backend/docs/scoring-guards.md) and
[`Backend/docs/e2e-results.md`](../Backend/docs/e2e-results.md).

- Phase 9: `POST /api/livematch/:matchId/ball` now uses
  `requireMatchScoreAccess`; no inbound Socket.IO scoring or ball-write event
  exists. Anonymous room joins remain read-only and expose live feed data.
- Phase 10: the E2E runner and independent tally are present. The current
  before/after counts are recorded in the E2E report: baseline aborted before
  scenarios; final run passed 78/78 checks with no divergences. The full backend
  suite passed 220/220 after raising the test-only MongoMemoryServer startup
  timeout to 30 seconds.
- Part D: organization deletion removes its invitation rows; a separate
  local-only orphan cleanup command defaults to dry-run and requires `--apply`.
  Its dry run against `cric-all-e2e` found zero orphan invitations.

The Round 3 baseline initially aborted during bootstrap after the local-only
guard passed: its configured backend log path did not exist, so no verification
token could be read. That run created no E2E report and did not execute a
scenario. The after run used a dedicated local backend log and is documented in
the E2E report. `Backend/.env` now names the local database `cric-all-e2e`.

> Verification approach: this Round 3 addendum records source changes and local regression/E2E runs; see `Backend/docs/e2e-results.md` for current results.

## IMPORTANT CAVEAT — basis of this table

The master prompt's authoritative definition of Phases 0–13 was **not available in this
session**. Phase scope below is therefore **inferred** from (a) phase-labelled commit
messages in `git log`, and (b) the code each commit touched. Consequences:

- Phases 2, 6, 11, 12 and 13 have **no phase-labelled commit** — they predate the
  phase work, so their status is judged on current code, not on a landed commit.
- Where a phase's acceptance criteria are unknown, the row states what was checked in
  code and flags that acceptance criteria could not be mapped 1:1.
- The four phases with explicit commits (0, 1, 5, 9) are the reliable rows. Treat the
  others as provisional until checked against the master prompt.

Commit hashes in the table are taken from `git log -- <path>`; no hash is inferred.

## Legend
- CONFIRMED — criteria met as far as they could be checked; evidence in code
- PARTIAL — partially met; gaps listed
- NOT STARTED — not implemented, or no evidence found

## Table

| Phase | Status | Commit(s) | File(s)/line(s) (evidence) | Acceptance criteria (met/missing) |
|---|---|---|---|---|
| 0 | CONFIRMED | 4d4f71f (audit), 9c043ff | `docs/architecture-audit.md` (audit work); `Backend/src/routes/authRoutes.js`, `authController.js`, `middleware/authMiddleware.js` | Audit artifacts present and reviewed; Phase 9 follow-up confirmed via code inspection. |
| 1 | CONFIRMED | ef63454 | `Backend/src/controllers/authController.js:30-70,120-200,366` (register/login/verify/resend/delete); `Backend/src/utils/emailVerification.js:1-65` (hash, token, expiry); `Backend/src/middleware/authMiddleware.js:10-70,72-83` (`requireVerifiedEmail`); `Backend/src/validators/authValidators.js`; `Backend/src/routes/authRoutes.js:18-47`; `Backend/src/utils/mailer.js:41-86` (console/smtp driver); `Backend/src/services/googleVerifier.js`; `Backend/src/controllers/googleAuthController.js:1-140` | Email verification implemented (tokens, expiry, mailer), `requireVerifiedEmail` guards present, Google identity linking, token versioning/account status, Zod validation + rate limits (rateLimiter middleware applied in routes), verify-email UI (Frontend/User `Account.jsx`, `AuthPages`), HTTP tests for verification flows exist. |
| 2 | PARTIAL | 9c043ff, db3a462 (undated, pre-phase work) | `Backend/src/models/*` (Player, Team, TeamOrganization, Event, Series, Tournament, Match, Ball, User, Membership, Invitation); `Backend/src/routes/*` (playerRoutes, teamRoutes, organizationRoutes, eventRoutes, seriesRoutes, tournamentRoutes, matchRoutes); `Backend/src/controllers/*`; validators | Core domain models and REST routes exist; CRUD structure verified. |
| 3 | PARTIAL | ee9af91, c512853, 7a9cac0 | `Frontend/User/src/pages/HandlerDashboard.jsx:21,62,108,120-234,238-239,296-297` (dashboard); `Frontend/User/src/pages/MyOrganization.jsx:22-30,101,171-176,212,217,280-298,325-374` (org dashboard); `Frontend/User/src/pages/organization/*.jsx` (tabs); `Frontend/User/src/lib/orgUi.js:1-20,87-89` (`can`, `PERMISSIONS`); `Frontend/User/src/components/Header.jsx:35,108,120-154,231-252` (nav); `Backend/src/permissions/orgPermissions.js:9-141` (roles/permissions); `Backend/src/middleware/orgAccess.js:90-195` (`requireOrgPermission`, `requireOrgMembership`, `requireOrgOwner`); `Backend/src/routes/handlerRoutes.js:12-14`; `organizationRoutes.js:87,103,113-158,171-185`; `invitationRoutes.js:19`; `Backend/src/controllers/membershipController.js:54-87,851-872,337-396` | **Met:** Two dashboard surfaces exist (`/dashboard` Handler, `/organization` permissioned). Tab-level and component-level permission gating present (backend `orgPermissions` + `orgAccess` middleware; frontend `can()` helper). `/my-players` and `/account` exist. Backend endpoints backing dashboards verified. **Missing:** Org switcher is only an inline button strip inside `/organization` shown when `orgs.length>1` (`MyOrganization.jsx:280-298`) — **no global/dedicated org switcher** in header or shared context. `/dashboard` is gated by `accountType` (`handler`/`organization_admin`) not by org permissions. |
| 4 | PARTIAL | 9c043ff, 53bc67b, db3a462 (no phase-labelled commit) | `Backend/src/models/Team.js:5-10,34-38,154-159,161-173` (`name` unique global, `organization` + `organizationRef`); `Backend/src/routes/organizationRoutes.js:99,145-158` (per-org CRUD + public `/:id/teams` read); `Backend/src/controllers/orgTeamsController.js:20-32,82,126-128,146-148,160-162,180-182`; `Backend/src/services/teamService.js:26,98-100,159-162` (global name uniqueness checks); `Backend/src/routes/teamRoutes.js:20,24-27` (platform-admin only create/update/delete); `Backend/src/middleware/authMiddleware.js:65-70` (`requireAdmin`) | **Met:** Team has `organization` and `organizationRef` (both). Per-org Team CRUD routes exist and org-scoped queries enforce `organizationRef: req.org._id` (returns 404 cross-tenant). Global team routes gated by `requireAdmin`. Public `GET /:id/teams` present by design. **Missing:** Team name uniqueness is **global** (`Team.js:5-10 unique true` on `name`; `teamService.js:99,160` also global). **No compound unique index** `{organizationRef,name}` exists (indexes listed at 161-173). As a result, two different organizations cannot share the same team name. Also global admin `createTeam` creates org-less teams in some paths (e.g. handler approval creates teams without `organizationRef`). |
| 5 | PARTIAL | 9c043ff, db3a462 | `Backend/src/models/Player.js:54-60,63-66,78-99,100-121,126-130,143-146` (fields, `stats`, `privacy`, `createdBy`); `Backend/src/models/Ball.js:3-35` (delivery source); `Backend/src/controllers/playerController.js:56-72,86-102,149-152,182,344-356` (list/public/getMine/ranking); `Backend/src/services/playerService.js:64-73` (free-agents); `Backend/src/controllers/rankingsController.js:135-160,261-274` (ranking project whitelist); `Backend/src/services/rankingService.js:236-241` (team player rankings embeds full doc); `Backend/src/middleware/playerAccess.js:9-102` (`SELF_SERVICE_DISABLED_FIELDS` includes `stats`); `Backend/src/validators/playerValidators.js:181-210,270-276` (admin includes stats); `Backend/src/routes/playerRoutes.js:43-51,63,71,74-79` (routes); `Backend/src/repositories/PlayersRepository.js:149-167` (dead Knex code, not imported); grep for `.aggregate` over Ball → none | **Met:** `Ball` model exists as delivery source. Rankings use `$stats.*` from stored stats. Privacy flags exist (`privacy.contactInfo/socialLinks/location`, default public). `createdBy` + field-policy + `requireVerifiedEmail` on create. Admin schema allows stats; self-service does not. **Missing:** **Player stats are STORED/DENORMALIZED on `Player.stats` (lines 78-99) — there is NO aggregation pipeline computing career aggregates from `Ball` documents.** Searches: `.aggregate(` across Backend returned 6 hits, none involving Ball→Player; no `Player.stats =` assignments found; only team NRR touches stats in engine context. **Server-side sanitization is incomplete:** 4 unauthenticated list/ranking paths return full Player docs (no `.select`/no post-processing): `GET /players` (`playerController.js:56-72`), `GET /players/ranking` (`:344-356`), `GET /players/free-agents` (`playerService.js:64-73`), `GET /rankings-v2/players/team/:teamId` (`rankingService.js:236-241` embeds full `player`). These leak `birthInfo.date` (DOB), full `address`, `gallery[]`, `videos[]`, `createdBy`. Only `GET /players/:id` partially sanitizes (`:86-102`) — does not remove `birthInfo`/`gallery`/`videos`, and `email/phone/contact` branch is dead code (fields don't exist). **No `linkedUser` field and no claim profile flow** — only `createdBy` exists (grep for linkedUser/claimProfile returned 0). |
| 6 | PARTIAL | 9c043ff, db3a462 | Match/Event/Series/Tournament models (`Backend/src/models/Match.js:1-435`, Event, Series, Tournament); routes and controllers; organization-scoped match creation (`organizationRoutes.js` org matches section, `orgMatchesController.js`); `orgMatchesController.js:314` notes `squad15` field usage; Phase 9 added org-scoped scoring/squad gates (see Phase 9) | Tournament/series/event structures exist with organization context where applicable; org-scoped fixture creation present. |
| 7 | PARTIAL | db3a462, 2d480ec | `Backend/src/routes/uploadRoutes.js:9-23` (multer memory, MIME filter jpeg/png/webp, 5MB); `Backend/src/routes/bulkImportRoutes.js:15-27` (Excel MIME); `Backend/src/utils/photoStore.js:9-51` (MIME→ext whitelist, writes to disk); `Backend/src/controllers/uploadController.js:12-30`; `Backend/src/models/Blog.js:1-46` (model "Blog"); `Backend/src/controllers/blogsController.js:1-66`; `Backend/src/routes/blogRoutes.js:1-15`; `Frontend/Admin/src/pages/Blogs.jsx:161`; `Frontend/User/src/pages/LeagueDetails.jsx:214`; `Frontend/Shared/services/socket.js`, `Frontend/User/src/components/PDFReport.jsx:55-99` | **Met:** Upload middleware uses Multer with MIME/extension checks and size limits. `Blog` model exists (no separate `Post`). Frontend does not use `dangerouslySetInnerHTML` anywhere (grep returned 0). Blog content rendered as plain text. PDF generation uses `document.write` with constructed strings (not injecting arbitrary user HTML into React DOM). **Missing:** **No magic-byte/file-signature validation** on uploads — only MIME/extension checks (no file-type buffer inspection). **No HTML sanitization** of user-generated content in backend or frontend (no sanitize-html/DOMPurify/xss deps; `blogsController` saves raw `req.body` with no sanitization). |
| 8 | NOT STARTED | a3ececc (file predates phase work) | `Backend/src/models/Review.js:1-19` (DRS model: matchId/inning/overBall/decisionChallenged/outcome/reviewsRemaining); `Backend/src/routes/matchRoutes.js:116` (`GET /:id/drs`); grep for `Follow|Like|Comment|Report|Notification|Post` across Backend/src and Frontend → no models/routes/controllers found; no embedded arrays discovered; `orgPermissions.js:67` only permission name text | **Met:** `Review.js` exists and is **DRS (Decision Review System)** for match reviews, not a generic abuse report. **Missing:** **No social graph models** (Follow, Like, Comment, Report, Notification) exist. **No routes/controllers/API endpoints** for social features. **No alternative embedded implementation** found (no followers/following/likes/comments/reports/notifications fields surfaced). |
| 9 | CONFIRMED | Round 3 local change | `Backend/src/routes/liveMatchRoutes.js`; `Backend/src/middleware/matchAccess.js`; `Backend/test/matchScoreAccess.test.js`; `Backend/docs/scoring-guards.md` | The legacy ball route uses `requireMatchScoreAccess`; tenant scorer and forbidden-role/tenant checks pass. Socket.IO has no inbound scoring write event. Unauthenticated room joins remain a read-access concern. |
| 10 | CONFIRMED | Round 3 local verification | `Backend/test/e2e/run.mjs`; `Backend/test/e2e/lib/tally.js`; `Backend/docs/e2e-results.md` | Full scenarios 1–7: 78 PASS, 0 FAIL, 0 DIVERGENCE. The current baseline is documented as a bootstrap abort, not inferred from historical 42/12/6. |
| 11 | PARTIAL | 9c043ff, db3a462 | Organization models/routes (`TeamOrganization`, Membership, Invitation), audit logs (`AuditLog.js`), org access/membership controllers, permission system. | Org/tenant structures present. |
| 12 | PARTIAL | 9c043ff, 53bc67b | Settings, external sync, system settings routes/controllers, CORS config. | Platform settings present. |
| 13 | PARTIAL | 53bc67b, 9c043ff | Deployment configs (`Dockerfile`, `docker-compose*.yml`, `vercel.json`), deployment docs. | Deployment assets present. |

### Key findings (from deep-dives)
- **Phase 5 — Privacy leak (unauthenticated):** 4 list/ranking endpoints return full Player docs (including DOB, address, gallery, videos, `createdBy`). Fix needs server-side sanitization (select/project) on those paths. `GET /players/:id` partially sanitizes but misses DOB/media. No `linkedUser`/claim flow.
- **Phase 4 — Team name uniqueness:** global, not per-org (missing compound index `{organizationRef,name}` and service-layer org-aware checks). 
- **Phase 7 — Uploads:** MIME-only, no magic-byte validation; no HTML sanitization on user content. 
- **Phase 9 — Security note:** The legacy `/api/livematch/:matchId/ball` route now uses `requireMatchScoreAccess`. Socket.IO has no inbound scoring mutation events. Unauthenticated live room subscriptions remain a read-access concern.
- **Socket.IO auth:** No JWT verification on handshake (`io.use` absent); `socket.data.user` never set. Mutations not accepted over sockets, so HTTP guards are the enforcement point. 

Deliverable: `docs/phase-status.md` created with this table + evidence.
