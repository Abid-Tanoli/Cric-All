import { ScoringEngine } from './ScoringEngine.js';
import { getBallRunText } from '../../utils/cricketHelpers.js';
import { getBowlerQuota, getBowlerBalls, currentOverNumber as getCurrentOverNumber } from './bowlerRules.js';

const getId = (value) => {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return String(value._id || value.id || "");
};

const sameId = (a, b) => getId(a) && getId(a) === getId(b);

function resolveActiveBatters(innings, deliveryData = {}) {
  const striker =
    innings?.onStrikeBatsman ||
    innings?.currentBatsman1 ||
    deliveryData.batsmanOnStrikeId ||
    null;
  const first = innings?.currentBatsman1 || null;
  const second = innings?.currentBatsman2 || null;
  let nonStriker = deliveryData.batsmanNonStrikeId || null;

  if (first && second) {
    nonStriker = sameId(first, striker) ? second : first;
  } else if (!nonStriker) {
    nonStriker = sameId(first, striker) ? second : first;
  }

  return { striker, nonStriker };
}

function assignActiveBatters(innings, striker, nonStriker) {
  innings.currentBatsman1 = striker || null;
  innings.currentBatsman2 = nonStriker || null;
  innings.onStrikeBatsman = striker || null;
}

function resolveNextBatters(ballRecord, deliveryData = {}) {
  let striker = ballRecord?.nextBatsmanOnStrike || ballRecord?.batsmanOnStrike || null;
  let nonStriker = ballRecord?.nextBatsmanNonStrike || ballRecord?.batsmanNonStrike || null;

  if (ballRecord?.isWicket && ballRecord?.dismissedPlayer) {
    const dismissed = ballRecord.dismissedPlayer;
    const replacement = deliveryData.nextBatsmanId || null;

    if (sameId(dismissed, striker)) {
      striker = replacement;
    } else if (sameId(dismissed, nonStriker)) {
      nonStriker = replacement;
    } else if (sameId(dismissed, ballRecord.batsmanOnStrike)) {
      striker = replacement;
    } else if (sameId(dismissed, ballRecord.batsmanNonStrike)) {
      nonStriker = replacement;
    }
  }

  return { striker, nonStriker };
}

function computeBallNotation(ball) {
  if (ball.isWicket) return 'W';
  if (ball.isWide) return `${(ball.extraRuns || 0)}w`;
  if (ball.isNoBall) {
    const br = ball.batsmanRuns || 0;
    return br > 0 ? `NB+${br}` : 'NB';
  }
  if (ball.isBye) return `${ball.extraRuns || 0}b`;
  if (ball.isLegBye) return `${ball.extraRuns || 0}lb`;
  if (ball.batsmanRuns === 0) return '\u2022';
  return String(ball.batsmanRuns);
}

function enrichBallRecord(engineBall, deliveryData, batsmanName, bowlerName) {
  const extraType = engineBall.isWide ? 'wide'
    : engineBall.isNoBall ? 'no_ball'
      : engineBall.isBye ? 'bye'
        : engineBall.isLegBye ? 'leg_bye'
          : '';
  const wicketCancelled = engineBall.wicketCancelled != null
    ? engineBall.wicketCancelled
    : (deliveryData.isWicket && !engineBall.isWicket && engineBall.isNoBall);
  const ballWithFlag = { ...engineBall, wicketCancelled };
  return {
    ...ballWithFlag,
    ballNumber: engineBall.ballNumber,
    displayBallNumber: engineBall.displayBallNumber || engineBall.legalBallNumber,
    batsmanName: engineBall.batsmanName || batsmanName || deliveryData.batsmanOnStrikeName || 'Batsman',
    bowlerName: engineBall.bowlerName || bowlerName || deliveryData.bowlerName || 'Bowler',
    fielderName: engineBall.fielderName || deliveryData.fielderName || '',
    extraType,
    extraRuns: engineBall.extraRuns || 0,
    runText: getBallRunText(ballWithFlag),
    notation: computeBallNotation(ballWithFlag),
    shotPlacement: deliveryData.shotPlacement || { angle: 0, distance: 50, position: '' },
    fieldingZone: deliveryData.fieldingZone || '',
    shotType: deliveryData.shotType || '',
    pitchZone: deliveryData.pitchZone || '',
    ballMovement: deliveryData.ballMovement || 'none',
    ballOutcome: deliveryData.ballOutcome || 'played',
    pitchLine: deliveryData.pitchLine || '',
    pitchLength: deliveryData.pitchLength || '',
    pitchShotType: deliveryData.pitchShotType || '',
    pitchX: deliveryData.pitchX != null ? deliveryData.pitchX : null,
    pitchY: deliveryData.pitchY != null ? deliveryData.pitchY : null,
  };
}

