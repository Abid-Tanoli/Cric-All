// Dry-run by default; only --apply writes:
//   node src/scripts/applyPlayerNames.js --file /tmp/player-review.csv
//   node src/scripts/applyPlayerNames.js --file /tmp/player-review.csv --apply
//   node src/scripts/applyPlayerNames.js --file /tmp/player-review.csv --force-test
//
// --force-test is restricted to local loopback cric-all-e2e. For a cross-team
// merge, both --allow-cross-team and that CSV row's allow_cross_team cell set
// to "--allow-cross-team" are required.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import AuditLog from "../models/AuditLog.js";
import Ball from "../models/Ball.js";
import Blog from "../models/Blog.js";
import CommunityPost from "../models/CommunityPost.js";
import Delivery from "../models/Delivery.js";
import Event from "../models/Event.js";
import Match from "../models/Match.js";
import Partnership from "../models/Partnership.js";
import Player from "../models/Player.js";
import Review from "../models/Review.js";
import Team from "../models/Team.js";
import TeamPlayerRanking from "../models/TeamPlayerRanking.js";
import Tournament from "../models/Tournament.js";
import { invalidateTournamentStatsCache } from "../services/tournamentStats.js";
import { getMongoTarget } from "../utils/mongoTarget.js";
import {
  idOf,
  inningsHasDuplicateScoreRows,
  normalizeName,
  parseCsv,
  rewriteMatchPlayerReferences,
} from "./playerNameCleanup.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(SCRIPT_DIR, "../..");
dotenv.config({ path: path.join(BACKEND_ROOT, ".env"), quiet: true });

const AUDIT_ACTION = "player.name_cleanup";
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
const ADDITIVE_PLAYER_STATS = [
  "runs", "wickets", "matches", "innings", "notOuts", "fifties", "hundreds",
  "fourWickets", "fiveWickets", "dotBalls", "catches", "stumpings", "runOuts",
];
const ADDITIVE_RANKING_FIELDS = [
  "teamRuns", "teamFifties", "teamHundreds", "teamWickets", "teamMatches",
];

export function isTestTarget(databaseName, nodeEnv = process.env.NODE_ENV) {
  const db = String(databaseName || "");
  return nodeEnv === "test" ||
    /(^|[-_])e2e($|[-_])/i.test(db) ||
    /(^|[-_])test($|[-_])/i.test(db);
}

export function validateDatabaseTarget(uri, { forceTest = false, nodeEnv = process.env.NODE_ENV } = {}) {
  const { host, databaseName } = getMongoTarget(uri);
  if (!databaseName) throw new Error("MONGO_URL must include an explicit database name.");
  const isDisposable = databaseName === "cric-all-e2e" &&
    /^(localhost|127\.0\.0\.1|\[?::1\]?)(:\d+)?$/i.test(host);
  if (isTestTarget(databaseName, nodeEnv) && !forceTest) {
    throw new Error("Refusing to use a test/e2e database without --force-test.");
  }
  if (forceTest && !isDisposable) {
    throw new Error("--force-test is allowed only for a local loopback cric-all-e2e database.");
  }
  return { databaseName, host, isDisposable };
}

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const nonZero = (value) => Number.isFinite(Number(value)) && Number(value) !== 0;

function mergePlayerStats(target, source) {
  const merged = { ...(target.stats?.toObject?.() || target.stats || {}) };
  const sourceStats = source.stats?.toObject?.() || source.stats || {};
  for (const key of ADDITIVE_PLAYER_STATS) {
    merged[key] = Number(merged[key] || 0) + Number(sourceStats[key] || 0);
  }
  merged.highScore = Math.max(Number(merged.highScore || 0), Number(sourceStats.highScore || 0));
  for (const key of ["strikeRate", "economy", "average", "bowlingAverage"]) {
    if (!nonZero(merged[key]) && nonZero(sourceStats[key])) merged[key] = sourceStats[key];
  }
  if ((!merged.bestBowling || merged.bestBowling === "0-0") &&
    sourceStats.bestBowling && sourceStats.bestBowling !== "0-0") {
    merged.bestBowling = sourceStats.bestBowling;
  }
  target.stats = merged;
}

