import axios from "axios";

const BASE_URL = "https://api.cricapi.com/v1";
const CACHE_TTL = 3 * 60 * 1000;
const API_KEY = import.meta.env.VITE_CRICAPI_KEY;

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
});

const cacheKey = (endpoint, params = {}) =>
  `cricapi:${endpoint}:${JSON.stringify(params)}`;

const readCache = (key) => {
  try {
    const cached = JSON.parse(localStorage.getItem(key) || "null");
    if (!cached || Date.now() - cached.timestamp > CACHE_TTL) return null;
    return cached.data;
  } catch {
    return null;
  }
};

const writeCache = (key, data) => {
  try {
    localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), data }));
  } catch {
    // localStorage can be unavailable or full; API should still work.
  }
};

const apiError = (message, code = "CRICAPI_ERROR") => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const unwrapData = (response) => {
  const body = response?.data || {};
  if (body.status === "failure") {
    throw apiError(body.reason || body.message || "Cricket API request failed", "CRICAPI_LIMIT_OR_FAILURE");
  }
  return body.data ?? body;
};

const request = async (endpoint, params = {}) => {
  if (!API_KEY) {
    throw apiError("Cricket API key missing. Set VITE_CRICAPI_KEY in your environment.", "CRICAPI_KEY_MISSING");
  }

  const key = cacheKey(endpoint, params);
  const cached = readCache(key);
  if (cached) return cached;

  const response = await client.get(endpoint, {
    params: { apikey: API_KEY, ...params },
  });
  const data = unwrapData(response);
  writeCache(key, data);
  return data;
};

const asArray = (value) => Array.isArray(value) ? value : [];

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
  status: match.status || match.matchStarted && !match.matchEnded ? "live" : match.matchEnded ? "completed" : "upcoming",
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

export const isCricApiConfigured = () => Boolean(API_KEY);

export const getSeries = async (offset = 0) =>
  asArray(await request("/series", { offset })).map(normalizeSeries);

export const getSeriesInfo = async (seriesId, offset = 0) =>
  normalizeSeriesInfo(await request("/series_info", { id: seriesId, offset }));

export const getCurrentMatches = async (offset = 0) =>
  asArray(await request("/currentMatches", { offset })).map(normalizeMatch);

export const getMatches = async (offset = 0) =>
  asArray(await request("/matches", { offset })).map(normalizeMatch);

export const getMatchScorecard = async (matchId, offset = 0) =>
  normalizeScorecard(await request("/match_scorecard", { id: matchId, offset }));

export const getMatchSquad = async (matchId) =>
  normalizeSquad(await request("/match_squad", { id: matchId }));

export const getMatchPoints = async (matchId) =>
  normalizePoints(await request("/match_points", { id: matchId }));

export const searchPlayers = async (playerName, offset = 0) => {
  if (!playerName?.trim()) return [];
  return normalizePlayers(await request("/players", { offset, search: playerName.trim() }));
};

export default {
  isCricApiConfigured,
  getSeries,
  getSeriesInfo,
  getCurrentMatches,
  getMatches,
  getMatchScorecard,
  getMatchSquad,
  getMatchPoints,
  searchPlayers,
};
