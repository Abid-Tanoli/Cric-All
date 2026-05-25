import mongoose from "mongoose";

const tournamentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true
    },
    shortName: {
      type: String,
      trim: true
    },
    type: {
      type: String,
      enum: ["league", "knockout", "group-stage", "mixed"],
      default: "league"
    },
    startDate: {
      type: Date,
      required: true
    },
    endDate: {
      type: Date,
      required: true
    },
    teams: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team"
    }],
    matches: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Match"
    }],
    venue: {
      type: String,
      default: ""
    },
    slug: { type: String, default: "" },
    espnSeriesId: { type: String, default: "" },
    season: { type: String, default: "" },
    longName: { type: String, default: "" },
    status: {
      type: String,
      enum: ["upcoming", "live", "completed"],
      default: "upcoming"
    },
    pointsTable: [{
      team: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Team"
      },
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
    groups: [{
      name: String,
      teams: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "Team"
      }]
    }],
    knockoutStage: {
      quarterFinals: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "Match"
      }],
      semiFinals: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "Match"
      }],
      final: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Match"
      },
      thirdPlace: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Match"
      }
    },
    winner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team"
    },
    runnerUp: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team"
    },
    sponsors: [{
      name: String,
      logo: String
    }],
    logo: {
      type: String,
      default: ""
    },
    format: {
      type: String,
      enum: ["T20", "ODI", "Test", "T10", "6 Overs", "8 Overs"],
      default: "T20"
    },
    // Tournament/Series Squad: 11-20 players per team
    tournamentSquads: [{
      team: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Team"
      },
      players: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "Player"
      }],
      captain: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
      viceCaptain: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
      wicketKeepers: [{ type: mongoose.Schema.Types.ObjectId, ref: "Player" }]
    }]
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

tournamentSchema.index({ status: 1, startDate: -1 });
tournamentSchema.index({ teams: 1 });

const Tournament = mongoose.models.Tournament || mongoose.model("Tournament", tournamentSchema);

export default Tournament;