import Team from "../models/Team.js";
import Player from "../models/Player.js";
import TeamRanking from "../models/TeamRanking.js";
import TeamOrganization from "../models/TeamOrganization.js";
import TeamCategory from "../models/TeamCategory.js";
import TeamPlayerRanking from "../models/TeamPlayerRanking.js";
import Match from "../models/Match.js";
import { getIO } from "../socket/socket.js";

export async function listTeams(filters = {}) {
  const query = {};
  if (filters.category) query.category = filters.category;
  if (filters.categoryRef) query.categoryRef = filters.categoryRef;
  if (filters.organizationRef) query.organizationRef = filters.organizationRef;
  if (filters.city) query["address.city"] = { $regex: filters.city, $options: "i" };
  if (filters.search) {
    query.$or = [
      { name: { $regex: filters.search, $options: "i" } },
      { shortName: { $regex: filters.search, $options: "i" } },
      { branchName: { $regex: filters.search, $options: "i" } },
      { organization: { $regex: filters.search, $options: "i" } },
      { "address.city": { $regex: filters.search, $options: "i" } },
    ];
  }
  if (filters.isActive !== undefined) query.isActive = filters.isActive;

  const teams = await Team.find(query)
    .populate("players")
    .populate("categoryRef")
    .populate("organizationRef")
    .sort({ name: 1 });

  return teams;
}

export async function getTeamProfile(teamId) {
  const team = await Team.findById(teamId)
    .populate("players")
    .populate("categoryRef")
    .populate("organizationRef");

  if (!team) return null;

  const ranking = await TeamRanking.findOne({ team: teamId });

  const recentMatches = await Match.find({
    teams: teamId,
    status: "completed",
  })
    .populate("teams", "name shortName logo")
    .sort({ startAt: -1 })
    .limit(10);

  let branches = [];
  if (team.organizationRef) {
    branches = await Team.find({
      organizationRef: team.organizationRef,
      _id: { $ne: teamId },
      isActive: true,
    })
      .select("name branchName city logo shortName")
      .populate("organizationRef", "name");
  }

  const playerRankings = await TeamPlayerRanking.find({ team: teamId })
    .populate("player", "name imageUrl role playingRole");

  return {
    team,
    ranking: ranking || null,
    recentMatches,
    branches,
    playerRankings,
  };
}

export async function createTeam(data) {
  const existing = await Team.findOne({ name: data.name });
  if (existing) throw new Error("Team with this name already exists");

  const team = new Team({
    name: data.name,
    shortName: data.shortName || data.name.substring(0, 3).toUpperCase(),
    type: data.type || "local_team",
    category: data.category || "Other",
    categoryRef: data.categoryRef || null,
    subCategory: data.subCategory || "",
    ageGroup: data.ageGroup || "Open",
    organization: data.organization || "",
    organizationRef: data.organizationRef || null,
    branchName: data.branchName || "",
    ownername: data.ownername || "",
    logo: data.logo || "",
    fullAddress: data.fullAddress || "",
    address: data.address || { town: "", district: "", city: "", province: "", country: "Pakistan" },
    area: data.area || "",
    city: data.city || (data.address?.city || ""),
    latitude: data.latitude,
    longitude: data.longitude,
    googleMapsUrl: data.googleMapsUrl || "",
    placeId: data.placeId || "",
    phone: data.phone || "",
    email: data.email || "",
    website: data.website || "",
    establishedYear: data.establishedYear,
    homeGround: data.homeGround || "",
    teamColorPrimary: data.teamColorPrimary || "#00a650",
    teamColorSecondary: data.teamColorSecondary || "#003087",
    isInternal: data.isInternal || false,
    tags: data.tags || [],
    players: data.players || [],
  });

  await team.save();

  if (team.players && team.players.length > 0) {
    await Player.updateMany(
      { _id: { $in: team.players } },
      { $set: { team: team._id } }
    );
  }

  await team.populate("players");
  await team.populate("categoryRef");
  await team.populate("organizationRef");

  try { getIO()?.emit("team:created", team); } catch (e) {}

  return team;
}

