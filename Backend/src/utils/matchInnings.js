// Every freshly created Match must carry its two innings slots up front so the
// toss, the playing XI, the openers and the very first ball all have somewhere
// to land. Historically only `createMatch` and `createOrgMatch` seeded them,
// while the tournament fixtures paths (`createTournamentMatch`,
// `applyTournamentFixtures`) created a Match with no `innings`, so scoring died
// with "Invalid innings index" on ball one. All creation paths now build the
// array through `buildMatchInnings`, and the scoring entry points run
// `ensureMatchInnings` so a fixture persisted without innings (old data, or any
// path that slipped through) self-heals on the toss or first ball.

// The two empty innings for a brand-new match. Schema defaults fill runs,
// wickets, balls, extras, batting, bowling and so on; only the team and the
// "upcoming" status need to be explicit.
export const buildMatchInnings = (teams = []) => {
  const [team1, team2] = Array.isArray(teams) ? teams : [];
  return [
    { team: team1, status: "upcoming" },
    { team: team2, status: "upcoming" },
  ];
};

// Lazily repair a match that is missing innings slots. This only ever *adds*
// missing slots — an existing innings array (including a live or completed one)
// is never cleared, reordered or mutated. Returns true when it changed the doc.
export const ensureMatchInnings = (match) => {
  if (!match) return false;
  if (!Array.isArray(match.innings)) match.innings = [];
  const teams = (match.teams || []).map((team) => team?._id || team);
  let changed = false;
  for (let i = match.innings.length; i < 2; i += 1) {
    match.innings.push({ team: teams[i], status: "upcoming" });
    changed = true;
  }
  return changed;
};

// The seam every summary-stat reader should go through to get a match's
// innings. Live-scored and manual matches both store their innings in the same
// `match.innings` array (the manual endpoint fills the same `batting`/`bowling`
// summary fields the scorer maintains), so this is deliberately a single access
// point rather than a branch: a future reader that needs to derive summary
// innings from something other than `match.innings` (e.g. ball-by-ball events)
// changes only this function. Named and shaped to stay compatible with the
// `inningsForMatch` helper added on the `tournament-hub` branch.
export const inningsForMatch = (match) => {
  if (!match) return [];
  if (Array.isArray(match.innings) && match.innings.length) return match.innings;
  return buildMatchInnings(match.teams || []);
};
