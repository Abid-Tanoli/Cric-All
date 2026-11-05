# VPS deploy sync runbook (ports + Mongo config)

This runbook migrates a production VPS that currently carries **local edits** to
these files:

- `docker-compose.yml`: host ports `5050:5000`, `3300:3000`, `3301:3001`, a
  loopback-only Mongo port, and hardcoded `MONGO_INITDB_ROOT_*` values.
- `Backend/src/scripts/backupDb.js`: `docker exec ... mongodump --uri <full URL>`
  instead of `--db <name>`.

After this migration those edits live in the repository, so the next
`git pull` is a clean fast-forward instead of a conflict.

> **Secret handling:** never paste a real password into a command line, this
> document, a commit, a chat, or a ticket. Type passwords only into an editor or
> a hidden prompt. The placeholders here are not real values.

## 0. Assumptions

- The repository is at `/opt/cricall`; adjust every path to the real checkout.
- Docker Compose is v2 (`docker compose`, not `docker-compose`).
- The live database is the local `cricall-mongo` container using the
  `local-mongo` profile. An Atlas-only host can skip the Mongo-specific steps
  but should still verify the port defaults.
- The root `.env` (next to `docker-compose.yml`) owns Compose interpolation
  variables. `Backend/.env` owns the backend's `MONGO_URL` / `MONGODB_URI`.

## 1. Take a backup before changing anything

Create a private directory and keep both the current deploy files and a fresh
database archive. The copies of `.env` contain secrets, so keep the directory
mode `700` and files `600`.

```bash
cd /opt/cricall
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_HOME="$HOME/cricall-pre-sync-$STAMP"
mkdir -p "$BACKUP_HOME"
chmod 700 "$BACKUP_HOME"

cp docker-compose.yml "$BACKUP_HOME/docker-compose.yml"
cp Backend/src/scripts/backupDb.js "$BACKUP_HOME/backupDb.js"
cp .env "$BACKUP_HOME/root.env"
cp Backend/.env "$BACKUP_HOME/backend.env"
chmod 600 "$BACKUP_HOME/root.env" "$BACKUP_HOME/backend.env"
git status --short > "$BACKUP_HOME/git-status.txt"
```

Run a database backup with the current (pre-sync) script. It reads the Mongo URL
from `Backend/.env`, so no password is typed into the shell:

```bash
cd /opt/cricall/Backend
npm run db:backup
ls -lh backups/backup-*.archive.gz | tail -n 3
```

Do not continue unless the newest archive exists and has a plausible size.

## 2. Add the new root `.env` variables **before** touching git

Edit `/opt/cricall/.env` with the server's editor (for example `nano .env`);
do not use a shell command that embeds the secret. Add:

```dotenv
# Host ports for this VPS (portfolio project uses 3000/3001/5000).
BACKEND_HOST_PORT=5050
USER_FRONTEND_HOST_PORT=3300
ADMIN_FRONTEND_HOST_PORT=3301

# Root credentials for the optional local Mongo container.
# Copy the values that already exist in the VPS's local docker-compose.yml.
MONGO_ROOT_USERNAME=<existing local mongo root username>
MONGO_ROOT_PASSWORD=<existing local mongo root password>
```

- Set the Mongo values to the **existing** database user's credentials. A
  password change is a separate procedure; see
  [`docs/mongo-password-rotation.md`](mongo-password-rotation.md).
- Confirm `Backend/.env` still points at the same user/password in its
  `MONGO_URL` (or `MONGODB_URI`). URL-encode special characters in the password.
- Lock the file down: `chmod 600 .env`.

> **`MONGO_INITDB_*` only runs on first initialization.** The
> `MONGO_INITDB_ROOT_USERNAME` / `MONGO_INITDB_ROOT_PASSWORD` values seed the
> root user only when the `mongo_data` volume is empty. Editing them later does
> **not** change the password of an existing database user, and a mismatch
> between those values and `Backend/.env` causes authentication failures. That
> is why this step reuses the current credentials; rotation is documented
> separately.

## 3. Put the old local edits aside

Stash only the two files the pull replaces. Do not blindly discard unrelated
local changes.

```bash
cd /opt/cricall
git stash push -m "pre-sync-vps-local-deploy-edits" -- \
  docker-compose.yml Backend/src/scripts/backupDb.js
git status --short
```

If you do not need to keep the old edits, `git checkout -- docker-compose.yml
Backend/src/scripts/backupDb.js` is equivalent. `git status --short` should show
no changes in those two files before you continue. If other files are modified,
stop and decide about them explicitly.

## 4. Fast-forward only

```bash
cd /opt/cricall
git pull --ff-only origin master
```

Never force-push and never merge a divergent `master` on the VPS. If the pull
is not a fast-forward, stop and investigate; do not resolve it by discarding
server state.

## 5. Verify the resolved Compose model

Render the model to a private temporary file so credentials are not echoed:

```bash
cd /opt/cricall
docker compose --profile local-mongo config > /tmp/cricall-compose.resolved.yml
chmod 600 /tmp/cricall-compose.resolved.yml
```

Check the published ports (these are not secret):

```bash
grep -nE 'published: "?(5050|3300|3301|27017)"?' /tmp/cricall-compose.resolved.yml
grep -nE 'host_ip: 127\.0\.0\.1' /tmp/cricall-compose.resolved.yml
```

Check that the Mongo credentials resolved **without printing their values**:

