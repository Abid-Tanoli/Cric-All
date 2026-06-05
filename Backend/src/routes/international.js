import express from 'express';
import {
  getCurrentMatches, getAllSeries, getSeriesInfo,
  getLiveMatches, getRecentMatches, getUpcomingMatches,
  getSeriesPoints, getSeriesSquad, getMatchScorecard,
  getMatchInfo, searchPlayers, getPlayerInfo,
  getHeadToHead, getTeamForm, getTeamSquadById,
  getMatchCenter, getMatchCommentary, getMatchStats,
  getMatchOvers, getMatchPlayingXI, getMatchPhotos,
  getMatchNews, getMatchVideos, getMatchLiveScore
} from '../services/cricketDataService.js';
import {
  getHighlightsByDate as getRapidHighlightsByDate,
  getMatchHighlights as getRapidMatchHighlights,
  getTeamHighlights as getRapidTeamHighlights,
  getRapidApiStatus,
} from '../services/cricketApiService.js';
import { getFreeCricbuzzStatus } from '../services/cricbuzzFreeService.js';
import {
  searchHighlights,
  getMatchHighlights as getYoutubeMatchHighlights,
  getSeriesHighlights,
  getICCHighlights,
  getPCBVideos,
  getCricketNewsVideos
} from '../services/youtubeService.js';
import { getCricketNews } from '../services/rssNewsService.js';
import { generateMatchSummary } from '../services/aiCommentaryService.js';

const router = express.Router();
const asArray = (value) => Array.isArray(value) ? value : [];
const hasItems = (value) => Array.isArray(value) && value.length > 0;

const sanitizeProviderError = (value = '') => {
  const message = String(value || '');
  if (!message) return '';
  if (/quota|too many requests/i.test(message)) {
    return 'Live data quota has been reached for the current provider plan.';
  }
  if (/not subscribed/i.test(message)) {
    return 'The current account is not subscribed to the required live cricket API.';
  }
  if (/payment required/i.test(message)) {
    return 'The live data endpoint requires an active paid plan.';
  }
  if (/endpoint .*does not exist|not found/i.test(message)) {
    return 'The current live provider does not expose this endpoint.';
  }
  return message.replace(/https?:\/\/\S+/g, '').trim();
};

const getInternationalProviderStatus = () => {
  const rawRapid = getRapidApiStatus();
  const rapid = {
    configured: rawRapid.configured,
    blockedUntil: rawRapid.blockedUntil,
    lastError: sanitizeProviderError(rawRapid.lastError),
  };
  const rawFree = getFreeCricbuzzStatus();
  const free = {
    ...rawFree,
    lastError: sanitizeProviderError(rawFree.lastError),
  };
  return {
    configured: Boolean(rapid.configured || free.enabled),
    provider: rapid.configured ? 'primary-live-provider' : (free.enabled ? 'fallback-live-provider' : 'none'),
    lastError: rapid.configured ? rapid.lastError : free.lastError,
    rapid,
    free,
  };
};

router.get('/status', (req, res) => {
  res.json({ success: true, data: getInternationalProviderStatus() });
});

router.get('/live', async (req, res) => {
  const data = await getCurrentMatches();
  res.json({ success: true, data: data || [], matches: data || [], providerStatus: getInternationalProviderStatus() });
});

router.get('/matches', async (req, res) => {
  const data = await getCurrentMatches(req.query.type || 'international');
  res.json({ success: true, data: data || [], matches: data || [], providerStatus: getInternationalProviderStatus() });
});

router.get('/matches/live', async (req, res) => {
  const data = await getLiveMatches(req.query.type || 'international');
  res.json({ success: true, data: data || [], matches: data || [], providerStatus: getInternationalProviderStatus() });
});

router.get('/matches/recent', async (req, res) => {
  const data = await getRecentMatches(req.query.type || 'international');
  res.json({ success: true, data: data || [], matches: data || [], providerStatus: getInternationalProviderStatus() });
});

