import fetch from "node-fetch";

const CACHE_TTL = 30 * 1000;
const cache = new Map();
const EXTERNAL_SOURCE_BASE = (process.env.EXTERNAL_SYNC_BASE_URL || '').replace(/\/+$/, '');

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

async function fetchPage(url) {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    timeout: 15000,
  });
  const text = await res.text();
  cache.set(url, { data: text, ts: Date.now() });
  return text;
}

function sourceUrl(path) {
  if (!EXTERNAL_SOURCE_BASE) return '';
  return `${EXTERNAL_SOURCE_BASE}${path}`;
}

function extractNextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*type="application\/json"[^>]*>({.*?})<\/script>/s);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch { return null; }
}

function extractPageProps(html) {
  const json = extractNextData(html);
  return json?.props?.pageProps?.data || json?.props?.pageProps || null;
}

export async function getSeriesInfo(seriesSlug, seriesId) {
  const url = sourceUrl(`/series/${seriesSlug}-${seriesId}`);
  if (!url) return null;
  const html = await fetchPage(url);
  const data = extractPageProps(html);
  if (!data) return null;
  return {
    espnId: seriesId,
    slug: data.series?.slug || seriesSlug,
    name: data.series?.name || "",
    longName: data.series?.longName || "",
    shortName: data.series?.alternateName || "",
    season: data.series?.season || "",
    startDate: data.series?.startDate || null,
    endDate: data.series?.endDate || null,
    matchType: seriesId >= 1000000 ? "ODI" : "T20",
    status: new Date(data.series?.startDate) > new Date() ? "upcoming" : "live",
    teams: (data.teams || []).map(t => ({
      espnId: t.team?.id || t.team?.objectId,
      name: t.team?.name || "",
      shortName: t.team?.abbreviation || "",
      longName: t.team?.longName || "",
      logo: t.team?.imageUrl ? `https://img1.hscicdn.com${t.team.imageUrl}` : "",
      isCountry: t.team?.isCountry || false,
    })),
    fixtures: (data.recentFixtures || []).map(m => normalizeMatch(m)),
    results: (data.recentResults || []).map(m => normalizeMatch(m)),
    standings: data.standings || null,
  };
}

export async function getMatchScorecard(seriesSlug, seriesId, matchSlug, matchId) {
  const url = sourceUrl(`/series/${seriesSlug}-${seriesId}/${matchSlug}-${matchId}/full-scorecard`);
  if (!url) return null;
  const html = await fetchPage(url);
  const data = extractPageProps(html);
  if (!data) return null;
  const match = data.match || data;
  return {
    espnId: matchId,
    slug: matchSlug,
    title: match.title || "",
    status: normalizeStatus(match.status || match.statusText || ""),
    statusText: match.statusText || "",
    startDate: match.startDate || match.startTime || null,
    venue: match.ground?.name || "",
    venueLocation: match.ground?.town?.name || "",
    format: match.format || "T20",
    series: {
      name: match.series?.name || "",
      slug: match.series?.slug || "",
    },
    teams: (match.teams || []).map(t => ({
      espnId: t.team?.id || t.team?.objectId,
      name: t.team?.name || "",
      shortName: t.team?.abbreviation || "",
      logo: t.team?.imageUrl ? `https://img1.hscicdn.com${t.team.imageUrl}` : "",
      score: t.score || null,
      scoreInfo: t.scoreInfo || null,
      isHome: t.isHome || false,
    })),
    tossWinner: match.tossWinnerTeamId || null,
    tossDecision: match.tossWinnerChoice || null,
    winnerTeamId: match.winnerTeamId || null,
    result: match.statusText || "",
    manOfMatch: data.mostValuedPlayerOfTheMatch || data.playersOfTheMatch?.[0] || null,
    innings: extractInnings(data),
    commentary: extractCommentary(data),
  };
}

export async function getLiveMatches() {
  const url = sourceUrl("/live-cricket-score");
  if (!url) return [];
  const html = await fetchPage(url);
  const data = extractPageProps(html);
  if (!data) return [];
  const allMatches = [];
  const pages = data.pageData?.liveMatchCards || data.liveMatchCards || [];
  pages.forEach(page => {
    (page.matches || []).forEach(m => {
      allMatches.push(normalizeMatch(m));
    });
  });
  return allMatches;
}

