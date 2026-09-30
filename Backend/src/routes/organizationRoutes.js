import express from 'express';
import { protect, requireVerifiedEmail } from '../middleware/authMiddleware.js';
import {
  requireAnyOrgPermission,
  requireOrgAdminType,
  requireOrgMembership,
  requireOrgOwner,
  requireOrgPermission,
} from '../middleware/orgAccess.js';
import { PERMISSIONS } from '../permissions/orgPermissions.js';
import validateObjectId from '../middleware/validateObjectId.js';
import validate from '../middleware/validate.js';
import {
  createOrganizationSchema,
  updateOrganizationSchema,
  addMemberSchema,
  updateMemberSchema,
  createInvitationSchema,
} from '../validators/orgValidators.js';
import {
  createOrgTeamSchema,
  orgTeamPlayerRoleSchema,
  orgTeamPlayersSchema,
  updateOrgTeamSchema,
} from '../validators/teamValidators.js';
import {
  createOrgMatchSchema,
  createOrgEventSchema,
  setOrgMatchSquadsSchema,
  updateOrgEventSchema,
  updateOrgMatchSchema,
} from '../validators/matchValidators.js';
import {
  listOrganizations,
  getOrganization,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  getOrganizationTeams,
  getOrganizationTree,
  getRootOrganizations,
  getOrganizationChildren,
  getOrganizationChain,
  getMyOrganizations,
} from '../controllers/organizationController.js';
import {
  addOrgTeamPlayers,
  createOrgTeam,
  deleteOrgTeam,
  listOrgTeams,
  removeOrgTeamPlayers,
  updateOrgTeam,
  updateOrgTeamPlayerRole,
} from '../controllers/orgTeamsController.js';
import {
  createOrgEvent,
  createOrgMatch,
  deleteOrgEvent,
  deleteOrgMatch,
  listOrgEvents,
  listOrgMatches,
  setOrgMatchSquads,
  updateOrgEvent,
  updateOrgMatch,
} from '../controllers/orgMatchesController.js';
import {
  addOrgMember,
  getMyOrgAccess,
  getOrgOverview,
  listOrgAuditLog,
  listOrgInvitations,
  listOrgMembers,
  createOrgInvitation,
  removeOrgMember,
  revokeOrgInvitation,
  transferOwnership,
  updateOrgMemberRoles,
} from '../controllers/membershipController.js';

const router = express.Router();
// Self-service: verified platform admins OR verified User accounts. Which one
// may act is decided per-organization by requireOrgPermission.
const manage = [protect, requireVerifiedEmail];

// NOTE: /my must be registered before /:id, otherwise "my" matches the
// ObjectId parameter route and gets rejected by validateObjectId.
router.get('/my', ...manage, getMyOrganizations);
router.get('/', listOrganizations);
router.get('/tree', getOrganizationTree);
router.get('/roots', getRootOrganizations);

router.post('/', ...manage, requireOrgAdminType, validate(createOrganizationSchema), createOrganization);
router.put('/:id', ...manage, validateObjectId('id'), requireOrgPermission(PERMISSIONS.MANAGE_ORG), validate(updateOrganizationSchema), updateOrganization);
router.delete('/:id', ...manage, validateObjectId('id'), requireOrgPermission(PERMISSIONS.MANAGE_ORG), deleteOrganization);

router.get('/:id', validateObjectId('id'), getOrganization);
router.get('/:id/children', validateObjectId('id'), getOrganizationChildren);
router.get('/:id/chain', validateObjectId('id'), getOrganizationChain);
router.get('/:id/teams', validateObjectId('id'), getOrganizationTeams);

// --- members -----------------------------------------------------------------
// Read: any active member. Write: manage_members (or invite_members to add).
router.get('/:id/members', ...manage, validateObjectId('id'), requireOrgMembership, listOrgMembers);
router.post('/:id/members', ...manage, validateObjectId('id'), requireOrgPermission(PERMISSIONS.INVITE_MEMBERS), validate(addMemberSchema), addOrgMember);
router.patch('/:id/members/:userId', ...manage, validateObjectId('id'), validateObjectId('userId'), requireOrgPermission(PERMISSIONS.MANAGE_MEMBERS), validate(updateMemberSchema), updateOrgMemberRoles);
router.delete('/:id/members/:userId', ...manage, validateObjectId('id'), validateObjectId('userId'), requireOrgPermission(PERMISSIONS.MANAGE_MEMBERS), removeOrgMember);

// Ownership transfer is a distinct, owner-only operation: it can neither be
// self-granted nor handed out by invitation.
router.post('/:id/members/:userId/owner', ...manage, validateObjectId('id'), validateObjectId('userId'), requireOrgOwner, transferOwnership);

