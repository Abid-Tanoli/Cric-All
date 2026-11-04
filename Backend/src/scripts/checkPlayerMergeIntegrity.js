// Read-only player reference audit:
//   node src/scripts/checkPlayerMergeIntegrity.js --player <playerId>
//   node src/scripts/checkPlayerMergeIntegrity.js --player <playerId> --tournament <tournamentId>
//   node src/scripts/checkPlayerMergeIntegrity.js --player <playerId> --json
//
// This script never writes. It lists every Match (innings, legacy top-level
// fields, XI/squad/roles), Ball, Delivery, Partnership, Review, Blog,
// CommunityPost, Team, Event, Tournament, Player relation and ranking reference
// to the target player, grouped by match. It flags non-manual matches, orphan
// match ids, duplicate scorecard rows, the same player on both sides, and legacy
// top-level Match references so a merge can be reviewed before it is run.

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
import { getMongoTarget } from "../utils/mongoTarget.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(SCRIPT_DIR, "../..");
dotenv.config({ path: path.join(BACKEND_ROOT, ".env"), quiet: true });

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

const DIRECT_REFERENCES = [
  { model: Delivery, fields: ["batsmanId", "bowlerId", "nonStrikerId", "fielderId"] },
  { model: Ball, fields: ["batsman", "bowler", "fieldedBy"] },
  { model: Partnership, fields: ["batsman1Id", "batsman2Id"] },
  { model: Review, fields: ["playerReviewed"] },
];

const GLOBAL_REFERENCES = [
  {
    model: Team,
    fields: ["players", "captain", "viceCaptain"],
  },
  {
    model: Event,
    fields: [
      "eventSquads.players",
      "eventSquads.captain",
      "eventSquads.viceCaptain",
      "eventSquads.wicketKeepers",
      "eventSquads.playerChanges.outPlayer",
      "eventSquads.playerChanges.inPlayer",
    ],
  },
  {
    model: Tournament,
    fields: [
      "tournamentSquads.players",
      "tournamentSquads.captain",
      "tournamentSquads.viceCaptain",
      "tournamentSquads.wicketKeepers",
      "tournamentSquads.playerChanges.outPlayer",
      "tournamentSquads.playerChanges.inPlayer",
      "awards.playerOfTournament",
      "awards.bestBatsman",
      "awards.bestBowler",
    ],
  },
  {
    model: Player,
    fields: ["relations.player"],
  },
  {
    model: TeamPlayerRanking,
    fields: ["player"],
  },
  {
    model: Blog,
    fields: ["relatedId"],
    extraFilter: { relatedType: "Player" },
  },
  {
    model: CommunityPost,
    fields: ["subject.ref"],
    extraFilter: { "subject.type": "player" },
  },
];

const idOf = (value) => String(value?._id || value || "");
const isObjectId = (value) =>
  value instanceof mongoose.Types.ObjectId ||
  value?._bsontype === "ObjectId" ||
  (typeof value === "object" && value?.constructor?.name === "ObjectId");
const idMatches = (value, playerId) =>
  (typeof value === "string" || isObjectId(value)) && idOf(value).toLowerCase() === playerId;

/**
 * Collect every path in a document whose value is the target player id. This
 * deliberately includes arrays (ObjectId arrays and arrays of subdocuments) so
 * a newly added reference shape is visible without changing the checker.
 */
export function collectPlayerPaths(value, playerId, basePath = "", paths = []) {
  if (value == null) return paths;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectPlayerPaths(entry, playerId, `${basePath}[${index}]`, paths);
    });
    return paths;
  }
  if (isObjectId(value) || typeof value === "string") {
    if (idMatches(value, playerId) && basePath) paths.push(basePath);
    return paths;
  }
  if (typeof value === "object" && !(value instanceof Date)) {
    for (const [key, entry] of Object.entries(value)) {
      if (key === "__v") continue;
      collectPlayerPaths(entry, playerId, basePath ? `${basePath}.${key}` : key, paths);
    }
  }
  return paths;
}

