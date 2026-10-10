import Player from "../models/Player.js";
import Team from "../models/Team.js";
import { normalizePhone } from "../utils/phone.js";
import {
  PLAYER_PUBLIC_SELECT,
  playerSelectFor,
  playerTeamSelectFor,
  reservedNamesMongoClause,
  isHiddenTeamDoc,
  canViewTeamPrivate,
} from "../utils/publicProjection.js";

// ---------------------------------------------------------------------------
// Terminal A (oct11-A): canonical identity for admin data entry.
//
// Two players are "the same person" in the same team when the name matches
// after case-folding and whitespace-collapsing; and "the same person" anywhere
// when a phone number is given, because a phone is a stronger identifier than a
// name. Both helpers are the single definition the controllers and the bulk
// importer share, so duplicate prevention cannot drift between entry paths.
// ---------------------------------------------------------------------------
export function normalizePlayerName(name) {
  return String(name ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// Stored in the digits-only canonical form used by utils/phone.js so the same
// number cannot be entered in two formats. A value that cannot be a phone
// number is kept (trimmed, case-folded) so it is still comparable rather than
// silently dropped.
export function canonicalPlayerPhone(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  return normalizePhone(trimmed) || trimmed.toLowerCase();
}

export class DuplicatePlayerError extends Error {
  constructor(message, existing) {
    super(message);
    this.name = "DuplicatePlayerError";
    this.code = "PLAYER_DUPLICATE";
    this.existing = existing
      ? { _id: existing._id, name: existing.name, phone: existing.phone || "" }
      : null;
  }
}

/**
 * Backend-enforced duplicate prevention for admin-entered players.
 * Throws `DuplicatePlayerError` (409) naming the existing record. `excludeId`
 * lets an update ignore the document being saved.
 */
export async function assertPlayerNotDuplicate({ name, team, phone, excludeId = null } = {}) {
  const canonicalPhone = canonicalPlayerPhone(phone);
  if (canonicalPhone) {
    const phoneQuery = { phone: canonicalPhone };
    if (excludeId) phoneQuery._id = { $ne: excludeId };
    const byPhone = await Player.findOne(phoneQuery).select("_id name phone").lean();
    if (byPhone) {
      throw new DuplicatePlayerError(
        `A player with this phone number already exists: "${byPhone.name}".`,
        byPhone
      );
    }
  }

  const normalized = normalizePlayerName(name);
  if (normalized && team) {
    // Rosters are small (a squad), so comparing normalized names in JS is both
    // cheaper than a regex and correct across internal spacing.
    const roster = await Player.find({ team }).select("_id name phone").lean();
    const clash = roster.find(
      (p) =>
        (!excludeId || String(p._id) !== String(excludeId)) &&
        normalizePlayerName(p.name) === normalized
    );
    if (clash) {
      throw new DuplicatePlayerError(
        `A player named "${clash.name}" already exists in this team.`,
        clash
      );
    }
  }
}

export async function assignPlayerToTeam(playerId, teamId, role = "player", jerseyNumber) {
  const player = await Player.findById(playerId);
  if (!player) throw new Error("Player not found");

  const team = await Team.findById(teamId);
  if (!team) throw new Error("Team not found");

  const oldTeamId = player.team?.toString();

  if (oldTeamId && oldTeamId !== teamId) {
    await Team.findByIdAndUpdate(oldTeamId, { $pull: { players: playerId } });

    if (!player.teamHistory) player.teamHistory = [];
    player.teamHistory.push({
      team: oldTeamId,
      from: player.teamHistory.length > 0
        ? player.teamHistory[player.teamHistory.length - 1].to || new Date()
        : new Date(),
      to: new Date(),
      isCurrent: false,
    });
  }

  player.team = teamId;
  player.role = role || player.role;
  await player.save();

  await Team.findByIdAndUpdate(teamId, { $addToSet: { players: playerId } });

  const populatedPlayer = await Player.findById(playerId).populate("team", "name shortName logo");

  return populatedPlayer;
}

export async function removePlayerFromTeam(playerId) {
  const player = await Player.findById(playerId);
  if (!player) throw new Error("Player not found");
  if (!player.team) return player;

  const teamId = player.team.toString();

  if (!player.teamHistory) player.teamHistory = [];
  player.teamHistory.push({
    team: teamId,
    from: player.teamHistory.length > 0
      ? player.teamHistory[player.teamHistory.length - 1].to || new Date()
      : new Date(),
    to: new Date(),
    isCurrent: false,
  });

  player.team = null;
  player.role = player.role;
  await player.save();

  await Team.findByIdAndUpdate(teamId, { $pull: { players: playerId } });

  return player;
}

export async function getFreeAgents(search = "", opts = {}) {
  const query = { team: { $exists: false } };
  if (opts.excludeReservedTestNames) Object.assign(query, reservedNamesMongoClause("name"));
  if (search) {
    const term = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    query.$or = [
      { name: { $regex: term, $options: "i" } },
      { role: { $regex: term, $options: "i" } },
    ];
  }
  // Round 5: bounded and projected. This is an unauthenticated endpoint and
  // `find(query)` with no `.select()` returned each free agent's full document.
  const limit = 200;
  const [total, players] = await Promise.all([
    Player.countDocuments(query),
    Player.find(query)
      .select(PLAYER_PUBLIC_SELECT)
      .sort({ name: 1 })
      .limit(limit)
      .lean(),
  ]);
  return { items: players, total, truncated: total > limit };
}

// Round 5: same treatment for the roster behind GET /teams/:id/players, which is
// also unauthenticated and also used to return whole player documents.
//
// `viewer` widens the `.select()` for an identified caller. Without it the query
// loads only public columns, so a manager of the owning organization would be
// recognised by the sanitizer and then handed a document with nothing extra in
// it - the escalation would compile, pass review and never actually show anyone
// their own squad's date of birth.
export async function getTeamPlayers(teamId, filters = {}, viewer = null) {
  // Fix B: a hidden team's roster is not readable by a public caller — the team
  // page itself answers 404 for them, and this endpoint was the other way to
  // reach the same list. Members and platform admins still see it.
  const team = await Team.findById(teamId).select("name organizationRef isPublic").lean();
  if (team && isHiddenTeamDoc(team) && !canViewTeamPrivate(viewer, team)) return [];

  const query = { team: teamId };
  if (filters.role) query.role = filters.role;
  if (filters.search) {
    const term = String(filters.search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    query.$or = [{ name: { $regex: term, $options: "i" } }];
  }

  return Player.find(query)
    .select(playerSelectFor(viewer))
    .populate("team", playerTeamSelectFor(viewer))
    .sort({ role: -1, name: 1 })
    .lean();
}

export async function getPlayerTeamHistory(playerId) {
  const player = await Player.findById(playerId)
    .populate("team", "name shortName logo")
    .populate("teamHistory.team", "name shortName logo");
  return player;
}
