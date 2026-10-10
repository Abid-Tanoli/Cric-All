import express from 'express';
import { protect, requireAdmin, requireVerifiedEmail } from '../middleware/authMiddleware.js';
import { requireTournamentOwnerOrAdmin } from '../middleware/tournamentOwner.js';
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
  createTournamentMatch,
  setTournamentGroups,
  previewTournamentFixtures,
  applyTournamentFixtures
} from '../controllers/TournamentController.js';

const router = express.Router();
const adminOnly = [protect, requireAdmin, requireVerifiedEmail];
const ownerOrAdmin = [...adminOnly, requireTournamentOwnerOrAdmin];

router.get('/', getTournaments);
router.get('/:id', validateObjectId('id'), getTournament);
router.get('/:id/points-table', validateObjectId('id'), getTournamentPointsTable);
router.get('/:id/fixtures', validateObjectId('id'), getTournamentFixtures);
router.get('/:id/squad', validateObjectId('id'), getTournamentSquad);
router.get('/:id/squad/:teamId', validateObjectId('id'), validateObjectId('teamId'), getTournamentSquad);

router.post('/', ...adminOnly, createTournament);
router.post('/update-points', ...ownerOrAdmin, updatePointsTable);
router.post('/:id/fixtures/preview', ...adminOnly, validateObjectId('id'), previewTournamentFixtures);
router.post('/:tournamentId/squad', ...ownerOrAdmin, validateObjectId('tournamentId'), setTournamentSquad);
router.post('/:tournamentId/matches', ...ownerOrAdmin, validateObjectId('tournamentId'), createTournamentMatch);
router.post('/:id/groups', ...ownerOrAdmin, validateObjectId('id'), setTournamentGroups);
router.post('/:id/fixtures/apply', ...ownerOrAdmin, validateObjectId('id'), applyTournamentFixtures);

router.put('/:id', ...ownerOrAdmin, validateObjectId('id'), updateTournament);
router.delete('/:id', ...ownerOrAdmin, validateObjectId('id'), deleteTournament);
router.delete('/:tournamentId/squad/:teamId', ...ownerOrAdmin, validateObjectId('tournamentId'), validateObjectId('teamId'), deleteTournamentSquad);

export default router;
