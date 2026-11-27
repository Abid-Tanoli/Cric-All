// Removes leftover QA/agent fixtures from the database — and nothing else.
//
// What counts as test data (exact rules, never fuzzy):
//   * User accounts whose name, email or username starts with OPENCODE_TEST
//     (case-insensitive; emails are stored lower-cased).
//   * Teams, organizations, players, tournaments, matches, events, sponsors,
//     community posts and issue reports whose name/title/subject starts with
//     TEST_ or OPENCODE_TEST (case-insensitive).
//
// Everything else is treated as real data. A matched record that a non-test
// record still points at (a real player on a test team, a real member in a test
// organization, a real issue report against a test match, ...) is skipped and
// reported, never deleted.
//
// Safety:
//   * Dry run by default. Nothing is written without --apply.
//   * --apply needs a backup archive newer than 30 minutes in BACKUP_DIR
//     (Backend/backups by default) and --confirm=<dry-run total>, or it exits.
//   * Cascades reuse the existing delete helpers (teamService.deleteTeam,
//     tournamentContent.deleteTournamentContent, accountDeletionService
//     .deleteUserAccount) or mirror the controller delete order, so matches,
//     ball events, rankings, memberships, invites and uploads are not orphaned.
//   * One audit entry is written per collection, with the ids removed.
//
// Usage:
//   npm run cleanup:testdata                      # report only
//   npm run cleanup:testdata -- --apply --confirm=<N>
//
// Runbook: docs/test-data-cleanup.md (repo root)

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
import Tournament from "../models/Tournament.js";
import Match from "../models/Match.js";
import Event from "../models/Event.js";
import Sponsor from "../models/Sponsor.js";
import CommunityPost from "../models/CommunityPost.js";
import IssueReport from "../models/IssueReport.js";
import Membership from "../models/Membership.js";
import Invitation from "../models/Invitation.js";
import Ball from "../models/Ball.js";
import Delivery from "../models/Delivery.js";
import Commentary from "../models/Commentary.js";
import Partnership from "../models/Partnership.js";
import MatchAnalytics from "../models/MatchAnalytics.js";
import CommunityComment from "../models/CommunityComment.js";
import CommunityLike from "../models/CommunityLike.js";
import TeamPlayerRanking from "../models/TeamPlayerRanking.js";
import TournamentMedia from "../models/TournamentMedia.js";
import TournamentArticle from "../models/TournamentArticle.js";
import Series from "../models/Series.js";
import MatchOfficial from "../models/MatchOfficial.js";
import HandlerRequest from "../models/HandlerRequest.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export const TEST_RECORD_REGEX = /^(?:TEST_|OPENCODE_TEST)/i;
export const TEST_USER_REGEX = /^OPENCODE_TEST/i;
export const BACKUP_MAX_AGE_MS = 30 * 60 * 1000;

/** Collections matched by a name/title prefix, in display order. */
export const RECORD_GROUPS = [
  {
    label: "Users",
    model: User,
    query: {
      $or: [{ name: TEST_USER_REGEX }, { email: TEST_USER_REGEX }, { username: TEST_USER_REGEX }],
    },
    select: "name email username phone createdAt",
    reason: "name/email/username starts with OPENCODE_TEST",
  },
  {
    label: "Organizations",
    model: TeamOrganization,
    query: { name: TEST_RECORD_REGEX },
    select: "name createdAt",
    reason: "name starts with TEST_/OPENCODE_TEST",
  },
  {
    label: "Teams",
    model: Team,
    query: { name: TEST_RECORD_REGEX },
    select: "name createdAt",
    reason: "name starts with TEST_/OPENCODE_TEST",
  },
  {
    label: "Players",
    model: Player,
    query: { name: TEST_RECORD_REGEX },
    select: "name createdAt team",
    reason: "name starts with TEST_/OPENCODE_TEST",
  },
  {
    label: "Tournaments",
    model: Tournament,
    query: { name: TEST_RECORD_REGEX },
    select: "name createdAt",
    reason: "name starts with TEST_/OPENCODE_TEST",
  },
  {
    label: "Matches",
    model: Match,
    query: { title: TEST_RECORD_REGEX },
    select: "title createdAt",
    reason: "title starts with TEST_/OPENCODE_TEST",
  },
  {
    label: "Events",
    model: Event,
    query: { name: TEST_RECORD_REGEX },
    select: "name createdAt",
    reason: "name starts with TEST_/OPENCODE_TEST",
  },
  {
    label: "Sponsors",
    model: Sponsor,
    query: { name: TEST_RECORD_REGEX },
    select: "name createdAt",
    reason: "name starts with TEST_/OPENCODE_TEST",
  },
  {
    label: "Community posts",
    model: CommunityPost,
    query: { title: TEST_RECORD_REGEX },
    select: "title createdAt",
    reason: "title starts with TEST_/OPENCODE_TEST",
  },
  {
    label: "Issue reports",
    model: IssueReport,
    query: { subject: TEST_RECORD_REGEX },
    select: "subject createdAt",
    reason: "subject starts with TEST_/OPENCODE_TEST",
  },
];

