import mongoose from "mongoose";

const teamRankingSchema = new mongoose.Schema({
  team: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Team",
    required: true,
    unique: true,
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "TeamCategory",
  },
  matchesPlayed: { type: Number, default: 0 },
  matchesWon: { type: Number, default: 0 },
  matchesLost: { type: Number, default: 0 },
  matchesDrawn: { type: Number, default: 0 },
  matchesNoResult: { type: Number, default: 0 },
  points: { type: Number, default: 0 },
  rating: { type: Number, default: 0 },
  overallRank: { type: Number },
  categoryRank: { type: Number },
  totalRunsScored: { type: Number, default: 0 },
  totalRunsConceded: { type: Number, default: 0 },
  totalWicketsTaken: { type: Number, default: 0 },
  netRunRate: { type: Number, default: 0 },
  form: { type: String, default: "" },
}, { timestamps: true });

teamRankingSchema.index({ overallRank: 1 });
teamRankingSchema.index({ categoryRank: 1, category: 1 });

export default mongoose.model("TeamRanking", teamRankingSchema);
