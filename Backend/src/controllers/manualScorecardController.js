import mongoose from "mongoose";
import Match from "../models/Match.js";
import Team from "../models/Team.js";
import Tournament from "../models/Tournament.js";
import { validateManualScorecard } from "../services/manualScorecard.js";
import { recomputeTournamentPoints } from "../services/tournamentService.js";
import { buildMatchInnings } from "../utils/matchInnings.js";
import { recordAudit } from "../utils/audit.js";
import { getIO } from "../socket/socket.js";

const idOf = (value) => String(value?._id || value || "");

// The Match model's `matchType` -> `totalOvers` pre-save hook only knows these
// quotas, so a manual scorecard is restricted to them too (a half-entered custom
// quota would silently be rewritten on save).
const MATCH_TYPE_BY_OVERS = { 6: "6 Overs", 8: "8 Overs", 10: "T10", 20: "T20", 50: "ODI" };

const emitMatchUpdate = (match, tournamentId) => {
  try {
    const io = getIO();
    io.emit("match:updated", match);
    io.emit("match:updateList");
    if (tournamentId) io.emit("tournament:matchUpdated", { tournamentId, match });
  } catch (socketError) {
    // A missing socket server must never fail the write.
    console.log("Socket not available:", socketError.message);
  }
};

/** Merge a team's standing roster with any squad already picked on the match. */
const buildSquadMap = (teams, existingMatch = null) => {
  const map = {};
  for (const team of teams) {
    map[idOf(team)] = (team.players || []).map(idOf);
  }
  if (existingMatch) {
    const groups = [...(existingMatch.squad15 || []), ...(existingMatch.playingXI || [])];
    for (const group of groups) {
      const key = idOf(group.team);
      if (!key) continue;
      if (!map[key]) map[key] = [];
      for (const player of group.players || []) map[key].push(idOf(player));
    }
  }
  return map;
};

/** Place validated innings into the match's fixed two slots, in team order. */
const applyInnings = (match, innings, teamIds, complete) => {
  const byTeam = new Map(innings.map((row) => [idOf(row.team), row]));
  match.innings = teamIds.map((team) => {
    const row = byTeam.get(idOf(team));
    if (!row) return { team, status: complete ? "completed" : "upcoming" };
    return {
      team: row.team,
      runs: row.runs,
      wickets: row.wickets,
      overs: row.overs,
      balls: row.balls,
      extras: row.extras,
      batting: row.batting,
      bowling: row.bowling,
      fallOfWickets: row.fallOfWickets,
      battingOrder: row.battingOrder,
      status: complete ? "completed" : "upcoming",
    };
  });
};

const loadManualContext = async (body, existingMatch = null) => {
  const teamA = idOf(body.teamA || existingMatch?.teams?.[0]);
  const teamB = idOf(body.teamB || existingMatch?.teams?.[1]);

  if (!teamA || !teamB) return { error: { status: 400, message: "Two teams are required." } };
  if (teamA === teamB) return { error: { status: 400, message: "The two teams must be different." } };
  if (!mongoose.Types.ObjectId.isValid(teamA) || !mongoose.Types.ObjectId.isValid(teamB)) {
    return { error: { status: 400, message: "One of the team ids is not valid." } };
  }

  const teams = await Team.find({ _id: { $in: [teamA, teamB] } })
    .select("name shortName players venue")
    .lean();
  if (teams.length !== 2) return { error: { status: 404, message: "One or both teams were not found." } };
  const teamById = new Map(teams.map((team) => [idOf(team), team]));

  let tournament = null;
  if (body.tournamentId || existingMatch?.tournament) {
    const tournamentId = idOf(body.tournamentId || existingMatch?.tournament);
    if (!mongoose.Types.ObjectId.isValid(tournamentId)) {
      return { error: { status: 400, message: "Tournament id is not valid." } };
    }
    tournament = await Tournament.findById(tournamentId);
    if (!tournament) return { error: { status: 404, message: "Tournament not found." } };
    const tournamentTeams = new Set((tournament.teams || []).map(idOf));
    if (!tournamentTeams.has(teamA) || !tournamentTeams.has(teamB)) {
      return { error: { status: 400, message: "Both teams must belong to the tournament." } };
    }
  }

  const totalOvers = Number(body.totalOvers ?? existingMatch?.totalOvers ?? 20);
  if (!MATCH_TYPE_BY_OVERS[totalOvers]) {
    return { error: { status: 400, message: "Overs must be one of 6, 8, 10, 20 or 50." } };
  }

  return {
    teamA,
    teamB,
    teams: [teamById.get(teamA), teamById.get(teamB)],
    tournament,
    totalOvers,
    matchType: MATCH_TYPE_BY_OVERS[totalOvers],
    squadByTeam: buildSquadMap(teams, existingMatch),
  };
};

const runValidation = (body, ctx, requireComplete) =>
  validateManualScorecard(
    { ...body, totalOvers: ctx.totalOvers },
    {
      teamIds: [ctx.teamA, ctx.teamB],
      totalOvers: ctx.totalOvers,
      squadByTeam: ctx.squadByTeam,
      requireComplete,
    }
  );

