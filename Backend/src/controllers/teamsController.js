import Team from "../models/Team.js";
import Player from "../models/Player.js";
import { getIO } from "../socket/socket.js";

export const listTeams = async (req, res) => {
  try {
    const { type, category, subCategory, ageGroup, organization, city, search } = req.query;

    const filter = {};
    if (type) filter.type = type;
    if (category) filter.category = category;
    if (subCategory) filter.subCategory = { $regex: subCategory, $options: "i" };
    if (ageGroup) filter.ageGroup = ageGroup;
    if (organization) filter.organization = { $regex: organization, $options: "i" };
    if (city) filter["address.city"] = { $regex: city, $options: "i" };

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { shortName: { $regex: search, $options: "i" } },
        { ownername: { $regex: search, $options: "i" } },
        { organization: { $regex: search, $options: "i" } },
        { "address.city": { $regex: search, $options: "i" } }
      ];
    }

    const teams = await Team.find(filter).populate("players");
    res.status(200).json(teams);
  } catch (error) {
    console.error("Error fetching teams:", error);
    res.status(500).json({ message: "Failed to fetch teams", error: error.message });
  }
};

export const getTeam = async (req, res) => {
  try {
    const team = await Team.findById(req.params.id).populate("players");

    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }

    res.status(200).json(team);
    console.log(team);
  } catch (error) {
    console.error("Error fetching team:", error);
    res.status(500).json({ message: "Failed to fetch team", error: error.message });
  }
};

export const createTeam = async (req, res) => {
  try {
    const { 
      name, ownername, logo, shortName, players, type, category, isInternal, tags,
      subCategory, ageGroup, organization, address
    } = req.body;

    // Check if team with same name already exists
    const existingTeam = await Team.findOne({ name });
    if (existingTeam) {
      return res.status(400).json({ message: "Team with this name already exists" });
    }

    const team = new Team({
      name,
      ownername: ownername || "",
      logo: logo || "",
      shortName: shortName || name.substring(0, 3).toUpperCase(),
      type: type || "league_team",
      category: category || "Other",
      subCategory: subCategory || "",
      ageGroup: ageGroup || "Open",
      organization: organization || "",
      address: address || { town: "", district: "", city: "", province: "", country: "Pakistan" },
      isInternal: isInternal || false,
      tags: tags || [],
      players: players || []
    });

    await team.save();

    // Update players to reference this team
    if (players && players.length > 0) {
      await Player.updateMany(
        { _id: { $in: players } },
        { $set: { team: team._id } }
      );
    }

    // Populate players before sending response
    await team.populate("players");

    try {
      const io = getIO();
      io.emit("team:created", team);
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(201).json({ team, message: "Team created successfully" });
  } catch (error) {
    console.error("Error creating team:", error);
    res.status(400).json({ message: "Failed to create team", error: error.message });
  }
};

export const updateTeam = async (req, res) => {
  try {
    const { name, ownername, logo, shortName, players } = req.body;

    if (name) {
      const existingTeam = await Team.findOne({
        name,
        _id: { $ne: req.params.id }
      });
      if (existingTeam) {
        return res.status(400).json({ message: "Team with this name already exists" });
      }
    }

    const team = await Team.findById(req.params.id);
    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }

    if (players !== undefined) {
      await Player.updateMany(
        { team: team._id },
        { $unset: { team: 1 } }
      );

      if (players.length > 0) {
        await Player.updateMany(
          { _id: { $in: players } },
          { $set: { team: team._id } }
        );
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (ownername !== undefined) updateData.ownername = ownername;
    if (logo !== undefined) updateData.logo = logo;
    if (shortName !== undefined) updateData.shortName = shortName;
    if (players !== undefined) updateData.players = players;
    if (req.body.category !== undefined) updateData.category = req.body.category;
    if (req.body.subCategory !== undefined) updateData.subCategory = req.body.subCategory;
    if (req.body.ageGroup !== undefined) updateData.ageGroup = req.body.ageGroup;
    if (req.body.organization !== undefined) updateData.organization = req.body.organization;
    if (req.body.address !== undefined) updateData.address = req.body.address;
    if (req.body.media !== undefined) updateData.media = req.body.media;

    const updatedTeam = await Team.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).populate("players");

    try {
      const io = getIO();
      io.emit("team:updated", updatedTeam);
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({ team: updatedTeam, message: "Team updated successfully" });
  } catch (error) {
    console.error("Error updating team:", error);
    res.status(400).json({ message: "Failed to update team", error: error.message });
  }
};

export const deleteTeam = async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);

    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }

    await Player.updateMany(
      { team: team._id },
      { $unset: { team: 1 } }
    );

    await Team.findByIdAndDelete(req.params.id);

    try {
      const io = getIO();
      io.emit("team:deleted", { id: req.params.id });
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({ message: "Team deleted successfully" });
  } catch (error) {
    console.error("Error deleting team:", error);
    res.status(500).json({ message: "Failed to delete team", error: error.message });
  }
};

export const addPlayersToTeam = async (req, res) => {
  try {
    const { playerIds } = req.body;

    if (!playerIds || !Array.isArray(playerIds)) {
      return res.status(400).json({ message: "Player IDs array is required" });
    }

    const team = await Team.findById(req.params.id);
    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }

    const uniquePlayerIds = [...new Set([...team.players.map(p => p.toString()), ...playerIds])];
    team.players = uniquePlayerIds;
    await team.save();

    await Player.updateMany(
      { _id: { $in: playerIds } },
      { $set: { team: team._id } }
    );

    await team.populate("players");

    try {
      const io = getIO();
      io.emit("team:updated", team);
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({ team, message: "Players added successfully" });
  } catch (error) {
    console.error("Error adding players:", error);
    res.status(400).json({ message: "Failed to add players", error: error.message });
  }
};

export const removePlayersFromTeam = async (req, res) => {
  try {
    const { playerIds } = req.body;

    if (!playerIds || !Array.isArray(playerIds)) {
      return res.status(400).json({ message: "Player IDs array is required" });
    }

    const team = await Team.findById(req.params.id);
    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }

    team.players = team.players.filter(p => !playerIds.includes(p.toString()));
    await team.save();

    await Player.updateMany(
      { _id: { $in: playerIds } },
      { $unset: { team: 1 } }
    );

    await team.populate("players");

    try {
      const io = getIO();
      io.emit("team:updated", team);
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({ team, message: "Players removed successfully" });
  } catch (error) {
    console.error("Error removing players:", error);
    res.status(400).json({ message: "Failed to remove players", error: error.message });
  }
};