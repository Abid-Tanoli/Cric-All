# Tournament Hub

A public "tournament hub" for the User app plus a matching per-tournament content
manager in the Admin app. Every change is **additive**: existing pages, live
scoring, the points-table engine and all current URLs keep working.

- Branch: `tournament-hub` (branched from `origin/master` @ `f95adf0`).
- Nothing is pushed or deployed by this work; commits are local only.
- Global `VITE_SHOW_*` flags are **not** touched. Per-tournament hiding is done
  through the tournament's own `content.visibility` settings.

---

## 1. User app — routes

| URL | Screen |
| --- | --- |
| `/series/:seriesId` | Hub root (Home tab) |
| `/series/:seriesId/fixtures` | Fixtures & Results |
| `/series/:seriesId/table` | Points Table |
| `/series/:seriesId/stats` | Stats |
| `/series/:seriesId/teams` | Teams |
| `/series/:seriesId/photos` | Photos |
| `/series/:seriesId/videos` | Videos |
| `/series/:seriesId/articles` | Articles list |
| `/series/:seriesId/articles/:slug` | Single article |

`/series/:seriesId` is the **old** User URL for a series. The legacy `Series`
page is still shipped and is rendered as a fallback for anything the hub cannot
resolve to a Tournament (see §5), so old shared links never 404.

Tab bar order is fixed by the registry:
`Home | Fixtures & Results | Table | Stats | Teams | Photos | Videos | Articles`.

### Right sidebar

The Home, Fixtures & Results, Table, Stats and Teams tabs render a 320px right
rail (`TournamentSidebar`) containing:

1. Mini points table — top 8 teams.
2. Top Wicket Takers — top 3.
3. Top Run Scorers — top 3.

Photos, Videos and Articles render full width (no rail). On narrow screens the
rail stacks below the main column.

---

## 2. Adding a tab (registry)

The sub-navigation is data-driven from one array:
`Frontend/User/src/pages/tournament/registry.js`.

```js
export const TOURNAMENT_TABS = [
  {
    key: "home",            // stable id (state/tests)
    label: "Home",          // button text
    path: "",               // URL suffix under /series/:id ; "" = root
    gate: "table",          // optional visibility key (see below)
    isAvailable: (ctx) => true, // optional: hide when there is nothing to show
  },
  // ...
];
```

- **`path`** is registered as a route in `Frontend/User/src/App.jsx`
  (`/series/:seriesId/:tab`), so a new tab is deep-linkable the moment it appears
  here — no layout edits.
- **`gate`** maps to `tournament.content.visibility[gate]`. When an admin sets it
  to `false`, the tab disappears for that tournament only. Global flags are
  untouched.
- **`isAvailable(ctx)`** hides a tab that would otherwise render empty (Photos
  with zero photos, Stats before any match is completed, etc.). The `ctx` carries
  `{ visibility, counts, stats, standings, teams, squads }`.

`resolveTabs(ctx)` returns the visible tabs in order; `isTabVisible` and
`tabByPath` are convenience helpers. Adding **Bracket** or **Awards** later is a
single entry here plus the tab component, and mapping `key -> component` in
`TAB_COMPONENTS` inside `TournamentHub.jsx`.

### Resolving a hidden deep link

A deep link to a hidden tab redirects to the hub root (`/series/:id`) instead of
showing a blank screen. Nothing becomes unreachable — hidden tabs are only
removed from the registry output, not deleted.

### Entity resolution

`useTournamentHub.js`:

1. If `:seriesId` is a 24-char ObjectId → `GET /api/tournaments/:id`.
2. Otherwise treat it as a slug → `GET /api/tournaments/:slug/content` (the
   response echoes `tournamentId`).
3. If neither resolves to a Tournament → render the legacy `<Series />` page.

Fixtures prefer the populated `matches` on the tournament document (which already
passes through the hidden/test-team filter) and fall back to
`GET /api/tournaments/:id/fixtures` only when that list is empty.

---

## 3. Backend API

Mounted at `/api/tournaments` **after** the existing `tournamentRoutes.js`.
Every new route is either a new multi-segment path (`/:id/content`, `/:id/stats`,
…) or under `/admin`, so nothing here can shadow an existing endpoint.

### Public reads (accept id **or** slug)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/tournaments/:id/content` | Overview, visibility flags, thresholds, media counts |
| GET | `/api/tournaments/:id/stats` | Aggregated completed-match stats (cached) |
| GET | `/api/tournaments/:id/standings` | Existing points table + Form/Next columns |
| GET | `/api/tournaments/:id/photos` | Paged published photos |
| GET | `/api/tournaments/:id/videos` | Paged published videos |
| GET | `/api/tournaments/:id/articles` | Paged published article summaries |
| GET | `/api/tournaments/:id/articles/:slug` | One published article |

