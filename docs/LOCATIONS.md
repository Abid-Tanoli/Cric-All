# Locations

The location tree backs every country / province / district / city / town dropdown
in the User and Admin apps. It is curated data stored in MongoDB (the `locations`
collection), versioned in the repository and seeded by an idempotent script.

- Model: `Backend/src/models/Location.js`
- Seed data: `Backend/src/data/locations/pakistan.json` (version `1`)
- Seed script: `Backend/src/seed/locations.js`, run with `npm run seed:locations`
- Public API: `GET /api/locations`, `GET /api/locations/:id/path`
- Entity references: `locationRefs`, `locationLabels`, `locationIds`
  (see `Backend/src/models/locationRefs.js`)

## Tree rules

| Type | Parent must be |
| --- | --- |
| `country` | *(none)* |
| `province` | `country` |
| `district` | `province` |
| `city` | `district` |
| `town` | `city` |

Names are unique per parent (case/whitespace-insensitive). Provinces are used for
all first-level units, including Islamabad Capital Territory, Gilgit-Baltistan and
Azad Jammu and Kashmir — dropping to a separate "territory" type would complicate
every dropdown without changing the data.

## Seed coverage (v1)

| Level | Seeded | Notes |
| --- | --- | --- |
| Country | 194 | Pakistan fully seeded; 193 other countries are country-only entries with no sub-levels yet. |
| Province / territory | 7 | 4 provinces + Islamabad Capital Territory, Gilgit-Baltistan, Azad Jammu and Kashmir. |
| District | 172 | Sourced district tables for the 2023 census. |
| City / tehsil | 347 | District headquarters plus well-known tehsil towns listed on the corresponding district pages. This level is what the UI labels "City / Tehsil". |
| Town / area | 0 | Intentionally empty. Small areas are incomplete by nature and are handled by the **Other (add new)** flow, then approved in Admin → Locations. |

Missing / deliberately not seeded:

- No towns/areas for any district in v1.
- No union councils, villages or neighbourhoods (below the town level).
- No sub-levels for any country other than Pakistan.
- District sets change with administrative reorganisations; re-run
  `npm run seed:locations` after updating the JSON. The script only inserts
  missing nodes and never deletes or overwrites existing rows.

### Sources

- Districts: <https://en.wikipedia.org/wiki/Districts_of_Pakistan>, which cites the
  Pakistan Bureau of Statistics 2023 census. The same page supplied the
  province/territory grouping.
- Cities/tehsils: district headquarters plus the tehsil/town names on the
  corresponding district pages. Names only — no coordinates or boundaries.
- Provenance is stored on every seeded row in `source`, and summarised at the top
  of `pakistan.json` in `sources`.

The script does not invent places. Where a level could not be sourced reliably it
is left empty rather than guessed.

## Entity references

Filterable entities (`Team`, `TeamOrganization`, `Player`, `Tournament`, `Match`,
`Event`) keep their legacy free-text fields **unchanged** and add:

```js
locationRefs:   { countryId, provinceId, districtId, cityId, townId }
locationLabels: { country, province, district, city, town }   // denormalized names
locationIds:    [ …every node on the branch, root … chosen node ]
```

`locationIds` is what makes "this node or any descendant" a single indexed
equality match. The server resolves the refs and labels from the chosen node's
stored ancestors, so a client cannot create a branch that does not exist.

Forms that write these refs:

- **User:** registration player profile, organization create/settings, player
  profile (`MyPlayers` still uses its legacy text fields until it is migrated).
- **Admin:** player form, team form, event form, tournament content overview.
- Every form keeps the legacy text fields visible and editable; a record that only
  has old text shows that text as a hint beside the dropdowns.

Migration for historical free text:

```bash
npm run locations:migrate          # dry run: prints mapped / ambiguous / unmatched
npm run locations:migrate:apply    # writes references, dry run otherwise
```

Matching is exact name/alias only. Ambiguous values are reported and left alone.
Legacy text is never removed.

## API

Public (cached 60s in-process and by the browser/CDN):

- `GET /api/locations?type=city&parent=<id>&q=lah&limit=50`
  — children of a parent (default `parent` is ignored, i.e. all matching nodes),
  active + approved only. `ids=` accepts up to 50 ids for prefilling a form.
- `GET /api/locations/:id/path` — the ancestor chain, root first.

Authenticated:

- `POST /api/locations/suggest` `{ name, type, parentId }` — creates an unapproved
  sibling; deduped per parent; 10 per hour per account. Unapproved nodes are
  visible only to their creator and platform admins, and become usable by
  everyone once approved.

Admin (`/api/locations/admin/...`): list, create, update/deactivate, approve,
reject, and merge into an existing node. Every change is written to the audit log.
