import Event from "../models/Event.js";
import Match from "../models/Match.js";
import Team from "../models/Team.js";
import { getIO } from "../socket/socket.js";

export const getEvents = async (req, res) => {
  try {
    const { eventType, status, category, subCategory, ageGroup, organization, city, search } = req.query;
    const query = {};
    
    if (eventType) query.eventType = eventType;
    if (status) query.status = status;
    if (category) query.category = category;
    if (subCategory) query.subCategory = { $regex: subCategory, $options: "i" };
    if (ageGroup) query.ageGroup = ageGroup;
    if (organization) query.organization = { $regex: organization, $options: "i" };
    if (city) query["address.city"] = { $regex: city, $options: "i" };
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { shortName: { $regex: search, $options: "i" } },
        { organization: { $regex: search, $options: "i" } },
        { "address.city": { $regex: search, $options: "i" } },
        { "address.town": { $regex: search, $options: "i" } }
      ];
    }

    const events = await Event.find(query)
      .populate("teams", "name shortName logo")
      .populate("matches")
      .populate("winner", "name shortName logo")
      .populate("runnerUp", "name shortName logo")
      .sort({ startDate: -1 });

    res.status(200).json(events);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch events", error: error.message });
  }
};

export const getEvent = async (req, res) => {
  try {
    const { id } = req.params;
    let event;

    // Support both ID and slug lookup
    if (id.length === 24) {
      event = await Event.findById(id)
        .populate("teams", "name shortName logo players")
        .populate("matches")
        .populate("eventSquads.team", "name shortName logo")
        .populate("eventSquads.players", "name role playingRole imageUrl battingStyle bowlingStyle")
        .populate("eventSquads.captain", "name")
        .populate("eventSquads.viceCaptain", "name")
        .populate("eventSquads.wicketKeepers", "name")
        .populate("pointsTable.team", "name shortName logo")
        .populate("winner", "name shortName logo")
        .populate("runnerUp", "name shortName logo");
    } else {
      event = await Event.findOne({ slug: id })
        .populate("teams", "name shortName logo players")
        .populate("matches")
        .populate("eventSquads.team", "name shortName logo")
        .populate("eventSquads.players", "name role playingRole imageUrl battingStyle bowlingStyle")
        .populate("eventSquads.captain", "name")
        .populate("eventSquads.viceCaptain", "name")
        .populate("eventSquads.wicketKeepers", "name")
        .populate("pointsTable.team", "name shortName logo")
        .populate("winner", "name shortName logo")
        .populate("runnerUp", "name shortName logo");
    }

    if (!event) return res.status(404).json({ message: "Event not found" });
    res.status(200).json(event);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch event", error: error.message });
  }
};

export const createEvent = async (req, res) => {
  try {
    const { 
      name, shortName, eventType, teams, format, startDate, endDate, venue, description, totalMatches, overs,
      category, subCategory, ageGroup, organization, address
    } = req.body;

    if (!name || !eventType) {
      return res.status(400).json({ message: "Name and event type are required" });
    }

    if (eventType !== "single-match" && (!teams || teams.length < 2)) {
      return res.status(400).json({ message: "At least 2 teams are required" });
    }

    // Initialize points table for multi-team events
    let pointsTable = [];
    if (["series", "tri-series", "tournament", "world-cup", "champions-trophy", "league"].includes(eventType)) {
      pointsTable = teams.map(teamId => ({
        team: teamId,
        matchesPlayed: 0, won: 0, lost: 0, tied: 0, noResult: 0,
        points: 0, netRunRate: 0, for: 0, against: 0, wicketsFor: 0, wicketsAgainst: 0, seriesForm: []
      }));
    }

    const event = new Event({
      name,
      shortName: shortName || name.substring(0, 10).toUpperCase(),
      eventType,
      teams: teams || [],
      format: format || "T20",
      totalMatches: totalMatches || 0,
      oversPerInnings: overs || (format === "Tape Ball" ? 8 : 20),
      startDate,
      endDate,
      venue: venue || "",
      description: description || "",
      pointsTable,
      status: "upcoming",
      category: category || "Other",
      subCategory: subCategory || "",
      ageGroup: ageGroup || "Open",
      organization: organization || "",
      address: address || { town: "", district: "", city: "", province: "", country: "Pakistan" }
    });

    await event.save();
    await event.populate("teams", "name shortName logo");

    try { getIO().emit("event:created", event); } catch { }

    res.status(201).json({ event, message: "Event created successfully" });
  } catch (error) {
    res.status(400).json({ message: "Failed to create event", error: error.message });
  }
};

export const updateEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ message: "Event not found" });

    Object.assign(event, req.body);
    await event.save();
    await event.populate("teams", "name shortName logo");

    try { getIO().emit("event:updated", event); } catch { }

    res.status(200).json({ event, message: "Event updated successfully" });
  } catch (error) {
    res.status(400).json({ message: "Failed to update event", error: error.message });
  }
};

export const deleteEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ message: "Event not found" });

    // Delete matches linked in event.matches array
    if (event.matches && event.matches.length > 0) {
      await Match.deleteMany({ _id: { $in: event.matches } });
    }
    // Also delete any matches that reference this event as tournament
    await Match.deleteMany({ tournament: req.params.id });

    await Event.findByIdAndDelete(req.params.id);
    try { getIO().emit("event:deleted", { id: req.params.id }); } catch { }

    res.status(200).json({ message: "Event and associated matches deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete event", error: error.message });
  }
};

