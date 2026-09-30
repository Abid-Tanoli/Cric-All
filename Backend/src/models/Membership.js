import mongoose from "mongoose";
import { ORG_ROLES } from "../permissions/orgPermissions.js";

// One row per person per organization. `roles` is an array on purpose: a club
// manager is often also a coach, and a player is also a vice captain. The
// compound unique index makes "one membership per person per org" a database
// invariant rather than an application convention.
const membershipSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TeamOrganization",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    roles: {
      type: [{ type: String, enum: ORG_ROLES }],
      default: ["player"],
    },
    status: {
      type: String,
      enum: ["active", "removed"],
      default: "active",
      index: true,
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    joinedAt: { type: Date, default: Date.now },
    removedAt: { type: Date, default: null },
    // How this person joined, kept for the members list UI and the audit trail.
    source: {
      type: String,
      enum: ["signup", "invitation", "migration", "admin", "direct"],
      default: "direct",
    },
  },
  { timestamps: true }
);

membershipSchema.index({ organization: 1, user: 1 }, { unique: true });
membershipSchema.index({ user: 1, status: 1 });
membershipSchema.index({ organization: 1, status: 1, roles: 1 });

export default mongoose.model("Membership", membershipSchema);
