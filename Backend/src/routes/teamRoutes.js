import express from 'express';
import { protect, optionalProtect, requireAdmin, requireVerifiedEmail } from '../middleware/authMiddleware.js';
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
  toggleTeamVisibility,
} from '../controllers/teamsController.js';

const router = express.Router();
const adminOnly = [protect, requireAdmin, requireVerifiedEmail];

// Round 5: the reads below are public, but their response shape is now
// viewer-dependent (a platform admin sees organization-owned teams and full
// documents; a manager of the owning organization sees their team in full).
// `optionalProtect` identifies the caller when a token is present and never
// rejects an anonymous request.
router.get('/', optionalProtect, listTeams);
router.get('/:id', optionalProtect, validateObjectId('id'), getTeam);
router.post('/', ...adminOnly, createTeam);
router.put('/:id', ...adminOnly, validateObjectId('id'), updateTeam);
router.put('/:id/location', ...adminOnly, validateObjectId('id'), updateTeamLocation);
router.delete('/:id', ...adminOnly, validateObjectId('id'), deleteTeam);

router.get('/:id/players', optionalProtect, validateObjectId('id'), getTeamPlayers);
router.post('/:id/players', ...adminOnly, validateObjectId('id'), addPlayersToTeam);
router.delete('/:id/players', ...adminOnly, validateObjectId('id'), removePlayersFromTeam);
router.put('/:id/players/:playerId', ...adminOnly, validateObjectId('id'), validateObjectId('playerId'), updatePlayerRoleInTeam);

router.patch('/:id/visibility', protect, requireVerifiedEmail, validateObjectId('id'), toggleTeamVisibility);
router.get('/:id/ranking', optionalProtect, validateObjectId('id'), getTeamRanking);
router.get('/:id/matches', optionalProtect, validateObjectId('id'), getTeamMatches);

export default router;