function displayBallNumberFor(over, targetBall) {
  if (!targetBall) return null;
  let legalBallsBefore = 0;
  for (const ball of over?.balls || []) {
    const displayBallNumber = ball.displayBallNumber || ball.legalBallNumber || legalBallsBefore + 1;
    if ((targetBall._id && String(ball._id || '') === String(targetBall._id)) ||
        Number(ball.ballNumber) === Number(targetBall?.ballNumber)) {
      return displayBallNumber;
    }
    if (!ball.isWide && !ball.isNoBall) {
      legalBallsBefore += 1;
    }
  }
  return targetBall.displayBallNumber || targetBall.legalBallNumber || legalBallsBefore + 1;
}

function mapBattingStats(engineBatting) {
  return (engineBatting || []).map(b => {
    const bf = (b.ballsFaced != null && !isNaN(b.ballsFaced)) ? b.ballsFaced : (b.balls || 0);
    return {
      player: b.player,
      runs: b.runs || 0,
      balls: bf,
      fours: b.fours || 0,
      sixes: b.sixes || 0,
      dotBalls: b.dotBalls || 0,
      strikeRate: bf > 0
        ? ((b.runs / bf) * 100).toFixed(2)
        : (b.strikeRate && !isNaN(b.strikeRate) ? b.strikeRate : '0.00'),
      isOut: b.isOut || false,
      isRetiredHurt: b.isRetiredHurt || false,
      isRetired: b.isRetired || false,
      dismissalType: b.dismissalType || null,
      dismissedBy: b.dismissedBy || null,
      fielder: b.fielder || null,
      position: b.position || 0,
      shots: b.shots || [],
    };
  });
}

function mapBowlingStats(engineBowling) {
  return (engineBowling || []).map(b => {
    const bBalls = (b.balls != null && !isNaN(b.balls)) ? b.balls : 0;
    return {
      player: b.player,
      overs: b.overs || Math.floor(bBalls / 6),
      balls: bBalls,
      maidens: b.maidens || 0,
      runs: b.runs || 0,
      wickets: b.wickets || 0,
      wides: b.wides || 0,
      noBalls: b.noBalls || 0,
      economy: b.economy || '0.00',
    dotBalls: b.dotBalls ?? b.dots ?? 0,
      foursScored: b.foursScored || 0,
      sixesScored: b.sixesScored || 0,
    };
  });
}

function mapOversHistory(engineOvers, deliveryData) {
  return (engineOvers || []).map(ov => {
    let legalBalls = 0;
    const balls = (ov.balls || []).map(b => {
      const displayBallNumber = b.displayBallNumber || b.legalBallNumber || legalBalls + 1;
      const enriched = enrichBallRecord({ ...b, displayBallNumber }, deliveryData, null, null);
      if (!b.isWide && !b.isNoBall) {
        legalBalls += 1;
      }
      return enriched;
    });

    return {
      overNumber: ov.overNumber,
      bowler: ov.bowler,
      balls,
      runsScored: ov.runsScored || 0,
      wickets: ov.wickets || 0,
      maidenOver: ov.isMaiden || false,
      summary: ov.summary || '',
    };
  });
}

