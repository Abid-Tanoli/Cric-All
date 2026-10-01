import Match from "../models/Match.js";
import { getIO } from "../socket/socket.js";
import { populateFullMatch } from "../utils/scoringHelpers.js";

export const endInnings = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { inningsIndex } = req.body;

    const match = await Match.findById(matchId)
      .populate("teams", "name shortName logo")
      .populate("innings.team", "name shortName");

    if (!match) {
      return res.status(404).json({ message: "Match not found" });
    }

    if (!match.innings || !match.innings[inningsIndex]) {
      return res.status(400).json({ message: "Invalid innings index" });
    }

    const currentInnings = match.innings[inningsIndex];
    currentInnings.status = "completed";

    if (match.innings[inningsIndex + 1]) {
      match.innings[inningsIndex + 1].status = "upcoming";
      match.innings[inningsIndex + 1].target = currentInnings.runs + 1;
      match.status = "innings_break";
      match.currentInnings = inningsIndex + 1;
    } else if (match.result?.resultType === "super_over") {
      const isFirstInnOfSO = inningsIndex % 2 === 0;
      const superOverNumber = Math.floor((inningsIndex - 2) / 2) + 1;

      if (isFirstInnOfSO) {
        match.status = "pending_tie_resolution";
        match.result.description = `Super Over ${superOverNumber}: First innings complete`;
      } else {
        const innSO1 = match.innings[inningsIndex - 1];
        const innSO2 = match.innings[inningsIndex];

        let currentSO = match.superOvers.find(so => so.superOverNumber === superOverNumber);

        if (innSO1.runs > innSO2.runs) {
          match.status = "completed";
          match.result.winner = innSO1.team;
          match.result.margin = `${innSO1.runs - innSO2.runs} runs`;
          match.result.description = `${innSO1.team.name} won the Super Over by ${match.result.margin}`;

          if (currentSO) {
            currentSO.result = { winner: innSO1.team, margin: match.result.margin };
          }
        } else if (innSO2.runs > innSO1.runs) {
          match.status = "completed";
          match.result.winner = innSO2.team;
          const wicketsLeft = 2 - innSO2.wickets;
          match.result.margin = `${wicketsLeft} wicket${wicketsLeft !== 1 ? 's' : ''}`;
          match.result.description = `${innSO2.team.name} won the Super Over by ${match.result.margin}`;

          if (currentSO) {
            currentSO.result = { winner: innSO2.team, margin: match.result.margin };
          }
        } else {
          match.status = "pending_tie_resolution";
          match.tieResolution = "pending";
          match.result.description = `Super Over ${superOverNumber} ended in a tie! Another Super Over required.`;
        }
      }
    } else {
      match.status = "completed";

      const inn1 = match.innings[0];
      const inn2 = match.innings[1];

      if (inn1.runs > inn2.runs) {
        const runMargin = inn1.runs - inn2.runs;
        match.result = {
          winner: inn1.team,
          margin: `${runMargin} runs`,
          description: `${inn1.team.name} won by ${runMargin} runs`,
          resultType: "normal"
        };
      } else if (inn2.runs > inn1.runs) {
        const maxWickets = match.matchType === "Super Over" ? 2 : 10;
        const wicketsLeft = Math.max(0, maxWickets - inn2.wickets);
        const wicketWord = wicketsLeft === 1 ? "wicket" : "wickets";
        const ballsLeft = (match.totalOvers * 6) - ((inn2.overs * 6) + inn2.balls);

        match.result = {
          winner: inn2.team,
          margin: `${wicketsLeft} ${wicketWord}`,
          description: `${inn2.team.name} won by ${wicketsLeft} ${wicketWord} (${ballsLeft} balls remaining)`,
          resultType: "normal"
        };
      } else {
        match.status = "pending_tie_resolution";
        match.tieResolution = "pending";
        match.result = {
          margin: "Match tied",
          description: "Match ended in a tie - Resolution pending",
          resultType: "tie"
        };
      }
    }

    await match.save({ validateModifiedOnly: true });

    await populateFullMatch(match);

    try {
      const io = getIO();

      io.to(`match-${matchId}`).emit("innings:ended", {
        matchId,
        inningsIndex,
        matchStatus: match.status,
        nextInnings: inningsIndex + 1 < match.innings.length
      });

      io.emit("match:updated", match);
      io.emit("match:updateList");
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({
      match,
      message: match.status === "completed"
        ? "Match completed successfully"
        : "Innings ended successfully"
    });
  } catch (error) {
    console.error("Error ending innings:", error);
    res.status(400).json({
      message: "Failed to end innings",
      error: error.message
    });
  }
};

