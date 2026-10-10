# CricAll — Tournament Readiness Audit (Oct 11 fixture)

Branch: `oct11-prompt1` (master `1ac6215`). Scope: audit only — no code changed.
Each feature is marked `Complete`, `Partial`, `Missing`, `Broken`, or
`Needs-production-verification` with file:line evidence. The decisions that
follow this audit live in `TOURNAMENT_IMPLEMENTATION_PLAN.md`; acceptance
criteria live in `TOURNAMENT_ACCEPTANCE_CHECKLIST.md`.

Legend
- `Complete` — exists, tested, no change needed for this event.
- `Partial` — exists but missing something this event needs.
- `Missing` — does not exist anywhere.
- `Broken` — exists but does not work as documented.
- `Needs-production-verification` — code path looks right, untested on live data.

---

## 1. Data-entry path: club → team → player (Phase 1)

### 1.1 Organisations ("clubs") — `Complete`
- `TeamOrganization` model: name/slug/category/type/shortName/logo/privacy/
  verificationStatus/parent/owner/createdBy (`TeamOrganization.js:3-118`).
- Verified orgs are created on demand; `requireOrgApproval` is off by default so
  self-serve/Admin creation never waits on the platform (`SystemSettings.js:19-30`).
- Admin route to create/list orgs exists (`organizationRoutes.js` mounted at
  `/api/organizations`; `organizationController.js`).
- Orgs are NOT part of the bulk import path today (see 1.4).

### 1.2 Teams under a club — `Complete` (singly), `Partial` (search)
- `Team.js`: `organizationRef` → `TeamOrganization`; `type` enum incl.
  `local_team` (default); `category` default `Other`; `isPublic` field.
- Create: `POST /api/teams` via `teamService.createTeam` (`teamsController.js:110-117`).
- Public/Admin list: `teamService.listTeams` (filtered by tenancy scope, only
  org-less + own org unless `scope=organization`/`?organizationRef=`/platform
  admin, `teamsController.js:43-86`).
- Search today matches `name`, `shortName`, `branchName`, `organization`
  (free-text string), `address.city` (`teamService.js:82-90`).
- **Gap:** search does NOT match Mongo `_id` or `organizationRef` `_id`. The
  "4 keys" (team name, club name, team id, club id) from this event's spec are
  therefore 2 of 4 supported server-side.
- **Gap:** club/team counts are surfaced at the org level in the Admin app
  (`branchCount`, `totalPlayers`, `memberCount` — `Admin Teams.jsx:196-198`) but
  the Admin **Teams** page itself filters client-side by a single term against
  `name`/`shortName`/`organization` only (`Admin Teams.jsx:59-61`).

### 1.3 Players — `Partial`
- `Player.js`: name required, `role` free string, `playingRole` enum,
  `battingStyle` enum, `bowlingStyle` enum (incl. "Not Applicable").
- **Gap (schema):** there is NO `phone`, NO `jerseyNumber`, and NO
  `isPartTimeBowler` field declared in the schema. `teamService` writes
  `player.jerseyNumber` dynamically today (works only because Mongoose is not
  strict at the point of use), i.e. jersey numbers are not type-safe.
- Player duplicate detection is **name-only** (`playerService.js:113-115`) — not
  name+team, not phone.
- This event imports 8 clubs × 1–2 teams × ~11–15 players: jersey number and a
  stable duplicate key are required by the spec (`name+team+jersey`, or phone
  **if given**) so imports are idempotent.

### 1.4 Bulk import — `Missing` (in the shape this event needs)
- Current: Excel-only (`xlsx`), `POST /api/bulk-import/players`,
  `POST /api/bulk-import/teams`, `GET .../template`, 5 MB cap
  (`bulkImportController.js`; `bulkImportRoutes.js`).
- **No clubs import.**
- **No dry-run** (preview is a static template download only).
- **No duplicate blocking** against the existing DB — every row is inserted.
- **No** jersey number, phone, captain, vice-captain columns.
- Teams are joined by exact, case-insensitive `findOne({ name })`
  (`bulkImportController.js`), so two clubs with same-named teams collide.
- Frontend `BulkImport.jsx` uploads a file and shows a success count only.
- `bulkImportRoutes` are behind `[protect, requireAdmin]` — no
  `requireVerifiedEmail` (differs from tournament routes).

## 2. Tournament + fixtures (Phase 2, 3)

### 2.1 Competition model choice — decided: **Tournament**
- `Tournament` model has the full create → fixtures → standings story:
  columns `teams[]`, `matches[]`, `pointsTable[]` (per-team
  matchesPlayed/won/lost/tied/noResult/points/netRunRate/for/against/
  wicketsFor/wicketsAgainst/seriesForm), `tournamentSquads[]`
  (`Tournament.js`).
