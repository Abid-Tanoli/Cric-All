// Guarded purge of selected User accounts and the records they created.
//
// Unlike cleanupTestData.js this script does not match on name prefixes. The
// operator names the accounts to keep (emails or ids, or --keep-none) and names
// the organizations that must survive (--protect-orgs). Everything reachable
// from those organizations — teams, players, fixtures, competitions, rankings,
// ball records and media — is protected in both directions: a protected record
// is never deleted, even when a doomed user created it. Only the creator/owner
// pointer is cleared, using the same behaviour as accountDeletionService.
//
// Safety:
//   * Dry run by default. Nothing is written without --apply.
//   * --apply needs a backup-*.archive.gz younger than 30 minutes in BACKUP_DIR
//     (Backend/backups on the host, /app/backups in the container) and
//     --confirm=<total users + organizations + teams>, or it exits.
//   * The protected-set counts are snapshotted before apply and re-checked
//     afterwards; any change is a loud, non-zero-exit failure.
//   * The separate `admins` collection is never read or written.
//
// Usage:
//   npm run users:purge -- --keep=a@b.com --protect-orgs=<ids> --delete-owned-orgs
//   npm run users:purge -- --keep-none --protect-orgs=<ids> --delete-owned-orgs --apply --confirm=N
//
// Runbook: docs/purge-users.md (repo root).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import dotenv from "dotenv";

import { recordAudit, SYSTEM_ACTOR } from "../utils/audit.js";
import { deleteTeam } from "../services/teamService.js";
import { deleteTournamentContent } from "../services/tournamentContent.js";
import { deleteUserAccount } from "../services/accountDeletionService.js";
import { deleteStoredFile } from "../utils/photoStore.js";

import User from "../models/User.js";
import Team from "../models/Team.js";
import TeamOrganization from "../models/TeamOrganization.js";
import Player from "../models/Player.js";
import TeamRanking from "../models/TeamRanking.js";
import TeamPlayerRanking from "../models/TeamPlayerRanking.js";
import Tournament from "../models/Tournament.js";
import Match from "../models/Match.js";
import Event from "../models/Event.js";
import Series from "../models/Series.js";
import Sponsor from "../models/Sponsor.js";
import CommunityPost from "../models/CommunityPost.js";
import CommunityComment from "../models/CommunityComment.js";
import CommunityLike from "../models/CommunityLike.js";
import IssueReport from "../models/IssueReport.js";
import Membership from "../models/Membership.js";
import Invitation from "../models/Invitation.js";
import Ball from "../models/Ball.js";
import Delivery from "../models/Delivery.js";
import Commentary from "../models/Commentary.js";
import Partnership from "../models/Partnership.js";
import MatchAnalytics from "../models/MatchAnalytics.js";
import TournamentMedia from "../models/TournamentMedia.js";
import TournamentArticle from "../models/TournamentArticle.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export const BACKUP_MAX_AGE_MS = 30 * 60 * 1000;
export const AUDIT_USER = "users.purge.user";
export const AUDIT_ORG = "users.purge.organization";

const key = (model) => model.collection.collectionName;
const oid = (id) => new mongoose.Types.ObjectId(id);
const oids = (ids) => [...ids].filter((id) => mongoose.Types.ObjectId.isValid(id)).map(oid);
const labelFor = (doc) => (doc && (doc.name || doc.title || doc.subject || doc.email || doc.username)) || "";
const pad = (value, width) => String(value || "").slice(0, width).padEnd(width);

/** Values at a dotted path, flattening arrays (innings.batting.player, ...). */
function valuesAt(doc, dottedPath) {
  const parts = dottedPath.split(".");
  const walk = (value, index) => {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) return value.flatMap((item) => walk(item, index));
    if (index === parts.length) return [value];
    return walk(value[parts[index]], index + 1);
  };
  return walk(doc, 0);
}