function applyEngineResultToMongoose(mongooseMatch, engineResult, deliveryData) {
  const { match: engineMatch, ball } = engineResult;

  engineMatch.innings.forEach((engineInn, idx) => {
    if (!mongooseMatch.innings[idx]) return;
    const mInn = mongooseMatch.innings[idx];

    mInn.runs = engineInn.runs || 0;
    mInn.wickets = engineInn.wickets || 0;
    mInn.balls = engineInn.balls || 0;
    mInn.overs = Math.floor((engineInn.balls || 0) / 6);
    mInn.runRate = engineInn.runRate || 0;
    mInn.requiredRunRate = engineInn.requiredRunRate || 0;
    mInn.target = engineInn.target || 0;
    mInn.isFreeHit = engineInn.isFreeHit || false;
    mInn.status = engineInn.status || mInn.status;

    if (engineInn.extras) {
      mInn.extras = {
        wides: engineInn.extras.wides || 0,
        noBalls: engineInn.extras.noBalls || 0,
        byes: engineInn.extras.byes || 0,
        legByes: engineInn.extras.legByes || 0,
        penalties: engineInn.extras.penalty || 0,
        total: engineInn.extras.total || 0,
      };
    }

    mInn.batting = mapBattingStats(engineInn.batting);
    mInn.bowling = mapBowlingStats(engineInn.bowling);
    mInn.oversHistory = mapOversHistory(engineInn.oversHistory, deliveryData);
    mInn.fallOfWickets = engineInn.fallOfWickets || [];
    mInn.partnerships = engineInn.partnerships || [];
  });

  if (engineMatch.currentInnings != null) {
    mongooseMatch.currentInnings = engineMatch.currentInnings;
  }
  if (engineMatch.status) {
    mongooseMatch.status = engineMatch.status;
  }
  if (engineMatch.result) {
    mongooseMatch.result = engineMatch.result;
  }
  if (engineMatch.powerplay) {
    mongooseMatch.powerplay = engineMatch.powerplay;
  }

  const ballRecord = ball;
  if (ballRecord) {
    const innIdx = engineResult.match?.currentInnings ?? 0;
    const mInn = mongooseMatch.innings[innIdx];
    if (mInn) {
      const { striker, nonStriker } = resolveNextBatters(ballRecord, deliveryData);
      assignActiveBatters(mInn, striker, nonStriker);
    }
  }

  mongooseMatch.markModified('innings');
  mongooseMatch.markModified('result');
}

