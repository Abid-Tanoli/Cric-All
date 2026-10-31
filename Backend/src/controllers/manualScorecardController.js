import mongoose from "mongoose";
import Match from "../models/Match.js";
import Team from "../models/Team.js";
import Tournament from "../models/Tournament.js";
import Ball from "../models/Ball.js";
import Delivery from "../models/Delivery.js";
import {
  validateManualScorecard,
  formatOversLabel,
} from "../services/manualScorecard.js";
import { recomputeTournamentPoints } from "../services/tournamentService.js";
import { buildMatchInnings } from "../utils/matchInnings.js";
import { recordAudit, SYSTEM_ACTOR } from "../utils/audit.js";
import { getIO } from "../socket/socket.js";
import { invalidateTournamentStatsCache } from "../services/tournamentStats.js";

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

const sendManualError = (res, result) => {
  if (result.errors) return sendValidationError(res, result.errors);
  return res.status(result.status || 400).json({
    message: result.message || "Failed to save the manual scorecard.",
  });
};

// Every published manual write runs through this function. The Admin form
// reaches it through PUT /matches/:id/manual, and the operator script reaches
// it through publishManualMatch() below, so both publish the same way:
// validate -> status completed/manualDraft false -> recompute standings ->
// invalidate the public stats cache.
const applyManualMatch = async (match, body, { req = null, requireComplete = true } = {}) => {
  const ctx = await loadManualContext(body, match);
  if (ctx.error) return { ok: false, ...ctx.error };

  const { ok, errors, data } = runValidation(body, ctx, requireComplete);
  if (!ok) return { ok: false, status: 400, errors };

  const [teamA, teamB] = ctx.teams;
  match.title = String(body.title || "").trim() || `${teamA.name} vs ${teamB.name}`;
  match.matchType = ctx.matchType;
  match.totalOvers = ctx.totalOvers;
  if (body.venue !== undefined) match.venue = String(body.venue || "").trim();
  if (body.matchCategory) match.matchCategory = body.matchCategory;
  if (body.startAt) match.startAt = new Date(body.startAt);
  match.stage = data.stage;
  match.stageLabel = data.stageLabel;
  // A stage label ("SF1"/"QF2") is more specific than the stage key; keep it
  // when the caller supplies it (the fixture conversion does).
  match.round = body.round != null && body.round !== "" ? body.round : (data.stage || match.round);
  match.manualDraft = !requireComplete;
  match.status = requireComplete ? "completed" : "upcoming";
  match.manualMeta = { ...(match.manualMeta || {}), lastEditedAt: new Date() };
  match.tossWinner = data.tossWinner || null;
  match.tossDecision = data.tossDecision || undefined;
  match.result = data.result;
  match.manOfMatch = data.manOfMatch || null;
  applyInnings(match, data.innings, [ctx.teamA, ctx.teamB], requireComplete);
  await match.save();

  if (ctx.tournament && requireComplete) {
    await recomputeTournamentPoints(ctx.tournament._id);
    invalidateTournamentStatsCache(ctx.tournament._id);
  }

  await match.populate("teams", "name shortName logo");
  emitMatchUpdate(match, ctx.tournament?._id);

  await recordAudit({
    req,
    // The operator script has no HTTP principal; label its write as the system.
    actor: req ? undefined : SYSTEM_ACTOR,
    action: "match.manual_updated",
    targetType: "match",
    targetId: match._id,
    targetLabel: match.title,
    metadata: {
      tournamentId: ctx.tournament?._id ? String(ctx.tournament._id) : null,
      draft: !requireComplete,
      via: req ? "admin" : "script",
    },
  });

  return { ok: true, match };
};

const emptyInnings = (innings) => {
  if (!innings) return true;
  if (Number(innings.runs) !== 0 || Number(innings.wickets) !== 0) return false;
  if (Number(innings.balls) !== 0 || Number(innings.overs) !== 0) return false;
  for (const key of ["batting", "bowling", "fallOfWickets", "oversHistory", "partnerships"]) {
    if (Array.isArray(innings[key]) && innings[key].length) return false;
  }
  if (
    innings.currentBatsman1 ||
    innings.currentBatsman2 ||
    innings.onStrikeBatsman ||
    innings.currentBowler
  ) {
    return false;
  }
  return !innings.status || innings.status === "upcoming";
};

/**
 * True only for a scheduled fixture that has never been scored: upcoming, two
 * empty innings, no result/winner. Conversion helpers refuse anything else so a
 * live or completed match can never be overwritten by a paper scorecard.
 */