// Directed references. The closure walks both ways: a protected record's
// targets are protected, and anything that points at a protected record is
// protected too. This is what keeps a legacy org's whole scorecard graph alive.
const MATCH_PLAYER_PATHS = [
  "innings.battingOrder", "innings.batting.player", "innings.bowling.player",
  "innings.currentBatsman1", "innings.currentBatsman2", "innings.onStrikeBatsman",
  "innings.currentBowler", "innings.twelfthManBowlBlock.player",
  "innings.replacedBowlerBlock.player", "innings.fallOfWickets.player",
  "innings.fallOfWickets.fielder", "innings.partnerships.batsman1",
  "innings.partnerships.batsman2", "innings.oversHistory.bowler",
  "innings.oversHistory.balls.batsmanOnStrike", "innings.oversHistory.balls.bowler",
  "innings.oversHistory.balls.dismissedPlayer", "innings.oversHistory.balls.fielder",
  "playingXI.players", "squad15.players", "squad15.captain", "squad15.viceCaptain",
  "squad15.wicketKeepers", "bowlingXI.players", "teamRoles.captain",
  "teamRoles.viceCaptain", "teamRoles.wicketKeepers", "twelfthMan.player",
  "superSub.player", "impactPlayers.player", "impactPlayers.replaces",
  "result.playerOfMatch", "manOfMatch", "batsmanOnStrike", "batsmanNonStrike",
  "bowler", "drsReviews.requestedBy", "superOvers.bowlers.bowler",
  "superOvers.batsmen.players",
];

const REF_EDGES = [
  { from: TeamOrganization, to: Team, paths: ["organizationRef"] },
  { from: TeamOrganization, to: TeamOrganization, paths: ["parent"] },
  { from: Team, to: TeamOrganization, paths: ["organizationRef"] },
  { from: Team, to: Player, paths: ["players", "captain", "viceCaptain"] },
  { from: Player, to: Team, paths: ["team", "teamHistory.team"] },
  { from: Player, to: Player, paths: ["relations.player"] },
  {
    from: Match,
    to: Team,
    paths: [
      "teams", "innings.team", "result.winner", "tossWinner", "playingXI.team",
      "squad15.team", "bowlingXI.team", "twelfthMan.team", "superSub.team",
      "impactPlayers.team", "teamRoles.team", "drsReviews.team", "timeouts.team",
      "superOvers.battingFirst", "superOvers.battingSecond",
    ],
  },
  { from: Match, to: Player, paths: MATCH_PLAYER_PATHS },
  { from: Match, to: Tournament, paths: ["tournament"] },
  { from: Match, to: Event, paths: ["event"] },
  { from: Match, to: TeamOrganization, paths: ["organizationRef"] },
  {
    from: Tournament,
    to: Match,
    paths: ["matches", "knockoutStage.quarterFinals", "knockoutStage.semiFinals", "knockoutStage.final", "knockoutStage.thirdPlace"],
  },
  { from: Tournament, to: Team, paths: ["teams", "pointsTable.team", "groups.teams", "winner", "runnerUp"] },
  {
    from: Tournament,
    to: Player,
    paths: [
      "awards.playerOfTournament", "awards.bestBatsman", "awards.bestBowler",
      "officialAwards.playerOfTournament", "officialAwards.topPlayers",
      "officialAwards.bestBatsman", "officialAwards.bestBowler",
      "officialAwards.bestFielder", "officialAwards.emergingPlayer",
      "officialAwards.customAwards.player",
    ],
  },
  { from: Tournament, to: TeamOrganization, paths: ["organizationRef"] },
  { from: Event, to: Match, paths: ["matches"] },
  { from: Event, to: Team, paths: ["teams", "eventSquads.team", "pointsTable.team", "groups.teams", "winner", "runnerUp"] },
  {
    from: Event,
    to: Player,
    paths: [
      "eventSquads.players", "eventSquads.captain", "eventSquads.viceCaptain",
      "eventSquads.wicketKeepers", "eventSquads.playerChanges.outPlayer",
      "eventSquads.playerChanges.inPlayer",
    ],
  },
  { from: Event, to: TeamOrganization, paths: ["organization"] },
  { from: Series, to: Team, paths: ["teams", "winner"] },
  { from: Series, to: TeamOrganization, paths: ["organizationRef"] },
  { from: TeamRanking, to: Team, paths: ["team"] },
  { from: TeamPlayerRanking, to: Team, paths: ["team"] },
  { from: TeamPlayerRanking, to: Player, paths: ["player"] },
  { from: Ball, to: Match, paths: ["matchId"] },
  { from: Ball, to: Player, paths: ["batsman", "bowler", "fieldedBy"] },
  { from: Delivery, to: Match, paths: ["matchId"] },
  { from: Delivery, to: Player, paths: ["batsmanId", "bowlerId", "nonStrikerId", "fielderId"] },
  { from: Commentary, to: Match, paths: ["match"] },
  { from: Partnership, to: Match, paths: ["matchId"] },
  { from: Partnership, to: Player, paths: ["batsman1Id", "batsman2Id"] },
  { from: MatchAnalytics, to: Match, paths: ["matchId"] },
  { from: TournamentMedia, to: Tournament, paths: ["tournament"] },
  { from: TournamentArticle, to: Tournament, paths: ["tournament"] },
  { from: Sponsor, to: TeamOrganization, paths: ["organizationRef"] },
  { from: Sponsor, to: Tournament, paths: ["tournamentRef"] },
];