router.get('/matches/upcoming', async (req, res) => {
  const data = await getUpcomingMatches(req.query.type || 'international');
  res.json({ success: true, data: data || [], matches: data || [], providerStatus: getInternationalProviderStatus() });
});

router.get('/series', async (req, res) => {
  const data = await getAllSeries();
  res.json({ success: true, data: data || [], series: data || [] });
});

router.get('/tournaments', async (req, res) => {
  const data = await getAllSeries();
  res.json({ success: true, data: data || [], tournaments: data || [], series: data || [] });
});

router.get('/series/:id', async (req, res) => {
  const data = await getSeriesInfo(req.params.id);
  res.json({ success: Boolean(data), data, providerStatus: getInternationalProviderStatus() });
});

router.get('/series/:id/points', async (req, res) => {
  const data = await getSeriesPoints(req.params.id);
  res.json({ success: true, data: data || [] });
});

router.get('/series/:id/squad', async (req, res) => {
  const data = await getSeriesSquad(req.params.id);
  res.json({ success: true, data: data || [] });
});

const sendMatchScorecard = async (req, res) => {
  const data = await getMatchScorecard(req.params.id);
  res.json({ success: true, data, match: data?.match || data });
};

router.get('/match/:id', sendMatchScorecard);
router.get('/matches/:id', sendMatchScorecard);

router.get('/match/:id/scorecard', async (req, res) => {
  const data = await getMatchScorecard(req.params.id);
  res.json({ success: true, data });
});

const sendMatchInfo = async (req, res) => {
  const data = await getMatchInfo(req.params.id);
  res.json({ success: true, data, match: data?.match || data });
};

router.get('/match/:id/info', sendMatchInfo);
router.get('/matches/:id/info', sendMatchInfo);

const sendMatchCenter = async (req, res) => {
  const data = await getMatchCenter(req.params.id);
  res.json({ success: true, data: data || null });
};

router.get('/match/:id/center', sendMatchCenter);
router.get('/matches/:id/center', sendMatchCenter);

const sendMatchLiveScore = async (req, res) => {
  const data = await getMatchLiveScore(req.params.id);
  res.json({ success: Boolean(data), data: data || null });
};

router.get('/match/:id/score', sendMatchLiveScore);
router.get('/matches/:id/score', sendMatchLiveScore);

const sendMatchCommentary = async (req, res) => {
  const data = await getMatchCommentary(req.params.id);
  res.json({ success: true, data: data || [] });
};

router.get('/match/:id/commentary', sendMatchCommentary);
router.get('/matches/:id/commentary', sendMatchCommentary);

const sendMatchStats = async (req, res) => {
  const data = await getMatchStats(req.params.id);
  res.json({ success: true, data: data || null });
};

router.get('/match/:id/stats', sendMatchStats);
router.get('/matches/:id/stats', sendMatchStats);

const sendMatchOvers = async (req, res) => {
  const data = await getMatchOvers(req.params.id);
  res.json({ success: true, data: data || [] });
};

router.get('/match/:id/overs', sendMatchOvers);
router.get('/matches/:id/overs', sendMatchOvers);

const sendMatchPlayingXI = async (req, res) => {
  const data = await getMatchPlayingXI(req.params.id);
  res.json({ success: true, data: data || [] });
};

router.get('/match/:id/playing-xi', sendMatchPlayingXI);
router.get('/matches/:id/playing-xi', sendMatchPlayingXI);

const sendMatchPhotos = async (req, res) => {
  const data = await getMatchPhotos(req.params.id);
  res.json({ success: true, data: data || [] });
};

router.get('/match/:id/photos', sendMatchPhotos);
router.get('/matches/:id/photos', sendMatchPhotos);

const sendMatchNews = async (req, res) => {
  const data = await getMatchNews(req.params.id);
  res.json({ success: true, data: data || [] });
};

router.get('/match/:id/news', sendMatchNews);
router.get('/matches/:id/news', sendMatchNews);

