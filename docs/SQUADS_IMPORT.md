# Squads import — tournament `squads-2026-10`

`Backend/src/scripts/importSquads.js` bulk-creates the tournament's clubs,
teams and players from a squads CSV. This document is the operator runbook:
back up, dry-run, apply, verify, and — if it has to be undone — roll back.

The script is **dry-run by default**. It writes nothing unless `--apply` is
passed.

---

## 1. What it creates, and what it deliberately does not

For the file this was written for (`cricall-tournament-squads.csv`):

| Object | Count | Details |
| --- | --- | --- |
| Clubs (`TeamOrganization`, `type: "club"`) | 8 | public, `isActive: true`, **`owner: null`, no `Membership`** |
| Teams (`Team`) | 8 | linked to their club via `organizationRef`, `isPublic: true` |
| Players (`Player`) | 120 | linked to their team; `playingRole` mapped from the CSV `role` column |
| Captain / vice-captain (`Team.captain` / `viceCaptain`) | 8 / 8 | from the CSV flags |

It does **not**:

- write a `Membership` for anyone — imported clubs are ownerless until a real
  owner is assigned with `src/scripts/setOrgOwner.js`. (The Admin create-org
  path writes a phantom membership for the platform Admin id; this script
  deliberately does not reproduce that.)
- invent stats, ages, photos, phone numbers or bio data.
- write a note field — `Player` has no admin-note field, so the CSV `note`
  column is **printed in the report only**.
- rename, merge or delete anything. A club/team/player that already exists is
  reported as `already exists` and left untouched.

### Roles

CSV `role` → `Player.playingRole`:

| CSV role | `playingRole` |
| --- | --- |
| `Batsman` | `Batsman` |
| `Bowler` | `Bowler` |
| `All Rounder` | `All-Rounder` |
| `Wicket Keeper` | `Wicket-Keeper` |
| `Batsman / Wicket Keeper` | `Wicket-Keeper` |

A **blank** role is not invented: the row is listed under **"role to confirm"**
and no `playingRole` is written (the schema default then applies). In the real
file that is **104 rows** — every player except the 15 in *Ittehad Sports* and
*Baldia Zalmi / Nasir* — so expect a long confirmation list.

### Same names in different teams

The duplicate rule is **per team**. Two players called *Hamza* in two different
teams are two people and both are created. Only a duplicate **within one team**
is a validation error.

### Idempotency

A re-run with `--apply` creates nothing new. Matching mirrors the API exactly:

- club → case-folded, whitespace-collapsed name;
- team → `(organizationRef, name)`, case-insensitive anchored match
  (`teamService.assertTeamNameAvailable`);
- player → `(team, normalizedName)` (`playerService.normalizePlayerName`).

---

## 2. Before you start

The script validates the whole CSV **before** it opens a database connection, so
a bad file fails with nothing written. It still will not run against a target it
has not been told about:

- loopback hosts (`127.0.0.1`, `localhost`, `::1`) are allowed by default;
  any other host needs `--allow-host <name>`;
- the database must be `cric-all-e2e` by default; anything else needs
  `--allow-database <name>`.

Compose deployments reach Mongo as the internal hostname `mongodb`, so both
flags are required there (see §5).

The script **does not read `.env`**. The URI is always passed explicitly, and it
is never printed.

---

## 3. Back up first

Never apply a bulk write without a fresh backup. On the VPS, from the repo:

```bash
cd /opt/cricall/Backend
npm run db:backup
ls -lt backups/ | head
```

Or take a one-off archive straight from the Mongo container:

```bash
docker exec cricall-mongo mongodump --db cric-all \
  --archive=/tmp/cric-all-before-squads-$(date +%F).archive.gz --gzip
docker cp cricall-mongo:/tmp/cric-all-before-squads-$(date +%F).archive.gz ./backups/
```

Restore (only if you actually need it):

```bash
docker cp ./backups/<archive> cricall-mongo:/tmp/restore.archive.gz
docker exec cricall-mongo mongorestore --archive=/tmp/restore.archive.gz --gzip --drop
```

---

