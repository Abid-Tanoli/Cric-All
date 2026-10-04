# Round 5 Report — Public data projection & team tenancy

**Status:** complete locally, uncommitted
**Target:** local only (`127.0.0.1:27017`, database `cric-all-e2e`)
**Baseline before this round:** backend `306/306`, E2E `78 pass / 7 of 7 scenarios`
**Status now:** backend `344/344`, E2E `78 pass / 7 of 7 scenarios`, both frontend builds pass

> **Amended after review.** The first pass of this round shipped with three
> defects that its own tests and report did not catch. They are fixed here and
> the numbers below are from the amended tree, not the original one. See
> §3.5–§3.7 for what was wrong and §4 for the re-run evidence.

---

## 1. Scope and constraints

| Constraint | How it was honoured |
|---|---|
| Local `cric-all-e2e` only | Migration takes an explicit `--uri`; the E2E guard proves loopback-ness at the socket layer. `Backend/.env` points at a public Atlas cluster and was **never read or printed**. |
| Guard must pass | `test/e2e/lib/guard.js` passed before the E2E run and before the backend restart. |
| No commit / no push | All work is left in the working tree for review. |
| No `npm audit fix --force` | Never run. |
| Report, do not silently delete data | The migration renames and deletes nothing. |

---

## 2. What changed

### 2.1 A single shared projection module

New: `Backend/src/utils/publicProjection.js`

Every public Player and Team read now goes through one **whitelist**, not a
hand-maintained blacklist. The rules it enforces:

1. **Whitelist, never blacklist.** A field nobody thought about is absent by
   construction. Adding a column to `Player.js` or `Team.js` cannot leak it.
2. **`createdBy`, `__v` and the seed markers never appear in a public body.**
   Who typed a profile in is not public information.
3. **Privacy flags gate what the whitelist would otherwise include.**
4. **Escalation is explicit and narrow** — the profile's creator, a manager of
   the organization owning the player's team, and platform admins see the full
   document. Everyone else sees the public projection.

The key set is **stable**: every whitelisted key is always present, with a
type-correct empty value when the underlying field is unset. This is deliberate —
the frontend reads `player.address.city` and `player.stats.runs`
unconditionally, and a key set that varies per row is not a contract you can
test.

Also new: `optionalProtect` middleware (`Backend/src/middleware/authMiddleware.js`)
for public routes whose *shape* depends on who is asking. It identifies the caller
when a valid token is present and never rejects an anonymous request.

### 2.2 Endpoints covered

| Endpoint | Before | After |
|---|---|---|
| `GET /players` | full Player docs | `PLAYER_PUBLIC_FIELDS` exactly |
| `GET /players/:id` | partial hand-rolled blacklist, dead `email/phone` branch | same whitelist; dead branch gone |
| `GET /players/ranking` | full docs, unbounded | paginated envelope, `limit` clamped to 200 |
| `GET /players/free-agents` | returned straight from the service, never projected | controller-level projection |
| `GET /players/:id/players` (roster) | full Player docs | roster projection / full for managers |
| `GET /rankings-v2/players/team/:teamId` | embedded full `player` doc | embedded player projected |
| `GET /teams` | every team, cross-tenant | org-less teams, plus org-owned teams explicitly published (`isPublic`) |
| `GET /teams/:id` | raw doc, fully populated `players` | roster projection |
| `GET /organizations/:id/teams` | same leak | same fix |
| orgTeams `teamPayload` | hand-written field list | shared sanitizer, `playerCount` preserved |

### 2.3 Per-organization team name uniqueness (Phase 4)

Team names were globally unique, so **two unrelated organizations could not both
own a "Rising Stars"** — the exact opposite of the tenancy model the rest of the
code implements.

Replaced the single global `unique: true` with two partial unique indexes:

```js
{ organizationRef: 1, name: 1 }   unique, collation en/strength 2
                                  partial: { organizationRef: { $type: "objectId" } }
{ name: 1 }                       unique, collation en/strength 2
                                  partial: { organizationRef: null }
```

`{ organizationRef: null }` in a partial filter also matches an *absent* field, so
between them the two indexes cover every team. Backed by an application-level
check in `teamService.assertTeamNameAvailable` (case- and accent-insensitive) so a
database without the indexes still behaves.

