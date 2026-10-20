# STEP 0 - Community Content Audit (Read-only)

**Date:** 2026-10-18

## Models
- Blogs exist: `Blog` model (title, content, author, imageUrl, videoUrl, isLive, relatedType/relatedId, tags). No community post/like/comment/report models.
- Tournament content: `TournamentArticle` (title, body, coverImage, authorName, status published/draft/archived, tournamentRef, publishedAt, createdByAdmin) and `TournamentMedia` (tournamentRef, type image/video, url, caption, isPublic, order, createdByAdmin).
- Comments/likes not generic; commentaries are match-specific (`Commentary` model - match, text, over).

## Relationships (User ↔ Player ↔ Team/Org)
- `User` has accountType (player/handler/organization_admin/viewer), role (admin/scorer/viewer), org info. Player has `createdBy` (ref User) - users create their own player profiles (MyPlayers feature). 
- `Membership` (organization, user, roles array, status) + `TeamOrganization`. Org permissions via `requireOrgPermission` and roles in `orgPermissions.js` (owner/admin/manager/coach/captain/vice_captain/score_handler/social_media_handler/content_manager/team_manager/player/staff).
- MyPlayers.jsx allows verified users to create/edit/delete their own player profiles (creator-only writes via playerAccess middleware).

## Uploads
- `utils/photoStore.js`: stores images locally, ALLOWED_EXTENSIONS jpg/jpeg/png/webp, filename format `<epoch>-<hex>-<base>.<ext>`, `uploadFilenameFromUrl` validates against own `/uploads/` and safe names; delete utilities. Cloud storage optional.
- `POST /api/upload/image` (uploadRoutes.js): uses multer memory, fileFilter checks mimetype in allowed list, limits fileSize 5MB, requires protect+requireAdmin+requireVerifiedEmail (admin-only). 

## Feature flags
- Frontend flags in `config/features.js` expose VITE_SHOW_* (videos, rankings, comparison, blogs etc). Also runtime config? No obvious public /api/config endpoint; Admin SyncPanel toggles exist for external sync (settings/sync). Check: syncPanel usage in Admin app - settings routes include external API toggles.

## Sanitization/Security
- NoSQL injection test (`noSqlInjection.test.js`) exists with patterns for operator injection ($ne/$gt/$regex etc), ObjectId handling, prototype pollution. Validation via validateObjectId middleware.
- No explicit sanitize-html/xss library visible in deps? Frontend doesn't use dangerouslySetInnerHTML (per docs). No HTML allowed in Blog content stored as text. Live DB user with script tag mentioned - output escaping matters. Note upload image accepts mimetypes only, but no magic-byte validation.

## Rate limiting
- `rateLimiter.js` middleware: in-memory store, keys by actor (user/ip)+matchId+route+method, windowMs/max configurable. Also `invitationRateLimit.js`. Applied per-route where used.

## Reuse
- Use existing auth (protect/optionalProtect), org permissions (requireOrgPermission), upload/photoStore, validation, rate limiting, public projection helpers (reserved test names, escaping patterns from noSqlInjection tests). Do NOT duplicate.
