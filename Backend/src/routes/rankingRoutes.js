import express from 'express';
import { protect, optionalProtect, requireAdmin } from '../middleware/authMiddleware.js';
import validateObjectId from '../middleware/validateObjectId.js';
import {
  getOverallRankings,
  getCategoryRankings,
  getCrossCategoryRankings,
  getTeamPlayerRankings,
  recomputeRankings,
  recomputeTeamRanking,
} from '../controllers/rankingController.js';

const router = express.Router();
const adminOnly = [protect, requireAdmin];

router.get('/overall', getOverallRankings);
router.get('/category/:categoryId', validateObjectId('categoryId'), getCategoryRankings);
router.get('/cross-category', getCrossCategoryRankings);
// Task 4: the generic player leaderboard lives at `GET /players/rankings/*`
// (rankingsController). The old duplicate `/rankings-v2/players` board was
// retired so there is a single player-ranking implementation.
// Round 5: `players/team/:teamId` embeds each player, so it identifies the
// caller when it can. `optionalProtect` never rejects.
router.get('/players/team/:teamId', optionalProtect, validateObjectId('teamId'), getTeamPlayerRankings);
router.post('/recompute', ...adminOnly, recomputeRankings);
router.post('/recompute/:teamId', ...adminOnly, validateObjectId('teamId'), recomputeTeamRanking);

export default router;
