import Tournament from "../models/Tournament.js";
import Series from "../models/Series.js";
import * as tournaments from "./TournamentController.js";
import * as seriesController from "./seriesController.js";

// Phase 2 (org-owned competitions).
//
// This module is intentionally thin: the Admin tournament/series handlers
// already contain every rule (team counts, fixtures, points, awards, squads),
// so the org surface *delegates* to them instead of copying them. What is added
// here is only the tenant layer:
//
//   * create stamps `organizationRef` from the authorised `req.org`;
//   * every read/write by id runs behind requireOrgTournament/requireOrgSeries,
//     which resolves the document WITH organizationRef in the query (404 for
//     another tenant's competition);
//   * the guards re-point `req.params.id` / `req.params.tournamentId` at the
//     verified document, so the reused handler cannot act on an unscoped id.
//
// Public and Admin routes are untouched and keep their existing behaviour.

// ---------------------------------------------------------------------------
// Tournaments
// ---------------------------------------------------------------------------
export const listOrgTournaments = async (req, res) => {
  try {
    const items = await Tournament.find({ organizationRef: req.org._id })
      .select("name shortName type status startDate endDate venue format logo teams matches createdAt updatedAt")
      .populate("teams", "name shortName logo")
      .sort({ startDate: -1, createdAt: -1 })
      .lean();
    res.status(200).json({ items, total: items.length });
  } catch (error) {
    res.status(500).json({ message: "Failed to load your tournaments" });
  }
};

export const createOrgTournament = (req, res) => tournaments.createTournament(req, res);
export const getOrgTournament = (req, res) => tournaments.getTournament(req, res);
export const updateOrgTournament = (req, res) => tournaments.updateTournament(req, res);
export const deleteOrgTournament = (req, res) => tournaments.deleteTournament(req, res);

// Team add/remove reuse updateTournament's validation and points-table rebuild
// by handing it the resulting team list.
const currentTeamIds = (tournament) =>
  (tournament.teams || []).map((team) => String(team?._id || team));

export const addOrgTournamentTeams = (req, res) => {
  const incoming = Array.isArray(req.body?.teamIds) ? req.body.teamIds.map(String) : [];
  const next = [...new Set([...currentTeamIds(req.tournament), ...incoming])];
  req.body = { teams: next };
  return tournaments.updateTournament(req, res);
};

export const removeOrgTournamentTeam = (req, res) => {
  const next = currentTeamIds(req.tournament).filter((id) => id !== String(req.params.teamId));
  req.body = { teams: next };
  return tournaments.updateTournament(req, res);
};

export const getOrgTournamentPointsTable = (req, res) =>
  tournaments.getTournamentPointsTable(req, res);

export const getOrgTournamentFixtures = (req, res) => tournaments.getTournamentFixtures(req, res);

export const recomputeOrgTournamentPoints = (req, res) => {
  req.body = { ...(req.body || {}), tournamentId: req.params.tournamentId };
  return tournaments.updatePointsTable(req, res);
};

export const setOrgTournamentSquad = (req, res) => tournaments.setTournamentSquad(req, res);
export const getOrgTournamentSquad = (req, res) => tournaments.getTournamentSquad(req, res);
export const deleteOrgTournamentSquad = (req, res) => tournaments.deleteTournamentSquad(req, res);

export const createOrgTournamentMatch = (req, res) => tournaments.createTournamentMatch(req, res);
export const setOrgTournamentGroups = (req, res) => tournaments.setTournamentGroups(req, res);
export const previewOrgTournamentFixtures = (req, res) =>
  tournaments.previewTournamentFixtures(req, res);
export const applyOrgTournamentFixtures = (req, res) =>
  tournaments.applyTournamentFixtures(req, res);

export const setOrgTournamentAwards = (req, res) => tournaments.setTournamentAwards(req, res);
export const setOrgTournamentOfficialAwards = (req, res) =>
  tournaments.setTournamentOfficialAwards(req, res);

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------
export const listOrgSeries = async (req, res) => {
  try {
    const items = await Series.find({ organizationRef: req.org._id })
      .populate("teams", "name shortName logo")
      .sort({ startDate: -1, createdAt: -1 })
      .lean();
    res.status(200).json({ items, total: items.length });
  } catch (error) {
    res.status(500).json({ message: "Failed to load your series" });
  }
};

export const createOrgSeries = (req, res) => seriesController.createSeries(req, res);
export const getOrgSeries = (req, res) => seriesController.getSeriesById(req, res);
export const updateOrgSeries = (req, res) => seriesController.updateSeries(req, res);
export const deleteOrgSeries = (req, res) => seriesController.deleteSeries(req, res);

export default {
  listOrgTournaments,
  createOrgTournament,
  getOrgTournament,
  updateOrgTournament,
  deleteOrgTournament,
  addOrgTournamentTeams,
  removeOrgTournamentTeam,
  getOrgTournamentPointsTable,
  getOrgTournamentFixtures,
  recomputeOrgTournamentPoints,
  setOrgTournamentSquad,
  getOrgTournamentSquad,
  deleteOrgTournamentSquad,
  createOrgTournamentMatch,
  setOrgTournamentGroups,
  previewOrgTournamentFixtures,
  applyOrgTournamentFixtures,
  setOrgTournamentAwards,
  setOrgTournamentOfficialAwards,
  listOrgSeries,
  createOrgSeries,
  getOrgSeries,
  updateOrgSeries,
  deleteOrgSeries,
};
