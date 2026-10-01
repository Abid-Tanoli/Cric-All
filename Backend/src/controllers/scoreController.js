import Match from "../models/Match.js";
import Player from "../models/Player.js";
import fetch from "node-fetch";
import { getIO, emitBallRecorded, emitScoreUpdate, emitStrikeChanged, emitOverCompleted, emitBallWithCommentary, emitBallUpdate, emitWicketAlert, emitMilestoneAlert, emitInningsComplete, emitInningsEnd, emitMatchEnd, emitFieldClick, emitAICommentary } from "../socket/socket.js";
import { updateTournamentPoints } from "../services/tournamentService.js";
import fieldPositionMapper from "../services/fieldPositionMapper.js";
import aiCommentary from "../services/aiCommentary.js";
import CricketShot from "../models/CricketShot.js";
import Ball from "../models/Ball.js";
import { saveAndEmitCommentary } from "../services/commentaryService.js";
import Delivery from "../models/Delivery.js";
import Partnership from "../models/Partnership.js";
import MatchAnalytics from "../models/MatchAnalytics.js";
import { computeProjectedScore, computeWinProbability, updateMatchAnalytics } from "../services/analyticsService.js";
import { getBallRunText } from "../utils/cricketHelpers.js";
import { processDeliveryWithEngine, computeShouldEndInnings } from "../services/scoring/controllerAdapter.js";
import { normalizeWicketType, calculateWinProbability, populateFullMatch } from "../utils/scoringHelpers.js";

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
      nextBatsmanId = null,
      didCross,
      groundZone = "",
      fieldedByPosition = "",
      shotTypeName = "",
      isAppeal = false
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
    if (["completed", "pending_tie_resolution"].includes(match.status)) {
      return res.status(409).json({ message: `Cannot score while match status is ${match.status}`, code: "MATCH_NOT_SCORABLE" });
    }
    if (innings.status === "completed") {
      return res.status(409).json({ message: "Cannot score a completed innings", code: "INNINGS_COMPLETED" });
    }
    wicketType = normalizeWicketType(wicketType);

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
        didCross,
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
      strikerBeforeId,
      nonStrikerBeforeId,
      strikerAfterId,
      nonStrikerAfterId,
      freeHitNext,
    } = engineResult;
    // Track wicket cancelled on no-ball (user requested wicket, engine rejected it)
    const wicketCancelled = isNoBall && !engineWicket && isWicket;
    // Reassign to the outer let-declared isWicket so downstream code sees engine's decision
    isWicket = engineWicket;
    batsmanOnStrikeId = strikerBeforeId;
    batsmanNonStrikeId = nonStrikerBeforeId;

    // Validate fielder for 1/2/3 runs (non-wicket, non-extras)
    const runsValue = parseInt(String(runs), 10);
    if ([1, 2, 3].includes(runsValue) && !isWicket && !isWide && !isNoBall && !isBye && !isLegBye) {
      if (!fielderId) {
        console.warn(`[Scoring] Runs=${runsValue} but no fielderId provided for match ${matchId}`);
      }
    }

    // Get player names for commentary
    const batsmanOnStrike = await Player.findById(batsmanOnStrikeId);
    const bowlerPlayer = await Player.findById(bowlerId);
    const fielderPlayer = fielderId ? await Player.findById(fielderId) : null;

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

    // Look up shot type name from CricketShot if not provided in request
    if (!shotTypeName && shotType) {
      try {
        const shotDoc = await CricketShot.findById(shotType).select("name").lean();
        if (shotDoc) shotTypeName = shotDoc.name;
      } catch (e) { /* ignore lookup errors */ }
    }

    // Generate AI commentary
    let commentary = commentaryText || ball.commentary || '';
    let aiGeneratedCommentary = null;
    let vividCommentary = ball.vividCommentary || null;

    let commentaryIsAi = false;

    // AI commentary generation (only when AI is enabled)
    if (!customCommentary) {
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
          isFreeHit: ball.isFreeHit || false,
          isWicket: engineWicket,
          wicketType: engineWicketType,
          wicketCancelled,
          freeHitNext,
          isAppeal,
          batsmanName: batsmanOnStrike?.name || "Batsman",
          bowlerName: bowlerPlayer?.name || "Bowler",
          zone: zone.name || "",
          fieldingZone: fieldingZone || zone.name || "",
          direction: shotPlacement?.position || fieldingZone || "",
          shotDirection: shotPlacement?.position || fieldingZone || "",
          shotName: shotType || "",
          shotType: shotTypeName || "",
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
          commentaryIsAi = true;
        }
      } catch (aiErr) {
        console.error("AI Commentary Error:", aiErr);
      }
    }

    // Fallback template commentary (non-AI) if no commentary was set
    if (!commentary) {
      commentary = generateDetailedCommentary({
        runs: batsmanRuns,
        isWide,
        isNoBall,
        isBye,
        isLegBye,
        isWicket: engineWicket,
        wicketType: engineWicketType,
        wicketCancelled,
        freeHitNext,
        batsmanName: batsmanOnStrike?.name || "Batsman",
        bowlerName: bowlerPlayer?.name || "Bowler",
        currentScore: innings.runs || 0,
        currentWickets: innings.wickets || 0,
        overNumber: currentOverNumber,
        ballNumber: ballNumberInOver,
        extraRuns: runs,
        isAppeal
      });
      vividCommentary = `The delivery was bowled and played toward the ${shotPlacement?.position || fieldingZone || "fielding area"}. ${batsmanOnStrike?.name || "The batsman"} managed to pick up ${runs} run${runs !== 1 ? "s" : ""}.`;
    }

    // Set commentary on the ball record
    ball.commentary = commentary;
    ball.vividCommentary = vividCommentary;
    ball.isAi = commentaryIsAi;
    ball.displayBallNumber = ball.displayBallNumber || ballNumberInOver;
    ball.batsmanName = batsmanOnStrike?.name || "Batsman";
    ball.bowlerName = bowlerPlayer?.name || "Bowler";
    ball.fielderName = fielderPlayer?.name || "";
    ball.extraType = isWide ? "wide" : isNoBall ? "no_ball" : isBye ? "bye" : isLegBye ? "leg_bye" : "";
    ball.extraRuns = extraRuns || 0;
    ball.wicketCancelled = wicketCancelled;
    ball.freeHitNext = freeHitNext;

    // Set shot/fielding data on ball subdocument
    ball.shotType = shotType || "";
    ball.pitchLine = pitchLine || "";
    ball.pitchLength = pitchLength || "";
    ball.ballMovement = ballMovement || "none";
    ball.shotDirection = groundZone || fieldingZone || shotPlacement?.position || "";
    ball.fieldingZone = groundZone || fieldingZone || "";
    ball.shotTypeName = shotTypeName || "";

    const persistedOver = innings.oversHistory?.find(o => o.overNumber === currentOverNumber);
    const persistedBall = persistedOver?.balls?.[persistedOver.balls.length - 1];
    if (persistedBall) {
      persistedBall.commentary = commentary;
      persistedBall.vividCommentary = vividCommentary;
      persistedBall.displayBallNumber = ball.displayBallNumber || ballNumberInOver;
      persistedBall.batsmanName = ball.batsmanName;
      persistedBall.bowlerName = ball.bowlerName;
      persistedBall.fielderName = ball.fielderName;
      persistedBall.runText = ball.runText || getBallRunText(ball);
      persistedBall.extraType = ball.extraType;
      persistedBall.extraRuns = ball.extraRuns;
      persistedBall.shotType = ball.shotType;
      persistedBall.pitchLine = ball.pitchLine;
      persistedBall.pitchLength = ball.pitchLength;
      persistedBall.ballMovement = ball.ballMovement;
      persistedBall.shotDirection = ball.shotDirection;
      persistedBall.fieldingZone = ball.fieldingZone;
      persistedBall.shotTypeName = ball.shotTypeName;
      persistedBall.wicketCancelled = ball.wicketCancelled;
      persistedBall.freeHitNext = ball.freeHitNext;
    }

    // Set current bowler on innings
    innings.currentBowler = bowlerId;
    if (innings.status !== "completed") innings.status = "live";
    match.currentInnings = inningsIndex;
    if (!["completed", "pending_tie_resolution", "super_over"].includes(match.status)) {
      match.status = "live";
    }

    // Strike rotation for next ball — engine already applied both odd-runs swap
    // AND end-of-over swap to ball.batsmanOnStrike / ball.batsmanNonStrike.
    // Controller must NOT re-apply any ternary — just read engine's result.
    const persistedStrikerAfter = innings.onStrikeBatsman?._id || innings.onStrikeBatsman || strikerAfterId;
    const persistedNonStrikerAfter = innings.currentBatsman2?._id || innings.currentBatsman2 || nonStrikerAfterId;
    const strikeRotationLog = {
      over: currentOverNumber,
      ball: ballNumberInOver,
      runsThisBall: batsmanRuns,
      isOverComplete,
      strikerBefore: String(batsmanOnStrikeId || ""),
      nonStrikerBefore: String(batsmanNonStrikeId || ""),
      strikerAfter: String(persistedStrikerAfter || ""),
      nonStrikerAfter: String(persistedNonStrikerAfter || ""),
    };
    console.log(`[STRIKE_ROTATION] ${JSON.stringify(strikeRotationLog)}`);

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
      // ─── BALL RECORDED ──────────────────────────────────────
      const strikerId = persistedStrikerAfter;
      const nonStrikerId = persistedNonStrikerAfter;

      emitBallRecorded(matchId, {
        inningsIndex,
        ball,
        currentOver: currentOver.overNumber,
        ballNumber: ballNumberInOver,
        displayBallNumber: ball.displayBallNumber || ballNumberInOver,
        isOverComplete,
        runs: batsmanRuns,
        extraRuns,
        isWicket: engineWicket,
        wicketType: engineWicketType,
        wicketCancelled,
        freeHitNext,
        strikerId,
        nonStrikerId,
        strikerBeforeId: batsmanOnStrikeId,
        nonStrikerBeforeId: batsmanNonStrikeId,
        commentary: aiGeneratedCommentary || null,
        batsmanName: batsmanOnStrike?.name || "",
        bowlerName: bowlerPlayer?.name || "",
      });

      // ─── SCORE UPDATE ───────────────────────────────────────
      emitScoreUpdate(matchId, {
        inningsIndex,
        runs: innings.runs,
        wickets: innings.wickets,
        overs: innings.overs,
        balls: innings.balls,
        runRate: innings.runRate,
        requiredRunRate: innings.requiredRunRate,
        powerplayStatus: innings.powerplayStatus,
        powerplayConfig: match.powerplayConfig,
        currentInnings: match.currentInnings,
        strikerId,
        nonStrikerId,
      });

      // ─── STRIKE CHANGED ─────────────────────────────────────
      const prevStrikerId = batsmanOnStrikeId;
      if (String(strikerId || "") !== String(prevStrikerId || "")) {
        emitStrikeChanged(matchId, {
          strikerId,
          nonStrikerId,
          previousStrikerId: prevStrikerId,
          inningsIndex,
        });
      }

      // ─── OVER COMPLETED ─────────────────────────────────────
      if (isOverComplete) {
        const overExtras = currentOver.balls.filter(b => b.isWide || b.isNoBall).length;
        const overSummary = aiCommentary
          ? await aiCommentary.generateOverSummary({
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
            })
          : null;

        if (overSummary) {
          currentOver.summary = overSummary;
          Match.findByIdAndUpdate(matchId, { $set: { [`innings.${inningsIndex}.oversHistory.${innings.oversHistory.length - 1}.summary`]: overSummary } })
            .exec()
            .catch(err => console.error("Error updating over summary:", err));
        }

        emitOverCompleted(matchId, {
          overNumber: currentOverNumber,
          over: currentOver,
          summary: overSummary,
          inningsIndex,
          strikerId,
          nonStrikerId,
        });
      }

      // ─── INNINGS / MATCH END ────────────────────────────────
      if (shouldEndInnings) {
        const isMatchEnd = match.currentInnings >= 1 || match.innings.length <= 1;
        const eventData = {
          inningsIndex,
          runs: innings.runs,
          wickets: innings.wickets,
          suggestion: "End innings?",
        };
        if (isMatchEnd) {
          emitMatchEnd(matchId, { ...eventData, result: match.result });
        } else {
          emitInningsEnd(matchId, eventData);
        }
      }

      // ─── LEGACY: match:updateList for match-list pages ──────
      getIO().emit("match:updateList");
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
        batsmanName: batsmanOnStrike?.name || "Batsman",
        bowlerName: bowlerPlayer?.name || "Bowler",
        fielderName: fielderPlayer?.name || "",
        runsOffBat: batsmanRuns,
        extras: extraRuns,
        extraType: isWide ? 'wide' : isNoBall ? 'no_ball' : isBye ? 'bye' : isLegBye ? 'leg_bye' : null,
        isWicket: isWicket,
        wicketType: wicketType || null,
        wicketCancelled,
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

    // Create standalone Ball document for commentary/shots/fielding
    try {
      const ballDoc = new Ball({
        matchId: match._id,
        over: currentOverNumber,
        ball: ballNumberInOver,
        batsman: batsmanOnStrikeId,
        bowler: bowlerId,
        batsmanName: batsmanOnStrike?.name || "",
        bowlerName: bowlerPlayer?.name || "",
        runs: batsmanRuns,
        extraType: isWide ? "wide" : isNoBall ? "no_ball" : isBye ? "bye" : isLegBye ? "leg_bye" : null,
        extraRuns,
        isWide,
        isNoBall,
        isBye,
        isLegBye,
        isWicket,
        wicketType: wicketType || null,
        wicketCancelled,
        fielderName: fielderPlayer?.name || "",
        shotType: shotType || null,
        shotTypeName: shotTypeName || "",
        pitchLine: pitchLine || "",
        pitchLength: pitchLength || "",
        groundZone: groundZone || fieldingZone || "",
        fieldedBy: fielderId || null,
        fieldedByPosition: fieldedByPosition || "",
        commentary: ball?.commentary || "",
        vividCommentary: ball?.vividCommentary || "",
        displayBallNumber: ball.displayBallNumber || ballNumberInOver,
        commentaryGeneratedAt: new Date(),
        freeHitNext,
      });
      const savedBall = await ballDoc.save();
      if (savedBall) {
        saveAndEmitCommentary(savedBall._id, ball?.commentary || "", {
          matchId: match._id,
          bowlerName: bowlerPlayer?.name || "",
          batsmanName: batsmanOnStrike?.name || "",
          batsmanRuns,
          runs: batsmanRuns,
          isWicket,
          overNumber: currentOverNumber,
          ballNumber: ballNumberInOver,
          currentOver: `${currentOverNumber}.${ballNumberInOver}`,
          displayBallNumber: ball.displayBallNumber || ballNumberInOver,
          fieldedByName: fielderPlayer?.name || "",
          fieldedByPosition: fieldedByPosition || "",
        }).catch(e => console.warn("Commentary emit error:", e.message));
      }
    } catch (e) { console.log("Ball document creation error:", e.message); }

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
          if (!isWide && !isNoBall) activePartnership.balls += 1;
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


