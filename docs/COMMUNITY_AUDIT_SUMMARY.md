# STEP 0 FINDINGS (~20 lines)

1. No existing CommunityPost/CommunityLike/CommunityComment/CommunityReport models - need to create new ones.
2. Blog exists (separate from community posts). TournamentArticle/TournamentMedia exist for tournament hub. Commentary for matches.
3. Frontend/User: MyPlayers.jsx for user-created player profiles linked via createdBy on Player; users can claim/edit own player profiles.
4. Membership model links User to TeamOrganization with roles array; requireOrgPermission middleware + orgPermissions.js define roles (owner/manager/content_manager/social_media_handler etc for team post permissions).
5. Upload: photoStore.js validates jpg/png/webp, stores locally with safe names, uploadFilenameFromUrl rejects external; POST /api/upload/image is admin-only (protect+requireAdmin+requireVerifiedEmail) with 5MB limit and mimetype filter.
6. No sharp lib visible; cloud storage optional via env vars.
7. Feature flags: VITE_SHOW_* build-time; runtime settings via /api/settings/external-api etc (SystemSettings model). No generic /api/config exposing all flags.
8. NoSqlInjection test exists - must follow its patterns. No sanitize-html deps; output rendered as text. Must escape HTML in share pages.
9. Rate limiter exists (in-memory) - can adapt for per-user/per-IP on community endpoints.
10. Public projection utils (reservedNamesRegex, isReservedTestName) for hiding test data.
11. MyPlayers linkage: Player.createdBy = userId; /api/players/mine gives user's players. So "user linked to player" = Player.createdBy == user or via other linkage? Check - users create player profiles themselves (self-service). So for posting as player subject, the poster must be the creator/linked owner of that player record.
12. Use existing middleware/patterns - don't duplicate. Admin auth uses protect+requireAdmin. Platform admins (superadmin/admin role on User) bypass org checks in orgAccess (isPlatformAdmin).
13. Team posts: need org owner/manager permission - roles include owner, admin, manager, team_manager; requireOrgPermission exists.
14. Images for community: can reuse photoStore logic but upload endpoint is admin-only currently - need to consider if community posting allows image uploads; task states "reuse existing upload endpoint/photoStore" - but current /api/upload/image requires admin. Need to follow existing pattern.
15. No HTML in stored content - Blog.content is plain text; follow that.
16. Soft delete fields needed for posts/comments.
17. Cursor pagination pattern exists in codebase? Look up how lists are paginated.
18. Audit log pattern exists? AuditLog model exists - used for org audit logs.
19. Share: need SSR HTML with OG tags - can add routes like /api/share or just /share; need to serve HTML.
20. Reuse everything; add community module minimally.