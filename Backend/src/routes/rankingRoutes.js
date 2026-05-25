import express from 'express';
import {
  getOverallRankings,
  getCategoryRankings,
  getCrossCategoryRankings,
  getTeamPlayerRankings,
  getPlayerRankings,
  recomputeRankings,
  recomputeTeamRanking,
} from '../controllers/rankingController.js';

const router = express.Router();

router.get('/overall', getOverallRankings);
router.get('/category/:categoryId', getCategoryRankings);
router.get('/cross-category', getCrossCategoryRankings);
router.get('/players', getPlayerRankings);
router.get('/players/team/:teamId', getTeamPlayerRankings);
router.post('/recompute', recomputeRankings);
router.post('/recompute/:teamId', recomputeTeamRanking);

export default router;