function mergeRanking(target, source) {
  for (const field of ADDITIVE_RANKING_FIELDS) {
    target[field] = Number(target[field] || 0) + Number(source[field] || 0);
  }
  for (const field of ["teamBattingRank", "teamBowlingRank"]) {
    if (target[field] == null) target[field] = source[field];
  }
  for (const field of ["teamBattingAvg", "teamBattingSr", "teamEconomy", "teamPlayerRating"]) {
    if (!nonZero(target[field]) && nonZero(source[field])) target[field] = source[field];
  }
  if (source.teamHighestScore > target.teamHighestScore) {
    target.teamHighestScore = source.teamHighestScore;
  }
  const parseBestBowling = (value) => {
    const [wickets, runs] = String(value || "0-0").split("-").map(Number);
    return { wickets: Number(wickets || 0), runs: Number(runs || 0) };
  };
  const targetBest = parseBestBowling(target.teamBestBowling);
  const sourceBest = parseBestBowling(source.teamBestBowling);
  if (
    sourceBest.wickets > targetBest.wickets ||
    (sourceBest.wickets === targetBest.wickets && sourceBest.runs < targetBest.runs)
  ) target.teamBestBowling = source.teamBestBowling;
}

function rowAnswer(row) {
  return String(row.real_name_or_existing_player_id || "").trim();
}

function findNameCandidates(players, answer, teamId) {
  const nameKey = normalizeName(answer);
  return players.filter((player) =>
    idOf(player.team) === teamId && normalizeName(player.name) === nameKey,
  );
}

function resolveTarget(players, answer, teamId) {
  const explicitId = answer.match(/^id:([a-f\d]{24})$/i)?.[1];
  const plainId = OBJECT_ID_PATTERN.test(answer) ? answer : "";
  if (explicitId || plainId) {
    const player = players.find((candidate) =>
      idOf(candidate) === String(explicitId || plainId).toLowerCase(),
    );
    return player
      ? { player }
      : { error: `existing player id "${explicitId || plainId}" was not found` };
  }
  const sameTeam = findNameCandidates(players, answer, teamId);
  if (sameTeam.length === 1) return { player: sameTeam[0] };
  if (sameTeam.length > 1) return { error: `name "${answer}" matches multiple players in this team` };
  const otherTeams = players.filter((player) => normalizeName(player.name) === normalizeName(answer));
  if (otherTeams.length) {
    return { otherTeamCandidates: otherTeams };
  }
  return { player: null };
}