const collectionName = (model) => model.collection.collectionName;

// Every inbound reference that must block a delete. `paths` are read from the
// referencing document; if that document is itself doomed, the reference is
// harmless. `ignore` is for join rows (membership/invitation) that will be
// removed together with the other side.
const GUARDS = [
  // teams
  { target: Team, model: Player, paths: ["team", "teamHistory.team"] },
  { target: Team, model: Match, paths: ["teams"] },
  { target: Team, model: Tournament, paths: ["teams"] },
  { target: Team, model: Event, paths: ["teams"] },
  { target: Team, model: Series, paths: ["teams"] },
  // organizations
  { target: TeamOrganization, model: Team, paths: ["organizationRef"] },
  { target: TeamOrganization, model: Match, paths: ["organizationRef"] },
  { target: TeamOrganization, model: Tournament, paths: ["organizationRef"] },
  { target: TeamOrganization, model: Event, paths: ["organization"] },
  { target: TeamOrganization, model: Sponsor, paths: ["organizationRef"] },
  {
    target: TeamOrganization,
    model: Membership,
    paths: ["organization"],
    extraSelect: "user",
    ignore: (ref, doomed) => doomed.get(collectionName(User))?.has(String(ref.user)),
  },
  {
    target: TeamOrganization,
    model: Invitation,
    paths: ["organization"],
    extraSelect: "invitee inviter",
    ignore: (ref, doomed) =>
      doomed.get(collectionName(User))?.has(String(ref.invitee)) ||
      doomed.get(collectionName(User))?.has(String(ref.inviter)),
  },
  { target: TeamOrganization, model: IssueReport, paths: ["organization"] },
  { target: TeamOrganization, model: TeamOrganization, paths: ["parent"] },
  // players
  { target: Player, model: Team, paths: ["players"] },
  {
    target: Player,
    model: Match,
    paths: [
      "innings.battingOrder",
      "innings.batting.player",
      "innings.bowling.player",
      "playingXI.players",
      "squad15.players",
      "bowlingXI.players",
    ],
  },
  {
    target: Player,
    model: Tournament,
    paths: [
      "tournamentSquads.players",
      "awards.playerOfTournament",
      "awards.bestBatsman",
      "awards.bestBowler",
      "officialAwards.topPlayers",
      "officialAwards.customAwards.player",
    ],
  },
  { target: Player, model: Event, paths: ["eventSquads.players"] },
  {
    target: Player,
    model: CommunityPost,
    filter: (ids) => ({ "subject.type": "player", "subject.ref": { $in: ids } }),
    paths: ["subject.ref"],
  },
  // tournaments
  { target: Tournament, model: Match, paths: ["tournament"] },
  { target: Tournament, model: Sponsor, paths: ["tournamentRef"] },
  { target: Tournament, model: TournamentMedia, paths: ["tournament"] },
  { target: Tournament, model: TournamentArticle, paths: ["tournament"] },
  // matches / events
  {
    target: Match,
    model: IssueReport,
    filter: (ids) => ({ targetId: { $in: ids } }),
    paths: ["targetId"],
  },
  { target: Event, model: Match, paths: ["event"] },
  // users
  {
    target: User,
    model: Membership,
    paths: ["user"],
    extraSelect: "organization",
    ignore: (ref, doomed) => doomed.get(collectionName(TeamOrganization))?.has(String(ref.organization)),
  },
  { target: User, model: TeamOrganization, paths: ["owner", "createdBy", "members.user"] },
  { target: User, model: Player, paths: ["createdBy"] },
  { target: User, model: Team, paths: ["managedBy"] },
  { target: User, model: Match, paths: ["assignedScorers"] },
  { target: User, model: Event, paths: ["createdBy", "managedBy"] },
  { target: User, model: Sponsor, paths: ["createdBy"] },
  {
    target: User,
    model: Invitation,
    paths: ["invitee", "inviter"],
    extraSelect: "organization",
    ignore: (ref, doomed) => doomed.get(collectionName(TeamOrganization))?.has(String(ref.organization)),
  },
  { target: User, model: CommunityPost, paths: ["authorUser"] },
  { target: User, model: IssueReport, paths: ["reporter"] },
  { target: User, model: MatchOfficial, paths: ["userId"] },
  { target: User, model: HandlerRequest, paths: ["user"] },
];