export function parseArgs(argv = []) {
  const keepArg = argv.find((arg) => arg.startsWith("--keep="));
  const protectArg = argv.find((arg) => arg.startsWith("--protect-orgs="));
  const confirmArg = argv.find((arg) => arg.startsWith("--confirm="));
  const split = (value) => value.split(",").map((part) => part.trim()).filter(Boolean);
  const confirm = confirmArg ? Number(confirmArg.slice("--confirm=".length)) : null;
  return {
    apply: argv.includes("--apply"),
    confirm: Number.isFinite(confirm) ? confirm : null,
    keep: keepArg ? split(keepArg.slice("--keep=".length)) : [],
    keepNone: argv.includes("--keep-none"),
    protectOrgs: protectArg ? split(protectArg.slice("--protect-orgs=".length)) : [],
    deleteOwnedOrgs: argv.includes("--delete-owned-orgs"),
  };
}

export function validateArgs(args) {
  const errors = [];
  if (args.keepNone && args.keep.length) errors.push("Use either --keep=<emails or ids> or --keep-none, not both.");
  if (!args.keepNone && args.keep.length === 0) errors.push("One of --keep=<emails or ids> or --keep-none is required.");
  if (args.protectOrgs.length === 0) errors.push("--protect-orgs=<organization ids> is required (at least one).");
  if (args.protectOrgs.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
    errors.push("--protect-orgs contains an invalid organization id.");
  }
  return errors;
}

export function defaultBackupDir() {
  return process.env.BACKUP_DIR || path.resolve(__dirname, "../../backups");
}

/** Newest backup-*.archive.gz in `dir` younger than `maxAgeMs`, or null. */
export async function findFreshBackup({
  dir = defaultBackupDir(),
  now = Date.now(),
  maxAgeMs = BACKUP_MAX_AGE_MS,
} = {}) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir);
  } catch {
    return null;
  }

  let newest = null;
  for (const name of entries) {
    if (!name.startsWith("backup-") || !name.endsWith(".archive.gz")) continue;
    const file = path.join(dir, name);
    const stats = await fs.promises.stat(file).catch(() => null);
    if (!stats || now - stats.mtimeMs > maxAgeMs) continue;
    if (!newest || stats.mtimeMs > newest.mtimeMs) newest = { name, path: file, mtimeMs: stats.mtimeMs };
  }
  return newest;
}

function emptySetMap() {
  return new Map();
}

function addIds(map, model, values) {
  const set = map.get(key(model)) || new Set();
  let added = 0;
  for (const value of values) {
    const id = String(value?._id || value);
    if (!mongoose.Types.ObjectId.isValid(id) || set.has(id)) continue;
    set.add(id);
    added += 1;
  }
  if (added || !map.has(key(model))) map.set(key(model), set);
  return added;
}

const signature = (map) => [...map.values()].reduce((sum, set) => sum + set.size, 0);

/** Every record reachable from the protected organizations, in both directions. */
export async function collectProtected(orgIds) {
  const protectedIds = emptySetMap();
  addIds(protectedIds, TeamOrganization, orgIds);

  for (let round = 0; round < 12; round += 1) {
    const before = signature(protectedIds);

    for (const edge of REF_EDGES) {
      const fromKey = key(edge.from);
      if (protectedIds.get(fromKey)?.size) {
        const select = [...new Set(["_id", ...edge.paths])].join(" ");
        const rows = await edge.from.find({ _id: { $in: oids(protectedIds.get(fromKey)) } }).select(select).lean();
        for (const row of rows) {
          for (const field of edge.paths) {
            addIds(protectedIds, edge.to, valuesAt(row, field));
          }
        }
      }

      const toKey = key(edge.to);
      if (protectedIds.get(toKey)?.size) {
        const filter = { $or: edge.paths.map((field) => ({ [field]: { $in: oids(protectedIds.get(toKey)) } })) };
        const rows = await edge.from.find(filter).select("_id").lean();
        addIds(protectedIds, edge.from, rows.map((row) => row._id));
      }
    }

    if (signature(protectedIds) === before) break;
  }

  return protectedIds;
}

