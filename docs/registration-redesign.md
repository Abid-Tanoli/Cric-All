# Registration redesign & organization types

Status: **design only** — no code for this work is included in the location PR.
This document records what the current code does, then proposes a small,
ordered set of follow-up PRs.

## 1. What exists today

### Entities

| Model | File | Place fields | Notes |
| --- | --- | --- | --- |
| `TeamOrganization` | `Backend/src/models/TeamOrganization.js` | legacy `location.{city,area,address,country}`; new `locationRefs` / `locationLabels` / `locationIds` | Created by the self-service `POST /api/organizations` or by an admin. `owner`, `createdBy`, `parent`, `category`, `type` (free-form string validated against `TeamCategory`), `verificationStatus` (`unverified`/`pending`/`verified`), `isActive`, `privacy`. Memberships and permissions live in `Membership` + `permissions/orgPermissions.js`. |
| `Team` | `Backend/src/models/Team.js` | legacy `address.{town,district,city,province,country}`; new location refs | Belongs to an organization through `organizationRef` (optional: the public catalogue still has org-less teams). Created by `teamService.createTeam`; `POST /api/teams` does **not** auto-create an organization. The org flow creates the org first, then its teams (`POST /api/organizations/:id/teams`). |
| `Player` | `Backend/src/models/Player.js` | legacy `address.*`; new refs | Optional `team`; free agents exist. Self-service create via `POST /api/players`. |
| `Tournament` | `Backend/src/models/Tournament.js` | legacy `content.city`; new refs | Can be org-owned (org competitions) or platform-run. |
| `Match` | `Backend/src/models/Match.js` | legacy `address.*`; new refs | Venue location is optional. |
| `Event` | `Backend/src/models/Event.js` | new refs | Series/tournament grouping. |
| `User` | `Backend/src/models/User.js` | none | Registration collects name, email/phone, password. It does **not** collect a country/city. Location is attached to the organization and the player profile, not the login account. |

### How organization + team creation is linked today

1. A signed-in, identity-verified user posts to `POST /api/organizations`.
   `createOrganization` sets `owner`/`createdBy` from the session, forces
   `verificationStatus` from the platform setting (`requireOrgApproval`), and
   writes the founding `Membership(owner)` row. The response is the org.
2. The org owner then creates branches (`POST /api/organizations/:id/teams`).
   `teamService.createTeam` sets `organizationRef` and `organization` (display
   name), and the creator is granted the team management role through the org
   permission layer. There is no automatic "default team".
3. Small clubs therefore fill the organization form and then a second team form
   even when they only have one side.

### Handover, memberships and permissions (must not change)

- `orgHandoverController` + `Membership` rows own transfer of an organization.
- `middleware/orgAccess.js` resolves a caller's roles for an org (and its child
  orgs); `permissions/orgPermissions.js` maps roles to permission strings.
- Team management is derived from the owning organization; org-owned
  competitions (`orgCompetitionsController`) check the same access helper.
- Any new org/team fields must be additive and must not change these semantics.
  A default team is a *convenience*, not a new permission path: it is created by
  the same service and records the same owner/membership rows.

### Registration and profile screens

- `Frontend/User/src/pages/auth/AuthPage.jsx` — sign-up / sign-in. No location.
- `Frontend/User/src/pages/organization/CreateOrganization.jsx` — org name, type,
  description, location, contact, social links, privacy.
- `Frontend/User/src/pages/organization/OrgSettings.jsx` — edits the same fields.
- `Frontend/User/src/components/CreatePlayerProfile.jsx` and
  `Frontend/User/src/components/PlayerForm.jsx` — player profile and address.
- `Frontend/Admin/src/pages/Organizations.jsx` — supervisory org list/edit.
- `Frontend/Admin/src/components/admin/teams/TeamForm.jsx` /
  `Frontend/Admin/src/pages/TeamEdit.jsx` — team edit (currently a single
  free-text `city` plus an optional Google Maps lookup).
- `Frontend/Admin/src/pages/ManagePlayers.jsx` — admin player edit (address block).
- `Frontend/User/src/pages/TeamProfile.jsx`,
  `Frontend/User/src/pages/tournament/TournamentHub.jsx`, `MyPlayers.jsx` —
  display existing address fields.

With the location PR, every one of those forms now has the shared
`LocationSelect`; legacy text remains readable as a hint.

## 2. Proposed organization types (next PR)

Replace the free-form `TeamOrganization.type` (validated against admin-managed
`TeamCategory`) with a fixed enum, keeping `type` for backward compatibility and
adding `orgType`:

```js
orgType: "local_club" | "registered_club" | "school" | "college" |
         "university" | "company" | "foundation" | "other"
```

| Type | Label | Type-specific fields |
| --- | --- | --- |
| `local_club` | Local club | none beyond name/location |
| `registered_club` | Registered club | `registrationNumber`, `registrationAuthority`, `affiliation`, `foundedYear`, optional verification |
| `school` | School | `institutionName`, `educationLevel` (`primary`/`middle`/`high`), `affiliationBoard` |
| `college` | College | `institutionName`, `educationLevel` (`intermediate`/`degree`), `affiliationUniversity` |
| `university` | University | `institutionName`, `department`, `affiliationBody` (optional) |
| `company` | Industry / company | `companyName`, `industrySector` |
| `foundation` | Foundation / NGO | `foundationName`, `registrationNumber` (optional), `focusArea` |
| `other` | Other | free-text `typeNote` |