// --- invitations -------------------------------------------------------------
router.get('/:id/invitations', ...manage, validateObjectId('id'), requireOrgPermission(PERMISSIONS.INVITE_MEMBERS), listOrgInvitations);
router.post('/:id/invitations', ...manage, validateObjectId('id'), requireOrgPermission(PERMISSIONS.INVITE_MEMBERS), validate(createInvitationSchema), createOrgInvitation);
router.delete('/:id/invitations/:invitationId', ...manage, validateObjectId('id'), requireOrgPermission(PERMISSIONS.INVITE_MEMBERS), validateObjectId('invitationId'), revokeOrgInvitation);

// --- teams owned by this organization (Phase 4) ------------------------------
// GET /:id/teams above stays public (organization profile pages read it); the
// write endpoints below are member-gated, and the controller scopes every team
// lookup to this organization so another org's team is a 404, never a hit.
// Reading the org's own team list is a prerequisite of two different jobs: the
// Teams tab (manage_teams) and the fixture form, which needs team names and
// rosters to pick two sides and name a XI (create_match). Today every role that
// holds create_match also holds manage_teams, so either is accepted for
// symmetry; the point is that a future fixture-only role does not 403 on a
// screen it is otherwise allowed to open. Writes below still require
// manage_teams, and requireOrgPermission is unchanged for every other route.
const teamRead = [
  ...manage,
  validateObjectId('id'),
  requireAnyOrgPermission(PERMISSIONS.MANAGE_TEAMS, PERMISSIONS.CREATE_MATCH),
];
const teamWrite = [
  ...manage,
  validateObjectId('id'),
  requireOrgPermission(PERMISSIONS.MANAGE_TEAMS),
];
const squadWrite = [
  ...manage,
  validateObjectId('id'),
  validateObjectId('teamId'),
  requireOrgPermission(PERMISSIONS.MANAGE_PLAYERS),
];

router.get('/:id/teams/manage', ...teamRead, listOrgTeams);
router.post('/:id/teams', ...teamWrite, validate(createOrgTeamSchema), createOrgTeam);
router.patch('/:id/teams/:teamId', ...teamWrite, validateObjectId('teamId'), validate(updateOrgTeamSchema), updateOrgTeam);
router.delete('/:id/teams/:teamId', ...teamWrite, validateObjectId('teamId'), deleteOrgTeam);

router.post('/:id/teams/:teamId/players', ...squadWrite, validate(orgTeamPlayersSchema), addOrgTeamPlayers);
router.delete('/:id/teams/:teamId/players', ...squadWrite, validate(orgTeamPlayersSchema), removeOrgTeamPlayers);
router.put(
  '/:id/teams/:teamId/players/:playerId',
  ...squadWrite,
  validateObjectId('playerId'),
  validate(orgTeamPlayerRoleSchema),
  updateOrgTeamPlayerRole
);

// --- matches and events this organization runs (Phase 6) --------------------
// Reading needs membership; scheduling needs create_match. Writing a ball or a
// result needs score_match and is served by the match routes in matchRoutes.js
// through requireMatchScoreAccess, which resolves the tenant from
// Match.organizationRef — so an organization can schedule, score and call off
// its own fixture without going through the platform Admin app.
const orgScoped = [...manage, validateObjectId('id')];
const matchRead = [...orgScoped, requireOrgMembership];
const matchWrite = [...orgScoped, validateObjectId('matchId'), requireOrgPermission(PERMISSIONS.CREATE_MATCH)];
const eventWrite = [...orgScoped, validateObjectId('eventId'), requireOrgPermission(PERMISSIONS.CREATE_MATCH)];

router.get('/:id/matches', ...matchRead, listOrgMatches);
router.post('/:id/matches', ...orgScoped, requireOrgPermission(PERMISSIONS.CREATE_MATCH), validate(createOrgMatchSchema), createOrgMatch);
router.patch('/:id/matches/:matchId', ...matchWrite, validate(updateOrgMatchSchema), updateOrgMatch);
router.delete('/:id/matches/:matchId', ...matchWrite, deleteOrgMatch);
router.put('/:id/matches/:matchId/squads', ...matchWrite, validate(setOrgMatchSquadsSchema), setOrgMatchSquads);

router.get('/:id/events', ...matchRead, listOrgEvents);
router.post('/:id/events', ...orgScoped, requireOrgPermission(PERMISSIONS.CREATE_MATCH), validate(createOrgEventSchema), createOrgEvent);
router.patch('/:id/events/:eventId', ...eventWrite, validate(updateOrgEventSchema), updateOrgEvent);
router.delete('/:id/events/:eventId', ...eventWrite, deleteOrgEvent);

// --- dashboard support -------------------------------------------------------
router.get('/:id/access', ...manage, validateObjectId('id'), getMyOrgAccess);
router.get('/:id/overview', ...manage, validateObjectId('id'), requireOrgMembership, getOrgOverview);
router.get('/:id/audit-log', ...manage, validateObjectId('id'), requireOrgPermission(PERMISSIONS.MANAGE_ORG), listOrgAuditLog);

export default router;
