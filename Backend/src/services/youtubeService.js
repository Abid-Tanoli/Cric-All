import fetch from 'node-fetch';

const YT_BASE = 'https://www.googleapis.com/youtube/v3';

const CRICKET_CHANNELS = {
  icc: 'UCiWrjBhlICf_L_RK5y6Vrxw',
  pcb: 'UCiTDCIBE_1dMH-8VJvqdSTw',
  bcci: 'UC-G7KNFbOq-nUjgaGGwFRkA',
  globalNews: 'UC_1Vwh8cF0B9a8YGbAD_rMQ',
  skysports: 'UCNAf1k0yIjyGu3k9BwAg3lg',
};

const ytCache = {};
function getYTCache(key) {
  const e = ytCache[key];
  if (!e || Date.now() > e.exp) return null;
  return e.data;
}
function setYTCache(key, data, ttlSec = 3600) {
  ytCache[key] = { data, exp: Date.now() + ttlSec * 1000 };
}

const getYouTubeKey = () => {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key || key === 'your_youtube_api_key_here' || key === 'your_key_here') return '';
  return key;
};

const asArray = (value) => Array.isArray(value) ? value : [];

const isCompletedMatch = (match = {}) => {
  const marker = String(match.ms || match.status || '').toLowerCase();
  return match.matchEnded || marker === 'result' || marker === 'completed' || marker.includes('won');
};

const matchDate = (match = {}) => match.dateTimeGMT || match.date || '';

function makeSearchUrl(query) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

export function makeHighlightSearchCard(query, match = {}) {
  return {
    videoId: `search-${match.id || query}`,
    title: `${match.name || query} highlights`,
    description: 'Open YouTube search for match highlights',
    thumbnail: '',
    channelName: 'YouTube search',
    publishedAt: matchDate(match),
    embedUrl: '',
    watchUrl: makeSearchUrl(`${query} highlights`),
    matchId: match.id || match._id || match.matchId || '',
    matchName: match.name || '',
    matchDate: matchDate(match),
    isSearchLink: true,
  };
}

export async function searchHighlights(query, maxResults = 6) {
  const ytKey = getYouTubeKey();
  if (!ytKey) return [makeHighlightSearchCard(query)];

  const cacheKey = `highlights:${query}:${maxResults}`;
  const cached = getYTCache(cacheKey);
  if (cached) return cached;

  try {
    const url = new URL(`${YT_BASE}/search`);
    url.searchParams.set('key', ytKey);
    url.searchParams.set('q', query);
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('maxResults', maxResults);
    url.searchParams.set('order', 'date');
    url.searchParams.set('relevanceLanguage', 'en');
    url.searchParams.set('safeSearch', 'none');

    const res = await fetch(url.toString(), { timeout: 8000 });
    const json = await res.json();

    const videos = (json.items || []).map(item => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      description: item.snippet.description,
      thumbnail: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.medium?.url,
      channelName: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt,
      embedUrl: `https://www.youtube.com/embed/${item.id.videoId}`,
      watchUrl: `https://www.youtube.com/watch?v=${item.id.videoId}`,
    }));

    setYTCache(cacheKey, videos, 3600);
    return videos;
  } catch (e) {
    console.error('[YouTube] Search error:', e.message);
    return [];
  }
}

export async function getMatchHighlights(team1, team2, matchType = '') {
  const query = `${team1} vs ${team2} ${matchType} highlights 2025 2026`.trim();
  return searchHighlights(query, 4);
}

export async function getSeriesHighlights(seriesData, maxResults = 8) {
  const info = seriesData?.info || seriesData?.series || seriesData || {};
  const matches = asArray(seriesData?.matchList || seriesData?.matches || seriesData?.matchInfo)
    .filter(isCompletedMatch);

  if (matches.length === 0) {
    return searchHighlights(`${info.name || 'cricket series'} highlights`, maxResults);
  }

  const videos = [];
  for (const match of matches.slice(0, 6)) {
    const query = `${match.name || info.name || 'cricket'} ${match.matchType || ''} ${matchDate(match) ? new Date(matchDate(match)).getFullYear() : '2026'}`.trim();
    const found = await searchHighlights(query, 2);
    videos.push(...found.map(video => ({
      ...video,
      matchId: match.id || match._id || match.matchId || video.matchId,
      matchName: match.name || video.matchName,
      matchDate: matchDate(match) || video.matchDate,
    })));
  }

  const seen = new Set();
  return videos
    .filter(video => {
      const key = video.watchUrl || video.videoId;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxResults);
}

export async function getCricketNewsVideos(topic = 'cricket') {
  const query = `${topic} cricket 2025 2026`;
  return searchHighlights(query, 8);
}

export async function getChannelVideos(channelId, maxResults = 6) {
  const ytKey = getYouTubeKey();
  if (!ytKey) return [];

  const cacheKey = `channel:${channelId}:${maxResults}`;
  const cached = getYTCache(cacheKey);
  if (cached) return cached;

  try {
    const url = new URL(`${YT_BASE}/search`);
    url.searchParams.set('key', ytKey);
    url.searchParams.set('channelId', channelId);
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('maxResults', maxResults);
    url.searchParams.set('order', 'date');

    const res = await fetch(url.toString(), { timeout: 8000 });
    const json = await res.json();

    const videos = (json.items || []).map(item => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      thumbnail: item.snippet.thumbnails.high?.url,
      channelName: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt,
      embedUrl: `https://www.youtube.com/embed/${item.id.videoId}`,
    }));

    setYTCache(cacheKey, videos, 3600);
    return videos;
  } catch (e) {
    console.error('[YouTube] Channel error:', e.message);
    return [];
  }
}

export const getICCHighlights = () => getChannelVideos(CRICKET_CHANNELS.icc, 8);

export const getPCBVideos = () => getChannelVideos(CRICKET_CHANNELS.pcb, 8);
