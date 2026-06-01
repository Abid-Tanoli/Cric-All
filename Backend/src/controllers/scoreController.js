import Match from "../models/Match.js";
import Player from "../models/Player.js";
import fetch from "node-fetch";
import { getIO, emitBallWithCommentary, emitBallUpdate, emitWicketAlert, emitMilestoneAlert, emitInningsComplete } from "../socket/socket.js";
import { updateTournamentPoints } from "../services/tournamentService.js";
import fieldPositionMapper from "../services/fieldPositionMapper.js";
import aiCommentary from "../services/aiCommentary.js";
import Delivery from "../models/Delivery.js";
import Partnership from "../models/Partnership.js";
import MatchAnalytics from "../models/MatchAnalytics.js";
import { computeProjectedScore, computeWinProbability, updateMatchAnalytics } from "../services/analyticsService.js";
import { getBallRunText } from "../utils/cricketHelpers.js";
import { processDeliveryWithEngine, computeShouldEndInnings } from "../services/scoring/controllerAdapter.js";

const calculateWinProbability = (match) => {
  if (!match || !match.innings || match.innings.length === 0) return { team1: 50, team2: 50 };
  if (match.status === 'completed') {
    const winnerId = match.result?.winner?.toString();
    const team1Id = match.teams[0]?._id?.toString() || match.teams[0]?.toString();
    return winnerId === team1Id ? { team1: 100, team2: 0 } : { team1: 0, team2: 100 };
  }

  const currentInnIdx = match.currentInnings;
  const innings = match.innings[currentInnIdx];

  // First Innings: Based on projected score vs average
  if (currentInnIdx === 0) {
    const crr = innings.runRate || 0;
    const projected = crr * match.totalOvers;
    // Simple heuristic: 180 is parity
    const diff = projected - 180;
    const p1 = Math.max(10, Math.min(90, 50 + (diff / 2)));
    return { team1: p1, team2: 100 - p1 };
  }

  // Second Innings: Target vs RRR/CRR
  if (currentInnIdx === 1) {
    const target = innings.target || 0;
    if (target === 0) return { team1: 50, team2: 50 };

    const runsToGet = target - innings.runs;
    const totalBalls = match.totalOvers * 6;
    const ballsRemaining = totalBalls - innings.balls;

    if (runsToGet <= 0) return { team1: 0, team2: 100 };
    if (ballsRemaining <= 0) return { team1: 100, team2: 0 };

    const rrr = (runsToGet / ballsRemaining) * 6;
    const wicketsLeft = 10 - innings.wickets;

    // Base probability on RRR vs a "standard" difficult RRR of 10
    let p2 = 50 + (6 - rrr) * 5 + (wicketsLeft - 5) * 5;
    p2 = Math.max(5, Math.min(95, p2));

    return { team1: 100 - p2, team2: p2 };
  }

  return { team1: 50, team2: 50 };
};

const populateFullMatch = async (match) => {
  await match.populate([
    {
      path: "teams",
      select: "name shortName logo players",
      populate: { path: "players", select: "name playingRole role bowlingStyle" }
    },
    { path: "innings.team", select: "name shortName" },
    { path: "innings.batting.player", select: "name role playingRole bowlingStyle" },
    { path: "innings.bowling.player", select: "name role playingRole bowlingStyle" },
    { path: "innings.currentBatsman1", select: "name role playingRole bowlingStyle" },
    { path: "innings.currentBatsman2", select: "name role playingRole bowlingStyle" },
    { path: "innings.onStrikeBatsman", select: "name role playingRole bowlingStyle" },
    { path: "innings.currentBowler", select: "name role playingRole bowlingStyle" },
    { path: "innings.oversHistory.balls.batsmanOnStrike", select: "name" },
    { path: "innings.oversHistory.balls.batsmanNonStrike", select: "name" },
    { path: "innings.oversHistory.balls.bowler", select: "name" },
    { path: "innings.oversHistory.bowler", select: "name" },
    { path: "playingXI.players", select: "name role playingRole bowlingStyle" },
    { path: "playingXI.team", select: "name shortName logo" },
    { path: "squad15.players", select: "name role playingRole bowlingStyle" },
    { path: "result.winner", select: "name shortName logo" },
    { path: "tossWinner", select: "name shortName" }
  ]);

  // Post-population fix for missing names in older balls
  match.innings.forEach(inn => {
    inn.oversHistory.forEach(over => {
      over.balls.forEach(ball => {
        if (!ball.batsmanName && ball.batsmanOnStrike) {
          ball.batsmanName = ball.batsmanOnStrike.name || "Batsman";
        }
        if (!ball.bowlerName && ball.bowler) {
          ball.bowlerName = ball.bowler.name || "Bowler";
        }
        ball.runs = Number(ball.runs || 0);
        if (!ball.runText) {
          ball.runText = getBallRunText(ball);
        }
      });
    });
  });

  return match;
};

