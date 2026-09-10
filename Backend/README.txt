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

Creating the first admin:
- If the database has no admin accounts, create one intentionally with environment variables:
  PowerShell: $env:ADMIN_NAME="Your Name"; $env:ADMIN_EMAIL="you@example.com"; $env:ADMIN_PASSWORD="use-a-long-password"; npm run admin:create
- The command does not print the password and will not overwrite an existing admin.
