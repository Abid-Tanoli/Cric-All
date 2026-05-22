import fetch from 'node-fetch';

const API_KEY = process.env.CRICKET_API_KEY;
const BASE = 'https://api.cricapi.com/v1';

const cache = {};
function getCache(key) {
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() > entry.expires) { delete cache[key]; return null; }
  return entry.data;
}
function setCache(key, data, ttlSec = 60) {
  cache[key] = { data, expires: Date.now() + ttlSec * 1000 };
}

async function get(endpoint, params = {}, ttl = 60) {
  if (!API_KEY) return null;

  const cacheKey = `${endpoint}:${JSON.stringify(params)}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  try {
    const url = new URL(`${BASE}/${endpoint}`);
    url.searchParams.set('apikey', API_KEY);
    url.searchParams.set('offset', 0);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString(), { timeout: 8000 });
    const json = await res.json();
    if (json?.status !== 'success') return null;
    setCache(cacheKey, json.data, ttl);
    return json.data;
  } catch (e) {
    console.error(`[CricAPI] ${endpoint} error:`, e.message);
    return null;
  }
}

export const getCurrentMatches = () => get('currentMatches', {}, 30);

export const getAllSeries = () => get('series', {}, 3600);

export const getSeriesInfo = (id) => get('series_info', { id }, 300);

export const getSeriesPoints = (id) => get('series_points', { id }, 300);

export const getSeriesSquad = (id) => get('series_squad', { id }, 3600);

export const getMatchScorecard = (id) => get('match_scorecard', { id }, 30);

export const getMatchInfo = (id) => get('match_info', { id }, 300);

export const searchPlayers = (name) => get('players', { search: name }, 3600);

export const getPlayerInfo = (id) => get('players_info', { id }, 3600);