export async function planNameChanges({ rows, players, teams, matches, auditLogs = [], allowCrossTeam = false }) {
  const teamById = new Map(teams.map((team) => [idOf(team), team]));
  const auditsByKey = new Map();
  for (const entry of auditLogs) {
    const key = `${entry.metadata?.sourcePlayerId || ""}::${entry.metadata?.answer || ""}`;
    const previous = auditsByKey.get(key);
    if (
      !previous ||
      ["in_progress", "partial"].includes(entry.metadata?.status) ||
      !["in_progress", "partial"].includes(previous.metadata?.status)
    ) auditsByKey.set(key, entry);
  }
  const plan = [];
  const errors = [];
  const seenSources = new Set();
  for (const [index, row] of rows.entries()) {
    const answer = rowAnswer(row);
    if (!answer) continue;
    const sourceId = String(row.player_id || "").trim().toLowerCase();
    const rowNumber = index + 2;
    if (!OBJECT_ID_PATTERN.test(sourceId)) {
      errors.push(`CSV row ${rowNumber}: invalid player_id "${row.player_id || ""}".`);
      continue;
    }
    if (seenSources.has(sourceId)) {
      errors.push(`CSV row ${rowNumber}: player ${sourceId} has more than one answer.`);
      continue;
    }
    seenSources.add(sourceId);
    const previousAudit = auditsByKey.get(`${sourceId}::${answer}`);
    if (previousAudit) {
      const auditStatus = previousAudit.metadata?.status;
      if (auditStatus === "in_progress" || auditStatus === "partial") {
        errors.push(
          `CSV row ${rowNumber}: a prior ${auditStatus} merge for ${sourceId} -> ${answer} must be reconciled before retrying.`,
        );
        continue;
      }
      plan.push({ rowNumber, sourceId, answer, action: "already-applied", before: "(previously applied)", after: answer });
      continue;
    }
    const source = players.find((player) => idOf(player) === sourceId);
    if (!source) {
      errors.push(`CSV row ${rowNumber}: source player ${sourceId} is missing and no matching audit record proves this row was already applied.`);
      continue;
    }
    const sourceTeamId = idOf(source.team);
    const sourceTeam = teamById.get(sourceTeamId);
    if (!sourceTeam) {
      errors.push(`CSV row ${rowNumber}: source player ${sourceId} has no team in the database.`);
      continue;
    }
    if (normalizeName(row.team_name) !== normalizeName(sourceTeam.name)) {
      errors.push(`CSV row ${rowNumber}: team "${row.team_name}" does not match source team "${sourceTeam.name}".`);
      continue;
    }
    if (normalizeName(row.placeholder_name) !== normalizeName(source.name)) {
      errors.push(`CSV row ${rowNumber}: placeholder name "${row.placeholder_name}" no longer matches "${source.name}".`);
      continue;
    }
    const resolved = resolveTarget(players, answer.replace(/^id:/i, "id:"), sourceTeamId);
    if (resolved.error) {
      errors.push(`CSV row ${rowNumber}: ${resolved.error}.`);
      continue;
    }
    if (resolved.otherTeamCandidates) {
      const rowAllowsCrossTeam = String(row.allow_cross_team || "").trim() === "--allow-cross-team";
      if (!allowCrossTeam || !rowAllowsCrossTeam) {
        errors.push(`CSV row ${rowNumber}: answer matches a player in another team; set allow_cross_team to --allow-cross-team and pass the same CLI option to permit it.`);
        continue;
      }
      if (resolved.otherTeamCandidates.length !== 1) {
        errors.push(`CSV row ${rowNumber}: answer matches multiple players across teams.`);
        continue;
      }
      resolved.player = resolved.otherTeamCandidates[0];
    }
    if (resolved.player && idOf(resolved.player) === sourceId) {
      if (normalizeName(source.name) === normalizeName(answer)) {
        plan.push({
          rowNumber,
          sourceId,
          targetId: sourceId,
          answer,
          action: "already-applied",
          before: source.name,
          after: source.name,
          team: sourceTeam.name,
        });
      } else {
        errors.push(`CSV row ${rowNumber}: source player cannot be its own merge target.`);
      }
      continue;
    }
    const target = resolved.player;
    const action = target ? "merge" : "rename";
    if (target && idOf(target.team) !== sourceTeamId) {
      const rowAllowsCrossTeam = String(row.allow_cross_team || "").trim() === "--allow-cross-team";
      if (!allowCrossTeam || !rowAllowsCrossTeam) {
        errors.push(`CSV row ${rowNumber}: cross-team merge is not explicitly enabled.`);
        continue;
      }
    }
    if (!target) {
      const conflict = findNameCandidates(players, answer, sourceTeamId)
        .some((candidate) => idOf(candidate) !== sourceId);
      if (conflict) {
        errors.push(`CSV row ${rowNumber}: "${answer}" already exists in "${sourceTeam.name}".`);
        continue;
      }
    }
    plan.push({
      rowNumber,
      sourceId,
      targetId: target ? idOf(target) : sourceId,
      answer,
      action,
      before: source.name,
      after: target ? target.name : answer,
      team: sourceTeam.name,
      crossTeam: Boolean(target && idOf(target.team) !== sourceTeamId),
    });
  }

  const changedMerges = plan.filter((item) => item.action === "merge");
  const sourceTargets = new Map(changedMerges.map((item) => [item.sourceId, item.targetId]));
  const mergeSources = new Set(changedMerges.map((item) => item.sourceId));
  const renameSources = new Set(plan.filter((item) => item.action === "rename").map((item) => item.sourceId));
  for (const item of changedMerges) {
    if (mergeSources.has(item.targetId)) {
      errors.push(`CSV row ${item.rowNumber}: merge chains/cycles are not supported; choose a final existing player that has no other merge row.`);
    }
    if (renameSources.has(item.targetId)) {
      errors.push(`CSV row ${item.rowNumber}: a merge target cannot also be renamed in the same CSV run.`);
    }
  }
  for (const item of plan.filter((entry) => entry.action === "rename")) {
    const anotherRename = plan.find((candidate) =>
      candidate.action === "rename" &&
      candidate.sourceId !== item.sourceId &&
      normalizeName(candidate.after) === normalizeName(item.after) &&
      normalizeName(candidate.team) === normalizeName(item.team),
    );
    if (anotherRename) {
      errors.push(`CSV row ${item.rowNumber}: multiple rows would create the same name "${item.after}" in "${item.team}".`);
    }
  }
  if (!errors.length) {
    for (const match of matches) {
      const issue = inningsHasDuplicateScoreRows(match, sourceTargets);
      if (issue) errors.push(`Match ${idOf(match)}: ${issue}`);
    }
  }
  return { plan, errors };
}

