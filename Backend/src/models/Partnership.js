import mongoose from "mongoose";

const partnershipSchema = new mongoose.Schema({
  matchId: { type: mongoose.Schema.Types.ObjectId, ref: "Match", required: true },
  inning: { type: Number, required: true },
  wicketNumber: { type: Number, required: true },
  batsman1Id: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
  batsman2Id: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
  runs: { type: Number, default: 0 },
  balls: { type: Number, default: 0 },
  fours: { type: Number, default: 0 },
  sixes: { type: Number, default: 0 },
  startScore: { type: Number, default: 0 },
  endScore: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

partnershipSchema.index({ matchId: 1, inning: 1, wicketNumber: 1 });

export default mongoose.models.Partnership || mongoose.model("Partnership", partnershipSchema);