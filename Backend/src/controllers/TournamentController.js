import Tournament from "../models/Tournament.js";
import Match from "../models/Match.js";
import Team from "../models/Team.js";
import { getIO } from "../socket/socket.js";
import mongoose from "mongoose";

export const getTournaments = async (req, res) => {
  try {
    const tournaments = await Tournament.find()
      .populate("teams", "name shortName logo")
      .populate("winner", "name shortName logo")
      .populate("runnerUp", "name shortName logo")
      .sort({ startDate: -1 });

    res.status(200).json(tournaments);
  } catch (error) {
    console.error("Error fetching tournaments:", error);
    res.status(500).json({
      message: "Failed to fetch tournaments",
      error: error.message
    });
  }
};

export const getTournament = async (req, res) => {
  try {
    const { id } = req.params;
    const query = mongoose.isValidObjectId(id) ? { _id: id } : { slug: id };
    const tournament = await Tournament.findOne(query)
      .populate("teams", "name shortName logo players")
      .populate("matches")
      .populate("pointsTable.team", "name shortName logo")
      .populate("winner", "name shortName logo")
      .populate("runnerUp", "name shortName logo");

    if (!tournament) {
      return res.status(404).json({ message: "Tournament not found" });
    }

    res.status(200).json(tournament);
  } catch (error) {
    console.error("Error fetching tournament:", error);
    res.status(500).json({
      message: "Failed to fetch tournament",
      error: error.message
    });
  }
};

