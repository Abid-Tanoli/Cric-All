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

Optional but recommended: an encrypted copy on another provider, plus the weekly
`uploads_data` archive and the restore procedure — section 10.

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

## 8. Email delivery (SMTP, optional)

Mail defaults to `MAIL_DRIVER=console`: messages are written to the backend log
only. Compose passes the following backend runtime values from the **root**
`.env` (they are not `VITE_*` build values):

```dotenv
MAIL_DRIVER=smtp
MAIL_HOST=smtp-relay.brevo.com
MAIL_PORT=587
MAIL_SECURE=false
MAIL_USER=<smtp login>
MAIL_PASS=<smtp key or app password>
MAIL_FROM=CricAll <no-reply@your-domain.example>
MAIL_REPLY_TO=
MAIL_ISSUE_NOTIFY_MAX_PER_HOUR=10
```

- Brevo: host `smtp-relay.brevo.com`, port 587, `MAIL_SECURE=false`,
  `MAIL_USER` = Brevo login email, `MAIL_PASS` = SMTP key.
- Gmail: host `smtp.gmail.com`, port 587, `MAIL_SECURE=false`,
  `MAIL_USER` = Gmail address, `MAIL_PASS` = 16-character App Password
  (enable 2FA first; never the account password).
- `MAIL_SECURE=true` is for implicit TLS (usually port 465); leave it `false`
  with port 587 (STARTTLS).
- If any of `MAIL_HOST`, `MAIL_USER`, `MAIL_PASS`, `MAIL_FROM` is missing, the
  backend logs a warning naming only the missing variables and keeps using the
  console driver. It never crashes on mail configuration.
- For a custom From domain, publish **SPF** and **DKIM** DNS records for that
  domain; without them, providers may reject or flag the mail.
- `ADMIN_NOTIFICATION_EMAIL` (issue-report notices) still lives in
  `Backend/.env`. Those notices are throttled per recipient per rolling hour.

Verify delivery with the test command (it refuses to run unless
`MAIL_DRIVER=smtp` and all required values are set):

```bash
docker compose --profile local-mongo exec backend npm run mail:test -- someone@example.com
```

Expected output is `OK`; an error line is printed on failure. Keep real SMTP
credentials out of shell history, tickets and git. To roll back mail only, set
`MAIL_DRIVER=console` in the root `.env` and recreate the backend container;
no code change or redeploy is needed.

### 8.1 Email verification on signup (6-digit code)

Signup now issues a **6-digit numeric code**, not a link. The raw code is never
stored: only a SHA-256 hash, a 10-minute expiry (`EMAIL_CODE_MINUTES`), a wrong
attempt counter (5 misses invalidate the code) and a 60-second resend cooldown.
Per-user and per-IP rolling-hour send caps (`EMAIL_VERIFICATION_MAX_PER_HOUR`,
default 10) use the backend's shared in-memory rate limiter. Signup rejects
disposable domains and domains with a definitive no-MX answer; DNS errors or
timeouts (`EMAIL_MX_TIMEOUT_MS`) **fail open** so signup is never blocked.

New accounts start with `emailVerified: false`. They can log in and browse, but
creating an organization, team, player profile, tournament or community post
requires a verified email (message: `Verify your email to continue.`). Phone/SMS
verification is **deferred**: no SMS is sent, the phone endpoints return 400,
and phone is always shown as "not verified". Phone-only accounts must add an
email through "Change email" on the code screen before they can create content.

Testing locally without an SMTP account:

```dotenv
# root .env (or Backend/.env for a non-Docker run)
MAIL_DRIVER=console
```

Then recreate the backend and watch its log — the console mail driver is the
**only** place a verification code or mail body is ever printed:

```bash
docker compose up -d --build backend user-frontend admin-frontend
docker compose logs -f backend
```

Enter the printed 6-digit code at `/verify-email`. "Resend code" is available
after 60 seconds, and "Change email" invalidates the old address and sends a
fresh code to the new one.

For existing accounts, grandfathering is an explicit two-step operation. The
default is a read-only dry-run; it never writes by accident:

```bash
docker compose exec backend npm run db:migrate-user-verification
# review the plan, then opt in to writes:
docker compose exec backend npm run db:migrate-user-verification:apply
```

