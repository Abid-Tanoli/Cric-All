# Club-owner journey audit — CricAll

**Date:** 2026-11-24
**Branch:** `docs/club-owner-audit`
**Base:** `origin/master` at `4626134` (latest master at audit time)
**Scope:** static, read-only inspection of `Backend/src`, `Frontend/User/src`, `Frontend/Admin/src`, `Frontend/Shared`, route/validator/model files, and existing docs. No code was changed, no tests were re-run, no database/VPS was touched.

**Method:** five parallel code audits (players/roles, match setup, live scoring/stats, public pages/media, sharing/PWA/storage), cross-checked against the central permission map, the User-app router, and spot checks of upload/storage code. Claims are marked **EXISTS & WORKS** / **PARTLY** / **MISSING**. "Works" means the code path is present and internally coherent; it is not a claim that a deployed instance was exercised. Where the answer depends on runtime configuration or database contents, this report says **Cannot tell from code** rather than guessing.

**Size** = rough size of the *remaining* work (small / medium / large), including backend, UI and tests.

**Permission names below are the literal strings from code.** The org permission vocabulary is in `Backend/src/permissions/orgPermissions.js:9-26`; role→permission map at `:88-119`; the guard that enforces it is `Backend/src/middleware/orgAccess.js:90-141`. An owner is authorized by an **active `Membership` with `roles` containing `"owner"`**, never by data in the request body. Platform admins bypass all org checks with the full permission set (`orgAccess.js:107-115`).

---

## 0. Verdict at a glance

| # | Step | Status | Permission needed | Missing work |
|---|---|---|---|---|
| 1 | Squad players: no-account add, edit/remove, photo, jersey, roles | **PARTLY** (API solid, owner UI thin) | `manage_players`; quick-add UI is gated by `create_match`; photo upload is platform-admin-only | **medium** |
| 2 | Invite members with roles | **EXISTS & WORKS** (but no role literally named `scorer`; roles are org-wide) | `invite_members` to invite, `manage_members` to edit/unlink, owner-only for ownership transfer | **small** |
| 3 | Create/schedule match, overs/rules, squads/XI, toss | **PARTLY** (own-org fixtures work; cross-org only as tournament guest; ad-hoc opponent MISSING) | `create_match` for fixtures/XI/toss/scorer assignment; `manage_competitions` for tournaments and 12th-man toggle | **large** |
| 4 | Assign scorer, live scoring, result, scorecard, stats | **PARTLY→mostly works** (E2E flow exists, non-owner scorer works; propagation gaps) | `score_match` to bowl/end innings/set result/MOM; `create_match` to assign scorers and set XI/toss; `invite_members` to add `score_handler` | **medium** |
| 5 | Public club/team home | **PARTLY** (team page exists; club page MISSING) | public reads require `Team.isPublic = true`; no permission for a club page (proposed) | **medium** |
| 6 | Media, gallery, blog/news | **PARTLY→mostly MISSING for owners** (tournament/admin versions work) | `publish_content` is declared but unused by these endpoints; today blogs/uploads/tournament media require platform `requireAdmin`; tournament sponsors/settings use `manage_competitions` | **large** |
| 7 | Sharing, OBS overlay, social cards, PWA | **PARTLY→mostly works** (overlay + PWA solid; match social card missing; owner notifications missing) | public for share/overlay/PWA; OBS copy-link appears on owner fixture list (`create_match` gate) | **medium** |
| 8 | Other owner expectations | **PARTLY** (dashboard/audit/multi-org/mobile scoring exist) | `view_analytics` / active membership for dashboard | **large** if all extras are in scope |

**One-line summary:** the *tenant/permission/plumbing* layer is mature; the missing surface is (a) owner-facing squad and scorer UI, (b) a public club page, (c) owner-owned media/news, (d) ad-hoc opponents, and (e) a few post-match propagation hooks.

---

## 1. Add players to the squad (no account), edit/remove, photos, jersey numbers, roles

### What exists

**Accountless player creation — EXISTS & WORKS (backend).**
`POST /api/organizations/:id/teams/:teamId/players` is guarded by `protect`, `requireVerifiedEmail`, `validateObjectId`, `requireOrgPermission("manage_players")` (`Backend/src/routes/organizationRoutes.js:263-268`, `:283`). The controller scopes the team by `organizationRef: req.org._id` (`:38-50`), duplicate-checks name/team/phone, creates a `Player` with `name`, `role`, optional `playingRole`/`phone`, `team`, `createdBy`, and appends it to `Team.players` (`orgTeamsController.js:254-292`). No `User` document is created or linked — `Player` has `createdBy` but no `user` field (`Backend/src/models/Player.js:150-154`). The strict inline schema accepts only `name`, `role`, `phone` (`Backend/src/validators/teamValidators.js:127-144`).

**Edit / remove — EXISTS & WORKS (backend).**
- `PUT /api/players/:id` uses per-player access: platform admin, creator, or active member of the owning org with `manage_players` (`Backend/src/middleware/playerAccess.js:42-72`; `playerController.js:273-326`). Non-admins cannot change `team`/`stats` (`:90-102`).
- `PUT /api/organizations/:id/teams/:teamId/players/:playerId` accepts only `role` and `jerseyNumber` (`teamValidators.js:146-151`; `teamService.js:579-590`; audited at `orgTeamsController.js:334-360`).
- `DELETE /api/organizations/:id/teams/:teamId/players` removes from `Team.players` and nulls `player.team` (`teamService.js:554-577`; `orgTeamsController.js:308-332`).
- Hard `DELETE /api/players/:id` also exists for the same access class (`playerRoutes.js:100`, `playerController.js:369-404`), with image cleanup and audit.

**Data fields — PARTLY.**
`Player.imageUrl` (`:75`), `jerseyNumber` (`:81-83`), free-text `role` and enum `playingRole` (`:7-13`) all exist. `PlayerProfile` displays jersey and `playingRole || role` (`Frontend/User/src/pages/PlayerProfile.jsx:94-95`, `:698-704`; `TeamProfile.jsx:438-441`).

### What is missing / does not work for an owner