## 4. Copy the CSV into the backend container

The CSV lives outside the repo and is never committed. Copy it in at run time:

```bash
docker cp /path/on/host/cricall-tournament-squads.csv \
  cricall-backend:/tmp/cricall-tournament-squads.csv
```

The `Backend/Dockerfile` copies the app with `WORKDIR /app`, so the script is
`/app/src/scripts/importSquads.js` and is run as `node src/scripts/...` from
inside the container.

---

## 5. Dry run, then apply (Compose)

`--uri` uses the container's own `$MONGO_URL` (loaded from `Backend/.env`), so
run the whole command inside a container shell (single quotes) — that way the
container expands the variable, not your host shell.

**Dry run (no writes):**

```bash
docker exec cricall-backend sh -c '
  node src/scripts/importSquads.js \
    --file /tmp/cricall-tournament-squads.csv \
    --uri "$MONGO_URL" --allow-host mongodb --allow-database cric-all
'
```

Read the report. You should see:

```
Validated: 8 clubs, 8 teams, 120 players.
  Clubs   : 8 to create, 0 already exist
  Teams   : 8 to create, 0 already exist
  Players : 120 to create, 0 already exist
...
Dry run complete. Nothing was written. Re-run with --apply to write.
```

The dry run also prints every "role to confirm" row and every CSV note so the
data can be confirmed before anything is written.

**Apply:**

```bash
docker exec cricall-backend sh -c '
  node src/scripts/importSquads.js \
    --file /tmp/cricall-tournament-squads.csv \
    --uri "$MONGO_URL" --allow-host mongodb --allow-database cric-all --apply
'
```

Save the **entire apply output**. It ends with the created ids:

```
Created ids (for a precise rollback — see docs/SQUADS_IMPORT.md):
  clubs   : 65f... , 65f... , ...
  teams   : 65f... , 65f... , ...
  players : 120 id(s) not printed individually; look them up by team.
```

Those club/team ids are the exact handle for a later rollback — copy them
somewhere durable (ticket, run log). Player ids are intentionally not printed
one-by-one; they are found through their team.

---

## 6. Verify

```bash
docker exec cricall-mongo mongosh cric-all --quiet --eval '
  const names = [
    "Ittehad Sports","Baldia Zalmi","Sky Sports","Orangi United",
    "Young Star","Khan Associates","Family Stallions","Orangi Warriors"
  ];
  const clubs = db.teamorganizations.find({ name: { $in: names } }).toArray();
  const clubIds = clubs.map(c => c._id);
  const teams = db.teams.find({ organizationRef: { $in: clubIds } }).toArray();
  const teamIds = teams.map(t => t._id);
  print("clubs               :", clubs.length);
  print("clubs ownerless     :", clubs.filter(c => !c.owner).length);
  print("teams               :", teams.length);
  print("teams public        :", teams.filter(t => t.isPublic === true).length);
  print("players             :", db.players.countDocuments({ team: { $in: teamIds } }));
  print("teams w/ captain    :", db.teams.countDocuments({ _id: { $in: teamIds }, captain: { $ne: null } }));
  print("teams w/ vicecaptain:", db.teams.countDocuments({ _id: { $in: teamIds }, viceCaptain: { $ne: null } }));
  print("memberships (should):", 0, "->", db.memberships.countDocuments({ organization: { $in: clubIds } }));
'
```

Expected: `clubs 8`, `ownerless 8`, `teams 8`, `public 8`, `players 120`,
`captain 8`, `vicecaptain 8`, `memberships 0`.

Re-running §5's apply a second time must report `0 to create, N already exist`
and leave every count unchanged — that is the idempotency check.

---

## 7. Rollback

> **There is no import tag.** No model has an `importBatch` field, and Mongoose
> strict mode silently drops unknown fields, so the script cannot stamp
> documents with `importBatch: "squads-2026-10"`. Rollback is therefore a
> **precise list-and-delete**, driven by the club/team ids captured in §5. If you
> did not capture them, use the name-based fallback in §7.2 and read the risk
> note first.

