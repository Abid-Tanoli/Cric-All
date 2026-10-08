import mongoose from "mongoose";
import { ORG_ROLES } from "../permissions/orgPermissions.js";
import { normalizePhone } from "../utils/phone.js";
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

// An invitation carries the address it was sent to: an email, a phone number,
// or (rarely) both when the inviter supplied both for the same person. The
// invitee account id is filled in when a user with that address already
// exists, but acceptance is always gated on "the signed-in, VERIFIED user owns
// this address" — an unverified identifier is a claim, not proof.
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
    // Empty string means "addressed by phone only" — same convention as
    // User.phone, so the unique indexes can filter both out with $gt: "".
    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 254,
      default: "",
    },
    // Digits-only with country code, stored exactly like User.phone so the
    // match against a verified account is a plain string comparison.
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    roles: {
      type: [{ type: String, enum: ORG_ROLES }],
      default: ["player"],
    },
    // Only the SHA-256 hash of the token is stored; the raw token exists once,
    // in the message body (email or SMS).
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

// One address, normalized once, on every write path (controllers, tests,
// scripts). An invitation without any usable address is rejected here, so no
// writer can produce a row that is neither emailable nor textable.
invitationSchema.pre("validate", function normalizeAddressForStorage() {
  if (this.isModified("email") || this.isNew) {
    this.email = String(this.email || "").trim().toLowerCase();
  }
  if ((this.isModified("phone") || this.isNew) && this.phone) {
    this.phone = normalizePhone(String(this.phone)) || "";
  }
  if (!this.email && !this.phone) {
    this.invalidate("email", "An invitation needs an email address or a phone number", this.email);
  }
});

invitationSchema.index({ tokenHash: 1 }, { unique: true });
invitationSchema.index({ organization: 1, status: 1 });
invitationSchema.index({ email: 1, status: 1 });
invitationSchema.index({ phone: 1, status: 1 });
invitationSchema.index({ invitee: 1, status: 1 });

// One open invitation per address per organization. Re-inviting replaces the
// roles on the pending row instead of stacking duplicates in the inbox, and
// the two indexes cover the two addressing modes independently: phone-only
// invites have an empty email (and vice versa), which a plain unique index
// would treat as a collision between unrelated rows.
//
// Deployments created before phone addressing run with the old
// organization_1_email_1 partial index (no $gt:"" filter), which MongoDB
// cannot rewrite in place — utils/invitationIndexes.js performs that swap at
// startup, exactly like utils/identityIndexes.js does for User.
invitationSchema.index(
  { organization: 1, email: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "pending", email: { $type: "string", $gt: "" } },
  }
);
invitationSchema.index(
  { organization: 1, phone: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "pending", phone: { $type: "string", $gt: "" } },
  }
);

export default mongoose.model("Invitation", invitationSchema);
