// Every organization call the User app makes, in one place.
//
// Wrapping the endpoints here keeps the API paths in a single file, and — more
// importantly — keeps the "what the response looks like" knowledge in one place
// instead of being rediscovered in every tab component.

import { api } from "./api";

const unwrap = (promise) => promise.then((res) => res.data);

export const listMyOrganizations = () => unwrap(api.get("/organizations/my"));

export const getOrganization = (orgId) => unwrap(api.get(`/organizations/${orgId}`));

export const getOrganizationTeams = (orgId) => unwrap(api.get(`/organizations/${orgId}/teams`));

export const createOrganization = (payload) => unwrap(api.post("/organizations", payload));

export const updateOrganization = (orgId, payload) => unwrap(api.put(`/organizations/${orgId}`, payload));

export const deleteOrganization = (orgId) => unwrap(api.delete(`/organizations/${orgId}`));

// --- dashboard support -------------------------------------------------------
export const getMyOrgAccess = (orgId) => unwrap(api.get(`/organizations/${orgId}/access`));

export const getOrgOverview = (orgId) => unwrap(api.get(`/organizations/${orgId}/overview`));

export const listOrgAuditLog = (orgId, params = {}) =>
  unwrap(api.get(`/organizations/${orgId}/audit-log`, { params }));

// --- members -----------------------------------------------------------------
export const listOrgMembers = (orgId, params = {}) =>
  unwrap(api.get(`/organizations/${orgId}/members`, { params }));

export const addOrgMember = (orgId, { email, phone, roles }) =>
  unwrap(api.post(`/organizations/${orgId}/members`, { email, phone, roles }));

export const updateOrgMemberRoles = (orgId, userId, roles) =>
  unwrap(api.patch(`/organizations/${orgId}/members/${userId}`, { roles }));

export const removeOrgMember = (orgId, userId) =>
  unwrap(api.delete(`/organizations/${orgId}/members/${userId}`));

export const transferOwnership = (orgId, userId) =>
  unwrap(api.post(`/organizations/${orgId}/members/${userId}/owner`, {}));

// --- invitations -------------------------------------------------------------
export const listOrgInvitations = (orgId, params = {}) =>
  unwrap(api.get(`/organizations/${orgId}/invitations`, { params }));

// An invitation is addressed to an email, a phone number, or both — the server
// insists on at least one and normalizes the phone itself.
export const createOrgInvitation = (orgId, { email, phone, roles, message }) =>
  unwrap(api.post(`/organizations/${orgId}/invitations`, { email, phone, roles, message }));

export const revokeOrgInvitation = (orgId, invitationId) =>
  unwrap(api.delete(`/organizations/${orgId}/invitations/${invitationId}`));

export const listMyInvitations = () => unwrap(api.get("/invitations"));

export const previewInvitation = (token) => unwrap(api.get(`/invitations/token/${token}`));

export const acceptInvitation = (token) => unwrap(api.post("/invitations/accept", { token }));

export const rejectInvitation = (token) => unwrap(api.post("/invitations/reject", { token }));

/** Same two actions from the inbox, which lists invitations by id not by token. */
export const acceptInvitationById = (invitationId) => unwrap(api.post(`/invitations/${invitationId}/accept`));

export const rejectInvitationById = (invitationId) => unwrap(api.post(`/invitations/${invitationId}/reject`));

// --- types -------------------------------------------------------------------
// The organization `type` must already exist in the platform's TeamCategory
// configuration; the API rejects unknown values with ORG_TYPE_UNKNOWN.
export const listOrganizationTypes = () => unwrap(api.get("/team-categories"));

// --- teams (Phase 4) ---------------------------------------------------------
// Org-scoped and permission-gated. Every one of these is nested under the
// organization, which is what keeps one tenant out of another's teams.
export const listOrgTeamsManaged = (orgId, params = {}) =>
  unwrap(api.get(`/organizations/${orgId}/teams/manage`, { params }));

