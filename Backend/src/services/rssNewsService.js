import fetch from 'node-fetch';
import { parseStringPromise } from 'xml2js';

const RSS_FEEDS = (() => {
  try {
    return JSON.parse(process.env.CRICKET_NEWS_FEEDS || '[]');
  } catch {
    return [];
  }
})();

const newsCache = { data: [], expires: 0 };
let rssOfflineLogged = false;

const FALLBACK_NEWS = [
  {
    title: 'International cricket updates are temporarily offline',
    description: 'External RSS feeds could not be reached from this machine. Live scores and local BQ-PLAY content still work.',
    link: '',
    pubDate: new Date().toISOString(),
    image: null,
    source: 'BQ-PLAY',
    sourceLogo: null,
  },
  {
    title: 'Add network access to enable cricket news feeds',
    description: 'External cricket news feeds are optional. They will load automatically when DNS/internet access is available.',
    link: '',
    pubDate: new Date().toISOString(),
    image: null,
    source: 'BQ-PLAY',
    sourceLogo: null,
  },
];

export async function getCricketNews(limit = 20) {
  if (Date.now() < newsCache.expires && newsCache.data.length > 0) {
    return newsCache.data.slice(0, limit);
  }

  const allArticles = [];
  let failedFeeds = 0;

  for (const feed of RSS_FEEDS) {
    try {
      const res = await fetch(feed.url, {
        timeout: 8000,
        headers: { 'User-Agent': 'BQ-Play Cricket App/1.0' }
      });
      const text = await res.text();
      const parsed = await parseStringPromise(text, { explicitArray: false });
      const items = parsed?.rss?.channel?.item || [];
      const itemsArray = Array.isArray(items) ? items : [items];

      const articles = itemsArray.slice(0, 10).map(item => ({
        title: item.title || '',
        description: stripHtml(item.description || '').slice(0, 200),
        link: item.link || '',
        pubDate: item.pubDate || '',
        image: extractImage(item) || null,
        source: feed.name,
        sourceLogo: feed.logo,
      }));

      allArticles.push(...articles);
    } catch (e) {
      failedFeeds++;
    }
  }

  if (allArticles.length === 0) {
    if (failedFeeds > 0 && !rssOfflineLogged) {
      console.warn('[RSS] External cricket news feeds unavailable - using fallback news');
      rssOfflineLogged = true;
    }
    newsCache.data = FALLBACK_NEWS;
    newsCache.expires = Date.now() + 15 * 60 * 1000;
    return newsCache.data.slice(0, limit);
  }

  allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  newsCache.data = allArticles;
  newsCache.expires = Date.now() + 15 * 60 * 1000;

  return allArticles.slice(0, limit);
}

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

function extractImage(item) {
  try {
    if (item['media:content']?.['$']?.url) return item['media:content']['$'].url;
    if (item['media:thumbnail']?.['$']?.url) return item['media:thumbnail']['$'].url;
    const imgMatch = item.description?.match(/<img[^>]+src="([^"]+)"/);
    if (imgMatch) return imgMatch[1];
  } catch (e) {}
  return null;
}