1. **No owner squad-manager UI.** `OrgTeams.jsx` creates/edits teams and toggles visibility but has no add/edit/remove player control, and even says squads are edited on the team page (`Frontend/User/src/pages/organization/OrgTeams.jsx:249-347`). The public `TeamProfile` Squad tab is read-only cards/links (`:415-468`). The API wrappers `updateOrgTeamPlayerRole` and `removeOrgTeamPlayers` exist in `Frontend/User/src/services/organizationApi.js:114-118` but have **no JSX caller**.
2. **Only a minimal quick-add** exists in fixture setup (`OrgMatches.jsx:210-244`, `:484-551`) and scoring setup (`OrgMatchScoring.jsx:121-162`), sending only `name`/`role`/`phone`. Worse, that UI is gated by `canManage` derived from **`create_match`**, not `manage_players` (`MyOrganization.jsx:204-214`, `:355-363`).
3. **Photo upload is platform-admin-only.** `POST /api/upload/image` uses `adminOnly = [protect, requireAdmin, requireVerifiedEmail]` (`uploadRoutes.js:4-7,36`). Owners can only paste an image URL (`MyPlayers.jsx:104-106`, `CreatePlayerProfile.jsx:136-139`). The inline accountless add cannot set a photo at all.
4. **Jersey is backend-only.** The non-admin player validator does not accept `jerseyNumber` (`playerValidators.js:200-232`); the org squad endpoint does (`teamValidators.js:146-151`) but has no UI. `teamService.assignPlayerToTeam()` takes a `jerseyNumber` parameter and never writes it — dead parameter (`teamService.js:523-552`).
5. **Role drift.** The squad role endpoint updates `role` only, not `playingRole` (`teamService.js:579-590`), while `TeamProfile` displays `playingRole` first — a role change can be invisible on the public page.
6. **Free-agent attachment restriction.** An owner cannot attach an unattached player created by another account (`orgTeamsController.js:243-248` requires `createdBy === req.user`).
7. **Delete-policy inconsistency.** Almost every org-owned hard delete requires `requirePlatformAdminDelete` (`orgAccess.js:162-176`; `organizationRoutes.js:160,223,239,273-281`), but player hard-delete does not.

**Permission summary:** `manage_players` for all org squad APIs; generic `PUT/DELETE /players/:id` uses the same permission via `playerAccess`; photo *upload* currently needs platform `requireAdmin`.
**Remaining size: medium** (backend fixes small; owner squad UI is the bulk).

---

## 2. Invite members with roles (captain, scorer, manager) and what each may do

### EXISTS & WORKS

Routes: invitations `GET/POST` need `invite_members`, revoke needs `invite_members` plus `requirePlatformAdminDelete` for the hard delete, direct add needs `invite_members`, role edit/unlink needs `manage_members`, ownership transfer needs `requireOrgOwner` (`Backend/src/routes/organizationRoutes.js:220-240,230-232,237-240`).

Invitation roles are validated against `ORG_ROLES` (1–6 roles) (`Backend/src/validators/orgValidators.js:135-138,173-189`; `Invitation.js:58-61`). Owners may invite every role **except `owner`**; non-owners cannot grant `owner`/`admin` (`membershipController.js:468-485`). Tokens are generated/hashed, emailed/SMSed, rate-limited (60/hour per org, 40/hour per inviter: `invitationRateLimit.js:3-5,25`) and audited (`membershipController.js:536-562,578-646`). Acceptance requires a verified address owned by the invitee (`:800-861`) and creates/updates the `Membership` (`:863-903`).

UI: `OrgInvitations.jsx:35-38,99-108,156-175`, `OrgMembers.jsx:24-99,162-205,278-308,392-447`, `InvitationAccept.jsx:19-55,104-153`. Role labels/descriptions are shared from `orgPermissions.js:49-77` via `Frontend/User/src/lib/orgUi.js:23-66`.

### Exact role → permission table (from code, `orgPermissions.js:88-119`)

| Org role | Permissions |
|---|---|
| `owner` | all 12 permissions |
| `admin` | all 12 permissions |
| `manager` | `manage_teams`, `manage_players`, `create_match`, `score_match`, `publish_content`, `moderate_comments`, `manage_social_links`, `view_analytics` |
| `team_manager` | `manage_teams`, `manage_players`, `view_analytics` |
| `coach` | `manage_players`, `view_analytics` |
| `captain` | `manage_players`, `view_analytics` |
| `vice_captain` | `view_analytics` |
| `score_handler` | `score_match`, `view_analytics` |
| `social_media_handler` | `publish_content`, `manage_social_links`, `view_analytics` |
| `content_manager` | `publish_content`, `moderate_comments`, `manage_social_links`, `view_analytics` |
| `player`, `staff` | `view_analytics` |

The 12 permissions are `manage_org`, `manage_members`, `invite_members`, `manage_teams`, `manage_players`, `create_match`, `manage_competitions`, `score_match`, `publish_content`, `moderate_comments`, `manage_social_links`, `view_analytics` (`orgPermissions.js:9-26`). Note `manager` deliberately does **not** have `manage_competitions` (comment at `:16-19`).

### Caveats

- **There is no org role literally named `scorer`.** Use `score_handler` ("Score Handler"). `scorer` exists only as a platform `User.role` enum value (`User.js:78-83`) and would be rejected by the invitation Zod enum.
- **Org roles are org-wide, not team-specific.** One `Membership` row per `(organization, user)` with a `roles[]` array and no team field (`Membership.js:8-23,47`). Standing team captain/vice-captain are `Player` refs on `Team` (`Team.js:131-136`); per-match captain is separate (`OrgMatches.jsx:553-569`).
- A "Make owner" control is shown in Members UI to anyone with `manage_members`, but the backend requires the literal `owner` role (`OrgMembers.jsx:278-285` vs `organizationRoutes.js:230-232`, `orgAccess.js:178-211`).
- `publish_content`, `manage_social_links`, `moderate_comments` are granted but are **not enforced** by any blog/media/article endpoint (see §6).

**Remaining size: small** — mostly terminology/UI clarity and optional team-scoped roles; the invite system itself is complete.

---

## 3. Create a match between two teams, schedule, overs/rules, squads/XI, toss

### Works today

