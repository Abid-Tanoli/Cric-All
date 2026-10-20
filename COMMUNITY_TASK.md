# Community Content System - Assignment Document

**Branch:** `community-content` (from latest master d64c476)  
**Type:** Local only - Never push to master, never deploy, never print secrets, never touch real database  
**Test Environment:** API on 127.0.0.1:5000 against throwaway DB `cric-all-e2e` (reset first), MAIL_DRIVER=console, NODE_ENV=test  
**Log Command:** `cmd /c "node src/index.js > backend.log 2>&1"` (UTF-8)  
**Commit Rule:** Commit locally after each step, push `git push origin community-content` at the end  
**Privacy:** No real people's photos or names in tests or commits  

## Goal

**PART 1 = BACKEND ONLY:** Build a community content system so teams and players can post photos, videos (links), blogs/articles and stories on their profiles, with likes, comments and sharing, and a public combined community feed. Shared links must look good on WhatsApp/Facebook (OG/Twitter meta tags). Frontend comes in PART 2.

---

## STEP 0 - Read-only Audit (Report in ~20 lines before coding) - [ ] NOT COMPLETED

**What to investigate:**
- [ ] Check blogs/articles/videos/photos/comments/likes models - what exists?
- [ ] Check routes and pages (Frontend/User has hide-able nav flags for videos, rankings, comparison, blogs)
- [ ] Check tournament hub - TournamentArticle and TournamentMedia
- [ ] Check Frontend/User MyPlayers.jsx
- [ ] Check how normal USER account links to Player (MyPlayers) and to Team/Organization (Membership, requireOrgPermission, roles)
- [ ] Check upload path (utils/photoStore.js, POST /api/upload/image, accepted types, size limits, rate limiting, auth middleware)
- [ ] Check for sharp or any image library
- [ ] Check feature flags (build-time VITE_SHOW_* vs runtime /api config endpoint, Admin SyncPanel toggles)
- [ ] Check sanitization helpers (NoSQL injection test, XSS handling - note live DB has user with `<script>` tag)
- [ ] Check rate limiting middleware
- [ ] Reuse what exists; do not duplicate

**Output:** ~20 line audit report

---

## STEP 1 - Models (Backend/src/models) - [ ] NOT COMPLETED

**Create/Update these models:**

### CommunityPost
- [ ] authorUser (ref)
- [ ] subject {type: "team"|"player"|"user", ref}
- [ ] kind: "photo"|"video"|"article"|"story"
- [ ] title (optional, max 120)
- [ ] body (plain text or restricted markdown, max 10000; NO raw HTML ever)
- [ ] media: up to 6 images [{url, alt}]
- [ ] videoUrl (only YouTube, Facebook, Instagram URLs - validated by strict allowlist; store provider and id)
- [ ] status: "published"|"pending"|"hidden"|"removed"
- [ ] counters: likeCount, commentCount, shareCount, reportCount
- [ ] createdAt/updatedAt, soft delete fields
- [ ] Indexes: (status+createdAt), subject, author

### CommunityLike
- [ ] unique per (user+post)

### CommunityComment
- [ ] post, author, body max 1000, status published/removed, soft delete

### CommunityReport
- [ ] post or comment, reporter, reason enum + note, unique per (reporter+target)

### Platform Settings
- [ ] communityEnabled (default FALSE)
- [ ] postMode: "auto"|"approval" (default "auto")
- [ ] bannedPosters list
- [ ] maxPostsPerUserPerDay (default 10)
- [ ] maxImagesPerPost (default 6)
- (reuse existing settings mechanism if available)

---

## STEP 2 - API (under /api/community) - [ ] NOT COMPLETED

### Public Reads (no login)
- [ ] GET /feed - cursor pagination, filter by kind and subject (team/player), only published, hide reserved test-prefix names like public projections
- [ ] GET /posts/:id
- [ ] GET /posts/:id/comments (cursor)
- [ ] GET /teams/:id/posts
- [ ] GET /players/:id/posts
- [ ] If communityEnabled false: public endpoints return empty feed or 404 with clear code (not 500)

