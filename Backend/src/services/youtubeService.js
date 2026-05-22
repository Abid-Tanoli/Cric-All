import fetch from 'node-fetch';

const YT_KEY = process.env.YOUTUBE_API_KEY;
const YT_BASE = 'https://www.googleapis.com/youtube/v3';

const CRICKET_CHANNELS = {
  icc: 'UCiWrjBhlICf_L_RK5y6Vrxw',
  pcb: 'UCiTDCIBE_1dMH-8VJvqdSTw',
  bcci: 'UC-G7KNFbOq-nUjgaGGwFRkA',
  espncricinfo: 'UC_1Vwh8cF0B9a8YGbAD_rMQ',
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

export async function searchHighlights(query, maxResults = 6) {
  if (!YT_KEY) return [];

  const cacheKey = `highlights:${query}:${maxResults}`;
  const cached = getYTCache(cacheKey);
  if (cached) return cached;

  try {
    const url = new URL(`${YT_BASE}/search`);
    url.searchParams.set('key', YT_KEY);
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

export async function getCricketNewsVideos(topic = 'cricket') {
  const query = `${topic} cricket 2025 2026`;
  return searchHighlights(query, 8);
}

export async function getChannelVideos(channelId, maxResults = 6) {
  if (!YT_KEY) return [];

  const cacheKey = `channel:${channelId}:${maxResults}`;
  const cached = getYTCache(cacheKey);
  if (cached) return cached;

  try {
    const url = new URL(`${YT_BASE}/search`);
    url.searchParams.set('key', YT_KEY);
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