Verification (optional): `verificationStatus` already exists
(`unverified`/`pending`/`verified`) with `verifiedBy`/`verifiedAt`. The proposal
reuses it for registered clubs only, shows a **Verified** badge on the org and
team pages, and keeps approval in the Admin app. No new auth or permission
concept is needed: `verificationStatus` is already supervisory
(`SUPERVISORY_FIELDS`) and audited.

Type-specific fields should live in one additive subdocument,
`typeDetails: { … }`, rather than dozens of top-level columns. Validation is a
per-type schema in a service, so unknown fields cannot be written.

## 3. Organization > Teams

- The existing `Team.organizationRef` is the relationship. No new collection is
  required.
- Give each team a `teamRole`/label for the side it represents: `1st XI`,
  `U19`, `U16`, `women`, `other`. Default `1st XI`.
- When a **local club** is created, automatically create one team with
  `teamRole: "1st XI"`, the org's name, its location inherited from the
  organization, and the creator as manager. This is a service-level default, not
  a second form. Registered clubs/schools/etc. get the same default; "add another
  team" remains available.
- Teams may override the org location (already supported by `locationRefs` on
  both models). The team inherits at create time; later org moves do not
  silently rewrite existing teams.

## 4. Migration and rollback

- Add `orgType` with a backfill script that maps the current free-form `type`
  and `TeamCategory.slug`/name:
  `club → local_club`, `school → school`, `college → college`,
  `university → university`, `industry/business/corporate → company`,
  `ngo/foundation → foundation`, anything unknown → `other`.
  Dry-run first (`--apply` to write), same pattern as the location migration.
- Keep `type` readable. Read paths prefer `orgType` when present and fall back to
  `type`; write paths write both during the transition.
- `typeDetails` is optional and additive; no existing field is removed.
- Rollback: the migration only sets new fields. Reverting the deploy leaves old
  clients reading `type`/`location` exactly as before; a `--revert` mode clears
  `orgType`/`typeDetails` if needed, but is not required for correctness.
- Default-team backfill is **not** applied to existing organizations in the
  migration (it would create noise); it applies only to newly created local
  clubs. Existing orgs can add a team with one click.

## 5. Filtering and separation by organization type

- Listings already accept `orgType` on team rankings
  (`rankingService.buildTeamScopeQuery`) and the User Teams page filters by
  `organizationRef.type` client-side.
- Add a server-side `orgType` filter to `GET /api/organizations`,
  `GET /api/teams`, player listings (via team's org), tournaments and matches,
  reusing the same `$in`-on-org-ids approach already used for rankings.
- `orgType` is denormalized onto the team projection (`organizationRef.type`) so
  the UI can badge/filter without an extra lookup.
- Keep "all types" as the default so existing views are unchanged.

## 6. Registration flow proposals

1. **Choose what you are registering** — player profile, local club, registered
   club, school/college/university, company, foundation. This is a single
   branching screen, not a longer org form.
2. **Local club**: name, location, one default team — done in one form.
3. **Registered club**: the above plus registration number/authority and an
   optional "request verification" checkbox. Verification is reviewed in Admin.
4. **Institution**: institution name, level, affiliation, location; a default
   team is created.
5. **Player**: unchanged, but location uses the shared select.

## 7. Files, endpoints and risks per PR

### PR 1 — org type model + type-specific fields

- `Backend/src/models/TeamOrganization.js` (`orgType`, `typeDetails`)
- `Backend/src/services/organizationService.js` (per-type validation)
- `Backend/src/controllers/organizationController.js` (accept/validate, audit)
- `Backend/src/scripts/migrateOrgTypes.js`
- `Frontend/Shared/orgTypes.js` (labels, fields, badge metadata)
- `CreateOrganization.jsx`, `OrgSettings.jsx`, `Admin/Organizations.jsx`
- Tests: model validation per type, migration dry-run/apply, API rejects unknown
  fields.

### PR 2 — default team + team labels

- `Backend/src/services/teamService.js` (optional `createDefaultTeam`),
  `organizationController.createOrganization`
- `Team.teamRole` (+ index on `organizationRef, teamRole`)
- Org/team forms show the created default team.
- Tests: one team is created for a local club, owner is manager, no duplicate on
  retry; existing orgs unaffected.

### PR 3 — verification badge

- Reuse `verificationStatus`; add `verified` badge to org/team pages and an
  Admin queue filter. No new model.
- Tests: only Admin can set `verified`; audit entry written.

### PR 4 — org-type filters + registration branching UI

- Listing controllers/services (`teams`, `organizations`, `players`,
  `tournaments`, `matches`, rankings) accept `orgType`.
- New registration branching screen and org form variants.
- Tests: filter by type incl. "all"; player filter follows the team's org.

Risks:

- Free-form `type` values in production that do not map cleanly — mitigated by
  mapping to `other` and keeping `type`.
- Duplicate default teams on retries — mitigated by an idempotency check on
  `(organizationRef, teamRole)`.
- Handover/permission regressions — no changes to `Membership`, `orgAccess` or
  `permissions`; the default team is created through the existing service.
- Filtering by org type can be slow if done as a join; denormalized
  `organizationRef.type` plus the existing index is preferred.

## 8. Order of work

1. Org type model + migration (no UI behaviour change).
2. Type-specific forms behind the existing create/edit screens.
3. Default team for new orgs.
4. Verification badge + Admin review.
5. Registration branching screen and org-type filters.

Each PR is independently deployable and reversible; none changes scoring,
handover, permissions, auth, ads, sponsors or awards.
