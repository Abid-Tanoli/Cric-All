# Creating the First Administrator (Bootstrap Procedure)

The Admin app has one privileged role, `superadmin`, and exactly one way to obtain
it on a fresh database. This page documents the supported procedures, the one that
is safe in production, and the traps.

No secret values appear here. Every credential is a name you supply, never a value
to copy out of this file or out of git.

## Why this needs a document at all

`POST /api/admin/register` is an **unauthenticated, public** endpoint. It creates
the first administrator and grants it `superadmin`. It is gated by
`ALLOW_ADMIN_REGISTER`, which defaults to **off** (`Backend/.env.example`):

- Absent, empty, `false`, `0` and `no` all mean **off**, so a typo fails closed.
- `true`, `1` and `yes` mean on.

When the flag is on and the Admin collection is empty, whoever reaches the endpoint
first owns the platform. When any admin already exists, the endpoint returns the
same `403 Admin registration is closed.` whether the flag is off or the bootstrap
is taken, so it cannot be used as an existence oracle.

The endpoint also cannot be undone through the API: `DELETE /api/admin/:id` refuses
to remove the caller. Removing the account that took the bootstrap requires a
direct database write. Treat it as one-shot.

## Procedure A - `admin:create` (recommended, and the only production-safe one)

Runs against the database as a script. Nothing is exposed over HTTP at any point,
so the flag is irrelevant and no registration window is ever opened.

```
cd Backend
```

1. Set the three inputs in `Backend/.env` (names only in `.env.example`; this file
   is git-ignored):

   ```
   ADMIN_NAME=<display name>
   ADMIN_EMAIL=<login email>
   ADMIN_PASSWORD=<at least 8 characters>
   ```

   `ADMIN_PASSWORD` is hashed with bcrypt at cost 12 by the `Admin` model
   `pre("save")` hook, so the plaintext is never stored.

2. Create the account:

   ```
   npm run admin:create
   ```

3. Read the outcome from stdout:
   - `Admin created: <email> (role: superadmin)` - done.
   - `Admin creation skipped: N admin account(s) already exist.` - **nothing was
     written.** An admin is already present; do not delete it to force a re-run.
   - `ADMIN_PASSWORD must be at least 8 characters.` - fix the input and re-run.
   - `<name> is required.` - a name is missing; the script refuses to guess.

4. Log in at `/admin/login` and change the password immediately. The value in
   `Backend/.env` is now a live credential; clear `ADMIN_PASSWORD` (and the other
   two) once you have confirmed the login works.

Properties worth relying on:

- **Idempotent and non-destructive.** It counts admins first and exits without
  writing if any exist. There is no `--force`.
- **Concurrency-safe.** It writes `bootstrapClaim: "first-admin"`, arbitrated by
  the unique sparse index `uniq_admin_bootstrap_claim` on `Admin`. Two simultaneous
  runs cannot both succeed; the loser gets a duplicate-key error. A
  `countDocuments()` check alone could not promise this, because both processes
  would observe the empty collection before either wrote.
- **Always superadmin.** There is no branch that creates a plain `admin`, so it
  cannot leave the platform with nobody able to mint another administrator.

## Procedure B - `POST /api/admin/register` (local development only)

Use this only against a disposable local database. It is not for production.

1. Set `ALLOW_ADMIN_REGISTER=true` in `Backend/.env`.
2. **Restart the backend.** The flag is read from `process.env`, which dotenv
   populates once at boot. Editing `.env` does not change a running server.
3. `POST /api/admin/register` with `name`, `email`, `password`. Success is `201`
   with a token.
4. Set `ALLOW_ADMIN_REGISTER=false` and restart again.

Prefer Procedure A even locally. Procedure B widens a public write endpoint to
any client that can reach the port, and step 4 is easy to forget.

## Procedure C - `seedAdmin.js` (legacy; no longer creates a superadmin)

`src/seed/seedAdmin.js` is reachable only via `seedAll.js`. Read it before using
it:

- It calls `Admin.deleteMany({})` first. **It deletes every existing admin.**
- It creates `role: "admin"`, because the model default applies and the field is
  never set. It does **not** set `bootstrapClaim`.
- Because `/admin/create` is superadmin-only, a platform bootstrapped this way
  has nobody who can create further administrators.
- It refuses to run when `NODE_ENV=production` and any admin already exists.

It is also gated by `assertDestructiveSeedAllowed('Full database seed')`
(`src/seed/destructiveGuard.js`) and requires `ALLOW_DESTRUCTIVE_DB_SEED=true`.
For a first administrator, use Procedure A instead.

## What `npm run seed` does *not* do

`npm run seed` runs `src/seed/seedInitialData.js`, which seeds starter teams,
players and matches. **It creates no administrator.** Booting a fresh database
with only `npm run seed` leaves you with no way to sign in to the Admin app.

## Verification

After Procedure A, without guessing any value:

- The script printed `Admin created: ... (role: superadmin)`.
- `POST /api/admin/login` with the chosen email and password returns `200` and a
  token.
- `POST /api/admin/register` returns `403` with `Admin registration is closed.`
  This is expected and is the intended steady state, not a failure.

## Related

- `.env.example` - `ALLOW_ADMIN_REGISTER` and the `ADMIN_*` inputs.
- `docs/pre-launch-rotation-checklist.md` - rotate `ADMIN_PASSWORD` and the other
  credentials before launch.
- `docs/phase11-cross-tenant-report.md` - the original open finding this
  procedure closes out.