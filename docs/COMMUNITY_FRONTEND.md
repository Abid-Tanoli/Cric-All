# Community Frontend

Frontend for the CricAll community content system. The backend and its contract
are described in [`COMMUNITY_API.md`](./COMMUNITY_API.md) — that document is the
source of truth for endpoints, error codes, permissions and share URLs. This
document covers only the two frontends that consume it.

- **User app** (`Frontend/User`) — feed, post page, create/edit, share menu and
  the per-entity "Posts" tabs on team and player profiles.
- **Admin app** (`Frontend/Admin`) — moderation queue and community settings.

Everything is gated by a **runtime** switch held in the backend
(`communityEnabled`), read from the public `GET /api/community/config`. There is
**no build-time `VITE_*` flag** for the community: the owner turns the section on
or off from the Admin app and the change takes effect on the next page load,
without a redeploy.

---

## 1. Turning the community on/off at runtime

1. Sign in to the Admin app and open **Community → Settings**
   (`/admin/community/settings`).
2. Toggle **Community enabled** and save. This writes `communityEnabled` through
   `PATCH /api/community/admin/settings`.
3. Reload the User app. The header nav link, the `/community` routes and the
   team/player **Posts** tabs appear (enabled) or stay hidden behind a friendly
   "Coming soon" placeholder (disabled).

How the frontends learn about the switch:

- `GET /api/community/config` → `{ enabled, postMode }`. This is a small,
  **public** endpoint added for the frontend (it is the one backend addition in
  this work; see `Backend/src/routes/communityRoutes.js` +
  `getCommunityConfig`). It deliberately exposes nothing sensitive — no
  `bannedPosters`, no limits.
- The User app fetches it **once per page load** through
  `CommunityConfigProvider` (`Frontend/User/src/community/CommunityConfigContext.jsx`),
  which caches the in-flight promise at module scope and shares the result with
  the header, the routes and the Posts tabs via `useCommunityConfig()`.
- `postMode` is `"auto"` (posts publish immediately) or `"approval"` (posts land
  in `pending` and wait for an admin). Both frontends honour it.
- While the config is loading — or if the request fails (API down, offline) — the
  community is treated as **disabled**, so the nav and tabs never flash on before
  the switch is known. `refresh()` (used after an admin flips the switch in
  another tab) re-fetches with a cache-buster.

Failure is also handled server-side: every community write re-checks
`communityEnabled` and returns `COMMUNITY_DISABLED` (`403`), which the UI turns
into "The community section is currently switched off by the admins."

---

## 2. User app

### Routes

| Route | Component | Notes |
| --- | --- | --- |
| `/community` | `community/CommunityIndex` | Renders the feed, or the "Coming soon" placeholder when the switch is off. Route stays mounted so deep links keep working. |
| `/community/new` | `community/CommunityCreate` | Auth-gated post composer. |
| `/community/post/:id` | `community/CommunityPost` | Single post with comments, likes, report and share. |

All three are lazy-loaded in `Frontend/User/src/App.jsx` and wrapped in the
existing `ErrorBoundary` + `CommunityConfigProvider`.

### Components (`Frontend/User/src/community/`)

| File | Responsibility |
| --- | --- |
| `CommunityConfigContext.jsx` | Fetches/caches `GET /community/config`; `useCommunityConfig()`. |
| `communityConfig.js` | Shared constants + helpers: kinds, report reasons, limits, API-origin derivation, share-preview URLs, media-URL absolutisation, allowlisted video embeds, `timeAgo`, `friendlyWriteError`. |
| `CommunityIndex.jsx` | `/community` entry — feed or placeholder. |
| `CommunityFeed.jsx` | Paginated feed (kind filter, cursor paging). |
| `CommunityCreate.jsx` | Create flow wrapper (auth gate + form). |
| `PostForm.jsx` | Compose/edit form: kind, title, body, images, video link, subject (team/player). |
| `ImagePicker.jsx` | Multi-image attach (up to 6) using the shared upload pattern. |
| `PostCard.jsx` | Feed card: media, author/team/player names, like, comment, report, share. |
| `CommunityPost.jsx` | Post detail: full body, comments, report, share. |
| `PostsTab.jsx` | "Posts" tab embedded on team/player profiles. |
| `ShareMenu.jsx` | Dependency-free share dropdown (see §4). |
| `RequireAuth.jsx` | Redirects anonymous users to sign-in for write actions. |

### API client

`Frontend/User/src/services/communityApi.js` wraps every community endpoint used
by the User app (feed, post, create/update/delete, like, comments, report, share)
and normalises backend error codes into `{ status, code, message, retryAfter }`
so screens can call `friendlyWriteError()`.

### Content safety

- **All user text is rendered as plain text by React.** No
  `dangerouslySetInnerHTML` anywhere in the community code.
- Outbound links in post bodies are plain `<a>` elements with
  `rel="noopener noreferrer"`.
- **Video embeds are allowlisted by provider.** `videoEmbed()` in
  `communityConfig.js` only builds a player for YouTube
  (`youtube-nocookie.com/embed/…`) and Facebook
  (`facebook.com/plugins/video.php`); anything else (including Instagram, which
  has no safe generic embed) falls back to a plain link. The provider/id come
  from fields the backend parsed — never from a raw user URL.