function matchLabelOf(match) {
  return String(match?.stageLabel || match?.title || match?._id || "Unlabelled");
}

function pushMatchReference(groups, matchId, reference) {
  const key = matchId || "(no match)";
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(reference);
}

function addSuspicion(matchReport, code, message) {
  if (!matchReport.suspicious.some((entry) => entry.code === code && entry.message === message)) {
    matchReport.suspicious.push({ code, message });
  }
}

function inspectMatchDocument(match, playerId, report) {
  const paths = collectPlayerPaths(match, playerId);
  for (const field of paths) {
    report.references.push({
      collection: Match.collection.collectionName,
      field,
      documentId: idOf(match),
      matchId: idOf(match),
    });
    if (["batsmanOnStrike", "batsmanNonStrike", "bowler"].includes(field)) {
      addSuspicion(
        report,
        "LEGACY_TOP_LEVEL_FIELD",
        `Match.${field} is a legacy top-level player reference; the merge rewrites it, but the source is probably an old import.`,
      );
    }
  }

  const addDuplicateRows = (innings, label) => {
    for (const field of ["batting", "bowling"]) {
      const count = (innings?.[field] || []).filter((row) => idOf(row?.player) === playerId).length;
      if (count > 1) {
        addSuspicion(
          report,
          "DUPLICATE_SCORECARD_ROW",
          `${label} has ${count} ${field} rows for the target player.`,
        );
      }
    }
    const batting = (innings?.batting || []).some((row) => idOf(row?.player) === playerId);
    const bowling = (innings?.bowling || []).some((row) => idOf(row?.player) === playerId);
    if (batting && bowling) {
      addSuspicion(
        report,
        "BATTING_AND_BOWLING_SAME_INNINGS",
        `${label} lists the target player on both the batting and bowling cards.`,
      );
    }
  };
  (match.innings || []).forEach((innings, index) => addDuplicateRows(innings, `innings[${index}]`));
  (match.superOvers || []).forEach((over, overIndex) => {
    (over.innings || []).forEach((innings, index) =>
      addDuplicateRows(innings, `superOvers[${overIndex}].innings[${index}]`));
  });

  const teams = new Map();
  const addTeam = (team, section) => {
    const teamId = idOf(team);
    if (!teamId) return;
    if (!teams.has(teamId)) teams.set(teamId, new Set());
    teams.get(teamId).add(section);
  };
  for (const group of match.playingXI || []) {
    if ((group.players || []).some((player) => idOf(player) === playerId)) addTeam(group.team, "playingXI");
  }
  for (const group of match.squad15 || []) {
    if ((group.players || []).some((player) => idOf(player) === playerId)) addTeam(group.team, "squad15");
  }
  for (const group of match.bowlingXI || []) {
    if ((group.players || []).some((player) => idOf(player) === playerId)) addTeam(group.team, "bowlingXI");
  }
  for (const entry of match.twelfthMan || []) {
    if (idOf(entry.player) === playerId) addTeam(entry.team, "twelfthMan");
  }
  for (const entry of match.impactPlayers || []) {
    if (idOf(entry.player) === playerId || idOf(entry.replaces) === playerId) addTeam(entry.team, "impactPlayers");
  }
  for (const entry of match.teamRoles || []) {
    if (idOf(entry.captain) === playerId || idOf(entry.viceCaptain) === playerId ||
      (entry.wicketKeepers || []).some((player) => idOf(player) === playerId)) {
      addTeam(entry.team, "teamRoles");
    }
  }
  if (teams.size > 1) {
    addSuspicion(
      report,
      "PLAYER_ON_BOTH_TEAMS",
      `Target player appears for ${teams.size} teams (${[...teams.keys()].join(", ")}).`,
    );
  }

  const matchTeamIds = new Set((match.teams || []).map(idOf));
  for (const teamId of teams.keys()) {
    if (matchTeamIds.size && !matchTeamIds.has(teamId)) {
      addSuspicion(report, "TEAM_NOT_IN_MATCH", `Player is named for team ${teamId}, which is not in Match.teams.`);
    }
  }
}