export const updateScore = async (req, res) => {
  try {
    const { matchId } = req.params;
    let {
      inningsIndex,
      runs = 0,
      isWide = false,
      isNoBall = false,
      isBye = false,
      isLegBye = false,
      isWicket = false,
      wicketType = "",
      dismissedPlayerId = null,
      fielderId = null,
      batsmanOnStrikeId,
      batsmanNonStrikeId,
      bowlerId,
      commentaryText = "",
      customCommentary = false,
      // Shot placement data for wagon wheel
      shotPlacement = null,
      fieldingZone = "",
      shotType = "",
      pitchZone = "",
      ballMovement = "none",
      ballOutcome = "played",
      pitchLine = "",
      pitchLength = "",
      pitchShotType = "",
      pitchX = null,
      pitchY = null,
      nextBatsmanId = null
    } = req.body;

    const match = await Match.findById(matchId)
      .populate("teams", "name shortName logo")
      .populate("innings.team", "name shortName")
      .populate("innings.currentBatsman1", "name")
      .populate("innings.currentBatsman2", "name")
      .populate("innings.currentBowler", "name")
      .populate("innings.batting.player", "name")
      .populate("innings.bowling.player", "name");

    if (!match) {
      return res.status(404).json({ message: "Match not found" });
    }

    if (!match.innings || !match.innings[inningsIndex]) {
      return res.status(400).json({ message: "Invalid innings index" });
    }

    const innings = match.innings[inningsIndex];

    // Use ScoringEngine via adapter for all scoring computation
    let engineResult;
    try {
      engineResult = processDeliveryWithEngine(match, {
        inningsIndex: inningsIndex ?? match.currentInnings ?? 0,
        runs,
        isWide,
        isNoBall,
        isBye,
        isLegBye,
        isWicket,
        wicketType,
        dismissedPlayerId,
        fielderId,
        batsmanOnStrikeId,
        batsmanNonStrikeId,
        bowlerId,
        commentaryText,
        customCommentary,
        shotPlacement,
        fieldingZone,
        shotType,
        pitchZone,
        ballMovement,
        ballOutcome,
        pitchLine,
        pitchLength,
        pitchShotType,
        pitchX,
        pitchY,
        nextBatsmanId,
      });
    } catch (engineErr) {
      if (engineErr.code === 'SAME_BOWLER_CONSECUTIVE') {
        return res.status(400).json({ message: engineErr.message });
      }
      throw engineErr;
    }

    const {
      ball,
      overComplete: isOverComplete,
      currentOver,
      currentOverNumber,
      ballNumberInOver,
      batsmanRuns,
      extraRuns,
      isWicket: engineWicket,
      wicketType: engineWicketType,
      battingStats: batsmanOnStrikeStats,
    } = engineResult;
    // Reassign to the outer let-declared isWicket so downstream code sees engine's decision
    isWicket = engineWicket;

    // Get player names for commentary
    const batsmanOnStrike = await Player.findById(batsmanOnStrikeId);
    const bowlerPlayer = await Player.findById(bowlerId);

    // Compute bowlerStats and batsmanNonStrikeStats for downstream use
    const bowlerStats = innings.bowling.find(
      b => String(b.player?._id || b.player) === String(bowlerId)
    ) || { overs: 0, balls: 0, maidens: 0, runs: 0, wickets: 0, wides: 0, noBalls: 0, economy: 0, dotBalls: 0, foursScored: 0, sixesScored: 0 };
    const batsmanNonStrikeStats = innings.batting.find(
      b => String(b.player?._id || b.player) === String(batsmanNonStrikeId)
    );

    // Ensure powerplayStatus exists for socket events
    if (!innings.powerplayStatus) {
      innings.powerplayStatus = { isActive: false, isCompleted: true, currentOver: 0 };
    }

    // Track shot data for wagon wheel (not handled by engine)
    if (batsmanOnStrikeStats && !isWide && batsmanOnStrikeStats.shots) {
      batsmanOnStrikeStats.shots.push({
        runs: batsmanRuns,
        angle: shotPlacement?.angle || 0,
        distance: shotPlacement?.distance || 50,
        position: shotPlacement?.position || fieldingZone || "",
        over: currentOverNumber,
        ball: ballNumberInOver,
        bowler: bowlerId
      });
    }

    // Milestone detection (50, 100)
    if (batsmanOnStrikeStats && !isWide) {
      const prevRuns = batsmanOnStrikeStats.runs - batsmanRuns;
      if (prevRuns < 50 && batsmanOnStrikeStats.runs >= 50) {
        if (!match.highlights) match.highlights = [];
        match.highlights.push({
          type: "Milestone",
          description: `${batsmanOnStrike?.name} reached 50!`,
          over: currentOverNumber + (ballNumberInOver / 10),
          timestamp: new Date()
        });
      } else if (prevRuns < 100 && batsmanOnStrikeStats.runs >= 100) {
        if (!match.highlights) match.highlights = [];
        match.highlights.push({
          type: "Milestone",
          description: `${batsmanOnStrike?.name} reached 100!`,
          over: currentOverNumber + (ballNumberInOver / 10),
          timestamp: new Date()
        });
      }
    }

    // Generate AI commentary
    let commentary = commentaryText || ball.commentary || '';
    let aiGeneratedCommentary = null;
    let vividCommentary = ball.vividCommentary || null;

    if (!customCommentary || !commentary) {
      const zone = (fieldingZone || (shotPlacement && shotPlacement.position))
        ? fieldPositionMapper.getZoneFromCoordinates(shotPlacement?.x || 50, shotPlacement?.y || 50)
        : { name: "an open area" };

      const distanceCategory = zone.distance ? fieldPositionMapper.getDistanceCategory(zone.distance) : "";

      try {
        aiGeneratedCommentary = await aiCommentary.generateBallCommentary({
          runs: batsmanRuns,
          isWide,
          isNoBall,
          isBye,
          isLegBye,
          isWicket: engineWicket,
          wicketType: engineWicketType,
          batsmanName: batsmanOnStrike?.name || "Batsman",
          bowlerName: bowlerPlayer?.name || "Bowler",
          zone: zone.name || "",
          fieldingZone: fieldingZone || zone.name || "",
          direction: shotPlacement?.position || fieldingZone || "",
          shotName: shotType || "",
          pitchZone,
          ballMovement,
          ballOutcome,
          pitchLine,
          pitchLength,
          pitchShotType,
          side: shotPlacement?.side || "",
          nearestPosition: shotPlacement?.nearestPosition || "",
          distanceCategory,
          overNumber: currentOverNumber,
          ballNumber: ballNumberInOver,
          currentScore: innings.runs || 0,
          currentWickets: innings.wickets || 0,
          matchContext: {
            totalOvers: match.totalOvers,
            target: innings.target,
            requiredRunRate: innings.requiredRunRate
          }
        });

        if (aiGeneratedCommentary && aiGeneratedCommentary.short) {
          commentary = aiGeneratedCommentary.short;
          vividCommentary = aiGeneratedCommentary.vivid;
        }
      } catch (aiErr) {
        console.error("AI Commentary Error:", aiErr);
      }

      if (!commentary) {
        commentary = generateDetailedCommentary({
          runs: batsmanRuns,
          isWide,
          isNoBall,
          isBye,
          isLegBye,
          isWicket: engineWicket,
          wicketType: engineWicketType,
          batsmanName: batsmanOnStrike?.name || "Batsman",
          bowlerName: bowlerPlayer?.name || "Bowler",
          currentScore: innings.runs || 0,
          currentWickets: innings.wickets || 0,
          overNumber: currentOverNumber,
          ballNumber: ballNumberInOver,
          extraRuns: runs
        });
        vividCommentary = `The delivery was bowled and played toward the ${shotPlacement?.position || fieldingZone || "fielding area"}. ${batsmanOnStrike?.name || "The batsman"} managed to pick up ${runs} run${runs !== 1 ? "s" : ""}.`;
      }
    }

    // Set commentary on the ball record
    ball.commentary = commentary;
    ball.vividCommentary = vividCommentary;
    ball.batsmanName = batsmanOnStrike?.name || "Batsman";
    ball.bowlerName = bowlerPlayer?.name || "Bowler";

    // Set current bowler on innings
    innings.currentBowler = bowlerId;

    // Strike rotation for next ball (engine handles odd-runs swap in ball record)
    const dismissedId = ball.dismissedPlayer || (isWicket ? batsmanOnStrikeId : null);
    if (isWicket && dismissedId) {
      const strikerOut = String(dismissedId) === String(batsmanOnStrikeId);
      if (isOverComplete) {
        innings.onStrikeBatsman = batsmanNonStrikeId;
        innings.currentBatsman1 = strikerOut ? (nextBatsmanId || null) : batsmanOnStrikeId;
        innings.currentBatsman2 = strikerOut ? batsmanNonStrikeId : (nextBatsmanId || null);
      } else {
        innings.onStrikeBatsman = strikerOut ? (nextBatsmanId || null) : batsmanOnStrikeId;
        innings.currentBatsman1 = innings.onStrikeBatsman;
        innings.currentBatsman2 = strikerOut ? batsmanNonStrikeId : (nextBatsmanId || null);
      }
    } else {
      const nextStriker = ball.batsmanOnStrike;
      const nextNonStriker = ball.batsmanNonStrike;
      innings.onStrikeBatsman = isOverComplete ? nextNonStriker : nextStriker;
      innings.currentBatsman1 = innings.onStrikeBatsman;
      innings.currentBatsman2 = isOverComplete ? nextStriker : nextNonStriker;
    }

    if (isOverComplete && currentOver) {
      currentOver.summary = generateOverSummary(currentOver);
    }

    const shouldEndInnings = computeShouldEndInnings(innings, match, inningsIndex ?? match.currentInnings ?? 0);

    // Update Win Probability History
    const winProb = calculateWinProbability(match);
    match.winProbabilityHistory.push({
      ball: innings.balls,
      over: currentOverNumber,
      team1: winProb.team1,
      team2: winProb.team2,
      timestamp: new Date()
    });

    match.markModified('innings');
    match.markModified('winProbabilityHistory');
    await match.save({ validateModifiedOnly: true });

    await populateFullMatch(match);

    try {
      const io = getIO();

      // Emit ball update with AI commentary
      io.to(`match-${matchId}`).emit("match:ballUpdate", {
        matchId,
        inningsIndex,
        ball,
        currentOver: currentOver.overNumber,
        ballNumber: ballNumberInOver,
        isOverComplete,
        aiGenerated: !!aiGeneratedCommentary
      });

      // Emit enhanced ball with full commentary
      if (aiGeneratedCommentary) {
        emitBallWithCommentary(matchId, {
          matchId,
          inningsIndex,
          ball,
          commentary: aiGeneratedCommentary,
          fieldingZone,
          shotPlacement,
          currentOver: currentOver.overNumber,
          ballNumber: ballNumberInOver,
          isOverComplete
        });
      }

      io.to(`match-${matchId}`).emit("match:scoreUpdate", {
        matchId,
        runs: innings.runs,
        wickets: innings.wickets,
        overs: innings.overs,
        balls: innings.balls,
        runRate: innings.runRate,
        requiredRunRate: innings.requiredRunRate,
        powerplayStatus: innings.powerplayStatus,
        powerplayConfig: match.powerplayConfig
      });

      if (isOverComplete) {
        // Generate AI over summary
        const overExtras = currentOver.balls.filter(b => b.isWide || b.isNoBall).length;
        const overSummary = await aiCommentary.generateOverSummary({
          overNumber: currentOverNumber,
          bowlerName: bowlerPlayer?.name || "Bowler",
          bowlingStyle: bowlerPlayer?.bowlingStyle || "",
          oversFigures: `${bowlerStats.overs}-${bowlerStats.maidens}-${bowlerStats.runs}-${bowlerStats.wickets}`,
          runsThisOver: currentOver.runsScored,
          wicketsThisOver: currentOver.wickets,
          extrasThisOver: overExtras > 0 ? `${overExtras} extra(s)` : "",
          ballsSummary: currentOver.balls,
          score: innings.runs,
          wickets: innings.wickets,
          totalOvers: match.totalOvers,
          target: innings.target,
          remainingRuns: innings.target ? innings.target - innings.runs : null,
          remainingBalls: innings.target ? ((match.totalOvers - innings.overs - (innings.balls % 6) / 6) * 6 | 0) : null,
          rrr: innings.requiredRunRate,
          crr: innings.runRate,
          batter1: batsmanOnStrikeStats || {},
          batter2: batsmanNonStrikeStats || {}
        });

        currentOver.summary = overSummary;
        // Save again if you want it persisted directly now
        Match.findByIdAndUpdate(matchId, { $set: { [`innings.${inningsIndex}.oversHistory.${innings.oversHistory.length - 1}.summary`]: overSummary } })
          .exec()
          .catch(err => console.error("Error updating over summary:", err));

        io.to(`match-${matchId}`).emit("match:overComplete", {
          matchId,
          inningsIndex,
          over: currentOver,
          summary: overSummary
        });
      }

      io.emit("match:updated", match);
      io.emit("match:updateList");

      if (shouldEndInnings) {
        io.to(`match-${matchId}`).emit("match:inningsEnd", {
          matchId,
          inningsIndex,
          suggestion: "End innings?"
        });
      }
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    if (shouldEndInnings && match.tournament) {
      updateTournamentPoints(match.tournament);
    }

    // Create Delivery record for wagon wheel
    try {
      const delivery = new Delivery({
        matchId: match._id,
        inning: inningsIndex + 1,
        overNumber: currentOverNumber,
        ballNumber: ballNumberInOver,
        rawBall: innings.balls + 1,
        batsmanId: batsmanOnStrikeId,
        bowlerId: bowlerId,
        nonStrikerId: batsmanNonStrikeId,
        runsOffBat: batsmanRuns,
        extras: extraRuns,
        extraType: isWide ? 'wide' : isNoBall ? 'no_ball' : isBye ? 'bye' : isLegBye ? 'leg_bye' : null,
        isWicket: isWicket,
        wicketType: wicketType || null,
        fielderId: fielderId,
        shotType: shotType || null,
        shotDirection: shotPlacement?.angle || 0,
        shotDistance: shotPlacement?.distance > 80 ? 'boundary' : shotPlacement?.distance > 50 ? 'outfield' : 'infield',
        isFour: batsmanRuns === 4 && !isWide && !isNoBall,
        isSix: batsmanRuns === 6 && !isWide && !isNoBall,
        commentary: ball?.commentary || "",
        drsInvolved: false
      });
      await delivery.save();
    } catch (e) { console.log("Delivery save error:", e.message); }

    // Update/manage partnerships
    try {
      const activePartnership = await Partnership.findOne({ matchId: match._id, inning: inningsIndex + 1, isActive: true });
      if (isWicket) {
        if (activePartnership) {
          activePartnership.isActive = false;
          activePartnership.endScore = innings.runs;
          await activePartnership.save();
        }
      } else {
        if (!activePartnership) {
          const newPartnership = new Partnership({
            matchId: match._id,
            inning: inningsIndex + 1,
            wicketNumber: innings.wickets + 1,
            batsman1Id: batsmanOnStrikeId,
            batsman2Id: batsmanNonStrikeId,
            runs: 0,
            balls: 0,
            startScore: innings.runs - batsmanRuns - extraRuns
          });
          await newPartnership.save();
        } else {
          activePartnership.runs += batsmanRuns + extraRuns;
          if (!isWide) activePartnership.balls += 1;
          if (batsmanRuns === 4) activePartnership.fours += 1;
          if (batsmanRuns === 6) activePartnership.sixes += 1;
          await activePartnership.save();
        }
      }
    } catch (e) { console.log("Partnership update error:", e.message); }

    // Update analytics
    try {
      await updateMatchAnalytics(match, inningsIndex, { isFour: batsmanRuns === 4 && !isWide && !isNoBall, isSix: batsmanRuns === 6 && !isWide && !isNoBall });
    } catch (e) { console.log("Analytics update error:", e.message); }

    // Broadcast BALL_UPDATE via WebSocket
    try {
      const io = getIO();
      const analytics = await MatchAnalytics.findOne({ matchId: match._id });
      
      const partnerships = await Partnership.find({ matchId: match._id, inning: inningsIndex + 1 });
      const activePartnership = partnerships.find(p => p.isActive);
      
      io.to(`match-${matchId}`).emit("BALL_UPDATE", {
        delivery: ball,
        match: await populateFullMatch(match),
        scorecard: { team1: match.innings[0], team2: match.innings[1] },
        currentBatsmen: { striker: batsmanOnStrikeStats, nonStriker: innings.batting.find(b => String(b.player?._id || b.player) === String(batsmanNonStrikeId)) },
        currentBowler: innings.bowling.find(b => String(b.player?._id || b.player) === String(bowlerId)),
        partnerships,
        activePartnership,
        analytics,
        last5Overs: innings.oversHistory.slice(-5).map(o => o.runsScored),
        requiredRate: innings.requiredRunRate,
        matchStatus: match.status
      });

      // Emit Wicket Alert
      if (isWicket) {
        io.to(`match-${matchId}`).emit("WICKET_ALERT", {
          batsman: batsmanOnStrike?.name,
          wicketType,
          score: `${innings.runs}/${innings.wickets}`
        });
      }

      // Emit Milestone Alert
      if (batsmanOnStrikeStats) {
        if (batsmanOnStrikeStats.runs >= 50 && (batsmanOnStrikeStats.runs - batsmanRuns) < 50) {
          io.to(`match-${matchId}`).emit("MILESTONE_ALERT", { type: '50', player: batsmanOnStrike?.name, runs: batsmanOnStrikeStats.runs });
        }
        if (batsmanOnStrikeStats.runs >= 100 && (batsmanOnStrikeStats.runs - batsmanRuns) < 100) {
          io.to(`match-${matchId}`).emit("MILESTONE_ALERT", { type: '100', player: batsmanOnStrike?.name, runs: batsmanOnStrikeStats.runs });
        }
      }
    } catch (e) { console.log("WebSocket broadcast error:", e.message); }

    res.status(200).json({
      match,
      innings: match.innings[inningsIndex],
      currentOver,
      ball,
      isOverComplete,
      shouldEndInnings,
      message: "Score updated successfully"
    });
  } catch (error) {
    console.error("Error updating score:", error);
    res.status(400).json({
      message: "Failed to update score",
      error: error.message
    });
  }
};


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
      match.status = "innings-break";
      match.currentInnings = inningsIndex + 1;
    } else if (match.result.resultType === "super_over") {
      // Handle Super Over phased endings
      const isFirstInnOfSO = inningsIndex % 2 === 0;
      const superOverNumber = Math.floor((inningsIndex - 2) / 2) + 1;

      if (isFirstInnOfSO) {
        // First innings of Super Over ended
        match.status = "pending_tie_resolution";
        match.result.description = `Super Over ${superOverNumber}: First innings complete`;
      } else {
        // Second innings of Super Over ended
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
          // Tied again!
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
        const wicketsLeft = 10 - inn2.wickets;
        const ballsLeft = (match.totalOvers * 6) - ((inn2.overs * 6) + inn2.balls);

        match.result = {
          winner: inn2.team,
          margin: `${wicketsLeft} wickets`,
          description: `${inn2.team.name} won by ${wicketsLeft} wickets (${ballsLeft} balls remaining)`,
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

    // If we are in the 2nd innings, we need to recalculate the target
    // Using a simplified DRS-like logic: Target = (Team1Runs * NewTotalOvers / OldTotalOvers) + 1
    if (match.currentInnings === 1 && match.innings[0] && match.innings[1]) {
      const inn1 = match.innings[0];
      const inn2 = match.innings[1];

      // Simplified DLS formula
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

    if (match.status !== "innings-break") {
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

function generateDetailedCommentary({
  runs,
  isWide,
  isNoBall,
  isBye,
  isLegBye,
  isWicket,
  wicketType,
  batsmanName,
  bowlerName,
  currentScore,
  currentWickets,
  overNumber,
  ballNumber,
  extraRuns = 0
}) {
  if (isWicket) {
    const wicketCommentaries = {
      "bowled": [
        `BOWLED! What a delivery from ${bowlerName}! The stumps are shattered! ${batsmanName} departs.`,
        `OUT! Timber! ${bowlerName} gets through the defense of ${batsmanName}. The off stump goes cartwheeling.`,
        `BOWLED! Cleaned him up! ${batsmanName} has no answer to that one from ${bowlerName}.`
      ],
      "caught": [
        `OUT! Caught! ${batsmanName} holes out. Great catch! ${bowlerName} gets the breakthrough.`,
        `CAUGHT! In the air... and taken! ${batsmanName} can't believe it. ${bowlerName} strikes!`,
        `OUT! Wonderful catch! ${batsmanName} goes for the big shot but finds the fielder. ${bowlerName} is delighted.`
      ],
      "lbw": [
        `OUT! LBW! The finger goes up! ${batsmanName} has to go. ${bowlerName} gets the wicket.`,
        `PLUMB! That looked out and the umpire agrees. ${batsmanName} is gone lbw to ${bowlerName}.`,
        `OUT! Dead in front! ${batsmanName} caught plumb in front. ${bowlerName} celebrates.`
      ],
      "run out": [
        `RUN OUT! Direct hit! ${batsmanName} is well short of the crease! What a throw!`,
        `OUT! Run out! Terrible mix-up and ${batsmanName} has to walk back.`,
        `RUN OUT! Lightning quick throw and ${batsmanName} is gone! Brilliant fielding!`
      ],
      "stumped": [
        `STUMPED! Quick as a flash! ${batsmanName} is out of his crease and the keeper whips off the bails!`,
        `OUT! Stumped! Beaten by the turn and the keeper does the rest. ${batsmanName} departs.`,
        `STUMPED! Superb glovework! ${batsmanName} is caught short. ${bowlerName} gets his man.`
      ]
    };

    const comments = wicketCommentaries[wicketType] || [
      `OUT! ${batsmanName} has to go! ${bowlerName} strikes!`
    ];
    return comments[Math.floor(Math.random() * comments.length)];
  }

  if (isWide) {
    const wideComments = [
      `Wide! ${bowlerName} strays down the leg side.`,
      `WIDE! That's way outside the tramline.`,
      `Wide ball! ${bowlerName} loses his line.`
    ];
    let comment = wideComments[Math.floor(Math.random() * wideComments.length)];
    if (runs > 0) {
      comment += ` They run ${runs} additional ${runs === 1 ? 'run' : 'runs'}${runs === 4 ? ' - it goes to the boundary!' : '.'}`;
    }
    return comment;
  }

  if (isNoBall) {
    const noballs = [
      `No ball! ${bowlerName} oversteps. Free hit coming up!`,
      `NO BALL! That's a big overstep from ${bowlerName}.`,
      `No ball! ${bowlerName} will have to bowl that again.`
    ];
    let comment = noballs[Math.floor(Math.random() * noballs.length)];
    if (extraRuns > 0) {
      const runComments = {
        1: "They take a single.",
        2: "They scamper back for two.",
        3: "Excellent running, they get three!",
        4: "FOUR! He's punished that no ball to the fence!",
        6: "SIX! MASSIVE! Smashed it out of the park on a no ball!"
      };
      comment += ` ${runComments[extraRuns] || `${extraRuns} runs taken.`}`;
    } else {
      comment += " Just the one run from the extra.";
    }
    return comment;
  }

  if (isBye) {
    return `${runs} ${runs === 1 ? 'bye' : 'byes'}! The keeper couldn't collect. ${bowlerName} won't be happy.`;
  }

  if (isLegBye) {
    return `${runs} leg ${runs === 1 ? 'bye' : 'byes'}! Off the pads and away.`;
  }

  const runCommentaries = {
    0: [
      `Dot ball. Solid defense from ${batsmanName}.`,
      `No run. Good bowling from ${bowlerName}, ${batsmanName} respects it.`,
      `DOT! ${bowlerName} beats ${batsmanName} outside off. Good ball.`,
      `Defended solidly by ${batsmanName}. No run.`
    ],
    1: [
      `Single taken. ${batsmanName} rotates the strike nicely.`,
      `One run. Good running between the wickets.`,
      `They take a quick single. Alert running from ${batsmanName}.`,
      `Pushed into the gap for a single.`
    ],
    2: [
      `Two runs! Good running between the wickets from ${batsmanName}.`,
      `They scamper back for the second. Excellent running.`,
      `TWO! ${batsmanName} places it well and comes back for two.`,
      `A couple of runs. Well run.`
    ],
    3: [
      `THREE RUNS! Excellent running from the batsmen!`,
      `They run three! ${batsmanName} pushes for the third and makes it.`,
      `Three runs! Superb fitness on display.`
    ],
    4: [
      `FOUR! Beautiful shot from ${batsmanName}! That raced away to the boundary!`,
      `BOUNDARY! ${batsmanName} finds the gap perfectly! Four runs!`,
      `FOUR! What a stroke! ${batsmanName} is in fine form!`,
      `FOUR! Cracking shot from ${batsmanName}! ${bowlerName} under pressure now.`,
      `BOUNDARY! ${batsmanName} leans into it and sends it racing past the fielder!`
    ],
    6: [
      `SIX! MASSIVE! ${batsmanName} launches it into the stands! What a shot!`,
      `MAXIMUM! ${batsmanName} goes big and clears the boundary with ease!`,
      `SIX! That's huge! ${batsmanName} is taking on ${bowlerName} here!`,
      `BANG! SIX! ${batsmanName} smashes it out of the park!`,
      `SIX! Clean strike from ${batsmanName}! That went a long way!`
    ]
  };

  const comments = runCommentaries[runs] || [`${runs} runs scored.`];

  const getRunLabel = () => {
    if (isWicket) return "out!";
    if (isWide) return "wide";
    if (isNoBall) return "no ball";
    if (runs === 0) return "no run";
    if (runs === 1) return "1 run";
    if (runs === 4) return "4 runs (FOUR)";
    if (runs === 6) return "6 runs (SIX)";
    return `${runs} runs`;
  };

  const summary = `${bowlerName} to ${batsmanName}, ${getRunLabel()}`;
  return summary;
}

function generateOverSummary(over) {
  const runs = over.runsScored;
  const wickets = over.wickets;

  let summary = `${runs} ${runs === 1 ? 'run' : 'runs'}`;

  if (wickets > 0) {
    summary += `, ${wickets} ${wickets === 1 ? 'wicket' : 'wickets'}`;
  }

  if (over.maidenOver) {
    summary = `Maiden over!`;
  }

  const ballsStr = over.balls.map(b => {
    if (b.isWicket) return 'W';
    if (b.isWide) return 'Wd';
    if (b.isNoBall) return 'Nb';
    return b.runs.toString();
  }).join(' ');

  return `${summary} (${ballsStr})`;
}

export const resolveTie = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { resolution } = req.body; // "declared_tie" or "super_over"

    const match = await Match.findById(matchId);
    if (!match) return res.status(404).json({ message: "Match not found" });

    if (match.status !== "pending_tie_resolution") {
      return res.status(400).json({ message: "Match is not pending tie resolution" });
    }

    if (resolution === "declared_tie") {
      match.status = "completed";
      match.tieResolution = "declared_tie";
      match.result.description = "Match ended in a tie";
      await match.save({ validateModifiedOnly: true });
      await populateFullMatch(match);
    } else if (resolution === "super_over") {
      match.tieResolution = "super_over";
      // We don't change match status yet, it stays pending until players are selected or startSuperOver is called
      await match.save({ validateModifiedOnly: true });
      await populateFullMatch(match);
    } else {
      return res.status(400).json({ message: "Invalid resolution type" });
    }

    try {
      const io = getIO();
      io.to(`match-${matchId}`).emit("match:tieResolved", { matchId, resolution });
      io.emit("match:updated", match);
    } catch (err) { }

    res.status(200).json({ match, message: `Tie resolved as ${resolution}` });
  } catch (error) {
    res.status(400).json({ message: "Failed to resolve tie", error: error.message });
  }
};

export const startSuperOverInnings = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { batsmenIds, bowlerId } = req.body;

    const match = await Match.findById(matchId);
    if (!match) return res.status(404).json({ message: "Match not found" });

    if (match.status !== "pending_tie_resolution" || match.tieResolution !== "super_over") {
      return res.status(400).json({ message: "Match is not ready for Super Over selection" });
    }

    // Determine which SO number and innings this is
    const totalInnings = match.innings.length;
    const isFirstInnOfSO = totalInnings % 2 === 0;
    const superOverNumber = Math.floor((totalInnings - 2) / 2) + 1;

    // The team that batted second in the main match bats FIRST in every super over
    const team1Id = match.innings[0].team;
    const team2Id = match.innings[1].team;

    let battingTeamId, bowlingTeamId;
    if (isFirstInnOfSO) {
      battingTeamId = team2Id; // Team that batted second in main match
      bowlingTeamId = team1Id;
    } else {
      battingTeamId = team1Id; // Team that batted first in main match
      bowlingTeamId = team2Id;
    }

    // Check bowler restriction for repeat Super Overs
    if (superOverNumber > 1 && isFirstInnOfSO) {
      const prevSO = match.superOvers.find(so => so.superOverNumber === superOverNumber - 1);
      if (prevSO) {
        const prevBowler = prevSO.bowlers.find(b => b.team.toString() === bowlingTeamId.toString());
        if (prevBowler && prevBowler.bowler.toString() === bowlerId.toString()) {
          return res.status(400).json({ message: "This bowler cannot bowl consecutive Super Overs" });
        }
      }
    }
    // If it's the second innings of the current SO, we also need to check the bowler for the bowling team
    if (!isFirstInnOfSO) {
       const prevSO = match.superOvers.find(so => so.superOverNumber === superOverNumber - 1);
       if (prevSO) {
         const prevBowler = prevSO.bowlers.find(b => b.team.toString() === bowlingTeamId.toString());
         if (prevBowler && prevBowler.bowler.toString() === bowlerId.toString()) {
           return res.status(400).json({ message: "This bowler cannot bowl consecutive Super Overs" });
         }
       }
    }

    // Initialize the new SO innings
    const newInnings = {
      team: battingTeamId,
      battingOrder: batsmenIds,
      status: "live",
      runs: 0,
      wickets: 0,
      overs: 0,
      balls: 0,
      currentBatsman1: batsmenIds[0],
      currentBatsman2: batsmenIds[1],
      onStrikeBatsman: batsmenIds[0],
      currentBowler: bowlerId,
      extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalties: 0, total: 0 },
      batting: batsmenIds.map(id => ({ player: id, runs: 0, balls: 0, fours: 0, sixes: 0, strikeRate: 0, isOut: false })),
      bowling: [{ player: bowlerId, overs: 0, balls: 0, maidens: 0, runs: 0, wickets: 0, wides: 0, noBalls: 0, economy: 0 }]
    };

    match.innings.push(newInnings);
    match.status = "live";
    match.currentInnings = match.innings.length - 1;
    match.totalOvers = 1;
    match.result.resultType = "super_over";

    // Track super over data
    let currentSO = match.superOvers.find(so => so.superOverNumber === superOverNumber);
    if (!currentSO) {
      currentSO = {
        superOverNumber,
        battingFirst: team2Id,
        battingSecond: team1Id,
        innings: [],
        bowlers: [],
        batsmen: []
      };
      match.superOvers.push(currentSO);
      currentSO = match.superOvers[match.superOvers.length - 1];
    }

    currentSO.bowlers.push({ team: bowlingTeamId, bowler: bowlerId });
    currentSO.batsmen.push({ team: battingTeamId, players: batsmenIds });

    if (isFirstInnOfSO) {
      match.result.description = `Super Over ${superOverNumber}: 1st Innings in progress`;
    } else {
      match.result.description = `Super Over ${superOverNumber}: 2nd Innings in progress`;
      // Set target for 2nd SO innings (the innings immediately before this one)
      match.innings[match.currentInnings].target = match.innings[match.currentInnings - 1].runs + 1;
    }

    await match.save({ validateModifiedOnly: true });
    await populateFullMatch(match);

    try {
      const io = getIO();
      io.to(`match-${matchId}`).emit("match:superOverStarted", { matchId, inningsIndex: match.currentInnings, superOverNumber });
      io.emit("match:updated", match);
    } catch (err) { }

    res.status(200).json({ match, message: `Super Over ${superOverNumber} Innings ${isFirstInnOfSO ? 1 : 2} started` });
  } catch (error) {
    console.error("Error starting Super Over innings:", error);
    res.status(400).json({ message: "Failed to start Super Over innings", error: error.message });
  }
};