/** Balls are counted by fixture, not by stored ball id, so a lost ball is caught. */
export async function protectedSnapshot(protectedIds) {
  const matchIds = oids(protectedIds.get(key(Match)) || []);
  const [organizations, teams, players, matches, tournaments, balls] = await Promise.all([
    TeamOrganization.countDocuments({ _id: { $in: oids(protectedIds.get(key(TeamOrganization)) || []) } }),
    Team.countDocuments({ _id: { $in: oids(protectedIds.get(key(Team)) || []) } }),
    Player.countDocuments({ _id: { $in: oids(protectedIds.get(key(Player)) || []) } }),
    Match.countDocuments({ _id: { $in: matchIds } }),
    Tournament.countDocuments({ _id: { $in: oids(protectedIds.get(key(Tournament)) || []) } }),
    Ball.countDocuments({ matchId: { $in: matchIds } }),
  ]);
  return { organizations, teams, players, matches, tournaments, balls };
}

const IMPACT_LABELS = [
  ["organizations", TeamOrganization], ["teams", Team], ["players", Player],
  ["matches", Match], ["tournaments", Tournament], ["events", Event],
  ["posts", CommunityPost], ["issueReports", IssueReport], ["invitations", Invitation],
  ["memberships", Membership],
];

/** What one user owns/created, for the dry-run report and the doomed sets. */
async function collectUserImpact(userId, ownedOrgIds, ownedOrgs) {
  const orgTeams = ownedOrgIds.length ? await Team.find({ organizationRef: { $in: ownedOrgIds } }).select("name").lean() : [];
  const managedTeams = await Team.find({ managedBy: userId }).select("name").lean();
  const teamIds = oids([...new Set([...orgTeams, ...managedTeams].map((row) => String(row._id)))]);
  const events = await Event.find({ $or: [{ createdBy: userId }, ...(ownedOrgIds.length ? [{ organization: { $in: ownedOrgIds } }] : [])] }).select("name").lean();
  const eventIds = oids(events.map((row) => row._id));
  const matchQueries = [{ teams: { $in: teamIds } }, { organizationRef: { $in: ownedOrgIds } }, { event: { $in: eventIds } }];
  const [players, tournaments, matches, posts, issueReports, invitations, memberships, series] = await Promise.all([
    Player.find({ createdBy: userId }).select("name").lean(),
    Tournament.find({ $or: [{ organizationRef: { $in: ownedOrgIds } }, { teams: { $in: teamIds } }] }).select("name").lean(),
    Match.find({ $or: matchQueries }).select("title").lean(),
    CommunityPost.find({ authorUser: userId }).select("title").lean(),
    IssueReport.find({ reporter: userId }).select("subject").lean(),
    Invitation.find({ inviter: userId }).select("email phone").lean(),
    Membership.find({ user: userId }).select("organization").lean(),
    Series.find({ organizationRef: { $in: ownedOrgIds } }).select("name").lean(),
  ]);

  const byLabel = {
    organizations: ownedOrgs,
    teams: [...orgTeams, ...managedTeams],
    players,
    matches,
    tournaments,
    events,
    posts,
    issueReports,
    invitations,
    memberships,
    series,
  };
  const result = {};
  for (const [label, model] of IMPACT_LABELS) {
    const rows = byLabel[label] || [];
    result[label] = { model, rows };
  }
  result.series = { model: Series, rows: series };
  return result;
}

/** Adds match/post children of doomed parents, skipping protected records. */
async function expandChildren(doomed, protection) {
  const add = (model, rows) => {
    for (const row of rows) {
      if (!protection.get(key(model))?.has(String(row._id))) addIds(doomed, model, [row._id]);
    }
  };
  const matchIds = oids(doomed.get(key(Match)) || []);
  for (const [model, field] of [
    [Ball, "matchId"], [Delivery, "matchId"], [Commentary, "match"],
    [Partnership, "matchId"], [MatchAnalytics, "matchId"],
  ]) {
    if (matchIds.length) add(model, await model.find({ [field]: { $in: matchIds } }).select("_id").lean());
  }

  for (const tournamentId of doomed.get(key(Tournament)) || []) {
    add(Match, await Match.find({ tournament: tournamentId }).select("_id").lean());
    add(TournamentMedia, await TournamentMedia.find({ tournament: tournamentId }).select("_id").lean());
    add(TournamentArticle, await TournamentArticle.find({ tournament: tournamentId }).select("_id").lean());
  }
  for (const eventId of doomed.get(key(Event)) || []) {
    add(Match, await Match.find({ event: eventId }).select("_id").lean());
  }
  const postIds = oids(doomed.get(key(CommunityPost)) || []);
  if (postIds.length) {
    add(CommunityComment, await CommunityComment.find({ post: { $in: postIds } }).select("_id").lean());
    add(CommunityLike, await CommunityLike.find({ post: { $in: postIds } }).select("_id").lean());
  }
}

