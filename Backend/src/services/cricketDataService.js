import fetch from 'node-fetch';
import {
  hasRapidApiKey,
  getAllMatches as getRapidMatches,
  getAllSeries as getRapidSeries,
  getSeriesMatches as getRapidSeriesMatches,
  getMatchScorecard as getRapidMatchScorecard,
  getMatchCenter as getRapidMatchCenter,
  getMatchCommentary as getRapidMatchCommentary,
  getMatchLiveStats as getRapidMatchLiveStats,
  getMatchOvers as getRapidMatchOvers,
  getMatchPlayingXI as getRapidMatchPlayingXI,
  getMatchPhotos as getRapidMatchPhotos,
  getMatchNews as getRapidMatchNews,
  getMatchVideos as getRapidMatchVideos,
  getTeamSquad as getRapidTeamSquad,
  getPlayerInfo as getRapidPlayerInfo,
  getH2H as getRapidH2H,
  getLastFive as getRapidLastFive,
} from './cricketApiService.js';
import {
  isFreeCricbuzzEnabled,
  getFreeAllMatches,
  getFreeMatchesByState,
  getFreeMatchCenter,
  getFreeMatchScore,
} from './cricbuzzFreeService.js';

const BASE = 'https://api.cricapi.com/v1';
const PLACEHOLDER_KEYS = new Set([
  '',
  'your_api_key_here',
  'paste_your_key_here',
  'your_key_here',
  'your_rapidapi_key_here',
]);

const DEMO_DATA_ENABLED = process.env.ENABLE_DEMO_CRICKET_DATA === 'true';

function getFallback(endpoint, params = {}) {
  return null;
}

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

export const hasCricApiKey = () => {
  const key = process.env.CRICKET_API_KEY?.trim() || '';
  return !PLACEHOLDER_KEYS.has(key);
};

export const hasExternalCricketProvider = async () => hasRapidApiKey() || hasCricApiKey() || (await isFreeCricbuzzEnabled());

async function getFromRapidApi(endpoint, params = {}) {
  if (!hasRapidApiKey()) return undefined;

  switch (endpoint) {
    case 'currentMatches':
      return getRapidMatches();
    case 'series':
      return getRapidSeries();
    case 'series_info':
      return getRapidSeriesMatches(params.id);
    case 'series_squad':
      return getRapidTeamSquad(params.id);
    case 'team_squad':
      return getRapidTeamSquad(params.id);
    case 'match_scorecard':
    case 'match_info':
      return getRapidMatchScorecard(params.id);
    case 'match_center': {
      const center = await getRapidMatchCenter(params.id);
      const hasData = Boolean(
        center?.match
        || center?.scorecard
        || center?.commentary?.length
        || center?.overs?.length
        || center?.playingXI?.length
        || center?.photos?.length
        || center?.news?.length
        || center?.videos?.length
      );
      return hasData ? center : null;
    }
    case 'match_commentary':
      return getRapidMatchCommentary(params.id);
    case 'match_stats':
      return getRapidMatchLiveStats(params.id);
    case 'match_overs':
      return getRapidMatchOvers(params.id);
    case 'match_playing_xi':
      return getRapidMatchPlayingXI(params.id);
    case 'match_photos':
      return getRapidMatchPhotos(params.id);
    case 'match_news':
      return getRapidMatchNews(params.id);
    case 'match_videos':
      return getRapidMatchVideos(params.id);
    case 'players_info':
      return getRapidPlayerInfo(params.id);
    case 'h2h':
      return getRapidH2H(params.home, params.away);
    case 'last_five':
      return getRapidLastFive(params.teamId);
    default:
      return undefined;
  }
}

