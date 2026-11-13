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

// Owner-side inline creation: the same route accepts minimal new-player fields
// and creates the Player on the team in one call. A duplicate phone/name answers
// 409 PLAYER_DUPLICATE.
export const addOrgTeamPlayer = (orgId, teamId, newPlayer) =>
  unwrap(api.post(`/organizations/${orgId}/teams/${teamId}/players`, { newPlayer }));

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

// --- single-match setup (Playing XI straight from the roster) ----------------
// These are the public match routes the Admin setup wizard also uses. The owner
// has `create_match` in their own organization, which is what gates them.
export const getMatchDetail = (matchId) => unwrap(api.get(`/matches/${matchId}`));

export const getMatchSquads = (matchId) => unwrap(api.get(`/matches/${matchId}/squads`));

export const setMatchPlayingXI = (matchId, teamId, players) =>
  unwrap(api.put(`/matches/${matchId}/playing-xi`, { teamId, players }));

export const setMatchTeamRoles = (matchId, payload) =>
  unwrap(api.put(`/matches/${matchId}/team-roles`, payload));

export const setMatchToss = (matchId, tossWinnerId, decision) =>
  unwrap(api.put(`/matches/${matchId}/toss`, { tossWinnerId, decision }));

// `null` clears the nomination; the server treats every falsy value the same.
export const setMatchTwelfthMan = (matchId, teamId, playerId) =>
  unwrap(api.put(`/matches/${matchId}/twelfth-man`, { teamId, playerId: playerId || null }));

export const listOrgEvents = (orgId) => unwrap(api.get(`/organizations/${orgId}/events`));

export const createOrgEvent = (orgId, payload) => unwrap(api.post(`/organizations/${orgId}/events`, payload));

export const updateOrgEvent = (orgId, eventId, payload) =>
  unwrap(api.patch(`/organizations/${orgId}/events/${eventId}`, payload));

export const deleteOrgEvent = (orgId, eventId) => unwrap(api.delete(`/organizations/${orgId}/events/${eventId}`));

// --- competitions this organization owns (Phase 2) --------------------------
// Tournaments and series used to be platform-Admin-only. Every route below is
// nested under the organization and is tenant-scoped by the server, so an id
// from another organization is a 404 rather than a cross-tenant hit.
//
// The delete wrappers exist for completeness, but the User app deliberately
// never calls them: hard deletes are platform-admin only (ADMIN_ONLY_DELETE),
// and owners request them through RequestDeletionButton instead.
export const listOrgTournaments = (orgId) => unwrap(api.get(`/organizations/${orgId}/tournaments`));

export const createOrgTournament = (orgId, payload) =>
  unwrap(api.post(`/organizations/${orgId}/tournaments`, payload));

export const getOrgTournament = (orgId, tournamentId) =>
  unwrap(api.get(`/organizations/${orgId}/tournaments/${tournamentId}`));

export const updateOrgTournament = (orgId, tournamentId, payload) =>
  unwrap(api.put(`/organizations/${orgId}/tournaments/${tournamentId}`, payload));

export const deleteOrgTournament = (orgId, tournamentId) =>
  unwrap(api.delete(`/organizations/${orgId}/tournaments/${tournamentId}`));

export const addOrgTournamentTeams = (orgId, tournamentId, teamIds) =>
  unwrap(api.post(`/organizations/${orgId}/tournaments/${tournamentId}/teams`, { teamIds }));

export const removeOrgTournamentTeam = (orgId, tournamentId, teamId) =>
  unwrap(api.delete(`/organizations/${orgId}/tournaments/${tournamentId}/teams/${teamId}`));

export const setOrgTournamentGroups = (orgId, tournamentId, groups) =>
  unwrap(api.put(`/organizations/${orgId}/tournaments/${tournamentId}/groups`, { groups }));

export const getOrgTournamentPointsTable = (orgId, tournamentId) =>
  unwrap(api.get(`/organizations/${orgId}/tournaments/${tournamentId}/points-table`));

export const recomputeOrgTournamentPoints = (orgId, tournamentId) =>
  unwrap(api.post(`/organizations/${orgId}/tournaments/${tournamentId}/points-table/recompute`, {}));