/** Builds the full report/plan without writing anything. */
export async function collectPurgePlan(args) {
  const protection = await collectProtected(args.protectOrgs);
  const snapshotBefore = await protectedSnapshot(protection);
  const users = await User.find({}).select("name email username phone createdAt").sort({ createdAt: 1 }).lean();
  const keepIds = new Set();
  const warnings = [];
  const skipped = [];
  const keepTokens = args.keep.map((token) => token.toLowerCase());

  for (const user of users) {
    const email = String(user.email || "").toLowerCase();
    if (args.keepNone) continue;
    if (keepTokens.includes(String(user._id)) || (email && keepTokens.includes(email))) keepIds.add(String(user._id));
  }
  for (const token of args.keep) {
    if (!users.some((user) => String(user._id) === token || String(user.email || "").toLowerCase() === token.toLowerCase())) {
      warnings.push(`--keep value ${token} did not match any user`);
    }
  }

  const userRows = users.map((user) => ({ doc: user, decision: keepIds.has(String(user._id)) ? "KEEP" : "DELETE", skipped: false, impact: null }));
  const doomed = emptySetMap();
  const orgDeletes = new Map();
  const protectedOrgs = [];

  for (const orgId of protection.get(key(TeamOrganization)) || []) {
    const teams = await Team.find({ organizationRef: orgId }).select("_id").lean();
    const teamIds = oids(teams.map((team) => team._id));
    const org = await TeamOrganization.findById(orgId).select("name").lean();
    protectedOrgs.push({
      id: orgId,
      name: labelFor(org),
      teams: teams.length,
      players: await Player.countDocuments({ $or: [{ team: { $in: teamIds } }, { "teamHistory.team": { $in: teamIds } }] }),
      matches: await Match.countDocuments({ $or: [{ teams: { $in: teamIds } }, { organizationRef: orgId }] }),
      tournaments: await Tournament.countDocuments({ $or: [{ teams: { $in: teamIds } }, { organizationRef: orgId }] }),
    });
  }

  for (const row of userRows.filter((entry) => entry.decision === "DELETE")) {
    const userId = String(row.doc._id);
    const ownedOrgs = await TeamOrganization.find({ $or: [{ owner: row.doc._id }, { createdBy: row.doc._id }] }).select("name").lean();
    const deletableOrgs = ownedOrgs.filter((org) => !protection.get(key(TeamOrganization))?.has(String(org._id)));

    if (deletableOrgs.length && !args.deleteOwnedOrgs) {
      row.skipped = true;
      row.reason = `owns organization ${deletableOrgs.map((org) => org.name).join(", ")} (add --delete-owned-orgs)`;
      skipped.push({ label: "user", id: userId, name: labelFor(row.doc), reason: row.reason });
      continue;
    }

    addIds(doomed, User, [userId]);
    const impact = await collectUserImpact(row.doc._id, oids(ownedOrgs.map((org) => org._id)), ownedOrgs);
    row.impact = impact;

    for (const [label, { model, rows }] of Object.entries(impact)) {
      for (const doc of rows) {
        if (protection.get(key(model))?.has(String(doc._id))) {
          if (label !== "memberships" && label !== "invitations" && label !== "posts" && label !== "issueReports") {
            skipped.push({ label, id: String(doc._id), name: labelFor(doc), reason: "protected; kept, creator/owner pointer cleared by account deletion" });
          }
          continue;
        }
        if (label !== "organizations") addIds(doomed, model, [doc._id]);
      }
    }

    if (args.deleteOwnedOrgs) {
      for (const org of deletableOrgs) {
        const teams = await Team.find({ organizationRef: org._id }).select("name").lean();
        orgDeletes.set(String(org._id), {
          doc: org,
          owner: userId,
          teams: teams.filter((team) => !protection.get(key(Team))?.has(String(team._id))),
        });
        for (const team of teams) {
          if (!protection.get(key(Team))?.has(String(team._id))) addIds(doomed, Team, [team._id]);
        }
      }
    }
  }

  await expandChildren(doomed, protection);
  // Final guard: nothing reachable from a protected organization is ever doomed.
  for (const [collection, ids] of protection) {
    const doomedSet = doomed.get(collection);
    if (!doomedSet) continue;
    for (const id of ids) doomedSet.delete(id);
  }

  const total = (doomed.get(key(User))?.size || 0) + orgDeletes.size + (doomed.get(key(Team))?.size || 0);
  return {
    args, userRows, doomed, orgDeletes, protection, protectedOrgs, skipped, warnings, snapshotBefore, total,
  };
}