async function getFromFreeCricbuzz(endpoint, params = {}) {
  if (!(await isFreeCricbuzzEnabled())) return undefined;

  switch (endpoint) {
    case 'currentMatches':
      return getFreeAllMatches(params.type || 'international');
    case 'liveMatches':
      return getFreeMatchesByState('live', params.type || 'international');
    case 'recentMatches':
      return getFreeMatchesByState('recent', params.type || 'international');
    case 'upcomingMatches':
      return getFreeMatchesByState('upcoming', params.type || 'international');
    case 'match_center':
      return getFreeMatchCenter(params.id);
    case 'match_score':
      return getFreeMatchScore(params.id);
    case 'match_scorecard': {
      const center = await getFreeMatchCenter(params.id);
      return center?.scorecard || null;
    }
    case 'match_info': {
      const center = await getFreeMatchCenter(params.id);
      return center?.match || null;
    }
    case 'match_stats':
      return (await getFreeMatchCenter(params.id))?.stats || null;
    case 'match_commentary':
    case 'match_overs':
    case 'match_playing_xi':
    case 'match_photos':
    case 'match_news':
    case 'match_videos':
      return [];
    default:
      return undefined;
  }
}

async function get(endpoint, params = {}, ttl = 60) {
  const rapidData = await getFromRapidApi(endpoint, params);
  if (rapidData !== undefined) {
    if (rapidData !== null) return rapidData;
    const freeData = await getFromFreeCricbuzz(endpoint, params);
    if (freeData !== undefined) return freeData;
    return null;
  }

  const freeData = await getFromFreeCricbuzz(endpoint, params);
  if (freeData !== undefined) return freeData;

  const apiKey = process.env.CRICKET_API_KEY;
  if (!hasCricApiKey()) {
    return DEMO_DATA_ENABLED ? getFallback(endpoint, params) : null;
  }

  const cacheKey = `${endpoint}:${JSON.stringify(params)}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  try {
    const url = new URL(`${BASE}/${endpoint}`);
    url.searchParams.set('apikey', apiKey);
    url.searchParams.set('offset', 0);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString(), { timeout: 8000 });
    const json = await res.json();
    if (json?.status !== 'success') return null;
    setCache(cacheKey, json.data, ttl);
    return json.data;
  } catch (e) {
    console.error(`[LiveCricketAPI] ${endpoint} error:`, e.message);
    return null;
  }
}

export const getCurrentMatches = (type = 'international') => get('currentMatches', { type }, 30);

export const getLiveMatches = (type = 'international') => get('liveMatches', { type }, 20);

export const getRecentMatches = (type = 'international') => get('recentMatches', { type }, 300);

export const getUpcomingMatches = (type = 'international') => get('upcomingMatches', { type }, 600);

export const getAllSeries = () => get('series', {}, 3600);

export const getSeriesInfo = (id) => get('series_info', { id }, 300);

export const getSeriesPoints = (id) => get('series_points', { id }, 300);

export const getSeriesSquad = (id) => get('series_squad', { id }, 3600);

export const getTeamSquadById = (id) => get('team_squad', { id }, 3600);

export const getMatchScorecard = (id) => get('match_scorecard', { id }, 30);

export const getMatchInfo = (id) => get('match_info', { id }, 300);

export const getMatchCenter = (id) => get('match_center', { id }, 15);

export const getMatchLiveScore = (id) => get('match_score', { id }, 15);

export const getMatchCommentary = (id) => get('match_commentary', { id }, 15);

export const getMatchStats = (id) => get('match_stats', { id }, 15);

export const getMatchOvers = (id) => get('match_overs', { id }, 30);

export const getMatchPlayingXI = (id) => get('match_playing_xi', { id }, 60);

export const getMatchPhotos = (id) => get('match_photos', { id }, 300);

export const getMatchNews = (id) => get('match_news', { id }, 300);

export const getMatchVideos = (id) => get('match_videos', { id }, 300);

export const searchPlayers = (name) => get('players', { search: name }, 3600);

export const getPlayerInfo = (id) => get('players_info', { id }, 3600);

export const getHeadToHead = (home, away) => get('h2h', { home, away }, 86400);

export const getTeamForm = (teamId) => get('last_five', { teamId }, 3600);
