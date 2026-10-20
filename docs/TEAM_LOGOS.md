# Team logos — the eight squads-2026-10 clubs

`Backend/src/scripts/attachTeamLogos.js` attaches a logo to each of the seven
clubs that have one, from an operator-supplied manifest of `(team, file)` rows.
It is the one-off companion to `attachPlayerPhotos.js` and follows the same
pattern: **dry-run by default**, `--apply` to write, idempotent, per-row
reporting. This document is the operator runbook: back up, dry-run, apply,
verify, and — if it has to be undone — roll back.

The logo files themselves (real artwork) and the `manifest.csv` live **outside
git**, in `~/team-logos` on the VPS. Nothing image-shaped is ever committed.

---

## 1. What it does, and what it deliberately does not

| Object | Count | Details |
| --- | --- | --- |
| `Team.logo` | 7 | absolute URL into the backend's `/uploads` store |
| Uploaded files | 7 | written by `photoStore.storeImage` into the `uploads_data` volume |

`Team.logo` (in `Backend/src/models/Team.js`) is a plain string URL — the same
field the Admin app's **Edit Team → Logo** upload writes, and the same field
every page renders through a raw `<img src={team.logo}>`. Because the Admin app
renders it raw, the stored URL **must be absolute**, which is why
`PUBLIC_BACKEND_URL` is required.

The script reuses the **exact** code path the Admin upload uses:

- `utils/photoStore.js#storeImage` — the local `uploads` directory, the
  `<epoch>-<hex>-<base>.<ext>` filename scheme, the JPEG-PNG-WebP rules;
- the same absolute URL the `POST /api/upload/image` endpoint returns once
  `PUBLIC_BACKEND_URL` is set.

It does **not**:

- create, rename or delete a `Team` — a manifest row only ever reaches a team
  that **already exists** (matched by exact normalized name: trimmed,
  whitespace-collapsed, case-insensitive). An unknown or ambiguous name is
  reported and never written;
- touch any team **not listed in the manifest** — Ittehad Sports has no logo
  file and is deliberately absent from the manifest, so it is never read or
  written;
- touch players, scoring, or the 12th Man rule;
- delete a file. `--force` re-uploads over an existing logo but the previous
  file is left on disk (sweep it with `npm run db:cleanup-uploads:apply`,
  which only removes files no document references);
- ever write for a team whose name uses a reserved test prefix
  (`OPENCODE_TEST_`, `E2E_`, `TEST_`, `CRICALL_TEST_`, …) — those rows are
  skipped and reported.

### The manifest

A CSV (UTF-8, optional BOM) with the columns `team`, `file`:

```csv
team,file
Young Star,young-star.png
Baldia Zalmi,baldia-zalmi.png
Orangi Warriors,orangi-warriors.png
Family Stallions,family-stallions.png
Orangi United,orangi-united.png
Sky Sports,sky-sports.png
Khan Associates,khan-associates.png
```

That is the expected manifest for this run: **7 rows**. Ittehad Sports has no
logo file and **must simply not be in the manifest**.

- `team` is matched case-folded / whitespace-collapsed against an existing
  team name; two teams folding to the same name (two organizations owning a
  "Rising Stars") are **ambiguous** and refused, never guessed;
- `file` is a path **relative to `--dir`**; `..`, paths outside the folder and
  embedded NUL are refused; only `.png` / `.jpg` / `.jpeg` / `.webp` are
  accepted; files over **5 MB** are refused.

### Exit code

The script exits **non-zero** when any manifest row cannot be matched to
exactly one team, or any referenced file is missing, not a png/jpg/webp, over
5 MB, or an unsafe path. Intentional skips (team already has a logo, duplicate
row, reserved test name) do **not** fail the run. Rows that pass are still
applied — the non-zero exit is the loud signal that the manifest was incomplete
or wrong.

### Idempotency

A re-run with `--apply` changes nothing: a team that already has a logo is
reported under **already has logo** and skipped. `--force` re-uploads for those
teams instead.

---

## 2. Before you start

The script validates the whole manifest (type, size, path, existence of every
file) **before** it opens a database connection, so a bad manifest fails with
nothing written. It still will not run against a target it has not been told
about:

- loopback hosts (`127.0.0.1`, `localhost`, `::1`) are allowed by default; any
  other host needs `--allow-host <name>`;
- the database must be `cric-all-e2e` by default; the live database needs
  `--allow-database cric-all`.

The script **does not read `.env`**. The URI is always passed explicitly, and
it is never printed.

`PUBLIC_BACKEND_URL` **must be set** in the process environment to the
backend's public origin — for the live site that is
`https://api.cricall.online` — because the stored `logo` URL has to be
absolute. The script fails fast if it is unset — it never guesses a host.

---

## 3. Back up first

Never apply a bulk write without a fresh backup. On the VPS, fire the
scheduled backup service once:

