import mongoose from "mongoose";

const playerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    role: { type: String },
    playingRole: {
      type: String,
      enum: ["Batsman", "Bowler", "All-Rounder", "Batting-All-Rounder", "Bowling-All-Rounder", "Wicket-Keeper"],
      default: "Batsman"
    },
    battingStyle: {
      type: String,
      enum: ["Right-handed", "Left-handed"],
      default: "Right-handed"
    },
    bowlingStyle: {
      type: String,
      enum: [
        "Right-arm Fast",
        "Right-arm Fast-Medium",
        "Right-arm Medium",
        "Right-arm Medium-Pace",
        "Right-arm Off-break",
        "Right-arm Leg-break",
        "Right-arm Slow",
        "Left-arm Fast",
        "Left-arm Fast-Medium",
        "Left-arm Medium",
        "Left-arm Medium-Pace",
        "Left-arm Orthodox",
        "Left-arm Chinaman",
        "Left-arm Slow",
        "Not Applicable"
      ],
      default: "Not Applicable"
    },
    campus: { type: String },
    // Deep categorization
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
    imageUrl: { type: String, default: "" },
    team: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
    birthInfo: {
      date: { type: Date },
      place: { type: String, default: "" }
    },
    age: { type: Number },
    relations: [{
      player: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
      relationType: { type: String } // e.g., "Father", "Brother", "Son", etc.
    }],
    teamHistory: [{
      team: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
      from: { type: Date },
      to: { type: Date },
      isCurrent: { type: Boolean, default: false }
    }],
    stats: {
      runs: { type: Number, default: 0 },
      wickets: { type: Number, default: 0 },
      strikeRate: { type: Number, default: 0 },
      economy: { type: Number, default: 0 },
      // Extended career stats
      matches: { type: Number, default: 0 },
      innings: { type: Number, default: 0 },
      notOuts: { type: Number, default: 0 },
      highScore: { type: Number, default: 0 },
      average: { type: Number, default: 0 },
      fifties: { type: Number, default: 0 },
      hundreds: { type: Number, default: 0 },
      bowlingAverage: { type: Number, default: 0 },
      bestBowling: { type: String, default: "0-0" },
      fourWickets: { type: Number, default: 0 },
      fiveWickets: { type: Number, default: 0 },
      dotBalls: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

export default mongoose.model("Player", playerSchema);
