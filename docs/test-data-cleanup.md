# Test-data cleanup runbook

Removes leftover agent/QA fixtures from production. The rules are exact
case-insensitive prefix matches only, and **nothing is deleted without
`--apply`**:

* Users whose `name`, `email` or `username` starts with `OPENCODE_TEST`
  (emails are stored lower-cased, so they match as `opencode_test_...`).
* Teams, organizations, players, tournaments, matches, events, sponsors,
  community posts and issue reports whose name/title/subject starts with
  `TEST_` or `OPENCODE_TEST`.

Anything with a match in the middle of the name, a different prefix, or a
real-looking name is never touched. A matched record that a non-test record
still references (a real player on a test team, a real member in a test
organization, a real issue report against a test match, …) is skipped and
listed, never deleted.

## 1. Preview (writes nothing)

Run every `docker compose` command from the repository folder on the server
(the one that holds `docker-compose.yml`, for example `/opt/cricall`). From any
other folder Compose answers `no configuration file provided: not found`.

```bash
docker compose exec backend npm run cleanup:testdata
```

The report lists, per collection, the ids, names, creation dates and the rule
that matched, plus the related child rows (balls, deliveries, commentary,
partnerships, analytics, rankings, memberships, invites, tournament media and
articles) that would be removed with them.

## 2. Take a fresh backup

The apply step refuses to run without a `backup-*.archive.gz` younger than 30
minutes in `BACKUP_DIR` (default `Backend/backups`, which is `/app/backups`
inside the backend container).

Take the backup on the host, not inside the container: `db:backup` needs
`docker` or `mongodump`, and the backend image has neither. It reads the Mongo
URL from `Backend/.env`, so no password is typed.

```bash
cd Backend
npm run db:backup
ls -lh backups/backup-*.archive.gz | tail -n 3
cd ..
```

Do not continue unless the newest archive exists and has a plausible size.

The host's `Backend/backups` is not mounted into the container, so copy the
newest archive in before applying (within the 30 minutes):

```bash
docker compose exec backend mkdir -p /app/backups
docker compose cp "$(ls -1t Backend/backups/backup-*.archive.gz | head -n 1)" backend:/app/backups/
docker compose exec backend ls -lt /app/backups
```

If `Backend/.env` sets `BACKUP_DIR`, the container checks that path instead;
copy the archive there.

## 3. Apply with the dry-run total

Use the `Total records to delete: N` value from step 1. Re-run step 1 if the
data changed in between.

```bash
docker compose exec backend npm run cleanup:testdata -- --apply --confirm=N
```

Every collection removed writes one audit entry (`action: testdata.cleanup`)
with the ids and the confirmed total. The command exits non-zero if any
collection fails, and stops at the first failure.

## 4. Verify

Run the preview again; it should report `Total records to delete: 0`.

## Rollback

Restore the archive taken in step 2 (rollback is the backup, not an undo
command):

```bash
docker compose exec -T mongo mongorestore --uri "$MONGO_URL" --gzip --archive < Backend/backups/backup-<timestamp>.archive.gz
```

Or, on the host with the Mongo tools installed:

```bash
mongorestore --uri="$MONGO_URL" --gzip --archive=Backend/backups/backup-<timestamp>.archive.gz
```

Note that deletes also remove uploaded files (player images, team logos/media,
tournament hub photos). Those files are not in the Mongo archive; they must be
restored from the uploads backup if needed. Records referenced by real data were
skipped, so a restore should not be necessary for those.
