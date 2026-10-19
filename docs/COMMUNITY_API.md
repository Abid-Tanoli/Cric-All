# Community API Documentation

Implemented and verified against the live API (PART 1 Backend). Frontend (PART 2) builds against this document. Every response shape, status code, and error code below was asserted by `Backend/test/community.test.js` and the community probes in `Backend/test/noSqlInjection.test.js`.

## Base URLs
- API: `http://127.0.0.1:5000/api/community` (local dev/test)
- Uploads: `POST /api/upload/image` (multipart, field `image`)
- Share previews: `http://127.0.0.1:5000/share`
- Public frontend (for redirects): from `PUBLIC_FRONTEND_URL` env var, default `https://cricall.online`

## Settings
Stored in the community settings document, served/administered through the admin endpoints below. Fields:
- `communityEnabled` (bool, default **false**) — while false, every write is `403 COMMUNITY_DISABLED`, `GET /posts/:id` is `404`, and all other public reads return empty result sets.
- `postMode` (`"auto"` | `"approval"`, default `"auto"`)
- `bannedPosters` (array of User IDs)
- `maxPostsPerUserPerDay` (number, default 10)
- `maxImagesPerPost` (number, default 6)

## Models

### CommunityPost
- `authorUser` (ObjectId ref User, required) — always taken from the session, never from the request body
- `subject` — `{ type: "team"|"player"|"user", ref: ObjectId }` (required)
- `kind` — `"photo"|"video"|"article"|"story"` (required)
- `title` (string, max 120, optional, plain text)
- `body` (string, max 10000, plain text only — HTML tags are rejected with 400)
- `media` (array) — up to `maxImagesPerPost` (hard cap 6) items `{ url, alt }`; URLs must be the platform's own `/uploads/` paths, jpg/png/webp only
- `videoUrl` (optional) — allowlisted providers only (YouTube, Facebook, Instagram)
- `videoProvider` (`"youtube"|"facebook"|"instagram"`|null), `videoId` (extracted)
- `status` — `"published"|"pending"|"hidden"|"removed"` (default `published`, or `pending` in approval mode)
- `likeCount`, `commentCount`, `shareCount`, `reportCount` (numbers, default 0)
- Soft delete: `isDeleted`, `deletedAt`, `deletedBy`
- Timestamps

### CommunityLike — unique `{ user, post }` (enforced by index, built at boot by `utils/communityIndexes.js`)

### CommunityComment
- `post`, `author` (ObjectIds), `body` (max 1000, plain text), `status` (`"published"|"removed"`), soft delete fields

### CommunityReport — unique per `{reporter, post}` and per `{reporter, comment}` (partial unique indexes on `$type: "objectId"`, plus an app-level duplicate read that answers `409` deterministically)
- `post` or `comment` (one set, one null), `reporter`, `reason` enum (`spam|abuse|harassment|hate|nudity|violence|false|copyright|other`), `note` (max 500)

## Endpoints

### Public Reads (no auth)
| Route | Behaviour |
|---|---|
| `GET /feed` | Cursor pagination. Query: `cursor` (ISO), `limit` (1–50, default 20), `kind`, `subjectType` (`team`|`player`), `subjectId`. Returns `{ posts, nextCursor, hasMore }`. Published + non-deleted only; reserved test-name authors hidden. Empty feed when community disabled. |
| `GET /posts/:id` | Single post with `authorUser` populated (`name`, `avatar`). `404` when not found, hidden/removed/pending (non-author), reserved-name, or community disabled. |
| `GET /posts/:id/comments` | `{ comments, nextCursor, hasMore }`. Hidden/removed posts are `404` for strangers; authors and admins still see them. |
| `GET /teams/:id/posts` | `{ posts, nextCursor, hasMore }` for team-subject posts. Unknown team or reserved test-name team → empty. |
| `GET /players/:id/posts` | Same shape for player-subject posts. |

Every `:id` is validated as an ObjectId first: operator payloads (`{"$ne":null}` etc.) in the path or query are swallowed as `400`s / empty results, never 5xx (see `noSqlInjection.test.js`).

### Write Endpoints (require authenticated + email-verified user)

