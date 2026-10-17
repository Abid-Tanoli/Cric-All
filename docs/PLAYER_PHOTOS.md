# Player photos — squads-2026-10

`Backend/src/scripts/attachPlayerPhotos.js` attaches a profile photo to each
player created by `Backend/src/scripts/importSquads.js` for the
`squads-2026-10` round, from an operator-supplied manifest of
`(team, player_name, file)` rows. This document is the operator runbook: back
up, dry-run, apply, verify, and — if it has to be undone — roll back.

The script is **dry-run by default**. It writes nothing unless `--apply` is
passed.

---

## 1. What it does, and what it deliberately does not

| Object | Count | Details |
| --- | --- | --- |
| `Player.imageUrl` | up to 120 | absolute URL into the backend's `/uploads` store |
| Uploaded files | up to 120 | written by `photoStore.storeImage` into the `uploads_data` volume |

It reuses the **exact** code path the Admin upload uses:

- `utils/photoStore.js#storeImage` — the local `uploads` directory, the
  `<epoch>-<hex>-<base>.<ext>` filename scheme, the 5 MB / JPEG-PNG-WebP rules;
- the same absolute URL the `POST /api/upload/image` endpoint returns once
  `PUBLIC_BACKEND_URL` is set.

So the public player/team pages (which render `player.imageUrl` through
`SafeImage`) and the Admin app (which renders it in a raw `<img>`) both work
with no frontend change.

It does **not**:

- create, rename or delete a `Player` — an unknown or ambiguous row is
  reported and skipped, never guessed;
- touch a player outside the squads-2026-10 batch (the eight club
  organizations named in §7.2, reached through `Team.organizationRef`);
- invent data — a row that does not resolve to exactly one player is listed
  under **unmatched** / **ambiguous** and left alone;
- delete a file. `--force` re-uploads over an existing photo but the previous
  file is left on disk (sweep it with `npm run db:cleanup-uploads:apply`,
  which only removes files no document references).

### The manifest

A CSV (UTF-8, optional BOM) with the columns `team`, `player_name`, `file`:

```csv
team,player_name,file
Young Star,Ghani Afridi (2),young-star-ghani-afridi-2.jpg
...
```

- `team` is matched case-folded / whitespace-collapsed against a batch team
  name;
- `player_name` is matched **exactly** (case-folded, whitespace-collapsed,
  NFKC) against the player's name inside that team, so `Majid Afridi (2)` and
  `Ghani Afridi (2)` map to their own players;
- `file` is a path **relative to `--dir`**; `..`, absolute paths and embedded
  NUL are refused, and only `.jpg` / `.jpeg` / `.png` / `.webp` are accepted.

### Idempotency

A re-run with `--apply` changes nothing: a player that already has a photo is
reported under **already have photo** and skipped. `--force` re-uploads for
those players instead.

---

## 2. Before you start

The script validates the whole manifest **before** it opens a database
connection, so a bad manifest fails with nothing written. It still will not run
against a target it has not been told about:

- loopback hosts (`127.0.0.1`, `localhost`, `::1`) are allowed by default; any
  other host needs `--allow-host <name>`;
- the database must be `cric-all-e2e` by default; anything else needs
  `--allow-database <name>`.

Compose deployments reach Mongo as the internal hostname `mongodb`, so both
flags are required there (see §5).

The script **does not read `.env`**. The URI is always passed explicitly, and
it is never printed.

`PUBLIC_BACKEND_URL` **must be set** in the process environment to the
backend's public origin (the same value the Admin upload returns), because the
stored `imageUrl` has to be absolute. The script fails fast if it is unset — it
never guesses a host. In a container, pass it with `docker exec -e` (see §5).

---

## 3. Back up first

Never apply a bulk write without a fresh backup. On the VPS, either fire the
scheduled backup service once:

```bash
sudo systemctl start cricall-backup.service
systemctl status cricall-backup        # confirm it ran
ls -lt /opt/cricall/Backend/backups/ | head
```

or run the script directly:

```bash
cd /opt/cricall/Backend
npm run db:backup
```

A one-off archive straight from the Mongo container also works:

```bash
docker exec cricall-mongo mongodump --db cric-all \
  --archive=/tmp/cric-all-before-photos-$(date +%F).archive.gz --gzip
docker cp cricall-mongo:/tmp/cric-all-before-photos-$(date +%F).archive.gz ./backups/
```

Restore (only if you actually need it):

```bash
docker cp ./backups/<archive> cricall-mongo:/tmp/restore.archive.gz
docker exec cricall-mongo mongorestore --archive=/tmp/restore.archive.gz --gzip --drop
```

