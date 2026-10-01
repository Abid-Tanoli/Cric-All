# Scoring and squad route authorization audit

Audit scope: every ball, score, innings, toss, and squad route found under
`Backend/src/routes`, plus every inbound Socket.IO event in `src/socket/socket.js`.

## Match scoring, innings, and toss

| Route | Guard | Access rule |
| --- | --- | --- |
| `POST /matches/:matchId/score` | `protect` → `requireVerifiedEmail` → `requireMatchScoreAccess` | Platform admin, or active member of `Match.organizationRef` with `score_match` |
| `POST /matches/:matchId/end-innings` | same | same |
| `POST /matches/:matchId/start-next-innings` | same | same |
| `POST /matches/:matchId/reduce-overs` | same | same |
| `POST /matches/:matchId/resolve-tie` | same | same |
| `POST /matches/:matchId/start-super-over` | same | same |
| `PUT /matches/:matchId/edit-commentary` | same | same |
| `POST /matches/:matchId/field-click` | same | same |
| `POST /matches/:matchId/revert-ball` | same | same |
| `POST /matches/:matchId/set-bowler` | same | same |
| `POST /matches/:matchId/ai-commentary` | same | same |
| `POST /matches/:matchId/timeout` | same | same |
| `POST /matches/:matchId/drs` | same | same |
| `POST /matches/:matchId/reset-innings` | same | same |
| `POST /matches/:matchId/reset-match` | same | same |
| `POST /matches/:matchId/retire-batsman` | same | same |
| `PUT /matches/:matchId/edit-ball` | same | same |
| `PUT /matches/:matchId/official-status` | same | same |
| `PUT /matches/:id/status` | `protect` → verified email → score access | same |
| `PUT /matches/:id/mom` | same | same |
| `PUT /matches/:matchId/toss` | same | same |
| `POST /livematch/:matchId/ball` | `protect` → `requireVerifiedEmail` → `requireMatchScoreAccess` | same; this legacy alias was previously guarded only by `requireAdmin` and is now tenant-scoped |

`requireMatchScoreAccess` rejects a missing membership and a member without
`score_match` with 403, rejects a scorer from another organization with 403,
and permits platform administrators. Organization-less historical matches stay
platform-admin-only. The controller also rejects a completed innings and a
match in `completed` or `pending_tie_resolution` state with 409.

## Squad and roster routes

| Route | Guard | Access rule |
| --- | --- | --- |
| `PUT /matches/:matchId/playing-xi` | `protect` → verified email → `requireMatchAccess(CREATE_MATCH)` | Platform admin, or active org member with `create_match` |
| `PUT /matches/:matchId/openers` | same | same |
| `PUT /matches/:matchId/squad15` | same | same |
| `PUT /matches/:matchId/twelfth-man` | same | same |
| `PUT /matches/:matchId/bowling-xi` | same | same |
| `PUT /matches/:matchId/team-roles` | same | same |
| `PUT /organizations/:id/matches/:matchId/squads` | org `matchWrite`: authenticated, verified, org-scoped `create_match` | Members granted `create_match` in that organization |
| `POST /organizations/:id/teams/:teamId/players` | org `squadWrite`: authenticated, verified, org-scoped `manage_players` | Members granted `manage_players` |
| `DELETE /organizations/:id/teams/:teamId/players` | same | same |
| `PUT /organizations/:id/teams/:teamId/players/:playerId` | same | same |
| `POST /events/:eventId/squad` | `protect` → `requireAdmin` → verified email | Platform admin only (legacy global event management) |
| `PUT /events/:eventId/squad/change-player` | same | same |
| `GET /events/:eventId/squad[/:teamId]` | public; ObjectId validation only | Read-only event squad |
| `POST /tournaments/:tournamentId/squad` | `protect` → `requireAdmin` → verified email | Platform admin only (legacy global tournament management) |
| `DELETE /tournaments/:tournamentId/squad/:teamId` | same | same |
| `GET /tournaments/:id/squad[/:teamId]` | public; ObjectId validation only | Read-only tournament squad |
| `GET /international/series/:id/squad` and `/intl/series/:id/squad` | public handler | Read-only external series squad |
| `GET /series/:id/squads` | public handler | Read-only series squad |
| `GET /matches/:id/squads` | public handler with ObjectId validation | Read-only match squads |

Other match fixture management routes (`create/update/delete`, format changes,
official assignment, and umpire signal) remain platform-admin-only in
`matchRoutes.js`; they do not record a ball, change an innings, set a toss, or
edit a squad.

## Socket.IO inbound events

| Event(s) | Handler | Authorization / effect |
| --- | --- | --- |
| `joinRoom`, `join-match`, `JOIN_IMATCH`, `JOIN_MATCH`, `JOIN` | joins requested match room aliases | No authentication or tenant check; read subscription only |
| `leaveRoom`, `leave-match`, `LEAVE_IMATCH`, `LEAVE_MATCH`, `LEAVE` | leaves room aliases | No authentication; read subscription only |
| `join-teams`, `join-players`, `join-cricket-live` | joins public feed rooms | No authentication; read subscription only |
| `match:updateList` | broadcasts list refresh | No authentication; no database mutation |
| `disconnect` | logging only | No write |

There is no inbound ball/scoring Socket.IO event or write handler. Score,
innings, and toss mutations are HTTP-only and pass through `requireMatchScoreAccess`.
The E2E Socket.IO probe attempts plausible score event names as an anonymous
client and verifies no acknowledgement and no scorecard change. The unrestricted
room-join handlers can expose live-feed data to anonymous clients; this is a
read-access concern, not an unguarded scoring write.