function containsPlayerId(value, playerId) {
  if (value == null) return false;
  if (typeof value === "string") return value.toLowerCase() === playerId;
  if (value instanceof mongoose.Types.ObjectId) return value.toString().toLowerCase() === playerId;
  if (Array.isArray(value)) return value.some((entry) => containsPlayerId(entry, playerId));
  if (typeof value === "object") {
    if (value._bsontype === "ObjectId") return value.toString().toLowerCase() === playerId;
    return Object.values(value).some((entry) => containsPlayerId(entry, playerId));
  }
  return false;
}

function collectPlayerReferencePaths(value, playerId, basePath = "", paths = []) {
  if (value == null) return paths;
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectPlayerReferencePaths(entry, playerId, `${basePath}[${index}]`, paths));
  } else if (value instanceof mongoose.Types.ObjectId || value?._bsontype === "ObjectId") {
    if (value.toString().toLowerCase() === playerId && basePath) paths.push(basePath);
  } else if (typeof value === "string") {
    if (value.toLowerCase() === playerId && basePath) paths.push(basePath);
  } else if (typeof value === "object" && !(value instanceof Date)) {
    for (const [key, entry] of Object.entries(value)) {
      if (key !== "__v") {
        collectPlayerReferencePaths(entry, playerId, basePath ? `${basePath}.${key}` : key, paths);
      }
    }
  }
  return paths;
}

async function hasUnresolvedReferences(playerId) {
  const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
  for (const { name } of collections) {
    if (name === AuditLog.collection.collectionName) continue;
    const cursor = mongoose.connection.db.collection(name).find({
      _id: { $ne: new mongoose.Types.ObjectId(playerId) },
    });
    for await (const document of cursor) {
      if (containsPlayerId(document, playerId)) return true;
    }
  }
  return false;
}

async function rewriteDocumentReferences(model, playerId, targetId, fields, counts) {
  // Each reference is rewritten independently. A document that matches on one
  // field must never have its other player fields overwritten.
  for (const field of fields) {
    const path = typeof field === "string" ? field : field.path;
    const filter = { ...(typeof field === "string" ? {} : field.filter || {}), [path]: playerId };
    try {
      const result = await model.updateMany(filter, { $set: { [path]: targetId } });
      const modified = Number(result.modifiedCount ?? result.nModified ?? 0);
      addCount(counts, model.collection.collectionName, modified);
    } catch (error) {
      throw new Error(
        `Failed to rewrite ${model.collection.collectionName}.${path} from ${playerId} to ${targetId}; completed counts: ${JSON.stringify(counts)}; ${error.message}`,
        { cause: error },
      );
    }
  }
}

/**
 * Rewrite every occurrence of `playerId` inside an ObjectId array. arrayFilters
 * updates only the matching elements and leaves every other element untouched.
 */
export async function rewriteArrayReference(model, path, playerId, targetId, extraFilter = {}) {
  try {
    const result = await model.updateMany(
      { ...extraFilter, [path]: playerId },
      { $set: { [`${path}.$[player]`]: targetId } },
      { arrayFilters: [{ player: playerId }] },
    );
    return Number(result.modifiedCount ?? result.nModified ?? 0);
  } catch (error) {
    throw new Error(
      `Failed to rewrite ${model.collection.collectionName}.${path} from ${playerId} to ${targetId}: ${error.message}`,
      { cause: error },
    );
  }
}

