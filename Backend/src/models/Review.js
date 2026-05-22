import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema({
  matchId: { type: mongoose.Schema.Types.ObjectId, ref: "Match", required: true },
  inning: { type: Number, required: true },
  overBall: { type: String, required: true },
  requestedBy: { type: String, enum: ["batting_team", "bowling_team"], required: true },
  requestingTeam: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
  decisionChallenged: { type: String, enum: ["out", "not_out"], required: true },
  outcome: { type: String, enum: ["upheld", "overturned", "umpire_call"] },
  reviewsRemainingBatting: { type: Number, default: 2 },
  reviewsRemainingBowling: { type: Number, default: 2 },
  playerReviewed: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
  timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

reviewSchema.index({ matchId: 1, inning: 1 });

export default mongoose.models.Review || mongoose.model("Review", reviewSchema);