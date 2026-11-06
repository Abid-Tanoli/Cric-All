# CricAll automated MongoDB backups

`Backend/src/scripts/backupDb.js` creates a gzip'd logical backup of the live
MongoDB database. It tries, in order:

1. `mongodump --uri <MONGO_URL>` inside the running `cricall-mongo` container
   (`MONGO_CONTAINER_NAME` overrides the container name) — the full URL,
   including auth, is passed to `mongodump` so the backup uses the same
   database/user as the backend. No host MongoDB tools required.
2. A host `mongodump` binary pointed at the `MONGO_URL` / `MONGODB_URI` /
   `MONGO_URI` from `Backend/.env`.

> Never paste passwords, a `git diff` of an `.env` file, or the Mongo URL into a
> chat or ticket. If one leaks, rotate the credential immediately.

Every `docker` command typed on the production VPS needs `sudo`. The systemd
unit runs as root, so the script's container-side dump does not need `sudo` when
started through the unit.

The script never logs the Mongo URL or password: error output from either tool
is redacted before it is printed.

Archives land in `Backend/backups/backup-cric-all-YYYY-MM-DDTHH-MM-SS.archive.gz`
and are ignored by git. Retention is a **window in days**, configured with
`BACKUP_KEEP_DAYS` (default 14 days; `0` keeps only the newest archive). The
newest archive is always kept, even if it is older than the window. The output
dir is configurable via `BACKUP_DIR`.

## Run a backup on the production VPS

The repo is checked out at `~/cric-all`. Backups run through the systemd unit:

```bash
sudo -v
sudo systemctl start cricall-backup.service
sudo journalctl -u cricall-backup.service -n 50 --no-pager
ls -lh ~/cric-all/Backend/backups/backup-cric-all-*.archive.gz | tail -n 3
```

`systemctl start` waits for the one-shot service to finish. Do not continue
unless the journal shows `status=0/SUCCESS` and the newest archive exists with a
plausible size.

Run once by hand from the checkout (development/debug only):

```bash
cd ~/cric-all/Backend
npm run db:backup            # or: node src/scripts/backupDb.js
node src/scripts/backupDb.js --print-instructions   # prints scheduling help
```

## Schedule it on the VPS (runs once per 24h)

Production uses the provided `cricall-backup.timer` / `cricall-backup.service`
systemd units. The cron example below is an alternative, not the production
scheduler.

### Option A — cron

```bash
crontab -e
```

```cron
15 2 * * * cd "$HOME/cric-all/Backend" && /usr/bin/node src/scripts/backupDb.js >> "$HOME/cric-all/Backend/backups/backup.log" 2>&1
```

The repo path is `~/cric-all` (`$HOME/cric-all` in cron). If you use cron rather
than the systemd unit, the cron user must be able to run Docker, or the backup
script's container-side dump must run with the required privileges.

### Option B — systemd timer

Copy the two provided units into `/etc/systemd/system`, then edit
`WorkingDirectory` and `ExecStart` in `cricall-backup.service` to the absolute
path of `~/cric-all/Backend`. Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cricall-backup.timer
systemctl list-timers | grep cricall   # verify next run time
systemctl status cricall-backup        # check the last run
```

The provided `cricall-backup.service` runs the script as root on the host; the
script performs the container-side dump against `cricall-mongo`. The host needs
Docker access.

## Follow-up: off-VPS copy (not implemented)

These backups live only on the VPS's local disk alongside the container. A copy
off the VPS (e.g. `rclone` to object storage or an rsync to a second machine)
is a **follow-up the operator must configure**. Suggested extension point:
append an upload step to `backupDb.js` or add a separate cron entry that ships
`Backend/backups/backup-cric-all-*.archive.gz` off-box after the 02:15 backup
completes.