// Every model field that can point at a Player. Match, Event, Tournament, Team
// and Player.relations are handled by the dedicated helpers below because they
// need team-aware or nested-array logic.
const DIRECT_PLAYER_REFERENCE_FIELDS = [
  {
    model: Delivery,
    fields: ["batsmanId", "bowlerId", "nonStrikerId", "fielderId"],
  },
  {
    model: Ball,
    fields: ["batsman", "bowler", "fieldedBy"],
  },
  {
    model: Partnership,
    fields: ["batsman1Id", "batsman2Id"],
  },
  {
    model: Review,
    fields: ["playerReviewed"],
  },
  {
    model: Blog,
    fields: [{ path: "relatedId", filter: { relatedType: "Player" } }],
  },
  {
    model: CommunityPost,
    fields: [{ path: "subject.ref", filter: { "subject.type": "player" } }],
  },
];

function addCount(counts, collection, value) {
  const count = Number(value || 0);
  if (!count) return;
  counts[collection] = (counts[collection] || 0) + count;
}

async function updatePlayerRelations(sourceId, targetId) {
  try {
    const result = await Player.updateMany(
      { "relations.player": sourceId },
      { $set: { "relations.$[relation].player": targetId } },
      { arrayFilters: [{ "relation.player": sourceId }] },
    );
    return Number(result.modifiedCount ?? result.nModified ?? 0);
  } catch (error) {
    throw new Error(
      `Failed to rewrite ${Player.collection.collectionName}.relations.player from ${sourceId} to ${targetId}: ${error.message}`,
      { cause: error },
    );
  }
}

async function updateTeams(sourceId, targetId, targetTeamId, counts) {
  const teams = await Team.find({});
  let changedCount = 0;
  for (const team of teams) {
    let changed = false;
    if ((team.players || []).some((player) => idOf(player) === sourceId)) {
      team.players = [...new Set(team.players.map(idOf)
        .flatMap((id) => id === sourceId ? (idOf(team) === targetTeamId ? [targetId] : []) : [id]))];
      changed = true;
    }
    for (const field of ["captain", "viceCaptain"]) {
      if (idOf(team[field]) === sourceId) {
        team[field] = targetId;
        changed = true;
      }
    }
    if (changed) {
      try {
        await team.save();
      } catch (error) {
        throw new Error(
          `Failed to save Team ${idOf(team)} while rewriting ${sourceId} to ${targetId}: ${error.message}`,
          { cause: error },
        );
      }
      changedCount += 1;
      addCount(counts, Team.collection.collectionName, 1);
    }
  }
  return changedCount;
}

async function updateEventsAndTournaments(sourceId, targetId, counts) {
  for (const [model, nestedFields] of [
    [Event, ["eventSquads"]],
    [Tournament, ["tournamentSquads"]],
  ]) {
    const documents = await model.find({});
    for (const document of documents) {
      if (!JSON.stringify(document).includes(sourceId)) continue;
      let changed = false;
      for (const squadField of nestedFields) {
        for (const squad of document[squadField] || []) {
          if (Array.isArray(squad.players) && squad.players.some((player) => idOf(player) === sourceId)) {
            squad.players = [...new Set(squad.players.map(idOf).map((id) => id === sourceId ? targetId : id))];
            changed = true;
          }
          for (const field of ["captain", "viceCaptain"]) {
            if (idOf(squad[field]) === sourceId) {
              squad[field] = targetId;
              changed = true;
            }
          }
          if (Array.isArray(squad.wicketKeepers) && squad.wicketKeepers.some((player) => idOf(player) === sourceId)) {
            squad.wicketKeepers = [...new Set(squad.wicketKeepers.map(idOf).map((id) => id === sourceId ? targetId : id))];
            changed = true;
          }
          for (const change of squad.playerChanges || []) {
            for (const field of ["outPlayer", "inPlayer"]) {
              if (idOf(change[field]) === sourceId) {
                change[field] = targetId;
                changed = true;
              }
            }
          }
        }
      }
      if (model === Tournament && document.awards) {
        for (const field of ["playerOfTournament", "bestBatsman", "bestBowler"]) {
          if (idOf(document.awards[field]) === sourceId) {
            document.awards[field] = targetId;
            changed = true;
          }
        }
      }
      if (changed) {
        try {
          await document.save();
        } catch (error) {
          throw new Error(
            `Failed to save ${model.collection.collectionName} document ${idOf(document)} while rewriting ${sourceId} to ${targetId}: ${error.message}`,
            { cause: error },
          );
        }
        addCount(counts, model.collection.collectionName, 1);
      }
    }
  }
  return undefined;
}

