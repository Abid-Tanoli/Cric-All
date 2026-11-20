import Player from "../models/Player.js";
import { recordAudit } from "../utils/audit.js";
import { hiddenTeamIds } from "../utils/publicProjection.js";
import {
  PLAYING_ROLES,
  bulkPlayerRoleSchema,
} from "../validators/playerValidators.js";

// `role` is legacy free text with no enum; `playingRole` is the enum with a
// "Batsman" default. A player needs fixing when `role` is missing, blank or not
// one of the six real playing roles — the same values the admin dropdown uses.
export const missingRoleQuery = () => ({
  $or: [
    { role: null }, // MongoDB: null also matches a missing field
    { role: /^\s*$/ }, // "", "   ", "\t"
    { role: { $exists: true, $ne: null, $nin: PLAYING_ROLES } },
  ],
});

const asNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/**
 * Advisory only. Uses stored career counters, never match recomputation, and
 * returns null when there is not enough evidence to make a guess. The caller
 * must never apply this automatically.
 */
export const suggestRole = (player) => {
  const stats = player?.stats || {};
  const runs = asNumber(stats.runs);
  const wickets = asNumber(stats.wickets);
  const keeperDismissals = asNumber(stats.stumpings) + asNumber(stats.catches);

  if (keeperDismissals >= 5 && keeperDismissals > wickets) return "Wicket-Keeper";
  if (wickets >= 5 && runs >= 200) return "All-Rounder";
  if (wickets >= 5) return "Bowler";
  if (runs >= 50) return "Batsman";
  return null;
};

const escapeRegex = (value) =>
  String(value).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toTeamSummary = (team) =>
  team && typeof team === "object"
    ? {
        _id: team._id,
        name: team.name || "",
        organization: team.organization || team.organizationRef?.name || "",
      }
    : null;

const toListItem = (player) => {
  const team = toTeamSummary(player.team);
  const history = (player.teamHistory || [])
    .map((entry) => toTeamSummary(entry.team))
    .filter(Boolean);
  const teams = [];
  for (const candidate of [team, ...history]) {
    if (candidate && !teams.some((item) => String(item._id) === String(candidate._id))) {
      teams.push(candidate);
    }
  }
  return {
    _id: player._id,
    name: player.name,
    role: player.role == null ? "" : String(player.role).trim(),
    playingRole: player.playingRole || "",
    teams,
    organization: player.organization || team?.organization || "",
    battingStyle: player.battingStyle || "",
    bowlingStyle: player.bowlingStyle || "",
    stats: {
      matches: asNumber(player.stats?.matches),
      runs: asNumber(player.stats?.runs),
      wickets: asNumber(player.stats?.wickets),
    },
    suggestedRole: suggestRole(player),
  };
};

const validationErrors = (result) =>
  result.error.issues.map((issue) => {
    const index = issue.path[0] === "updates" && Number.isInteger(issue.path[1])
      ? issue.path[1]
      : null;
    return {
      index,
      field: String(issue.path[issue.path.length - 1] || "updates"),
      message: issue.message,
    };
  });

export const listPlayersMissingRole = async (req, res) => {
  try {
    const safeLimit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    const safePage = Math.max(Number(req.query.page) || 1, 1);
    const query = missingRoleQuery();

    const search = escapeRegex(req.query.search || "");
    if (search) query.name = { $regex: search, $options: "i" };
    if (req.query.team) query.team = String(req.query.team);

    // Hidden/private and reserved test-name teams are omitted unless asked for.
    if (String(req.query.includeHidden) !== "true") {
      const excluded = await hiddenTeamIds();
      if (excluded.length) {
        query.$and = [...(query.$and || []), { team: { $nin: excluded } }];
      }
    }

    const [totalPlayers, rows] = await Promise.all([
      Player.countDocuments(query).maxTimeMS(5000),
      Player.find(query)
        .select(
          "name role playingRole organization team teamHistory battingStyle bowlingStyle stats"
        )
        .populate({
          path: "team",
          select: "name organization organizationRef isPublic",
          populate: { path: "organizationRef", select: "name" },
        })
        .populate("teamHistory.team", "name organization organizationRef")
        .sort({ name: 1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .maxTimeMS(5000)
        .lean(),
    ]);

    res.json({
      players: rows.map(toListItem),
      totalPlayers,
      count: totalPlayers,
      totalPages: Math.ceil(totalPlayers / safeLimit),
      currentPage: safePage,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to list players missing a role", error: error.message });
  }
};

export const bulkUpdatePlayerRoles = async (req, res) => {
  // Parse first: a malformed item rejects the whole batch before any lookup.
  const result = bulkPlayerRoleSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ message: "Validation failed", errors: validationErrors(result) });
  }

  const { updates, dryRun } = result.data;
  const errors = [];
  const seen = new Set();
  updates.forEach((item, index) => {
    if (seen.has(item.playerId)) {
      errors.push({ index, field: "playerId", message: "Duplicate playerId" });
    }
    seen.add(item.playerId);
  });

  let found = [];
  if (!errors.length) {
    found = await Player.find({ _id: { $in: [...seen] } })
      .select("_id name role")
      .lean();
  }
  const byId = new Map(found.map((player) => [String(player._id), player]));
  updates.forEach((item, index) => {
    if (!byId.has(item.playerId)) {
      errors.push({ index, field: "playerId", message: "Player not found" });
    }
  });
  if (errors.length) {
    return res.status(400).json({ message: "Validation failed", errors });
  }

  const changes = updates.map((item) => {
    const player = byId.get(item.playerId);
    return {
      playerId: item.playerId,
      name: player.name,
      oldRole: player.role == null ? "" : String(player.role),
      newRole: item.role,
    };
  });

  if (dryRun) {
    return res.json({ dryRun: true, count: changes.length, changes });
  }

  await Player.bulkWrite(
    changes.map((change) => ({
      updateOne: {
        filter: { _id: change.playerId },
        update: { $set: { role: change.newRole } },
      },
    })),
    { ordered: true }
  );

  await recordAudit({
    req,
    action: "player.bulk_role_updated",
    targetType: "player",
    targetLabel: `${changes.length} player role(s) updated`,
    metadata: { count: changes.length, changes },
  });

  return res.json({ dryRun: false, count: changes.length, changes });
};