**Standalone org fixture — EXISTS & WORKS.**
`POST /api/organizations/:id/matches` is guarded by `requireOrgPermission(PERMISSIONS.CREATE_MATCH)` (`organizationRoutes.js:299-301,332`). `createOrgMatchSchema` is strict and accepts `title`, `venue`, `matchType`, `startAt`, exactly two ObjectId `teams`, `eventId`, `tournamentId`, `series`, `seriesMatchNumber`, `useAiCommentary` (`Backend/src/validators/matchValidators.js:64-85`). `createOrgMatch` resolves both teams, verifies they belong to the org (`orgMatchesController.js:35-47,214-220`), stamps `organizationRef: req.org._id`, status `upcoming`, seeds innings and audits (`:245-282`). `Match` carries `venue` (`:209-212`), `matchType` enum (`:213-217`), `address` (`:309-315`), `startAt` (`:332-334`), `totalOvers` (`:322-325`), `tossWinner`/`tossDecision` (`:365-366`), `playingXI`/`squad15`/`twelfthMan`/`superSub`/`impactPlayers`/`bowlingXI`/`teamRoles` (`:414-462`), and pre-save derives overs/powerplay from `matchType` (`:554-578`).

Frontend calls it: `organizationApi.js:130-136`; `OrgMatches.jsx:663-700` (create payload at `:683-691`), edit at `:1030-1043`, "call off" via `status: "abandoned"` at `:862-874`. Team selectors come from `listOrgTeamsManaged` (`:728-747,843-855`). `GET/PATCH` use active membership / `create_match`; **`DELETE` requires platform admin** (`organizationRoutes.js:304-309,331-334`).

**Squads / XI / toss — EXISTS & WORKS with caveats.**
Squad resolution order is tournament squad → event squad → team roster (`matchController.js:128-179`); `getMatchSquads` returns squad/XI/bench (`:1058-1149`). `setPlayingXI` requires exactly 11 unique squad players, reserves outside XI, bowling-XI consistency (`:1351-1457`); team roles require XI first (`:2144-2251`). The User UI wires `getMatchSquads` → `setPlayingXI`/roles/toss (OrgMatches.jsx:76-112,261-345; `organizationApi.js:149-167`; hooks at `Frontend/Shared/scoring/hooks/useMatchScoring.js:805-894`). `updateToss` sets winner/decision, `toss_done`, and swaps innings teams (`matchController.js:1519-1586`).

**Tournament/series fixtures — EXISTS & WORKS.** `tournamentFixture.js:211-280` validates both teams are in the tournament, derives type/venue/overs, allows `startAt: null` for TBD knockouts, and inherits the host org as `organizationRef`. UI: `OrgTournamentDetail.jsx:761-787,856-887`; `OrgSeriesDetail.jsx:170-198,447-470`.

### Gaps

1. **Opponent from another organization — PARTLY.** Guest teams work **only inside a host-owned tournament**: register any existing `Team` ObjectId as a guest (`orgMatchesController.js:60-92`; `orgCompetitionsController.js:45-55`), search the public catalogue in the UI (`OrgTournamentDetail.jsx:512-548,601-628`), then create tournament fixtures. Standalone fixtures reject cross-org teams with `422 MATCH_TEAM_NOT_IN_ORG` (`orgMatchesController.js:35-47`), and the generic `MatchForm` does not expose `tournamentId` (`OrgMatches.jsx:683-691`). Also, the optional org bulk-squad endpoint `setOrgMatchSquads` loads rosters only for `organizationRef === req.org._id`, so guest players are rejected (`orgMatchesController.js:407-447`); it has no UI caller. The working guest path is tournament squads + `getMatchSquads` → `setPlayingXI`.
2. **Opponent not on CricAll — MISSING.** `Match.teams` are required `ObjectId` refs (`Match.js:335-339`) and the strict schema accepts only two ObjectIds (`matchValidators.js:64-85`). No free-text/ad-hoc/external/custom-team implementation was found in backend or frontend.
3. **Explicit overs/rules from owner UI — PARTLY.** Org schemas reject `totalOvers`, `maxBowlerOvers`, `powerplayConfig`, `address`, `rules`, so owners get format-derived overs only. `maxBowlerOvers` is consumed by `bowlerRules.js:19-22` but has no write endpoint. Platform admins can set these via `PUT /matches/:id` / `/format` (`matchRoutes.js:181-197`). A per-match 12th-man toggle exists for `manage_competitions` (`organizationRoutes.js:337-345`) but has no User-app caller; tournament-level toggle does (`CompetitionForms.jsx:175-185`).
4. **Toss validation gap.** `updateToss` does not verify `tossWinnerId` is one of the fixture's two teams — any non-team1 id falls through as team2 (`matchController.js:1535-1556`). The route uses `SCORE_MATCH`, so a `score_handler` may call toss even though the User UI blocks setup without `create_match` (`matchRoutes.js:198`; `OrgMatchScoring.jsx:193-199`).
5. Owner cannot hard-delete a match (by design: platform-admin-only delete).

**Remaining size: large** (ad-hoc opponent touches model, validator, controllers, public projection, UI and scorecard; explicit rules are small in comparison).

---

## 4. Assign a scorer, live scoring end to end, result, scorecard, stats

### Works today

**Role and permission — EXISTS & WORKS.** `score_match` is a permission (`orgPermissions.js:21`); `score_handler` has `score_match` + `view_analytics` (`:105`); owner/admin/manager also have it (`:88-100`).

**Assignment — EXISTS & WORKS (backend + Admin UI).** `Match.assignedScorers` is an array of user ids; empty = unrestricted (`Match.js:392-399`). `PUT /matches/:id/scorers` needs `CREATE_MATCH` on the match's tenant (`matchRoutes.js:174-178`); `setMatchScorers()` validates ObjectIds and user existence, writes and audits (`matchController.js:724-776`). Admin UI: `Frontend/Admin/src/App.jsx:86`, `pages/ScorerAssignment.jsx:58-127`.

**Non-owner scorer — EXISTS & WORKS.** An invited org `score_handler` can score; if `assignedScorers` is non-empty, only assigned users plus owner/admin/manager pass (`matchAccess.js:69-113`, `147-154`). Tests: `Backend/test/scorerAssignment.test.js:146-203`; recorded E2E says all deliveries were sent by the invited scorer, never the owner (`Backend/docs/e2e-results.md:32-42`).

