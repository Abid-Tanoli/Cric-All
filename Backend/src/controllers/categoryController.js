// Category Controller
// Handles team categories: International, Leagues, Incubation

import Team from "../models/Team.js";
import IncubationGroup from "../models/IncubationGroup.js";
import Event from "../models/Event.js";
import Blog from "../models/Blog.js";
import Player from "../models/Player.js";
import {
  publicTeamClause,
  sanitizeTeamsPublic,
  filterHiddenTeams,
  TEAM_PUBLIC_SELECT,
} from "../utils/publicProjection.js";

// Get all team categories with counts
export const getCategories = async (req, res) => {
  try {
    // Fix B: the category counts are public, so they count only what a public
    // visitor can actually open — hidden branches and fixtures excluded.
    const [internationalCount, leagueCount, incubationCount] = await Promise.all([
      Team.countDocuments({ type: "international_team", ...publicTeamClause() }),
      Team.countDocuments({ type: "league_team", ...publicTeamClause() }),
      Team.countDocuments({ type: "incubation_team", ...publicTeamClause() })
    ]);

    const incubationGroups = await IncubationGroup.find({ status: "active" }).select("name slug parentOrganization logo description");

    res.json({
      categories: [
        {
          key: "international",
          label: "International Teams",
          icon: "🌍",
          description: "Country-based national cricket teams",
          count: internationalCount,
          color: "blue"
        },
        {
          key: "leagues",
          label: "International Leagues",
          icon: "🏆",
          description: "Professional franchise leagues worldwide",
          count: leagueCount,
          color: "green"
        },
        {
          key: "incubation",
          label: "Incubation Teams",
          icon: "🚀",
          description: "Internal training and development teams",
          count: incubationCount,
          groups: incubationGroups,
          color: "purple"
        }
      ]
    });
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ message: "Failed to fetch categories", error: error.message });
  }
};

// Get teams by type
export const getTeamsByType = async (req, res) => {
  try {
    const { type } = req.params;

    const typeMap = {
      "international": "international_team",
      "league": "league_team",
      "incubation": "incubation_team"
    };

    const teamType = typeMap[type];
    if (!teamType) {
      return res.status(400).json({ message: "Invalid team type" });
    }

    // Fix B: these are public discovery pages — hidden branches and fixtures are
    // withheld, and the payload goes through the shared sanitizer so a roster
    // here cannot become a second player directory.
    const teams = await Team.find({ type: teamType, ...publicTeamClause() })
      .select(TEAM_PUBLIC_SELECT)
      .populate("players", "name role")
      .sort({ name: 1 });

    res.json(sanitizeTeamsPublic(teams));
  } catch (error) {
    console.error("Error fetching teams by type:", error);
    res.status(500).json({ message: "Failed to fetch teams", error: error.message });
  }
};

// Get all leagues (events with type league)
export const getLeagues = async (req, res) => {
  try {
    const leagues = await Event.find({ eventType: "league" })
      .populate("teams", "name shortName logo")
      .sort({ name: 1 });

    res.json(leagues.map((league) => ({
      ...league.toObject(),
      teams: filterHiddenTeams(league.teams || []),
    })));
  } catch (error) {
    console.error("Error fetching leagues:", error);
    res.status(500).json({ message: "Failed to fetch leagues", error: error.message });
  }
};

// Get league details with all data
export const getLeagueDetails = async (req, res) => {
  try {
    const { leagueId } = req.params;

    const league = await Event.findById(leagueId)
      .populate({
        path: "teams",
        populate: { path: "players", select: "name role" }
      })
      .populate("matches")
      .populate("eventSquads.team", "name shortName logo");

    if (!league) {
      return res.status(404).json({ message: "League not found" });
    }

    // Fix B: a league page that a guest opens shows the teams a guest may see.
    league.teams = filterHiddenTeams(league.teams || []);
    league.eventSquads = (league.eventSquads || []).filter(
      (squad) => !squad.team || filterHiddenTeams([squad.team]).length > 0,
    );

    // Get blogs related to this league (by tag or category)
    const blogs = await Blog.find({ 
      $or: [
        { tags: league.name.toLowerCase() },
        { tags: league.slug }
      ],
      isLive: true
    }).limit(10);

    res.json({
      ...league.toObject(),
      blogs,
      totalTeams: league.teams?.length || 0,
      totalMatches: league.matches?.length || 0,
      totalPlayers: league.teams?.reduce((sum, team) => sum + (team.players?.length || 0), 0) || 0
    });
  } catch (error) {
    console.error("Error fetching league details:", error);
    res.status(500).json({ message: "Failed to fetch league details", error: error.message });
  }
};