All public responses are sanitized and filter hidden/private and reserved
`OPENCODE_TEST_*` teams. Soft-deleted (`deletedAt`) rows are excluded everywhere.

### Admin reads / writes (`protect` + `requireAdmin` + `requireVerifiedEmail`)

| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/tournaments/admin/:id/content` | — |
| PUT | `/api/tournaments/admin/:id/content` | `bannerImage`, `shortDescription`, `city`, `visibility{photos,videos,articles,stats,table,teams}`, `stats{minBallsFaced,minOvers}` |
| POST | `/api/tournaments/admin/:id/photos` | multipart `image` (jpeg/png/webp, ≤5 MB), `caption`, `published`, `sortOrder` |
| POST | `/api/tournaments/admin/:id/videos` | `url` (YouTube/Facebook), `title`, `published`, `sortOrder` |
| PUT | `/api/tournaments/admin/:id/media/:mediaId` | `caption`, `published`, `sortOrder`, `url` (video) |
| DELETE | `/api/tournaments/admin/:id/media/:mediaId` | soft delete (+ local file removal for photos) |
| POST | `/api/tournaments/admin/:id/articles` | `title`, `body`, `slug?`, `excerpt?`, `coverImage?`, `published` |
| PUT | `/api/tournaments/admin/:id/articles/:articleId` | same fields, all optional |
| DELETE | `/api/tournaments/admin/:id/articles/:articleId` | soft delete |

Every write validates + sanitizes server-side and records an audit entry.
An oversized/malformed upload is mapped to HTTP 400 (not 500).

### `GET /api/tournaments/:id/stats` payload

Computed by `Backend/src/services/tournamentStats.js` — the **one** place these
figures are aggregated, shared by the Stats tab and the sidebar so the two can
never disagree.

```jsonc
{
  "matchCount": 12,
  "thresholds": { "minBallsFaced": 30, "minOvers": 5 },
  "topRunScorers":   [ { "playerId", "name", "imageUrl", "team", "teamLogo", "innings", "runs", "balls", "average", "strikeRate", "highestText", "fifties", "hundreds" } ],
  "topWicketTakers": [ { "playerId", "name", "team", "innings", "balls", "oversText", "runs", "wickets", "average", "economy", "strikeRate", "bestFigures", "fourWickets", "fiveWickets" } ],
  "topFielders":     [ { "playerId", "name", "team", "matches", "catches", "stumpings", "runOuts", "total" } ],
  "highestScores":   [ /* innings rows */ ],
  "bestBowling":     [ /* spells */ ],
  "bestStrikeRates": [ /* qualified by minBallsFaced */ ],
  "bestEconomy":     [ /* qualified by minOvers */ ],
  "mostSixes":       [ /* batters */ ],
  "mostFours":       [ /* batters */ ],
  "boundaryMeter": {
    "sixes": 84, "fours": 210,
    "mostSixes": [ { "playerId", "name", "team", "count" } ],
    "mostFours": [ { "playerId", "name", "team", "count" } ]
  },
  "hasBatting": true, "hasBowling": true, "hasFielding": true,
  "hasSixes": true, "hasFours": true,
  "empty": false
}
```

- Only matches with `status === "completed"` contribute
  (`COMPLETED_STATUSES = ["completed"]`), so a live match never half-counts.
- **Manual scorecards and ball-by-ball matches follow the exact same path.** A
  manual scorecard only has to populate `innings[].batting` / `innings[].bowling`
  with the same numbers a ball-by-ball innings produces. `computeTournamentStats`
  is pure and never reads the database; `gatherTournamentStats` loads the data.
  The expected input shape is documented at the top of `tournamentStats.js`.
- Cached in-process for 15 s (`Cache-Control: public, max-age=15,
  stale-while-revalidate=30`). `?fresh=1` bypasses the cache (used by tests and
  after edits); the admin content update also clears it.

#### The single plug-in point for a manual scorecard

`inningsForMatch(match)` in `Backend/src/services/tournamentStats.js` is **the
only function that reads innings off a match**. Both `computeTournamentStats` and
`gatherTournamentStats` call it, so it is the one seam the oct12-knockout branch
has to touch:

```js
// Backend/src/services/tournamentStats.js
export function inningsForMatch(match) {
  const innings = match?.innings;
  return Array.isArray(innings) ? innings : [];
}
```

Today a match already stores `innings[]` on the document, whether it came from
ball-by-ball entry or a hand-entered card, so the function is a straight read.
When the knockout branch starts persisting a manual scorecard in its own field,
return `inningsForMatch(match)` from that field (as `InningsLike[]`) and every
figure — batting, bowling, fielding, boundaries, qualification and the sidebar —
keeps working with no other edit. It is pure, synchronous and never throws on a
malformed match; `[]` means "nothing to read". Do not reimplement the maths
anywhere else.

#### A completed match with **no** ball-by-ball data

This is the manual-scorecard case that matters most: a match is marked
`completed` with a result but has no `innings` (no batting/bowling yet). The
behaviour is deliberately empty, never fabricated:

| Surface | What it shows |
| --- | --- |
| `GET /:id/stats` | `empty: true`, `matchCount: 0`, every list `[]`, `boundaryMeter` all zeros, `hasBatting/hasBowling/hasFielding: false` |
| Stats tab | The message **"Stats will be available after matches are played."**; the Boundary Meter (0/0-style panel) is **hidden** while `empty` is true, so nothing reads like real figures |
| Sidebar | "No standing yet" / "No bowling stats yet" / "No batting stats yet" placeholders |

A completed match with no innings contributes **no** row and no `matchCount`
(`gatherTournamentStats` drops innings-less matches); it is not counted as a
played match with zero runs. The points-table engine is unaffected — the Table
tab still renders the existing `pointsTable` rows. Verified by the backend test
*"a completed match with no scorecard yields an empty, non-misleading stats
payload"* and the User tests *"Stats shows the empty state before any match is
played"* / *"Stats shows the boundary meter once figures exist"*.

---

## 4. Admin app — content manager

Route: `/admin/tournaments/:id/content` (`Frontend/Admin/src/pages/TournamentContent.jsx`).
Reached from the "Content" action on each row in **Tournament Management**.

Sub-tabs:

- **Overview** — banner image URL, short description, city, per-section
  visibility toggles, stats qualification thresholds.
- **Photos** — upload (existing `photoStore` pipeline), caption, publish, reorder,
  delete.
- **Videos** — add by URL (YouTube/Facebook only), title, publish, reorder,
  delete. Only the URL is stored; remote media is never fetched or mirrored.
- **Articles** — create/edit/publish/delete; slug is generated from the title and
  kept unique per tournament (reusable after a soft delete).
- **Settings** — visibility + thresholds summary.

Platform-admin only. Deleting a tournament runs `deleteTournamentContent`, which
soft-deletes its media/articles and removes local photo files, so a tournament
delete does not silently orphan uploads. The delete confirmation text was updated
to say so.

---

## 5. Data model (additive)

- `Tournament.content` — new sub-document `{ bannerImage, shortDescription, city,
  visibility, stats }`. Defaults are applied on read
  (`DEFAULT_VISIBILITY`, `DEFAULT_THRESHOLDS = { minBallsFaced: 30, minOvers: 5 }`),
  so existing tournaments render without any migration.
- `TournamentMedia` — `{ tournament, kind: "photo"|"video", url, provider,
  videoId, caption, sortOrder, published, createdByAdmin, deletedAt }`.
- `TournamentArticle` — `{ tournament, title, slug, coverImage, body, excerpt,
  published, publishedAt, createdByAdmin, deletedAt }`, unique `(tournament, slug)`
  among non-deleted rows.

No existing collection or field is modified. No migration is required to go live.

---

## 6. Tests and screenshots

Backend (new): `Backend/test/tournamentHub.test.js` — 21 tests covering stats
aggregation, the manual-scorecard plug-in seam, the empty-stats case, content
defaults, auth, validation, XSS/SSRF/upload security and media parsing. Run the
full suite with:

```
npm --prefix Backend test          # script pins --test-concurrency=1
```

Last full-suite run on this branch (Linux container, live local API on
`127.0.0.1:5000`, throwaway `cric-all-e2e` database): **464 tests, 464 pass,
0 fail, 0 cancelled, 0 skipped** (all 21 hub tests pass, 23 suites,
~21 min). The two suites that need a live server (`crossTenant.test.js`,
`noSqlInjection.test.js`) pass in that setup.

The skips and failures seen on a bare Windows host are environmental, not
regressions: without a server, `auth-api.test.js` (14 tests, `{ skip:
!serverAvailable }`) and the Linux-only `guardProcNet.test.js` (1, `{ skip:
process.platform !== "linux" }`) skip (15), and the two server-needing suites
abort (`ECONNREFUSED`). No test is skipped because of this branch's changes.

E2E (real scoring over HTTP + Socket.IO): `npm --prefix Backend run test:e2e` —
**7/7 scenarios, 78 pass, 0 fail, 0 divergence** (~3.7 min), with the local-target
guard confirming the server picks `127.0.0.1:5000` and only loopback Mongo peers.
Requires the server up and writing `backend.log` in its cwd (set
`E2E_BACKEND_LOG` to override).

Frontend (User, new):

- `TournamentTabs` — registry order, `gate`, empty-media hiding.
- `TournamentMatchUtils` — fixtures grouping/filters.
- `TournamentSidebar` — leaderboard order and empty states.
- `TournamentHub` — routing / deep links / legacy fallback, the empty-stats
  Boundary-Meter guard, and inert article rendering.

```
npm --prefix Frontend/User test    # 17 files, 81 tests, all pass
npm --prefix Frontend/Admin test   # 5 files, 23 tests, all pass
```

Builds (both must succeed; the hub is a separate lazy chunk):

```
npm --prefix Frontend/User run build
npm --prefix Frontend/Admin run build
```

Screenshots: `docs/screenshots/tournament-hub/` — Home, Fixtures, Table, Stats,
Teams at both **360×640** and **1280×800** (10 PNGs), captured by
`scripts/screenshot-tournament-hub.mjs` against the built User app with
`OPENCODE_TEST_` fixtures, which are removed afterwards.

### Manual smoke test (real API + real database)

`scripts/smoke-tournament-hub.mjs` is a second, non-intercepted pass: it serves
the built User app and reverse-proxies `/api`, `/socket.io` and `/uploads` to a
**live local API**, then walks every tab plus the legacy `/series/<id>` URL and
the slug form, asserting real seeded rows are present and that the draft article
and the hidden ghost team are absent. It writes four fresh 360×640 shots to
`docs/screenshots/tournament-hub-smoke/`:

```
# 1. seed (writes only to an e2e-named throwaway db; refuses anything else)
MONGO_URL=mongodb://127.0.0.1:27017/cric-all-e2e \
  node Backend/scripts/smokeSeedTournamentHub.mjs
