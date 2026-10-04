import mongoose from "mongoose";

const teamSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ["team", "international_team", "league_team", "incubation_team", "local_team"],
      default: "local_team"
    },
    category: {
      type: String,
      enum: ["School", "College", "University", "Organization", "Business", "Industry", "Club", "Corporate", "Academy", "International", "Other"],
      default: "Other"
    },
    categoryRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TeamCategory",
    },
    subCategory: { type: String, default: "" },
    // Free-text profile blurb. Additive in Phase 4 so organization-owned teams
    // can introduce themselves without reusing `fullAddress`.
    description: { type: String, default: "", trim: true },
    ageGroup: { 
      type: String, 
      enum: ["U-10", "U-13", "U-15", "U-17", "U-19", "Open"],
      default: "Open"
    },
    organization: { type: String, default: "" },
    organizationRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TeamOrganization",
    },
    branchName: { type: String, default: "" },

    // Detailed Address
    address: {
      town: { type: String, default: "" },
      district: { type: String, default: "" },
      city: { type: String, default: "" },
      province: { type: String, default: "" },
      country: { type: String, default: "Pakistan" }
    },
    fullAddress: { type: String, default: "" },
    area: { type: String, default: "" },
    latitude: { type: Number },
    longitude: { type: Number },
    googleMapsUrl: { type: String, default: "" },
    placeId: { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    website: { type: String, default: "" },
    establishedYear: { type: Number },
    homeGround: { type: String, default: "" },
    teamColorPrimary: { type: String, default: "#00a650" },
    teamColorSecondary: { type: String, default: "#003087" },
    isActive: { type: Boolean, default: true },
    profileComplete: { type: Boolean, default: false },

    ownername: {
      type: String,
      trim: true,
      default: ""
    },
    // User (accountType handler / organization_admin) this team is managed by.
    // Set when an admin approves a HandlerRequest.
    managedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    logo: {
      type: String,
      default: ""
    },
    shortName: {
      type: String,
      trim: true,
      default: ""
    },
    media: [
      {
        url: String,
        caption: String,
        addedAt: Date
      }
    ],
    videos: [
      {
        url: String,
        title: String,
        addedAt: Date
      }
    ],
    socialLinks: {
      facebook: { type: String, default: "" },
      instagram: { type: String, default: "" },
      twitter: { type: String, default: "" },
      youtube: { type: String, default: "" },
      whatsapp: { type: String, default: "" }
    },
    privacy: {
      contactInfo: { type: String, enum: ["public", "hidden"], default: "public" },
      socialLinks: { type: String, enum: ["public", "hidden"], default: "public" },
      location: { type: String, enum: ["public", "hidden"], default: "public" }
    },
    // `isPublic` controls whether an organization-owned team appears in the
    // cross-tenant public catalogue. New teams are public by default; owners
    // with manage_teams and platform admins can toggle visibility.
    isPublic: { type: Boolean, default: true },
    players: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player"
    }],
    incubationGroup: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "IncubationGroup"
    },
    isInternal: {
      type: Boolean,
      default: false
    },
    tags: [{
      type: String
    }],
    longName: { type: String, default: "" },
    isCountry: { type: Boolean, default: false },
    espnTeamId: { type: String, default: "" },
    isSeed: { type: Boolean, default: false },
    seedSource: { type: String, default: "" },
    seedVersion: { type: String, default: "" }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

teamSchema.virtual('playerList', {
  ref: 'Player',
  localField: '_id',
  foreignField: 'team'
});

teamSchema.virtual('categoryData', {
  ref: 'TeamCategory',
  localField: 'categoryRef',
  foreignField: '_id',
  justOne: true,
});

teamSchema.virtual('organizationData', {
  ref: 'TeamOrganization',
  localField: 'organizationRef',
  foreignField: '_id',
  justOne: true,
});

teamSchema.index({ type: 1 });
teamSchema.index({ category: 1 });
teamSchema.index({ categoryRef: 1 });
teamSchema.index({ organizationRef: 1 });

// Round 5 (Phase 4): team names are unique *per organization*, not globally.
// The old `unique: true` on `name` meant two unrelated organizations could not
// both own a "Rising Stars". Two partial unique indexes replace it:
//
//   * organization-owned teams collide on (organizationRef, name);
//   * org-less platform teams keep a global uniqueness on name, because there is
//     no organization to scope them to.
//
// `collation: { locale: "en", strength: 2 }` makes both case- and
// accent-insensitive, so "Strikers" and "strikers" are the same name.
//
// The partial filter matches on the BSON type Mongoose actually stores.
// `organizationRef` is declared `Schema.Types.ObjectId`, so a saved reference is
// a BSON ObjectId and nothing else. A filter of `{ $type: "string" }` looks
// plausible but matches *zero* documents, which silently turns this into a
// no-op index and leaves per-organization uniqueness to the application check
// alone - so the type here is load-bearing, not cosmetic.
//
// The org-less index below filters on `{ organizationRef: null }`, which in a
// partial filter matches both an explicit null and an absent field; between them
// the two indexes cover every team. Legacy documents that stored the reference as
// a string are reported by the migrateTeamNameUniqueness script before anything
// is applied.
teamSchema.index(
  { organizationRef: 1, name: 1 },
  {
    unique: true,
    collation: { locale: "en", strength: 2 },
    partialFilterExpression: { organizationRef: { $type: "objectId" } },
    name: "organizationRef_1_name_1_unique",
  },
);
teamSchema.index(
  { name: 1 },
  {
    unique: true,
    collation: { locale: "en", strength: 2 },
    // `{ field: null }` in a partial filter also matches documents where the
    // field is absent, which is every org-less team written before
    // organizationRef existed.
    partialFilterExpression: { organizationRef: null },
    name: "name_1_orgless_unique",
  },
);

teamSchema.index({ isPublic: 1 });
teamSchema.index({ incubationGroup: 1 });
teamSchema.index({ shortName: 1 });
teamSchema.index({ organization: 1 });
teamSchema.index({ "address.town": 1 });
teamSchema.index({ "address.district": 1 });
teamSchema.index({ "address.city": 1 });
teamSchema.index({ "address.country": 1 });
teamSchema.index({ isActive: 1 });
teamSchema.index({ managedBy: 1 });

export default mongoose.model("Team", teamSchema);
