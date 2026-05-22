import mongoose from "mongoose";

const matchAnalyticsSchema = new mongoose.Schema({
  matchId: { type: mongoose.Schema.Types.ObjectId, ref: "Match", required: true, unique: true },
  inning1ProjectedScore: { type: Number, default: 0 },
  inning1ProjectedRangeLow: { type: Number, default: 0 },
  inning1ProjectedRangeHigh: { type: Number, default: 0 },
  inning1ProjectionHistory: [{
    over: Number,
    projectedScore: Number
  }],
  inning2WinProbBattingTeam: { type: Number, default: 50 },
  inning2WinProbBowlingTeam: { type: Number, default: 50 },
  winProbHistory: [{
    over: Number,
    ball: Number,
    battingTeamProb: Number,
    bowlingTeamProb: Number,
    timestamp: { type: Date, default: Date.now }
  }],
  totalBoundariesInning1: { type: Number, default: 0 },
  totalFoursInning1: { type: Number, default: 0 },
  totalSixesInning1: { type: Number, default: 0 },
  boundaryRunsInning1: { type: Number, default: 0 },
  totalBoundariesInning2: { type: Number, default: 0 },
  totalFoursInning2: { type: Number, default: 0 },
  totalSixesInning2: { type: Number, default: 0 },
  boundaryRunsInning2: { type: Number, default: 0 },
  powerPlayRunsInning1: { type: Number, default: 0 },
  powerPlayWicketsInning1: { type: Number, default: 0 },
  powerPlayRunsInning2: { type: Number, default: 0 },
  powerPlayWicketsInning2: { type: Number, default: 0 },
  deathOverRunsInning1: { type: Number, default: 0 },
  deathOverWicketsInning1: { type: Number, default: 0 },
  deathOverRunsInning2: { type: Number, default: 0 },
  deathOverWicketsInning2: { type: Number, default: 0 },
  dotBallPercentInning1: { type: Number, default: 0 },
  dotBallPercentInning2: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

export default mongoose.models.MatchAnalytics || mongoose.model("MatchAnalytics", matchAnalyticsSchema);