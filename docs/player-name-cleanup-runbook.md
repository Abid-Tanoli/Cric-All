# Player name cleanup runbook

This process reviews placeholder players, then either renames a placeholder in
place or merges it into an existing player. It does not have a transaction:
always take and verify a database backup before applying changes.

## 1. Generate the placeholder report

From the repository root, make sure `Backend/.env` points to the intended
database, then run:

```powershell
node Backend/src/scripts/listPlaceholderPlayers.js --output .\player-review.csv
```

The report is read-only against MongoDB and creates only the owner-editable CSV.
Review the candidate names, match context, team conflicts, duplicate warnings,
and batting/bowling evidence; none of those hints automatically chooses a
player.

## 2. Identify the correct existing player

Use the `candidate_real_players`, `candidates_by_match`, and similar-name
columns as starting points, then confirm the player against the relevant
scorecards and team/tournament squad. Candidate entries include the player's
name and 24-character MongoDB id. If you need to look the id up separately,
query the Players collection by the exact name and verify the team and match
history before using it.

Fill `real_name_or_existing_player_id` for each row:

- **Rename**: enter the corrected name when the placeholder should remain a
  separate player record. The player's id stays the same.
- **Merge**: enter the exact name of one existing player on the same team, or
  enter that player's id (plain 24-character id or `id:<id>`). The placeholder
  record and its references are merged into that player.
- Do not use a name if it is ambiguous within the team; use the verified id.

Cross-team merges are blocked by default. `allow_cross_team` is acceptable only
when the evidence confirms that the placeholder is the same person as the
existing player and the differing teams are a known data-entry/roster issue.
For that row, set `allow_cross_team` to `--allow-cross-team`; the apply command
must also include `--allow-cross-team`. Do not use this flag to resolve a
similar-name match or a team disagreement that has not been independently
verified.

## 3. Take a mandatory backup

Before any `--apply` run, confirm the database target and take a fresh backup
using the environment's approved backup procedure. In a configured local
environment, the existing backup command is:

```powershell
npm --prefix Backend run db:backup
```

Verify that the backup completed successfully, record its location and time,
and confirm it can be read/restored before proceeding. Do not rely only on an
old scheduled backup.

## 4. Review the dry run

Keep the same database configuration and CSV, and run without `--apply`:

```powershell
node Backend/src/scripts/applyPlayerNames.js --file .\player-review.csv
```

Inspect every planned rename/merge, the source and target ids, and the
collection/field reference counts. The dry run must complete without validation
errors. Resolve every ambiguity and rerun it; do not treat an error as a
warning. A dry run performs no database writes.

For cross-team rows, use both explicit opt-ins:

```powershell
node Backend/src/scripts/applyPlayerNames.js --file .\player-review.csv --allow-cross-team
```

This is still a dry run.

## 5. Apply the validated CSV

Only after the backup is verified and the dry run is clean, run:

```powershell
node Backend/src/scripts/applyPlayerNames.js --file .\player-review.csv --apply
```

For approved cross-team rows, also pass `--allow-cross-team`. The command stops
on the first write error, records an in-progress/partial audit entry and
completed collection counts when possible, and does not process later CSV rows.
If it reports a partial merge, do not rerun the same row until the state has
been reconciled.

## 6. Post-apply checks

Run the read-only integrity checker for each merged target. For example:

```powershell
node Backend/src/scripts/checkPlayerMergeIntegrity.js --player 6ad33ae65222d39cff5e4344
```

Add `--tournament <tournamentId>` to focus the match list on one tournament, or
`--json` to save machine-readable output. Review every listed reference,
non-manual match, suspicious ball/innings row, orphan match id, and audit entry.
Also rerun the placeholder report and inspect the affected scorecards, squads,
rankings, team pages, and player statistics.

## 7. Undo and recovery

- **Use the audit entry to identify the operation.** Find the
  `player.name_cleanup` entry by source id and time. Its metadata records the
  source id, target id, original name, operation, status, and counts by
  collection. A completed entry identifies the merge to investigate; an
  `in_progress` or `partial` entry means the operation requires reconciliation.
- **For an audit-guided merge reversal**, record those ids, counts, and the
  operation time; restore the source player's pre-merge document from the
  backup; then compare the affected collection rows against that backup and
  reverse only fields proven to have changed in this operation. Verify every
  row before restoring it. The audit entry is a locator, not a before-image:
  it does not contain every affected document or its previous field values.
- **Do not blindly reverse every target id.** Other legitimate documents may
  already refer to the target player, so replacing every target id with the
  source id can corrupt data. Use the audit metadata and pre-merge backup to
  identify the exact affected rows. For a simple rename, the audit's original
  name and source id are sufficient to rename the same record back.
- **For a merge, prefer restoring the verified backup** to a recovery database,
  then use the audit entry to identify the changed source/target and compare the
  affected documents. Restore production only through the approved recovery
  procedure after validating the recovery copy.

## Known limits

- MongoDB transactions are not used. A process, network, or database failure
  can leave a merge partially applied; the script records progress and counts
  where possible, but the verified backup is the recovery source of truth.
- Counts describe documents/updates completed by the script; an interrupted
  server-side `updateMany` may not return a reliable modified count.
- The integrity checker is read-only, but it scans stored collections for
  unmodeled references and can take time on a large database.
- A name match is not proof of identity. Human review of team and match
  evidence is required before every merge.
