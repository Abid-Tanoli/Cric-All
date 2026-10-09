# Fix B — test-data & private-team visibility

Branch `wip/pre-deploy-fixes`. One local commit, not pushed. Companion to
`docs/round5-report.md` (Fix A, which stopped private **fields** leaking). Fix B
stops private **rows** leaking: fixture teams (reserved name prefixes) and
organization teams an owner has hidden (`isPublic: false`) must not appear on any
public list, and must not be addressable by id to anyone who could not have found
them through a listing.

## 1. Visibility policy

- A team is **hidden** when its name matches a reserved fixture prefix
  (`OPENCODE_TEST_`, `OPENCODE-TEST_`, `E2E_`, `TEST_`, `CRICALL_TEST_`,
  case-insensitive) **or** its `isPublic` is `false` (missing/`true` == public).
- Real teams are public by default (`Team.js:114`); an owner/manager with
  `manage_teams` toggles one with `PATCH /api/teams/:id/visibility`.
- Platform admins are exempt from list filters (the Admin app needs fixtures).
- A team's own organization managers (`managedOrgIds`) and platform admins stay
  entitled to read a hidden team **by id**; everybody else gets a 404 that does
  not confirm existence.
- **Detail-by-id is not name-gated** for organizations, tournaments, players,
  matches, series and events. This is deliberate: `optionalProtect` downgrades a
  suspended user to anonymous (`authMiddleware.js:119`), so gating a detail read
  by reserved name would 404 rows `crossTenant.test.js` proves are 200. IDs are
  unguessable; detail payloads instead strip hidden team references.

## 2. Changes by file

### Shared helpers — `Backend/src/utils/publicProjection.js`
`escapeRegExp`, `reservedNamesRegex()`, `reservedNamesMongoClause(field)`,
`publicTeamClause()`, `hiddenTeamIds()`, `isHiddenTeamDoc()`,
`filterHiddenTeams()`, `stripHiddenTeamRefs(payload, hiddenIdSet)`;
`isReservedTestName` made case-insensitive. All exported.

### Backend
| File | Change |
|---|---|
| `services/teamService.js` | `listTeams` composes `$and` (no `$or` overwrite); public/private + reserved filters; `getTeamProfile` id-gate + branch filter; `createTeam` honours `isPublic`; `getOrganizationTree` viewer-aware |
| `controllers/teamsController.js` | `teamIsReadableBy` gate; list flags by viewer; `getTeamRanking`/`getTeamMatches` 404 hidden; `toggleTeamVisibility` (manage_teams or admin) |
| `routes/teamRoutes.js` | `optionalProtect` on `/:id/ranking`, `/:id/matches` |
| `controllers/organizationController.js` | `listOrganizations` name/branch/player filters; `getOrganization` entitled-vs-public projection; `getOrganizationTeams`, roots, children, tree filtered |
| `routes/organizationRoutes.js` | `optionalProtect` on `/`, `/tree`, `/roots`, `/:id`, `/:id/children` |
| `validators/teamValidators.js` | `createOrgTeamSchema.isPublic` (`.strict()` kept) |
| `controllers/playerController.js` / `services/playerService.js` | player lists exclude hidden teams + reserved names for non-admins; `getTeamPlayers` gate |
| `controllers/rankingsController.js` / `services/rankingService.js` / `controllers/rankingController.js` | ranking boards exclude hidden teams + reserved names; `getTeamPlayerRankings` null → 404 |
| `controllers/categoryController.js` | category counts, `getTeamsByType`, leagues, incubation groups drop hidden/private |
| `controllers/matchController.js`, `eventController.js`, `seriesController.js`, `TournamentController.js` | list name-filter + hidden-team drop; detail strips hidden refs; tournament detail no longer populates full players |
| `scripts/migrateSetIsPublic.js` | new `--hide-test-names` mode (dry-run default; `unpublish still-public fixture-named teams`) |
| `test/e2e/lib/bootstrap.js`, `test/organizationMatches.test.js`, `test/playerSelfService.test.js` | fixtures create `isPublic: false` |
| `test/testDataVisibility.test.js` **(new)** | 7 focused visibility/toggle tests |
| `test/publicProjection.test.js` | visibility expectations updated (stranger vs admin) |