### 2.4 Platform-admin organization move guard

`PUT /api/teams/:id` had no tenancy rule at all, so a platform admin could
silently move a tenant's team to another organization — or orphan it into an
org-less team — taking its roster and fixture history with it.

Now:

- The move must be asked for by name: `allowOrganizationChange: true`. Without it
  the request is refused with `409 TEAM_ORG_CHANGE_REQUIRES_FLAG`.
- The flag is stripped before persistence (it is never stored).
- An accepted move writes an `AuditLog` entry (`team.organization_changed`) naming
  both the source and target organization.
- If that audit write fails, the response is `500 TEAM_ORG_CHANGE_AUDIT_FAILED`
  rather than a silent success.

### 2.5 The latent bug: the city field that never saved

City updates silently did nothing. `updateTeamLocation` did `team.city = city`,
but `Team.js` has no top-level `city` field — Mongoose's strict mode discarded
it. It now writes `team.address.city`, and the response echoes the values that
actually stuck.

The same bug existed in **two more places**, both now fixed:

- `createTeam` assigned a top-level `city`, so a city given at creation time was
  dropped on the floor. A flat `city` now fills `address.city`; an explicit
  `address` object wins over the flat field rather than being clobbered by it.
- `getTeamProfile`'s branch query selected `"... city ..."`. A nonexistent path
  selects nothing, so **every branch in the branches list came back with no city
  at all** — which is why `Admin/Teams.jsx:232`, which renders
  `branch.address?.city`, had nothing to show. It now selects `address`.

---

## 3. Real bugs found *while* testing this round

These were not in the original audit. Each is now covered by a test.

1. **The unique index matched nothing.** The compound index's partial filter was
   `organizationRef: { $type: "string" }`, on the reasoning that Mongoose stores
   refs as strings. `organizationRef` is declared `Schema.Types.ObjectId`, so it is
   stored as a BSON ObjectId and `$type: "string"` matches **zero documents** —
   silently leaving uniqueness to the application check alone. The migration
   script repeated the same claim and the same bug. Confirmed empirically against
   the local database: **147 of 147** org-owned teams hold a BSON ObjectId.

2. **An org move with no audit trail.** `updateTeam` returns a document whose
   `organizationRef` is *populated*, so `String(team.organizationRef)` produced the
   entire organization object rather than its id. The audit write then failed to
   cast `organization` to an ObjectId — and because `recordAudit` catches and logs
   internally, **the move succeeded and the audit row was never written**. Fixed
   by unwrapping the id, and the controller now surfaces an audit failure instead
   of swallowing it.

3. **Two public reads were never projected at all.** `GET /players/free-agents`
   was an inline route handler returning the service result verbatim, and
   `GET /teams/:id/players` did the same. Both are now controller-level and tested.

4. **Manager escalation that could never fire.** The `.select()` on roster and
   ranking queries loaded only public columns, so an organization manager was
   recognised by the sanitizer and then handed a document with nothing extra in
   it. The queries now widen for an identified caller
   (`playerSelectFor(viewer)`), and the owning organization is read off the team
   because the roster query populates only `name shortName`.

### 3.5 The tenancy rule was cancelled by its own default flag

`Team.isPublic` defaulted to `true`, and `listTeams` admits an organization-owned
team to the public list when `isPublic` is true. Those two facts together meant
the filter matched **every team in the database**: the "public" catalogue was a
cross-tenant directory of all 147 local teams, which is the precise thing item 4
of the brief asked me to prevent. A test written to check the rule —
`GET /teams — anonymous list carries no organization-owned teams` — was
**failing** in the tree this report was written against.

Publication is now opt-in: `isPublic` defaults to `false`, and `isPublic` is the
"list me publicly" switch. The visibility toggle that already existed
(`PUT /api/teams/:id/toggle-visibility`) is how a team gets published, so no new
surface was added. `migrateSetIsPublic.js` — which backfilled the flag onto
pre-existing documents — wrote `true`, i.e. it published every legacy team; it
now writes `false`, matching the schema default. Confirmed live: 13 teams created
after the change carry `isPublic: false`, while the 169 rows the *old* backfill
published are still public — see §5 for why that needs a data decision.

### 3.6 `?search=` bypassed the tenancy filter entirely

