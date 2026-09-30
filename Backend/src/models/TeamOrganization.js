import mongoose from "mongoose";

const teamOrganizationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  // Public, unique handle used for /organizations/:slug routes. Generated from
  // the name on create; sparse-unique so pre-Phase-3 rows without a slug do
  // not collide while migrateOrganizationSlugs backfills them.
  slug: {
    type: String,
    trim: true,
    lowercase: true,
    default: undefined,
    index: { unique: true, sparse: true },
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "TeamCategory",
  },
  // Free-form type drawn from the TeamCategory configuration collection
  // (cricket club, academy, school, …) rather than a hardcoded enum, so the
  // platform can add a category without a code change. Defaults to "other".
  type: {
    type: String,
    trim: true,
    lowercase: true,
    default: "other",
  },
  shortName: {
    type: String,
    default: "",
  },
  logoUrl: {
    type: String,
    default: "",
  },
  coverUrl: {
    type: String,
    default: "",
  },
  description: {
    type: String,
    default: "",
  },
  website: {
    type: String,
    default: "",
  },
  foundedYear: {
    type: Number,
    default: null,
  },
  location: {
    city: { type: String, default: "" },
    area: { type: String, default: "" },
    address: { type: String, default: "" },
    country: { type: String, default: "" },
  },
  contact: {
    phone: { type: String, default: "" },
    email: { type: String, default: "", trim: true, lowercase: true },
  },
  // Flexible map so a new network does not need a schema migration. Keys are
  // lowercase platform names; values are absolute URLs.
  socialLinks: {
    type: Map,
    of: String,
    default: () => new Map(),
  },
  privacy: {
    contactInfo: { type: String, enum: ["public", "hidden"], default: "public" },
    socialLinks: { type: String, enum: ["public", "hidden"], default: "public" },
    location: { type: String, enum: ["public", "hidden"], default: "public" },
  },
  // "unverified" | "pending" | "verified" | "rejected". `requireOrgApproval`
  // (a platform setting) decides whether a new org starts at "pending".
  verificationStatus: {
    type: String,
    enum: ["unverified", "pending", "verified", "rejected"],
    default: "unverified",
  },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
  verifiedAt: { type: Date, default: null },
  verificationNote: { type: String, default: "" },
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "TeamOrganization",
    default: null,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  // Self-management (Phase 2): the account that created/owns this org.
  // Ownerless orgs (created by the platform Admin app before Phase 2) stay
  // supervisory-only until an owner is assigned via setOrgOwner.js.
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  // DEPRECATED (Phase 2): the authoritative people/roles now live in the
  // Membership collection. Kept only so older reads do not crash while
  // migrateOrgMemberships backfills; new code must use Membership.
  members: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["admin", "member"], default: "member" },
    joinedAt: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

teamOrganizationSchema.virtual('children', {
  ref: 'TeamOrganization',
  localField: '_id',
  foreignField: 'parent',
});

// Stable ordering for the organization switcher and public listings.
teamOrganizationSchema.index({ name: 1 });
teamOrganizationSchema.index({ category: 1 });
teamOrganizationSchema.index({ type: 1 });
teamOrganizationSchema.index({ parent: 1 });
teamOrganizationSchema.index({ owner: 1 });
teamOrganizationSchema.index({ verificationStatus: 1 });
teamOrganizationSchema.index({ "members.user": 1 });

// Normalize the free-form social map to lowercase platform keys.
teamOrganizationSchema.pre("validate", function normalizeSocialLinks() {
  const source =
    this.socialLinks instanceof Map
      ? [...this.socialLinks.entries()]
      : Object.entries(this.socialLinks || {});

  const normalized = new Map();
  for (const [key, value] of source) {
    if (value === null || value === undefined) continue;
    const trimmedKey = String(key).trim().toLowerCase();
    const trimmedValue = String(value).trim();
    if (trimmedKey && trimmedValue) normalized.set(trimmedKey, trimmedValue);
  }
  this.socialLinks = normalized;
});

export default mongoose.model("TeamOrganization", teamOrganizationSchema);