// endInnings moved to inningsController.js

// reduceOvers, startNextInnings moved to inningsController.js

function generateDetailedCommentary({
  runs,
  isWide,
  isNoBall,
  isBye,
  isLegBye,
  isWicket,
  wicketType,
  wicketCancelled,
  freeHitNext,
  batsmanName,
  bowlerName,
  currentScore,
  currentWickets,
  overNumber,
  ballNumber,
  extraRuns = 0,
  isAppeal = false
}) {
  const appealPrefix = isAppeal
    ? (["Huge appeal! ", "Loud shout! ", "The fielders appeal! ", "Appeal from the bowling side! "])[Math.floor(Math.random() * 4)]
    : "";

  if (wicketCancelled) {
    const freeHitLine = freeHitNext ? " Free Hit is coming next ball." : "";
    const nbCancelled = [
      `${appealPrefix}NO BALL! ${batsmanName} looked out but the umpire calls it a no ball — wicket cancelled! Just the one extra run from the no-ball.${freeHitLine}`,
      `${appealPrefix}No ball called — ${batsmanName} survives! The wicket is cancelled due to the front foot no-ball. One extra run added.${freeHitLine}`,
      `${appealPrefix}Big moment! It looked like ${batsmanName} was gone, but the no-ball saves them! Wicket cancelled. One run added.${freeHitLine}`
    ];
    return nbCancelled[Math.floor(Math.random() * nbCancelled.length)];
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
    const freeHitLine = freeHitNext ? " Free Hit coming next ball!" : "";
    const noballs = [
      `No ball! ${bowlerName} oversteps.${freeHitLine}`,
      `NO BALL! That's a big overstep from ${bowlerName}.${freeHitLine}`,
      `No ball! ${bowlerName} will have to bowl that again.${freeHitLine}`
    ];
    let comment = noballs[Math.floor(Math.random() * noballs.length)];
    if (extraRuns > 0) {
      const runComments = {
        1: " They take a single.",
        2: " They scamper back for two.",
        3: " Excellent running, they get three!",
        4: " FOUR! He's punished that no ball to the fence!",
        6: " SIX! MASSIVE! Smashed it out of the park on a no ball!"
      };
      comment += runComments[extraRuns] || ` ${extraRuns} runs taken.`;
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

  if (isWicket) {
    const wicketTypeNorm = (wicketType || "").toLowerCase().replace(/[_-]/g, " ");
    const wicketFallbacks = {
      bowled: `Bowled him! ${bowlerName} knocks over ${batsmanName}'s stumps. What a delivery!`,
      caught: `CAUGHT! ${batsmanName} is out! The fielder takes a clean catch. ${bowlerName} strikes!`,
      lbw: `LBW! ${batsmanName} is struck in front. The umpire raises the finger. ${bowlerName} celebrates!`,
      "run out": `RUN OUT! Direct hit and ${batsmanName} is short of the crease!`,
      stumped: `STUMPED! ${batsmanName} steps out and the keeper whips the bails off in a flash!`,
      "hit wicket": `HIT WICKET! ${batsmanName} steps back and dislodges the bails! Unlucky!`,
    };
    let fallback = wicketFallbacks[wicketTypeNorm] || `OUT! ${batsmanName} is dismissed. ${wicketType || "Wicket"} for ${bowlerName}!`;
    if (runs > 0) fallback += ` ${runs} run${runs !== 1 ? 's' : ''} scored on the ball.`;
    return appealPrefix + fallback;
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
    } catch (err) { console.error("Socket emit error (tieResolved):", err.message); }

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
    } catch (err) { console.error("Socket emit error (superOverStarted):", err.message); }

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
    const { x, y, runs, isWicket, wicketType, overNumber, ballNumber, isAppeal = false } = req.body;

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
      isFreeHit: false,
      isWicket: isWicket || false,
      wicketType: wicketType || "",
      batsmanName,
      bowlerName,
      isAppeal,
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
        if (!ball.isNoBall) {
          batsmanStats.balls = Math.max(0, (batsmanStats.balls || 0) - 1);
        }
        batsmanStats.runs = Math.max(0, (batsmanStats.runs || 0) - batsmanRuns);
        if (batsmanRuns === 4) batsmanStats.fours = Math.max(0, (batsmanStats.fours || 0) - 1);
        if (batsmanRuns === 6) batsmanStats.sixes = Math.max(0, (batsmanStats.sixes || 0) - 1);
        if (!ball.isNoBall && batsmanRuns === 0 && !ball.isBye && !ball.isLegBye) {
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
    } catch (err) { console.error("Socket emit error (ballReverted):", err.message); }

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
    } catch (err) { console.error("Socket emit error (bowlerSet):", err.message); }

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
    } catch (err) { console.error("Socket emit error (timeout):", err.message); }

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
    } catch (err) { console.error("Socket emit error (drs):", err.message); }

    res.status(200).json({ match, message: "DRS Review recorded" });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// resetInnings moved to inningsController.js

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
    } catch (err) { console.error("Socket emit error (retire):", err.message); }

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
    } catch (err) { console.error("Socket emit error (reset):", err.message); }

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
    if (oldBatStats && !oldBall.isWide) { if (!oldBall.isNoBall) oldBatStats.balls = Math.max(0, (oldBatStats.balls || 0) - 1); oldBatStats.runs = Math.max(0, (oldBatStats.runs || 0) - oldBatsmanRuns); if (oldBatsmanRuns === 4) oldBatStats.fours = Math.max(0, (oldBatStats.fours || 0) - 1); if (oldBatsmanRuns === 6) oldBatStats.sixes = Math.max(0, (oldBatStats.sixes || 0) - 1); }
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
    if (oldBatStats && !isWide) { if (!isNoBall) oldBatStats.balls += 1; oldBatStats.runs += newBatsmanRuns; if (newBatsmanRuns === 4) oldBatStats.fours = (oldBatStats.fours || 0) + 1; if (newBatsmanRuns === 6) oldBatStats.sixes = (oldBatStats.sixes || 0) + 1; oldBatStats.strikeRate = oldBatStats.balls > 0 ? ((oldBatStats.runs / oldBatStats.balls) * 100).toFixed(2) : 0; }
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
    innings.oversHistory.forEach(ov => {
      let legalBalls = 0;
      (ov.balls || []).forEach(b => {
        b.displayBallNumber = legalBalls + 1;
        if (!b.isWide && !b.isNoBall) legalBalls += 1;
      });
    });
    let totalLegal = 0;
    innings.oversHistory.forEach(ov => { (ov.balls || []).forEach(b => { if (!b.isWide && !b.isNoBall) totalLegal++; }); });
    innings.balls = totalLegal; innings.overs = Math.floor(totalLegal / 6);
    const totOvFloat = innings.overs + (innings.balls % 6) / 6;
    innings.runRate = totOvFloat > 0 ? (innings.runs / totOvFloat).toFixed(2) : 0;
    await match.save({ validateModifiedOnly: true });
    await populateFullMatch(match);

    try { const io = getIO(); io.to(`match-${matchId}`).emit('match:ballEdited', { matchId, inningsIndex, overNumber, ballNumber }); io.emit('match:updated', match); } catch (err) { console.error("Socket emit error (ballEdited):", err.message); }
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
            } catch (e) { console.error("Socket emit error (ballEdited async):", e.message); }
          }
        } catch (e) {
          console.error("Async Commentary Regen Error:", e);
        }
      });
    }

  } catch (error) { console.error('Edit Ball Error:', error); res.status(400).json({ message: error.message }); }
};
