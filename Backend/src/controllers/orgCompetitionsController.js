import Tournament from "../models/Tournament.js";
import Series from "../models/Series.js";
import Match from "../models/Match.js";
import * as tournaments from "./TournamentController.js";
import * as seriesController from "./seriesController.js";
import { emitToAll } from "../socket/socket.js";

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

// A fixture links to a series through `Match.series`, a string that historically
// held either the id, the slug or the name. New writes always store the id; the
// reader accepts the slug too so imported fixtures still show up. The name is
// deliberately not accepted: two series may share a name.
const seriesMatchKeys = (series) =>
  [series?._id, series?.slug].filter(Boolean).map((value) => String(value));

const idOf = (value) => String(value?._id || value || "");

const teamSummary = (team) => ({
  _id: team?._id || team || null,
  name: team?.name || team?.shortName || "Unknown team",
  shortName: team?.shortName || "",
  logo: team?.logo || "",
});

const matchStart = (match) => {
  if (!match?.startAt) return Number.POSITIVE_INFINITY;
  const value = new Date(match.startAt).getTime();
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
};

const matchNumber = (match) => {
  const value = Number(match?.seriesMatchNumber);
  return Number.isFinite(value) && value > 0 ? value : Number.POSITIVE_INFINITY;
};

/**
 * Linked matches in playing order: an explicit series match number wins, then
 * the scheduled time, then the order the documents were created. Matches without
 * a number sort after numbered ones rather than being treated as match zero.
 */
const orderSeriesMatches = (matches = []) =>
  [...matches].sort(
    (a, b) =>
      matchNumber(a) - matchNumber(b) ||
      matchStart(a) - matchStart(b) ||
      new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
  );

const loadSeriesMatches = async (series, orgId) =>
  Match.find({ organizationRef: orgId, series: { $in: seriesMatchKeys(series) } })
    .select("title venue matchType status startAt teams result tieResolution resultText series seriesMatchNumber createdAt")
    .populate("teams", "name shortName logo")
    .populate("result.winner", "name shortName logo")
    .lean();

/**
 * Series score from linked results. This is the only source of truth for wins,
 * ties and no-results; no endpoint lets a client set them by hand.
 *
 * A completed match with a winner counts a win for that side. A tie/draw adds to
 * `ties` and a completed match without a winner (or an abandoned fixture) adds to
 * `noResult`. A live/upcoming fixture is listed but changes no count.
 */
export function computeSeriesScore(series, matches = []) {
  const rows = new Map();
  for (const team of series?.teams || []) {
    const id = idOf(team);
    if (!id) continue;
    rows.set(id, {
      team: teamSummary(team),
      played: 0,
      wins: 0,
      ties: 0,
      noResult: 0,
    });
  }

  const countFor = (teamIds, key) => {
    for (const teamId of teamIds) {
      if (rows.has(teamId)) rows.get(teamId)[key] += 1;
    }
  };

  let completed = 0;
  let ties = 0;
  let noResult = 0;

  for (const match of matches) {
    const present = (match.teams || []).map(idOf).filter((teamId) => rows.has(teamId));
    if (!present.length) continue;

    if (match.status === "abandoned") {
      noResult += 1;
      countFor(present, "noResult");
      continue;
    }
    if (match.status !== "completed") continue;

    completed += 1;
    countFor(present, "played");

    const winnerId = idOf(match.result?.winner);
    const resultType = String(match.result?.resultType || "").toLowerCase();
    if (winnerId && present.includes(winnerId)) {
      rows.get(winnerId).wins += 1;
    } else if (
      resultType === "tie" ||
      resultType === "draw" ||
      match.tieResolution === "declared_tie"
    ) {
      ties += 1;
      countFor(present, "ties");
    } else {
      noResult += 1;
      countFor(present, "noResult");
    }
  }

  const teams = [...rows.values()];
  const maxWins = Math.max(0, ...teams.map((row) => row.wins));
  const leaders = teams.filter((row) => row.wins === maxWins);
  // Equal wins at the top is a draw, which is exactly what the complete action
  // reports. With no completed match there is no winner to declare yet.
  const decided = maxWins > 0 && leaders.length === 1;
  const winner = decided ? leaders[0].team : null;

  return {
    matches: matches.length,
    completed,
    ties,
    noResult,
    teams,
    leader: winner,
    winner,
    outcome: decided ? "winner" : completed > 0 ? "drawn" : "pending",
  };
}

const seriesMatchRow = (match) => ({
  _id: match._id,
  title: match.title,
  venue: match.venue || "",
  matchType: match.matchType,
  status: match.status,
  startAt: match.startAt || null,
  series: match.series || "",
  seriesMatchNumber: match.seriesMatchNumber ?? null,
  teams: (match.teams || []).map(teamSummary),
  result: match.result
    ? {
        winner: match.result.winner ? teamSummary(match.result.winner) : null,
        resultType: match.result.resultType || "",
        margin: match.result.margin || "",
        description: match.result.description || "",
      }
    : null,
  resultText: match.resultText || "",
});