const SIMPLE_DELETES = {
  [collectionName(Ball)]: Ball,
  [collectionName(Delivery)]: Delivery,
  [collectionName(Commentary)]: Commentary,
  [collectionName(Partnership)]: Partnership,
  [collectionName(MatchAnalytics)]: MatchAnalytics,
  [collectionName(Match)]: Match,
  [collectionName(Event)]: Event,
  [collectionName(CommunityComment)]: CommunityComment,
  [collectionName(CommunityLike)]: CommunityLike,
  [collectionName(CommunityPost)]: CommunityPost,
  [collectionName(Sponsor)]: Sponsor,
  [collectionName(IssueReport)]: IssueReport,
  [collectionName(Membership)]: Membership,
  [collectionName(Invitation)]: Invitation,
};

// Children first, then parents: the same order the controllers use.
const DELETE_ORDER = [
  collectionName(Ball),
  collectionName(Delivery),
  collectionName(Commentary),
  collectionName(Partnership),
  collectionName(MatchAnalytics),
  collectionName(Match),
  collectionName(TournamentMedia),
  collectionName(TournamentArticle),
  collectionName(Tournament),
  collectionName(Event),
  collectionName(CommunityComment),
  collectionName(CommunityLike),
  collectionName(CommunityPost),
  collectionName(Sponsor),
  collectionName(IssueReport),
  collectionName(Player),
  collectionName(Team),
  collectionName(Membership),
  collectionName(Invitation),
  collectionName(TeamOrganization),
  collectionName(User),
];

const oid = (id) => new mongoose.Types.ObjectId(id);
const oids = (ids) => [...ids].map(oid);
const labelFor = (doc) =>
  (doc && (doc.name || doc.title || doc.subject || doc.email || doc.username)) || "";
const formatDate = (value) => (value ? new Date(value).toISOString().slice(0, 19).replace("T", " ") : "—");
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

export function parseArgs(argv = []) {
  const confirmArg = argv.find((arg) => arg.startsWith("--confirm="));
  const confirm = confirmArg ? Number(confirmArg.slice("--confirm=".length)) : null;
  return {
    apply: argv.includes("--apply"),
    confirm: Number.isFinite(confirm) ? confirm : null,
  };
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
    if (!newest || stats.mtimeMs > newest.mtimeMs) {
      newest = { name, path: file, mtimeMs: stats.mtimeMs };
    }
  }
  return newest;
}

/** Adds matches owned by a doomed tournament/event to the doomed set. */
async function expandMatchParents(doomed) {
  const queries = [];
  const tournamentIds = oids(doomed.get(collectionName(Tournament)) || []);
  const eventIds = oids(doomed.get(collectionName(Event)) || []);
  if (tournamentIds.length) queries.push({ tournament: { $in: tournamentIds } });
  if (eventIds.length) queries.push({ event: { $in: eventIds } });
  if (!queries.length) return;

  const matches = await Match.find({ $or: queries }).select("_id").lean();
  const matchSet = doomed.get(collectionName(Match)) || new Set();
  for (const match of matches) matchSet.add(String(match._id));
  doomed.set(collectionName(Match), matchSet);
}