export async function updateTeam(teamId, data) {
  if (data.name) {
    const existing = await Team.findOne({ name: data.name, _id: { $ne: teamId } });
    if (existing) throw new Error("Team with this name already exists");
  }

  const team = await Team.findById(teamId);
  if (!team) throw new Error("Team not found");

  const updateFields = [
    "name", "shortName", "type", "category", "categoryRef", "subCategory", "ageGroup",
    "organization", "organizationRef", "branchName", "ownername", "logo",
    "fullAddress", "address", "area", "latitude", "longitude",
    "googleMapsUrl", "placeId", "phone", "email", "website",
    "establishedYear", "homeGround", "teamColorPrimary", "teamColorSecondary",
    "isActive", "profileComplete", "isInternal", "tags", "media",
  ];

  const objectIdFields = ["categoryRef", "organizationRef", "incubationGroup"];
  for (const field of objectIdFields) {
    if (data[field] === "") data[field] = null;
  }

  for (const field of updateFields) {
    if (data[field] !== undefined) {
      team[field] = data[field];
    }
  }

  if (data.players !== undefined) {
    await Player.updateMany(
      { team: team._id },
      { $unset: { team: 1 } }
    );
    if (data.players.length > 0) {
      await Player.updateMany(
        { _id: { $in: data.players } },
        { $set: { team: team._id } }
      );
    }
    team.players = data.players;
  }

  await team.save();
  await team.populate("players");
  await team.populate("categoryRef");
  await team.populate("organizationRef");

  try { getIO()?.emit("team:updated", team); } catch (e) {}

  return team;
}

export async function deleteTeam(teamId) {
  const team = await Team.findById(teamId);
  if (!team) throw new Error("Team not found");

  await Player.updateMany({ team: teamId }, { $unset: { team: 1 } });
  await TeamRanking.deleteOne({ team: teamId });
  await TeamPlayerRanking.deleteMany({ team: teamId });
  await Team.findByIdAndDelete(teamId);

  try { getIO()?.emit("team:deleted", { id: teamId }); } catch (e) {}

  return { id: teamId };
}

export async function assignPlayerToTeam(teamId, playerId, role = "player", jerseyNumber) {
  const team = await Team.findById(teamId);
  if (!team) throw new Error("Team not found");

  const player = await Player.findById(playerId);
  if (!player) throw new Error("Player not found");

  const oldTeamId = player.team?.toString();

  if (oldTeamId && oldTeamId !== teamId) {
    await Team.findByIdAndUpdate(oldTeamId, { $pull: { players: playerId } });
    if (!player.teamHistory) player.teamHistory = [];
    player.teamHistory.push({
      team: oldTeamId,
      from: new Date(),
      to: new Date(),
      isCurrent: false,
    });
  }

  player.team = teamId;
  player.role = role || player.role;
  await player.save();

  await Team.findByIdAndUpdate(teamId, { $addToSet: { players: playerId } });

  try { getIO()?.emit("team:updated", team); } catch (e) {}

  return player;
}

export async function removePlayerFromTeam(teamId, playerId) {
  const team = await Team.findById(teamId);
  if (!team) throw new Error("Team not found");

  team.players = team.players.filter((p) => p.toString() !== playerId);
  await team.save();

  const player = await Player.findById(playerId);
  if (player) {
    if (!player.teamHistory) player.teamHistory = [];
    player.teamHistory.push({
      team: teamId,
      from: new Date(),
      to: new Date(),
      isCurrent: false,
    });
    player.team = null;
    await player.save();
  }

  try { getIO()?.emit("team:updated", team); } catch (e) {}

  return team;
}

export async function updatePlayerRole(teamId, playerId, data) {
  const player = await Player.findById(playerId);
  if (!player || player.team?.toString() !== teamId) {
    throw new Error("Player not in this team");
  }

  if (data.role) player.role = data.role;
  if (data.jerseyNumber !== undefined) player.jerseyNumber = data.jerseyNumber;
  await player.save();

  return player;
}

export async function getOrganizationTree() {
  const organizations = await TeamOrganization.find({ isActive: true })
    .populate("category", "name slug icon")
    .sort({ name: 1 });

  const result = [];

  for (const org of organizations) {
    const branches = await Team.find({ organizationRef: org._id, isActive: true })
      .populate("players")
      .populate("categoryRef");

    const branchCount = branches.length;
    const totalPlayers = branches.reduce((sum, b) => sum + (b.players?.length || 0), 0);

    result.push({
      organization: org,
      branches,
      branchCount,
      totalPlayers,
    });
  }

  return result;
}
