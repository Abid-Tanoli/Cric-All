# Rotating the local Mongo root password

This procedure changes the password of the existing root user in the local
`cricall-mongo` container (the `local-mongo` Compose profile), then updates the
root `.env` and `Backend/.env` so the backend and backup script use the new
credential.

It does **not** cover Atlas; rotate an Atlas database user in the Atlas UI or
API instead.

> **Never put a password on a command line.** Command lines are saved in shell
> history and can appear in process listings. The commands below read the
> current/new password from a hidden prompt or from an environment variable
> whose value is never echoed. Keep the new password in the owner's password
> manager before you start.

## Why editing `MONGO_INITDB_*` is not rotation

`MONGO_INITDB_ROOT_USERNAME` / `MONGO_INITDB_ROOT_PASSWORD` are read by the
Mongo image only while `/data/db` (the `mongo_data` volume) is being initialized
for the first time. After the volume exists, changing those variables in
`docker-compose.yml` or `.env` does nothing to the existing database user. Use
`db.changeUserPassword()` below, then keep the env values in sync with the real
password.

## 0. Before you start

- Pick a maintenance window; the backend will briefly fail to authenticate.
- Take a fresh backup with the **current** credentials:

  ```bash
  cd /opt/cricall/Backend
  npm run db:backup
  ls -lh backups/backup-*.archive.gz | tail -n 3
  ```

- Make a private copy of the env files (they contain secrets; keep mode `600`):

  ```bash
  cd /opt/cricall
  STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
  ROTATE_HOME="$HOME/cricall-password-rotation-$STAMP"
  mkdir -p "$ROTATE_HOME"
  chmod 700 "$ROTATE_HOME"
  cp .env "$ROTATE_HOME/root.env"
  cp Backend/.env "$ROTATE_HOME/backend.env"
  chmod 600 "$ROTATE_HOME/root.env" "$ROTATE_HOME/backend.env"
  ```

- Do not close the session or lose the new password until the backend and a
  backup have both succeeded.

## 1. Load the current username

The username is not secret, so it can be read from the root `.env`. The current
password is typed at the hidden prompt that `mongosh` shows in the next step.

```bash
cd /opt/cricall
export MONGO_ROOT_USERNAME="$(sed -n 's/^MONGO_ROOT_USERNAME=//p' .env | tr -d '"')"
```

Only variable names appear in shell history, never the password value.

## 2. Change the password inside the container

Open `mongosh` as the current root user. `mongosh` prompts for the current
password and does not echo it:

```bash
docker exec -it cricall-mongo \
  mongosh \
    --username "$MONGO_ROOT_USERNAME" \
    --authenticationDatabase admin
```

At the `mongosh` prompt, replace `<MONGO_ROOT_USERNAME>` with the value of
`MONGO_ROOT_USERNAME` (for example `root`) and run:

```javascript
use admin
db.changeUserPassword("<MONGO_ROOT_USERNAME>", passwordPrompt())
```

`passwordPrompt()` hides the new password while you type it. There is no
confirmation prompt, so type carefully. Then exit:

```javascript
exit
```

If `changeUserPassword` reports an authentication or permission error, stop.
Do not update the env files: the old password is still in effect.

## 3. Update the root `.env`

Edit `/opt/cricall/.env` with the server's editor and set the new value. Never
use a shell command that embeds the password.

```dotenv
MONGO_ROOT_USERNAME=<existing local mongo root username>
MONGO_ROOT_PASSWORD=<new root password>
```

```bash
chmod 600 /opt/cricall/.env
```

This keeps Compose's local-mongo configuration aligned with the real user. It
does not perform another rotation.

## 4. Update the backend connection string

Edit `/opt/cricall/Backend/.env` and replace the password inside whichever of
these variables is used:

```dotenv
MONGO_URL=mongodb://<user>:<new-url-encoded-password>@mongodb:27017/<database>?authSource=admin
# or MONGODB_URI=... / MONGO_URI=...
```

Use URL encoding for reserved characters in the password, for example:

| Character | Encoded |
|---|---|
| `@` | `%40` |
| `:` | `%3A` |
| `/` | `%2F` |
| `?` | `%3F` |
| `#` | `%23` |
| `%` | `%25` |

Keep the host/database/authSource exactly as they were; change only the
password. Do not paste the password into a terminal command or a ticket.

```bash
chmod 600 /opt/cricall/Backend/.env
```

## 5. Recreate the backend

A plain `restart` does not re-read `env_file`; recreate only the backend:

```bash
cd /opt/cricall
docker compose --profile local-mongo up -d --force-recreate --no-deps backend
docker compose --profile local-mongo logs --tail=100 backend
```

Look for a successful Mongo connection and no authentication errors. The
frontends do not need to be recreated.

## 6. Verify the new credential and the live API

Prompt for the new password (do not type it inline) and pass it to the
container through the environment, not as an argument on the host command line:

```bash
read -rsp 'New local Mongo root password: ' MONGO_NEW_PASSWORD
echo
export MONGO_NEW_PASSWORD

docker exec -i \
  -e MONGO_ROOT_USERNAME -e MONGO_NEW_PASSWORD \
  cricall-mongo sh -c '
    mongosh \
      --username "$MONGO_ROOT_USERNAME" \
      --password "$MONGO_NEW_PASSWORD" \
      --authenticationDatabase admin \
      --eval "db.runCommand({ ping: 1 })"
  '

curl -fsS http://127.0.0.1:5050/api/health
```

Expected: `{ ok: 1 }` from `mongosh` and a healthy API response. If the backend
still fails, re-check the URL encoding in `Backend/.env` and recreate it again.

## 7. Run a backup with the new credential

```bash
cd /opt/cricall/Backend
npm run db:backup
ls -lh backups/backup-*.archive.gz | tail -n 3
```

The backup must use the same `Backend/.env` URL and finish with a non-zero
archive. Finally clear the prompted values:

```bash
unset MONGO_ROOT_PASSWORD MONGO_NEW_PASSWORD MONGO_ROOT_USERNAME
```

## Failure handling

- **Backend cannot authenticate:** the database password is already changed.
  Fix `Backend/.env` (usually URL encoding) and recreate the backend again.
  Reverting the env file to the old password will not work.
- **New password lost:** Mongo has no "old password" fallback once the root user
  exists. Keep the password manager entry before closing the session. If it is
  lost, recovery means restoring a database archive into a fresh volume and
  re-running the rotation deliberately.
- **Backup fails after rotation:** do not delete the pre-rotation archives. Fix
  the connection string and re-run `npm run db:backup` before making further
  changes.