- `Event.pointsTable` is written **once at creation** and has **no recompute
  path**; Tournament points have **4 write paths** (updatePoints, score hook,
  resets, etc.). Event also clamps team count (single-match = 2, multi-team =
  exact `totalTeams`) — irrelevant for a league. ⇒ Tournament is the one path
  made solid.
- Public page already handles all three probe endpoints
  (`/series/:id`, `/events/:id`, `/tournaments/:id`) and renders
  matches / points table / squads / stats; it is reached at
  `/series/:seriesId` (`Frontend/User/src/pages/Series.jsx:30-34,111-129`).
- The public `/series/:id/matches` and `/series/:id/stats` and
  `/series/:id/squads` endpoints are series-only, so Tournament pages fall back
  to per-match fetches — fine, already coded (`Series.jsx:72-108`).

### 2.2 Tournament create/edit/delete — `Complete` (API), `Partial` (owner)
- `POST /api/tournaments`, `PUT/:id`, `DELETE/:id` exist
  (`TournamentController.js:84-209`; `tournamentRoutes.js`), admin-gated
  `[protect, requireAdmin, requireVerifiedEmail]`.
- Create initialises the points table for every team
  (`TournamentController.js:95-109`).
- **Gap:** "creator/owner permission" from this event's spec (only the owner or
  a superadmin edits/deletes) is NOT implemented — any admin can edit any
  tournament. Roles exist (`requireAdmin`, `requireSuperAdmin` —
  `authMiddleware.js:65-75`) and a `createdBy`-style owner column does not
  exist on Tournament.
- Points config (win/tie/NR points, e.g. 2/1/1) is not stored on the model; it
  is hardcoded in `updateTournamentPoints` (`tournamentService.js`).
- `postponed` status is **missing** from `Match.status` enum and from
  `matchController.legalMatchStatuses` (`Match.js:271-275`;
  `matchController.js:12-22`). Required for a Sunday fixture backup story.

### 2.3 Fixture generation — `Missing` (auto), `Complete` (manual)
- Manual: `POST /api/tournaments/:tournamentId/matches`
  (`TournamentController.js:532-583`) — takes team1/team2, venue, startTime,
  matchType; sets matchBy `tournament`, pushes into `tournament.matches`.
- `GET /api/tournaments/:id/fixtures` lists by `tournament` ref sorted by
  `startAt` (`TournamentController.js:363-384`).
- **No auto generator anywhere** (round-robin, knockout, BYE) — the spec's
  "preview then apply, idempotent" generator must be built.
- **Gap:** `createTournamentMatch` does not set `matchNumber`, so the public
  page falls back to `match.title = "<Tournament> - Match"` for every fixture
  (`Series.jsx:400,446,496`).

### 2.4 Points table — `Complete` (recompute), `Partial` (per-match idempotency)
- Recompute from completed matches: `tournamentService.updateTournamentPoints`
  (tie/no-result ⇒ +1 each, winner ⇒ +2), called from `scoreController.js:519`
  when a match completes.
- NRR uses full-quota overs per match (`TournamentController.js:322-336`);
  `scoreController` path carries the authoritative recompute.
- **Gap:** a second completion (re-open + close) could double-count; need a
  guard (e.g. count completed status transitions or clear-and-rebuild). Confirm
  in Phase 3 tests.

## 3. Statuses, match controls — `Partial`
- Valid live statuses: upcoming/toss_done/live/innings_break(-)/completed/
  abandoned/pending_tie_resolution/super_over (`matchController.js:12-22`).
- Add `postponed` in two places (model enum + controller list) and add a
  `rescheduledTo`-style note if desired. Frontends normalise display
  (`upcoming`→"Scheduled" in tabs) and must not rename stored values.
- `tossWinner`, `tossDecision`, `result`, `manOfMatch`, `totalOvers` all exist
  on `Match.js`.

## 4. Share/CSS/appearance (Phase 4)
- `ShareButton` (Shared) = native Web Share API → clipboard fallback
  (`Shared/components/ShareButton.jsx`), already used on the public Series page
  (`Series.jsx:325`) and Player profile (`PlayerProfile.jsx:120`).
- Match page does NOT use `ShareButton`; it has an inline clipboard-only button
  (`Match.jsx:301-307`) with no Web Share API call.
- Canonical public URLs: match `/match/:matchId`, team `/teams/:id`,
  tournament/series `/series/:seriesId`. All links on the public series page use
  these.
- **Gap:** hidden/fixture teams are stripped from public tournament payloads
  (`stripHiddenTeamRefs`, `TournamentController.js:72`), which is what we want
  for a real event; confirm the event's teams are `isPublic: true`.

