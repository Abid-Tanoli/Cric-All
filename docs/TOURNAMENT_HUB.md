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

Backend (new): `Backend/test/tournamentHub.test.js` — 11 tests covering stats
aggregation, content defaults, auth, validation and media parsing. Run the full
suite with:

```
npm --prefix Backend test          # script pins --test-concurrency=1
```

Last full-suite run on this branch: **456 tests, 386 pass, 2 fail, 53 cancelled,
15 skipped** (all 11 hub tests pass). The 2 failures are pre-existing and
unrelated to this work: `test/crossTenant.test.js` and
`test/noSqlInjection.test.js` both abort with `world was never built; the suite
did not run` because they need a live local API server on `127.0.0.1:5000`
(`ECONNREFUSED`). They fail the same way on `origin/master` without a server
running.

Frontend (User, new):

- `TournamentTabs` — registry order, `gate`, empty-media hiding.
- `TournamentMatchUtils` — fixtures grouping/filters.
- `TournamentSidebar` — leaderboard order and empty states.
- `TournamentHub` — routing / deep links / legacy fallback.

```
npm --prefix Frontend/User test    # 17 files, 79 tests, all pass
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

> The harness uses `playwright-core` driving the system Edge (`channel: 'msedge'`),
> installed with `npm i playwright-core --no-save` (no new dependency is added to
> any `package.json`). The server worker is blocked in the browser context so
> Playwright can intercept `**/api/**`.

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