---

## 4. Copy the script and the photos into the backend container

The photos live outside the repo and are never committed (they are real
people's faces — a gitignore change does not apply, so keep them off the
checkout entirely). The script is a new **standalone** file that only imports
modules already present in the running image, so it too is delivered with
`docker cp` — **no rebuild** and no change to any existing image file.

From the operator machine, copy the photos and manifest to the VPS:

```bash
scp -r /path/to/player-photos user@vps:~/player-photos
```

Then, on the VPS, copy the photos **and** the script into the container:

```bash
# photos + manifest
docker cp ~/player-photos cricall-backend:/tmp/player-photos

# the script (standalone; only uses modules already in the image)
docker cp /opt/cricall/Backend/src/scripts/attachPlayerPhotos.js \
  cricall-backend:/app/src/scripts/attachPlayerPhotos.js
```

The `Backend/Dockerfile` copies the app with `WORKDIR /app`, so the script is
`/app/src/scripts/attachPlayerPhotos.js` and is run as `node src/scripts/...`
from inside the container.

---

## 5. Dry run, then apply (Compose)

`--uri` uses the container's own `$MONGO_URL` (loaded from `Backend/.env`), so
run the whole command inside a container shell (single quotes) — that way the
container expands the variable, not your host shell. Pass
`PUBLIC_BACKEND_URL` from the host with `-e` so the stored URL is absolute.

**Dry run (no writes):**

```bash
docker exec -e PUBLIC_BACKEND_URL=https://cricall.example.com cricall-backend sh -c '
  node src/scripts/attachPlayerPhotos.js \
    --manifest /tmp/player-photos/manifest.csv \
    --dir /tmp/player-photos \
    --uri "$MONGO_URL" --allow-host mongodb --allow-database cric-all
'
```

Read the report. For the real manifest you should see `Manifest rows: 120`,
`Matched: 120`, `will attach: 120`, and `Batch clubs found: 8/8`. Anything
under **Unmatched**, **Ambiguous** or **Duplicate rows** must be investigated
before applying — those rows are never written.

```
=== player photos attach (squads-2026-10) =====================
  Photo batch   : squads-2026-10
  Mode          : DRY RUN (no writes)
  ...
  Manifest rows : 120
  Matched       : 120
    will attach        : 120
    already have photo : 0
    missing file       : 0
  Unmatched     : 0
  Ambiguous     : 0
  Duplicate rows: 0
  Batch clubs found : 8/8
  Batch teams found : 8
...
Dry run complete. Nothing was written. Re-run with --apply to write.
```

**Apply:**

```bash
docker exec -e PUBLIC_BACKEND_URL=https://cricall.example.com cricall-backend sh -c '
  node src/scripts/attachPlayerPhotos.js \
    --manifest /tmp/player-photos/manifest.csv \
    --dir /tmp/player-photos \
    --uri "$MONGO_URL" --allow-host mongodb --allow-database cric-all --apply
'
```

Save the **entire apply output**. It reports the number of photos attached and
a sample of the stored URLs:

```
APPLIED.
  Photos attached : 120
  Errors          : 0
  Stored in       : /app/uploads
```

Re-running the apply a second time must report every row under **already have
photo** and attach 0 — that is the idempotency check.

`--force` re-uploads for players that already have a photo. It never deletes
the previous file, so sweep the orphans afterwards with
`npm run db:cleanup-uploads:apply` (dry-run first without `:apply`).

---

## 6. Verify

Count the batch players that now carry an absolute `/uploads/` URL:

```bash
docker exec cricall-mongo mongosh cric-all --quiet --eval '
  const names = [
    "Ittehad Sports","Baldia Zalmi","Sky Sports","Orangi United",
    "Young Star","Khan Associates","Family Stallions","Orangi Warriors"
  ];
  const clubs = db.teamorganizations.find({ name: { $in: names } }).toArray();
  const clubIds = clubs.map(c => c._id);
  const teams = db.teams.find({ organizationRef: { $in: clubIds } }).toArray();
  const teamIds = teams.map(t => t._id);
  print("players            :", db.players.countDocuments({ team: { $in: teamIds } }));
  print("players w/ photo   :", db.players.countDocuments({ team: { $in: teamIds }, imageUrl: { $regex: "/uploads/" } }));
  print("players w/o photo  :", db.players.countDocuments({ team: { $in: teamIds }, $or: [ { imageUrl: { $exists: false } }, { imageUrl: "" } ] }));
  db.players.find({ team: { $in: teamIds }, imageUrl: { $regex: "/uploads/" } }, { name: 1, imageUrl: 1 }).limit(3).forEach(p => print("  eg", p.name, "->", p.imageUrl));
'
```

