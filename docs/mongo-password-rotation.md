# Rotating the local Mongo root password

This procedure changes the password of the existing root user in the local
`cricall-mongo` container (the `local-mongo` Compose profile), then updates the
root `.env` and `Backend/.env` so the backend and backup script use the new
credential.

It does **not** cover Atlas; rotate an Atlas database user in the Atlas UI or
API instead.

> **Never put a password on a command line.** Command lines are saved in shell
> history and can appear in process listings. The commands below read the
> current/new password from a hidden prompt or from a mode-600 file whose value
> is never echoed.
>
> **Never paste passwords, a `git diff` of an `.env` file, or the Mongo URL into
> a chat or a ticket.** If one leaks, rotate the credential immediately.

## Why editing `MONGO_INITDB_*` is not rotation

`MONGO_INITDB_ROOT_USERNAME` / `MONGO_INITDB_ROOT_PASSWORD` are read by the
Mongo image only while `/data/db` (the `mongo_data` volume) is being initialized
for the first time. After the volume exists, changing those variables in
`docker-compose.yml` or `.env` does nothing to the existing database user. Use
`db.changeUserPassword()` below, then keep the env values in sync with the real
password.

## 0. Before you start

- Pick a maintenance window; the backend will briefly fail to authenticate.
- Confirm the checkout is at `~/cric-all`.
- Run `sudo -v` first so the VPS login password prompt happens before the Mongo
  password prompt and the two prompts are not mixed up. Every `docker` command
  on the VPS needs `sudo`.
- Take a fresh backup with the **current** credentials:

  ```bash
  sudo -v
  sudo systemctl start cricall-backup.service
  sudo journalctl -u cricall-backup.service -n 50 --no-pager
  ls -lh ~/cric-all/Backend/backups/backup-cric-all-*.archive.gz | tail -n 3
  ```

  Do not continue unless the journal shows `status=0/SUCCESS` and the newest
  archive exists with a plausible size.

- Do not close the session or lose the new password until the backend and a
  backup have both succeeded.

## 1. Generate the new password into a private file

Use hex so the value is URL-safe in `MONGO_URL` and does not need encoding.

```bash
cd ~/cric-all
umask 077
PW_FILE="$(mktemp "$HOME/.cricall-mongo-password.XXXXXX")"
openssl rand -hex 32 > "$PW_FILE"
chmod 600 "$PW_FILE"
NEW_MONGO_PASSWORD="$(cat "$PW_FILE")"
```

`umask 077` plus `chmod 600` keeps the file readable only by your user. Do not
echo `NEW_MONGO_PASSWORD` or paste it into a terminal command.

## 2. Change the password inside the container

Load the root username from the root `.env`. The username is not secret.

```bash
cd ~/cric-all
MONGO_ROOT_USERNAME="$(sed -n 's/^MONGO_ROOT_USERNAME=//p' .env | tr -d '"')"
```

Write a temporary JS file that reads the new value from the variable. The file
is created mode `600` and contains the secret only for the duration of this
step.

```bash
JS_FILE="$(mktemp "$HOME/.cricall-change-mongo-password.XXXXXX.js")"
umask 077
cat > "$JS_FILE" <<EOF
db.getSiblingDB("admin").changeUserPassword("${MONGO_ROOT_USERNAME}", "${NEW_MONGO_PASSWORD}");
EOF
chmod 600 "$JS_FILE"
```

Copy it into the container, then run `mongosh` with `-p`. `-p` prompts for the
**old** password; paste the old password at the prompt. Do not type either
password on the command line.

```bash
# Run this again if the sudo timestamp expired, so the VPS login prompt is
# handled before the Mongo password prompt.
sudo -v
sudo docker cp "$JS_FILE" cricall-mongo:/tmp/change-mongo-password.js
sudo docker exec -it cricall-mongo \
  mongosh \
    -u "$MONGO_ROOT_USERNAME" \
    --authenticationDatabase admin \
    -p \
    --file /tmp/change-mongo-password.js
```

Delete the temporary JS file inside the container and on the host immediately:

```bash
sudo docker exec cricall-mongo rm -f /tmp/change-mongo-password.js
rm -f "$JS_FILE"
```

If `changeUserPassword` reports an authentication or permission error, stop. Do
not update the env files: the old password is still in effect.

## 3. Update the root `.env` and `Backend/.env`

