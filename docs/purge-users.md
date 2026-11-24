# Guarded user purge runbook

`npm run users:purge` removes selected `User` accounts and the records those
accounts created, while a named set of organizations and everything reachable
from it stays intact. It **never writes to the separate `admins` collection**
(the Super Admin is not a user account).

Dry run is the default: nothing is written without `--apply`.

## Arguments

| Argument | Meaning |
| --- | --- |
| `--keep=<emails or ids>` | Comma-separated user emails (case-insensitive) or user ids to keep. |
| `--keep-none` | Keep no users. Exactly one of `--keep` / `--keep-none` is required. |
| `--protect-orgs=<ids>` | Required comma-separated organization ids. Everything reachable from these orgs is protected. |
| `--delete-owned-orgs` | Optional. Without it, a user who owns an organization is skipped and reported. With it, that org and its default/branch teams are deleted first. |
| `--apply --confirm=<N>` | Destructive mode. `N` is the `Total to delete (users + organizations + teams)` printed by the dry run. |

A protected organization's teams, players (including `teamHistory`), matches,
tournaments/events/series, rankings, balls/deliveries/commentary/partnerships/
analytics and media/uploads are kept. If a doomed user created a protected
record, only that record's creator/owner pointer is cleared, using the same
behaviour as `accountDeletionService.deleteUserAccount`. An organization
referenced by a protected record is itself protected and never deleted.

## 1. Take a fresh backup on the host

Apply refuses any run without a `backup-*.archive.gz` newer than 30 minutes in
the backup directory (`Backend/backups` on the host, `/app/backups` inside the
container).

```bash
cd ~/cric-all/Backend
npm run db:backup
ls -lt backups/backup-*.archive.gz | head
```

The backup volume is not mounted into the backend container, so copy the host
archive into the container before applying (the script checks `/app/backups`):

```bash
cd ~/cric-all
docker compose exec backend mkdir -p /app/backups
docker compose cp Backend/backups/backup-cric-all-<timestamp>.archive.gz backend:/app/backups/
docker compose exec backend ls -lt /app/backups
```

## 2. Dry run (writes nothing)

```bash
docker compose exec backend npm run users:purge -- \
  --keep=owner@example.com,another@example.com \
  --protect-orgs=<legacy-org-id-1>,<legacy-org-id-2>,... \
  --delete-owned-orgs
```

The report prints every user with `KEEP` / `DELETE`, each deletable user's
organizations, teams, players, matches, tournaments, events, posts, issue
reports, invitations and memberships, the organizations (with teams) that would
be deleted, each protected organization with its team/player/match/tournament
counts, any skipped records, and the **protected snapshot**. Use `--keep-none`
instead of `--keep=` when every user account is to be considered for deletion.

If you omit `--delete-owned-orgs`, every user who owns an organization is
skipped and reported; the dry-run total then excludes that user.

## 3. Apply with the exact dry-run total

Re-run the dry run if the data changed. Then copy the `Total to delete (users +
organizations + teams): N` value into `--confirm`:

```bash
docker compose exec backend npm run users:purge -- \
  --keep=owner@example.com,another@example.com \
  --protect-orgs=<legacy-org-id-1>,<legacy-org-id-2>,... \
  --delete-owned-orgs \
  --apply --confirm=N
```

It exits non-zero on any deletion error, or if the protected snapshot changes
during apply. One audit entry is written per deleted user
(`action: users.purge.user`) and per deleted organization
(`action: users.purge.organization`), all with `actorType: system` and the
confirmed total in `metadata`.

## 4. Verify

The command re-prints the protected snapshot after apply and fails loudly if any
count changed. Re-run the dry run (step 2) with the same arguments: it should
report `Total to delete (users + organizations + teams): 0` and the same
snapshot.

Optional direct counts, from the host (replace the ids with your protected
organization ids):

```bash
mongosh "$MONGO_URL" --quiet --eval '
const ids = [<legacy-org-id-1>, <legacy-org-id-2>].map(ObjectId);
const teams = db.teams.find({ organizationRef: { $in: ids } }, { _id: 1 }).toArray().map(t => t._id);
printjson({
  organizations: db.teamorganizations.countDocuments({ _id: { $in: ids } }),
  teams: teams.length,
  players: db.players.countDocuments({ $or: [{ team: { $in: teams } }, { "teamHistory.team": { $in: teams } }] }),
  matches: db.matches.countDocuments({ $or: [{ teams: { $in: teams } }, { organizationRef: { $in: ids } }] }),
  tournaments: db.tournaments.countDocuments({ $or: [{ teams: { $in: teams } }, { organizationRef: { $in: ids } }] }),
  balls: db.balls.countDocuments({ matchId: { $in: db.matches.find({ teams: { $in: teams } }, { _id: 1 }).toArray().map(m => m._id) } }),
  admins: db.admins.countDocuments({})
});'
```

`admins` must be unchanged. Do not run `db:cleanup-uploads` as part of this
purge: uploads of protected records must never be removed.

## Rollback

Rollback is the backup from step 1, not an undo command. Restore it in full;
the purge is not transactional, so a partial failure also needs a restore.

```bash
# On the host, with mongorestore installed:
mongorestore --uri="$MONGO_URL" --gzip --archive=Backend/backups/backup-cric-all-<timestamp>.archive.gz

# Or streamed into the mongo container (service name is `mongodb`):
docker compose exec -T mongodb mongorestore --uri "$MONGO_URL" --gzip --archive < Backend/backups/backup-cric-all-<timestamp>.archive.gz
```

Mongo archives do not contain local upload files. If a doomed team/player/
tournament upload must come back, restore it separately from the uploads backup
(`npm run db:backup:uploads` / the `uploads-*.enc` off-site archive). Protected
records' uploads are never deleted by this script.