export const isEmptyUpcomingFixture = (match) => {
  if (!match) return false;
  if (String(match.status || "") !== "upcoming") return false;
  if (match.manualDraft === true) return false;
  if (match.result?.winner) return false;
  const innings = Array.isArray(match.innings) ? match.innings : [];
  if (innings.length !== 2) return false;
  return innings.every(emptyInnings);
};

/**
 * Convert an existing, empty scheduled live fixture into a DRAFT manual
 * scorecard in place. This is the operator counterpart to the Admin manual
 * save: after the guard it flips `source` to "manual" and delegates the actual
 * validation/save to `applyManualMatch()` with `requireComplete:false`.
 *
 * It never creates or deletes a document, never touches `match.tournament`, and
 * refuses a fixture whose `_id` is not linked from `Tournament.matches`, so the
 * bracket slot and its tournament link survive unchanged.
 */
export const convertUpcomingFixtureToManualDraft = async (
  matchId,
  body = {},
  { req = null } = {},
) => {
  try {
    const match = await Match.findById(matchId);
    if (!match) return { ok: false, status: 404, message: "Match not found." };
    if (match.source === "manual") {
      return { ok: false, status: 409, message: "Match is already a manual scorecard." };
    }
    if (match.source !== "live") {
      return { ok: false, status: 409, message: "Only a live-scored fixture can be converted." };
    }
    if (!isEmptyUpcomingFixture(match)) {
      return {
        ok: false,
        status: 409,
        message: "Only an empty upcoming fixture (no innings or ball data) can be converted.",
      };
    }

    const [ballCount, deliveryCount] = await Promise.all([
      Ball.countDocuments({ matchId: match._id }),
      Delivery.countDocuments({ matchId: match._id }),
    ]);
    if (ballCount || deliveryCount) {
      return {
        ok: false,
        status: 409,
        message: `Fixture already has ${ballCount} ball(s) and ${deliveryCount} delivery record(s); refusing to convert.`,
      };
    }

    if (!match.tournament) {
      return { ok: false, status: 409, message: "Fixture is not linked to a tournament." };
    }
    const tournament = await Tournament.findById(match.tournament).select("matches").lean();
    if (!tournament) {
      return { ok: false, status: 409, message: "Fixture tournament was not found." };
    }
    const linked = (tournament.matches || []).some((id) => idOf(id) === idOf(match._id));
    if (!linked) {
      return {
        ok: false,
        status: 409,
        message: "Fixture is not linked from Tournament.matches; refusing to convert.",
      };
    }
    if (!Array.isArray(match.teams) || match.teams.length !== 2) {
      return { ok: false, status: 409, message: "Fixture must have exactly two teams." };
    }

    // Preserve the bracket slot metadata even if a caller sends something else.
    const payload = {
      ...body,
      teamA: idOf(match.teams[0]),
      teamB: idOf(match.teams[1]),
      stage: match.stage || body.stage,
      stageLabel: match.stageLabel || body.stageLabel,
      startAt: match.startAt ? new Date(match.startAt).toISOString() : body.startAt,
      venue: match.venue ?? body.venue,
      title: body.title || match.title,
    };

    match.source = "manual";
    match.manualMeta = { enteredAt: new Date(), lastEditedAt: null };
    const result = await applyManualMatch(match, payload, { req, requireComplete: false });
    if (!result.ok) {
      // Nothing was saved; restore the in-memory document so a caller that
      // inspects it after a validation failure does not see a phantom flip.
      match.source = "live";
      return result;
    }
    return result;
  } catch (error) {
    return { ok: false, status: 400, message: error.message || "Failed to convert the fixture." };
  }
};

