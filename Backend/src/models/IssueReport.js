import mongoose from "mongoose";

const TARGET_TYPES = ["match", "event", "tournament", "series", "team", "other"];
const STATUSES = ["open", "in_review", "resolved", "rejected"];

const statusChangeSchema = new mongoose.Schema(
  {
    status: { type: String, enum: STATUSES, required: true },
    actor: { type: mongoose.Schema.Types.ObjectId, required: true },
    actorType: { type: String, enum: ["user", "admin"], required: true },
    note: { type: String, trim: true, maxlength: 500, default: "" },
    changedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const issueReportSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TeamOrganization",
      required: true,
    },
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: { type: String, enum: ["issue", "deletion_request"], required: true },
    subject: { type: String, trim: true, required: true, maxlength: 150 },
    description: { type: String, trim: true, required: true, maxlength: 5000 },
    targetType: { type: String, enum: TARGET_TYPES, default: null },
    targetId: { type: mongoose.Schema.Types.ObjectId, default: null },
    status: { type: String, enum: STATUSES, default: "open", index: true },
    adminReply: { type: String, trim: true, maxlength: 5000, default: "" },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    statusHistory: { type: [statusChangeSchema], default: [] },
  },
  { timestamps: true },
);

issueReportSchema.index({ organization: 1, status: 1, createdAt: -1 });

export default mongoose.model("IssueReport", issueReportSchema);
