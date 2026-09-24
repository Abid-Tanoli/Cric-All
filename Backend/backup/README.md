# CricAll automated MongoDB backups

`Backend/src/scripts/backupDb.js` creates a gzip'd logical backup of the live
MongoDB database and keeps only the most recent 14 backups. It tries, in order:

1. `docker exec <container> mongodump` against the running `cricall-mongo`
   container (`MONGO_CONTAINER_NAME` overrides the container name) — no host
   MongoDB tools required.
2. A host `mongodump` binary pointed at the `MONGO_URL` / `MONGODB_URI` /
   `MONGO_URI` from `Backend/.env`.

Archives land in `Backend/backups/backup-<db>-YYYY-MM-DDTHH-MM-SS.archive.gz`
and are ignored by git. Retention (default 14 files) is configurable via
`BACKUP_KEEP_DAYS`, the output dir via `BACKUP_DIR`.

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

## Follow-up: off-VPS copy (not implemented)

These backups live only on the VPS's local disk alongside the container. A copy
off the VPS (e.g. `rclone` to object storage or an rsync to a second machine)
is a **follow-up the operator must configure**. Suggested extension point:
append an upload step to `backupDb.js` or add a separate cron entry that ships
`Backend/backups/*.archive.gz` off-box after the 02:15 backup completes.