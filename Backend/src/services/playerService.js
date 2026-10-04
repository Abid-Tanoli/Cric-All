import Player from "../models/Player.js";
import Team from "../models/Team.js";
import { PLAYER_PUBLIC_SELECT, playerSelectFor, playerTeamSelectFor } from "../utils/publicProjection.js";

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

export async function getFreeAgents(search = "") {
  const query = { team: { $exists: false } };
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
