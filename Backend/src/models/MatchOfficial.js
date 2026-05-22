import mongoose from "mongoose";

const matchOfficialSchema = new mongoose.Schema({
  matchId: { type: mongoose.Schema.Types.ObjectId, ref: "Match", required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  role: { 
    type: String, 
    enum: ["umpire_on_field_1", "umpire_on_field_2", "third_umpire", "match_referee", "scorer"],
    required: true 
  },
  assignedAt: { type: Date, default: Date.now }
}, { timestamps: true });

matchOfficialSchema.index({ matchId: 1, role: 1 }, { unique: true });

export default mongoose.models.MatchOfficial || mongoose.model("MatchOfficial", matchOfficialSchema);