**Live scoring — EXISTS & WORKS.** REST scoring surface at `matchRoutes.js:142-158` and legacy ball route `liveMatchRoutes.js:14-22`, all using `requireMatchScoreAccess` + verified identity. Engine: `services/scoring/ScoringEngine.js:88-94`, `controllerAdapter.js:255-270`, `scoreController.js:120-158,450-704` (persists `Delivery`, `Ball`, commentary, analytics and emits socket events). Frontend: `Frontend/Shared/scoring/hooks/useMatchScoring.js:510-720,969-998`; shared UI at `ManageScore.jsx:700-737`. A recorded local run reports **78 pass / 0 fail, 7/7 scenarios** (`Backend/docs/e2e-results.md:1-8`) — this audit did **not** re-run it.

**Result / scorecard / MOM — EXISTS & WORKS.** Result schema `Match.js:345-359`; chase/target completion `ScoringEngine.js:585-598`; general result `:631-648`; final-innings result and completion `inningsController.js:69-121`. Public scorecards render result and MOM (`DetailedScorecard.jsx:24-67,496-500`, `Scoreboard.jsx:319-324`). MOM requires a completed match and validates participants (`matchController.js:641-706`).

**Stats after completion — EXISTS & WORKS for player profiles.** `playerStats.js:16-35` explicitly states `Player.stats` is seed-only and career figures are derived on read from completed matches (`:101-111,276-350`; `playerController.js:146-151,183-197`). So a completed ball-by-ball match appears in public player profile stats without a write-back job.

### Gaps

1. **No match-specific scorer invite or scoring token/link — MISSING/PARTLY.** Generic org invitations can grant `score_handler` (E2E `bootstrap.js:233-245`), but `HandlerRequest` only supports `team`/`tournament` (`HandlerRequest.js:14-18`). No scoring token field or anonymous scoring route exists (`Match.js:392-399`; all scoring routes require `protect` + `requireVerifiedEmail`). Socket.IO has joins only, no scoring mutations (`socket/socket.js:24-99`).
2. **Rankings do not auto-update — PARTLY.** `rankingService.js:28-168` computes `TeamRanking` from completed matches, but callers exist only in `rankingController.js:58-70` / admin route `rankingRoutes.js:25-26`. No completion hook found in `scoreController.js`, `inningsController.js`, `matchController.js` or `manualScorecardController.js`. Public rankings read stored `TeamRanking` (`rankingService.js:258-276`), so they can be stale.
3. **Player ranking boards do not use derived stats — MISSING.** `rankingsController.js:100-203` and `rankingService.js:313-359` read stored `Player.stats` (`$stats.*`), which scoring never writes. Player *profiles* are correct; leaderboards are not.
4. **Completion side-effects are inconsistent.** `/end-innings` (the route the UI actually calls: `useMatchScoring.js:560-570`) does **not** recompute tournament points/stats or rankings (`inningsController.js:1-5,96-121`); `/status completed` does (`matchController.js:1191-1193`); `/score` recompute is fire-and-forget (`scoreController.js:580-582`); MOM save does not invalidate the stats cache (`matchController.js:679-706` vs `tournamentStats.js:1191-1210`). No frontend `/status` call was found.
5. **Socket room joins are unauthenticated — PARTLY/security.** `socket.js:24-89` has no JWT or permission check; anonymous clients can subscribe to live feeds (documented in `docs/e2e-results.md:134-143`). Socket writes cannot score, so this is a confidentiality issue, not a scoring-integrity one.
6. **UI does not pre-check `assignedScorers`.** `OrgMatchScoring.jsx:79-131` checks org permission and match membership only; an unassigned handler can open the screen then get `MATCH_SCORER_NOT_ASSIGNED` on write.

**Permission summary:** `score_match` to score/end innings/set result/MOM; `create_match` to assign scorers, set XI and toss; `invite_members` to add a `score_handler`.
**Remaining size: medium** (end-to-end scoring is done; gaps are propagation, optional token flow, and socket hardening).

---

## 5. Public club/team home

### Team page — EXISTS & WORKS (with gaps)

Route `/teams/:id` → `TeamProfile` (`Frontend/User/src/App.jsx:198-203`); backend read is public via `optionalProtect` (`teamRoutes.js:21-29`; `teamsController.js:102-118`). Private/hidden teams are withheld by `publicProjection.js:680-689,700-715`. Tabs: About, Squad, Stats, Matches, Branches, optional Posts (`TeamProfile.jsx:47-54`). It renders hero/logo/badges/hierarchy (`:126-185,252-268`), stats/form guide (`:191-225`), contact/social/personnel (`:270-378`), gallery and videos (`:380-411`), squad (`:415-468`), stats (`:470-508`), **recent** matches (`:511-540`; backend limits to `status: completed`, 10 rows: `teamService.js:155-161`) and branches (`:543-566`).

Gaps on the team page:
- **Upcoming/live fixtures: MISSING** — only completed matches are shown.
- **MVP / top performers: MISSING in UI** — the backend already fetches `playerRankings` (`teamService.js:181-190`) but `TeamProfile.jsx:75` destructures only `team`, `ranking`, `recentMatches`, `branches`.
- **Sponsors, tournaments, articles/news sections: MISSING** (`TeamProfile.jsx:47-54,248-573`), even though sponsor data exists for tournaments and matches.
- **Media privacy: MISSING** — `Team` privacy flags cover only `contactInfo`, `socialLinks`, `location` (`Team.js:118-122`); `media`/`videos` are whitelisted public fields (`publicProjection.js:105-154,522-545`) and rendered without a gate.
- Posts tab is feature-gated and defaults off (`CommunitySettings.js:15-21`; `CommunityConfigContext.jsx:4-15`) — **Cannot tell from code** whether it is enabled on the VPS.

### Club/organization page — MISSING

No public org route in the User app: `App.jsx:220-224` has only `/organization/new`, `/organization/invitations/:token`, scoring/series paths and private `/organization`; `MyOrganization.jsx:216` redirects anonymous users to login. No `ClubProfile`/`OrganizationProfile` page exists; `Teams.jsx:181-183` links only to team pages. Backend public org reads by ObjectId do exist (`organizationRoutes.js:154-156,209-216`; `organizationController.js:189-230`), and `TeamOrganization.js:31-40` mentions a slug, but no `/organizations/:slug` route consumes it.

