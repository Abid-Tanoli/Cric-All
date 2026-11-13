// Pure helpers for organization-owned tournaments and series.
//
// The Admin forms post straight to the shared tournament/series handlers, so
// the rules below mirror the server rather than inventing a second set:
//   * a tournament needs a name, both dates, and the minimum number of teams
//     for its type (league 3, knockout 2, group-stage/mixed 4);
//   * an end date cannot precede a start date;
//   * a series needs a name, and the same date ordering when both are set.
//
// Keeping this out of the components means the create form, the edit form and
// the tests all validate the same way.

export const TOURNAMENT_TYPES = Object.freeze(["league", "knockout", "group-stage", "mixed"]);

export const TOURNAMENT_FORMATS = Object.freeze(["6 Overs", "8 Overs", "T10", "T20", "ODI", "Test"]);

export const TOURNAMENT_STATUSES = Object.freeze(["upcoming", "live", "completed"]);

export const SERIES_FORMATS = Object.freeze(["Test", "ODI", "T20", "T20I"]);

export const SERIES_STATUSES = Object.freeze(["upcoming", "ongoing", "completed"]);

export const FIXTURE_FORMATS = Object.freeze([
  { value: "round-robin", label: "Round Robin (league)" },
  { value: "group", label: "Group Stage" },
  { value: "knockout", label: "Knockout" },
]);

export const FIXTURE_STAGES = Object.freeze([
  { value: "", label: "Stage (league / group)" },
  { value: "quarter_final", label: "Quarter-final" },
  { value: "semi_final", label: "Semi-final" },
  { value: "final", label: "Final" },
  { value: "third_place", label: "Third-place" },
]);

export const MIN_TEAMS_BY_TYPE = Object.freeze({
  league: 3,
  knockout: 2,
  "group-stage": 4,
  mixed: 4,
});

export const minTeamsForType = (type) => MIN_TEAMS_BY_TYPE[type] ?? 2;

export const idOf = (value) => String(value?._id || value || "");

export const uniqueIds = (values = []) =>
  [...new Set((Array.isArray(values) ? values : []).map(idOf).filter(Boolean))];

export const toDateInput = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

export const toDateTimeInput = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

const trimmed = (value) => String(value ?? "").trim();

const isoOrUndefined = (value) => {
  const text = trimmed(value);
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
};

/** First validation message, or "" when the form is valid. */
export function validateTournamentForm(form = {}) {
  const errors = {};
  if (!trimmed(form.name)) errors.name = "A tournament name is required.";
  else if (trimmed(form.name).length > 200) errors.name = "Keep the name under 200 characters.";

  if (!trimmed(form.startDate)) errors.startDate = "A start date is required.";
  if (!trimmed(form.endDate)) errors.endDate = "An end date is required.";
  if (form.startDate && form.endDate) {
    const start = new Date(form.startDate).getTime();
    const end = new Date(form.endDate).getTime();
    if (!Number.isNaN(start) && !Number.isNaN(end) && end < start) {
      errors.endDate = "The end date cannot be before the start date.";
    }
  }

  const type = trimmed(form.type) || "league";
  const teamCount = uniqueIds(form.teams || []).length;
  const min = minTeamsForType(type);
  if (teamCount < min) {
    errors.teams = `A ${type.replace("-", " ")} needs at least ${min} teams (${teamCount} selected).`;
  }

  const first = Object.values(errors)[0] || "";
  return { ok: !first, errors, message: first };
}

/** First validation message for a series, or "" when it is valid. */
export function validateSeriesForm(form = {}) {
  const errors = {};
  if (!trimmed(form.name)) errors.name = "A series name is required.";
  else if (trimmed(form.name).length > 200) errors.name = "Keep the name under 200 characters.";

  if (form.startDate && form.endDate) {
    const start = new Date(form.startDate).getTime();
    const end = new Date(form.endDate).getTime();
    if (!Number.isNaN(start) && !Number.isNaN(end) && end < start) {
      errors.endDate = "The end date cannot be before the start date.";
    }
  }

  const first = Object.values(errors)[0] || "";
  return { ok: !first, errors, message: first };
}

/**
 * The exact body createTournament/updateTournament read. `teams` is always an
 * array of unique ids, and shortName falls back to the Admin rule (first ten
 * characters, upper-cased) so an org-created tournament looks the same.
 */
export function buildTournamentPayload(form = {}) {
  const name = trimmed(form.name);
  const type = trimmed(form.type) || "league";
  return {
    name,
    shortName: trimmed(form.shortName) || name.substring(0, 10).toUpperCase(),
    type,
    format: trimmed(form.format) || "T20",
    startDate: isoOrUndefined(form.startDate),
    endDate: isoOrUndefined(form.endDate),
    venue: trimmed(form.venue),
    teams: uniqueIds(form.teams || []),
    rules: { twelfthManEnabled: form.twelfthManEnabled === true },
  };
}

export function buildSeriesPayload(form = {}) {
  return {
    name: trimmed(form.name),
    shortName: trimmed(form.shortName),
    matchType: trimmed(form.matchType) || "T20",
    status: trimmed(form.status) || "upcoming",
    startDate: isoOrUndefined(form.startDate),
    endDate: isoOrUndefined(form.endDate),
    venue: trimmed(form.venue),
    description: trimmed(form.description),
    teams: uniqueIds(form.teams || []),
  };
}

/**
 * A 403/404 from the competition routes is a permission/tenant answer, not a
 * validation failure. Showing the raw server sentence is fine, but these two
 * get a clearer sentence so a non-manager is not left guessing.
 */
export function competitionErrorMessage(error, fallback = "That did not work.") {
  const status = error?.response?.status;
  if (status === 403) return "You do not have permission to do that in this organization.";
  if (status === 404) return "That competition was not found in this organization.";
  return error?.message || fallback;
}

/** Group fixtures by group + round for the management screen. */
export function groupFixtures(fixtures = []) {
  const groups = new Map();
  for (const fixture of fixtures) {
    const round = fixture.round != null ? fixture.round : 1;
    const key = `${fixture.group || ""}::${round}`;
    if (!groups.has(key)) groups.set(key, { group: fixture.group || "", round, matches: [] });
    groups.get(key).matches.push(fixture);
  }
  return [...groups.values()].sort(
    (a, b) => (a.group || "").localeCompare(b.group || "") || a.round - b.round
  );
}
