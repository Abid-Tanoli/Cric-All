import express from 'express';
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

router.get('/', listTeams);
router.get('/:id', getTeam);
router.post('/', createTeam);
router.put('/:id', updateTeam);
router.put('/:id/location', updateTeamLocation);
router.delete('/:id', deleteTeam);

router.get('/:id/players', getTeamPlayers);
router.post('/:id/players', addPlayersToTeam);
router.delete('/:id/players', removePlayersFromTeam);
router.put('/:id/players/:playerId', updatePlayerRoleInTeam);

router.get('/:id/ranking', getTeamRanking);
router.get('/:id/matches', getTeamMatches);

export default router;