### Auth Required Writes
- [ ] POST /posts
- [ ] PATCH/DELETE own posts
- [ ] POST /posts/:id/like (toggle)
- [ ] POST /posts/:id/comments
- [ ] DELETE own comment
- [ ] POST /posts/:id/report
- [ ] POST /posts/:id/share (increments shareCount, rate limited; no auth acceptable if strictly IP rate limited)
- [ ] Write endpoints return 403 COMMUNITY_DISABLED if communityEnabled false
- [ ] Authorization: team posts require org owner/manager (requireOrgPermission), player posts require user linked to that player (MyPlayers linkage), platform admins for anything. Clear 403 codes otherwise. Never trust client IDs.
- [ ] Images: reuse upload endpoint/photoStore, only jpg/png/webp, max 5MB each, count limit, only accept platform's own upload URLs (reject arbitrary external)

### Safety & Moderation
- [ ] Escape/sanitize all text output paths, strip control chars, reject HTML in body/title/comments
- [ ] Per-user and per-IP rate limits on create/comment/like/report/share
- [ ] Max lengths enforced
- [ ] NoSQL operator injection protection (follow noSqlInjection test patterns, add module routes)
- [ ] Post with reportCount >= 3 auto-switches to status "hidden" pending admin review
- [ ] postMode "approval" makes new posts "pending" (visible only to author and admins)

### Admin Endpoints (Admin role/auth)
- [ ] GET /admin/queue (pending + reported)
- [ ] POST /admin/posts/:id/(approve|hide|remove|restore)
- [ ] POST /admin/users/:id/ban-poster
- [ ] GET/PATCH /admin/settings (communityEnabled, postMode, limits)
- [ ] Audit logging if pattern exists

---

## STEP 3 - Share & Link Previews (Backend only) - [ ] NOT COMPLETED

- [ ] GET /share/post/:id - SSR HTML with OG/Twitter meta (og:title, og:description, og:image absolute https from post or default, og:url, og:type=article). Meta refresh + JS redirect to SPA (https://cricall.online/community/post/:id). Escape all values. Generic preview for unknown/hidden; never leak hidden/pending.
- [ ] GET /share/team/:id - similar for team
- [ ] GET /share/player/:id - similar for player
- [ ] SPA base URL from env var PUBLIC_FRONTEND_URL with safe default (PUBLIC_BACKEND_URL exists)
- [ ] Helper to build share URLs (WhatsApp wa.me, Facebook sharer, X intent, Telegram; note Instagram no web share URL)

---

## STEP 4 - Tests (Backend/test) & Run Full Suite - [ ] NOT COMPLETED

### Tests to Create
- [ ] create/read/like/comment/report/share flows
- [ ] permissions: stranger cannot post as team
- [ ] permissions: player-linked user can post as that player
- [ ] rate limits
- [ ] hidden/pending are not public
- [ ] communityEnabled=false behavior
- [ ] approval mode
- [ ] auto-hide at 3 reports
- [ ] XSS payload in body/comment not returned unescaped in share HTML
- [ ] NoSQL operator payloads rejected
- [ ] external image URL rejected
- [ ] oversize/invalid image rejected

### Execution
- [ ] Run full backend suite against live API on 127.0.0.1:5000 with throwaway DB `cric-all-e2e`
- [ ] Read summary lines at END of log (# tests / pass / fail / cancelled / skipped)
- [ ] Report exact numbers; expected fail 0, cancelled 0, skipped 1 on Windows
- [ ] Stop API and drop throwaway DB
- [ ] Delete junk logs; do not commit them

---

## STEP 5 - Documentation & Final Push - [ ] NOT COMPLETED

- [ ] Write docs/COMMUNITY_API.md with: endpoints, request/response shapes, error codes, permissions matrix, settings, moderation flow, share URL formats (for PART 2)
- [ ] Commit locally after each step (as per rules)
- [ ] git push origin community-content at the end
- [ ] Print compare link: https://github.com/Abid-Tanoli/Cric-All/compare/master...community-content?expand=1 (no gh CLI)
- [ ] Provide PR title and body

---

## FINAL REPORT - [ ] NOT COMPLETED

Must include:
- [ ] Step 0 findings
- [ ] What you reused
- [ ] Exact test numbers (# tests, pass, fail, cancelled, skipped)
- [ ] What is NOT verified
- [ ] Permission matrix
- [ ] List of endpoints
- [ ] Commit hashes
- Then stop. No merge, no deploy.

---

**Status:** Task document created. Ready to start STEP 0.