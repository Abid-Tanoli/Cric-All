# oct11-B Tournament/Fixtures Report

Branch: `oct11-B` · Base commit: `d6817e5`
Scope: make the **Tournament** path solid for a one-day local-club event (Sun 11 Oct 2026).
Path chosen: **Tournament** (the only model with a working create → fixtures → standings loop; Event/Series were not merged into it).

Ownership respected: only Tournament/Event/Series/Match models, tournament/match controllers + routes, Admin tournament pages, User Series page were touched. `ShareButton`, `scoreController`, `SystemSettings`, team/player controllers and nav flags (Terminal A) were left untouched.

---

## Task-by-task

### Task 1 — Audit — Done
- `docs/TOURNAMENT_READINESS_AUDIT.md` section **"9. oct11-B re-audit: Tournament/Fixtures"** added with Complete/Partial/Missing/Broken/Needs-production-verification statuses and file:line evidence.
- Key findings recorded: `Tournamentmanagement.jsx` existed but was **not routed**; it read non-existent `match.team1/team2/startTime`; `createTournamentMatch` wrote `matchCategory:"league"` which is **not** a valid enum value (every real manual create would 500); no `postponed` status; no owner enforcement.

### Task 2 — Tournament creation — Done
- `Backend/src/models/Tournament.js`: `format` enum expanded (`6 Overs, 8 Overs, T6, T8, T10, T20, ODI, Test`, default `T20`); added `createdByAdmin` (ref `Admin`); added `pointsConfig { win:2, tie:1, noResult:1 }`.
- `Backend/src/controllers/TournamentController.js`:
  - `createTournament`: requires name + dates, `endDate >= startDate`, team-count by type (**knockout ≥2, league ≥3, group-stage/mixed ≥4**), no duplicate teams, all teams must exist, `pointsConfig` from body, `createdByAdmin = req.user._id`, audit-logged.
  - `updateTournament`: whitelisted fields only, team edits re-validated (count + existence), points-table rows preserved for kept teams, audit-logged.
  - `deleteTournament`: audit-logged.
  - `validateTournamentTeamCount` exported for tests.
- `Backend/src/middleware/tournamentOwner.js` (**new**): `requireTournamentOwnerOrAdmin` — superadmin OR `createdByAdmin === req.user._id` OR role `admin`; every decision audit-logged; reads id from `params.id`, `params.tournamentId` or `body.tournamentId`. Enforced in middleware, not UI.
- `Backend/src/routes/tournamentRoutes.js`: mutation routes wrapped with the owner gate.

### Task 3 — Match status + lifecycle actions — Done
- `Backend/src/models/Match.js`: added `postponed` to `status` enum (existing stored values unchanged; no migration).
- `Backend/src/controllers/matchController.js`: added `postponed` to `legalMatchStatuses`; added `postponeMatch`, `rescheduleMatch`, `abandonMatch` (all audit-logged; block on `completed`/`abandoned`; reschedule revives a postponed match to `upcoming`; abandon sets a `no result` result when unresolved).
- `Backend/src/routes/matchRoutes.js`: `POST /api/matches/:id/postpone|reschedule|abandon` under `adminOnly`.

### Task 4 — Manual fixture validation — Done
- `createTournamentMatch` rewritten: A ≠ B, both teams must belong to the tournament, both must exist, **no duplicate (same pair + round + group)**, **no team double-booked at the same `startAt`**, sets `matchNumber`, `round`, `group`, and fixes the invalid `matchCategory:"league"` → `"Other"` with the tournament name in `matchSubcategory`. Conflict check extracted as `findManualFixtureConflict` (exported for tests).

### Task 5 — Auto-generate: preview then apply — Done
- `Backend/src/services/tournamentService.js`: `generateRoundRobinRounds` (circle method, BYE for odd counts), `generateKnockoutRoundStructure` (next power of two, later rounds `isTbd`), `planTournamentFixtures` (formats `round-robin` | `group` | `knockout`), `fixturePairKey`.
- `Backend/src/controllers/TournamentController.js`: `previewTournamentFixtures` (no writes) and `applyTournamentFixtures` (persists concrete fixtures, **skips any pair that already exists regardless of status — live/completed matches are never touched or duplicated**) + `setTournamentGroups` (manual A/B assignment, team can be in only one group).
- Routes: `POST /api/tournaments/:id/fixtures/preview`, `POST /api/tournaments/:id/fixtures/apply`, `POST /api/tournaments/:id/groups`.
- `T6`/`T8` tournament formats are mapped to valid `Match.matchType` values (`6 Overs`/`8 Overs`) before saving.