export const editCommentary = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { inningsIndex, overNumber, ballNumber, newCommentary } = req.body;

    if (!matchId || inningsIndex === undefined || overNumber === undefined || ballNumber === undefined) {
      return res.status(400).json({ message: "Missing required parameters" });
    }

    const match = await Match.findById(matchId);
    if (!match) {
      return res.status(404).json({ message: "Match not found" });
    }

    const innings = match.innings[inningsIndex];
    if (!innings || !innings.oversHistory) {
      return res.status(400).json({ message: "Invalid innings index" });
    }

    const over = innings.oversHistory.find(o => o.overNumber === overNumber);
    if (!over || !over.balls) {
      return res.status(400).json({ message: "Over not found" });
    }

    const ball = over.balls.find(b => b.ballNumber === ballNumber);
    if (!ball) {
      return res.status(400).json({ message: "Ball not found" });
    }

    ball.commentary = newCommentary;
    await match.save({ validateModifiedOnly: true });
    await populateFullMatch(match);

    try {
      const io = getIO();
      io.to(`match-${matchId}`).emit("match:commentaryUpdated", {
        matchId,
        inningsIndex,
        overNumber,
        ballNumber,
        newCommentary
      });
      io.emit("match:updated", match);
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({
      match,
      message: "Commentary updated successfully"
    });
  } catch (error) {
    console.error("Error editing commentary:", error);
    res.status(400).json({
      message: "Failed to edit commentary",
      error: error.message
    });
  }
};

