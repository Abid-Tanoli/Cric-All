# CricAll — Acceptance Checklist (Oct 11 tournament event)

Branch `oct11-prompt1`. Tests run locally: `npm test` (Backend,
`--test-concurrency=1`), `npm run test:e2e`, Vite build of Admin + User.
This list is the "definition of done" for each phase and the final hand-off.

---

## Phase 1 — Data entry
- [ ] Player schema has `jerseyNumber`, `phone`, and `isPartTimeBowler`
      (default false) with no field removed from existing documents.
- [ ] Bulk import accepts CSV with columns:
      `club_name, team_name, player_name, role, batting_style, bowling_style,
      jersey_no, phone, is_captain, is_vice_captain`.
- [ ] Dry-run (default) returns `totalRows / newClubs / newTeams / newPlayers /
      duplicates / errors` and writes NOTHING to the DB.
- [ ] `apply` creates clubs (unique lower-case name), teams (unique
      name+organizationRef), players (unique name+team+jersey, or phone).
- [ ] Import is idempotent: running the same file twice creates no new rows.
- [ ] Import creates teams/players with `isPublic: true`.
- [ ] `POST /run` is behind `[protect, requireAdmin, requireVerifiedEmail]`.
- [ ] Excel endpoints and templates still work.
- [ ] Search (Admin Teams + backend) matches: team name, club name, team `_id`,
      club `_id`; a regex-y search like `a.c` matches literally.
- [ ] Admin Teams page shows per-club `branchCount` and `totalPlayers`.
- [ ] New tests: duplicate team, duplicate player, dry-run no-write, apply
      idempotent, 4-key search, regex escaping.
- [ ] `npm test` green.

## Phase 2 — Tournament lifecycle
- [ ] Tournament stores `createdByAdmin`; PUT/DELETE/update-points/squad/match
      allowed for the creator or superadmin only; 403 otherwise; audited.
- [ ] `postponed` added to `Match.status` enum and `legalMatchStatuses`.
- [ ] Display mapping only — stored `upcoming` unchanged; `postponed` is
      non-live, non-completed in public grouping.
- [ ] Points recompute is idempotent (re-completing a match never double-counts);
      regression test added.
- [ ] (Optional if time) `pointsConfig` on Tournament, default 2/1/1.
- [ ] `npm test` green.

## Phase 3 — Fixture generation
- [ ] `POST /:id/fixtures/preview` returns pairings + match numbers for
      `round-robin` (BYE on odd teams) and `knockout` without persisting.
- [ ] `POST /:id/fixtures/apply` persists matches (matchNumber, startAt, venue,
      status `upcoming`, teams) and links them to the tournament.
- [ ] Re-apply is a no-op for already-generated pairings.
- [ ] `createTournamentMatch` writes `matchNumber` (public page shows "Match N").
- [ ] Owner/superadmin gate applies to generation endpoints.
- [ ] Tests: 8-team round-robin = 28 matches, no self-pairs; odd BYEs; preview
      writes nothing; apply idempotent; fixtures sorted by startAt.
- [ ] `npm test` green.

## Phase 4 — Share links
- [ ] Public pages share canonical URLs: match → `/match/:id`,
      team → `/teams/:id`, tournament → `/series/:seriesId`.
- [ ] Match page uses shared `ShareButton` (Web Share → clipboard fallback).
- [ ] Shares never reference the Admin app URL.
- [ ] Share links open logged-out and land on the right pages.
- [ ] `npm test` green.

## Phase 5 — Flags + AI toggle
- [ ] `VITE_SHOW_VIDEOS`, `VITE_SHOW_RANKINGS`, `VITE_SHOW_PLAYER_COMPARISON`,
      `VITE_SHOW_BLOGS` exist and default ON; with all off the header shows only
      Home, Matches, Series, Teams, Players.
- [ ] Hiding is nav-only; routes still load when deep-linked.
- [ ] `features.aiCommentary` default `false`; when off, zero `aiCommentary.*`
      calls in a full scored innings (template commentary still generated).
- [ ] Superadmin can flip the AI flag via the Admin app, backed by
      `GET/PUT /api/settings/platform`.
- [ ] Tests: gate-off yields no AI calls; flags hide nav without breaking routes.
- [ ] `npm test` green.

## Phase 6 — Real data + hand off
- [ ] 8 clubs × 1–2 teams × 11–15 players imported (real names), dry-run
      confirmed, then applied once.
- [ ] Counts verified: 8 clubs / ≥8 teams / ≥88 players / 0 duplicates via
      re-dry-run.
- [ ] Tournament created: league, 11 Oct 2026 window, all teams, venue, format.
- [ ] Fixtures previewed and applied; squads (11–20 incl. C/VC/WK) set per team.
- [ ] No team/player named like `OPENCODE_TEST_*` in the DB.
- [ ] `npm test` green, `npm run test:e2e` green, Admin + User Vite builds pass.
- [ ] Public logged-out walk-through: home → series → points → match → share.
- [ ] Hidden sections gone from header; deep links still work; AI commentary off
      by default; toggle visible to superadmin.
- [ ] All commits on `oct11-prompt1`; nothing pushed.
- [ ] Final per-phase report written (Complete-untouched / files changed / tests
      / PASS-FAIL / known gaps / Prompt-2 needs).

## Gate for deploy (Prompt 2, owner-confirmed push)
- [ ] Owner reviewed the per-phase report and approved the branch.
- [ ] Production env vars/VITE flags set for build (International/Highlights/
      News/News triggers documented).
- [ ] Backup taken before any production data script runs.
- [ ] No secrets in commits or logs.