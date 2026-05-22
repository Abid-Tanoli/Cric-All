import mongoose from "mongoose";

const deliverySchema = new mongoose.Schema({
  matchId: { type: mongoose.Schema.Types.ObjectId, ref: "Match", required: true },
  inning: { type: Number, required: true },
  overNumber: { type: Number, required: true },
  ballNumber: { type: Number, required: true },
  rawBall: { type: Number, default: 0 },
  batsmanId: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
  bowlerId: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
  nonStrikerId: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
  runsOffBat: { type: Number, default: 0 },
  extras: { type: Number, default: 0 },
  extraType: { type: String, enum: ["wide", "no_ball", "bye", "leg_bye", "penalty", null] },
  isWicket: { type: Boolean, default: false },
  wicketType: { type: String, enum: ["bowled", "caught", "lbw", "run_out", "stumped", "hit_wicket", null] },
  fielderId: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
  shotType: { type: String, enum: ["drive", "pull", "cut", "sweep", "glance", "scoop", "defend", "mishit", "leave", null] },
  shotDirection: { type: Number, min: 0, max: 360 },
  shotDistance: { type: String, enum: ["infield", "outfield", "boundary", "six", null] },
  isFour: { type: Boolean, default: false },
  isSix: { type: Boolean, default: false },
  commentary: { type: String, default: "" },
  drsInvolved: { type: Boolean, default: false },
  drsResult: { type: String, enum: ["upheld", "overturned", null] },
  timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

deliverySchema.index({ matchId: 1, inning: 1, overNumber: 1, ballNumber: 1 });

export default mongoose.models.Delivery || mongoose.model("Delivery", deliverySchema);