```bash
sudo systemctl start cricall-backup.service
systemctl status cricall-backup        # confirm it ran
ls -lt ~/cric-all/Backend/backups/ | head
```

or run the script directly:

```bash
cd ~/cric-all/Backend
npm run db:backup
```

---

## 4. Copy the script and the logos into the backend container

The logo files live in `~/team-logos` on the VPS (copied there from the
operator machine) and are never committed to git. The script is a new
**standalone** file that only imports modules already present in the running
image, so it too is delivered with `docker cp` — **no rebuild** and no change
to any existing image file.

From the operator machine, copy the logos + manifest to the VPS:

```bash
scp -r /path/to/team-logos user@vps:~/team-logos
```

Then, on the VPS (`~/cric-all` is the checkout, `~/team-logos` the folder with
the seven png files and `manifest.csv`):

```bash
# logos + manifest
docker cp ~/team-logos cricall-backend:/tmp/team-logos

# the script (standalone; only uses modules already in the image)
docker cp ~/cric-all/Backend/src/scripts/attachTeamLogos.js \
  cricall-backend:/app/src/scripts/attachTeamLogos.js
```

The `Backend/Dockerfile` copies the app with `WORKDIR /app`, so the script is
`/app/src/scripts/attachTeamLogos.js` and is run as `node src/scripts/...`
from inside the container.

---

## 5. Dry run, then apply

`--uri` uses the container's own `$MONGO_URL`, so run the whole command inside
a container shell (single quotes) — that way the container expands the
variable, not your host shell. Pass `PUBLIC_BACKEND_URL` from the host with
`-e` so the stored URL is absolute. The live API origin is
`https://api.cricall.online`.

**Dry run (no writes):**

```bash
docker exec -e PUBLIC_BACKEND_URL=https://api.cricall.online cricall-backend sh -c '
  node src/scripts/attachTeamLogos.js \
    --manifest /tmp/team-logos/manifest.csv \
    --dir /tmp/team-logos \
    --uri "$MONGO_URL" --allow-host mongodb --allow-database cric-all
'
```

Read the report. For the real manifest you should see `Manifest rows: 7`,
`Matched: 7`, `will attach: 7`, `Errors: 0`, one `[ok]` line per club with its
team id and file, and exit code 0. Anything under `[error]` (unmatched,
ambiguous, missing file, bad type, oversize) must be investigated before
applying — those rows are never written and the run exits non-zero.

```
=== team logos attach ==============================
  Mode          : DRY RUN (no writes)
  ...
  Manifest rows : 7
  Matched       : 7
    will attach         : 7
    already have logo   : 0
  Errors        : 0
...
  [ok] Young Star  id=6650...  file=young-star.png
  ...
Dry run complete. Nothing was written. Re-run with --apply to write.
```

**Apply:**

```bash
docker exec -e PUBLIC_BACKEND_URL=https://api.cricall.online cricall-backend sh -c '
  node src/scripts/attachTeamLogos.js \
    --manifest /tmp/team-logos/manifest.csv \
    --dir /tmp/team-logos \
    --uri "$MONGO_URL" --allow-host mongodb --allow-database cric-all --apply
'
```

Save the **entire apply output**. It reports the number of logos attached, the
stored files, and one URL per team:

```
APPLIED.
  Logos attached: 7
  Stored in     : /app/uploads
  Errors        : 0

  Stored URLs:
    Young Star -> https://api.cricall.online/uploads/1761...-a3f9-young-star.png
    ...
```

Re-running the apply a second time must report every row under **already has
logo** and attach 0 — that is the idempotency check. `--force` re-uploads for
teams that already have a logo; it never deletes the previous file, so sweep
the orphans afterwards with `npm run db:cleanup-uploads:apply` (dry-run first
without `:apply`).

---

## 6. Verify

Count the seven teams that now carry an absolute `/uploads/` logo URL:

```bash
docker exec cricall-mongo mongosh cric-all --quiet --eval '
  const names = [
    "Young Star","Baldia Zalmi","Orangi Warriors","Family Stallions",
    "Orangi United","Sky Sports","Khan Associates"
  ];
  print("teams in manifest   :", db.teams.countDocuments({ name: { $in: names } }));
  print("teams w/ logo       :", db.teams.countDocuments({ name: { $in: names }, logo: { $regex: "^https://api.cricall.online/uploads/" } }));
  print("teams w/o logo      :", db.teams.countDocuments({ name: { $in: names }, $or: [ { logo: { $exists: false } }, { logo: "" } ] }));
  print("Ittehad Sports logo :", JSON.stringify(db.teams.findOne({ name: "Ittehad Sports" }, { logo: 1, _id: 0 })));
  db.teams.find({ name: { $in: names } }, { name: 1, logo: 1 }).forEach(t => print("  ", t.name, "->", t.logo));
'
```