**Remaining size: medium** (club page + enriching team page; backend reads mostly exist).

---

## 6. Media: photos/videos, blog/news, moderation, reusable tournament patterns

### What exists (platform-admin side, works)

- **Blogs:** public reads + admin-only writes (`blogRoutes.js:6-13`), admin form (`Frontend/Admin/src/pages/Blogs.jsx:16-25,84-112`), `Blog` model (`Blog.js:5-40`). Public News/BlogGallery/Videos pages exist (`News.jsx:26-44`, `BlogGallery.jsx:18-24`, `Videos.jsx:8-15`).
- **Tournament media/articles:** `TournamentMedia` and `TournamentArticle` models with `published`, `createdByAdmin`, `deletedAt`, soft delete, audit and sanitization (`TournamentMedia.js:12-48`, `TournamentArticle.js:6-30`, `tournamentContent.js:26-75,95-141,201-220`, `TournamentContentController.js:37,251-326,453-737`). Public reads filter `published:true, deletedAt:null`; limits: photos default 60/max 100, videos default 24/max 100, articles default 12/max 50; article title 300, body 20,000, excerpt 400, coverImage 500 (`TournamentContentController.js:254,282,616-641,664-704`). Videos are **links only** — provider and videoId are parsed and stored; remote media is never fetched (`TournamentMedia.js:8-11,20-35`).
- **Public + admin UI patterns:** `pages/tournament/tabs/PhotosTab.jsx:29-45`, `VideosTab.jsx:18-43`, `ArticlesTab.jsx:9-37`, `ArticleDetail.jsx:10-54`; Admin `pages/TournamentContent.jsx:11-25,180-285`.
- **Sponsors (owner-relevant):** org-scoped CRUD/logo/reorder at `organizationRoutes.js:443-493`, tenant fields pinned from verified org/tournament (`:449-455`), caps 1 title + 6 supporting including platform-wide sponsors (`sponsorController.js:9-13,34-74`), active-only public reads (`:88-112`), byte-level logo checks (`sponsorUpload.js:4-18`, `sponsorImage.js:6-8,38-83`). Owner UI/API: `organizationApi.js:246-273`, `OrgTournamentDetail.jsx`.
- **Community posts as a team — PARTLY:** backend allows org members with `manage_teams` or `publish_content` to post for a team (`communityController.js:353-397,474-521`); types `photo|video|article|story`, title 120, body 10,000, max 6 images (`communityValidators.js:24-53`), rate limit 5/min and default 10/day, moderation `auto|approval` with `status: published|pending|hidden|removed` (`CommunitySettings.js:15-21`, `CommunityPost.js:56-68`). But images must be own `/uploads/...` URLs and the picker's upload endpoint is admin-only (`ImagePicker.jsx:8-17`), the UI only offers team subjects to `owner`/`manager` (`PostForm.jsx:16-25,61-77`), and the whole feature is feature-gated.

### What is missing for an org owner

1. **No owner path to blogs/news.** `blogRoutes.js:3,7,11-13` requires platform `requireAdmin`. `publish_content` is declared and granted to owner/admin/manager/social/content roles but **no blog/media/article endpoint enforces it**; the only real enforcement found is community team posting (`communityController.js:353-397`).
2. **No org-scoped photo/video upload or gallery.** `POST /api/upload/image` is admin-only (`uploadRoutes.js:4-7,36`); tournament media writes are `/tournaments/admin/...` behind platform admin (`tournamentContentRoutes.js:37,75-87`). No org/team/match media route or model exists.
3. **No org/team articles.** No org-scoped article route; tournament articles are admin-only writes.
4. **Blog bugs:** `BlogGallery`/`News` filter on `category` (`BlogGallery.jsx:18-24`) but the model defines `relatedType`/`relatedId`, not `category` (`Blog.js:30-38`) — **Cannot tell from code** whether legacy documents carry `category`. `Blog.isLive` defaults false and is shown as a badge (`BlogGallery.jsx:90-94`) but public reads do not filter on it (`blogsController.js:10-35`), so it is display-only, not a publication gate. No `published`/`approved` flag on `Blog`.
5. **Tournament content settings *are* owner-editable** (`manage_competitions`: `organizationRoutes.js:365-382`; `OrgTournamentDetail.jsx:306-325`) but the owner tabs are overview/teams/groups/fixtures/squads/points/sponsors/awards — **no photos/videos/articles** (`:53-62`).

**Reusable pattern to copy:** tournament content already implements moderation (`published`, `deletedAt`), sanitized rich text, upload limits, video allow-listing, soft delete, audit, public projections, and both public and admin tabs. What is missing is an **org-scoped authorization/write path** plus scope fields on the content records.

**Remaining size: large** (media model + routes + permission path + moderation UI + gallery/news UI).

---

## 7. Notifications/sharing: share links, OBS overlay, social cards, PWA

### EXISTS & WORKS

- **Share links (posts/teams/players):** backend preview routes `Backend/src/routes/shareRoutes.js:11-13` mounted at `index.js:217,222`; preview handlers and escaping at `shareController.js:7-15,25-53,65-186`; frontend deliberately shares backend preview URLs so crawlers see server-rendered tags (`communityConfig.js:60-67`, `ShareMenu.jsx:10-13,46-47,113-149`). Hidden posts/private teams fall back to generic previews rather than leaking content.
- **OBS overlay:** route `/overlay/:matchId` (`App.jsx:148-158`), transparent browser-source styling (`Overlay.jsx:205-212,289-306`), teams/logos/scores/overs/status/target/result/batters/bowler/last 6 (`:87-165,343-409`), socket refresh + 5s polling (`:219-275`), and SW `NetworkOnly` for `/overlay` (`sw.js:42-50`). Owner copy-link actions on the fixture list: `OrgMatches.jsx:807-828,986-993`. Options: `theme`, `position`, `scale`, `hide` (`Overlay.jsx:6-27,279-287`). Actual OBS visual output: **Cannot tell from code**.
- **PWA:** VitePWA `injectManifest` + custom `sw.js`, manifest/icons/shortcuts, install prompt, update toast, offline fallback (`Frontend/User/vite.config.js:60-120`, `sw.js:12-86`, `pwa/registerPwa.js:1-64`, `pwa/installPrompt.js:1-121`, `InstallAppBanner.jsx`, `PwaUpdateToast.jsx`), smoke checks in `scripts/pwa-verify.mjs:94-320`, cache headers in `public/serve.json:3-33`. Admin app has its own PWA config (`Frontend/Admin/vite.config.js:18-60`).