### Task 6 — Admin fixtures dashboard — Done
- `Frontend/Admin/src/pages/Tournamentmanagement.jsx` rewritten (was orphaned): create/edit tournament with team multi-select and points rules; detail view with Fixtures / Points Table / Groups tabs; **auto-generate (preview + apply)**; manual fixture form (team dropdowns from the tournament, datetime, round, group); **group assignment**; **[Recomputed]** points button; fixture list **grouped by group + round**, **filter by status and team**, and per-match **Open scoring / Reschedule / Postpone / Abandon**.
- Routed at `/admin/tournaments` (`Frontend/Admin/src/App.jsx`) and added to `Sidebar.jsx`.

### Task 7 — Public tournament tabs — Done
- `Frontend/User/src/pages/Series.jsx`: tabs are now **Home / Fixtures & Results / Points Table / Stats / Teams / Awards**, and each is **hidden when it has no content**. Home shows recent results + upcoming fixtures; Awards derives Most Runs / Most Wickets / Most Sixes / Most Fours. The existing `ShareButton` is preserved (no new share buttons added).

### Task 8 — Points table idempotent — Done
- `updatePointsTable` now delegates to `recomputeTournamentPoints` (rebuild from scratch), so re-running after a re-saved result cannot double-count. Legacy `updateTournaments` hook name kept so `scoreController.js` (untouched) keeps working. Verified by test.

---

## Targeted tests (only my files; `node --test --test-concurrency=1`)

```
node --test --test-concurrency=1 test/tournamentFixture.test.js
✔ 9 passing / 0 failing
```

Covers: team-count rule (knockout/league/group), duplicate-team rejection, unordered pair key, duplicate-fixture detection, double-booking detection (and that a completed match does not block it), round-robin N*(N-1)/2 unique pairs, knockout bye padding, and **`recomputeTournamentPoints` idempotency** against a real in-memory MongoDB (`mongodb-memory-server`).

A real bug was found and fixed by this test: `generateRoundRobinRounds` used `m` rounds for odd team counts instead of `m-1`, producing 12 matches for 5 teams (expected 10).

Frontend builds (not the full suite / no E2E):
- `Frontend/Admin` → `vite build` ✓
- `Frontend/User` → `vite build` ✓

---

## Files changed

Backend
- `Backend/src/models/Tournament.js`
- `Backend/src/models/Match.js`
- `Backend/src/controllers/TournamentController.js`
- `Backend/src/controllers/matchController.js`
- `Backend/src/services/tournamentService.js`
- `Backend/src/routes/tournamentRoutes.js`
- `Backend/src/routes/matchRoutes.js`
- `Backend/src/middleware/tournamentOwner.js` (new)
- `Backend/test/tournamentFixture.test.js` (new)

Frontend
- `Frontend/Admin/src/pages/Tournamentmanagement.jsx`
- `Frontend/Admin/src/App.jsx`
- `Frontend/Admin/src/components/Sidebar.jsx`
- `Frontend/User/src/pages/Series.jsx`

Docs
- `docs/TOURNAMENT_READINESS_AUDIT.md` (section 9)

---

## Partial / unverified

- **Partial:** Admin dashboard uses `window.prompt`/`window.confirm` for reschedule/postpone/abandon rather than a styled modal. Functionally complete.
- **Partial:** Knockout fixtures are generated as a round-1 bracket plus `TBD` placeholder later rounds; there is no automatic winner-advancement wiring yet (later rounds are placeholders by design).
- **Needs-production-verification:** end-to-end run against a real MongoDB/browser (localhost) — not run here (no E2E per rules). HTTP-level route tests for the new endpoints were not added; controllers were exercised at the unit/service level.
- **Not touched (by ownership):** `ShareButton`, `scoreController.js`, `SystemSettings`, team/player controllers, nav flags.
