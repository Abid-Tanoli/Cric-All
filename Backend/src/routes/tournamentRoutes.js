import express from 'express';
import { protect, requireAdmin, requireVerifiedEmail } from '../middleware/authMiddleware.js';
import validateObjectId from '../middleware/validateObjectId.js';
import {
  getTournaments,
  getTournament,
  createTournament,
  updateTournament,
  deleteTournament,
  getTournamentPointsTable,
  updatePointsTable,
  getTournamentFixtures,
  setTournamentSquad,
  getTournamentSquad,
  deleteTournamentSquad,
  createTournamentMatch
} from '../controllers/TournamentController.js';

const router = express.Router();
const adminOnly = [protect, requireAdmin, requireVerifiedEmail];

router.get('/', getTournaments);
router.get('/:id', validateObjectId('id'), getTournament);
router.get('/:id/points-table', validateObjectId('id'), getTournamentPointsTable);
router.get('/:id/fixtures', validateObjectId('id'), getTournamentFixtures);
router.get('/:id/squad', validateObjectId('id'), getTournamentSquad);
router.get('/:id/squad/:teamId', validateObjectId('id'), validateObjectId('teamId'), getTournamentSquad);

router.post('/', ...adminOnly, createTournament);
router.post('/update-points', ...adminOnly, updatePointsTable);
router.post('/:tournamentId/squad', ...adminOnly, validateObjectId('tournamentId'), setTournamentSquad);
router.post('/:tournamentId/matches', ...adminOnly, validateObjectId('tournamentId'), createTournamentMatch);

router.put('/:id', ...adminOnly, validateObjectId('id'), updateTournament);
router.delete('/:id', ...adminOnly, validateObjectId('id'), deleteTournament);
router.delete('/:tournamentId/squad/:teamId', ...adminOnly, validateObjectId('tournamentId'), validateObjectId('teamId'), deleteTournamentSquad);

export default router;