// Handle admin field click and generate AI commentary
export const handleFieldClick = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { x, y, runs, isWicket, wicketType, overNumber, ballNumber } = req.body;

    const match = await Match.findById(matchId)
      .populate("teams", "name shortName logo")
      .populate("innings.team", "name shortName")
      .populate("innings.currentBatsman1", "name")
      .populate("innings.currentBatsman2", "name")
      .populate("innings.currentBowler", "name");

    if (!match) {
      return res.status(404).json({ message: "Match not found" });
    }

    const innings = match.innings[match.currentInnings];
    if (!innings) {
      return res.status(400).json({ message: "No active innings" });
    }

    // Get field zone from coordinates
    const zone = fieldPositionMapper.getZoneFromCoordinates(x, y);
    const distanceCategory = fieldPositionMapper.getDistanceCategory(zone.distance);

    // Get player names
    const bowlerName = innings.currentBowler?.name || "Bowler";
    const batsmanName = innings.onStrikeBatsman?.name ||
      innings.currentBatsman1?.name ||
      "Batsman";

    // Generate AI commentary
    const commentary = await aiCommentary.generateBallCommentary({
      runs: runs || 0,
      isWide: false,
      isNoBall: false,
      isBye: false,
      isLegBye: false,
      isWicket: isWicket || false,
      wicketType: wicketType || "",
      batsmanName,
      bowlerName,
      zone: zone.name,
      distanceCategory,
      overNumber: overNumber || Math.floor(innings.balls / 6) + 1,
      ballNumber: ballNumber || (innings.balls % 6) + 1,
      currentScore: innings.runs,
      currentWickets: innings.wickets,
      matchContext: {
        totalOvers: match.totalOvers,
        target: innings.target,
        requiredRunRate: innings.requiredRunRate
      }
    });

    // Emit field click event with generated commentary
    const io = getIO();

    emitFieldClick(matchId, {
      matchId,
      x,
      y,
      zone: zone.name,
      angle: zone.angle,
      distance: zone.distance,
      distanceCategory,
      runs,
      isWicket,
      wicketType,
      commentary,
      timestamp: new Date().toISOString()
    });

    emitAICommentary(matchId, {
      matchId,
      commentary,
      zone: zone.name,
      batsman: batsmanName,
      bowler: bowlerName,
      runs,
      isWicket,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      success: true,
      zone: zone.name,
      distanceCategory,
      commentary,
      angle: zone.angle
    });
  } catch (error) {
    console.error("Error handling field click:", error);
    res.status(400).json({
      message: "Failed to process field click",
      error: error.message
    });
  }
};