## 5. Hide non-event sections (Phase 5)
- Nav flags already exist for `international`, `highlights`, `cricketNews`
  (`Frontend/User/src/config/features.js`); `Header.jsx` already respects them.
- **Gap:** `Videos` and `Rankings` are ALWAYS visible — no flag.
- **Gap:** `Player Comparison` and `Blogs` have no flags (Blogs render inline
  via `BlogGallery` on pages; a nav item may not exist but must be verified).
- Rules from specs: hiding must be flag-driven only — routes stay live, direct
  deep links still open, no backend gate.

## 6. AI commentary toggle (Phase 5)
- `aiCommentary.generateBallCommentary` ALWAYS emits a deterministic template;
  Anthropic enrichment only when `ANTHROPIC_API_KEY` is set
  (`aiCommentary.js`).
- Call sites in scoring: `scoreController.js:7` (import), `:233`
  (ball commentary), `~:456-457` (over summary), `:1089` (ball commentary),
  `:1710` (regenerated edited ball commentary). Any toggle must gate every call.
- Platform settings pattern exists: `getPlatformSettings`/
  `setPlatformSettings` with env-default merge (`SystemSettings.js:19-89`);
  `PUT /api/settings/platform` is superadmin-gated (`settingsRoutes.js:15-16`).
  Add `features.aiCommentary` default `false` in
  `DEFAULT_PLATFORM_SETTINGS` + env default + `updatePlatformSettingsHandler`
  patch whitelist (`settingsController.js:109-127`).
- Admin toggle location: Admin app has SyncPanel.jsx (external sync) — a
  superadmin platform-settings toggle needs a home there or in
  ManageAdmins/Settings; find the Admin route in Phase 5.

## 7. Security / data hygiene
- Public board excludes reserved test names (`OPENCODE_TEST_*`) and hidden
  teams (`publicProjection.js:526,550-571`; `TournamentController.js:27-29`).
  Keep — never import real teams named `OPENCODE_TEST_*`.
- Admin-only routes are consistent except bulk import (no
  `requireVerifiedEmail`).
- No crossover risk: org-less teams stay visible; organisation-owned teams
  require explicit scope. Event clubs/teams must be created as org-less or
  owned by the event org and kept `isPublic: true`.

## 8. Test/build baseline
- Backend: `npm test` = `node --test --test-concurrency=1 test/*.test.js
  test/e2e/guardProcNet.test.js` (baseline 378 pass / 0 fail / 1 skip; E2E
  suite 78/78 via `npm run test:e2e`).
- Existing suites that matter here: `teamsService.test.js`, `eventController.test.js`,
  `publicProjection.test.js`, `playerController.test.js`, `scoringEngine.test.js`,
  `superSub.test.js`.
- **No test files exist** for tournament points/flixture generation or bulk import.
- Frontends build via Vite (Admin, User, Shared). No lint scripts defined in
  `Backend/package.json`.

---

## Appendix — Terminal A scope: Teams / Players / Share / Hide (`oct11-A`)

Audited against `d6817e5`; this is the subset Terminal A owns. Tournament and
fixture work is Terminal B's and is out of scope here. Markers as above.

### Club (`TeamOrganization`) creation — `Partial`
- Admin create/list/update exists (`organizationController.js`,
  `organizationRoutes.js`, Admin `pages/Organizations.jsx`); `requireOrgApproval`
  is off by default (`SystemSettings.js:19-30`) so admin creation is immediate.
- No blocking defect found for the owner's flow.

### Team under a club — `Partial`
- Per-org uniqueness `(organizationRef, name)` is enforced by two partial unique
  indexes (`Team.js:192-212`) and `assertTeamNameAvailable`
  (`teamService.js:200-210`).
- **Gap:** `POST /api/teams` swallows `TEAM_NAME_TAKEN` into a generic
  `400 "Failed to create team"` and never names the existing record
  (`teamsController.js:110-117`).
- **Gap:** team search matches name/short/branch/org/city only — not `_id` or
  `organizationRef` (`teamService.js:82-93`).

### Players — `Partial`
- Create/list/update/delete exist (`playerController.js:195-345`); reads are
  projected and privacy-gated (`playerService.js`).
- Schema now carries `phone`, `jerseyNumber`, `isPartTimeBowler` (this branch).
- **Gap:** no duplicate prevention — `createPlayer` inserts unconditionally
  (`playerController.js:195-226`); bulk import inserts every row
  (`bulkImportController.js:52`).

### Captain / vice-captain — `Missing` (team-level)
- Captain/viceCaptain exist at *squad* level on Match/Event/Tournament
  (`Match.js:314-315`, `Event.js:75-76`, `Tournament.js:123-124`) but not on
  `Team`; `TeamForm.jsx` (Players tab) has no C/VC control.