async function updateMatchReferences(sourceId, targetId, counts) {
  const matches = await Match.find({});
  let changedCount = 0;
  for (const match of matches) {
    if (!JSON.stringify(match).includes(sourceId)) continue;
    rewriteMatchPlayerReferences(match, sourceId, targetId);
    try {
      await match.save();
    } catch (error) {
      throw new Error(
        `Failed to save Match ${idOf(match)} while rewriting ${sourceId} to ${targetId}: ${error.message}`,
        { cause: error },
      );
    }
    changedCount += 1;
    addCount(counts, Match.collection.collectionName, 1);
  }
  return changedCount;
}

async function updateRankings(sourceId, targetId, counts) {
  const sourceRows = await TeamPlayerRanking.find({ player: sourceId });
  let changedCount = 0;
  for (const source of sourceRows) {
    const target = await TeamPlayerRanking.findOne({ team: source.team, player: targetId });
    if (target) {
      mergeRanking(target, source);
      try {
        await target.save();
        addCount(counts, TeamPlayerRanking.collection.collectionName, 1);
        await source.deleteOne();
        addCount(counts, TeamPlayerRanking.collection.collectionName, 1);
      } catch (error) {
        throw new Error(
          `Failed to merge TeamPlayerRanking ${idOf(source)} into ${idOf(target)}: ${error.message}`,
          { cause: error },
        );
      }
    } else {
      source.player = targetId;
      try {
        await source.save();
      } catch (error) {
        throw new Error(
          `Failed to rewrite TeamPlayerRanking ${idOf(source)} from ${sourceId} to ${targetId}: ${error.message}`,
          { cause: error },
        );
      }
      addCount(counts, TeamPlayerRanking.collection.collectionName, 1);
    }
    changedCount += 1;
  }
  return changedCount;
}

async function applyMerge(source, target) {
  const sourceId = idOf(source);
  const targetId = idOf(target);
  const counts = {};
  try {
    mergePlayerStats(target, source);
    addCount(counts, Player.collection.collectionName, await updatePlayerRelations(sourceId, targetId));
    await updateTeams(sourceId, targetId, idOf(target.team), counts);
    await updateEventsAndTournaments(sourceId, targetId, counts);
    await updateMatchReferences(sourceId, targetId, counts);
    for (const targetSpec of DIRECT_PLAYER_REFERENCE_FIELDS) {
      for (const field of targetSpec.fields) {
        await rewriteDocumentReferences(targetSpec.model, sourceId, targetId, [field], counts);
      }
    }
    await updateRankings(sourceId, targetId, counts);
    try {
      await target.save();
    } catch (error) {
      throw new Error(
        `Failed to save merged Player ${targetId}: ${error.message}`,
        { cause: error },
      );
    }
    addCount(counts, Player.collection.collectionName, 1);

    const team = await Team.findById(source.team);
    if (team) {
      let changed = false;
      const players = (team.players || []).filter((player) => idOf(player) !== sourceId);
      if (players.length !== (team.players || []).length) {
        team.players = players;
        changed = true;
      }
      if (idOf(team.captain) === sourceId) {
        team.captain = targetId;
        changed = true;
      }
      if (idOf(team.viceCaptain) === sourceId) {
        team.viceCaptain = targetId;
        changed = true;
      }
      if (changed) {
        try {
          await team.save();
        } catch (error) {
          throw new Error(
            `Failed to save Team ${idOf(team)} while rewriting ${sourceId} to ${targetId}: ${error.message}`,
            { cause: error },
          );
        }
        addCount(counts, Team.collection.collectionName, 1);
      }
    }
    const unresolved = await hasUnresolvedReferences(sourceId);
    if (!unresolved) {
      try {
        await source.deleteOne();
      } catch (error) {
        throw new Error(
          `Failed to delete merged placeholder Player ${sourceId}: ${error.message}`,
          { cause: error },
        );
      }
      addCount(counts, Player.collection.collectionName, 1);
    }
    return { deleted: !unresolved, counts };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    failure.partialCounts = { ...counts };
    throw failure;
  }
}

/**
 * Read-only preview of every reference collection/field a merge of
 * `sourcePlayerIds` would touch. Used by the dry run so the operator can see
 * the write surface before adding --apply.
 */