/** Adds children that only exist under a doomed parent. */
async function expandOwnedRows(doomed) {
  const add = (model, ids) => {
    if (!ids.length) return;
    const key = collectionName(model);
    const set = doomed.get(key) || new Set();
    for (const id of ids) set.add(String(id));
    doomed.set(key, set);
  };

  const matchIds = oids(doomed.get(collectionName(Match)) || []);
  if (matchIds.length) {
    for (const model of [Ball, Delivery, Commentary, Partnership, MatchAnalytics]) {
      const field = model === Commentary ? "match" : "matchId";
      const rows = await model.find({ [field]: { $in: matchIds } }).select("_id").lean();
      add(model, rows.map((row) => row._id));
    }
  }

  const postIds = oids(doomed.get(collectionName(CommunityPost)) || []);
  if (postIds.length) {
    for (const model of [CommunityComment, CommunityLike]) {
      const rows = await model.find({ post: { $in: postIds } }).select("_id").lean();
      add(model, rows.map((row) => row._id));
    }
  }

  const orgIds = oids(doomed.get(collectionName(TeamOrganization)) || []);
  if (orgIds.length) {
    for (const model of [Membership, Invitation]) {
      const rows = await model.find({ organization: { $in: orgIds } }).select("_id").lean();
      add(model, rows.map((row) => row._id));
    }
  }

  const userIds = oids(doomed.get(collectionName(User)) || []);
  if (userIds.length) {
    const membershipRows = await Membership.find({ user: { $in: userIds } }).select("_id").lean();
    add(Membership, membershipRows.map((row) => row._id));
  }
}

/**
 * Removes candidates that a non-test record still points at. Repeats until no
 * new protection is found, because skipping a parent can save its children.
 */
async function dropProtected(doomed, docs) {
  const skipped = [];

  for (let round = 0; round < 6; round += 1) {
    const newly = new Map();

    for (const guard of GUARDS) {
      const targetKey = collectionName(guard.target);
      const targetSet = doomed.get(targetKey);
      if (!targetSet || targetSet.size === 0) continue;

      const ids = oids(targetSet);
      const filter = guard.filter
        ? guard.filter(ids)
        : { $or: guard.paths.map((field) => ({ [field]: { $in: ids } })) };
      const select = [...new Set(["_id", ...guard.paths, ...(guard.extraSelect ? guard.extraSelect.split(" ") : [])])].join(
        " ",
      );

      const refs = await guard.model.find(filter).select(select).lean();
      const hostKey = collectionName(guard.model);

      for (const ref of refs) {
        if (doomed.get(hostKey)?.has(String(ref._id))) continue;
        if (guard.ignore && guard.ignore(ref, doomed)) continue;

        for (const field of guard.paths) {
          for (const value of valuesAt(ref, field)) {
            const id = String(value && value._id ? value._id : value);
            if (!targetSet.has(id)) continue;
            const key = `${targetKey}:${id}`;
            if (!newly.has(key)) {
              newly.set(key, `${hostKey} record ${ref._id} is not test data`);
            }
          }
        }
      }
    }

    // A doomed tournament/event must not leave a match behind.
    for (const [parentModel, field] of [
      [Tournament, "tournament"],
      [Event, "event"],
    ]) {
      const parentKey = collectionName(parentModel);
      const parentSet = doomed.get(parentKey);
      if (!parentSet || parentSet.size === 0) continue;
      const matchKey = collectionName(Match);
      const doomedMatches = oids(doomed.get(matchKey) || []);

      for (const parentId of parentSet) {
        const foreign = await Match.findOne({
          [field]: parentId,
          ...(doomedMatches.length ? { _id: { $nin: doomedMatches } } : {}),
        })
          .select("_id title")
          .lean();
        if (!foreign) continue;
        const key = `${parentKey}:${parentId}`;
        if (!newly.has(key)) {
          newly.set(key, `match ${foreign.title || foreign._id} is not test data`);
        }
      }
    }

    if (newly.size === 0) break;

    for (const [key, reason] of newly) {
      const separator = key.indexOf(":");
      const keyName = key.slice(0, separator);
      const id = key.slice(separator + 1);
      doomed.get(keyName).delete(id);
      skipped.push({
        collection: keyName,
        id,
        name: labelFor(docs.get(keyName)?.get(id)),
        reason,
      });
    }
  }

  return skipped;
}

