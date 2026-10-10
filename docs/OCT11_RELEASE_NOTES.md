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
| Backend tests | `cd Backend; npm test` | **428 tests — 427 pass / 0 fail / 1 skip** (includes the live-server `crossTenant` 39/39 and `noSqlInjection` suites) |
| Tournament E2E flow | `JWT_SECRET="ci-only-secret" node test/e2e/tournamentFlow.mjs` | **14/14 checks pass** (auto-fixture scoring is now a passing check — see §4) |
| Fixture-scoring tests | `node --test test/oct11FixtureScoring.test.js` | **5/5** (platform / auto-generate / manual-QF / lazy-repair / no-toss paths) |
| E2E suite | `cd Backend; npm run test:e2e` | **78 pass / 0 fail / 0 divergence, 7/7 scenarios** |
| Frontend User tests | `cd Frontend/User; npm test` | **41/41** (12 files) |
| Frontend Admin tests | `cd Frontend/Admin; npm test` | **10/10** (2 files) |
| Vite build (User) | `cd Frontend/User; npm run build` | built 42.07s |
| Vite build (Admin) | `cd Frontend/Admin; npm run build` | built 9.74s |
| API smoke | `cd Backend; npm run test:smoke` | 4/4 |

---

## 4. Scoring-start fix (follow-up — the former "known gap")

**Auto-generated tournament fixtures are not scorable through any API.** — **FIXED.**

The problem: `createTournamentMatch` (`TournamentController.js:713`) and
`applyTournamentFixtures` (`TournamentController.js:889`) persisted a `Match`
with **no `innings` array**, while `updateScore` requires
`match.innings[inningsIndex]` (`scoreController.js:71`) — so the first ball on
any auto-generated (or manually created) fixture returned
`400 "Invalid innings index"`.

What changed:

- **One shared helper** `Backend/src/utils/matchInnings.js`:
  `buildMatchInnings(teams)` returns the two empty innings for a new match, and
  `ensureMatchInnings(match)` **adds only the missing slots**. Every creation
  path now uses it: `createMatch`, `createOrgMatch`, `createTournamentMatch`
  and `applyTournamentFixtures`.
- **Lazy repair on the way in.** `ensureMatchInnings` also runs at scoring start
  — the toss (`updateToss`), status transitions (`updateMatchStatus`), openers
  (`setOpeners`), the first ball (`updateScore`) and `setBowler` — so a fixture
  saved **without** innings (old data, or any path that slipped through)
  self-heals on the toss or first ball. **No migration is needed.**
- **Non-destructive.** It only ever *adds* missing innings slots; an existing
  innings array — including a live or completed one — is never cleared,
  reordered or mutated.
- **Knockout round labels.** `Match.round` is now `Mixed` (was `Number`) so a
  fixture can be labelled by stage (`"QF"`, `"SF"`, `"Final"`) as well as by
  number; round comparisons normalise through `String()`.

Coverage: `Backend/test/oct11FixtureScoring.test.js` (5 HTTP tests) drives each
creation path over the real API — toss → playing XI → a wide, a wicket and a
completed over → undo — plus one pre-existing fixture with its innings stripped
(repaired on toss) and one with the toss skipped (repaired on the first ball).
`test/e2e/tournamentFlow.mjs` asserts an auto-generated fixture is
toss-then-first-ball scorable; that step is now a **passing** check (14/14).

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
- The scoring-start fix in §4 (`utils/matchInnings.js`, the lazy `ensureMatchInnings`
  calls, the `Match.round` relaxation and the new tests) was added on
  `oct11-release` **after** the first release commit, ahead of the 11 Oct event.
- The Admin sidebar fix and the "12th Man" rule (§7, §8) were added on the
  `oct11-fixes` branch (from `master`/`a4cf64e`), ahead of the 11 Oct event.

---

## 7. Admin navigation fix

The Admin sidebar entries did not work and the sidebar could not scroll to its
last items. Root cause: the `<aside>` was a fixed-height flex column whose
`<nav>` child lacked `min-h-0`, so the nav grew past the viewport instead of
scrolling, and a `no-scrollbar` utility hid the (overflowing) scrollbar.

Fix (`Frontend/Admin/src/components/Sidebar.jsx`):
- `min-h-0` on the nav so it becomes the scrolling flex child; the header stays
  pinned.
- `overflow-hidden` on the aside; replaced `no-scrollbar` with a thin, visible
  scrollbar (`scrollbar-width: thin` + webkit rules).
- Nav still uses `NavLink` (client-side routing, active item highlighted via
  `aria-current`), and each item closes the mobile drawer on click.

Two entries are now hidden by default behind admin feature flags (routes stay
mounted, so links keep working if visited directly):
- `VITE_SHOW_ADMIN_INTERNATIONAL` (default hidden)
- `VITE_SHOW_ADMIN_HANDLER_REQUESTS` (default hidden)

Wired as build args/ENV in `Frontend/Admin/Dockerfile` and
`docker-compose.yml` (admin-frontend `build.args`), mirroring the User frontend.
A component test (`Frontend/Admin/src/test/Sidebar.test.jsx`) covers item
rendering, the hidden-by-default flags, the superadmin-only "Manage Admins"
entry, the active route, and the scrollable nav.

## 8. 12th Man rule (replaces "Super Sub / Impact Player")

User-facing text is now "12th Man" everywhere; internal field names
(`Match.twelfthMan`, `Match.impactPlayers`, `setImpactPlayer`, the
`/matches/:id/impact-player` route) are unchanged. `ScoringEngine.addImpactPlayer`
is untouched.

**Enablement is narrowest-wins and must be turned on in two places:**
1. Platform master switch — superadmin toggle **Sync Panel → "12th Man"**
   (`SystemSettings.enableSuperSub`; env seed `SUPER_SUB_ENABLED=true`). Off
   blocks the rule everywhere.
2. Per-scope rule — `rules.twelfthManEnabled` on the **tournament** form and/or
   the **match setup wizard** (per match). A match value overrides the
   tournament; `null` (unset, the default) inherits the tournament.

Effective = master switch AND (`match.rules.twelfthManEnabled` ??
`tournament.rules.twelfthManEnabled` ?? false). Turning it on for one
match/tournament never affects another.

**Behaviour:** a team's nominated 12th man replaces one XI player, once per team
per match. The swap edits `playingXI` and keeps `bowlingXI` in sync (replaced
player removed, incoming player added when a bowling XI exists). The replaced
player cannot bat or bowl after the swap; existing scorecard entries are kept.

**Timing (backend-enforced):** only at the innings start, at the end of an over,
or right after a wicket — otherwise `TWELFTH_MAN_BAD_TIMING`. A mid-over swap on
the fielding side bars the incoming player from bowling the rest of that over
(`TWELFTH_MAN_CANNOT_BOWL_OVER`); the replaced player (if bowling) also cannot
continue.

**Not implemented (deliberately out of scope):** no five-substitute list, no
overseas-player rule, no over cap for the 12th Man. Only the single mid-innings
replacement described above.

Tests: `Backend/test/twelfthMan.test.js` (scope isolation, master-off block,
timing, once-per-team, bowlingXI sync, replaced-player removal, mid-over bowling
block, end-of-over window); `Backend/test/superSub.test.js` kept passing
(codes/gating updated).
