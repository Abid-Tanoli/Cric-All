# oct11 Release Notes

Branch: `oct11-release` · Base: `master` (`1ac6215`) · Integrated: `oct11-A` + `oct11-B`
Target: one-day local-club tournament, **Sun 11 Oct 2026**.

This branch merges the two `oct11` work streams on top of `master`, adds the
integration fixes needed to ship them together, and passes full local
verification. It is **committed locally and not pushed**.

---

## 1. What is included

### oct11-A — teams, players, data entry, nav flags
- Admin team counts + 4-key team search; team C/VC UI.
- Player contact fields (`phone`, `jerseyNumber`, `isPartTimeBowler`) + data-entry tests.
- Backend duplicate prevention for teams (`TEAM_NAME_TAKEN`, org-scoped) and players (`PLAYER_DUPLICATE`).
- Share buttons.
- **AI commentary platform kill switch** — superadmin toggle in the Admin Sync Panel.
- **Hide-able nav flags** (`VITE_SHOW_*`) for videos, rankings, comparison, blogs.

### oct11-B — tournament / fixtures
- Tournament creation hardened: `format` enum expanded (`6 Overs, 8 Overs, T6, T8, T10, T20, ODI, Test`, default `T20`), `createdByAdmin`, `pointsConfig { win:2, tie:1, noResult:1 }`, name/date/team-count validation, owner gate middleware (`tournamentOwner.js`).
- Match lifecycle: `postponed` status + `postpone` / `reschedule` / `abandon` (adminOnly, audit-logged).
- Manual fixture validation: no self-match, both teams in tournament and existing, no duplicate pair+round+group, no double-booking.
- Auto-generate fixtures: **preview then apply** (round-robin / group / knockout), skips existing pairs, never touches live/completed matches.
- Admin fixtures dashboard routed at `/admin/tournaments` (Fixtures / Points Table / Groups tabs, auto-generate, manual fixture, group assignment, recompute points, per-match actions).
- Public tournament tabs (`Series.jsx`): Home / Fixtures & Results / Points Table / Stats / Teams / Awards, each hidden when empty.
- Points table recompute is idempotent (`recomputeTournamentPoints` rebuilds from scratch).

### Integration fixes made on this branch
- **AI commentary is now OFF by default.** `SystemSettings.aiCommentaryEnabled` defaults to `false`; env `AI_COMMENTARY_ENABLED=true` only opts in on first boot; stored settings are authoritative. `aiCommentary.js` requires `=== true`, and `commentaryService.callAI()` returns `null` when off. `AI_COMMENTARY_ENABLED` is the documented flag.
- **Public projection regression fix:** added `jerseyNumber` to `PLAYER_PUBLIC_FIELDS` (`publicProjection.js`) so the new data-entry field stays visible to anonymous callers; `phone` and `isPartTimeBowler` remain withheld. Test assertions updated.
- **Frontend build-arg wiring for nav flags:** `Frontend/User/Dockerfile` now accepts/forwards `VITE_GOOGLE_CLIENT_ID` (previously a no-op) and all 7 `VITE_SHOW_*` flags; `docker-compose.yml` `user-frontend` forwards them; `Frontend/User/.env.example` documents them.
- **Test-fixture fix:** `crossTenant.test.js` used a 2-team `league` tournament, which the new `league >= 3` rule rejects (setup 400 → 39 tests cancelled). Changed two success-path tournaments to `knockout`.

---

## 2. Migrations

**No database migration is required for this release.**

- The only schema change is `postponed` added to the `Match.status` enum (`Match.js`) — existing stored values are unchanged.
- New fields (`Tournament.format`, `createdByAdmin`, `pointsConfig`; `SystemSettings.aiCommentaryEnabled`; player `jerseyNumber`/`phone`/`isPartTimeBowler`) are optional and default safely (flags treated as false/absent).
- All new migration-needing work predates this branch and is already documented in `docs/task0-report.md` §3. If upgrading a database from `7a9cac0`, run the existing guarded scripts in this order (inside the backend container, dry-run then `--apply`):
  1. `migrateTeamNameUniqueness.js`
  2. `migrateSetIsPublic.js` (`--set-public`)
  3. `migrateUserPhoneIdentity.js`

  These are loopback-locked; use `--allow-host <name> --allow-database <name>` when running against an internal compose host.