### Bulk import (`/admin/bulk-import`) — `Partial`
- Excel players/teams import + templates exist (`bulkImportController.js`,
  `bulkImportRoutes.js`). Teams are joined by case-insensitive name; players are
  inserted unconditionally; no club import, no dry-run, no phone/jersey columns.
- Route is `[protect, requireAdmin]` without `requireVerifiedEmail`
  (`bulkImportRoutes.js:12`).

### Share buttons — `Partial`
- `ShareButton` (Web Share API → clipboard fallback) exists
  (`Frontend/Shared/components/ShareButton.jsx`) and is used on the public Series
  page and Player profile.
- **Gap:** the Match page uses an inline clipboard-only button
  (`User/src/pages/Match.jsx`), and the User team profile has no share control.

### Hide sections (nav flags) — `Partial`
- Flags exist for `international`, `highlights`, `cricketNews`
  (`Frontend/User/src/config/features.js`); `Header.jsx` respects them.
- **Gap:** Videos, Rankings, Player Comparison, Blogs have no flags.

### AI commentary toggle — `Missing`
- `aiCommentary.*` is called unconditionally in `scoreController.js:233`,
  `:456-457`, `:1089`, `:1710`; there is no on/off flag. `SystemSettings`
  platform settings exist and are superadmin-writable
  (`SystemSettings.js:70-89`, `settingsRoutes.js:15-16`).

## 9. oct11-B re-audit: Tournament/Fixtures only (Saturday 10 Oct 2026)

Branch `oct11-B` (Prompt 1, Terminal B). Quick re-check of the sections this
exercise owns, with file:line evidence. Chosen path: **Tournament** — it is the
one model with a working create → fixtures → standings story
(`Tournament.js:28-35,49-66`), a public renderer that already probes it
(`Frontend/User/src/pages/Series.jsx:30-34,111-129`), and 4 point-table write
paths. Event/Series are deliberately untouched (no merge).

| Feature | Status | Evidence |
|---|---|---|
| Tournament create | `Partial` | exists (`TournamentController.js:84-145`) but: no `createdByAdmin` owner, no `pointsConfig`, team-count rule is a flat `>=2` (`:88-92`), no team-existence/duplicate check. `format` enum lacks "T6"/"T8" labels the admin form sends. |
| Tournament edit/delete | `Partial` | exist (`:147-209`) but any admin may edit any tournament; `Object.assign(tournament, req.body)` (`:155`) is unwhitelisted. Owner-only rule missing. |
| Match status `postponed` | `Missing` | absent from `Match.js:273` enum and `matchController.js:12-22`. |
| Manual fixture create | `Partial`/`Broken` | `createTournamentMatch` (`TournamentController.js:532-583`) sets `matchCategory: "league"` → **fails enum validation** (`Match.js:191-205` has no "league" value; `validateModifiedOnly` validates set paths) → any real manual create likely 500s. No same-team check, no both-in-tournament check, no no-duplicate check, no double-booking check, sets no `matchNumber`. |
| Fixture auto-generation | `Missing` | no preview/apply endpoints anywhere. |
| Points recompute idempotency | `Partial` | `updateTournamentPoints` (`tournamentService.js:4-102`) rebuilds from scratch (good) but: treats tie AND no-result as `tied` (`:45-51`, no `noResult` counter, no `NR` form), NRR is `(rf-ra)/20` hardcoded (`:93`), points 2/1/1 hardcoded, no `pointsConfig`. Manual `updatePointsTable` (`TournamentController.js:236-361`) is an incremental adder → double-counts on re-run. |
| Public tabs | `Partial` | `Series.jsx:284-289` always shows Matches/Points/Stats/Squads regardless of content; no Home/Teams/Awards; `postponed`/`abandoned` fall out of all three buckets (`:292-294`). ShareButton already present (`:325`). |
| Admin fixtures dashboard | `Missing` | `Tournamentmanagement.jsx` is not even routed in `Admin/src/App.jsx`; its fixtures modal reads `match.team1/team2/startTime` fields that Match docs don't have (`:265-267`). No group/date dashboard, no one-click Reschedule/Postpone/Abandon. |

Decisions (carried into `TOURNAMENT_IMPLEMENTATION_PLAN.md` and this branch's
commits): keep `Tournament` as the single path; add `createdByAdmin` +
`pointsConfig`; enforce team-count by `type` (knockout ≥2, league ≥3,
group-stage/mixed ≥4); add `postponed`; add `round`/`group` to Match for
"same pair + round" dedupe and grouped dashboards; make `updateTournamentPoints`
points-config-aware and no-result-correct; make the manual points route
recompute via the service instead of incrementing.