export const revertLastBall = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { inningsIndex } = req.body;

    const match = await Match.findById(matchId);
    if (!match) return res.status(404).json({ message: "Match not found" });

    const innings = match.innings[inningsIndex];
    if (!innings || !innings.oversHistory || innings.oversHistory.length === 0) {
      return res.status(400).json({ message: "No balls to revert" });
    }

    let lastOverIndex = innings.oversHistory.length - 1;
    let lastOver = innings.oversHistory[lastOverIndex];

    if (!lastOver.balls || lastOver.balls.length === 0) {
      innings.oversHistory.pop();
      if (innings.oversHistory.length === 0) {
        return res.status(400).json({ message: "No balls to revert" });
      }
      lastOverIndex = innings.oversHistory.length - 1;
      lastOver = innings.oversHistory[lastOverIndex];
    }

    const ball = lastOver.balls.pop();
    if (!ball) return res.status(400).json({ message: "No ball found to revert" });

    const getSafeId = (p) => {
        if (!p) return null;
        return (p._id || p).toString();
    };

    // 1. Revert totals
    const batsmanRuns = ball.runs || 0;
    let extraRuns = 0;
    if (ball.isWide) extraRuns = 1 + ball.runs;
    else if (ball.isNoBall) extraRuns = 1;
    else if (ball.isBye || ball.isLegBye) extraRuns = ball.runs;

    innings.runs -= (batsmanRuns + extraRuns);
    lastOver.runsScored -= (batsmanRuns + extraRuns);

    // 2. Revert extras
    if (ball.isWide) {
      innings.extras.wides -= (1 + ball.runs);
    } else if (ball.isNoBall) {
      innings.extras.noBalls -= 1;
    } else if (ball.isBye) {
      innings.extras.byes -= ball.runs;
    } else if (ball.isLegBye) {
      innings.extras.legByes -= ball.runs;
    }
    innings.extras.total = (innings.extras.wides || 0) + (innings.extras.noBalls || 0) + (innings.extras.byes || 0) + (innings.extras.legByes || 0);

    // 3. Revert Batsman stats
    const strikerId = getSafeId(ball.batsmanOnStrike);
    const batsmanStats = innings.batting.find(b => getSafeId(b.player) === strikerId);
    if (batsmanStats) {
      if (!ball.isWide) {
        batsmanStats.balls = Math.max(0, (batsmanStats.balls || 0) - 1);
        batsmanStats.runs = Math.max(0, (batsmanStats.runs || 0) - batsmanRuns);
        if (batsmanRuns === 4) batsmanStats.fours = Math.max(0, (batsmanStats.fours || 0) - 1);
        if (batsmanRuns === 6) batsmanStats.sixes = Math.max(0, (batsmanStats.sixes || 0) - 1);
        if (batsmanRuns === 0 && !ball.isBye && !ball.isLegBye) {
          if (batsmanStats.dotBalls > 0) batsmanStats.dotBalls -= 1;
        }
      }
      batsmanStats.strikeRate = batsmanStats.balls > 0 ? ((batsmanStats.runs / batsmanStats.balls) * 100).toFixed(2) : 0;
      if (batsmanStats.shots && batsmanStats.shots.length > 0) batsmanStats.shots.pop();
    }

    // 4. Revert Bowler stats
    const bowlerId = getSafeId(ball.bowler);
    const bowlerStats = innings.bowling.find(b => getSafeId(b.player) === bowlerId);
    if (bowlerStats) {
      bowlerStats.runs = Math.max(0, (bowlerStats.runs || 0) - (batsmanRuns + extraRuns));
      if (ball.isWide) bowlerStats.wides = Math.max(0, (bowlerStats.wides || 0) - 1);
      if (ball.isNoBall) bowlerStats.noBalls = Math.max(0, (bowlerStats.noBalls || 0) - 1);
      if (!ball.isWide && !ball.isNoBall) {
        bowlerStats.balls = Math.max(0, (bowlerStats.balls || 0) - 1);
        if (batsmanRuns === 0 && !ball.isBye && !ball.isLegBye) {
          if (bowlerStats.dotBalls > 0) bowlerStats.dotBalls -= 1;
        }
      }
      bowlerStats.overs = Math.floor(bowlerStats.balls / 6);
      const bowlerOvers = (bowlerStats.overs) + (bowlerStats.balls % 6) / 6;
      bowlerStats.economy = bowlerOvers > 0 ? (bowlerStats.runs / bowlerOvers).toFixed(2) : 0;
    }

    // 5. Revert Wicket
    if (ball.isWicket) {
      innings.wickets -= 1;
      lastOver.wickets -= 1;
      if (bowlerStats) bowlerStats.wickets -= 1;

      const dismissedId = getSafeId(ball.dismissedPlayer || ball.batsmanOnStrike);
      const dismissedBatsman = innings.batting.find(b => getSafeId(b.player) === dismissedId);
      if (dismissedBatsman) {
        dismissedBatsman.isOut = false;
        dismissedBatsman.dismissalType = "";
        dismissedBatsman.dismissedBy = null;
      }
      innings.fallOfWickets.pop();
      if (innings.partnerships.length > 1) {
        innings.partnerships.pop(); // Remove the new placeholder partnership

        // Restore the previous partnership state
        const restoredPartnership = innings.partnerships[innings.partnerships.length - 1];
        if (restoredPartnership) {
          restoredPartnership.wicket = 0; // Remove the wicket marker
        }
      }

      // Remove any batting entries that were added as the "next batsman" after this wicket
      const restoredNonStrikerId = getSafeId(ball.batsmanNonStrike);
      innings.batting = innings.batting.filter(b => {
        const pid = getSafeId(b.player);
        const isRestoredBatsman = pid === strikerId || pid === restoredNonStrikerId;
        const hasNoStats = (b.balls || 0) === 0 && (b.runs || 0) === 0 && !b.isOut && !b.isRetiredHurt && !b.isRetired;
        return isRestoredBatsman || !hasNoStats;
      });
    }

    // 6. Update global innings balls/overs
    const isBallLegal = !ball.isWide && !ball.isNoBall;
    if (isBallLegal) {
      innings.balls = Math.max(0, (innings.balls || 0) - 1);
      innings.overs = Math.floor(innings.balls / 6);
    }

    // 6.5 Revert current partnership
    if (innings.partnerships && innings.partnerships.length > 0) {
      const currentPartnership = innings.partnerships[innings.partnerships.length - 1];
      currentPartnership.runs = Math.max(0, (currentPartnership.runs || 0) - (batsmanRuns + extraRuns));
      if (isBallLegal) {
        currentPartnership.balls = Math.max(0, (currentPartnership.balls || 0) - 1);
      }
    }

    // 7. Cleanup Empty Over
    if (lastOver.balls.length === 0) {
      innings.oversHistory.pop();
    }

    // 8. Restore Strike
    const stuckIds = [getSafeId(innings.currentBatsman1), getSafeId(innings.currentBatsman2), getSafeId(innings.onStrikeBatsman)].filter(Boolean);
    const restoredIds = [getSafeId(ball.batsmanOnStrike), getSafeId(ball.batsmanNonStrike)].filter(Boolean);
    
    [...stuckIds, ...restoredIds].forEach(pid => {
      const bs = innings.batting.find(b => getSafeId(b.player) === pid);
      if (bs) {
        bs.isRetiredHurt = false;
        bs.isRetired = false;
      }
    });

    innings.onStrikeBatsman = ball.batsmanOnStrike;
    innings.currentBatsman1 = ball.batsmanOnStrike;
    innings.currentBatsman2 = ball.batsmanNonStrike;
    innings.currentBowler = ball.bowler;

    // 9. Recalculate runRate and requiredRunRate
    const totalOvers = innings.overs + (innings.balls % 6) / 6;
    innings.runRate = totalOvers > 0 ? (innings.runs / totalOvers).toFixed(2) : 0;

    if (inningsIndex === 1 && match.innings[0]) {
      const remainingRuns = innings.target - innings.runs;
      const remainingOvers = match.totalOvers - totalOvers;
      innings.requiredRunRate = remainingOvers > 0 ? (remainingRuns / remainingOvers).toFixed(2) : 0;
    }

    match.markModified('innings');
    await match.save({ validateModifiedOnly: true });
    await populateFullMatch(match);

    try {
      const io = getIO();
      io.to(`match-${matchId}`).emit("match:ballReverted", { matchId, inningsIndex });
      io.emit("match:updated", match);
    } catch (err) { }

    res.status(200).json({ match, message: "Last ball reverted successfully" });
  } catch (error) {
    console.error("Revert Error:", error);
    res.status(400).json({ message: "Failed to revert ball", error: error.message });
  }
};