### PARTLY / MISSING

- **Match share preview:** generic `ShareButton` exists and the match page uses it without a preview URL (`Shared/components/ShareButton.jsx:3-22`; `User/src/pages/Match.jsx:333-337`); `shareRoutes.js:11-13` has no `/match/:id`. Dynamic OG/Twitter tags exist only for community posts, teams and players.
- **Social cards:** static `og:*` tags in `Frontend/User/index.html:10-16`; no static `twitter:*` tags found. `usePageMeta.js:78-101` updates only title/description/canonical, not OG/Twitter, so arbitrary SPA routes get no route-specific card. `social-share.png` is generated at build time (`Shared/branding/build-brand.mjs:101-115`).
- **Owner notifications: MISSING.** No push library, no `Notification` model/route/inbox, no reminder scheduler found (`Backend/package.json:41-58`; searches for push/web-push/notification found only issue-report mail at `issueReportController.js:73,224`). Existing mail is auth/reset/verification/invite/issue-only. `ToastNotifications.jsx` is a match-event toast, not an owner inbox.
- **Config caveat:** `shareController.js:17-23` reads `PUBLIC_FRONTEND_URL`, which is absent from `Backend/.env.example`, and falls back to `https://cricall.online` — whether the VPS sets it is **Cannot tell from code**.

**Remaining size: small** for match social cards; **medium** for an owner notification system.

---

## 8. Other things an owner would reasonably expect

### Present

Owner/admin roles and permission map (`orgPermissions.js:9-119`), org dashboard with counts and permission-gated audit feed (`OrgOverview.jsx:37-39,116-171,186-212`; `membershipController.js:1023-1041`; routes `organizationRoutes.js:529-532`), multi-org list/switcher via `?org=` (`MyOrganization.jsx:104-127,300-384`; `App.jsx:96-107,218-224`), mobile scoring bar (`Shared/scoring/components/ScoringMobileBar.jsx:1-69`), ownership handover (`organizationRoutes.js:230-232`; commit `d7182d0`), org issue reports (`issueReportController.js`), deletion *requests* instead of hard deletes (`orgAccess.js:162-176`).

### Missing (evidence-based)

| Expectation | Status | Evidence |
|---|---|---|
| Owner notifications / reminders / inbox | **MISSING** | no push/FCM/notification model or route; only transactional mail exists |
| Fixture calendar view or `.ics` export | **MISSING** | repo-wide frontend search for `calendar` returned no matches |
| Owner CSV export (squad, fixtures, stats) | **MISSING** | only PNG/PDF scorecard export (`ScorecardExport.jsx`) and admin XLSX templates (`bulkImportController.js:195-225`) |
| Owner-issued scoped API keys | **MISSING** | only external-provider env keys (`cricApi.js:7,13,134`, `youtubeService.js:23-27`) |
| Team logo/colors edit for owners | **PARTLY** | backend/validator supports them (`teamValidators.js:55-116`, `Team.js:70-72,88-91`) and Admin UI exposes them, but `OrgTeams.jsx:27-115` does not. Org-level `logoUrl`/`coverUrl` *is* editable (`OrgSettings.jsx:35-44,257-263`) |
| Club finance / dues / invoices | **MISSING** | search for `finance|payment|invoice|expense|revenue|billing` found only external-provider "payment required" errors |
| Public club page (see §5) | **MISSING** | no route/page |

**Remaining size: large** if all are in scope; individual items are small–medium.

---

## Cross-cutting defects worth fixing regardless of PR order

1. `/end-innings` has no post-completion recompute (`inningsController.js:96-121`) even though it is the frontend's completion call.
2. Team rankings never recompute automatically (`rankingRoutes.js:25-26` only admin).
3. Player leaderboards read stale stored `Player.stats` while profiles derive correctly (`rankingsController.js:100-203` vs `playerStats.js:16-35`).
4. MOM save and some completion paths do not invalidate tournament stats cache (`matchController.js:679-706`).
5. `assignPlayerToTeam()` ignores its `jerseyNumber` parameter (`teamService.js:523-552`).
6. Squad `role` update desynchronizes from displayed `playingRole` (`teamService.js:579-590` vs `TeamProfile.jsx:438-441`).
7. Toss winner is not validated as a fixture participant (`matchController.js:1535-1556`).
8. Socket room joins have no auth (`socket.js:24-89`).
9. Blog `category` vs `relatedType` mismatch and `isLive` ignored by reads (`BlogGallery.jsx:18-24`, `Blog.js:30-38`, `blogsController.js:10-35`).
10. General upload has MIME/extension checks but **no magic-byte validation**; only sponsor uploads do byte-level checks (`uploadRoutes.js:13-19` vs `sponsorImage.js:6-32`). General uploads also have no HTML sanitization issue of their own, but user-authored article bodies must reuse the tournament sanitizer.

---

## Prioritized split into small PRs

Order is by dependency and risk: correctness first, then owner day-to-day, then public presence, then the two big features, then extras. Each PR is intended to be independently mergeable with tests.