export const createTournament = async (req, res) => {
  try {
    const { name, shortName, type, startDate, endDate, teams, venue, format } = req.body;

    if (!teams || teams.length < 2) {
      return res.status(400).json({
        message: "At least 2 teams are required"
      });
    }

    // Initialize points table for all teams
    const pointsTable = teams.map(teamId => ({
      team: teamId,
      matchesPlayed: 0,
      won: 0,
      lost: 0,
      tied: 0,
      noResult: 0,
      points: 0,
      netRunRate: 0,
      for: 0,
      against: 0,
      wicketsFor: 0,
      wicketsAgainst: 0,
      seriesForm: []
    }));

    const tournament = new Tournament({
      name,
      shortName: shortName || name.substring(0, 10).toUpperCase(),
      type: type || "league",
      startDate,
      endDate,
      teams,
      venue: venue || "",
      format: format || "T20",
      pointsTable,
      status: "upcoming"
    });

    await tournament.save();
    await tournament.populate("teams", "name shortName logo");

    try {
      const io = getIO();
      io.emit("tournament:created", tournament);
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(201).json({
      tournament,
      message: "Tournament created successfully"
    });
  } catch (error) {
    console.error("Error creating tournament:", error);
    res.status(400).json({
      message: "Failed to create tournament",
      error: error.message
    });
  }
};

export const updateTournament = async (req, res) => {
  try {
    const tournament = await Tournament.findById(req.params.id);

    if (!tournament) {
      return res.status(404).json({ message: "Tournament not found" });
    }

    Object.assign(tournament, req.body);
    await tournament.save();
    await tournament.populate("teams", "name shortName logo");

    try {
      const io = getIO();
      io.emit("tournament:updated", tournament);
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({
      tournament,
      message: "Tournament updated successfully"
    });
  } catch (error) {
    console.error("Error updating tournament:", error);
    res.status(400).json({
      message: "Failed to update tournament",
      error: error.message
    });
  }
};

export const deleteTournament = async (req, res) => {
  try {
    const tournament = await Tournament.findById(req.params.id);

    if (!tournament) {
      return res.status(404).json({ message: "Tournament not found" });
    }

    // Delete all associated matches
    if (tournament.matches && tournament.matches.length > 0) {
      await Match.deleteMany({ _id: { $in: tournament.matches } });
    }

    await Tournament.findByIdAndDelete(req.params.id);

    try {
      const io = getIO();
      io.emit("tournament:deleted", { id: req.params.id });
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({ message: "Tournament deleted successfully" });
  } catch (error) {
    console.error("Error deleting tournament:", error);
    res.status(500).json({
      message: "Failed to delete tournament",
      error: error.message
    });
  }
};

export const getTournamentPointsTable = async (req, res) => {
  try {
    const tournament = await Tournament.findById(req.params.id)
      .populate("pointsTable.team", "name shortName logo");

    if (!tournament) {
      return res.status(404).json({ message: "Tournament not found" });
    }

    // Sort by points, then by net run rate
    const sortedTable = [...tournament.pointsTable].sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return b.netRunRate - a.netRunRate;
    });

    res.status(200).json(sortedTable);
  } catch (error) {
    console.error("Error fetching points table:", error);
    res.status(500).json({
      message: "Failed to fetch points table",
      error: error.message
    });
  }
};

export const updatePointsTable = async (req, res) => {
  try {
    const { tournamentId, matchId } = req.body;

    const tournament = await Tournament.findById(tournamentId);
    const match = await Match.findById(matchId);

    if (!tournament || !match) {
      return res.status(404).json({ message: "Tournament or match not found" });
    }

    if (match.status !== "completed") {
      return res.status(400).json({ message: "Match is not completed yet" });
    }

    // Update points table based on match result
    const team1 = match.teams[0];
    const team2 = match.teams[1];

    const team1Entry = tournament.pointsTable.find(
      entry => entry.team.toString() === team1.toString()
    );
    const team2Entry = tournament.pointsTable.find(
      entry => entry.team.toString() === team2.toString()
    );

    if (!team1Entry || !team2Entry) {
      return res.status(400).json({ message: "Teams not found in tournament" });
    }

    // Update matches played
    team1Entry.matchesPlayed += 1;
    team2Entry.matchesPlayed += 1;

    const innings1 = match.innings[0];
    const innings2 = match.innings[1];

    // Update runs and wickets
    team1Entry.for += innings1.runs;
    team1Entry.against += innings2.runs;
    team1Entry.wicketsFor += innings2.wickets;
    team1Entry.wicketsAgainst += innings1.wickets;

    team2Entry.for += innings2.runs;
    team2Entry.against += innings1.runs;
    team2Entry.wicketsFor += innings1.wickets;
    team2Entry.wicketsAgainst += innings2.wickets;

    // Helper to update series form
    const updateForm = (entry, result) => {
      entry.seriesForm.push(result);
      if (entry.seriesForm.length > 5) {
        entry.seriesForm.shift();
      }
    };

    if (match.result.resultType === "tie") {
      team1Entry.tied += 1;
      team2Entry.tied += 1;
      team1Entry.points += 1;
      team2Entry.points += 1;
      updateForm(team1Entry, "T");
      updateForm(team2Entry, "T");
    } else if (match.result.resultType === "no result") {
      team1Entry.noResult += 1;
      team2Entry.noResult += 1;
      team1Entry.points += 1;
      team2Entry.points += 1;
      updateForm(team1Entry, "NR");
      updateForm(team2Entry, "NR");
    } else if (match.result.winner) {
      if (match.result.winner.toString() === team1.toString()) {
        team1Entry.won += 1;
        team1Entry.points += 2;
        team2Entry.lost += 1;
        updateForm(team1Entry, "W");
        updateForm(team2Entry, "L");
      } else {
        team2Entry.won += 1;
        team2Entry.points += 2;
        team1Entry.lost += 1;
        updateForm(team2Entry, "W");
        updateForm(team1Entry, "L");
      }
    }

    // Improved Net Run Rate calculation
    const calculateNRR = (entry) => {
      // If team is all out, we use full quota of overs
      // For simplicity, we use match matchType to determine overs per match
      // In a real scenario, this would be match.totalOvers
      const totalOversPerMatch = match.totalOvers || 20;

      const oversFaced = entry.matchesPlayed * totalOversPerMatch;
      const oversBowled = entry.matchesPlayed * totalOversPerMatch;

      const runRateFor = entry.for / oversFaced;
      const runRateAgainst = entry.against / oversBowled;

      return runRateFor - runRateAgainst;
    };

    team1Entry.netRunRate = calculateNRR(team1Entry);
    team2Entry.netRunRate = calculateNRR(team2Entry);

    await tournament.save();

    try {
      const io = getIO();
      io.emit("tournament:pointsTableUpdated", tournament);
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({
      tournament,
      message: "Points table updated successfully"
    });
  } catch (error) {
    console.error("Error updating points table:", error);
    res.status(400).json({
      message: "Failed to update points table",
      error: error.message
    });
  }
};

export const getTournamentFixtures = async (req, res) => {
  try {
    const tournament = await Tournament.findById(req.params.id);

    if (!tournament) {
      return res.status(404).json({ message: "Tournament not found" });
    }

    const matches = await Match.find({ tournament: req.params.id })
      .populate("teams", "name shortName logo")
      .populate("result.winner", "name")
      .sort({ startAt: 1 });

    res.status(200).json(matches);
  } catch (error) {
    console.error("Error fetching fixtures:", error);
    res.status(500).json({
      message: "Failed to fetch fixtures",
      error: error.message
    });
  }
};

// Tournament/Series Squad Management (11-20 players per team)
export const setTournamentSquad = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { teamId, players, captain, viceCaptain, wicketKeepers } = req.body;

    if (!players || players.length < 11 || players.length > 20) {
      return res.status(400).json({
        message: "Tournament squad size must be between 11 and 20 players"
      });
    }

    if (!captain) {
      return res.status(400).json({ message: "Captain is required" });
    }

    if (!viceCaptain) {
      return res.status(400).json({ message: "Vice-captain is required" });
    }

    if (!wicketKeepers || wicketKeepers.length === 0) {
      return res.status(400).json({ message: "At least one wicket-keeper is required" });
    }

    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ message: "Tournament not found" });
    }

    const isTeamInTournament = tournament.teams.some(
      t => t.toString() === teamId.toString()
    );

    if (!isTeamInTournament) {
      return res.status(400).json({
        message: "Team is not part of this tournament"
      });
    }

    const existingSquad = tournament.tournamentSquads.find(
      s => s.team.toString() === teamId.toString()
    );

    if (existingSquad) {
      existingSquad.players = players;
      existingSquad.captain = captain;
      existingSquad.viceCaptain = viceCaptain;
      existingSquad.wicketKeepers = wicketKeepers;
    } else {
      tournament.tournamentSquads.push({
        team: teamId,
        players,
        captain,
        viceCaptain,
        wicketKeepers
      });
    }

    await tournament.save();
    await tournament.populate("tournamentSquads.team", "name shortName logo");
    await tournament.populate("tournamentSquads.players", "name role playingRole");

    try {
      const io = getIO();
      io.emit("tournament:squadUpdated", { tournamentId, teamId });
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({
      message: "Tournament squad set successfully",
      tournament: tournament
    });
  } catch (error) {
    console.error("Error setting tournament squad:", error);
    res.status(500).json({
      message: "Failed to set tournament squad",
      error: error.message
    });
  }
};