export async function previewMergeReferences(sourcePlayerIds) {
  const rows = [];
  const matches = await Match.find({}).lean();
  const countFields = async (model, playerId, fields) => {
    for (const field of fields) {
      const matched = await model.countDocuments({ [field]: playerId });
      if (matched) rows.push({
        playerId,
        collection: model.collection.collectionName,
        field,
        matched,
      });
    }
  };
  for (const playerId of sourcePlayerIds) {
    for (const targetSpec of DIRECT_PLAYER_REFERENCE_FIELDS) {
      const collection = targetSpec.model.collection.collectionName;
      for (const field of targetSpec.fields) {
        const path = typeof field === "string" ? field : field.path;
        const filter = { ...(typeof field === "string" ? {} : field.filter || {}), [path]: playerId };
        const matched = await targetSpec.model.countDocuments(filter);
        if (matched) rows.push({ playerId, collection, field: path, matched });
      }
    }

    const matchCounts = new Map();
    for (const match of matches) {
      for (const field of collectPlayerReferencePaths(match, playerId)) {
        const normalized = field.replace(/\[\d+\]/g, "[]");
        matchCounts.set(normalized, (matchCounts.get(normalized) || 0) + 1);
      }
    }
    for (const [field, matched] of matchCounts) {
      rows.push({ playerId, collection: Match.collection.collectionName, field, matched });
    }

    await countFields(Player, playerId, ["relations.player"]);
    await countFields(Team, playerId, ["players", "captain", "viceCaptain"]);
    await countFields(Event, playerId, [
      "eventSquads.players",
      "eventSquads.captain",
      "eventSquads.viceCaptain",
      "eventSquads.wicketKeepers",
      "eventSquads.playerChanges.outPlayer",
      "eventSquads.playerChanges.inPlayer",
    ]);
    await countFields(Tournament, playerId, [
      "tournamentSquads.players",
      "tournamentSquads.captain",
      "tournamentSquads.viceCaptain",
      "tournamentSquads.wicketKeepers",
      "tournamentSquads.playerChanges.outPlayer",
      "tournamentSquads.playerChanges.inPlayer",
      "awards.playerOfTournament",
      "awards.bestBatsman",
      "awards.bestBowler",
    ]);
    await countFields(TeamPlayerRanking, playerId, ["player"]);
  }
  return rows;
}

async function applyRename(source, name) {
  source.name = name;
  await source.save();
}

export async function applyPlan(plan) {
  const results = [];
  const playerCache = new Map();
  for (const item of plan) {
    if (item.action === "already-applied") {
      results.push({ ...item, result: "already applied" });
      continue;
    }
    let auditEntry;
    let partialCounts = {};
    try {
      auditEntry = await AuditLog.create({
        actorType: "system",
        actorLabel: "player-name-cleanup-script",
        action: AUDIT_ACTION,
        targetType: "Player",
        targetId: item.targetId,
        targetLabel: item.after,
        metadata: {
          sourcePlayerId: item.sourceId,
          targetPlayerId: item.targetId,
          originalName: item.before,
          answer: item.answer,
          operation: item.action,
          status: "in_progress",
          counts: {},
        },
      });
      const source = playerCache.get(item.sourceId) || await Player.findById(item.sourceId);
      if (!source) throw new Error(`Validated source player ${item.sourceId} disappeared before writing.`);
      if (item.action === "rename") {
        await applyRename(source, item.after);
        playerCache.set(item.sourceId, source);
        results.push({ ...item, result: "renamed in place" });
      } else {
        const target = playerCache.get(item.targetId) || await Player.findById(item.targetId);
        if (!target) throw new Error(`Validated target player ${item.targetId} disappeared before writing.`);
        const outcome = await applyMerge(source, target);
        partialCounts = outcome.counts;
        playerCache.set(item.targetId, target);
        results.push({
          ...item,
          result: outcome.deleted ? "merged and deleted placeholder" : "merged; placeholder retained due to remaining reference",
          counts: outcome.counts,
        });
      }
      auditEntry.metadata = {
        ...(auditEntry.metadata?.toObject?.() || auditEntry.metadata || {}),
        status: "completed",
        counts: partialCounts,
      };
      await auditEntry.save();
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      partialCounts = failure.partialCounts || partialCounts;
      if (auditEntry) {
        auditEntry.metadata = {
          ...(auditEntry.metadata?.toObject?.() || auditEntry.metadata || {}),
          status: "partial",
          counts: partialCounts,
          error: failure.message,
        };
        try {
          await auditEntry.save();
        } catch (auditError) {
          failure.message += `; also failed to record partial status in audit entry ${idOf(auditEntry)}: ${auditError.message}`;
        }
      }
      throw new Error(
        `Merge aborted at CSV row ${item.rowNumber} (${item.action} ${item.sourceId} -> ${item.targetId}). No later rows were processed. Partial collection counts: ${JSON.stringify(partialCounts)}. ${failure.message}`,
        { cause: failure },
      );
    }
  }
  if (results.some((result) => result.action !== "already-applied")) invalidateTournamentStatsCache();
  return results;
}