| # | PR | Touches (files / models) | Risk | Notes |
|---|---|---|---|---|
| 1 | **Completion side-effects helper** — one idempotent `onMatchCompleted(match)` used by `/score`, `/end-innings`, `/status`, `/resolve-tie`, manual publish; recompute tournament points + invalidate stats cache + (optionally) recompute team ranking; invalidate on MOM save | `Backend/src/controllers/{inningsController,matchController,scoreController,manualScorecardController}.js`, `services/{tournamentService,rankingService,tournamentStats}.js`, tests | medium — double recompute / latency | Fire-and-forget or queue-friendly; make recompute idempotent. Decide ranking policy first (question Q8) |
| 2 | **Squad data fixes** — write the dead `jerseyNumber`, sync `role`+`playingRole`, validate toss winner, magic-byte checks on general uploads | `Backend/src/services/teamService.js`, `controllers/matchController.js`, `routes/uploadRoutes.js`, `utils/photoStore.js`, `middleware/sponsorUpload.js` pattern, tests | low–medium | Pure backend; no UI contract change |
| 3 | **Owner squad manager UI** — add/edit/remove, jersey, playing role, photo URL (+ upload after PR 4); fix gate from `create_match` to `manage_players` | `Frontend/User/src/pages/organization/OrgTeams.jsx`, `pages/TeamProfile.jsx`, `services/organizationApi.js`, `pages/MyOrganization.jsx`, `validators/teamValidators.js` (extend inline schema if needed), tests | medium — permission gating | API wrappers already exist; mostly UI |
| 4 | **Owner-scoped image upload** — reuse sponsor byte-level validation + compression (see VPS section) behind `manage_players` / `publish_content`, not platform admin | new `routes/orgUploadRoutes.js` or add to `organizationRoutes.js`, `utils/photoStore.js` (+ `sharp`), `utils/sponsorImage.js` pattern, `.env.example`, tests | medium — storage/abuse | Enables player photos, gallery and article cover images |
| 5 | **Scorer assignment + scorer UX for owners** — expose `PUT /matches/:id/scorers` in User app, pre-check `assignedScorers`, validate invitee belongs to org; invite label "Scorer (Score Handler)" | `Frontend/User/src/services/organizationApi.js`, `pages/organization/OrgMatches.jsx`, `OrgMatchScoring.jsx`, `Backend/src/controllers/matchController.js`, `middleware/matchAccess.js`, tests | low–medium | Backend assignment exists; do not add token flow until Q3 decided |
| 6 | **Match social card** — `/share/match/:id` preview with OG/Twitter tags + share button wiring | `Backend/src/routes/shareRoutes.js`, `controllers/shareController.js`, `Frontend/User/src/pages/Match.jsx`, `Shared/components/ShareButton.jsx`, `index.html` | low | Reuses existing share controller pattern |
| 7 | **Enrich public TeamProfile** — upcoming fixtures, top performers from existing `playerRankings`, tournament links, sponsor strip, media privacy flag | `Backend/src/services/teamService.js`, `utils/publicProjection.js`, `models/Team.js`, `Frontend/User/src/pages/TeamProfile.jsx`, new small components, tests | medium — privacy | Backend already returns `playerRankings` |
| 8 | **Public club page** — slug field + public projection + `/club/:slug` route + `ClubProfile` page linking teams/matches/results/sponsors | new `Frontend/User/src/pages/ClubProfile.jsx`, `App.jsx`, `models/TeamOrganization.js`, `controllers/organizationController.js`, `utils/publicProjection.js`, `shareController.js`, migration, tests | medium — slug collisions/privacy | Decide Q1 before starting |
| 9 | **Socket join hardening** — token/JWT or documented anonymous-read policy, plus rate limits | `Backend/src/socket/socket.js`, `middleware/authMiddleware.js`, `docs/`, tests | medium — may break public live page | Depends on Q4 |
| 10a | **External opponent model/API** — allow `externalTeams` on `Match` (name/logo/short label, ad-hoc player names stored on match), extend strict validators, single fixture + tournament paths, public projection | `Backend/src/models/Match.js`, `Team.js` (optional placeholder flag), `validators/matchValidators.js`, `controllers/{orgMatchesController,matchController}.js`, `utils/publicProjection.js`, tests | **large** — scorecard/XI for teams without Player docs | Split from UI; decide Q2 first |
| 10b | **External opponent UI** — form for ad-hoc side, XI from ad-hoc names, scorecard/playing-XI display | `Frontend/User/src/pages/organization/OrgMatches.jsx`, `OrgMatchScoring.jsx`, `pages/Match.jsx`, `components/{PlayingXITab,DetailedScorecard,MatchInfoTab}.jsx`, `services/organizationApi.js` | medium–large | Depends on 10a |
| 11 | **Org/team media model + API** — reuse `TournamentMedia` with `scope` (`club|team|match`), owner writes gated by `publish_content`, `published`+`approved`, soft delete, audit, sanitizer | new `models/OrgMedia.js` (or generic `Media`), controller/service/routes, `organizationRoutes.js`, `uploadRoutes.js`, `permissions/orgPermissions.js` (enforce), tests | medium–large | Decide Q5/Q6 first |
| 12 | **Org/team articles (news/blog)** — reuse `TournamentArticle` shape: title/body/images, `published`, `approved`, limits, sanitization | new `models/OrgArticle.js`, controller/service/routes, `organizationRoutes.js`, tests | medium | Share components with PR 11 |
| 13 | **Gallery + news UI** — tabs on club/team page, owner editor in org dashboard, moderation queue | `ClubProfile.jsx`, `TeamProfile.jsx`, new tabs/components, `OrgCompetitions`/org dashboard, public/admin share routes | medium | Depends on 11/12 |
| 14 | **Owner notifications (email first)** — fixture reminder, scorer assigned, match completed, pending content; optional in-app inbox; no push until asked | `Backend/src/utils/mailer.js`, hooks in `membershipController.js`/`matchController.js`, new `models/Notification.js` if inbox wanted, `OrgOverview.jsx`, tests | medium | Decide Q12 |
| 15 | **Owner team branding** — expose logo/colors already supported by backend | `Frontend/User/src/pages/organization/OrgTeams.jsx`, `services/organizationApi.js`, tests | small | Backend needs no change |
| 16 | **CSV export / calendar export** — owner-scoped squads/fixtures/stats CSV and `.ics` | new backend export routes + `Frontend/User/src/pages/organization/OrgMatches.jsx`, `OrgOverview.jsx`, tests | small–medium | Defer unless requested |

Suggested grouping: ship **1–2** together as a correctness release; **3–4–5** as the "run your club" release; **6–7–8** as the "public presence" release; **9** after the Q4 decision; **10–13** as the largest epic; **14–16** as follow-ups.

---

## VPS media storage recommendation

