import express from 'express';
import { protect, requireAdmin, requireVerifiedEmail } from '../middleware/authMiddleware.js';
import validateObjectId from '../middleware/validateObjectId.js';
import {
  listTeams,
  getTeam,
  createTeam,
  updateTeam,
  updateTeamLocation,
  deleteTeam,
  addPlayersToTeam,
  removePlayersFromTeam,
  updatePlayerRoleInTeam,
  getTeamPlayers,
  getTeamRanking,
  getTeamMatches,
} from '../controllers/teamsController.js';

const router = express.Router();
const adminOnly = [protect, requireAdmin, requireVerifiedEmail];

router.get('/', listTeams);
router.get('/:id', validateObjectId('id'), getTeam);
router.post('/', ...adminOnly, createTeam);
router.put('/:id', ...adminOnly, validateObjectId('id'), updateTeam);
router.put('/:id/location', ...adminOnly, validateObjectId('id'), updateTeamLocation);
router.delete('/:id', ...adminOnly, validateObjectId('id'), deleteTeam);

router.get('/:id/players', validateObjectId('id'), getTeamPlayers);
router.post('/:id/players', ...adminOnly, validateObjectId('id'), addPlayersToTeam);
router.delete('/:id/players', ...adminOnly, validateObjectId('id'), removePlayersFromTeam);
router.put('/:id/players/:playerId', ...adminOnly, validateObjectId('id'), validateObjectId('playerId'), updatePlayerRoleInTeam);

router.get('/:id/ranking', validateObjectId('id'), getTeamRanking);
router.get('/:id/matches', validateObjectId('id'), getTeamMatches);

export default router;