# 2. run the smoke pass against the running API
node scripts/smoke-tournament-hub.mjs <tournamentId> opencode-test-hub-smoke
# 3. remove the seed rows again
MONGO_URL=mongodb://127.0.0.1:27017/cric-all-e2e \
  node Backend/scripts/smokeSeedTournamentHub.mjs clean
```

The seed marks itself with `OPENCODE_TEST_` (tournament name, slug, admin email
and one intentionally-hidden "ghost" team). The four **competing** teams are
deliberately **not** prefixed with a reserved test prefix: the public hub filters
`OPENCODE_TEST_` / `E2E_` / `TEST_` teams by design, so a reserved-prefix team
would make the hub render empty. Filtering is therefore asserted on the ghost
team here and covered directly by unit tests. Last run: **11/11 tab checks
passed**, 4 screenshots written, seed data removed afterwards (verified 404).

Both harnesses use `playwright-core` driving the system Edge
(`channel: 'msedge'`), installed with `npm i playwright-core --no-save` (no new
dependency is added to any `package.json`). The service worker is blocked in the
browser context so a cached shell cannot mask the network.

---

## 7. oct12-knockout merge notes

`origin/oct12-knockout` tip `bbeb791` was verified to be an **ancestor** of this
branch's HEAD, so merging it is a no-op with no conflicts. That branch adds
scorecard features (not media/hub content), so the only anticipated integration
point is the stats input: a manual scorecard must be adapted into the shape
documented at the top of `tournamentStats.js` and passed to
`gatherTournamentStats` / `computeTournamentStats`. **Do not** reimplement the
maths anywhere else. `Bracket` / `Awards` tabs drop in via the registry (§2).

---

## 8. Deploy notes

- No migration. `Tournament.content` defaults on read; new collections are created
  lazily by Mongoose.
- Backend, User app and Admin app can deploy independently; the hub degrades to
  the legacy `Series` page until the new backend routes are live.
- The in-process stats cache is per-instance and TTL 15 s; behind multiple
  instances a short-lived stale read is possible, which is acceptable.
- Verify after deploy: `/api/tournaments/<id>/stats` returns 200 with `matchCount`,
  and `/series/<id>` renders the hub rather than the legacy page.

---

## 9. Known gaps / not done

- No push, no deploy, no production/VPS/DB access was performed.
- `docs/screenshots/tournament-hub/` is a point-in-time capture; it is not
  regenerated in CI.
- The screenshot harness needs `playwright-core` installed ad hoc and a system
  Edge/Chromium; it is not wired into CI.
- Video embeds store and validate provider URLs but the public page has not been
  audited against every Facebook URL shape; YouTube is exercised by tests.
- `content.visibility` gates tabs but there is no bulk per-tournament export/import.

---

## 10. Security self-review (new public + admin surface)

Every claim below has code evidence and a regression test in
`Backend/test/tournamentHub.test.js` (unless a frontend test is named). Nothing
here fetches remote content server-side; the only new I/O is Mongo reads/writes
and the existing local photo store.

| # | Risk | Evidence | Test (item) |
| --- | --- | --- | --- |
| a | Draft articles / unpublished media must never be public | `PUBLISHED = { published: true, deletedAt: null }` (`TournamentContentController.js:25`) applied to every public media/article query (`:204` and the article lists/detail); projections `publicMedia` / `publicArticleSummary` / `publicArticleDetail` (`tournamentContent.js:188/202/215`) drop internal fields | *unpublished media stays off the public hub but remains visible to the admin* |
| b | Hidden (`isPublic:false`) and reserved-test (`OPENCODE_TEST_`/`E2E_`/`TEST_`) teams never reach hub stats / Teams / standings | `TEST_NAME_PREFIXES` + `isReservedTestName` (`publicProjection.js:528/536`), `hiddenTeamIds` (`:586`), `isHiddenTeamDoc` (`:596`), `stripHiddenTeamRefs` (`:617`); `getTournaments` excludes them (`TournamentController.js:100-102`); `getTournament` strips refs (`:146`); stats filter (`tournamentStats.js:449-462`); **standings rows + `next.opponent`** filter (`TournamentContentController.js:128-168`) | *standings hide hidden/test teams and never name a hidden next opponent* (+ stats/teams coverage in the existing hub tests) |
| c | Article body/link XSS (`<script>`, `onerror`, `javascript:`, iframe/svg) | `sanitizeArticleBody` strips script/style/iframe/object/embed/form/link/meta/svg, `on*=` handlers and `javascript:` / `data:text/html` (`tournamentContent.js:61-75`); the title goes through `sanitizeText` (`:46`). The React reader renders `{article.body}` as **text** (no `dangerouslySetInnerHTML`), so it is escaped twice (`Frontend/User/src/pages/tournament/tabs/ArticleDetail.jsx`) | *article body sanitization strips scripts, handlers, iframes and javascript: links*; *renders a malicious title and body as escaped text, never as HTML* (User) |
| d | Video URL host allow-list, no SSRF, nothing fetched server-side | `parseVideoUrl` accepts only http(s) and YouTube/YouTube-nocookie/Facebook hosts (`tournamentContent.js:98-100,107+`); only `{ provider, videoId, url }` is stored — no fetch anywhere | *video URLs are allow-listed, http(s)-only, and never fetched server-side* (`169.254.169.254`, localhost, `file:`, `javascript:` all 400) |
| e | Upload type/size validation reuses the existing pipeline | `multer` memory storage, `fileSize: 5 MB`, `fileFilter` jpeg/png/webp, `MulterError` mapped to 400 (`tournamentContentRoutes.js:39-60`); stored via `storeImage` | *photo upload rejects a non-image and an oversized file with a 400* |
| f | Every write route is platform-admin-only; hostile params/body cannot become query operators | all `/admin/*` writes are wrapped in `adminOnly = [protect, requireAdmin, requireVerifiedEmail]` (`tournamentContentRoutes.js:37,77-87`); `readString` rejects non-strings (`tournamentContent.js:31-39`); ids are resolved by `resolveTournament`, never passed as objects | *every admin write route refuses anonymous and non-admin callers* (401 anon, 403 user); *a hostile id or body value is treated as text, never as a query operator* |
| g | Public responses leak no private fields (emails, phones, passwords, admin ids) | public projections omit `createdByAdmin`/`publishedBy`/timestamps and select only `name/imageUrl` for players (`tournamentStats.js`); `publicMedia`/`publicArticle*` build explicit shapes | *public hub responses expose no emails, passwords or admin ids* |

Notes:

- No admin ``id``/email ever reaches a public payload; the test also asserts no
  ``@example.com`` string appears in any public response.
- A rejected upload or video URL is a **400**, never a 500, and creates no row.
- The reserved-team filter is prefix-based and case-insensitive, applied from the
  start of the name (`publicProjection.js:553-554`); a normal team cannot
  accidentally match it.
