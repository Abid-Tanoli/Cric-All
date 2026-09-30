import mongoose from "mongoose";

// Append-only trail for anything that changes who can do what, plus the
// supervisory events the platform Admin performs. Org owners read their own
// organization's entries; platform admins read all of them.
const auditLogSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TeamOrganization",
      default: null,
    },
    // "user" for a User account, "admin" for a platform Admin document,
    // "system" for migrations and scheduled jobs.
    actorType: {
      type: String,
      enum: ["user", "admin", "system"],
      required: true,
    },
    actor: { type: mongoose.Schema.Types.ObjectId, default: null },
    // Denormalized so a deleted or renamed account does not erase the trail.
    actorLabel: { type: String, default: "" },
    action: { type: String, required: true, maxlength: 80 },
    targetType: { type: String, default: "", maxlength: 40 },
    targetId: { type: String, default: "", maxlength: 64 },
    targetLabel: { type: String, default: "", maxlength: 200 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ organization: 1, createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

export default mongoose.model("AuditLog", auditLogSchema);
