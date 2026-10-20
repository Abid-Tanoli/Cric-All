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

// Unique per reporter+target - target is either post or comment.
//
// The partial filter must be an expression MongoDB accepts in a partial index:
// `$ne` is rejected at create time ("Expression not supported in partial index:
// $not c $eq null"), which failed the whole `init()` silently and left BOTH
// unique indexes missing — so duplicate reports were accepted and answered 201.
// `$type: "objectId"` is the same "field is set" intent in a supported form
// (the pattern Team.js already uses) and builds on the supported operator set.
communityReportSchema.index({ reporter: 1, post: 1 }, { unique: true, partialFilterExpression: { post: { $type: "objectId" } } });
communityReportSchema.index({ reporter: 1, comment: 1 }, { unique: true, partialFilterExpression: { comment: { $type: "objectId" } } });

export default mongoose.model("CommunityReport", communityReportSchema);