Keep a timestamped copy of both env files first, with private permissions. These
copies contain secrets and are shredded during cleanup.

```bash
cd ~/cric-all
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ROTATE_HOME="$HOME/cricall-password-rotation-$STAMP"
mkdir -p "$ROTATE_HOME"
chmod 700 "$ROTATE_HOME"
cp .env "$ROTATE_HOME/root.env"
cp Backend/.env "$ROTATE_HOME/backend.env"
chmod 600 "$ROTATE_HOME/root.env" "$ROTATE_HOME/backend.env"
```

Update the root `.env` with `sed` using the shell variable, never by echoing the
password:

```bash
sed -i "s|^MONGO_ROOT_PASSWORD=.*|MONGO_ROOT_PASSWORD=${NEW_MONGO_PASSWORD}|" .env
```

Update the password inside `Backend/.env`'s `MONGO_URL`. Because the generated
password is hex, it is already URL-safe.

```bash
sed -i -E "s|^(MONGO_URL=mongodb://[^:]+:)[^@]*@|\1${NEW_MONGO_PASSWORD}@|" Backend/.env
```

If `Backend/.env` uses `MONGODB_URI` or `MONGO_URI` instead of `MONGO_URL`,
apply the same pattern to whichever variable is present. Keep the host,
database, and `authSource` unchanged; change only the password. Lock the files
down and confirm the variables exist without printing their values:

```bash
chmod 600 .env Backend/.env
grep -q '^MONGO_ROOT_PASSWORD=' .env && echo "root .env updated"
grep -q '^MONGO_URL=' Backend/.env && echo "Backend/.env updated"
```

> **Next deploy may recreate Mongo once.** The next
> `sudo docker compose --profile local-mongo up -d --build` may recreate the
> Mongo container once because `MONGO_INITDB_ROOT_PASSWORD` changed in the root
> `.env`. The `mongo_data` volume is kept, so there is no data loss. The
> `MONGO_INITDB_*` variables only apply when the volume is initialized for the
> first time.

## 4. Recreate only the backend

A plain `restart` does not re-read `env_file`; recreate only the backend:

```bash
cd ~/cric-all
sudo docker compose --profile local-mongo up -d --force-recreate --no-deps backend
```

The frontends and Mongo do not need to be recreated for this step.

## 5. Verify the new credential

Check the backend log for a successful connection:

```bash
sudo docker compose --profile local-mongo logs --tail=100 backend | grep -F "MongoDB connected"
```

Run a backup with the new credential and check the systemd result:

```bash
sudo systemctl start cricall-backup.service
sudo journalctl -u cricall-backup.service -n 50 --no-pager
ls -lh ~/cric-all/Backend/backups/backup-cric-all-*.archive.gz | tail -n 3
```

The journal must show `status=0/SUCCESS` and the newest archive must exist with
a plausible size. Backups keep 14 days and always keep the newest archive.

Check the site and API:

```bash
curl -fsS http://127.0.0.1:5050/api/health
curl -fsSI http://127.0.0.1:3300/ | head -n 1
curl -fsSI http://127.0.0.1:3301/ | head -n 1
```

Expected: a healthy API response and HTTP success from both frontends. If the
backend still fails, re-check `Backend/.env` and recreate the backend again.

## 6. Cleanup

1. Save the new password in the password manager **before** deleting the file.
2. Shred the temporary password file and the timestamped env copies.
3. Unset the shell variables.

```bash
shred -u "$PW_FILE" "$ROTATE_HOME/root.env" "$ROTATE_HOME/backend.env"
rmdir "$ROTATE_HOME"
unset NEW_MONGO_PASSWORD MONGO_ROOT_USERNAME
```

The temporary JS file was already deleted inside the container and on the host
in step 2.

## Failure handling

- **Backend cannot authenticate:** the database password is already changed.
  Fix `Backend/.env` and recreate the backend again. Reverting the env file to
  the old password will not work.
- **New password lost:** Mongo has no "old password" fallback once the root user
  exists. Keep the password manager entry before closing the session. If it is
  lost, recovery means restoring a database archive into a fresh volume and
  re-running the rotation deliberately.
- **Backup fails after rotation:** do not delete the pre-rotation archives. Fix
  the connection string, re-run `sudo systemctl start cricall-backup.service`,
  and confirm `status=0/SUCCESS` before making further changes.
