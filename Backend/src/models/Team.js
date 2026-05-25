import mongoose from "mongoose";

const teamSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true
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
    espnTeamId: { type: String, default: "" }
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
teamSchema.index({ incubationGroup: 1 });
teamSchema.index({ "address.city": 1 });
teamSchema.index({ isActive: 1 });

export default mongoose.model("Team", teamSchema);