`listTeams` built the tenancy restriction and the free-text restriction as two
`$or` clauses and assigned both to **`query.$or`**. The second assignment
overwrote the first, so any request carrying `?search=` — the public
`GlobalSearch` box among them — dropped the tenancy restriction altogether and
returned every organization's teams regardless of `isPublic`. Restricting a query
and searching it are two conditions that must *both* hold, which is what `$and`
exists for; the filters now accumulate in `query.$and`.

This one is worth dwelling on: it survived a round whose entire subject was
cross-tenant leakage, and the isolation test that existed did not use a search
term, so it passed.

### 3.7 Two privacy flags were wired to nothing

`Player` declares `privacy.gallery` and `privacy.videos`, both defaulting to
`public`. The sanitizer had branches for both — and `gallery`/`videos` were
**not on `PLAYER_PUBLIC_FIELDS`**, so `pick()` never emitted the keys and
`delete out.gallery` was deleting a key that was never there. The flags could
not fire in either direction. A player who had explicitly published their
gallery got none of it, and `PlayerProfile.jsx`, which renders
`player.gallery` and `player.videos`, showed neither section.

Both fields are now on the whitelist and genuinely gated: `hidden` blanks the
array in place, `public` passes it through. Blanking rather than deleting keeps
the public key set stable, which is the property the exact-key-set test exists
to protect. `User/PlayerForm.jsx` could already submit both fields, so no write
path had to change.

A third branch, `privacy.contactInfo`, was an empty `if` with only a comment. It
is not a bug — `Player` genuinely has no phone, email or website field, so there
is nothing for it to gate — but an empty conditional reads like unfinished work,
so it is now a comment explaining that, and what to do if a contact field is ever
added.

---

## 4. Verification

| Check | Result |
|---|---|
| `Backend/test/publicProjection.test.js` | **38/38 pass** |
| Full backend suite | **344/344 pass** (306 baseline + 38), 0 fail |
| E2E (`npm run test:e2e`) | **78 pass, 0 fail, 0 divergence**, 7 of 7 scenarios, 176.2s |
| E2E guard | passed — server PID 14892, 22 established connections to `127.0.0.1:27017`, no non-loopback peers |
| Frontend/User build | pass (42.8s) |
| Frontend/Admin build | pass (12.0s) |
| Live `GET /api/health` | `dbState: connected`, `dbConnected: true` |
| Exact key set vs. the real whitelist | `GET /teams/:id`, `GET /players/:id` and the roster keys equal `TEAM_PUBLIC_FIELDS` / `PLAYER_PUBLIC_FIELDS` / `PLAYER_ROSTER_FIELDS` exactly — no extra, no missing |
| Migration dry-run | clean: 147 teams, 0 duplicates within any organization |
| Migration apply | both partial indexes created with the correct filter and collation |

The new tests cover the exact public key set, the regression that a brand-new
schema field is not exposed, privacy flags on and off (including the gallery and
video flags that previously did nothing), creator / org-manager / platform-admin
/ stranger visibility, every public endpoint, cross-organization name reuse,
case-insensitive uniqueness, the org-move guard and its audit, the city fix on
all three paths, that `isPublic` is private by default, and that a search term
cannot see past the tenancy filter.

### A note on the backend being down

`npm test` was reporting `ECONNREFUSED 127.0.0.1:5000` for
`noSqlInjection.test.js`, which needs a live server. The brief said the backend
was running; it was not. It was started against
`mongodb://127.0.0.1:27017/cric-all-e2e` with `MAIL_DRIVER=console`, overriding
the environment so `Backend/.env` (which points at a public Atlas cluster, and
which was never read) could not take effect. **Any change under `src/` needs a
restart of that process to take effect — no automatic reload is configured.**

---

## 5. Decisions taken, and the ones still open

### Taken (and worth a second opinion)

- **`birthInfo` is withheld from public responses.** No privacy flag opts date of
  birth in. **Consequence:** `PlayerProfile.jsx` reads `player.dateOfBirth`,
  which does not exist on the model either — the field is `birthInfo.date`. That
  section of the UI has no data behind it and still will not; fixing the UI to
  read a field the API deliberately withholds is a product decision, not a bug
  fix.