function printPlan(plan, out) {
  out("");
  out("=== users purge — DRY RUN (no writes) ===");
  out(`Mode: ${plan.args.keepNone ? "--keep-none" : `--keep=${plan.args.keep.join(",")}`}  protect-orgs=${plan.args.protectOrgs.join(",")}  delete-owned-orgs=${plan.args.deleteOwnedOrgs ? "yes" : "no"}`);

  out("");
  out(`Users (${plan.userRows.length}):`);
  for (const row of plan.userRows) {
    const marker = row.skipped ? "DELETE — SKIPPED" : row.decision;
    out(`  ${String(row.doc._id)}  ${pad(row.doc.email || labelFor(row.doc), 38)}  ${marker}${row.reason ? `: ${row.reason}` : ""}`);
  }

  out("");
  out("Created/owned records for users to delete:");
  for (const row of plan.userRows.filter((entry) => entry.decision === "DELETE" && entry.impact)) {
    out(`  ${row.doc.email || labelFor(row.doc)} (${row.doc._id}):`);
    for (const [label, { rows }] of Object.entries(row.impact)) {
      const doomedModel = IMPACT_LABELS.find(([name]) => name === label)?.[1] || Series;
      const doomedCount = rows.filter((doc) => plan.doomed.get(key(doomedModel))?.has(String(doc._id))).length;
      out(`    ${pad(label, 14)} ${rows.length} (${doomedCount} to delete)`);
    }
  }

  out("");
  out(`Organizations to delete (--delete-owned-orgs): ${plan.orgDeletes.size}`);
  for (const [orgId, entry] of plan.orgDeletes) {
    out(`  ${orgId}  ${pad(labelFor(entry.doc), 30)}  owner=${entry.owner}  teams=${entry.teams.length} (${entry.teams.map(labelFor).join(", ") || "none"})`);
  }
  if (!plan.args.deleteOwnedOrgs) out("  (none: pass --delete-owned-orgs to delete user-owned organizations and their default teams)");

  out("");
  out(`Protected organizations (${plan.protectedOrgs.length}):`);
  for (const org of plan.protectedOrgs) {
    out(
      `  ${org.id}  ${pad(org.name, 30)}  teams=${org.teams} players=${org.players} matches=${org.matches} tournaments=${org.tournaments}`,
    );
  }

  out("");
  out("Protected snapshot (re-checked after apply): " + JSON.stringify(plan.snapshotBefore));
  out("");
  out("Skipped / not cleanly handled:");
  if (!plan.skipped.length && !plan.warnings.length) out("  (none)");
  for (const entry of plan.skipped) out(`  ${entry.label} ${entry.id} ${pad(entry.name, 30)} ${entry.reason}`);
  for (const warning of plan.warnings) out(`  ${warning}`);

  out("");
  out(`Total to delete (users + organizations + teams): ${plan.total}`);
}

/** Mirrors organizationController.deleteOrganization after teams were removed. */
async function deleteOwnedOrganization(orgId) {
  const branches = await Team.exists({ organizationRef: orgId });
  if (branches) throw new Error(`Organization ${orgId} still has teams; refusing to delete it`);
  const children = await TeamOrganization.exists({ parent: orgId });
  if (children) throw new Error(`Organization ${orgId} still has sub-organizations`);

  await Membership.deleteMany({ organization: orgId });
  const deleted = await TeamOrganization.findByIdAndDelete(orgId);
  if (!deleted) throw new Error(`Organization ${orgId} not found`);
  await Invitation.deleteMany({ organization: orgId });
  return deleted;
}

/**
 * Protected organizations owned by a doomed user keep their document, so the
 * account's owner pointer and owner membership are cleared here with exactly
 * the heir/no-heir behaviour of deleteUserAccount before the service is called.
 */
