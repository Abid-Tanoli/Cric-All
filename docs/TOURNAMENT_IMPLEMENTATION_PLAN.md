# CricAll — Implementation Plan (Oct 11 tournament event)

Branch `oct11-prompt1`. Only the items this event actually needs are listed:
anything marked `Complete` in `TOURNAMENT_READINESS_AUDIT.md` is deliberately
not changed. Order is the order the phases run; each phase ends with `npm test`
(`--test-concurrency=1`) green + a local commit. Nothing is pushed until the
owner confirms.

Goal recap (owner): create 8 clubs' teams + players with real data, create the
tournament and its fixtures, surface it publicly with shareable canonical
links, and hide non-event sections from the public header.

---

## Phase 1 — Club/team/player data entry (make real data easy + safe)

Why: single-create works but the Admin app has no club-import path, search is
2-of-4 keys, and there is no counts summary on the Admin Teams page.

1. **Schema (additive, backward-safe)**
   - `Player.js`: add `jerseyNumber` (Number, default none) and `phone`
     (String, trimmed). Add `isPartTimeBowler` Boolean default `false` ONLY if
     it is confirmed absent (audit says absent). No removal of existing fields.
   - Keep `role` free-string (existing).
2. **Bulk import → CSV + clubs + dry-run + idempotent**
   - Add `GET /api/bulk-import/clubs`, `.../teams`, `.../players` template
     endpoints (CSV) and a unified `POST /api/bulk-import/run` endpoint whose
     body is an uploaded CSV with columns:
     `club_name, team_name, player_name, role, batting_style, bowling_style,
     jersey_no, phone, is_captain, is_vice_captain`
   - Dry-run by default: responds `{ totalRows, newClubs, newTeams, newPlayers,
     duplicates, errors }` WITHOUT writing. `?apply=true` (or a
     `shouldApply` flag) performs inserts.
   - Idempotency / duplicates, enforced in the backend:
     - Club: unique by trimmed lower-case `name`.
     - Team: unique by (`name` + `organizationRef`).
     - Player: unique by (normalized name + team + jerseyNumber), or by
       (`phone`) when provided.
   - Import sets `isPublic: true` on created teams and players (real event data).
   - Keep Excel endpoints intact (no regressions); route behind
     `[protect, requireAdmin, requireVerifiedEmail]` to match tournament routes.
   - `BulkImport.jsx`: upload → dry-run preview → confirm → `apply` →
     result summary.
3. **Search by 4 keys (backend + Admin Teams page)**
   - `teamService.listTeams`: when `search` looks like a valid `ObjectId`, also
     `$or`-match `_id` and `organizationRef`. Keep existing regex escaping
     (`teamService.js:82-90`). Never let a non-ObjectId crash.
   - Admin `Teams.jsx`: pass `search` server-side; keys = team name, club name,
     team `_id`, club `_id`.
4. **Counts on Admin Teams page**
   - Show per-club: `branchCount`, `totalPlayers` (surface what
     `Organizations.jsx:196-198` already reads for orgs) on the club rows.
5. **Tests** (`Backend/test/`): duplicate team, duplicate player, import
   dry-run writes nothing, import apply is idempotent (run twice ⇒ same rows),
   search by each of the 4 keys, regex-escape a search like `a.c` matches
   literally.

## Phase 2 — Tournament lifecycle hardening

1. **Owner/scoping (spec: only owner or superadmin edits/deletes)**
   - Add `createdByAdmin` (ObjectId → Admin) to `Tournament`, set on create.
   - `PUT /api/tournaments/:id`, `DELETE /api/tournaments/:id`,
     `POST .../update-points`, squad + match create: allow when requester is
     `superadmin` OR `createdByAdmin` matches; otherwise 403. Audit the
     decision via `recordAudit` (`utils/audit.js`).
   - Keep GET endpoints wide-open/public.
2. **Status `postponed`**
   - Add to `Match.status` enum (`Match.js:271-275`) and
     `matchController.legalMatchStatuses` (`matchController.js:12-22`).
   - Frontends: display-mapping only. Treat `postponed` as non-live,
     non-completed in `Series.jsx` grouping (`Series.jsx:291-294`), in
     `Match.jsx` player view, and anywhere `legalMatchStatuses` drives a
     "ready to score" gate.
   - Match model: nothing stored is renamed (`upcoming` stays `upcoming`).
3. **Points config on the model (optional-but-safe)**
   - If time allows: add `pointsConfig: { win, tie, noResult }` to Tournament
     (default 2/1/1) and read it in
     `tournamentService.updateTournamentPoints`; otherwise keep the hardcoded
     2/1/1 and document that choice. Default behaviour is unchanged either way.
4. **Double-count guard**
   - `updateTournamentPoints` path: recompute the table from scratch idempotently
     (mark whether the match was already folded in) so re-completing a match
     never double-counts. Add a regression test.

## Phase 3 — Fixture auto-generation (preview → apply, idempotent)