---

## 3. Verification (serial, local)

| Check | Command | Result |
|---|---|---|
| Backend tests | `cd Backend; npm test` | 424 tests — 383 pass / 1 fail / 39 cancelled / 1 skip; **the single failure cluster was `crossTenant` (stale 2-team league)**, fixed → `crossTenant` 39/39; suite green |
| Tournament E2E flow | `JWT_SECRET="ci-only-secret" node test/e2e/tournamentFlow.mjs` | 12/12 checks pass + 1 known gap (see §4) |
| E2E suite | `cd Backend; npm run test:e2e` | **78 pass / 0 fail / 0 divergence, 7/7 scenarios** |
| Frontend User tests | `cd Frontend/User; npm test` | **41/41** (12 files) |
| Frontend Admin tests | `cd Frontend/Admin; npm test` | **10/10** (2 files) |
| Vite build (User) | `cd Frontend/User; npm run build` | built 42.07s |
| Vite build (Admin) | `cd Frontend/Admin; npm run build` | built 9.74s |
| API smoke | `cd Backend; npm run test:smoke` | 4/4 |

---

## 4. Known gap (reported, not fixed)

**Auto-generated tournament fixtures are not scorable through any API.**

- `createTournamentMatch` (`Backend/src/controllers/TournamentController.js:713`) and `applyTournamentFixtures` (`TournamentController.js:889`) create a `Match` **without** seeding the `innings` array.
- `updateScore` requires `match.innings[inningsIndex]` (`Backend/src/controllers/scoreController.js:71`), so the first ball returns `400 "Invalid innings index"`.
- Only `createMatch` (`Backend/src/controllers/matchController.js:242`) and `createOrgMatch` (`Backend/src/controllers/orgMatchesController.js:149`) seed the two innings.
- Impact: the admin **Open scoring** action (`Frontend/Admin/src/pages/Tournamentmanagement.jsx:387`) would 400 on ball one for any auto-generated fixture.
- **Workaround for 11 Oct:** create the scorable match via `POST /api/matches` with `{ tournamentId }` (and set overs via `PUT /api/matches/:id { totalOvers }`), then score normally — this path seeds innings and links the match to the tournament, so it still counts in the points table.
- Per instruction, product code was **not** changed; this is recorded as a known gap.

---

## 5. VPS deploy steps (exact lines)

Build-time flags are inlined by Vite, so they must be set **before building** the User
frontend. On the VPS, set these in the `.env` used by `docker compose`:

```env
# Backend — AI commentary stays OFF unless explicitly enabled
AI_COMMENTARY_ENABLED=false

# User frontend build args
VITE_GOOGLE_CLIENT_ID=<your-google-client-id>.apps.googleusercontent.com
VITE_SHOW_INTERNATIONAL=false
VITE_SHOW_HIGHLIGHTS=false
VITE_SHOW_CRICKET_NEWS=false
VITE_SHOW_VIDEOS=true
VITE_SHOW_RANKINGS=true
VITE_SHOW_COMPARISON=true
VITE_SHOW_BLOGS=true
```

Then rebuild and restart the affected service:

```sh
docker compose build user-frontend
docker compose up -d user-frontend
```

Notes:
- External sections (`international`, `highlights`, `cricketNews`) are **hidden** by default; platform sections (`videos`, `rankings`, `comparison`, `blogs`) are **visible** by default. An unset variable falls through to that default.
- Do **not** set `ALLOW_ADMIN_REGISTER=true` in production.

---

## 6. Provenance

- `oct11-A` is a fast-forward descendant of `master`.
- `oct11-B` merged into `oct11-release` at `dfe8893`; the only conflict (`docs/TOURNAMENT_READINESS_AUDIT.md`) was resolved keeping **both** audit sections. `Series.jsx` auto-merged.
- `git diff --check` clean. `oct11-prompt1` WIP remains stashed (`stash@{0}`) and was **not** merged.
