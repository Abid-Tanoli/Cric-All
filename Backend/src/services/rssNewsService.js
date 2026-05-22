import fetch from 'node-fetch';
import { parseStringPromise } from 'xml2js';

const RSS_FEEDS = [
  {
    name: 'ESPNcricinfo',
    url: 'https://www.espncricinfo.com/rss/content/story/feeds/0.xml',
    logo: 'https://www.espncricinfo.com/favicon.ico'
  },
  {
    name: 'ESPNcricinfo Pakistan',
    url: 'https://www.espncricinfo.com/rss/content/story/feeds/6.xml',
    logo: 'https://www.espncricinfo.com/favicon.ico'
  },
  {
    name: 'CricBuzz',
    url: 'https://www.cricbuzz.com/rss-feeds/cricket-news',
    logo: 'https://www.cricbuzz.com/favicon.ico'
  },
  {
    name: 'Cricket365',
    url: 'https://www.cricket365.com/feed/',
    logo: 'https://www.cricket365.com/favicon.ico'
  },
];

const newsCache = { data: [], expires: 0 };

export async function getCricketNews(limit = 20) {
  if (Date.now() < newsCache.expires && newsCache.data.length > 0) {
    return newsCache.data.slice(0, limit);
  }

  const allArticles = [];

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
      console.warn(`[RSS] Failed to fetch ${feed.name}:`, e.message);
    }
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
