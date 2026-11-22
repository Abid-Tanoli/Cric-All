import mongoose from "mongoose";
import { locationRefFields, locationRefIndexes } from "./locationRefs.js";
import { mapLegacyTypeToOrgType, ORG_TYPES } from "../services/organizationService.js";

// One additive subdocument for type-specific data. The per-type allow-list lives
// in organizationService; Mongoose drops unknown keys as a second line of defence.
const typeDetailsSchema = new mongoose.Schema({
  registrationNumber: { type: String, default: undefined },
  registrationAuthority: { type: String, default: undefined },
  affiliation: { type: String, default: undefined },
  foundedYear: { type: Number, default: undefined },
  institutionName: { type: String, default: undefined },
  educationLevel: { type: String, default: undefined },
  affiliationBoard: { type: String, default: undefined },
  affiliationUniversity: { type: String, default: undefined },
  department: { type: String, default: undefined },
  affiliationBody: { type: String, default: undefined },
  companyName: { type: String, default: undefined },
  industrySector: { type: String, default: undefined },
  foundationName: { type: String, default: undefined },
  focusArea: { type: String, default: undefined },
  typeNote: { type: String, default: undefined },
}, { _id: false });

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
  // Fixed enum for the new forms. Old clients omit it: on validation we derive
  // it from the legacy `type`, falling back to "other", so both fields are
  // always writable during the transition.
  orgType: {
    type: String,
    enum: ORG_TYPES,
    default: undefined,
    index: true,
  },
  typeDetails: {
    type: typeDetailsSchema,
    default: undefined,
  },
  // Internal marker used only by migrateOrgTypes --revert. It records that the
  // migration (not a user or an API client) set orgType on this document.
  orgTypeMigration: {
    type: mongoose.Schema.Types.Mixed,
    default: undefined,
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
  // Curated location tree. The free-text `location` block above is retained for
  // backward compatibility and as the legacy read-only hint in forms.
  ...locationRefFields(),
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
locationRefIndexes(teamOrganizationSchema);

// Legacy clients create organizations with only the free-form `type`. Derive a
// matching orgType on validation (defaulting to "other" when neither is set) so
// reads can prefer orgType without losing the meaning of an old write.
teamOrganizationSchema.pre("validate", function syncOrgTypeFromLegacyType() {
  if (!this.orgType) this.orgType = mapLegacyTypeToOrgType(this.type).orgType;
});

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
