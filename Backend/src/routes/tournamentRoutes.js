import express from 'express';
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

router.get('/', getTournaments);
router.get('/:id', getTournament);
router.get('/:id/points-table', getTournamentPointsTable);
router.get('/:id/fixtures', getTournamentFixtures);
router.get('/:id/squad', getTournamentSquad);
router.get('/:id/squad/:teamId', getTournamentSquad);

router.post('/', createTournament);
router.post('/update-points', updatePointsTable);
router.post('/:tournamentId/squad', setTournamentSquad);
router.post('/:tournamentId/matches', createTournamentMatch);

router.put('/:id', updateTournament);
router.delete('/:id', deleteTournament);
router.delete('/:tournamentId/squad/:teamId', deleteTournamentSquad);

export default router;