/** Builds the full plan without writing anything. */
export async function collectCleanupPlan() {
  const docs = new Map();
  const matched = new Map();
  const doomed = new Map();

  for (const group of RECORD_GROUPS) {
    const key = collectionName(group.model);
    const rows = await group.model.find(group.query).select(group.select).sort({ createdAt: 1 }).lean();
    matched.set(key, rows);
    docs.set(key, new Map(rows.map((row) => [String(row._id), row])));
    doomed.set(key, new Set(rows.map((row) => String(row._id))));
  }

  await expandMatchParents(doomed);
  const skipped = await dropProtected(doomed, docs);
  await expandOwnedRows(doomed);

  let total = 0;
  for (const ids of doomed.values()) total += ids.size;

  return { docs, matched, doomed, skipped, total };
}

function printPlan(plan, out) {
  out("");
  out("=== test data cleanup — DRY RUN (no writes) ===");

  for (const group of RECORD_GROUPS) {
    const key = collectionName(group.model);
    const rows = plan.matched.get(key) || [];
    if (rows.length === 0) continue;

    const doomedSet = plan.doomed.get(key) || new Set();
    const removable = rows.filter((row) => doomedSet.has(String(row._id)));
    const skipped = plan.skipped.filter((entry) => entry.collection === key);

    out("");
    out(`${group.label} (${key}): ${removable.length} to delete, ${skipped.length} skipped`);
    for (const row of rows) {
      const marker = doomedSet.has(String(row._id)) ? "" : "  SKIPPED";
      out(
        `  ${String(row._id)}  ${pad(labelFor(row), 34)}  ${formatDate(row.createdAt)}  ${group.reason}${marker}`,
      );
    }
    for (const entry of skipped) {
      out(`  ${entry.id}  ${pad(entry.name, 34)}  skipped: ${entry.reason}`);
    }
  }

  const topLevel = new Set(RECORD_GROUPS.map((group) => collectionName(group.model)));
  const children = [...plan.doomed.entries()].filter(([key, ids]) => !topLevel.has(key) && ids.size > 0);
  if (children.length) {
    out("");
    out("Related records also removed:");
    for (const [key, ids] of children) {
      const sample = [...ids].slice(0, 5).join(", ");
      out(`  ${key}: ${ids.size}${sample ? ` (e.g. ${sample})` : ""}`);
    }
  }

  out("");
  out(`Total records to delete: ${plan.total}`);
  if (plan.total === 0) out("Nothing matches the test-data prefix rules.");
}

async function removeCollection(key, ids) {
  const objectIds = oids(ids);

  if (key === collectionName(Team)) {
    for (const id of ids) await deleteTeam(id);
    return ids.length;
  }

  if (key === collectionName(Player)) {
    const players = await Player.find({ _id: { $in: objectIds } }).select("imageUrl").lean();
    await Team.updateMany(
      { players: { $in: objectIds } },
      { $pull: { players: { $in: objectIds } } },
    );
    await TeamPlayerRanking.deleteMany({ player: { $in: objectIds } });
    const result = await Player.deleteMany({ _id: { $in: objectIds } });
    for (const player of players) {
      if (player.imageUrl) await deleteStoredFile(player.imageUrl).catch(() => {});
    }
    return result.deletedCount || 0;
  }

  if (key === collectionName(Tournament)) {
    for (const id of ids) {
      await Match.deleteMany({ tournament: id });
      await deleteTournamentContent(id);
    }
    const result = await Tournament.deleteMany({ _id: { $in: objectIds } });
    return result.deletedCount || 0;
  }

  if (key === collectionName(TeamOrganization)) {
    await Membership.deleteMany({ organization: { $in: objectIds } });
    await Invitation.deleteMany({ organization: { $in: objectIds } });
    const result = await TeamOrganization.deleteMany({ _id: { $in: objectIds } });
    return result.deletedCount || 0;
  }

  if (key === collectionName(User)) {
    const users = await User.find({ _id: { $in: objectIds } }).select("email phone").lean();
    for (const user of users) {
      await deleteUserAccount(user._id, { email: user.email || "", phone: user.phone || "" });
    }
    return users.length;
  }

  if (key === collectionName(TournamentMedia)) {
    const rows = await TournamentMedia.find({ _id: { $in: objectIds } }).select("url kind").lean();
    for (const row of rows) {
      if (row.kind === "photo" && row.url) await deleteStoredFile(row.url).catch(() => {});
    }
    const result = await TournamentMedia.deleteMany({ _id: { $in: objectIds } });
    return result.deletedCount || 0;
  }

  if (key === collectionName(TournamentArticle)) {
    const result = await TournamentArticle.deleteMany({ _id: { $in: objectIds } });
    return result.deletedCount || 0;
  }

  if (key === collectionName(CommunityPost)) {
    await CommunityComment.deleteMany({ post: { $in: objectIds } });
    await CommunityLike.deleteMany({ post: { $in: objectIds } });
    const result = await CommunityPost.deleteMany({ _id: { $in: objectIds } });
    return result.deletedCount || 0;
  }

  const model = SIMPLE_DELETES[key];
  if (!model) throw new Error(`No safe delete helper for collection ${key}`);
  const result = await model.deleteMany({ _id: { $in: objectIds } });
  return result.deletedCount || 0;
}