const sendValidationError = (res, errors) =>
  res.status(400).json({
    message: "Scorecard validation failed.",
    errors,
    // Flattened for quick display in a form banner.
    errorLines: errors.map((e) => `${e.path}: ${e.message}`),
  });

export const createManualMatch = async (req, res) => {
  try {
    const body = req.body || {};
    const ctx = await loadManualContext(body);
    if (ctx.error) return res.status(ctx.error.status).json({ message: ctx.error.message });

    const requireComplete = body.draft !== true;
    const { ok, errors, data } = runValidation(body, ctx, requireComplete);
    if (!ok) return sendValidationError(res, errors);

    const [teamA, teamB] = ctx.teams;
    const match = new Match({
      title: String(body.title || "").trim() || `${teamA.name} vs ${teamB.name}`,
      matchType: ctx.matchType,
      totalOvers: ctx.totalOvers,
      venue: String(body.venue || ctx.tournament?.venue || teamA.venue || "").trim(),
      matchCategory: body.matchCategory || "Club",
      matchSubcategory: ctx.tournament?.name || "",
      stage: data.stage,
      stageLabel: data.stageLabel,
      round: body.round != null && body.round !== "" ? body.round : (data.stage || null),
      tournament: ctx.tournament?._id || null,
      teams: [ctx.teamA, ctx.teamB],
      innings: buildMatchInnings([ctx.teamA, ctx.teamB]),
      startAt: body.startAt ? new Date(body.startAt) : new Date(),
      status: requireComplete ? "completed" : "upcoming",
      source: "manual",
      manualDraft: !requireComplete,
      manualMeta: { enteredAt: new Date(), lastEditedAt: null },
      tossWinner: data.tossWinner || null,
      tossDecision: data.tossDecision || undefined,
      result: data.result,
      manOfMatch: data.manOfMatch || null,
    });
    applyInnings(match, data.innings, [ctx.teamA, ctx.teamB], requireComplete);
    await match.save();

    if (ctx.tournament) {
      ctx.tournament.matches.push(match._id);
      await ctx.tournament.save();
      if (requireComplete) await recomputeTournamentPoints(ctx.tournament._id);
    }

    await match.populate("teams", "name shortName logo");
    emitMatchUpdate(match, ctx.tournament?._id);

    recordAudit({
      req,
      action: "match.manual_created",
      targetType: "match",
      targetId: match._id,
      targetLabel: match.title,
      metadata: {
        tournamentId: ctx.tournament?._id ? String(ctx.tournament._id) : null,
        stage: data.stage || null,
        draft: !requireComplete,
      },
    });

    res.status(201).json({ match, message: requireComplete ? "Manual scorecard saved." : "Draft saved." });
  } catch (error) {
    console.error("Error creating manual match:", error);
    res.status(400).json({ message: error.message || "Failed to save the manual scorecard." });
  }
};

export const updateManualMatch = async (req, res) => {
  try {
    const { id } = req.params;
    const match = await Match.findById(id);
    if (!match) return res.status(404).json({ message: "Match not found." });
    if (match.source !== "manual") {
      return res.status(409).json({ message: "Only a manual scorecard can be edited here." });
    }

    const body = req.body || {};
    const ctx = await loadManualContext(body, match);
    if (ctx.error) return res.status(ctx.error.status).json({ message: ctx.error.message });

    const requireComplete = body.draft !== true;
    const { ok, errors, data } = runValidation(body, ctx, requireComplete);
    if (!ok) return sendValidationError(res, errors);

    const [teamA, teamB] = ctx.teams;
    match.title = String(body.title || "").trim() || `${teamA.name} vs ${teamB.name}`;
    match.matchType = ctx.matchType;
    match.totalOvers = ctx.totalOvers;
    if (body.venue !== undefined) match.venue = String(body.venue || "").trim();
    if (body.matchCategory) match.matchCategory = body.matchCategory;
    if (body.startAt) match.startAt = new Date(body.startAt);
    match.stage = data.stage;
    match.stageLabel = data.stageLabel;
    match.round = data.stage || match.round;
    match.manualDraft = !requireComplete;
    match.status = requireComplete ? "completed" : "upcoming";
    match.manualMeta = { ...(match.manualMeta || {}), lastEditedAt: new Date() };
    match.tossWinner = data.tossWinner || null;
    match.tossDecision = data.tossDecision || undefined;
    match.result = data.result;
    match.manOfMatch = data.manOfMatch || null;
    applyInnings(match, data.innings, [ctx.teamA, ctx.teamB], requireComplete);
    await match.save();

    if (ctx.tournament && requireComplete) await recomputeTournamentPoints(ctx.tournament._id);

    await match.populate("teams", "name shortName logo");
    emitMatchUpdate(match, ctx.tournament?._id);

    recordAudit({
      req,
      action: "match.manual_updated",
      targetType: "match",
      targetId: match._id,
      targetLabel: match.title,
      metadata: {
        tournamentId: ctx.tournament?._id ? String(ctx.tournament._id) : null,
        draft: !requireComplete,
      },
    });

    res.status(200).json({ match, message: requireComplete ? "Manual scorecard updated." : "Draft updated." });
  } catch (error) {
    console.error("Error updating manual match:", error);
    res.status(400).json({ message: error.message || "Failed to update the manual scorecard." });
  }
};

export default { createManualMatch, updateManualMatch };