// Get all incubation groups
export const getIncubationGroups = async (req, res) => {
  try {
    const groups = await IncubationGroup.find({ status: "active" })
      .populate("teams", "name shortName logo players")
      .populate("blogs", "title category isLive")
      .sort({ name: 1 });

    res.json(groups.map((group) => ({
      ...group.toObject(),
      teams: filterHiddenTeams(group.teams || []),
    })));
  } catch (error) {
    console.error("Error fetching incubation groups:", error);
    res.status(500).json({ message: "Failed to fetch incubation groups", error: error.message });
  }
};

// Get incubation group details
export const getIncubationGroupDetails = async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await IncubationGroup.findOne({ slug: groupId })
      .populate({
        path: "teams",
        populate: { path: "players", select: "name role" }
      })
      .populate("blogs");

    if (!group) {
      return res.status(404).json({ message: "Incubation group not found" });
    }

    res.json(group);
  } catch (error) {
    console.error("Error fetching incubation group details:", error);
    res.status(500).json({ message: "Failed to fetch incubation group", error: error.message });
  }
};

// Create incubation group (admin only)
export const createIncubationGroup = async (req, res) => {
  try {
    const { name, description, parentOrganization, manager, contactEmail, logo, tags } = req.body;

    const existingGroup = await IncubationGroup.findOne({ name });
    if (existingGroup) {
      return res.status(400).json({ message: "Group with this name already exists" });
    }

    const group = new IncubationGroup({
      name,
      description,
      parentOrganization,
      manager,
      contactEmail,
      logo,
      tags: tags || ["Internal", "Training"]
    });

    await group.save();
    res.status(201).json(group);
  } catch (error) {
    console.error("Error creating incubation group:", error);
    res.status(500).json({ message: "Failed to create incubation group", error: error.message });
  }
};

// Update incubation group
export const updateIncubationGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    const updates = req.body;

    const group = await IncubationGroup.findOneAndUpdate(
      { slug: groupId },
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    res.json(group);
  } catch (error) {
    console.error("Error updating incubation group:", error);
    res.status(500).json({ message: "Failed to update incubation group", error: error.message });
  }
};

// Delete incubation group
export const deleteIncubationGroup = async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await IncubationGroup.findOneAndDelete({ slug: groupId });
    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    // Don't delete teams, just remove group reference
    await Team.updateMany(
      { incubationGroup: group._id },
      { $unset: { incubationGroup: 1 }, $set: { type: "league_team" } }
    );

    res.json({ message: "Incubation group deleted successfully" });
  } catch (error) {
    console.error("Error deleting incubation group:", error);
    res.status(500).json({ message: "Failed to delete incubation group", error: error.message });
  }
};

// Add team to incubation group
export const addTeamToIncubationGroup = async (req, res) => {
  try {
    const { groupId, teamId } = req.params;

    const group = await IncubationGroup.findOne({ slug: groupId });
    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }

    // Update team
    team.type = "incubation_team";
    team.incubationGroup = group._id;
    team.isInternal = true;
    if (!team.tags) team.tags = [];
    if (!team.tags.includes("Internal")) team.tags.push("Internal");
    if (!team.tags.includes("Training")) team.tags.push("Training");
    await team.save();

    // Add to group if not already
    if (!group.teams.includes(team._id)) {
      group.teams.push(team._id);
      await group.save();
    }

    res.json({ message: "Team added to incubation group", team, group });
  } catch (error) {
    console.error("Error adding team to incubation group:", error);
    res.status(500).json({ message: "Failed to add team to group", error: error.message });
  }
};