/** Deletes everything in the plan, one audit entry per collection. */
export async function applyCleanup(plan, { out = console.log } = {}) {
  const errors = [];
  const removed = {};

  for (const key of DELETE_ORDER) {
    const ids = [...(plan.doomed.get(key) || [])];
    if (ids.length === 0) continue;

    try {
      const count = await removeCollection(key, ids);
      removed[key] = count;
      out(`  deleted ${count} ${key}`);

      await recordAudit({
        action: "testdata.cleanup",
        targetType: key,
        targetId: "",
        targetLabel: `${count} ${key}`,
        metadata: { collection: key, ids, confirm: plan.total },
        actor: SYSTEM_ACTOR,
      });
    } catch (error) {
      errors.push({ collection: key, message: error.message });
      out(`  FAILED ${key}: ${error.message}`);
      break;
    }
  }

  return { removed, errors };
}

function printApplySummary(plan, summary, out) {
  out("");
  out("=== cleanup summary ===");
  for (const [key, count] of Object.entries(summary.removed)) out(`  ${key}: ${count}`);
  out(`  planned: ${plan.total}, deleted: ${Object.values(summary.removed).reduce((a, b) => a + b, 0)}`);
  if (summary.errors.length) {
    out("");
    out("Errors (cleanup stopped at the first failure):");
    for (const error of summary.errors) out(`  ${error.collection}: ${error.message}`);
  }
}

/**
 * CLI entry point. Returns { exitCode, plan, summary } instead of calling
 * process.exit, so the tests can drive it against an in-memory database.
 */
export async function runCleanup({
  argv = process.argv.slice(2),
  now = Date.now(),
  backupDir = defaultBackupDir(),
  out = console.log,
} = {}) {
  const { apply, confirm } = parseArgs(argv);
  const plan = await collectCleanupPlan();
  printPlan(plan, out);

  if (!apply) {
    out("");
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
    // The backend image has neither docker nor mongodump, so the backup is
    // always taken on the host and, for a container run, copied in.
    out("Create one on the host (from the repository folder), then run this again:");
    out("  cd Backend && npm run db:backup && cd ..");
    out(`  # inside Docker, also copy it in: docker compose cp Backend/backups/<newest backup-*.archive.gz> backend:${backupDir}/`);
    return { exitCode: 1, plan, summary: null };
  }

  if (confirm === null || confirm !== plan.total) {
    out("");
    out(
      `Refusing to delete: --confirm=${confirm === null ? "<missing>" : confirm} does not match the dry-run total ${plan.total}.`,
    );
    out(`Re-run with --apply --confirm=${plan.total}`);
    return { exitCode: 1, plan, summary: null };
  }

  out("");
  out(`Applying with backup ${backup.path}`);
  const summary = await applyCleanup(plan, { out });
  printApplySummary(plan, summary, out);

  return { exitCode: summary.errors.length ? 1 : 0, plan, summary };
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
    return await runCleanup({ argv });
  } finally {
    await mongoose.disconnect();
  }
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === __filename.toLowerCase();

if (isMain) {
  main()
    .then((result) => {
      process.exitCode = result.exitCode;
    })
    .catch((error) => {
      console.error("Cleanup failed:", error.message);
      process.exitCode = 1;
    });
}
