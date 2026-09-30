import mongoose from "mongoose";
import { ORG_ROLES } from "../permissions/orgPermissions.js";
import crypto from "crypto";

export const INVITATION_TTL_MS = (Number(process.env.INVITATION_TTL_HOURS) || 14 * 24) * 60 * 60 * 1000;

export const generateInvitationToken = () => crypto.randomBytes(32).toString("hex");
export const hashInvitationToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

export const getInvitationExpiry = () => new Date(Date.now() + INVITATION_TTL_MS);

export const isInvitationExpired = (expires) => {
  const time = expires ? new Date(expires).getTime() : NaN;
  // Missing expiry counts as expired, same rule as email verification.
  return !Number.isFinite(time) || time < Date.now();
};

// An invitation carries the email it was sent to. The invitee account id is
// filled in when a user with that address already exists, but acceptance is
// always gated on "the signed-in, email-verified user owns this address".
const invitationSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TeamOrganization",
      required: true,
    },
    inviter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    invitee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    roles: {
      type: [{ type: String, enum: ORG_ROLES }],
      default: ["player"],
    },
    // Only the SHA-256 hash of the token is stored; the raw token exists once,
    // in the mail body.
    tokenHash: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "expired", "revoked"],
      default: "pending",
    },
    message: { type: String, default: "", maxlength: 500 },
    expiresAt: { type: Date, required: true },
    respondedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

invitationSchema.index({ tokenHash: 1 }, { unique: true });
invitationSchema.index({ organization: 1, status: 1 });
invitationSchema.index({ email: 1, status: 1 });
invitationSchema.index({ invitee: 1, status: 1 });

// One open invitation per person per organization. Re-inviting replaces the
// roles on the pending row instead of stacking duplicates in the inbox.
invitationSchema.index(
  { organization: 1, email: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } }
);

export default mongoose.model("Invitation", invitationSchema);