Expected after a clean apply: `teams in manifest 7`, `teams w/ logo 7`,
`teams w/o logo 0`, Ittehad Sports' logo still `""` (untouched), and every
sample URL starts with `https://api.cricall.online/uploads/...`.

The files themselves live in the **`uploads_data` named volume**, mounted at
`/app/uploads` by `docker-compose.yml` — so they survive a rebuild or a
container recreate. Confirm one is served:

```bash
curl -sI https://api.cricall.online/uploads/<filename> | head -1   # HTTP/1.1 200 OK
```

---

## 7. Rollback

Rollback here means **detaching the logos**, not deleting teams. Nothing the
script did is destructive, so undo is a single field-unset scoped to the
manifest's teams. (Take the §3 backup first if you have not.)

### 7.1 `--clear` (the script's own rollback)

`--clear` unsets `Team.logo` for exactly the teams listed in the manifest. It
does not read or check any image file, so `--dir` is not needed. Dry-run
first, then apply:

```bash
docker exec cricall-backend sh -c '
  node src/scripts/attachTeamLogos.js \
    --manifest /tmp/team-logos/manifest.csv \
    --uri "$MONGO_URL" --allow-host mongodb --allow-database cric-all --clear
'
# read the report: 7 [clear] rows with their team ids, then:
docker exec cricall-backend sh -c '
  node src/scripts/attachTeamLogos.js \
    --manifest /tmp/team-logos/manifest.csv \
    --uri "$MONGO_URL" --allow-host mongodb --allow-database cric-all --clear --apply
'
```

Expected: `Logos cleared: 7`. Re-running it reports **nothing to clear** for
every team.

### 7.2 Equivalent mongosh command

If you prefer not to run the script, the same unset by name:

```bash
docker exec cricall-mongo mongosh cric-all --quiet --eval '
  const names = [
    "Young Star","Baldia Zalmi","Orangi Warriors","Family Stallions",
    "Orangi United","Sky Sports","Khan Associates"
  ];
  print("about to unset logo on:", db.teams.countDocuments({ name: { $in: names }, logo: { $ne: "" } }), "team(s)");
  // Stop here and confirm the number is 7, then uncomment the write:
  // const r = db.teams.updateMany({ name: { $in: names } }, { $unset: { logo: "" } });
  // print("teams updated:", r.modifiedCount);
'
```

### 7.3 Delete the now-orphaned files (optional)

Unsetting `logo` leaves the physical files in the volume. Remove the ones no
document references any more:

```bash
cd ~/cric-all/Backend
npm run db:cleanup-uploads            # dry run: list, delete nothing
npm run db:cleanup-uploads:apply      # delete only unreferenced uploads
```

The sweeper is conservative: it only removes files this server wrote (the
`<epoch>-<hex>-<base>.<ext>` scheme) that no model field references.

### 7.4 After a rollback

Re-run §6's verify query: `teams w/ logo` should be back to the pre-run count
(0 for these seven teams) and Ittehad Sports still `""`. If you cannot get
there, restore the §3 backup:

```bash
docker cp ~/cric-all/Backend/backups/<archive> cricall-mongo:/tmp/restore.archive.gz
docker exec cricall-mongo mongorestore --archive=/tmp/restore.archive.gz --gzip --drop
```

---

## 8. Local (non-Docker) usage

For a throwaway local database the guard allows loopback and the database name
must be allowed explicitly, and `PUBLIC_BACKEND_URL` must still be set:

```bash
cd Backend
PUBLIC_BACKEND_URL=http://localhost:5000 \
  node src/scripts/attachTeamLogos.js \
    --manifest /path/to/team-logos/manifest.csv --dir /path/to/team-logos \
    --uri mongodb://127.0.0.1:27017/cric-all --allow-database cric-all            # dry run
PUBLIC_BACKEND_URL=http://localhost:5000 \
  node src/scripts/attachTeamLogos.js \
    --manifest /path/to/team-logos/manifest.csv --dir /path/to/team-logos \
    --uri mongodb://127.0.0.1:27017/cric-all --allow-database cric-all --apply
```

`MIGRATION_MONGO_URL` is accepted as a fallback for `--uri`, but the explicit
flag is preferred.

---

## 9. Automated tests

`Backend/test/attachTeamLogos.test.js` is a pure unit test of the script's
matching and validation logic: no database, no server, and **no real images**
(tiny fake files are generated in the OS temp directory). It pins: the manifest
parser; exact-normalized name matching (trim / whitespace-collapse /
case-fold) and nothing else matching; unknown names refused and never created;
ambiguous names refused; reserved test-prefix teams skipped; already-has-logo
skipped unless `--force`; duplicate rows skipped; missing / non-png / >5 MB /
escaping paths refused per row; `--clear` scoped to manifest teams; and the
`PUBLIC_BACKEND_URL` requirement.

```bash
cd Backend
node --test --test-concurrency=1 test/attachTeamLogos.test.js
```