- Images must be uploaded through CricAll (`POST /api/upload/image`); external
  image links are rejected by the backend as `COMMUNITY_EXTERNAL_IMAGE`.
- `isReservedName()` mirrors the backend's reserved test-name prefixes as a
  belt-and-braces UI guard.

---

## 3. Admin app

### Routes

| Route | Component | Notes |
| --- | --- | --- |
| `/admin/community` | `pages/CommunityModeration` | Moderation queue. |
| `/admin/community/settings` | `pages/CommunitySettings` | Runtime switch + limits. |

Both are lazy-loaded in `Frontend/Admin/src/App.jsx`, behind `ProtectedRoute` +
`Layout`, and reached from the new **Community** item in
`components/Sidebar.jsx`.

### Moderation queue (`CommunityModeration.jsx`)

- Lists posts by status (defaults to `published`), with approve / hide / remove /
  restore actions and a **ban poster** toggle.
- Destructive actions (remove, ban) go through `ConfirmModal`; results are
  announced with `useToast`.
- A report is surfaced as a **count badge only**. The API exposes no endpoint
  that reveals the reporter's identity or their reason text — the docs record
  those audit rows as "code-path verified only" — so the UI does not invent
  them.
- Ban state is derived from `GET /community/admin/settings` → `bannedPosters`,
  so the button reflects reality rather than optimistic local state.

### Settings (`CommunitySettings.jsx`)

- **Community enabled** toggle (the runtime switch) plus post mode and the
  posting limits, saved through `PATCH /community/admin/settings`.
- The response is merged back into local state so the form always reflects what
  the server actually stored.

### API client

`Frontend/Admin/src/services/communityApi.js` mirrors the admin endpoints from
`COMMUNITY_API.md`: `getQueue`, `approvePost`, `hidePost`, `removePost`,
`restorePost`, `banPoster`, `getSettings`, `updateSettings`.

---

## 4. Share links

Every share link points at a **backend preview URL**, built from the existing
API base / env — never a hardcoded host:

```
<apiOrigin>/share/post/:id
<apiOrigin>/share/team/:id
<apiOrigin>/share/player/:id
```

- `getApiOrigin()` derives the origin from the same env the axios client uses
  (`VITE_API_URL`; in production there is no `VITE_API_URL`, so the API is
  same-origin and this resolves to that origin). There is **no localhost
  hardcoded at build time**.
- The backend `/share/...` pages carry Open Graph meta and a meta-refresh
  redirect into the SPA route, so WhatsApp / Facebook / X / Telegram render a
  real preview.
- `ShareMenu` fires the share counter **once per share action**: on the post page
  that is `POST /posts/:id/share`; team/player pages use the built-in counter
  endpoint.
- **Instagram** has no web share URL, so it is covered by the native Web Share
  API ("Share via device") plus **Copy link** — no invented Instagram URL.

---

## 5. Attaching images (upload permission)

`POST /api/upload/image` is **admin-only** and was **not** loosened. The
`ImagePicker` works for whoever the endpoint actually allows and, on a `403`,
shows a clear message instead of failing silently. Normal users cannot attach
uploads today; the UI says so. If the backend later grants uploads to a broader
audience, the picker starts working for them with no frontend change.

---

## 6. What is verified, and how

- **User app:** builds clean; the existing test suite passes plus new community
  tests.
- **Admin app:** builds clean; lint `0 errors` (6 pre-existing warnings); 48
  tests pass, including 5 new community tests (approve, remove-confirm,
  ban-confirm, settings toggle, settings limits).
- **Backend:** the full suite is run against a live local API on
  `127.0.0.1:5000` backed by the throwaway database `cric-all-e2e` with
  `MAIL_DRIVER=console`.
- **Manual flow walkthrough:** there is no Playwright/Cypress in this repo, so
  the end-to-end flows were exercised by running all three services locally
  (backend on `127.0.0.1:5000` against `cric-all-e2e`, User dev server on
  `5173`, Admin dev server on `5174`) and driving the same HTTP endpoints the
  UIs call, plus loading every community module through Vite's dev transform to
  prove it compiles. The flows exercised: read `GET /community/config`; turn the
  switch on/off via `PATCH /community/admin/settings` and confirm
  `config` reflects it; create a post (auto → `published`); see it in
  `GET /community/feed`; like; comment (and confirm HTML is rejected at the
  edge with `400`); share (counter increments once per action, payload carries a
  `url` + provider links); report (and confirm self-report is refused); open the
  admin queue (report **count** present, no reporter identity leaked); approve /
  hide / restore / remove; confirm a removed post is gone from the public read;
  ban a poster and confirm their next write is `COMMUNITY_POSTER_BANNED`;
  confirm an anonymous upload is refused and a non-admin upload is `403`; and
  confirm a write is `COMMUNITY_DISABLED` while the switch is off. `GET /share/post/:id`
  was verified to return the backend preview page (OG tags + meta-refresh into
  the SPA route).
- **Not verified here:** the actual pixel rendering / tap interaction of the two
  SPAs (no browser automation in the repo), real image uploads with an admin
  token, and the production `cricall.online` origin.

Share links were checked to resolve to the backend `/share/...` URLs rather than
SPA routes, and video embeds were checked to render only for allowlisted
providers.