```bash
grep -qE 'MONGO_INITDB_ROOT_USERNAME: "?[^"[:space:]]+' /tmp/cricall-compose.resolved.yml \
  && echo "MONGO_INITDB_ROOT_USERNAME: set" \
  || echo "MONGO_INITDB_ROOT_USERNAME: MISSING"

grep -qE 'MONGO_INITDB_ROOT_PASSWORD: "?[^"[:space:]]+' /tmp/cricall-compose.resolved.yml \
  && echo "MONGO_INITDB_ROOT_PASSWORD: set" \
  || echo "MONGO_INITDB_ROOT_PASSWORD: MISSING"
```

Both must say `set` when using `--profile local-mongo`. Then remove the file:

```bash
rm -f /tmp/cricall-compose.resolved.yml
```

**Why not `${MONGO_ROOT_USERNAME:?message}`?** Compose interpolates the entire
file before profiles are applied. A required variable in the `local-mongo`
service therefore fails `docker compose config` / `up` even for an Atlas-only
deployment that never activates that profile. The repo intentionally uses
`${MONGO_ROOT_USERNAME:-}` / `${MONGO_ROOT_PASSWORD:-}` so Atlas users are not
forced to define them. The cost is that a local-mongo user must set them
explicitly; the checks above catch a missing value.

For an Atlas-only host, also confirm the default path still renders:

```bash
docker compose config >/dev/null && echo "compose config OK without local-mongo"
```

## 6. Rebuild and start

```bash
cd /opt/cricall
docker compose --profile local-mongo up -d --build
docker compose --profile local-mongo ps
```

Wait for the backend to become healthy/ready before continuing.

## 7. Verify the live deployment

### Ports

```bash
ss -ltnp | grep -E ':(5050|3300|3301|27017)\b'
curl -fsS http://127.0.0.1:5050/api/health
curl -fsSI http://127.0.0.1:3300/ | head -n 1
curl -fsSI http://127.0.0.1:3301/ | head -n 1
```

Expected: backend on `5050`, user frontend on `3300`, admin frontend on `3301`,
Mongo only on loopback `127.0.0.1:27017` (`ss` should not show `0.0.0.0:27017`
or `[::]:27017`).

### Backend logs

```bash
docker compose --profile local-mongo logs --tail=100 backend
```

Look for a successful Mongo connection and absence of auth errors. Do not paste
log lines containing credentials into tickets.

### Backup

```bash
cd /opt/cricall/Backend
npm run db:backup
ls -lh backups/backup-*.archive.gz | tail -n 3
```

The script should report `docker exec ... mongodump`, write a non-zero archive,
and never print the Mongo URL. Retention is now a **day window**
(`BACKUP_KEEP_DAYS`, default 14 days), not a file count.

### Restore drill into a throwaway database

Never restore over the live database for a drill. Pick the newest archive and
rename its namespaces to a throwaway database. Adjust the source database name
(`cric-all` below) if the backup uses a different one.

```bash
cd /opt/cricall/Backend
ARCHIVE="$(ls -1t backups/backup-*.archive.gz | head -n 1)"
echo "Using archive: $ARCHIVE"

# Username is not secret; password is typed at a hidden prompt and passed to
# the container through the environment, never as an argument on the host
# command line (where `ps` could expose it).
export MONGO_ROOT_USERNAME="$(grep '^MONGO_ROOT_USERNAME=' ../.env | cut -d= -f2-)"
read -rsp 'Local Mongo root password: ' MONGO_ROOT_PASSWORD
echo
export MONGO_ROOT_PASSWORD

docker exec -i \
  -e MONGO_ROOT_USERNAME -e MONGO_ROOT_PASSWORD \
  cricall-mongo sh -c '
    mongorestore \
      --username "$MONGO_ROOT_USERNAME" \
      --password "$MONGO_ROOT_PASSWORD" \
      --authenticationDatabase admin \
      --gzip --archive \
      --nsFrom "cric-all.*" \
      --nsTo "cric-all-restore-drill.*"
  ' < "$ARCHIVE"
```

Verify the drill database is readable, then drop it:

```bash
docker exec -it \
  -e MONGO_ROOT_USERNAME -e MONGO_ROOT_PASSWORD \
  cricall-mongo sh -c '
    mongosh \
      --username "$MONGO_ROOT_USERNAME" \
      --password "$MONGO_ROOT_PASSWORD" \
      --authenticationDatabase admin \
      --eval "const d=db.getSiblingDB(\"cric-all-restore-drill\"); printjson({collections:d.getCollectionNames().length, matches:d.matches.countDocuments({})})"
  '

docker exec -it \
  -e MONGO_ROOT_USERNAME -e MONGO_ROOT_PASSWORD \
  cricall-mongo sh -c '
    mongosh \
      --username "$MONGO_ROOT_USERNAME" \
      --password "$MONGO_ROOT_PASSWORD" \
      --authenticationDatabase admin \
      --eval "db.getSiblingDB(\"cric-all-restore-drill\").dropDatabase()"
  '

unset MONGO_ROOT_PASSWORD MONGO_ROOT_USERNAME
```

If the restore fails, keep the archive and the pre-sync backup directory; do not
attempt to "fix" the live database in place.

## 8. Rollback (only if the new deployment is unhealthy)

1. Stop the stack: `docker compose --profile local-mongo down`
2. Restore the saved `docker-compose.yml`, `backupDb.js`, and env files from
   `$BACKUP_HOME` (keep mode `600` on env files).
3. Check out the previous commit and start again **only** after recording the
   failure. Do not force-push `master`.

The Git history itself is not rolled back; the saved files are an operational
fallback, not a replacement for a revert commit.
