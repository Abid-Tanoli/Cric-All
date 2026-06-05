import fetch from 'node-fetch';

const DEFAULT_BASE = 'https://cricbuzz-live.vercel.app';
const FREE_BASE = (process.env.FREE_CRICBUZZ_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
const cache = new Map();

let lastFreeApiError = '';
let lastFreeApiOkAt = 0;

const asArray = (value) => Array.isArray(value) ? value : [];

export const isFreeCricbuzzEnabled = () =>
  String(process.env.ENABLE_FREE_CRICBUZZ ?? 'true').toLowerCase() !== 'false';

export const getFreeCricbuzzStatus = () => ({
  enabled: isFreeCricbuzzEnabled(),
  provider: 'fallback-live-provider',
  lastError: lastFreeApiError,
  lastOkAt: lastFreeApiOkAt,
});

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(key, value, ttlSec) {
  cache.set(key, { value, expires: Date.now() + ttlSec * 1000 });
}

function staleCache(key) {
  return cache.get(key)?.value || null;
}

async function freeGet(path, ttlSec = 30, retries = 1) {
  if (!isFreeCricbuzzEnabled()) return null;

  const cacheKey = `free:${path}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${FREE_BASE}${path}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'BQ-PLAY/1.0',
        },
        signal: controller.signal,
      });

      const text = await response.text();
      if (!response.ok) {
        let message = text || `${response.status} ${response.statusText}`;
        try {
          const parsed = JSON.parse(text);
          message = parsed?.error?.message || parsed?.message || message;
        } catch {
          // Keep the raw response text when it is not JSON.
        }
        throw new Error(message);
      }

      const json = JSON.parse(text);
      lastFreeApiError = '';
      lastFreeApiOkAt = Date.now();
      setCache(cacheKey, json, ttlSec);
      return json;
    } catch (error) {
      lastFreeApiError = error.message;
      if (attempt === retries) {
        console.error(`[FallbackLiveProvider] ${path} error:`, error.message);
        return staleCache(cacheKey);
      }
      await new Promise(resolve => setTimeout(resolve, 750 * (attempt + 1)));
    } finally {
      clearTimeout(timeout);
    }
  }

  return null;
}

function parseScoreText(text = '') {
  const value = String(text || '').trim();
  if (!value || /yet to bat/i.test(value)) {
    return { display: value || 'Yet to bat', r: '', w: '', o: '' };
  }

  const match = value.match(/(\d+)(?:\/(\d+))?(?:\s*\(([^)]+)\))?/);
  if (!match) return { display: value, r: '', w: '', o: '' };

  return {
    display: value,
    r: match[1] || '',
    w: match[2] ?? '',
    o: match[3]?.replace(/\s*Ovs?/i, '').trim() || '',
  };
}

function titleTeams(title = '') {
  const main = String(title).split(' - ')[0].split(',')[0];
  const parts = main.split(/\s+vs\s+/i).map(item => item.trim()).filter(Boolean);
  return parts.length >= 2 ? parts : [];
}

function normalizeTeamScore(team = {}, index = 0) {
  const parsed = parseScoreText(team.run || team.score || '');
  const code = team.team || team.name || `Team ${index + 1}`;
  return {
    inning: code,
    team: code,
    teamName: code,
    r: parsed.r,
    w: parsed.w,
    o: parsed.o,
    display: parsed.display,
    chaseText: parsed.display,
  };
}

export function normalizeFreeMatch(raw = {}, state = 'live') {
  const teams = asArray(raw.teams);
  const title = raw.title || raw.name || 'Cricket match';
  const teamNames = teams.length
    ? teams.map(team => team.team || team.name).filter(Boolean)
    : titleTeams(title);

  return {
    id: String(raw.id || raw.matchId || ''),
    name: title,
    title,
    description: raw.overview || raw.timeAndPlace || title,
    matchType: raw.matchType || raw.type || 'match',
    status: raw.overview || raw.status || raw.update || '',
    ms: state === 'recent' ? 'result' : (state === 'upcoming' ? 'upcoming' : 'live'),
    venue: raw.timeAndPlace || raw.venue || '',
    date: raw.date || '',
    dateTimeGMT: raw.dateTimeGMT || '',
    matchStarted: state !== 'upcoming',
    matchEnded: state === 'recent',
    teams: teamNames,
    teamInfo: teamNames.map(name => ({ name, shortname: name })),
    score: teams.map(normalizeTeamScore),
    overview: raw.overview || '',
    source: 'fallback-live-provider',
  };
}

export function normalizeFreeScore(raw = {}, matchId = '') {
  if (!raw?.data) return null;
  const data = raw.data;
  const parsed = parseScoreText(data.liveScore || '');
  const title = data.title || 'Live cricket score';
  const teamNames = titleTeams(title);

  const batsmen = [
    {
      name: data.batsmanOne || '',
      runs: data.batsmanOneRun || '0',
      balls: String(data.batsmanOneBall || '(0)').replace(/[()]/g, ''),
      sr: data.batsmanOneSR || '0',
      isStriker: true,
    },
    {
      name: data.batsmanTwo || '',
      runs: data.batsmanTwoRun || '0',
      balls: String(data.batsmanTwoBall || '(0)').replace(/[()]/g, ''),
      sr: data.batsmanTwoSR || '0',
      isStriker: false,
    },
  ].filter(player => player.name);

  const bowlers = [
    {
      name: data.bowlerOne || '',
      overs: data.bowlerOneOver || '0',
      runs: data.bowlerOneRun || '0',
      wickets: data.bowlerOneWickets || '0',
      economy: data.bowlerOneEconomy || '0',
    },
    {
      name: data.bowlerTwo || '',
      overs: data.bowlerTwoOver || '0',
      runs: data.bowlerTwoRun || '0',
      wickets: data.bowlerTwoWicket || data.bowlerTwoWickets || '0',
      economy: data.bowlerTwoEconomy || '0',
    },
  ].filter(player => player.name);

  return {
    id: String(matchId),
    title,
    name: title.replace(/\s+-\s+Live Cricket Score/i, ''),
    status: data.update || '',
    liveScore: data.liveScore || '',
    runRate: data.runRate || '',
    batsmen,
    bowlers,
    match: {
      id: String(matchId),
      name: title.replace(/\s+-\s+Live Cricket Score/i, ''),
      title,
      status: data.update || '',
      ms: 'live',
      matchType: 'match',
      teams: teamNames,
      teamInfo: teamNames.map(name => ({ name, shortname: name })),
      score: [{
        inning: parsed.display ? parsed.display.split(' ')[0] : 'Live',
        team: parsed.display ? parsed.display.split(' ')[0] : 'Live',
        r: parsed.r,
        w: parsed.w,
        o: parsed.o,
        display: parsed.display,
        chaseText: parsed.display,
      }],
      source: 'fallback-live-provider',
    },
    score: [{
      inning: parsed.display ? parsed.display.split(' ')[0] : 'Live',
      team: parsed.display ? parsed.display.split(' ')[0] : 'Live',
      r: parsed.r,
      w: parsed.w,
      o: parsed.o,
      display: parsed.display,
      chaseText: parsed.display,
    }],
    source: 'fallback-live-provider',
  };
}

function statsFromFreeScore(score = {}) {
  return {
    inningsSummary: asArray(score.score).map(item => ({
      team: item.team,
      runs: item.r,
      wickets: item.w,
      overs: item.o,
    })),
    topBatters: asArray(score.batsmen).map(player => ({
      name: player.name,
      team: '',
      runs: Number(player.runs || 0),
      balls: Number(player.balls || 0),
      sr: player.sr,
    })),
    topBowlers: asArray(score.bowlers).map(player => ({
      name: player.name,
      wickets: Number(player.wickets || 0),
      runs: Number(player.runs || 0),
      overs: player.overs,
      eco: player.economy,
    })),
    latestBall: null,
    oversCount: 0,
    status: score.status || '',
    runRate: score.runRate || '',
  };
}

export async function getFreeMatchesByState(state = 'live', type = 'international') {
  const raw = await freeGet(`/v1/matches/${state}?type=${encodeURIComponent(type)}`, state === 'live' ? 20 : 300, 1);
  return asArray(raw?.data?.matches).map(match => normalizeFreeMatch(match, state));
}

export async function getFreeAllMatches(type = 'international') {
  const [live, recent, upcoming] = await Promise.allSettled([
    getFreeMatchesByState('live', type),
    getFreeMatchesByState('recent', type),
    getFreeMatchesByState('upcoming', type),
  ]);

  return [
    ...(live.status === 'fulfilled' ? live.value : []),
    ...(upcoming.status === 'fulfilled' ? upcoming.value : []),
    ...(recent.status === 'fulfilled' ? recent.value : []),
  ].filter(match => match.id);
}

export async function getFreeMatchScore(matchId) {
  const raw = await freeGet(`/v1/score/${encodeURIComponent(matchId)}`, 15, 1);
  return normalizeFreeScore(raw, matchId);
}

export async function getFreeMatchCenter(matchId) {
  const score = await getFreeMatchScore(matchId);
  if (!score) {
    return {
      match: null,
      scorecard: null,
      commentary: [],
      overs: [],
      playingXI: [],
      photos: [],
      news: [],
      videos: [],
      stats: statsFromFreeScore({}),
      apiStatus: getFreeCricbuzzStatus(),
      source: 'fallback-live-provider',
    };
  }

  return {
    match: score.match,
    scorecard: {
      ...score.match,
      score: score.score,
      innings: [],
      scorecard: [],
      liveScore: score,
    },
    liveScore: score,
    commentary: [],
    overs: [],
    playingXI: [],
    photos: [],
    news: [],
    videos: [],
    stats: statsFromFreeScore(score),
    apiStatus: getFreeCricbuzzStatus(),
    source: 'fallback-live-provider',
  };
}