Expected after a clean apply: `players 120`, `players w/ photo 120`,
`players w/o photo 0`, and the sample URLs begin with your
`PUBLIC_BACKEND_URL` (e.g. `https://cricall.example.com/uploads/...`).

The files themselves live in the **`uploads_data` named volume**, mounted at
`/app/uploads` by `docker-compose.yml` — so they survive a rebuild or a
container recreate. Confirm one is served:

```bash
curl -sI https://cricall.example.com/uploads/<filename> | head -1   # HTTP/2 200
```

---

## 7. Rollback

Rollback here means **detaching the photos**, not deleting players. Nothing the
script did is destructive, so undo is a single field-unset scoped to the batch.

### 7.1 Unset `imageUrl` for the batch

```bash
docker exec cricall-mongo mongosh cric-all --quiet --eval '
  const names = [
    "Ittehad Sports","Baldia Zalmi","Sky Sports","Orangi United",
    "Young Star","Khan Associates","Family Stallions","Orangi Warriors"
  ];
  const clubs = db.teamorganizations.find({ name: { $in: names } }).toArray();
  const clubIds = clubs.map(c => c._id);
  const teams = db.teams.find({ organizationRef: { $in: clubIds } }).toArray();
  const teamIds = teams.map(t => t._id);

  print("about to unset imageUrl on:", db.players.countDocuments({ team: { $in: teamIds }, imageUrl: { $ne: "" } }), "player(s)");
  // Stop here and confirm the number before uncommenting the write.
  // const r = db.players.updateMany({ team: { $in: teamIds } }, { $unset: { imageUrl: "" } });
  // print("players updated:", r.modifiedCount);
'
```

Confirm the count (should be 120 for a full apply), then uncomment the write.

> **If the batch clubs were created by importSquads.js and you intend to
> delete them**, do that with `docs/SQUADS_IMPORT.md` §7 instead — a full
> rollback of the import removes the players too, and their photos become
> orphans for the sweep below.

### 7.2 Delete the now-orphaned files (optional)

Unsetting `imageUrl` leaves the physical files in the volume. Remove the ones
no document references any more:

```bash
cd /opt/cricall/Backend
npm run db:cleanup-uploads            # dry run: list, delete nothing
npm run db:cleanup-uploads:apply      # delete only unreferenced uploads
```

The sweeper is conservative: it only removes files this server wrote (the
`<epoch>-<hex>-<base>.<ext>` scheme) that no model field references.

### 7.3 After a rollback

Re-run §6's verify query: `players w/ photo` should be back to the pre-run
count. If you cannot get there, restore the §3 backup.

---

## 8. Local (non-Docker) usage

For a throwaway local database the guard allows loopback and the database name
must be allowed explicitly, and `PUBLIC_BACKEND_URL` must still be set:

```bash
cd Backend
PUBLIC_BACKEND_URL=http://localhost:5000 \
  node src/scripts/attachPlayerPhotos.js \
    --manifest /path/to/manifest.csv --dir /path/to/player-photos \
    --uri mongodb://127.0.0.1:27017/cric-all --allow-database cric-all            # dry run
PUBLIC_BACKEND_URL=http://localhost:5000 \
  node src/scripts/attachPlayerPhotos.js \
    --manifest /path/to/manifest.csv --dir /path/to/player-photos \
    --uri mongodb://127.0.0.1:27017/cric-all --allow-database cric-all --apply
```

`MIGRATION_MONGO_URL` is accepted as a fallback for `--uri`, but the explicit
flag is preferred.

---

## 9. Automated tests

`Backend/test/attachPlayerPhotos.test.js` runs the script as a child process
against a throwaway `mongodb-memory-server` database, using a generated fixture
manifest and **tiny fake images** (never the real photos) in the OS temp
directory, with `UPLOADS_DIR` pointed at a temp folder so a run never writes
into the repo tree. It pins: dry-run writes nothing; apply sets an absolute
`imageUrl` and stores the file; a second apply skips; `--force` re-uploads;
distinct `"(2)"` names map to their own players; unmatched / missing /
duplicate / ambiguous rows are reported and never written; and both target
guards (plus the missing `--manifest` / `--dir` refusals).

```bash
cd Backend
node --test --test-concurrency=1 test/attachPlayerPhotos.test.js
```
