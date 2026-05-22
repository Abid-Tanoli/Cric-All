import express from 'express';
import {
  getCurrentMatches, getAllSeries, getSeriesInfo,
  getSeriesPoints, getSeriesSquad, getMatchScorecard,
  getMatchInfo, searchPlayers, getPlayerInfo
} from '../services/cricketDataService.js';
import { searchHighlights, getMatchHighlights, getICCHighlights, getPCBVideos, getCricketNewsVideos } from '../services/youtubeService.js';
import { getCricketNews } from '../services/rssNewsService.js';
import { generateMatchSummary } from '../services/aiCommentaryService.js';

const router = express.Router();

router.get('/live', async (req, res) => {
  const data = await getCurrentMatches();
  res.json({ success: true, data: data || [] });
});

router.get('/series', async (req, res) => {
  const data = await getAllSeries();
  res.json({ success: true, data: data || [] });
});

router.get('/series/:id', async (req, res) => {
  const data = await getSeriesInfo(req.params.id);
  res.json({ success: true, data });
});

router.get('/series/:id/points', async (req, res) => {
  const data = await getSeriesPoints(req.params.id);
  res.json({ success: true, data: data || [] });
});

router.get('/series/:id/squad', async (req, res) => {
  const data = await getSeriesSquad(req.params.id);
  res.json({ success: true, data: data || [] });
});

router.get('/match/:id/scorecard', async (req, res) => {
  const data = await getMatchScorecard(req.params.id);
  res.json({ success: true, data });
});

router.get('/match/:id/info', async (req, res) => {
  const data = await getMatchInfo(req.params.id);
  res.json({ success: true, data });
});

router.get('/match/:id/summary', async (req, res) => {
  const scorecard = await getMatchScorecard(req.params.id);
  if (!scorecard) return res.json({ success: false });
  const summary = await generateMatchSummary(scorecard);
  res.json({ success: true, data: { summary } });
});

router.get('/highlights', async (req, res) => {
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

router.get('/match/:id/highlights', async (req, res) => {
  const { team1 = '', team2 = '', type = '' } = req.query;
  const videos = await getMatchHighlights(team1, team2, type);
  res.json({ success: true, data: videos });
});

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
  const { search } = req.query;
  if (!search) return res.json({ success: true, data: [] });
  const data = await searchPlayers(search);
  res.json({ success: true, data: data || [] });
});

router.get('/players/:id', async (req, res) => {
  const data = await getPlayerInfo(req.params.id);
  res.json({ success: true, data });
});

export default router;