export async function getSeriesList() {
  const url = sourceUrl("/cricket-fixtures");
  if (!url) return [];
  const html = await fetchPage(url);
  const data = extractPageProps(html);
  if (!data) return [];
  const seriesList = [];
  (data.seriesList || []).forEach(group => {
    (group.items || []).forEach(item => {
      if (item.series) {
        seriesList.push({
          espnId: item.series.objectId || item.series.id,
          slug: item.series.slug,
          name: item.series.name,
          longName: item.series.longName,
          shortName: item.series.alternateName,
          season: item.series.season,
          startDate: item.series.startDate,
          endDate: item.series.endDate,
        });
      }
    });
  });
  return seriesList;
}

function normalizeMatch(m) {
  return {
    espnId: m.objectId || m.id,
    slug: m.slug || "",
    title: m.title || "",
    stage: m.stage || "",
    state: m.state || "",
    startDate: m.startDate || m.startTime || null,
    startTime: m.startTime || null,
    venue: m.ground?.name || "",
    venueLocation: m.ground?.town?.name || "",
    format: m.format || "T20",
    status: normalizeStatus(m.status || m.statusText || ""),
    statusText: m.statusText || "",
    winnerTeamId: m.winnerTeamId || null,
    tossWinner: m.tossWinnerTeamId || null,
    tossDecision: m.tossWinnerChoice || null,
    teams: (m.teams || []).map(t => ({
      espnId: t.team?.id || t.team?.objectId,
      name: t.team?.name || "",
      shortName: t.team?.abbreviation || "",
      longName: t.team?.longName || "",
      logo: t.team?.imageUrl ? `https://img1.hscicdn.com${t.team.imageUrl}` : "",
      score: t.score || null,
      scoreInfo: t.scoreInfo || null,
      innings: t.inningNumbers || [],
      points: t.points || null,
    })),
    series: m.series ? {
      espnId: m.series.objectId || m.series.id,
      slug: m.series.slug,
      name: m.series.name,
      shortName: m.series.alternateName,
    } : null,
  };
}

function normalizeStatus(status) {
  const s = (status || "").toLowerCase();
  if (s.includes("live") || s === "in_progress") return "live";
  if (s.includes("result") || s === "complete" || s === "completed") return "completed";
  if (s.includes("abandon") || s.includes("postpon") || s.includes("cancel")) return "abandoned";
  return "upcoming";
}

function extractInnings(data) {
  const innings = [];
  const matchData = data.match || data;
  const scorecard = matchData.scorecard || matchData.innings || [];
  (scorecard || []).forEach((inn, idx) => {
    innings.push({
      inningsNumber: idx + 1,
      battingTeam: inn.batTeamName || inn.team?.name || "",
      runs: inn.runs || 0,
      wickets: inn.wickets || 0,
      overs: inn.overs || 0,
      batting: (inn.batting || []).map(b => ({
        name: b.batterName || b.name || "",
        runs: b.runs || 0,
        balls: b.balls || 0,
        fours: b.fours || 0,
        sixes: b.sixes || 0,
        strikeRate: b.strikeRate || 0,
        howOut: b.howOut || b.dismissal || "",
        isOut: b.howOut !== "not out" && b.howOut !== "batting" && !!b.howOut,
      })),
      bowling: (inn.bowling || []).map(b => ({
        name: b.bowlerName || b.name || "",
        overs: b.overs || 0,
        maidens: b.maidens || 0,
        runs: b.runs || 0,
        wickets: b.wickets || 0,
        economy: b.economy || 0,
        wides: b.wides || 0,
        noBalls: b.noBalls || 0,
      })),
      fallOfWickets: (inn.fallOfWickets || []).map(f => ({
        score: f.score || "",
        overs: f.overs || 0,
        playerName: f.playerName || "",
      })),
    });
  });
  return innings;
}

function extractCommentary(data) {
  const matchData = data.match || data;
  const commentary = matchData.commentary || matchData.liveBlogStory || null;
  if (!commentary) return null;
  return {
    title: commentary.title || "",
    summary: commentary.summary || "",
    content: commentary.overviewHtml || "",
    byline: commentary.byline || "",
    publishedAt: commentary.publishedAt || null,
  };
}

export function clearCache() { cache.clear(); }