export const setBowler = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { inningsIndex, bowlerId } = req.body;

    const match = await Match.findById(matchId);
    if (!match) return res.status(404).json({ message: "Match not found" });

    const innings = match.innings[inningsIndex];
    if (!innings) return res.status(400).json({ message: "Invalid innings index" });

    innings.currentBowler = bowlerId;
    await match.save({ validateModifiedOnly: true });

    await populateFullMatch(match);

    try {
      const io = getIO();
      io.to(`match-${matchId}`).emit("match:bowlerSet", { matchId, inningsIndex, bowlerId });
    } catch (err) { }

    res.status(200).json({ match, message: "Bowler set successfully" });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const generateAICommentary = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { batsman, bowler, runs, extras, wicket, fieldPosition, ballNotation } = req.body;

    const prompt = `You are an expert cricket commentator. Generate ONE line of short cricket commentary (like TV/radio broadcast). Format: '[runs] [batsman] to [bowler], [description]'. Then on a new line, generate a longer vivid commentary sentence (1-2 sentences) describing where the ball went based on the field position '${fieldPosition}'. Be dramatic and engaging. Respond in this exact format:
LINE1: [short summary line]
LINE2: [vivid detailed commentary]

Context: Batsman: ${batsman}, Bowler: ${bowler}, Runs: ${runs}, Extras: ${extras}, Wicket: ${wicket}, Field Position: ${fieldPosition}, Ball info: ${ballNotation}`;

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(200).json({
        line1: `${ballNotation} ${batsman} to ${bowler}, ${runs} runs`,
        line2: `The ball was played towards ${fieldPosition}.`
      });
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20240620",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const data = await response.json();
    if (!data.content || !data.content[0]) {
      throw new Error("Invalid response from Anthropic");
    }

    const content = data.content[0].text;
    const lines = content.split('\n');
    let line1 = "";
    let line2 = "";

    lines.forEach(l => {
      if (l.toUpperCase().startsWith("LINE1:")) line1 = l.substring(6).trim();
      if (l.toUpperCase().startsWith("LINE2:")) line2 = l.substring(6).trim();
    });

    res.status(200).json({ line1, line2 });
  } catch (error) {
    console.error("AI Commentary Error:", error);
    res.status(200).json({
      line1: `${req.body.runs} runs to ${req.body.batsman}`,
      line2: `The ball was played towards ${req.body.fieldPosition}.`
    });
  }
};

