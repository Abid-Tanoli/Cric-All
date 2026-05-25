import Player from "../models/Player.js";
import Team from "../models/Team.js";

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
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { role: { $regex: search, $options: "i" } },
    ];
  }
  return Player.find(query).sort({ name: 1 });
}

export async function getTeamPlayers(teamId, filters = {}) {
  const query = { team: teamId };
  if (filters.role) query.role = filters.role;
  if (filters.search) {
    query.$or = [
      { name: { $regex: filters.search, $options: "i" } },
    ];
  }

  const players = await Player.find(query)
    .populate("team", "name shortName")
    .sort({ role: -1, name: 1 });

  return players;
}

export async function getPlayerTeamHistory(playerId) {
  const player = await Player.findById(playerId)
    .populate("team", "name shortName logo")
    .populate("teamHistory.team", "name shortName logo");
  return player;
}