| Route | Behaviour | Success |
|---|---|---|
| `POST /posts` | Create. Body: `{ kind, subject: {type, ref}, title?, body?, media?, videoUrl? }`. Author comes from the session; the subject is authorized server-side (below). Strict schema — unknown fields (e.g. a spoofed `authorUser`) are rejected. | `201 { post }` (authorUser as raw id) |
| `PATCH /posts/:id` | Edit own post (title/body/media/video). Non-authors get `403 COMMUNITY_NOT_AUTHOR`. | `200 { post }` |
| `DELETE /posts/:id` | Soft-delete own post. | `200` |
| `POST /posts/:id/like` | Toggle. Only published posts. | `200 { liked: bool }` |
| `POST /posts/:id/comments` | Create comment, body `{ body }`. | `201 { comment }` |
| `DELETE /posts/:id/comments/:commentId` | Delete own comment only. | `200` |
| `POST /posts/:id/report` | Body `{ reason, note? }`. Self-report → `400 COMMUNITY_SELF_REPORT`; duplicate → `409 COMMUNITY_ALREADY_REPORTED`; third distinct report auto-hides the post. | `201 { reportCount, status }` |
| `POST /posts/:id/share` | **No auth required** (per-IP). Increments the counter and returns the share URLs. | `200 { shareCount, url, urls }` |

`url` is the frontend link (`^https?://.+/community/post/:id`); `urls` carries the WhatsApp/Facebook/X/Telegram pre-built links. Titles and URLs are HTML-entity-safe in every render path (share page included).

### Uploads
`POST /api/upload/image` — multipart, field `image`, jpg/png/webp only, 5 MB max. Missing file, wrong type, or oversize → `400` (multer errors are mapped to 400). Community posts then reference the returned `/uploads/...` URL; anything else is `400 COMMUNITY_EXTERNAL_IMAGE`, wrong extension `400 COMMUNITY_IMAGE_TYPE`, more than 6 images `400`.

### Admin Endpoints (existing Admin auth: `Authorization: Bearer <admin token>`; admins and superadmins only, others `403`)

| Route | Behaviour | Success |
|---|---|---|
| `GET /admin/queue` | Query `status` ∈ `published|pending|hidden|removed` (default `published`, else `400`), cursor pagination. Returns `{ posts, nextCursor, hasMore }` with `authorUser` as `{name, email}`. Reserved-name filtering deliberately NOT applied — moderation sees everything. | `200` |
| `POST /admin/posts/:id/approve` | pending/hidden → published | `200 { post }` |
| `POST /admin/posts/:id/hide` | → hidden | `200 { post }` |
| `POST /admin/posts/:id/remove` | → removed | `200 { post }` |
| `POST /admin/posts/:id/restore` | hidden/removed → published | `200 { post }` |
| `POST /admin/users/:id/ban-poster` | Body `{ banned: bool }` → `200 { bannedPosters }` | `200` |
| `GET /admin/settings` | Flat settings object | `200` |
| `PATCH /admin/settings` | Partial settings, strict schema; operator payloads (`{$ne:...}`) → `400` | `200` merged doc |

Unknown post id → `404`; operator `:id` → `400`. Every admin action records an audit entry (`recordAudit`); audit rows are code-path verified only — no endpoint exposes them for API assertion.

### Share Previews (no auth, SSR HTML)
- `GET /share/post/:id` — Open Graph + Twitter meta, meta-refresh + JS redirect to `PUBLIC_FRONTEND_URL/community/post/:id`. Never leaks hidden/pending/removed content or reserved-name authors; generic preview for unknown/disabled.
- `GET /share/team/:id`, `GET /share/player/:id` — same treatment for team/player pages.

**OG tags:** `og:title`, `og:description` (truncated ~200 chars), `og:image` (absolute https URL or empty), `og:url`, `og:type=article`, plus Twitter card tags. All values are escaped — markup in a title is rejected at write time and can never reach the share HTML.

### Share URL Formats (for frontend)
- WhatsApp: `https://wa.me/?text={title}%20{url}`
- Facebook: `https://www.facebook.com/sharer/sharer.php?u={url}`
- X (Twitter): `https://x.com/intent/tweet?text={title}&url={url}`
- Telegram: `https://t.me/share/url?url={url}&text={title}`
- Instagram: no web share URL (use native Web Share API + copy link)

## Permission Matrix (implemented & tested)

| Action | Who |
|---|---|
| Post with `subject.type: "team"` | Org owner/manager of the team's organization. Plain members (player/scorer roles) → `403 COMMUNITY_SUBJECT_DENIED` ("role…"). Non-members → `403` ("not a member…"). |
| Post with `subject.type: "player"` | Only the player's creator: `Player.createdBy == session user` (set server-side by `POST /api/players`). Anyone else → `403` ("not linked…"). |
| Post with `subject.type: "user"` | Only as yourself; another user id → `403` ("only post as yourself"). |
| Platform admins (admin/superadmin) | May post for any team/player/user (bypass all subject checks). |
| Edit / delete post | Author only (`403 COMMUNITY_NOT_AUTHOR`). |
| Delete comment | Comment author only. |
| Report | Any verified user except the post's author. |
| Share | Anyone (rate-limited per IP). |
| Moderation + settings | Platform admins only. |
| Banned posters | Every write → `403 COMMUNITY_POSTER_BANNED`, including likes/comments/reports, until unbanned. |

