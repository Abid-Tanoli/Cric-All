Backend notes:
- Start: npm run dev
- Score update endpoint: POST /api/matches/:id/score
  Body example:
  {
    "inningsIndex": 0,
    "runs": 4,
    "wickets": 0,
    "balls": 1,
    "extras": 0,
    "commentaryText": "Beautiful cover drive! 4 runs."
  }

Database safety and seed data:
- Use an explicit MongoDB database name. The intended database name is cric-all.
- Do not use a MongoDB URL without a database path such as /cric-all; drivers can default to the test database.
- Export a database snapshot before any cleanup, reset, or migration.
- The seed script creates dummy starter data only. It is not a production data restore.
- Do not run npm run seed -- --reset on real data.
- Real teams, players, and matches should be created through the Admin panel.
- Read-only exports can be created with npm run db:export:cric-all or npm run db:export:test.

Career and tournament statistics:
- Batting, bowling, and fielding leaderboards resolve a player's team from the innings' batting team: batting belongs to that team; bowling and fielding belong to the opposing fixture team. Fixture array order is not used.
- Player profiles derive career figures and match tabs from completed, published match innings on read. Manual scorecards and ball-by-ball matches use the same aggregation; drafts and did-not-bat rows do not inflate player figures.
- A player represented more than one team is labelled with the team from their most recent match. Fielding credit is counted only when a recognized dismissal includes an explicit fielder.
- `Player.stats` remains available for legacy/seed data but is not merged into derived career figures. No recompute/backfill script is needed: publishing a manual match or completing a live match is reflected on the next profile read. Tournament stats caches are invalidated when those transitions occur.

Creating the first admin:
- If the database has no admin accounts, create one intentionally with environment variables:
  PowerShell: $env:ADMIN_NAME="Your Name"; $env:ADMIN_EMAIL="you@example.com"; $env:ADMIN_PASSWORD="use-a-long-password"; npm run admin:create
- The command does not print the password and will not overwrite an existing admin.
