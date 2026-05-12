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
      enum: ["international_team", "league_team", "incubation_team"],
      default: "league_team"
    },
    category: {
      type: String,
      enum: ["School", "College", "University", "Organization", "Business", "Industry", "Club", "International", "Other"],
      default: "Other"
    },
    subCategory: { type: String, default: "" },
    ageGroup: { 
      type: String, 
      enum: ["U-10", "U-13", "U-15", "U-17", "U-19", "Open"],
      default: "Open"
    },
    organization: { type: String, default: "" },
    
    // Detailed Address
    address: {
      town: { type: String, default: "" },
      district: { type: String, default: "" },
      city: { type: String, default: "" },
      province: { type: String, default: "" },
      country: { type: String, default: "Pakistan" }
    },
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
    // Additional metadata for incubation teams
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
    }]
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Virtual field to dynamically fetch players assigned to this team
teamSchema.virtual('playerList', {
  ref: 'Player',
  localField: '_id',
  foreignField: 'team'
});

// Index for efficient category queries
teamSchema.index({ type: 1 });
teamSchema.index({ category: 1 });
teamSchema.index({ incubationGroup: 1 });

export default mongoose.model("Team", teamSchema);