// Event Squad Management (11-20 players per team)
export const setEventSquad = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { teamId, players, captain, viceCaptain, wicketKeepers } = req.body;

    if (!players || players.length < 11 || players.length > 20) {
      return res.status(400).json({ message: "Event squad size must be between 11 and 20 players" });
    }
    if (!captain) return res.status(400).json({ message: "Captain is required" });
    if (!viceCaptain) return res.status(400).json({ message: "Vice-captain is required" });
    if (!wicketKeepers || wicketKeepers.length === 0) return res.status(400).json({ message: "At least one wicket-keeper is required" });

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    const isTeamInEvent = event.teams.some(t => t.toString() === teamId.toString());
    if (!isTeamInEvent) return res.status(400).json({ message: "Team is not part of this event" });

    const existingSquad = event.eventSquads.find(s => s.team.toString() === teamId.toString());
    if (existingSquad) {
      existingSquad.players = players;
      existingSquad.captain = captain;
      existingSquad.viceCaptain = viceCaptain;
      existingSquad.wicketKeepers = wicketKeepers;
    } else {
      event.eventSquads.push({ team: teamId, players, captain, viceCaptain, wicketKeepers });
    }

    await event.save();
    await event.populate("eventSquads.team", "name shortName logo");
    await event.populate("eventSquads.players", "name role playingRole");

    try { getIO().emit("event:squadUpdated", { eventId, teamId }); } catch { }

    res.status(200).json({ message: "Event squad set successfully", event });
  } catch (error) {
    res.status(500).json({ message: "Failed to set event squad", error: error.message });
  }
};

export const getEventSquad = async (req, res) => {
  try {
    const { eventId, teamId } = req.params;
    const event = await Event.findById(eventId)
      .populate("eventSquads.team", "name shortName logo")
      .populate("eventSquads.players", "name role playingRole imageUrl battingStyle bowlingStyle")
      .populate("eventSquads.playerChanges.outPlayer", "name role playingRole")
      .populate("eventSquads.playerChanges.inPlayer", "name role playingRole");

    if (!event) return res.status(404).json({ message: "Event not found" });

    if (teamId) {
      const squad = event.eventSquads.find(s => s.team?._id?.toString() === teamId || s.team?.toString() === teamId);
      if (!squad) return res.status(404).json({ message: "Squad not found for this team" });
      return res.status(200).json(squad);
    }

    res.status(200).json(event.eventSquads);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch event squad", error: error.message });
  }
};

// Change a player in an event squad (injury replacement etc.)
export const changeEventSquadPlayer = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { teamId, outPlayerId, inPlayerId, reason, notes } = req.body;

    if (!teamId || !outPlayerId || !inPlayerId) {
      return res.status(400).json({ message: "teamId, outPlayerId and inPlayerId are required" });
    }
    if (outPlayerId === inPlayerId) {
      return res.status(400).json({ message: "outPlayer and inPlayer must be different" });
    }

    const validReasons = ["injury", "illness", "disciplinary", "personal", "other"];
    const changeReason = validReasons.includes(reason) ? reason : "other";

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    const squadEntry = event.eventSquads.find(s => s.team.toString() === teamId.toString());
    if (!squadEntry) return res.status(404).json({ message: "Squad not found for this team in event" });

    const outIdx = squadEntry.players.findIndex(p => p.toString() === outPlayerId.toString());
    if (outIdx === -1) return res.status(400).json({ message: "outPlayer not in current event squad" });

    // Swap the player in the squad array
    squadEntry.players[outIdx] = inPlayerId;

    // Handle captain/VC/WK role transfer if the outgoing player held a role
    if (squadEntry.captain?.toString() === outPlayerId.toString()) squadEntry.captain = inPlayerId;
    if (squadEntry.viceCaptain?.toString() === outPlayerId.toString()) squadEntry.viceCaptain = inPlayerId;
    const wkIdx = squadEntry.wicketKeepers?.findIndex(w => w.toString() === outPlayerId.toString());
    if (wkIdx !== undefined && wkIdx !== -1) squadEntry.wicketKeepers[wkIdx] = inPlayerId;

    // Log the change
    squadEntry.playerChanges.push({
      outPlayer: outPlayerId,
      inPlayer: inPlayerId,
      reason: changeReason,
      notes: notes || "",
      changedAt: new Date()
    });

    await event.save();
    await event.populate("eventSquads.players", "name role playingRole");
    await event.populate("eventSquads.playerChanges.outPlayer", "name role playingRole");
    await event.populate("eventSquads.playerChanges.inPlayer", "name role playingRole");

    try { getIO().emit("event:squadPlayerChanged", { eventId, teamId, outPlayerId, inPlayerId, reason: changeReason }); } catch {}

    res.status(200).json({ message: "Player changed successfully", event });
  } catch (error) {
    res.status(500).json({ message: "Failed to change squad player", error: error.message });
  }
};

// Add match to event
export const addMatchToEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { matchId } = req.body;

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    if (!event.matches.includes(matchId)) {
      event.matches.push(matchId);
      await event.save();
    }

    // Update the match to reference this event
    await Match.findByIdAndUpdate(matchId, { tournament: eventId });

    await event.populate("matches");
    res.status(200).json({ message: "Match added to event", event });
  } catch (error) {
    res.status(500).json({ message: "Failed to add match to event", error: error.message });
  }
};
