# VPS deploy runbook

Production runs from `~/cric-all` on the VPS. This is the deploy procedure for
that checkout. **Do not deploy on match days.**

> **Secret handling:** never paste passwords, a `git diff` of an `.env` file, or
> the Mongo URL into a chat or a ticket. If one leaks, rotate the credential
> immediately. The commands below never put a password on the command line.

## Production layout

| Item | Value |
|---|---|
| Repository | `~/cric-all` |
| Compose command | `sudo docker compose --profile local-mongo up -d --build` |
| Backend | host `5050` -> container `5000` |
| User frontend | host `3300` -> container `3000` |
| Admin frontend | host `3301` -> container `3001` |
| MongoDB | `127.0.0.1:27017` only |
| Backup archives | `Backend/backups/backup-cric-all-*.archive.gz` |
| Backup retention | 14 days; the newest archive is always kept |

The host-port values live in the root `.env` next to `docker-compose.yml`:

```dotenv
BACKEND_HOST_PORT=5050
USER_FRONTEND_HOST_PORT=3300
ADMIN_FRONTEND_HOST_PORT=3301
```

`MONGO_ROOT_USERNAME` / `MONGO_ROOT_PASSWORD` also live in the root `.env`.
`Backend/.env` holds the backend's `MONGO_URL`.

Every `docker` command on this VPS needs `sudo`. Run `sudo -v` once at the start
so the VPS login password prompt happens before any Mongo password prompt and
the two prompts are not mixed up.

## Before you start

- Confirm it is not a match day. **No deploys on match days.**
- Confirm the checkout is at `~/cric-all`.
- Keep the root `.env` and `Backend/.env` at mode `600`.

```bash
cd ~/cric-all
git status --short
```

Stop if there are unexpected local changes. Do not use the VPS checkout for
development.

## Deploy

Run the steps in this order.

### 1. Back up first

```bash
sudo -v
sudo systemctl start cricall-backup.service
sudo journalctl -u cricall-backup.service -n 50 --no-pager
ls -lh ~/cric-all/Backend/backups/backup-cric-all-*.archive.gz | tail -n 3
```

Do not continue unless the journal shows `status=0/SUCCESS` and the newest
archive exists with a plausible size. Backups keep 14 days and always keep the
newest archive.

### 2. Fast-forward the checkout

```bash
cd ~/cric-all
git pull --ff-only origin master
```

Never force-push or merge a divergent `master` on the VPS. If the pull is not a
fast-forward, stop and investigate.

### 3. Build and start

```bash
cd ~/cric-all
sudo docker compose --profile local-mongo up -d --build
```

### 4. Confirm the containers

```bash
sudo docker ps
```

The backend, user frontend, and admin frontend containers should be up.
`cricall-mongo` should also be up when using the local Mongo profile.

### 5. Record what is live

```bash
cd ~/cric-all
git log -1 --oneline
```

## Verify the deployment

### Ports

```bash
sudo ss -ltnp | grep -E ':(5050|3300|3301|27017)\b'
curl -fsS http://127.0.0.1:5050/api/health
curl -fsSI http://127.0.0.1:3300/ | head -n 1
curl -fsSI http://127.0.0.1:3301/ | head -n 1
```

Expected: backend on `5050`, user frontend on `3300`, admin frontend on `3301`,
and Mongo only on `127.0.0.1:27017`. `ss` must not show Mongo on `0.0.0.0:27017`
or `[::]:27017`.

### Backend logs

```bash
sudo docker compose --profile local-mongo logs --tail=100 backend
```

Look for `MongoDB connected` and no authentication errors. Do not paste log
lines containing credentials into a ticket.

### Backup after deploy

```bash
sudo systemctl start cricall-backup.service
sudo journalctl -u cricall-backup.service -n 50 --no-pager
```

The journal must show `status=0/SUCCESS` for the post-deploy backup.

## Rollback

If the new deployment is unhealthy, record the failure first. Revert the bad
commit in the repository, then repeat the normal deploy steps on the VPS:

```bash
cd ~/cric-all
git pull --ff-only origin master
sudo docker compose --profile local-mongo up -d --build
sudo docker ps
git log -1 --oneline
```

Do not force-push `master`. Restore from a backup only as a last resort; see
[`Backend/backup/README.md`](../Backend/backup/README.md).

## Related

- Mongo password rotation: [`mongo-password-rotation.md`](mongo-password-rotation.md)
- Backup details: [`Backend/backup/README.md`](../Backend/backup/README.md)
