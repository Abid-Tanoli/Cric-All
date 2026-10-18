import mongoose from "mongoose";

const REASONS = [
  "spam",
  "abuse",
  "harassment",
  "hate",
  "nudity",
  "violence",
  "false",
  "copyright",
  "other",
];

const communityReportSchema = new mongoose.Schema(
  {
    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CommunityPost",
      default: null,
    },
    comment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CommunityComment",
      default: null,
    },
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    reason: {
      type: String,
      enum: REASONS,
      required: true,
    },
    note: {
      type: String,
      maxlength: 500,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

// Unique per reporter+target - target is either post or comment
communityReportSchema.index({ reporter: 1, post: 1 }, { unique: true, partialFilterExpression: { post: { $ne: null } } });
communityReportSchema.index({ reporter: 1, comment: 1 }, { unique: true, partialFilterExpression: { comment: { $ne: null } } });

export default mongoose.model("CommunityReport", communityReportSchema);