export const getOrgTournamentFixtures = (orgId, tournamentId) =>
  unwrap(api.get(`/organizations/${orgId}/tournaments/${tournamentId}/fixtures`));

export const previewOrgTournamentFixtures = (orgId, tournamentId, options) =>
  unwrap(api.post(`/organizations/${orgId}/tournaments/${tournamentId}/fixtures/preview`, options));

export const applyOrgTournamentFixtures = (orgId, tournamentId, options) =>
  unwrap(api.post(`/organizations/${orgId}/tournaments/${tournamentId}/fixtures/apply`, options));

export const createOrgTournamentMatch = (orgId, tournamentId, payload) =>
  unwrap(api.post(`/organizations/${orgId}/tournaments/${tournamentId}/matches`, payload));

export const getOrgTournamentSquad = (orgId, tournamentId, teamId) =>
  unwrap(
    api.get(
      `/organizations/${orgId}/tournaments/${tournamentId}/squad${teamId ? `/${teamId}` : ""}`
    )
  );

export const setOrgTournamentSquad = (orgId, tournamentId, payload) =>
  unwrap(api.post(`/organizations/${orgId}/tournaments/${tournamentId}/squad`, payload));

export const deleteOrgTournamentSquad = (orgId, tournamentId, teamId) =>
  unwrap(api.delete(`/organizations/${orgId}/tournaments/${tournamentId}/squad/${teamId}`));

export const setOrgTournamentAwards = (orgId, tournamentId, payload) =>
  unwrap(api.put(`/organizations/${orgId}/tournaments/${tournamentId}/awards`, payload));

export const setOrgTournamentOfficialAwards = (orgId, tournamentId, payload) =>
  unwrap(api.put(`/organizations/${orgId}/tournaments/${tournamentId}/official-awards`, payload));

export const listOrgSeries = (orgId) => unwrap(api.get(`/organizations/${orgId}/series`));

export const createOrgSeries = (orgId, payload) =>
  unwrap(api.post(`/organizations/${orgId}/series`, payload));

export const getOrgSeries = (orgId, seriesId) =>
  unwrap(api.get(`/organizations/${orgId}/series/${seriesId}`));

export const updateOrgSeries = (orgId, seriesId, payload) =>
  unwrap(api.put(`/organizations/${orgId}/series/${seriesId}`, payload));

export const deleteOrgSeries = (orgId, seriesId) =>
  unwrap(api.delete(`/organizations/${orgId}/series/${seriesId}`));

// --- helpers used by the competition screens --------------------------------
// Guest teams are registered by the host, so the picker needs the public team
// catalogue and a roster for whichever side was chosen. Neither is a new org
// route: they are the existing public team endpoints.
export const listPublicTeams = (params = {}) => unwrap(api.get("/teams", { params }));

export const getTeamRoster = (teamId) => unwrap(api.get(`/teams/${teamId}/players`));

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
  addOrgTeamPlayer,
  removeOrgTeamPlayers,
  updateOrgTeamPlayerRole,
  listOrgMatches,
  createOrgMatch,
  updateOrgMatch,
  deleteOrgMatch,
  setOrgMatchSquads,
  getMatchDetail,
  getMatchSquads,
  setMatchPlayingXI,
  setMatchTeamRoles,
  setMatchToss,
  setMatchTwelfthMan,
  listOrgEvents,
  createOrgEvent,
  updateOrgEvent,
  deleteOrgEvent,
  listOrgTournaments,
  createOrgTournament,
  getOrgTournament,
  updateOrgTournament,
  deleteOrgTournament,
  addOrgTournamentTeams,
  removeOrgTournamentTeam,
  setOrgTournamentGroups,
  getOrgTournamentPointsTable,
  recomputeOrgTournamentPoints,
  getOrgTournamentFixtures,
  previewOrgTournamentFixtures,
  applyOrgTournamentFixtures,
  createOrgTournamentMatch,
  getOrgTournamentSquad,
  setOrgTournamentSquad,
  deleteOrgTournamentSquad,
  setOrgTournamentAwards,
  setOrgTournamentOfficialAwards,
  listOrgSeries,
  createOrgSeries,
  getOrgSeries,
  updateOrgSeries,
  deleteOrgSeries,
  listPublicTeams,
  getTeamRoster,
};