function inspectDirectDocument(document, field, collection, matchById, groups, reports) {
  const matchId = idOf(document.matchId);
  const matchReport = matchById.get(matchId);
  pushMatchReference(groups, matchId, {
    collection,
    field,
    documentId: idOf(document),
    matchId,
    matchFound: Boolean(matchReport),
    detail: [
      document.inning != null ? `inning ${document.inning}` : "",
      document.over != null || document.overNumber != null
        ? `over ${document.over ?? document.overNumber}`
        : "",
      document.ball != null || document.ballNumber != null
        ? `ball ${document.ball ?? document.ballNumber}`
        : "",
      document.wicketNumber != null ? `wicket ${document.wicketNumber}` : "",
    ].filter(Boolean).join(", "),
  });
  if (!matchReport) {
    pushMatchReference(groups, matchId, {
      collection: "suspicious",
      field: "ORPHAN_MATCH",
      documentId: idOf(document),
      matchId,
      detail: `${collection}.${field} points at a match that is not in the selected set.`,
    });
    if (matchId) {
      reports.push({
        code: "ORPHAN_MATCH",
        message: `${collection} ${idOf(document)}.${field} references match ${matchId}, which is missing or outside --tournament.`,
      });
    }
  }
  if (collection === Delivery.collection.collectionName || collection === Ball.collection.collectionName) {
    const batsmanField = collection === Delivery.collection.collectionName ? "batsmanId" : "batsman";
    const bowlerField = collection === Delivery.collection.collectionName ? "bowlerId" : "bowler";
    const nonStrikerField = collection === Delivery.collection.collectionName ? "nonStrikerId" : "batsmanNonStrike";
    const fielderField = collection === Delivery.collection.collectionName ? "fielderId" : "fieldedBy";
    if (idOf(document[batsmanField]) && idOf(document[batsmanField]) === idOf(document[bowlerField])) {
      reports.push({
        code: "SAME_BATSMAN_AND_BOWLER",
        message: `${collection} ${idOf(document)} lists the same player as both batsman and bowler.`,
      });
    }
    if (idOf(document[bowlerField]) && idOf(document[bowlerField]) === idOf(document[nonStrikerField])) {
      reports.push({
        code: "BOWLER_IS_NON_STRIKER",
        message: `${collection} ${idOf(document)} lists the same player as bowler and non-striker.`,
      });
    }
    if (idOf(document[batsmanField]) && idOf(document[batsmanField]) === idOf(document[nonStrikerField])) {
      reports.push({
        code: "BATSMAN_IS_NON_STRIKER",
        message: `${collection} ${idOf(document)} lists the same player as striker and non-striker.`,
      });
    }
    if (idOf(document[batsmanField]) && idOf(document[batsmanField]) === idOf(document[fielderField])) {
      reports.push({
        code: "BATSMAN_AND_FIELDER",
        message: `${collection} ${idOf(document)} lists the same player as both batsman and fielder.`,
      });
    }
  }
}

async function findGlobalReferences(playerId) {
  const found = [];
  const normalizedPath = (field) => field.replace(/\[\d+\]/g, "");
  const matchesSpec = (field, candidates) => {
    const normalized = normalizedPath(field);
    return candidates.some((candidate) =>
      normalized === candidate || normalized.startsWith(`${candidate}.`));
  };
  for (const spec of GLOBAL_REFERENCES) {
    const filter = {
      ...(spec.extraFilter || {}),
      $or: spec.fields.map((field) => ({ [field]: playerId })),
    };
    const documents = await spec.model.find(filter).lean();
    for (const document of documents) {
      const paths = collectPlayerPaths(document, playerId)
        .filter((field) => matchesSpec(field, spec.fields));
      if (!paths.length) continue;
      found.push({
        collection: spec.model.collection.collectionName,
        documentId: idOf(document),
        fields: paths,
        label: document.name || document.title || document.slug || "",
      });
    }
  }
  return found;
}