export const getTournamentSquad = async (req, res) => {
  try {
    const { tournamentId, teamId } = req.params;

    const tournament = await Tournament.findById(tournamentId)
      .populate("tournamentSquads.team", "name shortName logo")
      .populate("tournamentSquads.players", "name role playingRole imageUrl battingStyle bowlingStyle");

    if (!tournament) {
      return res.status(404).json({ message: "Tournament not found" });
    }

    if (teamId) {
      const squad = tournament.tournamentSquads.find(
        s => s.team?._id?.toString() === teamId || s.team?.toString() === teamId
      );
      if (!squad) {
        return res.status(404).json({ message: "Squad not found for this team" });
      }
      return res.status(200).json(squad);
    }

    res.status(200).json(tournament.tournamentSquads);
  } catch (error) {
    console.error("Error fetching tournament squad:", error);
    res.status(500).json({
      message: "Failed to fetch tournament squad",
      error: error.message
    });
  }
};

export const deleteTournamentSquad = async (req, res) => {
  try {
    const { tournamentId, teamId } = req.params;

    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ message: "Tournament not found" });
    }

    tournament.tournamentSquads = tournament.tournamentSquads.filter(
      s => s.team.toString() !== teamId
    );

    await tournament.save();

    try {
      const io = getIO();
      io.emit("tournament:squadDeleted", { tournamentId, teamId });
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({ message: "Tournament squad deleted successfully" });
  } catch (error) {
    console.error("Error deleting tournament squad:", error);
    res.status(500).json({
      message: "Failed to delete tournament squad",
      error: error.message
    });
  }
};

export const createTournamentMatch = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { team1, team2, venue, startTime, matchType, matchCategory, matchSubcategory } = req.body;

    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ message: "Tournament not found" });
    }

    if (!team1 || !team2) {
      return res.status(400).json({ message: "Both teams are required" });
    }

    const match = new Match({
      title: `${tournament.name} - Match`,
      venue: venue || tournament.venue,
      matchType: matchType || tournament.format || "T20",
      matchCategory: matchCategory || "league",
      matchSubcategory: matchSubcategory || tournament.name,
      tournament: tournamentId,
      teams: [team1, team2],
      startAt: startTime || new Date(),
      status: "upcoming"
    });

    await match.save({ validateModifiedOnly: true });
    await match.populate("teams", "name shortName logo");

    // Add match to tournament
    tournament.matches.push(match._id);
    await tournament.save();

    try {
      const io = getIO();
      io.emit("tournament:matchCreated", { tournamentId, match });
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(201).json({
      match,
      message: "Match created in tournament successfully"
    });
  } catch (error) {
    console.error("Error creating tournament match:", error);
    res.status(500).json({
      message: "Failed to create tournament match",
      error: error.message
    });
  }
};