### Frontend
| File | Change |
|---|---|
| `Frontend/User/src/services/organizationApi.js` | `toggleTeamVisibility(teamId)` → `PATCH /teams/:id/visibility` |
| `Frontend/User/src/pages/organization/OrgTeams.jsx` | Public/Hidden badge + Make public/Hide button (gated by `MANAGE_TEAMS`) |

### Docs
`docs/round5-report.md` §3.5 rewritten (default is `true`; route is
`PATCH …/visibility`; `--hide-test-names` added); verification note corrected.

## 3. Endpoint audit — public read paths

| Endpoint | Hidden/private handling | Assumption |
|---|---|---|
| `GET /teams`, `?search=`, `?scope=organization`, `?organizationRef=` | hidden/reserved excluded for non-admins in every query shape | admin catalogue unfiltered |
| `GET /teams/:id` | hidden → 404 unless manager/admin | reserved name alone does not 404 (see §1) |
| `GET /teams/:id/players`, `/ranking`, `/matches` | same id-gate | — |
| `GET /organizations`, `/roots`, `/:id`, `/:id/children`, `/tree` | hidden/private teams dropped from branches/players | org membership list left public |
| `GET /organizations/:id/teams` | filtered unless entitled viewer | `/:id/teams/manage` stays unfiltered (owner) |
| `GET /organizations/chain` | not filtered | tree-walk helper; no team payload |
| `GET /players`, `?scope=`, `GET /players/rankings`, free agents | hidden-team players + reserved names excluded for non-admins | — |
| `GET /rankings-v2/**`, `GET /rankings*, /players/team/:teamId` | hidden teams + reserved names excluded; hidden team → 404 | boards filtered unconditionally |
| `GET /categories`, `/categories/:type/teams`, `/leagues`, `/leagues/:id`, incubation | hidden refs stripped from counts, squads, events | — |
| `GET /matches`, `GET /events`, `GET /series`, `GET /tournaments` | name-filtered + hidden-team `$nin` | detail-by-id 200, refs stripped |
| `GET /matches/:id`, `/events/:id`, `/series/:id`, `/tournaments/:id` | 200 always; hidden team refs stripped | ids unguessable (§1) |

## 4. Migration

```bash
# report only (default)
node src/scripts/migrateSetIsPublic.js --uri mongodb://127.0.0.1:27017/cric-all-e2e
# un-publish only fixture-named teams
node src/scripts/migrateSetIsPublic.js --uri … --hide-test-names --apply
```
`--set-public`, `--force-private` unchanged. Safety (`--allow-host`,
`--allow-database`, deletes nothing) unchanged.

## 5. Verification (this pass)

| Check | Result |
|---|---|
| Full backend suite (`--test-concurrency=1`) | **378 pass, 0 fail, 1 skipped** (Linux `/proc`), 379 total |
| `crossTenant` + `noSqlInjection` (live server) | **53/53 pass** |
| `test/testDataVisibility.test.js` (new) | **7/7 pass** |
| `publicProjection.test.js` | **39/39 pass** |
| E2E (`npm run test:e2e`) | **78 pass, 0 fail, 0 divergence, 7/7 scenarios** |
| E2E guard | server PID verified; 8 established loopback connections to `127.0.0.1:27017`; no non-loopback peers |
| Smoke (`npm run test:smoke`) | **4/4 pass** (read-only) |
| Frontend/User build | pass |
| Frontend/Admin build | pass |
| Lint (changed files) | clean; Admin 0 errors; User app has pre-existing errors in untouched files |

> Note: the default parallel `npm test` can exhaust the `POST /admin/login`
> rate limit (20/300 s) when `crossTenant` and `noSqlInjection` bootstrap at the
> same time. Run with `--test-concurrency=1`, or a freshly restarted server.

## 6. Documented assumptions

1. Detail-by-id reads are not name-gated (reason in §1).
2. Organization member lists and `GET /organizations/chain` are not filtered.
3. Ranking boards are filtered unconditionally (no viewer context).
4. `hiddenTeamIds()` runs one query per public request (no cache).
5. Fixtures in `publicProjection.test.js` stay public by design — that file is
   the visibility spec; non-visibility unit fixtures were made private.