export const reduceOvers = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { newTotalOvers } = req.body;

    const match = await Match.findById(matchId);
    if (!match) {
      return res.status(404).json({ message: "Match not found" });
    }

    if (newTotalOvers >= match.totalOvers) {
      return res.status(400).json({
        message: "New overs must be less than current total overs"
      });
    }

    const oldTotalOvers = match.totalOvers;
    match.totalOvers = newTotalOvers;

    if (match.currentInnings === 1 && match.innings[0] && match.innings[1]) {
      const inn1 = match.innings[0];
      const inn2 = match.innings[1];

      const newTarget = Math.floor((inn1.runs * newTotalOvers / oldTotalOvers)) + 1;
      inn2.target = newTarget;

      const totalOversFaced = inn2.overs + (inn2.balls % 6) / 6;
      const remainingOvers = newTotalOvers - totalOversFaced;
      const remainingRuns = newTarget - inn2.runs;

      inn2.requiredRunRate = remainingOvers > 0
        ? (remainingRuns / remainingOvers).toFixed(2)
        : 0;
    }

    await match.save({ validateModifiedOnly: true });
    await populateFullMatch(match);

    try {
      const io = getIO();
      io.to(`match-${matchId}`).emit("match:oversReduced", {
        matchId,
        newTotalOvers,
        newTarget: match.innings[1]?.target
      });
      io.emit("match:updated", match);
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({
      match,
      message: `Match overs reduced to ${newTotalOvers}`
    });
  } catch (error) {
    console.error("Error reducing overs:", error);
    res.status(400).json({
      message: "Failed to reduce overs",
      error: error.message
    });
  }
};

export const startNextInnings = async (req, res) => {
  try {
    const { matchId } = req.params;

    const match = await Match.findById(matchId);
    if (!match) {
      return res.status(404).json({ message: "Match not found" });
    }

    if (!["innings-break", "innings_break"].includes(match.status)) {
      return res.status(400).json({ message: "Match is not in innings break" });
    }

    const nextInnings = match.innings[match.currentInnings];
    if (nextInnings) {
      nextInnings.status = "live";
      match.status = "live";

      await match.save({ validateModifiedOnly: true });
      await populateFullMatch(match);

      try {
        const io = getIO();
        io.to(`match-${matchId}`).emit("innings:started", {
          matchId,
          inningsIndex: match.currentInnings
        });
        io.emit("match:updated", match);
      } catch (socketError) {
        console.log("Socket not available:", socketError.message);
      }

      res.status(200).json({
        match,
        message: "Next innings started successfully"
      });
    } else {
      res.status(400).json({ message: "No next innings found" });
    }
  } catch (error) {
    console.error("Error starting next innings:", error);
    res.status(400).json({
      message: "Failed to start next innings",
      error: error.message
    });
  }
};

export const resetInnings = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { inningsIndex } = req.body;

    const match = await Match.findById(matchId);
    if (!match) return res.status(404).json({ message: "Match not found" });

    const innings = match.innings[inningsIndex];
    if (!innings) return res.status(400).json({ message: "Invalid innings index" });

    innings.runs = 0;
    innings.wickets = 0;
    innings.balls = 0;
    innings.overs = 0;
    innings.extras = { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalties: 0, total: 0 };
    innings.batting = [];
    innings.bowling = [];
    innings.oversHistory = [];
    innings.fallOfWickets = [];
    innings.partnerships = [];
    innings.battingOrder = [];
    innings.runRate = 0;

    innings.onStrikeBatsman = null;
    innings.currentBatsman1 = null;
    innings.currentBatsman2 = null;
    innings.currentBowler = null;

    await match.save({ validateModifiedOnly: true });
    await populateFullMatch(match);

    try {
      const io = getIO();
      io.to(`match-${matchId}`).emit("match:reset", { matchId, inningsIndex });
      io.emit("match:updated", match);
    } catch (err) { }

    res.status(200).json({ match, message: "Innings reset successfully" });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};