async function clearProtectedOwnership(userId, protection) {
  const orgSet = protection.get(key(TeamOrganization)) || new Set();
  if (!orgSet.size) return;
  const memberships = await Membership.find({
    user: userId, organization: { $in: oids(orgSet) }, status: "active", roles: "owner",
  }).select("_id organization").lean();

  for (const membership of memberships) {
    const heir = await Membership.findOne({
      organization: membership.organization, status: "active", roles: "owner", user: { $ne: userId },
    }).select("user").lean();
    await TeamOrganization.updateOne(
      { _id: membership.organization, owner: userId },
      { $set: { owner: heir ? heir.user : null } },
    );
    await Membership.deleteOne({ _id: membership._id });
  }
  await TeamOrganization.updateMany({ _id: { $in: oids(orgSet) }, owner: userId }, { $set: { owner: null } });
}

/** Deletes the planned records. Audits one entry per user and per organization. */
export async function applyPurge(plan, { out = console.log } = {}) {
  const errors = [];
  const removed = {};
  const doomed = plan.doomed;

  const deleteMany = async (label, model, filter) => {
    const result = await model.deleteMany(filter);
    removed[label] = (removed[label] || 0) + (result.deletedCount || 0);
  };

  try {
    const matchIds = oids(doomed.get(key(Match)) || []);
    for (const [model, field] of [
      [Ball, "matchId"], [Delivery, "matchId"], [Commentary, "match"],
      [Partnership, "matchId"], [MatchAnalytics, "matchId"],
    ]) {
      if (matchIds.length) await deleteMany(key(model), model, { [field]: { $in: matchIds } });
    }

    for (const tournamentId of doomed.get(key(Tournament)) || []) {
      await deleteMany(key(Match), Match, { tournament: tournamentId });
      await deleteTournamentContent(tournamentId);
    }
    await deleteMany(key(Tournament), Tournament, { _id: { $in: oids(doomed.get(key(Tournament)) || []) } });
    for (const eventId of doomed.get(key(Event)) || []) await deleteMany(key(Match), Match, { event: eventId });
    await deleteMany(key(Event), Event, { _id: { $in: oids(doomed.get(key(Event)) || []) } });
    await deleteMany(key(Series), Series, { _id: { $in: oids(doomed.get(key(Series)) || []) } });
    await deleteMany(key(Match), Match, { _id: { $in: matchIds } });

    const postIds = oids(doomed.get(key(CommunityPost)) || []);
    if (postIds.length) {
      await deleteMany(key(CommunityComment), CommunityComment, { post: { $in: postIds } });
      await deleteMany(key(CommunityLike), CommunityLike, { post: { $in: postIds } });
    }
    await deleteMany(key(CommunityPost), CommunityPost, { _id: { $in: postIds } });
    await deleteMany(key(IssueReport), IssueReport, { _id: { $in: oids(doomed.get(key(IssueReport)) || []) } });
    await deleteMany(key(Sponsor), Sponsor, { _id: { $in: oids(doomed.get(key(Sponsor)) || []) } });

    const playerIds = oids(doomed.get(key(Player)) || []);
    if (playerIds.length) {
      const players = await Player.find({ _id: { $in: playerIds } }).select("imageUrl").lean();
      await Team.updateMany({ players: { $in: playerIds } }, { $pull: { players: { $in: playerIds } } });
      await TeamPlayerRanking.deleteMany({ player: { $in: playerIds } });
      await deleteMany(key(Player), Player, { _id: { $in: playerIds } });
      for (const player of players) {
        if (player.imageUrl) await deleteStoredFile(player.imageUrl).catch(() => {});
      }
    }

    for (const teamId of doomed.get(key(Team)) || []) {
      await deleteTeam(teamId);
      removed[key(Team)] = (removed[key(Team)] || 0) + 1;
    }

    for (const [orgId, entry] of plan.orgDeletes) {
      await deleteOwnedOrganization(orgId);
      removed[key(TeamOrganization)] = (removed[key(TeamOrganization)] || 0) + 1;
      await recordAudit({
        action: AUDIT_ORG,
        targetType: "organization",
        targetId: orgId,
        targetLabel: labelFor(entry.doc),
        metadata: { confirm: plan.total, owner: entry.owner },
        actor: SYSTEM_ACTOR,
      });
    }

    for (const userId of doomed.get(key(User)) || []) {
      const user = await User.findById(userId).select("email phone").lean();
      if (!user) continue;
      await clearProtectedOwnership(userId, plan.protection);
      await deleteUserAccount(userId, { email: user.email || "", phone: user.phone || "" });
      removed[key(User)] = (removed[key(User)] || 0) + 1;
      await recordAudit({
        action: AUDIT_USER,
        targetType: "user",
        targetId: userId,
        targetLabel: user.email || String(userId),
        metadata: { confirm: plan.total },
        actor: SYSTEM_ACTOR,
      });
    }
  } catch (error) {
    errors.push({ message: error.message });
    out(`  FAILED: ${error.message}`);
  }

  return { removed, errors };
}

