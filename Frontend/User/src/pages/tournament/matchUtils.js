// Pure helpers behind the tournament hub's Fixtures & Results tab.
//
// Everything here is synchronous and free of React so the grouping and filter
// rules can be unit-tested on their own. The hub reuses the same status
// vocabulary the live pages already use (`innings-break` normalises to
// `innings_break`), so a match marked live by the scoring app lands in the
// "Live" group here too.

/** The scoring app sometimes writes "innings-break"; normalise it once. */
export function normalizeStatus(status) {
  return status === "innings-break" ? "innings_break" : status;
}

export const LIVE_STATUSES = Object.freeze(["live", "innings_break", "toss_done"]);
export const COMPLETED_STATUSES = Object.freeze(["completed", "abandoned"]);

/** Which of the three fixtures groups a status belongs to. */
export function matchBucket(status) {
  const s = normalizeStatus(status);
  if (LIVE_STATUSES.includes(s)) return "live";
  if (COMPLETED_STATUSES.includes(s)) return "completed";
  return "upcoming";
}

/** Splits matches into { live, completed, upcoming }, preserving input order. */
export function groupMatches(matches = []) {
  const groups = { live: [], completed: [], upcoming: [] };
  for (const match of matches || []) {
    groups[matchBucket(match?.status)].push(match);
  }
  return groups;
}

/** Short display names for both sides of a match. */
export function teamNamesOf(match) {
  return (match?.teams || [])
    .map((team) => (team && typeof team === "object" ? team.shortName || team.name : ""))
    .filter(Boolean);
}

/** A readable "A vs B" label that tolerates a half-populated match. */
export function matchLabel(match) {
  const names = teamNamesOf(match);
  if (names.length >= 2) return `${names[0]} vs ${names[1]}`;
  return match?.title || names[0] || "Match";
}

/**
 * Applies the Fixtures tab filters. Every filter is optional; the defaults are
 * "show everything", so calling with no filters is a no-op copy.
 *
 * @param {object[]} matches
 * @param {object}   [filters]
 * @param {string}   [filters.q]       free text over team/title/venue/number
 * @param {string}   [filters.teamId]  only matches featuring this team
 * @param {string}   [filters.status]  "all" | "live" | "completed" | "upcoming"
 * @param {string}   [filters.group]   "all" | a group/round name
 */
export function filterMatches(matches = [], filters = {}) {
  const { q = "", teamId = "", status = "all", group = "all" } = filters || {};
  const query = String(q || "").trim().toLowerCase();

  return (matches || []).filter((match) => {
    if (status !== "all" && matchBucket(match?.status) !== status) return false;

    if (teamId) {
      const ids = (match?.teams || []).map((team) => String(team?._id || team));
      if (!ids.includes(String(teamId))) return false;
    }

    if (group !== "all") {
      const matchGroup = match?.group || match?.round || "";
      if (String(matchGroup) !== String(group)) return false;
    }

    if (query) {
      const haystack = [
        ...teamNamesOf(match),
        match?.title,
        match?.venue,
        match?.matchNumber ? `match ${match.matchNumber}` : "",
        match?.group,
        match?.round,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    return true;
  });
}

/** Distinct group/round names present in a match list, for the filter dropdown. */
export function distinctGroups(matches = []) {
  const seen = new Set();
  for (const match of matches || []) {
    const value = match?.group || match?.round;
    if (value) seen.add(String(value));
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/** Distinct teams that appear in a match list, for the team filter dropdown. */
export function distinctTeams(matches = []) {
  const byId = new Map();
  for (const match of matches || []) {
    for (const team of match?.teams || []) {
      if (!team || typeof team !== "object") continue;
      const id = String(team._id || "");
      if (!id || byId.has(id)) continue;
      byId.set(id, { _id: id, name: team.name || team.shortName || "Team", shortName: team.shortName || "" });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export default {
  normalizeStatus,
  matchBucket,
  groupMatches,
  teamNamesOf,
  matchLabel,
  filterMatches,
  distinctGroups,
  distinctTeams,
  LIVE_STATUSES,
  COMPLETED_STATUSES,
};