const seriesDetailPayload = (series, matches) => {
  const ordered = orderSeriesMatches(matches);
  return {
    ...series,
    teams: (series.teams || []).map(teamSummary),
    winner: series.winner ? teamSummary(series.winner) : null,
    matches: ordered.map(seriesMatchRow),
    score: computeSeriesScore(series, ordered),
  };
};

const findPopulatedSeries = (orgId, seriesId) =>
  Series.findOne({ _id: seriesId, organizationRef: orgId })
    .populate("teams", "name shortName logo")
    .populate("winner", "name shortName logo")
    .lean();

const sendSeriesDetail = async (req, res) => {
  const series = await findPopulatedSeries(req.org._id, req.series._id);
  if (!series) return res.status(404).json({ message: "Series not found" });
  const matches = await loadSeriesMatches(series, req.org._id);
  return res.status(200).json(seriesDetailPayload(series, matches));
};

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

// The detail read carries the linked fixtures and the score computed from their
// results. It replaces the public series payload on the org route: an owner sees
// their whole roster (no public hidden-team projection) and the score the owner
// screen displays.
export const getOrgSeries = async (req, res) => {
  try {
    return await sendSeriesDetail(req, res);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load the series" });
  }
};

export const updateOrgSeries = (req, res) => {
  // `winner` is an outcome, not an editable field. It is set by the complete
  // action from the linked results, so a body can never award a series.
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, "winner")) {
    const { winner, ...rest } = req.body;
    req.body = rest;
  }
  return seriesController.updateSeries(req, res);
};

export const deleteOrgSeries = (req, res) => seriesController.deleteSeries(req, res);

/**
 * Link an existing, unlinked fixture to this series.
 *
 * The fixture is resolved WITH the caller's organization so another tenant's
 * match is a 404. It must not already belong to a series, and every side in it
 * must be one of the series' teams. A completed series is frozen so its result
 * cannot be rewritten by adding or removing games.
 */
export const linkOrgSeriesMatch = async (req, res) => {
  try {
    if (req.series.status === "completed") {
      return res.status(409).json({
        message: "A completed series cannot change its matches",
        code: "SERIES_COMPLETED",
      });
    }

    const match = await Match.findOne({
      _id: req.params.matchId,
      organizationRef: req.org._id,
    });
    if (!match) {
      return res.status(404).json({ message: "Match not found", code: "MATCH_NOT_FOUND" });
    }
    if (match.series) {
      return res.status(409).json({
        message: "That match already belongs to a series",
        code: "MATCH_ALREADY_LINKED",
      });
    }

    const seriesTeams = new Set((req.series.teams || []).map(String));
    const matchTeams = (match.teams || []).map(String);
    if (!matchTeams.length || !matchTeams.every((teamId) => seriesTeams.has(teamId))) {
      return res.status(422).json({
        message: "Both teams must be part of this series",
        code: "MATCH_TEAM_NOT_IN_SERIES",
      });
    }

    match.series = String(req.series._id);
    if (!match.seriesMatchNumber) {
      const last = await Match.findOne({
        organizationRef: req.org._id,
        series: String(req.series._id),
        _id: { $ne: match._id },
      })
        .sort({ seriesMatchNumber: -1 })
        .select("seriesMatchNumber")
        .lean();
      const next = Number(last?.seriesMatchNumber);
      match.seriesMatchNumber = Number.isFinite(next) && next > 0 ? next + 1 : 1;
    }
    await match.save();

    emitToAll("match:updateList");
    return await sendSeriesDetail(req, res);
  } catch (error) {
    return res.status(500).json({ message: "Failed to link the match" });
  }
};

/** Remove a fixture from this series without deleting the match itself. */
export const unlinkOrgSeriesMatch = async (req, res) => {
  try {
    if (req.series.status === "completed") {
      return res.status(409).json({
        message: "A completed series cannot change its matches",
        code: "SERIES_COMPLETED",
      });
    }

    const match = await Match.findOne({
      _id: req.params.matchId,
      organizationRef: req.org._id,
    });
    if (!match || String(match.series) !== String(req.series._id)) {
      return res.status(404).json({ message: "Match not found in this series", code: "MATCH_NOT_FOUND" });
    }

    match.series = "";
    match.seriesMatchNumber = null;
    await match.save();

    emitToAll("match:updateList");
    return await sendSeriesDetail(req, res);
  } catch (error) {
    return res.status(500).json({ message: "Failed to unlink the match" });
  }
};

/**
 * Mark the series completed. The winner is recomputed here from the linked
 * results and written to `Series.winner`; a tie at the top stores no winner and
 * the response says `drawn` so the UI can show it without inventing a champion.
 */
export const completeOrgSeries = async (req, res) => {
  try {
    const series = await Series.findOne({
      _id: req.series._id,
      organizationRef: req.org._id,
    }).populate("teams", "name shortName logo");
    if (!series) return res.status(404).json({ message: "Series not found" });

    const matches = await loadSeriesMatches(series, req.org._id);
    const score = computeSeriesScore(series.toObject(), matches);

    series.status = "completed";
    series.winner = score.winner?._id || null;
    await series.save();

    emitToAll("match:updateList");
    return await sendSeriesDetail(req, res);
  } catch (error) {
    return res.status(500).json({ message: "Failed to complete the series" });
  }
};

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