export const useStrategicTimeout = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { teamId } = req.body;

    const match = await Match.findById(matchId);
    if (!match) return res.status(404).json({ message: "Match not found" });

    const innings = match.innings[match.currentInnings];
    const overNumber = Math.floor(innings.balls / 6);

    match.timeouts.push({
      team: teamId,
      over: overNumber,
      timestamp: new Date()
    });

    match.highlights.push({
      type: "Timeout",
      description: "Strategic Timeout",
      over: overNumber,
      timestamp: new Date()
    });

    await match.save({ validateModifiedOnly: true });

    try {
      const io = getIO();
      io.to(`match-${matchId}`).emit("match:timeout", { matchId, teamId, over: overNumber });
      io.emit("match:updated", match);
    } catch (err) { }

    res.status(200).json({ match, message: "Strategic Timeout recorded" });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const recordDRSReview = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { teamId, result, type, over, ball } = req.body;

    const match = await Match.findById(matchId);
    if (!match) return res.status(404).json({ message: "Match not found" });

    match.drsReviews.push({
      team: teamId,
      result,
      type,
      over,
      ball,
      timestamp: new Date()
    });

    match.highlights.push({
      type: "DRS",
      description: `DRS Review (${type}): ${result.toUpperCase()}`,
      over: over + (ball / 10),
      timestamp: new Date()
    });

    await match.save({ validateModifiedOnly: true });

    try {
      const io = getIO();
      io.to(`match-${matchId}`).emit("match:drsUpdate", { matchId, drs: match.drsReviews[match.drsReviews.length - 1] });
      io.emit("match:updated", match);
    } catch (err) { }

    res.status(200).json({ match, message: "DRS Review recorded" });
  } catch (error) {
    res.status(400).json({ message: error.message });
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

    // Reset all innings fields
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

    // Clear current player assignments to force re-selection or handle cleanly
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

export const retireBatsman = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { inningsIndex, playerId, type } = req.body; // type: "retired_hurt" or "retired"

    const match = await Match.findById(matchId);
    if (!match) return res.status(404).json({ message: "Match not found" });

    const innings = match.innings[inningsIndex];
    if (!innings) return res.status(400).json({ message: "Invalid innings index" });

    const batsmanStats = innings.batting.find(
      b => (b.player?._id || b.player).toString() === playerId.toString()
    );

    if (!batsmanStats) {
      return res.status(400).json({ message: "Batsman not found in innings" });
    }

    if (type === "retired_hurt") {
      batsmanStats.isRetiredHurt = true;
    } else {
      batsmanStats.isRetired = true;
    }

    // Remove from active strikers
    if (String(innings.currentBatsman1) === String(playerId)) {
      innings.currentBatsman1 = null;
    } else if (String(innings.currentBatsman2) === String(playerId)) {
      innings.currentBatsman2 = null;
    }

    if (String(innings.onStrikeBatsman) === String(playerId)) {
      innings.onStrikeBatsman = null;
    }

    await match.save({ validateModifiedOnly: true });
    await populateFullMatch(match);

    try {
      const io = getIO();
      io.emit("match:updated", match);
    } catch (err) { }

    res.status(200).json({ match, message: `Batsman ${type.replace('_', ' ')} successfully` });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const resetMatch = async (req, res) => {
  try {
    const { matchId } = req.params;

    const match = await Match.findById(matchId);
    if (!match) return res.status(404).json({ message: "Match not found" });

    // Reset both innings
    match.innings.forEach(innings => {
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
      innings.status = "upcoming";
      innings.onStrikeBatsman = null;
      innings.currentBatsman1 = null;
      innings.currentBatsman2 = null;
      innings.currentBowler = null;
    });

    match.currentInnings = 0;
    match.status = "upcoming";
    match.tossWinner = null;
    match.tossDecision = null;
    match.result = { winner: null, resultType: "normal", description: "" };
    match.highlights = [];
    match.winProbabilityHistory = [];

    await match.save({ validateModifiedOnly: true });
    await populateFullMatch(match);

    try {
      const io = getIO();
      io.to(`match-${matchId}`).emit("match:reset", { matchId, isMatchReset: true });
      io.emit("match:updated", match);
    } catch (err) { }

    res.status(200).json({ match, message: "Match reset successfully" });
  } catch (error) {
    console.error("Reset Match Error:", error);
    res.status(400).json({ message: error.message });
  }
};
export const editBall = async (req, res) => {
  try {
    const { matchId } = req.params;
    let { inningsIndex, overNumber, ballNumber, runs = 0, isWide = false, isNoBall = false, isBye = false, isLegBye = false, isWicket = false, wicketType = '', commentary: manualSummary, vividCommentary: manualVivid } = req.body;
    const match = await Match.findById(matchId);
    if (!match) return res.status(404).json({ message: 'Match not found' });
    const innings = match.innings[inningsIndex];
    if (!innings) return res.status(400).json({ message: 'Invalid innings index' });
    const over = innings.oversHistory.find(o => o.overNumber === overNumber);
    if (!over) return res.status(404).json({ message: 'Over not found' });
    const ballIdx = over.balls.findIndex(b => b.ballNumber === ballNumber);
    if (ballIdx === -1) return res.status(404).json({ message: 'Ball not found' });
    const oldBall = over.balls[ballIdx];
    const oldBatsmanRuns = oldBall.runs || 0;
    let oldExtraRuns = 0;
    if (oldBall.isWide) oldExtraRuns = 1 + (oldBall.runs || 0);
    else if (oldBall.isNoBall) oldExtraRuns = 1;
    else if (oldBall.isBye || oldBall.isLegBye) oldExtraRuns = oldBall.runs || 0;
    innings.runs = Math.max(0, innings.runs - oldBatsmanRuns - oldExtraRuns);
    over.runsScored = Math.max(0, (over.runsScored || 0) - oldBatsmanRuns - oldExtraRuns);
    if (oldBall.isWide) innings.extras.wides = Math.max(0, (innings.extras.wides || 0) - (1 + (oldBall.runs || 0)));
    else if (oldBall.isNoBall) innings.extras.noBalls = Math.max(0, (innings.extras.noBalls || 0) - 1);
    else if (oldBall.isBye) innings.extras.byes = Math.max(0, (innings.extras.byes || 0) - (oldBall.runs || 0));
    else if (oldBall.isLegBye) innings.extras.legByes = Math.max(0, (innings.extras.legByes || 0) - (oldBall.runs || 0));
    const oldBatId = (oldBall.batsmanOnStrike?._id || oldBall.batsmanOnStrike)?.toString();
    const oldBowlId = (oldBall.bowler?._id || oldBall.bowler)?.toString();
    const oldBatStats = innings.batting.find(b => (b.player?._id || b.player)?.toString() === oldBatId);
    if (oldBatStats && !oldBall.isWide) { oldBatStats.balls = Math.max(0, (oldBatStats.balls || 0) - 1); oldBatStats.runs = Math.max(0, (oldBatStats.runs || 0) - oldBatsmanRuns); if (oldBatsmanRuns === 4) oldBatStats.fours = Math.max(0, (oldBatStats.fours || 0) - 1); if (oldBatsmanRuns === 6) oldBatStats.sixes = Math.max(0, (oldBatStats.sixes || 0) - 1); }
    const oldBowlStats = innings.bowling.find(b => (b.player?._id || b.player)?.toString() === oldBowlId);
    if (oldBowlStats) { oldBowlStats.runs = Math.max(0, (oldBowlStats.runs || 0) - oldBatsmanRuns - oldExtraRuns); if (oldBall.isWide) oldBowlStats.wides = Math.max(0, (oldBowlStats.wides || 0) - 1); if (oldBall.isNoBall) oldBowlStats.noBalls = Math.max(0, (oldBowlStats.noBalls || 0) - 1); if (!oldBall.isWide && !oldBall.isNoBall) oldBowlStats.balls = Math.max(0, (oldBowlStats.balls || 0) - 1); }
    if (oldBall.isWicket) { innings.wickets = Math.max(0, innings.wickets - 1); over.wickets = Math.max(0, (over.wickets || 0) - 1); if (oldBowlStats) oldBowlStats.wickets = Math.max(0, (oldBowlStats.wickets || 0) - 1); }
    const newBatsmanRuns = (isBye || isLegBye) ? 0 : runs;
    let newExtraRuns = 0;
    if (isWide) newExtraRuns = 1 + runs; else if (isNoBall) newExtraRuns = 1; else if (isBye || isLegBye) newExtraRuns = runs;
    innings.runs += newBatsmanRuns + newExtraRuns;
    over.runsScored += newBatsmanRuns + newExtraRuns;
    if (isWide) innings.extras.wides = (innings.extras.wides || 0) + 1 + runs;
    else if (isNoBall) innings.extras.noBalls = (innings.extras.noBalls || 0) + 1;
    else if (isBye) innings.extras.byes = (innings.extras.byes || 0) + runs;
    else if (isLegBye) innings.extras.legByes = (innings.extras.legByes || 0) + runs;
    innings.extras.total = (innings.extras.wides || 0) + (innings.extras.noBalls || 0) + (innings.extras.byes || 0) + (innings.extras.legByes || 0);
    if (oldBatStats && !isWide) { oldBatStats.balls += 1; oldBatStats.runs += newBatsmanRuns; if (newBatsmanRuns === 4) oldBatStats.fours = (oldBatStats.fours || 0) + 1; if (newBatsmanRuns === 6) oldBatStats.sixes = (oldBatStats.sixes || 0) + 1; oldBatStats.strikeRate = oldBatStats.balls > 0 ? ((oldBatStats.runs / oldBatStats.balls) * 100).toFixed(2) : 0; }
    if (oldBowlStats) { oldBowlStats.runs += newBatsmanRuns + newExtraRuns; if (isWide) oldBowlStats.wides = (oldBowlStats.wides || 0) + 1; if (isNoBall) oldBowlStats.noBalls = (oldBowlStats.noBalls || 0) + 1; if (!isWide && !isNoBall) oldBowlStats.balls = (oldBowlStats.balls || 0) + 1; oldBowlStats.overs = Math.floor(oldBowlStats.balls / 6); const bOv = oldBowlStats.overs + (oldBowlStats.balls % 6) / 6; oldBowlStats.economy = bOv > 0 ? (oldBowlStats.runs / bOv).toFixed(2) : 0; }
    if (isWicket) { innings.wickets += 1; over.wickets = (over.wickets || 0) + 1; if (oldBowlStats) oldBowlStats.wickets = (oldBowlStats.wickets || 0) + 1; }
    let newNotation = '';
    if (isWicket) newNotation = 'W';
    else if (isWide) newNotation = `${1 + runs}w`;
    else if (isNoBall) newNotation = runs > 0 ? `NB+${runs}` : 'NB';
    else if (isBye) newNotation = `${runs}b`;
    else if (isLegBye) newNotation = `${runs}lb`;
    else newNotation = runs === 0 ? '•' : runs.toString();
    over.balls[ballIdx] = {
      ...((oldBall.toObject) ? oldBall.toObject() : oldBall),
      runs: newBatsmanRuns,
      isWide,
      isNoBall,
      isBye,
      isLegBye,
      isWicket,
      wicketType: isWicket ? wicketType : '',
      notation: newNotation,
      commentary: manualSummary !== undefined ? manualSummary : oldBall.commentary,
      vividCommentary: manualVivid !== undefined ? manualVivid : oldBall.vividCommentary,
      editedAt: new Date()
    };
    let totalLegal = 0;
    innings.oversHistory.forEach(ov => { (ov.balls || []).forEach(b => { if (!b.isWide && !b.isNoBall) totalLegal++; }); });
    innings.balls = totalLegal; innings.overs = Math.floor(totalLegal / 6);
    const totOvFloat = innings.overs + (innings.balls % 6) / 6;
    innings.runRate = totOvFloat > 0 ? (innings.runs / totOvFloat).toFixed(2) : 0;
    await match.save({ validateModifiedOnly: true });
    await populateFullMatch(match);

    try { const io = getIO(); io.to(`match-${matchId}`).emit('match:ballEdited', { matchId, inningsIndex, overNumber, ballNumber }); io.emit('match:updated', match); } catch (err) { }
    res.status(200).json({ match, message: 'Ball updated successfully' });

    // Fire off async task to regenerate commentary for the edited ball ONLY if not manually provided
    if (manualSummary === undefined) {
      setImmediate(async () => {
        try {
          const m = await Match.findById(matchId).populate("innings.batting.player innings.bowling.player");
          const inn = m.innings[inningsIndex];
          const ov = inn.oversHistory.find(o => o.overNumber === overNumber);
          const b = ov.balls.find(x => x.ballNumber === ballNumber);

          const oldBatId = oldBall.batsmanOnStrike?._id || oldBall.batsmanOnStrike;
          const oldBatName = m.innings[inningsIndex].batting.find(x => x.player?._id?.toString() === oldBatId?.toString())?.player?.name || "Batsman";
          const oldBowlId = oldBall.bowler?._id || oldBall.bowler;
          const oldBowlName = m.innings[inningsIndex].bowling.find(x => x.player?._id?.toString() === oldBowlId?.toString())?.player?.name || "Bowler";

          const aiComm = await aiCommentary.regenerateEditedBallCommentary({
            overNumber, ballNumber,
            oldType: oldBall.isWide ? 'wide' : oldBall.isNoBall ? 'no_ball' : oldBall.isBye ? 'bye' : oldBall.isLegBye ? 'leg_bye' : 'normal',
            oldRuns: oldBall.runs,
            oldDirection: oldBall.shotPlacement?.position || oldBall.fieldingZone || '',
            newType: b.isWide ? 'wide' : b.isNoBall ? 'no_ball' : b.isBye ? 'bye' : b.isLegBye ? 'leg_bye' : 'normal',
            newRuns: b.runs,
            newDirection: b.shotPlacement?.position || b.fieldingZone || '',
            bowlerName: oldBowlName,
            batsmanName: oldBatName,
            isWide: b.isWide,
            isNoBall: b.isNoBall,
            isWicket: b.isWicket,
            wicketType: b.wicketType
          });

          if (aiComm && aiComm.short) {
            b.commentary = aiComm.short;
            b.vividCommentary = aiComm.vivid || "";
            await m.save({ validateModifiedOnly: true });
            try {
              const io = getIO();
              io.to(`match-${matchId}`).emit("match:ballEdited", {
                matchId, inningsIndex, overNumber, ballNumber,
                newCommentary: aiComm.short,
                newVividCommentary: aiComm.vivid
              });
              io.emit("match:updated", m);
            } catch (e) { }
          }
        } catch (e) {
          console.error("Async Commentary Regen Error:", e);
        }
      });
    }

  } catch (error) { console.error('Edit Ball Error:', error); res.status(400).json({ message: error.message }); }
};
