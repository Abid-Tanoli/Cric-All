import { api } from "./api";

/**
 * External cricket data, proxied through this app's own backend.
 *
 * These calls used to go straight to https://api.cricapi.com/v1 from the
 * browser with `apikey=VITE_CRICAPI_KEY`. Vite inlines every `VITE_*` variable
 * into the bundle at build time, so that key was shipped to every visitor and
 * was readable in devtools by anyone who opened the page. A third-party key in
 * client code is a public third-party key.
 *
 * The backend already speaks this provider: `services/cricketDataService.js`
 * calls the same cricapi endpoints with `CRICKET_API_KEY` from the server
 * environment, and `routes/international.js` exposes them under
 * `/api/international/*`. Going through it keeps the key on the server, reuses
 * the backend's per-endpoint cache (30s for live scores up to 3600s for series,
 * which is strictly longer than the 180s localStorage cache this file used to
 * keep), and inherits its RapidAPI / free-Cricbuzz / demo-data fallbacks - so
 * the UI now works with whichever provider the operator actually configured.
 *
 * Response shape: the backend replies `{ success, data }` where `data` is the
 * provider's payload untouched, so the normalizers below are unchanged.
 *
 * Endpoint mapping, for the record:
 *   /series            -> GET /international/series
 *   /series_info       -> GET /international/series/:id
 *   /currentMatches    -> GET /international/live
 *   /matches           -> GET /international/matches
 *   /match_scorecard   -> GET /international/match/:id/scorecard
 *   /match_squad       -> GET /international/series/:id/squad
 *   /match_points      -> GET /international/series/:id/points
 *   /players           -> GET /international/players?search=
 *
 * The last two were also *wrong* before: cricapi has no `match_squad` or
 * `match_points` endpoint, so both always failed and both call sites swallowed
 * the error into an empty list. The squad and points that do exist are
 * series-scoped, so they are fetched by the same id the page already holds.
 */

const PROVIDER_PATH = "/international";

const asArray = (value) => (Array.isArray(value) ? value : []);

const unwrap = (response) => response?.data?.data ?? null;

const encode = (value) => encodeURIComponent(String(value ?? "").trim());

const normalizeDate = (value) => value || "";

export const normalizeSeries = (series = {}) => ({
  id: series.id || series._id || series.series_id || "",
  name: series.name || series.series || "Unnamed Series",
  startDate: normalizeDate(series.startDate || series.start_date),
  endDate: normalizeDate(series.endDate || series.end_date),
  odi: Number(series.odi || series.ODI || 0),
  t20: Number(series.t20 || series.T20 || 0),
  test: Number(series.test || series.Test || 0),
  matches: Number(series.matches || series.matchCount || 0),
  squads: Number(series.squads || 0),
  raw: series,
});

export const normalizeScore = (score = {}) => ({
  team: score.inning || score.team || score.teamName || "",
  runs: Number(score.r ?? score.runs ?? 0),
  wickets: Number(score.w ?? score.wickets ?? 0),
  overs: String(score.o ?? score.overs ?? "0"),
  inning: score.inning || "",
});

export const normalizeMatch = (match = {}) => ({
  id: match.id || match._id || match.matchId || "",
  name: match.name || match.title || `${match.teams?.[0] || "Team A"} vs ${match.teams?.[1] || "Team B"}`,
  matchType: match.matchType || match.type || "",
  status: match.status || (match.matchStarted && !match.matchEnded ? "live" : match.matchEnded ? "completed" : "upcoming"),
  venue: match.venue || "",
  date: match.date || match.dateTimeGMT || match.startAt || "",
  dateTimeGMT: match.dateTimeGMT || match.date || "",
  teams: asArray(match.teams),
  teamInfo: asArray(match.teamInfo),
  score: asArray(match.score).map(normalizeScore),
  fantasyEnabled: Boolean(match.fantasyEnabled),
  bbbEnabled: Boolean(match.bbbEnabled),
  hasSquad: Boolean(match.hasSquad),
  matchStarted: Boolean(match.matchStarted),
  matchEnded: Boolean(match.matchEnded),
  raw: match,
});

