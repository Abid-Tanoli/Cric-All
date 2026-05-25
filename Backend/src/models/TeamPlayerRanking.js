import mongoose from "mongoose";

const teamPlayerRankingSchema = new mongoose.Schema({
  team: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Team",
    required: true,
  },
  player: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Player",
    required: true,
  },
  teamBattingRank: { type: Number },
  teamRuns: { type: Number, default: 0 },
  teamBattingAvg: { type: Number, default: 0 },
  teamBattingSr: { type: Number, default: 0 },
  teamHighestScore: { type: Number, default: 0 },
  teamFifties: { type: Number, default: 0 },
  teamHundreds: { type: Number, default: 0 },
  teamBowlingRank: { type: Number },
  teamWickets: { type: Number, default: 0 },
  teamBowlingAvg: { type: Number, default: 0 },
  teamEconomy: { type: Number, default: 0 },
  teamBestBowling: { type: String, default: "" },
  teamMatches: { type: Number, default: 0 },
  teamPlayerRating: { type: Number, default: 0 },
}, { timestamps: true });

teamPlayerRankingSchema.index({ team: 1, player: 1 }, { unique: true });
teamPlayerRankingSchema.index({ team: 1, teamBattingRank: 1 });
teamPlayerRankingSchema.index({ team: 1, teamBowlingRank: 1 });

export default mongoose.model("TeamPlayerRanking", teamPlayerRankingSchema);