**Constraints observed in code:** uploads live on local disk at `<Backend>/uploads` (overridable by `UPLOADS_DIR`), persisted as the `uploads_data` Docker volume and served from `/uploads` (`photoStore.js:6-13`; `index.js:64-78`; `docker-compose.yml:30-31,125-127`). Raw cap is 5 MB, JPEG/PNG/WebP only, written **verbatim** with no resizing or compression (`uploadRoutes.js:9-20`; `photoStore.js:38-59`). No cloud adapter exists — and setting `CLOUDINARY_URL` or `S3_BUCKET` currently makes uploads **throw** (`photoStore.js:24-29,46-51`); do not set those env vars on the VPS. Offsite backup already archives uploads with `OFFSITE_UPLOADS_MAX_MB=2048` (`Backend/.env.example:178-196`; `docs/vps-deploy-runbook.md:397-405,498-512`). Actual free disk/bandwidth: **Cannot tell from code**.

Given a 96 GB disk shared with MongoDB, DB dumps and upload archives, and limited bandwidth:

1. **Keep images on the VPS disk, but never store raw uploads.** Add `sharp` server-side and, immediately after multer's 5 MB guard: verify magic bytes (reuse `sponsorImage.js` approach for *all* uploads), `rotate()`, `failOn: "error"`, reject animated inputs, cap input pixels (decompression-bomb guard), resize to max **1600 px** on the longest edge and re-encode to **WebP quality ~78**, target **< 300 KB**. Also generate a **400 px / ~30–50 KB** thumbnail for card/grid views. Discard the original buffer. Keep a conservative 5 MB hard ceiling at multer as the outer guard.
2. **Add quotas.** Per-org byte quota (start around **200 MB**, configurable), per-file count caps per gallery, and a global `uploads_data` budget well below 96 GB (leave room for DB + two backup archives). Account bytes on the media documents so quota checks are cheap; sweep orphaned files with the existing cleanup script. Serve with long immutable caching (`Cache-Control: public, max-age=31536000, immutable`) using content-derived filenames; the service worker already caches images `CacheFirst` (`sw.js:52-86`). Rate-limit upload endpoints per org/user.
3. **Do not host video files.** Keep the tournament/community model: accept **YouTube / Facebook** URLs (Instagram already allowed for community), validate provider + videoId server-side (`tournamentContent.js:95-141`; `communityHelpers.js:12-33`), store only `url/provider/videoId`, and render a click-to-load iframe with **no autoplay and no preload**. Never fetch or mirror the remote file (`TournamentMedia.js:8-11`). Use the provider's thumbnail as the poster. This keeps disk and bandwidth cost near zero and avoids transcoding/abuse. Decide additional providers in Q6.
4. **Backups stay cheap** because stored images are small; keep the existing weekly upload archive and offsite copy, and document the new quota in `docs/vps-deploy-runbook.md`.

---

## Questions for you to decide

1. **Public club URL:** human-readable slug (`/club/young-star`) or ObjectId? Should the club page be public by default, opt-in per org, or gated by an `isPublic` flag? Should its teams inherit visibility?
2. **External opponent:** free-text opponent name only (scorecard shows a name, no real squad), or create placeholder `Team` documents with ad-hoc player names? If placeholders, who owns them, can they later be merged into a real CricAll team, and do they enter public rankings?
3. **Scoring access:** keep account-only (invite `score_handler`) or add a signed, expiring, revocable scoring link/token for a volunteer without a full account? If token: expiry, revocation, and whether it may edit XI/toss.
4. **Socket live feeds:** keep anonymous read-only (current behaviour, good for public live pages) or require a JWT/room token? This changes the public match/live experience.
5. **Content moderation:** auto-publish owner posts, or require platform-admin approval? Reuse community `auto|approval` mode, and do we need an explicit `approved` flag in addition to `published`?
6. **Video providers:** YouTube + Facebook only, or also Instagram/Vimeo/TikTok? Any embedded-video CSP concerns?
7. **Image policy:** accept 5 MB raw then compress to 1600 px WebP <300 KB (recommended), and what per-org quota (200 MB proposed)? Keep originals anywhere, or discard always?
8. **Rankings:** should club matches affect global team rankings? Automatic recompute after completion (recommended) or keep admin-triggered? Should player leaderboards switch to derived stats?
9. **Role naming/scope:** rename the UI label from "Score Handler" to "Scorer", or keep code string `score_handler` and only change the label? Do you want team-specific captain/scorer roles, or are org-wide roles sufficient?
10. **Hard deletes:** the product rule is platform-admin-only; player hard-delete is currently an exception. Should owners be able to delete their own players/org/team, or always use deletion requests?
11. **Notifications:** email only first, or do you want browser push now (there is no push infrastructure today)? Which events matter most — fixture reminder, scorer assigned, match completed, content awaiting approval?
12. **Legacy blog data:** do any `Blog` documents carry the old `category` field, or should the public filters be migrated to `relatedType`? Should `isLive` become a real publication gate?
13. **Sponsors:** extend the existing tournament caps (1 title + 6 supporting) to club/team scope, and reuse the same model?
14. **Scope control:** are finance, calendar, CSV export and API keys in this initiative, or explicitly deferred? (Team branding controls look cheap and backend-ready.)
15. **Deployment config (cannot be answered from code):** is `PUBLIC_FRONTEND_URL` set on the VPS? Is community enabled, and in `auto` or `approval` mode? Is SMTP configured (default driver is `console`)?
16. **Acceptance:** should the recorded 78/78 E2E run be re-executed before merge of PR 1, since this audit was static only?

---

## Cannot tell from code

- Whether the recorded E2E suite still passes at `4626134` (not re-run here) and actual database contents (stale `Player.stats`, `TeamRanking`, `pointsTable`, legacy `Blog.category`).
- Whether the VPS sets `PUBLIC_FRONTEND_URL`, has SMTP configured, has community enabled/approval mode, its real free disk/bandwidth, and actual OBS rendering.
- Whether a reverse proxy or external system adds Socket.IO authentication, issues scoring links, or recomputes rankings outside the inspected backend.
- Whether any organization owner account also holds platform-admin rights (which would change several "MISSING for owners" verdicts at runtime).
- Whether ad-hoc/external opponents were designed but deliberately left unimplemented — no implementation or design note was found.