The client never chooses the author: `authorUser` and any spoofed extra fields are ignored/rejected; subject ids are re-verified server-side against membership/`createdBy` on every write.

## Rate Limits
| Route | Budget |
|---|---|
| `POST /posts` | 5/min per user, plus `maxPostsPerUserPerDay` per UTC day (`429 COMMUNITY_DAILY_LIMIT`) |
| `POST /posts/:id/comments` | 10/min per user |
| `POST /posts/:id/like` | 30/min per user |
| `POST /posts/:id/report` | 5/min per user |
| `POST /posts/:id/share` | 20/min per IP per post (21st → `429`) |

Limiter refusals are `429` with `Retry-After` and `Too many requests. Max N per Xs.` Keys include the mount path, so `/api/auth/login` and `/api/admin/login` budgets do not collide.

## Error Codes
- `COMMUNITY_DISABLED` — 403 on writes (also on share), 404 on `GET /posts/:id`; other reads return empty
- `COMMUNITY_SUBJECT_DENIED` / `COMMUNITY_SUBJECT_NOT_FOUND` — 403 / 404 on subject authorization
- `COMMUNITY_NOT_AUTHOR` — 403 on edit/delete of someone else's content
- `COMMUNITY_SELF_REPORT` — 400; `COMMUNITY_ALREADY_REPORTED` — 409
- `COMMUNITY_DAILY_LIMIT` — 429; `COMMUNITY_POSTER_BANNED` — 403
- `COMMUNITY_EXTERNAL_IMAGE` / `COMMUNITY_IMAGE_TYPE` / `COMMUNITY_VIDEO_NOT_ALLOWED` / `COMMUNITY_TOO_MANY_IMAGES` — 400
- `Validation failed` — 400, zod schema refusals (message plus per-field `errors[]`; the offending input is never echoed back)

## Moderation Flow
- `postMode: "auto"` → new posts are `published`; `"approval"` → `pending` (visible to author and admins only, absent from every public surface and the share page).
- A third distinct report flips a published post to `hidden` pending review (`{reportCount, status}` in the report response shows it).
- Hidden/removed/pending posts never appear in the feed, team/player feeds, single-post reads, comments, or share previews; writes to them 404.
- Admins approve/hide/remove/restore via the queue and can ban/unban posters; all actions are audited.

## Reserved Test Names
Public surfaces (feed, single post, comments visibility for strangers, team/player feeds, share previews) hide content whose author (or team/player subject) name starts with a reserved prefix (`OPENCODE_TEST_`, `OPENCODE-TEST_`, `E2E_`, `TEST_`, `CRICALL_TEST_` — case-insensitive). The admin queue is intentionally unfiltered. Writes from reserved-name authors are refused before creating anything.

## Security Notes
- HTML tags in title/body/comment are rejected at validation (`400`); control characters are stripped; all rendered output (share HTML, JSON) is escaped or never unescaped.
- Images must be the platform's own uploads (photoStore, jpg/png/webp, 5 MB, ≤6 per post); video URLs are parsed and allowlisted.
- Every community route (reads and writes) is probed with NoSQL operator payloads in paths, query strings, and bodies in `noSqlInjection.test.js` — all refused, never 5xx.
- Cursor-based pagination throughout (no offset).

## Verification
Full backend suite against the live API (127.0.0.1:5000, throwaway `cric-all-e2e` DB, `MAIL_DRIVER=console`, `NODE_ENV=test`): **560 tests, 559 pass, 0 fail, 0 cancelled, 1 skipped** (Windows-only skip in `guardProcNet`). `community.test.js` contributes 12 end-to-end tests covering CRUD/author-only mutation, like/comment/share, the permission matrix, moderation queue and visibility, approval mode, auto-hide at 3 reports, all rate limits, `communityEnabled=false` on every route, reserved-name hiding, XSS/media/upload rejection, and ban/unban.

Bugs found by the suite and fixed in the same branch:
1. `CommunityReport` unique partial indexes used `$ne: null`, which MongoDB rejects at create time — the indexes silently never existed and duplicate reports were accepted. Now `$type: "objectId"` (the `Team.js` pattern), ensured at boot by `utils/communityIndexes.js`, with an app-level duplicate read for a deterministic `409`.
2. `POST /api/upload/image` leaked multer errors as 500; they are now 400s, matching tournament content uploads.
3. The rate limiter keyed admin and user logins to the same bucket (`req.route.path` is router-relative); the key now includes the mount path.