By default `--apply` grandfathers accounts verified under the *old* rule
(including legacy phone-verified accounts) so nobody silently loses access.
Use `--apply --require-verification` only if the owner deliberately wants every
unverified account to stay unverified. Duplicate emails are reported, never
merged or deleted. Admin support can mark an address verified for genuine
delivery failures at `/admin/users/verification`; every override, including a
no-op, is recorded in the audit log as `admin.user_email_verified`.

## 9. Rollback (only if the new deployment is unhealthy)

1. Stop the stack: `docker compose --profile local-mongo down`
2. Restore the saved `docker-compose.yml`, `backupDb.js`, and env files from
   `$BACKUP_HOME` (keep mode `600` on env files).
3. Check out the previous commit and start again **only** after recording the
   failure. Do not force-push `master`.

The Git history itself is not rolled back; the saved files are an operational
fallback, not a replacement for a revert commit.
## 10. Off-site encrypted backups (optional — OFF by default)

Everything in this section is opt-in. Until you set
`OFFSITE_BACKUP_ENABLED=true` in `Backend/.env`, the nightly job behaves exactly
as it does today and nothing leaves the VPS.

**Why you want it:** the nightly `mongodump` archives and the uploaded images
live on the same VPS. If the disk or the provider dies, you lose the database
*and* its backups. This step keeps an encrypted copy somewhere else.

**What gets uploaded**

| Job | Timer | Local file | Uploaded object |
| --- | --- | --- | --- |
| Database | `cricall-backup.timer`, daily 02:15 | `Backend/backups/backup-<db>-<stamp>.archive.gz` | same name + `.enc` |
| Uploads volume | `cricall-backup-uploads.timer`, Sunday 03:15 | `Backend/backups/uploads-<stamp>.tar.gz` | same name + `.enc` |

`uploads_data` (team logos, player photos) is **not** inside `mongodump`; the
database only stores file names. That is why it gets its own weekly archive.

**How it is encrypted:** the script encrypts the file locally with AES-256-GCM
(authenticated: a corrupted upload fails to decrypt instead of restoring
damaged data) using a passphrase it reads from a file on the server, then
uploads the encrypted file with `rclone`. The passphrase never appears in `.env`
values, on a command line, in a log line or in git.

**Why rclone and not `rclone crypt`/age/gpg:** one tool covers every free-tier
remote (Google Drive, Backblaze B2, any SFTP box) with one config; the
passphrase stays in a file you control instead of an obscured value inside
`rclone.conf`; and there is no extra package to install besides rclone.

Exit codes you will see: `0` = everything worked, `1` = the local backup itself
failed, `3` = **local backup OK, off-site copy failed** (the local archive is
kept; check the journal).

---

### 10.1 Install rclone on the VPS

```bash
curl https://rclone.org/install.sh | bash -s -- --bindir /usr/local/bin
rclone version          # should print a version line
```

(On Debian/Ubuntu `apt install rclone` also works, but the version may be older;
either is fine. Commands in this section that write to system paths need `root`,
so prefix them with `su -` or your usual admin method.)

### 10.2 Create the remote (the account setup — yours to do)

Pick one provider. All three are free-tier friendly.

**Backblaze B2 (simplest, no browser on the server needed)**

1. In the Backblaze web console create a bucket, e.g. `cricall-offsite`, and
   keep it **private**.
2. Create an Application Key with access to that bucket only. Copy the
   `keyID` and `applicationKey` — the application key is shown once.
3. On the VPS run `rclone config` and answer: `n` (new remote) → name
   `cricall-offsite` → storage `b2` → `account` = keyID → `key` =
   applicationKey → leave the rest blank → `y` (keep this remote) → `q` (quit).

**Google Drive (needs a browser on your laptop)**

