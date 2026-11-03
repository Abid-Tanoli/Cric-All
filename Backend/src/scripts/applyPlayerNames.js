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
  const auditKeys = new Set(auditLogs.map((entry) =>
    `${entry.metadata?.sourcePlayerId || ""}::${entry.metadata?.answer || ""}`,
  ));
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
    if (auditKeys.has(`${sourceId}::${answer}`)) {
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

async function hasUnresolvedReferences(playerId) {
  const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
  for (const { name } of collections) {
    if (name === Player.collection.collectionName || name === AuditLog.collection.collectionName) continue;
    const cursor = mongoose.connection.db.collection(name).find({});
    for await (const document of cursor) {
      if (containsPlayerId(document, playerId)) return true;
    }
  }
  return false;
}

async function rewriteDocumentReferences(model, playerId, targetId, fields) {
  const filter = { $or: fields.map((field) => ({ [field]: playerId })) };
  const update = { $set: Object.fromEntries(fields.map((field) => [field, targetId])) };
  await model.updateMany(filter, update);
}

async function updatePlayerRelations(sourceId, targetId) {
  const players = await Player.find({});
  for (const player of players) {
    if (idOf(player) === sourceId) continue;
    let changed = false;
    for (const relation of player.relations || []) {
      if (idOf(relation.player) !== sourceId) continue;
      relation.player = targetId;
      changed = true;
    }
    if (changed) await player.save();
  }
}

async function updateTeams(sourceId, targetId, targetTeamId) {
  const teams = await Team.find({});
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
    if (changed) await team.save();
  }
}

async function updateEventsAndTournaments(sourceId, targetId) {
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
      if (changed) await document.save();
    }
  }
}

async function updateMatchReferences(sourceId, targetId) {
  const matches = await Match.find({});
  for (const match of matches) {
    if (!JSON.stringify(match).includes(sourceId)) continue;
    rewriteMatchPlayerReferences(match, sourceId, targetId);
    await match.save();
  }
}

async function updateRankings(sourceId, targetId) {
  const sourceRows = await TeamPlayerRanking.find({ player: sourceId });
  for (const source of sourceRows) {
    const target = await TeamPlayerRanking.findOne({ team: source.team, player: targetId });
    if (target) {
      mergeRanking(target, source);
      await target.save();
      await source.deleteOne();
    } else {
      source.player = targetId;
      await source.save();
    }
  }
}

async function applyMerge(source, target) {
  const sourceId = idOf(source);
  const targetId = idOf(target);
  mergePlayerStats(target, source);
  await updatePlayerRelations(sourceId, targetId);
  await updateTeams(sourceId, targetId, idOf(target.team));
  await updateEventsAndTournaments(sourceId, targetId);
  await updateMatchReferences(sourceId, targetId);
  await rewriteDocumentReferences(Delivery, sourceId, targetId, [
    "batsmanId", "bowlerId", "nonStrikerId", "fielderId",
  ]);
  await rewriteDocumentReferences(Ball, sourceId, targetId, ["batsman", "bowler", "fieldedBy"]);
  await rewriteDocumentReferences(Partnership, sourceId, targetId, ["batsman1Id", "batsman2Id"]);
  await rewriteDocumentReferences(Review, sourceId, targetId, ["playerReviewed"]);
  await updateRankings(sourceId, targetId);
  await target.save();

  const team = await Team.findById(source.team);
  if (team) {
    team.players = (team.players || []).filter((player) => idOf(player) !== sourceId);
    if (idOf(team.captain) === sourceId) team.captain = targetId;
    if (idOf(team.viceCaptain) === sourceId) team.viceCaptain = targetId;
    await team.save();
  }
  const unresolved = await hasUnresolvedReferences(sourceId);
  if (!unresolved) await source.deleteOne();
  return { deleted: !unresolved };
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
      playerCache.set(item.targetId, target);
      results.push({ ...item, result: outcome.deleted ? "merged and deleted placeholder" : "merged; placeholder retained due to remaining reference" });
    }
    await AuditLog.create({
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
      },
    });
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
      console.log("Dry run only. No database writes were made. Add --apply to execute this validated plan.");
      return;
    }
    const results = await applyPlan(plan);
    console.log("\nApplied results:");
    console.table(results.map(({ sourceId, action, before, after, result }) => ({
      player_id: sourceId,
      action,
      before,
      after,
      result,
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
