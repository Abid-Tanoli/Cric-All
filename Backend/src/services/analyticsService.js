import MatchAnalytics from "../models/MatchAnalytics.js";

export function computeProjectedScore(currentRuns, currentBalls, totalBalls, wickets) {
  if (currentBalls === 0) return 0;
  
  const remainingBalls = totalBalls - currentBalls;
  const currentRunRate = (currentRuns / currentBalls) * 6;
  
  const wicketPenalty = wickets * 0.05;
  const adjustedRR = currentRunRate * (1 - wicketPenalty);
  
  const projectedAdditional = (remainingBalls / 6) * adjustedRR;
  const baseProjection = Math.round(currentRuns + projectedAdditional);
  
  const bestCase = Math.round(baseProjection * 1.08);
  const worstCase = Math.round(baseProjection * 0.88);
  
  return {
    projected: baseProjection,
    rangeLow: worstCase,
    rangeHigh: bestCase
  };
}

export function computeWinProbability(target, currentRuns, currentBalls, totalBalls, wickets) {
  if (currentBalls >= totalBalls || currentRuns >= target) {
    return currentRuns >= target 
      ? { battingTeam: 100, bowlingTeam: 0 } 
      : { battingTeam: 0, bowlingTeam: 100 };
  }

  const runsNeeded = target - currentRuns;
  const ballsRemaining = totalBalls - currentBalls;
  const requiredRate = ballsRemaining > 0 ? (runsNeeded / ballsRemaining) * 6 : 999;
  
  const wicketsInHand = 10 - wickets;
  
  const rateRatio = requiredRate / 8.0;
  const wicketFactor = Math.max(0.2, wicketsInHand / 10);
  
  let chaseProb = (1 / (1 + Math.exp(2 * (rateRatio - 1)))) * wicketFactor;
  chaseProb = Math.max(0.02, Math.min(0.98, chaseProb));
  
  return {
    battingTeam: Math.round(chaseProb * 100),
    bowlingTeam: Math.round((1 - chaseProb) * 100)
  };
}

export async function updateMatchAnalytics(match, inningIndex, delivery) {
  const matchId = match._id;
  let analytics = await MatchAnalytics.findOne({ matchId });
  
  if (!analytics) {
    analytics = new MatchAnalytics({ matchId });
  }
  
  const inning = match.innings[inningIndex];
  const totalBalls = match.totalOvers * 6;
  const currentBalls = inning.balls;
  const currentRuns = inning.runs;
  const wickets = inning.wickets;
  
  const isInning1 = inningIndex === 0;
  const isInning2 = inningIndex === 1 && match.innings.length > 1;
  
  if (isInning1 || (isInning2 && inning.target)) {
    const projection = computeProjectedScore(currentRuns, currentBalls, totalBalls, wickets);
    
    if (isInning1) {
      analytics.inning1ProjectedScore = projection.projected;
      analytics.inning1ProjectedRangeLow = projection.rangeLow;
      analytics.inning1ProjectedRangeHigh = projection.rangeHigh;
      
      analytics.inning1ProjectionHistory.push({
        over: Math.floor(currentBalls / 6),
        projectedScore: projection.projected
      });
    }
    
    if (isInning2 && inning.target) {
      const winProb = computeWinProbability(
        inning.target, 
        currentRuns, 
        currentBalls, 
        totalBalls, 
        wickets
      );
      
      analytics.inning2WinProbBattingTeam = winProb.battingTeam;
      analytics.inning2WinProbBowlingTeam = winProb.bowlingTeam;
      
      analytics.winProbHistory.push({
        over: Math.floor(currentBalls / 6),
        ball: currentBalls % 6,
        battingTeamProb: winProb.battingTeam,
        bowlingTeamProb: winProb.bowlingTeam,
        timestamp: new Date()
      });
    }
  }
  
  if (delivery) {
    const inningNum = inningIndex + 1;
    const isInning1Boundary = inningNum === 1;
    
    if (delivery.isFour) {
      if (isInning1Boundary) {
        analytics.totalFoursInning1 += 1;
        analytics.totalBoundariesInning1 += 1;
        analytics.boundaryRunsInning1 += 4;
      } else {
        analytics.totalFoursInning2 += 1;
        analytics.totalBoundariesInning2 += 1;
        analytics.boundaryRunsInning2 += 4;
      }
    }
    
    if (delivery.isSix) {
      if (isInning1Boundary) {
        analytics.totalSixesInning1 += 1;
        analytics.totalBoundariesInning1 += 1;
        analytics.boundaryRunsInning1 += 6;
      } else {
        analytics.totalSixesInning2 += 1;
        analytics.totalBoundariesInning2 += 1;
        analytics.boundaryRunsInning2 += 6;
      }
    }
  }
  
  analytics.updatedAt = new Date();
  await analytics.save();
  
  return analytics;
}

export async function getMatchAnalytics(matchId) {
  return await MatchAnalytics.findOne({ matchId });
}