1. `rclone config` on the VPS → `n` → name `cricall-offsite` → storage `drive`
   → leave `client_id`/`client_secret` blank (rclone's shared client works) →
   scope `2` (read/write) → `n` to "Use auto config?" (there is no browser on
   the server).
2. It prints a command to run **on your laptop**: run it there, sign in, allow
   access, then paste the resulting token back into the VPS prompt.
3. Keep the remote, quit the config.
4. In Drive, move the created `cricall-offsite` folder wherever you like; quota
   is 15 GB on a free account, so watch `rclone size` in 10.7 if the uploads
   archive is large.

**Any SFTP/SSH box you own**

`rclone config` → `n` → name `cricall-offsite` → storage `sftp` → host, user,
port 22, key file (recommended) → keep, quit.

### 10.3 Make the destination folder and check it

```bash
rclone mkdir cricall-offsite:cricall-backups
rclone lsf cricall-offsite:cricall-backups     # empty for now, but no error
```

If this prints an error, fix the remote before continuing — nothing else will
work.

### 10.4 Generate and store the passphrase (do this carefully)

```bash
install -d -m 700 /root/.config/cricall
openssl rand -base64 48 | tee /root/.config/cricall/offsite-passphrase >/dev/null
chmod 600 /root/.config/cricall/offsite-passphrase
wc -c /root/.config/cricall/offsite-passphrase    # just the byte count
```

Now copy that passphrase somewhere **off this server**: a password manager entry
named "CricAll offsite backup passphrase", plus a paper copy in a drawer.
Do **not** paste it into a ticket, chat, note-taking app or git. If you lose it,
every encrypted backup is permanently unreadable — that is the point of it.

The file must stay mode `600`; the script warns (and skips) if it is
group/world readable, if it is missing, or if the passphrase is shorter than 12
characters.

### 10.5 Enable the env vars

Edit `Backend/.env` (the file the backup reads) and add:

```dotenv
OFFSITE_BACKUP_ENABLED=true
OFFSITE_REMOTE=cricall-offsite:cricall-backups
OFFSITE_PASSPHRASE_FILE=/root/.config/cricall/offsite-passphrase
OFFSITE_RETENTION_DAYS=30
OFFSITE_UPLOADS_MAX_MB=2048
```

- `OFFSITE_RETENTION_DAYS` deletes remote objects older than that (default 30;
  `0` = never delete remotely). Only `backup-*.enc` / `uploads-*.enc` are
  touched.
- `OFFSITE_UPLOADS_MAX_MB` skips the weekly image upload when the tarball is
  bigger than this (default 2048 MB; `0` = no limit). The skip is logged and is
  not an error.

```bash
chmod 600 /opt/cricall/Backend/.env    # adjust the path
```

This is on the host, not in Compose, so the backend containers do not need a
rebuild or restart.

### 10.6 Test with a manual run

```bash
cd /opt/cricall/Backend
node src/scripts/backupDb.js; echo "exit=$?"
```

Expected lines (paths and sizes differ):

```
Backup written: /opt/cricall/Backend/backups/backup-cric-all-....archive.gz (12.34 MB)
[offsite] uploaded backup-cric-all-....archive.gz.enc to cricall-offsite:cricall-backups
[offsite] remote retention: removed backup-*.enc objects older than 30 day(s)
exit=0
```

`exit=3` means the local backup worked and the upload did not. Read the
`[offsite] ...` line: it names the failing step without showing the passphrase.
Common causes: remote name typo, expired provider token (`rclone config
reconnect`), passphrase file unreadable by the user running the job. Re-run
after fixing; the local backup is untouched either way.

Now check the journal exactly as systemd sees it:

```bash
systemctl daemon-reload              # only needed if you edited units
systemctl status cricall-backup --no-pager
journalctl --no-pager -u cricall-backup -n 40
```

Unit state should be `inactive (dead)` / `status=0/SUCCESS`; with a failed
off-site step it shows `status=3` and the log line says the local backup is
intact.

Weekly images job (optional, same switch):

```bash
cd /opt/cricall/Backend
node src/scripts/backupUploads.js; echo "exit=$?"
cp backup/cricall-backup-uploads.service backup/cricall-backup-uploads.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now cricall-backup-uploads.timer
systemctl list-timers | grep cricall
```

To archive the volume on a box where it is mounted on the host instead of in a
container, set `UPLOADS_SOURCE_DIR=/path/to/uploads`; otherwise the script runs
`docker exec cricall-backend tar czf - -C /app/uploads .` (override the
container/inside path with `UPLOADS_CONTAINER_NAME`, `UPLOADS_CONTAINER_PATH`).

### 10.7 Confirm the file really appears remotely

```bash
rclone lsf cricall-offsite:cricall-backups --include "*.enc"
rclone size cricall-offsite:cricall-backups
rclone lsjson cricall-offsite:cricall-backups | head -c 400
```

You should see `backup-<db>-<stamp>.archive.gz.enc` for the run you just did and
a plausible size (encrypted files are roughly the local archive size plus 40
bytes). Then check it is really encrypted — the header must be `CRICALLBK1`
followed by binary bytes, never the `gzip` magic (`\x1f\x8b`):

```bash
cd /tmp
rclone copyto cricall-offsite:cricall-backups/<object>.enc ./check.enc
head -c 10 ./check.enc; echo
file ./check.enc            # expected: "data", not "gzip compressed data"
rm -f ./check.enc
```

A second, stronger check is to decrypt it (next subsection) — if the passphrase
works and `mongorestore` reads it, the upload is complete and intact.

### 10.8 Restore from off-site

Read these steps before you need them. `MONGO_URL` from `Backend/.env` is used to
reach the database, and the restore runs `mongorestore` inside the
`cricall-mongo` container (override with `MONGO_CONTAINER_NAME`; if you use
Atlas and have no container, run the same `mongorestore` command on the host).

```bash
cd /opt/cricall/Backend

# 1. See what is available remotely
node src/scripts/restoreFromOffsite.js list

# 2. Download + decrypt one object into ./restore-from-offsite/
node src/scripts/restoreFromOffsite.js download backup-cric-all-2026-11-23T02-15-00-000Z.archive.gz.enc
ls -lh restore-from-offsite/

# 3. Restore it into a TEMP database — the live one is untouched
node src/scripts/restoreFromOffsite.js restore-temp \
  --archive restore-from-offsite/backup-cric-all-2026-11-23T02-15-00-000Z.archive.gz \
  --temp-db cric-all-restore-temp

# 4. Verify counts before believing it
node src/scripts/restoreFromOffsite.js verify --db cric-all-restore-temp
#    -> {"database":"cric-all-restore-temp","collections":N,"counts":{...}}
#    Compare a few collections against production with the backend still up:
#    node src/scripts/restoreFromOffsite.js verify --db cric-all

# 5. Only now the real restore. Stop the backend first so nothing writes mid-restore.
cd /opt/cricall && docker compose stop backend && cd Backend
node src/scripts/restoreFromOffsite.js restore \
  --archive restore-from-offsite/backup-cric-all-2026-11-23T02-15-00-000Z.archive.gz \
  --target-db cric-all --confirm

# 6. Bring the app back and verify
cd /opt/cricall && docker compose start backend
cd Backend && node src/scripts/restoreFromOffsite.js verify --db cric-all
```

Without `--confirm` step 5 refuses to run — that is deliberate. For a test
restore, drop the temp database afterwards
(`mongosh ... --eval 'db.getSiblingDB("cric-all-restore-temp").dropDatabase()'`,
see section 7's drill for the credential prompt pattern) and delete
`restore-from-offsite/` so the decrypted archive does not sit on disk.

### 10.9 Quarterly restore test (checklist)

Do this once a quarter, on a calm day, and tick the boxes:

- [ ] `rclone lsf cricall-offsite:cricall-backups --include "*.enc"` lists about
      30 nightly objects plus 4 weekly `uploads-*.enc` ones.
- [ ] Newest `backup-*.enc` is from the last 26 hours, and the newest
      `uploads-*.enc` from the last 8 days.
- [ ] `rclone size` total is plausible (not 0, not gigabytes more than the
      local `du -sh Backend/backups`).
- [ ] Downloaded and decrypted the newest object (10.8 steps 1–2) without
      errors.
- [ ] Temp restore into `cric-all-restore-temp` succeeded (step 3).
- [ ] `verify` counts for the temp database are within a few percent of
      production for `users`, `matches`, `teams` (step 4). Investigate anything
      wildly off before ticking.
- [ ] Open one decrypted backup with `file` — it reports gzip, not plain text.
- [ ] Passphrase copy is still in the password manager and readable (open it,
      do not paste it anywhere).
- [ ] `systemctl status cricall-backup cricall-backup-uploads --no-pager` shows
      recent successful runs, and `journalctl -u cricall-backup -n 20` has no
      `[offsite]` error lines.
- [ ] Dropped the temp database and removed `restore-from-offsite/`.
- [ ] Noted the result (date, object used, counts) in the ops log.

If any box fails, keep the local backups, fix the cause, and redo the test in
the same quarter. Never disable encryption or retention to make it pass.
