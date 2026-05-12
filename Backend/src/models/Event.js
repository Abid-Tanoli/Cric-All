import mongoose from "mongoose";

const eventSchema = new mongoose.Schema({
  // Event type: single match, series, tri-series, tournament, world cup, champions trophy
  eventType: {
    type: String,
    enum: ["single-match", "series", "tri-series", "tournament", "world-cup", "champions-trophy", "league"],
    required: true
  },
  name: { type: String, required: true, trim: true },
  shortName: { type: String, trim: true, default: "" },
  slug: { type: String, unique: true, sparse: true },
  description: { type: String, default: "" },
  logo: { type: String, default: "" },
  venue: { type: String, default: "" },
  format: {
    type: String,
    enum: ["T20", "ODI", "Test", "T10", "6 Overs", "8 Overs", "Tape Ball"],
    default: "T20"
  },
  totalMatches: { type: Number, default: 0 },
  oversPerInnings: { type: Number, default: 20 },
  startDate: { type: Date },
  endDate: { type: Date },
  status: {
    type: String,
    enum: ["upcoming", "live", "completed"],
    default: "upcoming"
  },
  // Deep categorization
  category: {
    type: String,
    enum: ["School", "College", "University", "Organization", "Business", "Industry", "Club", "International", "Other"],
    default: "Other"
  },
  subCategory: { type: String, default: "" }, // e.g., "Primary", "Secondary", "Pre-Medical", "Engineering", "CS"
  ageGroup: { 
    type: String, 
    enum: ["U-10", "U-13", "U-15", "U-17", "U-19", "Open"],
    default: "Open"
  },
  organization: { type: String, default: "" }, // Parent body like "Al-Khidmat", "Board of Education"
  
  // Detailed Address
  address: {
    town: { type: String, default: "" },
    district: { type: String, default: "" },
    city: { type: String, default: "" },
    province: { type: String, default: "" },
    country: { type: String, default: "Pakistan" }
  },
  // Teams participating in this event
  teams: [{ type: mongoose.Schema.Types.ObjectId, ref: "Team" }],
  // Matches within this event (for series/tournaments)
  matches: [{ type: mongoose.Schema.Types.ObjectId, ref: "Match" }],
  // Event-level squads (11-20 players per team, selected once for the whole event)
  eventSquads: [{
    team: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
    players: [{ type: mongoose.Schema.Types.ObjectId, ref: "Player" }],
    captain: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
    viceCaptain: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
    wicketKeepers: [{ type: mongoose.Schema.Types.ObjectId, ref: "Player" }],
    // Player replacement history for injuries, etc.
    playerChanges: [{
      outPlayer: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
      inPlayer: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
      reason: {
        type: String,
        enum: ["injury", "illness", "disciplinary", "personal", "other"],
        default: "injury"
      },
      notes: { type: String, default: "" },
      changedAt: { type: Date, default: Date.now }
    }]
  }],
  // Points table (for tournaments/leagues)
  pointsTable: [{
    team: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
    matchesPlayed: { type: Number, default: 0 },
    won: { type: Number, default: 0 },
    lost: { type: Number, default: 0 },
    tied: { type: Number, default: 0 },
    noResult: { type: Number, default: 0 },
    points: { type: Number, default: 0 },
    netRunRate: { type: Number, default: 0 },
    for: { type: Number, default: 0 },
    against: { type: Number, default: 0 },
    wicketsFor: { type: Number, default: 0 },
    wicketsAgainst: { type: Number, default: 0 },
    seriesForm: [{ type: String, enum: ["W", "L", "T", "NR"] }]
  }],
  // Groups (for tournaments with group stages)
  groups: [{
    name: String,
    teams: [{ type: mongoose.Schema.Types.ObjectId, ref: "Team" }]
  }],
  // Winner/Runner-up
  winner: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
  runnerUp: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
  // Sponsors
  sponsors: [{ name: String, logo: String }],
  // Media
  images: [{ url: String, caption: String, addedAt: Date }],
  videos: [{ url: String, title: String, addedAt: Date }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Auto-generate slug from name
eventSchema.pre('save', async function () {
  if (this.isNew && !this.slug && this.name) {
    const randomStr = Math.random().toString(36).substring(2, 8);
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') + '-' + randomStr;
  }
});

eventSchema.index({ eventType: 1, status: 1 });
eventSchema.index({ teams: 1 });

export default mongoose.model("Event", eventSchema);