- **`gallery` and `videos` are flag-driven, not withheld.** They were withheld in
  the first pass, and the two flags wired to them were inert. They are now on the
  whitelist and gated by `privacy.gallery` / `privacy.videos`, so the Gallery and
  Videos sections on the public player profile render again for anyone who has
  them switched on (the default).
- **`privacy.location` still defaults to `public`.** Public addresses remain
  visible unless a player opts out. If the intent was private-by-default, that is a
  one-line schema default change plus a data backfill.
- **The public team list shows org-less teams, plus org-owned teams that have
  opted in.** `?scope=organization` and `?organizationRef=<id>` are treated as
  explicit intent, and a platform admin sees everything.

### Open — needs your decision

1. **169 of the 182 teams in the local database are marked published, and were
   published by accident.** The old `migrateSetIsPublic.js` backfilled
   `isPublic: true` onto every team that lacked the flag, so "published" was
   never a decision anybody made — it was a side effect of adding the column.
   The code default is now private, and the 13 teams created since the change are
   correctly `isPublic: false`, which confirms the fix. But **a schema default
   only affects new documents**, so the 169 existing rows stay public and the
   cross-tenant catalogue still lists them. `migrateSetIsPublic.js` will not touch
   them either: its filter matches only teams *missing* the flag, and a dry-run
   reports `0`. Flipping them is a data decision, not a code one, and it is not
   mine to take:

   ```bash
   # local cric-all-e2e only; reversible, deletes nothing
   db.teams.updateMany({ isPublic: true }, { $set: { isPublic: false } })
   ```

   Until someone runs that — or decides these teams genuinely should be
   browsable — the tenancy rule is enforced in code but not in the local data.
2. **`/players/ranking` and `/players/free-agents` changed response shape** from a
   bare array to `{ items, total, ... }`. No in-repo consumer of the singular
   ranking route was found, but external clients may exist.
3. **Should creators keep `createdBy` in their own full view?** It is currently
   shown to the creator and hidden from everyone else. The original requirement
   said internal fields are *always* removed; this is the one deliberate exception.
4. **`ownername` is not on the public team whitelist.** `Admin/TeamForm.jsx` reads
   it, but only on a team the caller manages — and a manager gets the full
   document, so the form works. A non-managing reader never sees it, which seems
   right for a person's name, but it is a deliberate omission rather than an
   oversight.
5. **Photo validation (Phase 7) is untouched** — no magic-byte checking, no HTML
   sanitization.

---

## 6. Explicitly not done

- **Player stats are still stored, not derived.** There is no aggregation pipeline
  computing career numbers from `Ball` documents. This remains a denormalization
  risk, unchanged by this round.
- **No linked-user / claim flow.** Only `createdBy` exists.
- Phases 7 and 8 (upload validation, social graph) untouched.
- No production migration was run; only the local `cric-all-e2e` database. The
  `migrateSetIsPublic.js` direction change has **not** been applied anywhere.
- **The UI's dead field reads were not cleaned up.** `PlayerProfile.jsx` reads
  `bio`, `height`, `jerseyNumber`, `nickname`, `nationality`, `battingHand`,
  `bowlingArm`, `fullName`, `country` and `status`, none of which exist on the
  `Player` schema. They render empty today and did before this round; removing
  them is frontend work outside this round's scope.

---

## 7. Files touched

**New**
- `Backend/src/utils/publicProjection.js`
- `Backend/test/publicProjection.test.js`
- `Backend/src/scripts/migrateTeamNameUniqueness.js`

**Modified**
- `Backend/src/models/Team.js` — per-org unique indexes; `isPublic` private by default
- `Backend/src/middleware/authMiddleware.js` — `optionalProtect`
- `Backend/src/services/teamService.js` — `$and` filter composition, create-time
  city, branch projection, org-scoped name checks
- `Backend/src/services/playerService.js`, `rankingService.js`
- `Backend/src/controllers/playerController.js`, `teamsController.js`,
  `rankingController.js`, `organizationController.js`, `orgTeamsController.js`
- `Backend/src/routes/playerRoutes.js`, `teamRoutes.js`, `rankingRoutes.js`,
  `organizationRoutes.js`
- `Backend/src/scripts/migrateSetIsPublic.js` — backfill private, not public
- `Backend/test/helpers/testDb.js` — `mockReq` now defaults `query: {}`
- `docs/phase-status.md`, `docs/e2e-results.md`