export const normalizeSeriesInfo = (data = {}) => {
  const info = data.info || data.series || data;
  const matchList = data.matchList || data.matches || data.matchInfo || [];
  return {
    info: normalizeSeries(info),
    matches: asArray(matchList).map(normalizeMatch),
    raw: data,
  };
};

export const normalizeScorecard = (data = {}) => ({
  match: normalizeMatch(data.matchInfo || data.info || data),
  scorecard: asArray(data.scorecard || data.innings),
  raw: data,
});

export const normalizeSquad = (data = {}) => ({
  squads: asArray(data.squad || data.squads || data.teamInfo).map((team) => ({
    teamName: team.teamName || team.name || team.team || "Team",
    players: asArray(team.players || team.player).map((player) => ({
      id: player.id || player._id || player.pid || "",
      name: player.name || player.fullName || "Player",
      role: player.role || player.playingRole || "",
    })),
  })),
  raw: data,
});

export const normalizePoints = (data = {}) => ({
  points: asArray(data.points || data.data || data),
  raw: data,
});

export const normalizePlayers = (data = {}) =>
  asArray(data).map((player) => ({
    id: player.id || player.pid || "",
    name: player.name || "Player",
    country: player.country || "",
    raw: player,
  }));

/**
 * Whether the server has any external cricket provider configured.
 *
 * This used to be a synchronous `Boolean(import.meta.env.VITE_CRICAPI_KEY)`,
 * which could only ever answer a question about the browser build. It is now a
 * server question, so it is async, and the answer is the backend's
 * `GET /international/status` rather than anything the client can read.
 */
export const getCricketProviderStatus = async () => {
  const response = await api.get(`${PROVIDER_PATH}/status`, { timeout: 5000 });
  return response?.data?.data ?? null;
};

export const getSeries = async () => {
  const response = await api.get(`${PROVIDER_PATH}/series`, { timeout: 8000 });
  return asArray(unwrap(response)).map(normalizeSeries);
};

export const getSeriesInfo = async (seriesId) => {
  const response = await api.get(`${PROVIDER_PATH}/series/${encode(seriesId)}`, { timeout: 8000 });
  return normalizeSeriesInfo(unwrap(response) ?? {});
};

export const getCurrentMatches = async () => {
  const response = await api.get(`${PROVIDER_PATH}/live`, { timeout: 8000 });
  return asArray(unwrap(response)).map(normalizeMatch);
};

export const getMatches = async () => {
  const response = await api.get(`${PROVIDER_PATH}/matches`, { timeout: 8000 });
  return asArray(unwrap(response)).map(normalizeMatch);
};

export const getMatchScorecard = async (matchId) => {
  const response = await api.get(`${PROVIDER_PATH}/match/${encode(matchId)}/scorecard`, { timeout: 8000 });
  return normalizeScorecard(unwrap(response) ?? {});
};

export const getMatchSquad = async (matchId) => {
  const response = await api.get(`${PROVIDER_PATH}/series/${encode(matchId)}/squad`, { timeout: 8000 });
  return normalizeSquad(unwrap(response) ?? {});
};

export const getMatchPoints = async (matchId) => {
  const response = await api.get(`${PROVIDER_PATH}/series/${encode(matchId)}/points`, { timeout: 8000 });
  return normalizePoints(unwrap(response) ?? {});
};

export const searchPlayers = async (playerName) => {
  if (!playerName?.trim()) return [];
  const response = await api.get(`${PROVIDER_PATH}/players`, {
    params: { search: playerName.trim() },
    timeout: 8000,
  });
  return normalizePlayers(unwrap(response));
};

export default {
  getCricketProviderStatus,
  getSeries,
  getSeriesInfo,
  getCurrentMatches,
  getMatches,
  getMatchScorecard,
  getMatchSquad,
  getMatchPoints,
  searchPlayers,
};