/**
 * Build the read-only integrity report. The caller owns the mongoose
 * connection, so tests and the CLI share the same implementation.
 */
export async function checkPlayerMergeIntegrity({ playerId, tournamentId = "" }) {
  const normalizedPlayerId = String(playerId || "").trim().toLowerCase();
  if (!OBJECT_ID_PATTERN.test(normalizedPlayerId)) {
    throw new Error(`--player must be a 24-character player id (received "${playerId || ""}").`);
  }
  if (tournamentId && !OBJECT_ID_PATTERN.test(String(tournamentId))) {
    throw new Error(`--tournament must be a 24-character tournament id (received "${tournamentId}").`);
  }

  const player = await Player.findById(normalizedPlayerId).lean();
  if (!player) throw new Error(`Player ${normalizedPlayerId} was not found.`);

  const tournamentFilter = tournamentId ? { tournament: tournamentId } : {};
  const matchDocuments = await Match.find(tournamentFilter).sort({ startAt: 1, _id: 1 }).lean();
  const matchById = new Map(matchDocuments.map((match) => [idOf(match), match]));
  const groups = new Map();
  const matchReportsById = new Map();
  const report = {
    player: {
      id: normalizedPlayerId,
      name: player.name || "",
      teamId: idOf(player.team),
      teamName: "",
    },
    tournamentId: tournamentId || "",
    generatedAt: new Date().toISOString(),
    matches: [],
    otherReferences: [],
    auditHistory: [],
    summary: {
      matchCount: 0,
      referenceCount: 0,
      nonManualMatchCount: 0,
      suspiciousCount: 0,
      otherReferenceCount: 0,
    },
  };
  if (player.team) {
    const team = await Team.findById(player.team).select("name").lean();
    report.player.teamName = team?.name || "";
  }

  for (const match of matchDocuments) {
    const matchId = idOf(match);
    const matchReport = {
      matchId,
      label: matchLabelOf(match),
      source: match.source || "live",
      manual: match.source === "manual",
      nonManual: match.source !== "manual",
      status: match.status || "",
      tournamentId: idOf(match.tournament),
      references: [],
      suspicious: [],
    };
    inspectMatchDocument(match, normalizedPlayerId, matchReport);
    groups.set(matchId, matchReport.references);
    report.matches.push(matchReport);
    matchReportsById.set(matchId, matchReport);
    if (matchReport.nonManual) report.summary.nonManualMatchCount += 1;
  }

  for (const spec of DIRECT_REFERENCES) {
    const filter = { $or: spec.fields.map((field) => ({ [field]: normalizedPlayerId })) };
    const documents = await spec.model.find(filter).lean();
    const collection = spec.model.collection.collectionName;
    for (const document of documents) {
      for (const field of spec.fields) {
        if (idOf(document[field]) !== normalizedPlayerId) continue;
        const suspicious = [];
        inspectDirectDocument(document, field, collection, matchById, groups, suspicious);
        const matchId = idOf(document.matchId);
        const matchReport = matchReportsById.get(matchId);
        if (matchReport) {
          for (const entry of suspicious) {
            if (!matchReport.suspicious.some((existing) => existing.code === entry.code && existing.message === entry.message)) {
              matchReport.suspicious.push(entry);
            }
          }
        } else {
          for (const entry of suspicious) {
            report.matches.push({
              matchId: matchId || "(no match)",
              label: matchId || "(no match)",
              source: "",
              manual: false,
              nonManual: true,
              status: "",
              tournamentId: "",
              references: [],
              suspicious: [entry],
            });
          }
        }
      }
    }
  }

  report.otherReferences = await findGlobalReferences(normalizedPlayerId);

  const knownReferenceKeys = new Set();
  for (const [matchId, references] of groups) {
    for (const reference of references) {
      knownReferenceKeys.add(
        `${reference.collection}:${reference.documentId}:${reference.field}`,
      );
    }
  }
  for (const reference of report.otherReferences) {
    for (const field of reference.fields) {
      knownReferenceKeys.add(
        `${reference.collection}:${reference.documentId}:${field}`,
      );
    }
  }
  const rawMatchFilter = tournamentId ? { tournament: new mongoose.Types.ObjectId(tournamentId) } : {};
  const rawMatchCursor = mongoose.connection.db
    .collection(Match.collection.collectionName)
    .find(rawMatchFilter);
  for await (const rawMatch of rawMatchCursor) {
    const matchId = idOf(rawMatch);
    for (const field of collectPlayerPaths(rawMatch, normalizedPlayerId)) {
      const key = `${Match.collection.collectionName}:${matchId}:${field}`;
      if (knownReferenceKeys.has(key)) continue;
      knownReferenceKeys.add(key);
      pushMatchReference(groups, matchId, {
        collection: Match.collection.collectionName,
        field,
        documentId: matchId,
        matchId,
      });
    }
  }

  const collections = await mongoose.connection.db
    .listCollections({}, { nameOnly: true })
    .toArray();
  for (const { name: collectionName } of collections) {
    if (collectionName === AuditLog.collection.collectionName) continue;
    const cursor = mongoose.connection.db.collection(collectionName).find({});
    for await (const document of cursor) {
      const documentId = idOf(document);
      const fields = collectPlayerPaths(document, normalizedPlayerId)
        .filter((field) => !(collectionName === Player.collection.collectionName && field === "_id"));
      const unreported = fields.filter((field) => {
        const key = `${collectionName}:${documentId}:${field}`;
        if (knownReferenceKeys.has(key)) return false;
        knownReferenceKeys.add(key);
        return true;
      });
      if (!unreported.length) continue;

      const matchId = idOf(document.matchId);
      for (const field of unreported) {
        pushMatchReference(groups, matchId, {
          collection: collectionName,
          field,
          documentId,
          matchId,
          matchFound: Boolean(matchById.get(matchId)),
        });
      }
      report.otherReferences.push({
        collection: collectionName,
        documentId,
        fields: unreported,
        label: document.name || document.title || document.slug || "",
      });
      if (matchId && !matchById.has(matchId)) {
        report.otherReferences[report.otherReferences.length - 1].outsideSelectedMatches = true;
      }
    }
  }

  const knownMatchReports = new Set(report.matches.map((entry) => entry.matchId));
  for (const [matchId, references] of groups) {
    if (knownMatchReports.has(matchId)) continue;
    const suspicious = [{
      code: matchId === "(no match)" ? "REFERENCE_WITHOUT_MATCH" : "ORPHAN_OR_FILTERED_MATCH",
      message: matchId === "(no match)"
        ? "Referenced document has no match id."
        : `Referenced match ${matchId} is missing or outside --tournament.`,
    }];
    report.matches.push({
      matchId,
      label: matchId,
      source: "",
      manual: false,
      nonManual: true,
      status: "",
      tournamentId: "",
      references,
      suspicious,
    });
  }

  const auditLogs = await AuditLog.find({
    $or: [
      { "metadata.sourcePlayerId": normalizedPlayerId },
      { "metadata.targetPlayerId": normalizedPlayerId },
    ],
  }).sort({ createdAt: -1 }).lean();
  report.auditHistory = auditLogs.map((entry) => ({
    id: idOf(entry),
    action: entry.action || "",
    createdAt: entry.createdAt,
    metadata: entry.metadata || {},
  }));

  // A missing match document is only reported once per match id, even when
  // several balls/deliveries point at it.
  const dedupedMatches = [];
  const seenMatchIds = new Set();
  for (const matchReport of report.matches) {
    const key = matchReport.matchId || "(no match)";
    if (seenMatchIds.has(key)) {
      const existing = dedupedMatches.find((entry) => (entry.matchId || "(no match)") === key);
      existing.suspicious.push(...matchReport.suspicious);
      continue;
    }
    seenMatchIds.add(key);
    dedupedMatches.push(matchReport);
  }
  for (const matchReport of dedupedMatches) {
    matchReport.references = groups.get(matchReport.matchId) || matchReport.references;
  }
  report.matches = dedupedMatches;

  report.summary.matchCount = report.matches.length;
  report.summary.referenceCount = report.matches.reduce(
    (total, match) => total + match.references.filter((ref) => ref.collection !== "suspicious").length,
    0,
  );
  report.summary.suspiciousCount = report.matches.reduce(
    (total, match) => total + match.suspicious.length,
    0,
  );
  report.summary.otherReferenceCount = report.otherReferences.length;
  return report;
}

