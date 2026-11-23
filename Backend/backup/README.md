# CricAll automated MongoDB backups

`Backend/src/scripts/backupDb.js` creates a gzip'd logical backup of the live
MongoDB database. It tries, in order:

1. `docker exec <container> mongodump --uri <MONGO_URL>` against the running
   `cricall-mongo` container (`MONGO_CONTAINER_NAME` overrides the container
   name) — the full URL, including auth, is passed to `mongodump` so the backup
   uses the same database/user as the backend. No host MongoDB tools required.
2. A host `mongodump` binary pointed at the `MONGO_URL` / `MONGODB_URI` /
   `MONGO_URI` from `Backend/.env`.

The script never logs the Mongo URL or password: error output from either tool
is redacted before it is printed.

Archives land in `Backend/backups/backup-<db>-YYYY-MM-DDTHH-MM-SS.archive.gz`
and are ignored by git. Retention is a **window in days**, configured with
`BACKUP_KEEP_DAYS` (default 14 days; `0` keeps only the newest archive). The
newest archive is always kept, even if it is older than the window. The output
dir is configurable via `BACKUP_DIR`.

Run once:

```bash
cd Backend
npm run db:backup            # or: node src/scripts/backupDb.js
node src/scripts/backupDb.js --print-instructions   # prints scheduling help
```

## Schedule it on the VPS (runs once per 24h)

### Option A — cron

```bash
crontab -e
```

```cron
15 2 * * * cd /opt/cricall/Backend && node src/scripts/backupDb.js >> /opt/cricall/Backend/backups/backup.log 2>&1
```

Change `/opt/cricall` to wherever the repo is checked out on the VPS.

### Option B — systemd timer

Copy the two provided units into `/etc/systemd/system` (edit `ExecStart` to the
repo path), then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cricall-backup.timer
systemctl list-timers | grep cricall   # verify next run time
systemctl status cricall-backup        # check the last run
```

The provided `cricall-backup.service` runs the script on the host, which shells
out to `docker exec cricall-mongo mongodump`; the host needs Docker access.

## Off-VPS encrypted copy (optional, off by default)

After a successful local backup, `backupDb.js` encrypts the archive with
AES-256-GCM (passphrase read from `OFFSITE_PASSPHRASE_FILE`, mode 600) and
uploads it with `rclone copyto` to whatever remote you configured: Google
Drive, Backblaze B2, any SFTP box. `OFFSITE_BACKUP_ENABLED=true` is the only
switch; leave it unset/false and nothing is uploaded and no new dependency is
needed.

- Remote retention is `OFFSITE_RETENTION_DAYS` (default 30; `0` never deletes).
- An off-site failure does **not** delete or touch the local archive. The script
  logs a clear, secret-free error and exits with code **3** (local backup OK,
  off-site failed), so systemd shows the unit as failed.
- `backupUploads.js` (`cricall-backup-uploads.timer`, weekly Sunday 03:15)
  tars the `uploads_data` Docker volume — images are NOT in mongodump — and
  uploads it the same way. It is skipped with a clear message when the tarball
  exceeds `OFFSITE_UPLOADS_MAX_MB` (default 2048, `0` = no limit).
- `restoreFromOffsite.js` lists/downloads/decrypts and restores into a temp
  database first; the live restore needs `--confirm`.

Setup, verification and the quarterly restore-test checklist:
`docs/vps-deploy-runbook.md` section 10.