export function processDeliveryWithEngine(mongooseMatch, deliveryData) {
  const inningsIndex = deliveryData.inningsIndex ?? mongooseMatch.currentInnings ?? 0;
  const innings = mongooseMatch.innings[inningsIndex];
  const { striker: serverStriker, nonStriker: serverNonStriker } = resolveActiveBatters(innings, deliveryData);

  const batsmanOnStrike = serverStriker;
  const bowlerPlayer = innings?.currentBowler;

  const batsmanName = batsmanOnStrike?.name || deliveryData.batsmanOnStrikeName;
  const bowlerName = bowlerPlayer?.name || deliveryData.bowlerName;

  // Check consecutive over rule before running engine
  if (!deliveryData.skipBowlerCheck) {
    const currentOverNumber = Math.floor((innings?.balls || 0) / 6);
    const existingOver = (innings?.oversHistory || []).find(o => o.overNumber === currentOverNumber);
    if (!existingOver && innings?.oversHistory?.length > 0) {
      const lastOver = innings.oversHistory[innings.oversHistory.length - 1];
      if (lastOver.bowler && deliveryData.bowlerId &&
          String(lastOver.bowler) === String(deliveryData.bowlerId)) {
        const err = new Error('Same bowler cannot bowl consecutive overs');
        err.code = 'SAME_BOWLER_CONSECUTIVE';
        throw err;
      }
    }

    const quota = getBowlerQuota(mongooseMatch);
    const bowlerBalls = getBowlerBalls(innings, deliveryData.bowlerId);
    if (deliveryData.bowlerId && bowlerBalls >= quota * 6) {
      const err = new Error(`This bowler has reached the ${quota}-over quota for this match.`);
      err.code = 'BOWLER_QUOTA_REACHED';
      throw err;
    }

    const replacedBlock = innings?.replacedBowlerBlock;
    if (replacedBlock && deliveryData.bowlerId
      && Number(replacedBlock.overNumber) === Number(getCurrentOverNumber(innings))
      && String(replacedBlock.player) === String(deliveryData.bowlerId)) {
      const err = new Error('The replaced bowler cannot bowl again in this over.');
      err.code = 'REPLACED_BOWLER_IN_OVER';
      throw err;
    }
  }

  // Build clean delivery object for the engine
  const delivery = {
    inningsIndex,
    runs: deliveryData.runs || 0,
    isWide: deliveryData.isWide || false,
    isNoBall: deliveryData.isNoBall || false,
    isBye: deliveryData.isBye || false,
    isLegBye: deliveryData.isLegBye || false,
    isWicket: deliveryData.isWicket || false,
    wicketType: deliveryData.wicketType || null,
    dismissedPlayer: deliveryData.dismissedPlayerId || null,
      fielder: deliveryData.fielderId || null,
      didCross: deliveryData.didCross,
    batsmanOnStrike: serverStriker,
    batsmanNonStrike: serverNonStriker,
    bowler: deliveryData.bowlerId,
    commentary: deliveryData.commentaryText || '',
    vividCommentary: deliveryData.vividCommentary || '',
    isAssistedRunOut: deliveryData.isAssistedRunOut || false,
    isDirectHitRunOut: deliveryData.isDirectHitRunOut || false,
    resetMatch: deliveryData.resetMatch || false,
    revertBall: deliveryData.revertBall || false,
    penaltyRuns: deliveryData.penaltyRuns || 0,
    penaltyReason: deliveryData.penaltyReason || null,
  };

  // Deep clone match state for the engine
  const matchClone = JSON.parse(JSON.stringify(mongooseMatch.toObject ? mongooseMatch.toObject({ flattenMaps: true }) : mongooseMatch));

  // Normalize field names for engine
  matchClone.innings.forEach(inn => {
    if (!inn.extras) inn.extras = {};
    inn.extras.penalty = inn.extras.penalty || inn.extras.penalties || 0;
    delete inn.extras.penalties;
  });

  const engine = new ScoringEngine(matchClone);
  const result = engine.processDelivery(delivery);

  // Apply computed results to Mongoose document
  applyEngineResultToMongoose(mongooseMatch, result, deliveryData);

  // Enrich the returned ball record
  const enrichedBall = enrichBallRecord(result.ball, deliveryData, batsmanName, bowlerName);

  // Extract key values for the controller
  const curInnings = mongooseMatch.innings[inningsIndex];
  const isLegalDelivery = !result.ball.isWide && !result.ball.isNoBall;
  const ballsBeforeThisDelivery = Math.max((curInnings?.balls || 0) - (isLegalDelivery ? 1 : 0), 0);
  const currentOverNumber = Math.floor(ballsBeforeThisDelivery / 6);
  const currentOver = curInnings?.oversHistory?.find(o => o.overNumber === currentOverNumber);
  const ballNumberInOver = displayBallNumberFor(currentOver, result.ball);
  enrichedBall.displayBallNumber = ballNumberInOver;
  const strikerAfter = curInnings?.onStrikeBatsman || result.ball.nextBatsmanOnStrike || result.ball.batsmanOnStrike;
  const nonStrikerAfter = curInnings?.currentBatsman2 || result.ball.nextBatsmanNonStrike || result.ball.batsmanNonStrike;

  return {
    ball: enrichedBall,
    engineBall: result.ball,
    innings: curInnings,
    match: mongooseMatch,
    overComplete: result.overComplete,
    inningsComplete: result.inningsComplete,
    currentOver,
    currentOverNumber,
    ballNumberInOver,
    freeHitNext: result.freeHitNext || false,
    powerplay: result.powerplay || null,
    ballEvent: result.ballEvent || null,
    events: result.events || [],
    batsmanRuns: result.ball.batsmanRuns || 0,
    extraRuns: result.ball.extraRuns || 0,
    runs: result.ball.runs || 0,
    isWicket: result.ball.isWicket || false,
    wicketType: result.ball.wicketType || null,
    battingStats: (curInnings?.batting || []).find(b =>
      serverStriker &&
      String(b.player?._id || b.player) === String(serverStriker?._id || serverStriker)
    ),
    strikerBeforeId: serverStriker?._id || serverStriker,
    nonStrikerBeforeId: serverNonStriker?._id || serverNonStriker,
    strikerAfterId: strikerAfter?._id || strikerAfter,
    nonStrikerAfterId: nonStrikerAfter?._id || nonStrikerAfter,
  };
}

export function computeShouldEndInnings(innings, match, inningsIndex) {
  const isSuperOver = match.result?.resultType === 'super_over';
  const wicketLimit = isSuperOver ? 2 : 10;
  const isTestMatch = match.matchType === 'Test';

  return (
    innings.wickets >= wicketLimit ||
    (!isTestMatch && (innings.overs || 0) >= (match.totalOvers || 20)) ||
    (inningsIndex === 1 && match.innings.length === 2 && innings.runs >= (innings.target || 0)) ||
    (inningsIndex === 3 && innings.runs >= (innings.target || 0))
  );
}