export async function main(args = process.argv.slice(2)) {
  const uri = process.env.MONGO_URL;
  if (!uri) throw new Error("MONGO_URL is not set. The script never prints or accepts the URI on the command line.");
  const fileIndex = args.findIndex((arg) => arg === "--file" || arg.startsWith("--file="));
  const csvPath = fileIndex < 0
    ? ""
    : args[fileIndex].includes("=")
      ? args[fileIndex].slice(args[fileIndex].indexOf("=") + 1)
      : args[fileIndex + 1] && !args[fileIndex + 1].startsWith("--")
        ? args[fileIndex + 1]
        : "";
  if (!csvPath) throw new Error("Usage: node src/scripts/applyPlayerNames.js --file <review.csv> [--apply] [--force-test] [--allow-cross-team]");
  const forceTest = args.includes("--force-test");
  const apply = args.includes("--apply");
  const { databaseName, isDisposable } = validateDatabaseTarget(uri, { forceTest });
  if (forceTest && databaseName !== "cric-all-e2e") {
    throw new Error("--force-test is restricted to cric-all-e2e.");
  }
  if (forceTest && apply && !isDisposable) {
    throw new Error("Writing with --force-test is restricted to loopback cric-all-e2e.");
  }
  const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
  const required = ["player_id", "placeholder_name", "team_name", "real_name_or_existing_player_id"];
  if (!rows.length || required.some((field) => !hasOwn(rows[0], field))) {
    throw new Error(`CSV must include: ${required.join(", ")}.`);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });
  try {
    const [players, teams, matches, auditLogs] = await Promise.all([
      Player.find({}),
      Team.find({}),
      Match.find({}),
      AuditLog.find({ action: AUDIT_ACTION }),
    ]);
    const { plan, errors } = await planNameChanges({
      rows,
      players,
      teams,
      matches,
      auditLogs,
      allowCrossTeam: args.includes("--allow-cross-team"),
    });
    console.log(`Database target: ${databaseName}`);
    console.table(plan.map(({ sourceId, action, before, after, team, answer }) => ({
      player_id: sourceId,
      team,
      before,
      action,
      after,
      answer,
    })));
    if (errors.length) {
      console.error("Validation blocked all changes:");
      for (const error of errors) console.error(`- ${error}`);
      process.exitCode = 1;
      return;
    }
    if (!apply) {
      const mergeSources = plan
        .filter((item) => item.action === "merge")
        .map((item) => item.sourceId);
      if (mergeSources.length) {
        const preview = await previewMergeReferences(mergeSources);
        console.log("\nReference collections/fields a merge would rewrite (read-only counts):");
        console.table(preview);
      } else {
        console.log("\nNo merge rows in this plan; only in-place renames would be written.");
      }
      console.log("Dry run only. No database writes were made. Add --apply to execute this validated plan.");
      return;
    }
    const results = await applyPlan(plan);
    console.log("\nApplied results:");
    console.table(results.map(({ sourceId, action, before, after, result, counts }) => ({
      player_id: sourceId,
      action,
      before,
      after,
      result,
      references: counts
        ? Object.entries(counts).map(([collection, count]) => `${collection}:${count}`).join(", ")
        : "",
    })));
    console.log("Merge stats cache invalidated where required; audit entries were written.");
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Player-name cleanup failed: ${error.message}`);
    process.exitCode = 1;
  });
}
