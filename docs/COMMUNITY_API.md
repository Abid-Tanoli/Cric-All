# Community API Documentation

This document defines the Community Content API for PART 1 (Backend). Frontend (PART 2) can build against this.

## Base URLs
- API: `http://127.0.0.1:5000/api/community` (local dev/test)
- Share previews: `http://127.0.0.1:5000/share` 
- Public frontend (for redirects): from `PUBLIC_FRONTEND_URL` env var, default `https://cricall.online`

## Settings
Community settings are stored in SystemSettings/CommunitySettings. Fields:
- `communityEnabled` (bool, default false)
- `postMode` ("auto"|"approval", default "auto")  
- `bannedPosters` (array of User IDs)
- `maxPostsPerUserPerDay` (number, default 10)
- `maxImagesPerPost` (number, default 6)

## Models

### CommunityPost
- `authorUser` (ObjectId ref User) - required
- `subject` - `{ type: "team"|"player"|"user", ref: ObjectId }` - required
- `kind` - `"photo"|"video"|"article"|"story"` - required
- `title` (string, max 120, optional)
- `body` (string, max 10000, plain text only - NO HTML)
- `media` (array) - up to 6 items `{ url, alt }`
- `videoUrl` (string, optional) - validated against allowlist (YouTube, Facebook, Instagram)
- `videoProvider` (string|null) - "youtube"|"facebook"|"instagram" if valid
- `videoId` (string) - extracted ID
- `status` ("published"|"pending"|"hidden"|"removed", default "published")
- `likeCount`, `commentCount`, `shareCount`, `reportCount` (numbers, default 0)
- `isDeleted`, `deletedAt`, `deletedBy` (soft delete)
- Timestamps

### CommunityLike (unique user+post)
- `user` (ObjectId), `post` (ObjectId)

### CommunityComment
- `post`, `author` (ObjectIds), `body` (max 1000), `status` ("published"|"removed")
- Soft delete fields

### CommunityReport (unique per reporter+target)
- `post` or `comment` (ObjectId, one must be set), `reporter`, `reason` enum, `note` (max 500)

## Endpoints

### Public Reads (no auth required)
- `GET /api/community/feed` - Cursor pagination. Query: `cursor` (ISO), `limit` (1-50, default 20), `kind`, `subjectType` (team|player), `subjectId`. Returns `{ posts, nextCursor, hasMore }`. Only published, non-deleted. Hides reserved test name content. If communityEnabled false, returns empty feed.
- `GET /api/community/posts/:id` - Get single published post. 404 if not found/hidden/disabled.
- `GET /api/community/posts/:id/comments` - Cursor pagination for comments. Query: `cursor`, `limit`. Returns `{ comments, nextCursor, hasMore }`.
- `GET /api/community/teams/:id/posts` - Posts for a team (subject type team). Filters by kind. Hides if team has reserved test name or is hidden.
- `GET /api/community/players/:id/posts` - Posts for a player (subject type player). Similar filtering.

### Share Previews (no auth required, SSR HTML)
- `GET /share/post/:id` - Returns HTML with Open Graph and Twitter meta tags. Meta refresh + JS redirect to SPA `PUBLIC_FRONTEND_URL/community/post/:id`. Never leaks hidden/pending content; generic preview for unknown/disabled.
- `GET /share/team/:id` - Redirects to SPA team page, similar OG tags.
- `GET /share/player/:id` - Redirects to SPA player page, similar OG tags.

**OG tags:** `og:title`, `og:description` (truncated to ~200 chars), `og:image` (absolute https URL from post/team/player media/logo or empty), `og:url`, `og:type=article`, plus Twitter card tags.

### Share URL Formats (for frontend)
- WhatsApp: `https://wa.me/?text={title}%20{url}`
- Facebook: `https://www.facebook.com/sharer/sharer.php?u={url}`
- X (Twitter): `https://x.com/intent/tweet?text={title}&url={url}`
- Telegram: `https://t.me/share/url?url={url}&text={title}`
- Instagram: No web share URL (use native Web Share API + copy link)

## Error Codes
- `COMMUNITY_DISABLED` - Community is disabled (403 or leads to 404 for public reads as specified)
- Standard HTTP codes (400, 401, 403, 404, 429, 500)

## Permissions Matrix (planned)
- Post as team subject: requires user is org owner/manager (via requireOrgPermission). Platform admins can post as anything.
- Post as player subject: requires user linked to that player (Player.createdBy == userId). Platform admins bypass.
- Edit/Delete own post: only author.
- Like/Comment/Report/Share: various auth rules as implemented.
- Admin actions: require admin role.

## Moderation Flow
- `postMode` "auto": new posts get status "published" (subject to auto-hide rules)
- `postMode` "approval": new posts get status "pending" (visible only to author and admins)
- Post with `reportCount >= 3`: auto-switches to status "hidden" pending admin review
- Admin queue contains pending + reported items
- Admin can approve/hide/remove/restore posts; ban posters

## Implementation Notes
- All text output paths escape HTML (see share controller). Store as plain text; never render raw HTML.
- Strip control characters, reject HTML tags in user input (sanitizeText helper).
- NoSQL operator injection protection - follow existing noSqlInjection test patterns.
- Images: only jpg/png/webp, max 5MB each, count limited by maxImagesPerPost. Only accept platform's own upload URLs (reject arbitrary external). Reuse photoStore.
- Rate limiting on create/comment/like/report/share (per-user and per-IP).
- Reserved test name filtering applied to public reads (using existing publicProjection helpers).
- Cursor-based pagination (not offset) for feeds/comments.