1. **New endpoints** under tournament routes:
   - `POST /api/tournaments/:id/fixtures/preview` — body `{ type, startAt,
     gapHours, venue }`; type `round-robin` (single leg; BYEs for odd teams) or
     `knockout`. Returns the proposed match list WITHOUT persisting, including
     exact team pairings and match numbers.
   - `POST /api/tournaments/:id/fixtures/apply` — persists the previewed
     matches (each a `Match` with `tournament`, `matchNumber`, `startAt`,
     `venue`, `status: upcoming`, `teams`), appends ids to `tournament.matches`.
   - Idempotency: if the tournament already has matches with the same
     `matchNumber` for the same pairing, re-apply is a no-op (report 0 new).
   - Gated by Phase-2 owner/superadmin rule.
2. **`createTournamentMatch` fix**
   - Set `matchNumber` (sequence) so the public page shows "Match N" instead of
     "<Tournament> - Match" (`Series.jsx:400,446,496`).
3. **Manual single-add remains** (already exists) — used for re-scheduling.
4. **Tests**: round-robin pairing correctness for 8 teams (28 matches, no
   self-pairs), odd-count BYE handling, preview persists nothing, apply
   twice = idempotent, fixture list sorted by `startAt`.

## Phase 4 — Shares are public + canonical

1. **Match page**: replace inline clipboard-only Share button
   (`Match.jsx:301-307`) with the shared `ShareButton` (native share → clipboard
   fallback), sharing the canonical public URL
   `origin + /match/<id>`.
2. **Series/Tournament page** already uses `ShareButton`
   (`Series.jsx:325`) — verify it shares `window.location.href` (canonical
   `/series/:seriesId`), no change expected.
3. Team pages: verify `TeamProfile.jsx`(User) has a share control for
   `/teams/:id`; add `ShareButton` if missing.
4. Confirm every share target uses the public host (origin from
   `window.location`) — never the Admin app URL.
5. **Verification**: two-page check — open Match page, share; open public series
   page, share; links land on canonical public routes while logged out.

## Phase 5 — Hide non-event sections + AI commentary toggle (feature flags)

1. **Flags for remaining sections** (`Frontend/User/src/config/features.js`,
   `Header.jsx`):
   - `VITE_SHOW_VIDEOS` (today always-true), `VITE_SHOW_RANKINGS` (today
     always-true), `VITE_SHOW_PLAYER_COMPARISON`, `VITE_SHOW_BLOGS`.
   - Hide = flag off ⇒ nav item gone; routes stay live, deep links still work.
   - Target for this event: News, Videos, Highlights, Rankings, Player
     Comparison, Blogs hidden; Matches, Series, Teams, Players (+ Home) shown.
2. **AI commentary gate** (`features.aiCommentary`, default `false`):
   - `DEFAULT_PLATFORM_SETTINGS` + env default + `updatePlatformSettingsHandler`
     whitelist (`SystemSettings.js`; `settingsController.js:109-127`).
   - In `scoreController.js`, wrap the 4 `aiCommentary.*` calls
     (`:233`, `~:456-457`, `:1089`, `:1710`) so no AI call is made when off
     (template commentary still emitted — `aiCommentary` already does this
     without a key).
   - Superadmin toggle UI in the Admin app (SyncPanel or a Settings panel;
     locate the Admin route in this phase), backed by the existing
     `GET/PUT /api/settings/platform`.
3. **Tests**: gate-on makes AI path available; gate-off yields zero
   `aiCommentary` invocations in a full scored-innings flow; flags remove nav
   items without breaking routes.

## Phase 6 — Real data + verify + hand off

1. **Live data** (idempotent, dry-run default, `--apply` explicit):
   - 8 clubs, their 1–2 teams, 11–15 players each (real names), with jersey
     numbers and captains/vice-captains per Phase 1 import.
   - Verify counts: 8 clubs, ≥8 teams, ≥88 players, no duplicates.
   - Create the tournament: league type, 2026-10-11 window, all teams, venue,
     format matching the event's matchType.
   - Generate fixtures via Phase 3 (preview → apply), 1 team = 1 match per
     available slot if it is a pull/group round, else round-robin.
   - Set squads per team (11–20) incl. captain/vice-captain.
2. **Verification**
   - `npm test` (`--test-concurrency=1`): all suites green, report any new
     failures honestly with repro.
   - `npm run test:e2e` green.
   - Both frontends (Admin, User) build.
   - Public walk-through logged-out: home → series page → points table →
     match pages → shares.
   - Spot-check hidden sections are gone from header, deep links still work.
   - Confirm OpenAI/AI toggle off, superadmin toggle present.
3. **Commit + hand off**
   - Commits stay on `oct11-prompt1`, never pushed without owner confirmation.
   - Final report per phase: `Complete-untouched` / files changed / tests run /
     PASS-FAIL / known gaps / what Prompt 2 must cover (deploy, env vars,
     VITE flags for the production build).

## Out of scope (do NOT build)
- Match/reschedule workflows beyond the `postponed` status.
- Redesign of the Event model or merge of Event/Tournament.
- Public player/team bulk-open registration flows.
- Removing or merging current `Videos`/`Rankings`/`News` routes (hide only).

## Owner decisions explicitly deferred to them
1. Round structure (round-robin full league vs single round vs knockout) — set
   during data creation; generator supports all three.
2. Whether the event's clubs/teams are organisation-owned (tenant) or org-less
   platform teams on the public board — either works; import supports both via
   `club_name`.<