export async function main(args = process.argv.slice(2)) {
  const valueOf = (option) => {
    const index = args.findIndex((arg) => arg === option || arg.startsWith(`${option}=`));
    if (index < 0) return "";
    if (args[index].includes("=")) return args[index].slice(args[index].indexOf("=") + 1);
    const value = args[index + 1] || "";
    return value.startsWith("--") ? "" : value;
  };
  const playerId = valueOf("--player") || valueOf("--player-id") || args.find((arg) => OBJECT_ID_PATTERN.test(arg)) || "";
  const tournamentId = valueOf("--tournament") || valueOf("--tournament-id");
  const json = args.includes("--json");
  if (args.includes("--apply")) {
    throw new Error("This integrity checker is read-only and does not accept --apply.");
  }
  const uri = process.env.MONGO_URL;
  if (!uri) throw new Error("MONGO_URL is not set. The script never prints or accepts the URI on the command line.");
  if (!playerId) {
    throw new Error("Usage: node src/scripts/checkPlayerMergeIntegrity.js --player <playerId> [--tournament <tournamentId>] [--json]");
  }
  const { databaseName } = getMongoTarget(uri);
  if (!databaseName) throw new Error("MONGO_URL must include an explicit database name.");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });
  try {
    const report = await checkPlayerMergeIntegrity({ playerId, tournamentId });
    if (json) {
      console.log(JSON.stringify(report, null, 2));
      return report;
    }
    console.log(`Database target: ${databaseName}`);
    console.log(`Player: ${report.player.name} [${report.player.id}]${report.player.teamName ? ` (${report.player.teamName})` : ""}`);
    if (report.tournamentId) console.log(`Tournament filter: ${report.tournamentId}`);
    console.log(`Matches: ${report.summary.matchCount}; references: ${report.summary.referenceCount}; non-manual matches: ${report.summary.nonManualMatchCount}; suspicious rows: ${report.summary.suspiciousCount}`);
    console.log("\nMatches (grouped references):");
    for (const match of report.matches) {
      const flags = [
        match.manual ? "manual" : "NON-MANUAL",
        match.status,
        match.tournamentId ? `tournament ${match.tournamentId}` : "",
      ].filter(Boolean).join("; ");
      console.log(`- ${match.label} [${match.matchId}] ${flags ? `(${flags})` : ""}`);
      for (const reference of match.references.filter((entry) => entry.collection !== "suspicious")) {
        console.log(`    ${reference.collection}.${reference.field}${reference.documentId ? ` doc ${reference.documentId}` : ""}${reference.detail ? ` (${reference.detail})` : ""}`);
      }
      if (!match.references.length) console.log("    (no player references)");
      for (const suspicious of match.suspicious) {
        console.log(`    ! ${suspicious.code}: ${suspicious.message}`);
      }
    }
    if (report.otherReferences.length) {
      console.log("\nOther player references (not grouped by match):");
      for (const reference of report.otherReferences) {
        console.log(`- ${reference.collection} ${reference.documentId}${reference.label ? ` (${reference.label})` : ""}: ${reference.fields.join(", ")}`);
      }
    }
    if (report.auditHistory.length) {
      console.log("\nAudit history (intentionally retained after a merge):");
      for (const entry of report.auditHistory) {
        console.log(`- ${entry.action} ${entry.id}: source=${entry.metadata.sourcePlayerId || ""} target=${entry.metadata.targetPlayerId || ""}`);
      }
    }
    console.log("\nRead-only check complete. No database writes were made.");
    return report;
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Player merge integrity check failed: ${error.message}`);
    process.exitCode = 1;
  });
}