/** Rebuild the form payload from the scorecard already stored on a draft. */
export const manualMatchToPayload = (match) => {
  const plain = typeof match?.toObject === "function" ? match.toObject() : match || {};
  const innings = (plain.innings || []).map((innings) => ({
    team: idOf(innings.team),
    overs: Number(innings.balls) > 0
      ? formatOversLabel(innings.balls)
      : (Number(innings.overs) > 0 ? `${innings.overs}.0` : ""),
    extras: {
      wides: innings.extras?.wides || 0,
      noBalls: innings.extras?.noBalls || 0,
      byes: innings.extras?.byes || 0,
      legByes: innings.extras?.legByes || 0,
    },
    batting: (innings.batting || []).map((row) => ({
      player: idOf(row.player),
      runs: row.runs || 0,
      balls: row.balls || 0,
      fours: row.fours || 0,
      sixes: row.sixes || 0,
      isOut: row.isOut === true,
      isRetiredHurt: row.isRetiredHurt === true,
      isRetired: row.isRetired === true,
      dismissalType: row.dismissalType || "",
      dismissalText: row.dismissalText || "",
      dismissedBy: idOf(row.dismissedBy) || undefined,
      fielder: idOf(row.fielder) || undefined,
    })),
    bowling: (innings.bowling || []).map((row) => ({
      player: idOf(row.player),
      overs: Number(row.balls) > 0
        ? formatOversLabel(row.balls)
        : (Number(row.overs) > 0 ? `${row.overs}.0` : ""),
      maidens: row.maidens || 0,
      runs: row.runs || 0,
      wickets: row.wickets || 0,
      wides: row.wides || 0,
      noBalls: row.noBalls || 0,
    })),
    // `overs` is a printed over figure (2.1 = two overs and one ball), the same
    // unit the live scoring engine writes.
    fallOfWickets: (innings.fallOfWickets || []).map((row) => ({
      runs: row.runs,
      wickets: row.wickets ?? row.wicket,
      player: idOf(row.player) || undefined,
      overs: Number(row.overs) > 0 ? Number(row.overs).toFixed(1) : "",
    })),
  }));

  return {
    tournamentId: idOf(plain.tournament) || undefined,
    stage: plain.stage || "",
    stageLabel: plain.stageLabel || "",
    teamA: idOf(plain.teams?.[0]),
    teamB: idOf(plain.teams?.[1]),
    startAt: plain.startAt ? new Date(plain.startAt).toISOString() : undefined,
    totalOvers: plain.totalOvers || 20,
    venue: plain.venue || "",
    title: plain.title || "",
    tossWinner: idOf(plain.tossWinner) || undefined,
    tossDecision: plain.tossDecision || undefined,
    draft: false,
    innings,
    result: {
      resultType: plain.result?.resultType || "normal",
      winner: idOf(plain.result?.winner),
      margin: plain.result?.margin || "",
      note: plain.result?.description || "",
    },
    manOfMatch: idOf(plain.manOfMatch) || "",
  };
};

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
      if (requireComplete) {
        await recomputeTournamentPoints(ctx.tournament._id);
        invalidateTournamentStatsCache(ctx.tournament._id);
      }
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
    const requireComplete = body.draft !== true;
    const result = await applyManualMatch(match, body, { req, requireComplete });
    if (!result.ok) return sendManualError(res, result);

    res.status(200).json({ match: result.match, message: requireComplete ? "Manual scorecard updated." : "Draft updated." });
  } catch (error) {
    console.error("Error updating manual match:", error);
    res.status(400).json({ message: error.message || "Failed to update the manual scorecard." });
  }
};

/** Admin-only list for the Manual Scorecard page. Never filtered by creator. */
export const getManualMatches = async (req, res) => {
  try {
    const matches = await Match.find({ source: "manual" })
      .select([
        "title",
        "stage",
        "stageLabel",
        "round",
        "startAt",
        "status",
        "source",
        "manualDraft",
        "manualMeta",
        "tournament",
        "teams",
        "totalOvers",
        "result",
        "createdAt",
        "updatedAt",
      ].join(" "))
      .populate("teams", "name shortName logo")
      .populate("tournament", "name")
      .sort({ manualDraft: -1, startAt: -1, updatedAt: -1 })
      .lean();

    res.status(200).json({ matches });
  } catch (error) {
    console.error("Error fetching manual matches:", error);
    res.status(500).json({ message: "Failed to fetch manual matches." });
  }
};

/**
 * Publish a stored draft without re-entering its numbers. Shared by the
 * operator script and the same applyManualMatch path the Admin PUT uses.
 * dryRun validates without writing.
 */
export const publishManualMatch = async (matchId, { req = null, dryRun = false } = {}) => {
  try {
    const match = await Match.findById(matchId);
    if (!match) return { ok: false, status: 404, message: "Match not found." };
    if (match.source !== "manual") {
      return { ok: false, status: 409, message: "Only a manual scorecard can be published here." };
    }
    if (match.manualDraft !== true) {
      return { ok: true, skipped: true, match, message: "Match is already published." };
    }

    const body = manualMatchToPayload(match);
    if (dryRun) {
      const ctx = await loadManualContext(body, match);
      if (ctx.error) return { ok: false, ...ctx.error };
      const { ok, errors } = runValidation(body, ctx, true);
      return ok
        ? { ok: true, match, payload: body }
        : { ok: false, status: 400, errors };
    }

    return await applyManualMatch(match, body, { req, requireComplete: true });
  } catch (error) {
    return { ok: false, status: 400, message: error.message || "Failed to publish the manual scorecard." };
  }
};

export default {
  createManualMatch,
  updateManualMatch,
  getManualMatches,
  publishManualMatch,
  manualMatchToPayload,
  isEmptyUpcomingFixture,
  convertUpcomingFixtureToManualDraft,
};