/** CLI entry point. Returns { exitCode, plan, summary } instead of exiting. */
export async function runPurge({
  argv = process.argv.slice(2),
  now = Date.now(),
  backupDir = defaultBackupDir(),
  out = console.log,
  beforeApply = null,
} = {}) {
  const args = parseArgs(argv);
  const invalid = validateArgs(args);
  if (invalid.length) {
    for (const message of invalid) out(`Refusing to run: ${message}`);
    out("Example: npm run users:purge -- --keep=a@b.com --protect-orgs=<org ids> --delete-owned-orgs");
    return { exitCode: 1, plan: null, summary: null };
  }

  const plan = await collectPurgePlan(args);
  printPlan(plan, out);

  if (!args.apply) {
    out("");
    if (plan.total === 0) out("Nothing to delete.");
    out("Dry run only — nothing was written. Re-run with --apply --confirm=<total> after a fresh backup.");
    return { exitCode: 0, plan, summary: null };
  }
  if (plan.total === 0) {
    out("");
    out("Nothing to delete. No backup or confirmation needed.");
    return { exitCode: 0, plan, summary: null };
  }

  const backup = await findFreshBackup({ dir: backupDir, now });
  if (!backup) {
    out("");
    out(`Refusing to delete: no backup newer than 30 minutes in ${backupDir}.`);
    out("On the host:");
    out("  cd Backend && npm run db:backup");
    out("  docker compose exec backend mkdir -p /app/backups");
    out("  docker compose cp Backend/backups/<archive>.archive.gz backend:/app/backups/");
    return { exitCode: 1, plan, summary: null };
  }

  if (args.confirm === null || args.confirm !== plan.total) {
    out("");
    out(`Refusing to delete: --confirm=${args.confirm === null ? "<missing>" : args.confirm} does not match the dry-run total ${plan.total}.`);
    out(`Re-run with --apply --confirm=${plan.total}`);
    return { exitCode: 1, plan, summary: null };
  }

  out("");
  out(`Applying with backup ${backup.path}`);
  if (beforeApply) await beforeApply({ plan });

  const summary = await applyPurge(plan, { out });
  const snapshotAfter = await protectedSnapshot(plan.protection);
  const changed = Object.keys(plan.snapshotBefore).filter((name) => plan.snapshotBefore[name] !== snapshotAfter[name]);

  out("");
  out("=== purge summary ===");
  for (const [collection, count] of Object.entries(summary.removed)) out(`  deleted ${count} ${collection}`);
  out("  Protected snapshot after apply: " + JSON.stringify(snapshotAfter));

  if (changed.length) {
    out("");
    out("############################################################");
    out("# ERROR: PROTECTED SNAPSHOT CHANGED — STOP AND RESTORE THE BACKUP");
    for (const name of changed) out(`#   ${name}: ${plan.snapshotBefore[name]} -> ${snapshotAfter[name]}`);
    out("############################################################");
  }
  for (const error of summary.errors) out(`  FAILED: ${error.message}`);

  return { exitCode: summary.errors.length || changed.length ? 1 : 0, plan, summary, snapshotAfter, changed };
}

export async function main(argv = process.argv.slice(2)) {
  const url = process.env.MONGO_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!url) throw new Error("MONGO_URL / MONGODB_URI / MONGO_URI is required.");

  await mongoose.connect(url, {
    serverSelectionTimeoutMS: 60000,
    connectTimeoutMS: 60000,
    socketTimeoutMS: 120000,
  });

  try {
    return await runPurge({ argv });
  } finally {
    await mongoose.disconnect();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === __filename.toLowerCase();
if (isMain) {
  main()
    .then((result) => { process.exitCode = result.exitCode; })
    .catch((error) => {
      console.error("Users purge failed:", error.message);
      process.exitCode = 1;
    });
}