Rollback is destructive and must be scoped exactly: deleting a club whose name
happened to exist before the import, or a team that was already there, would
destroy real data.

### 7.1 Preferred — delete by the captured ids

Substitute the club ids and team ids from the apply output.

```bash
docker exec cricall-mongo mongosh cric-all --quiet --eval '
  const clubIds   = [ ObjectId("..."), ObjectId("...") ];   // from the apply output
  const teamIds   = [ ObjectId("..."), ObjectId("...") ];   // from the apply output

  const p = db.players.deleteMany({ team: { $in: teamIds } });
  const t = db.teams.deleteMany({ _id: { $in: teamIds } });
  // Guard: only remove a club that is ownerless. If this deletes fewer than
  // clubIds.length, one of them is no longer ownerless — stop and inspect.
  const c = db.teamorganizations.deleteMany({ _id: { $in: clubIds }, owner: null });

  print("players deleted :", p.deletedCount);
  print("teams deleted   :", t.deletedCount);
  print("clubs deleted   :", c.deletedCount);
  print("clubs expected  :", clubIds.length);
'
```

Any memberships that pointed at these clubs (there should be none — the script
creates none) can be swept with:

```bash
docker exec cricall-mongo mongosh cric-all --quiet --eval '
  db.memberships.deleteMany({ organization: { $in: [ ObjectId("...") ] } });
'
```

### 7.2 Fallback — delete by the eight names (higher risk)

Use this only if the apply output was lost. It deletes by name **and** requires
the club to be ownerless, but if a real ownerless club with the same name
existed before the import this still removes it.

```bash
docker exec cricall-mongo mongosh cric-all --quiet --eval '
  const names = [
    "Ittehad Sports","Baldia Zalmi","Sky Sports","Orangi United",
    "Young Star","Khan Associates","Family Stallions","Orangi Warriors"
  ];
  const clubs = db.teamorganizations.find({ name: { $in: names }, owner: null }).toArray();
  const clubIds = clubs.map(c => c._id);
  const teams = db.teams.find({ organizationRef: { $in: clubIds } }).toArray();
  const teamIds = teams.map(t => t._id);

  print("about to delete clubs:", clubIds.length, "teams:", teamIds.length,
        "players:", db.players.countDocuments({ team: { $in: teamIds } }));
  // Stop here and confirm the numbers before uncommenting the deletes.
  // db.players.deleteMany({ team: { $in: teamIds } });
  // db.teams.deleteMany({ _id: { $in: teamIds } });
  // db.teamorganizations.deleteMany({ _id: { $in: clubIds }, owner: null });
'
```

**Risk:** without ids, this cannot distinguish an imported club from a
pre-existing one that shares its name. Confirm `owner: null` and inspect the
match count first; if a name was pre-existing, delete it by id from §7.1
instead.

### 7.3 After a rollback

Re-run §6's verify query. All eight counts should be back to what they were
before the import. If you cannot get there, restore the §3 backup.

---

## 8. Local (non-Docker) usage

For a throwaway local database the guard allows loopback and the database name
must be allowed explicitly:

```bash
cd Backend
node src/scripts/importSquads.js \
  --file /tmp/cricall-tournament-squads.csv \
  --uri mongodb://127.0.0.1:27017/cric-all --allow-database cric-all            # dry run
node src/scripts/importSquads.js \
  --file /tmp/cricall-tournament-squads.csv \
  --uri mongodb://127.0.0.1:27017/cric-all --allow-database cric-all --apply
```

`MIGRATION_MONGO_URL` is accepted as a fallback for `--uri`, but the explicit
flag is preferred.

---

## 9. Automated tests

`Backend/test/importSquads.test.js` runs the script as a child process against a
throwaway `mongodb-memory-server` database named `cric-all-import-test`, using a
generated fixture CSV in the OS temp directory (never the real file). It pins:
dry-run writes nothing; apply creates 8/8/120; a second apply is a no-op; role
mapping; captain/vice-captain; same-name-across-teams; invalid-file abort;
reserved-prefix refusal; and both target guards.

```bash
cd Backend
node --test --test-concurrency=1 test/importSquads.test.js
```