export const createOrgTeam = (orgId, payload) => unwrap(api.post(`/organizations/${orgId}/teams`, payload));

export const updateOrgTeam = (orgId, teamId, payload) =>
  unwrap(api.patch(`/organizations/${orgId}/teams/${teamId}`, payload));

export const deleteOrgTeam = (orgId, teamId) => unwrap(api.delete(`/organizations/${orgId}/teams/${teamId}`));

export const addOrgTeamPlayers = (orgId, teamId, playerIds) =>
  unwrap(api.post(`/organizations/${orgId}/teams/${teamId}/players`, { playerIds }));

export const removeOrgTeamPlayers = (orgId, teamId, playerIds) =>
  unwrap(api.delete(`/organizations/${orgId}/teams/${teamId}/players`, { data: { playerIds } }));

export const updateOrgTeamPlayerRole = (orgId, teamId, playerId, payload) =>
  unwrap(api.put(`/organizations/${orgId}/teams/${teamId}/players/${playerId}`, payload));

// Fix B: publish/hide a team. The server flips the stored `isPublic` and returns
// the new value; the org's own members with `manage_teams` are authorized to
// change it (platform admins too).
export const toggleTeamVisibility = (teamId) =>
  unwrap(api.patch(`/teams/${teamId}/visibility`));

// --- matches and events (Phase 6) --------------------------------------------
// Fixtures and competitions the organization runs itself. Scoring is not here:
// ball-by-ball stays in the platform Admin app, so these endpoints can schedule
// a game and call it off, and nothing else.
export const listOrgMatches = (orgId, params = {}) =>
  unwrap(api.get(`/organizations/${orgId}/matches`, { params }));

export const createOrgMatch = (orgId, payload) => unwrap(api.post(`/organizations/${orgId}/matches`, payload));

export const updateOrgMatch = (orgId, matchId, payload) =>
  unwrap(api.patch(`/organizations/${orgId}/matches/${matchId}`, payload));

export const deleteOrgMatch = (orgId, matchId) => unwrap(api.delete(`/organizations/${orgId}/matches/${matchId}`));

/** Squads are chosen from the team roster; the server refuses anybody else. */
export const setOrgMatchSquads = (orgId, matchId, squads) =>
  unwrap(api.put(`/organizations/${orgId}/matches/${matchId}/squads`, { squads }));

export const listOrgEvents = (orgId) => unwrap(api.get(`/organizations/${orgId}/events`));

export const createOrgEvent = (orgId, payload) => unwrap(api.post(`/organizations/${orgId}/events`, payload));

export const updateOrgEvent = (orgId, eventId, payload) =>
  unwrap(api.patch(`/organizations/${orgId}/events/${eventId}`, payload));

export const deleteOrgEvent = (orgId, eventId) => unwrap(api.delete(`/organizations/${orgId}/events/${eventId}`));

export default {
  listMyOrganizations,
  getOrganization,
  getOrganizationTeams,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  getMyOrgAccess,
  getOrgOverview,
  listOrgAuditLog,
  listOrgMembers,
  addOrgMember,
  updateOrgMemberRoles,
  removeOrgMember,
  transferOwnership,
  listOrgInvitations,
  createOrgInvitation,
  revokeOrgInvitation,
  listMyInvitations,
  previewInvitation,
  acceptInvitation,
  rejectInvitation,
  acceptInvitationById,
  rejectInvitationById,
  listOrganizationTypes,
  listOrgTeamsManaged,
  createOrgTeam,
  updateOrgTeam,
  deleteOrgTeam,
  addOrgTeamPlayers,
  removeOrgTeamPlayers,
  updateOrgTeamPlayerRole,
  listOrgMatches,
  createOrgMatch,
  updateOrgMatch,
  deleteOrgMatch,
  setOrgMatchSquads,
  listOrgEvents,
  createOrgEvent,
  updateOrgEvent,
  deleteOrgEvent,
};