const sendMatchVideos = async (req, res) => {
  const data = await getMatchVideos(req.params.id);
  res.json({ success: true, data: data || [] });
};

router.get('/match/:id/videos', sendMatchVideos);
router.get('/matches/:id/videos', sendMatchVideos);

router.get('/match/:id/summary', async (req, res) => {
  const scorecard = await getMatchScorecard(req.params.id);
  if (!scorecard) return res.json({ success: false });
  const summary = await generateMatchSummary(scorecard);
  res.json({ success: true, data: { summary } });
});

router.get('/highlights', async (req, res) => {
  if (req.query.matchId) {
    const rapidVideos = await getRapidMatchHighlights(req.query.matchId);
    if (hasItems(rapidVideos)) return res.json({ success: true, data: rapidVideos });
  }

  if (req.query.team) {
    const rapidVideos = await getRapidTeamHighlights(req.query.team);
    if (hasItems(rapidVideos)) return res.json({ success: true, data: rapidVideos });
    const videos = await searchHighlights(`${req.query.team} cricket highlights`, 6);
    return res.json({ success: true, data: videos });
  }

  if (req.query.date) {
    const rapidVideos = await getRapidHighlightsByDate(req.query.date);
    if (hasItems(rapidVideos)) return res.json({ success: true, data: rapidVideos });
    const videos = await searchHighlights(`cricket highlights ${req.query.date}`, 6);
    return res.json({ success: true, data: videos });
  }

  if (req.query.seriesId) {
    const seriesData = await getSeriesInfo(req.query.seriesId);
    const videos = await getSeriesHighlights(seriesData, 8);
    return res.json({ success: true, data: videos });
  }

  const query = req.query.q || 'cricket highlights';
  const videos = await searchHighlights(`${query} highlights`, 6);
  res.json({ success: true, data: videos });
});

router.get('/highlights/icc', async (req, res) => {
  const videos = await getICCHighlights();
  res.json({ success: true, data: videos });
});

router.get('/highlights/pcb', async (req, res) => {
  const videos = await getPCBVideos();
  res.json({ success: true, data: videos });
});

const sendMatchHighlights = async (req, res) => {
  const { team1 = '', team2 = '', type = '' } = req.query;
  const match = await getMatchInfo(req.params.id);
  const rapidVideos = await getRapidMatchHighlights(req.params.id);
  if (hasItems(rapidVideos)) return res.json({ success: true, data: rapidVideos });
  const videos = team1 || team2
    ? await getYoutubeMatchHighlights(team1, team2, type)
    : await searchHighlights(`${match?.name || 'cricket match'} ${match?.matchType || ''} ${match?.date || ''}`, 4);
  res.json({ success: true, data: videos });
};

router.get('/match/:id/highlights', sendMatchHighlights);
router.get('/matches/:id/highlights', sendMatchHighlights);

router.get('/news', async (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const articles = await getCricketNews(limit);
  res.json({ success: true, data: articles });
});

router.get('/videos', async (req, res) => {
  const topic = req.query.topic || 'cricket Pakistan';
  const videos = await getCricketNewsVideos(topic);
  res.json({ success: true, data: videos });
});

router.get('/players', async (req, res) => {
  const search = req.query.search || req.query.q || '';
  if (!search) return res.json({ success: true, data: [] });
  const data = await searchPlayers(search);
  res.json({ success: true, data: data || [] });
});

router.get('/players/:id', async (req, res) => {
  const data = await getPlayerInfo(req.params.id);
  res.json({ success: true, data });
});

router.get('/teams/:id', async (req, res) => {
  const data = await getTeamSquadById(req.params.id);
  res.json({ success: true, data: asArray(data) });
});

router.get('/teams/:id/form', async (req, res) => {
  const data = await getTeamForm(req.params.id);
  res.json({ success: true, data: data || null });
});

router.get('/h2h', async (req, res) => {
  const data = await getHeadToHead(req.query.home, req.query.away);
  res.json({ success: true, data: data || null });
});

export default router;
