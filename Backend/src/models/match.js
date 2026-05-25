import mongoose from "mongoose";

const ballSchema = new mongoose.Schema({
  ballNumber: { type: Number, required: true },
  batsmanOnStrike: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
  batsmanNonStrike: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
  bowler: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
  runs: { type: Number, default: 0 },
  isWide: { type: Boolean, default: false },
  isNoBall: { type: Boolean, default: false },
  isBye: { type: Boolean, default: false },
  isLegBye: { type: Boolean, default: false },
  isWicket: { type: Boolean, default: false },
  wicketType: {
    type: String,
    enum: ["bowled", "caught", "lbw", "run out", "stumped", "hit wicket", ""]
  },
  dismissedPlayer: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
  fielder: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
  commentary: { type: String, default: "" },
  vividCommentary: { type: String, default: "" },
  runText: { type: String, default: "" },
  batsmanName: { type: String, default: "" },
  bowlerName: { type: String, default: "" },
  timestamp: { type: Date, default: Date.now },
  // Shot placement for wagon wheel
  shotPlacement: {
    angle: { type: Number, default: 0 }, // -180 to 180, 0 = straight
    distance: { type: Number, default: 50 }, // 0-100, distance from batsman
    position: { type: String, default: "" } // e.g., "cover", "mid-wicket"
  },
  // Fielding position where ball was fielded
  fieldingZone: { type: String, default: "" },
  shotType: { type: String, default: "" },
  pitchZone: { type: String, default: "" },
  ballMovement: { type: String, default: "none" },
  ballOutcome: { type: String, default: "played" },
  pitchLine: { type: String, default: "" },
  pitchLength: { type: String, default: "" },
  pitchShotType: { type: String, default: "" },
  pitchX: { type: Number, default: null },
  pitchY: { type: Number, default: null }
});

const overSchema = new mongoose.Schema({
  overNumber: { type: Number, required: true },
  bowler: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
  balls: [ballSchema],
  runsScored: { type: Number, default: 0 },
  wickets: { type: Number, default: 0 },
  maidenOver: { type: Boolean, default: false },
  summary: { type: String, default: "" }
});

const batsmanStatsSchema = new mongoose.Schema({
  player: { type: mongoose.Schema.Types.ObjectId, ref: "Player", required: true },
  runs: { type: Number, default: 0 },
  balls: { type: Number, default: 0 },
  fours: { type: Number, default: 0 },
  sixes: { type: Number, default: 0 },
  strikeRate: { type: Number, default: 0 },
  isOut: { type: Boolean, default: false },
  isRetiredHurt: { type: Boolean, default: false },
  isRetired: { type: Boolean, default: false },
  dismissalType: { type: String, default: "" },
  dismissedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
  fielder: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
  position: { type: Number, default: 0 },
  dotBalls: { type: Number, default: 0 },
  // Shot data for wagon wheel
  shots: [{
    runs: { type: Number, default: 0 },
    angle: { type: Number, default: 0 },
    distance: { type: Number, default: 50 },
    position: { type: String, default: "" },
    over: { type: Number, default: 0 },
    ball: { type: Number, default: 0 },
    bowler: { type: mongoose.Schema.Types.ObjectId, ref: "Player" }
  }]
});

const bowlerStatsSchema = new mongoose.Schema({
  player: { type: mongoose.Schema.Types.ObjectId, ref: "Player", required: true },
  overs: { type: Number, default: 0 },
  balls: { type: Number, default: 0 },
  maidens: { type: Number, default: 0 },
  runs: { type: Number, default: 0 },
  wickets: { type: Number, default: 0 },
  wides: { type: Number, default: 0 },
  noBalls: { type: Number, default: 0 },
  economy: { type: Number, default: 0 },
  dotBalls: { type: Number, default: 0 },
  foursScored: { type: Number, default: 0 },
  sixesScored: { type: Number, default: 0 }
});

const partnershipSchema = new mongoose.Schema({
  batsman1: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
  batsman2: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
  runs: { type: Number, default: 0 },
  balls: { type: Number, default: 0 },
  wicket: { type: Number }
});

const inningsSchema = new mongoose.Schema({
  team: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
  battingOrder: [{ type: mongoose.Schema.Types.ObjectId, ref: "Player" }],
  runs: { type: Number, default: 0 },
  wickets: { type: Number, default: 0 },
  overs: { type: Number, default: 0 },
  balls: { type: Number, default: 0 },
  extras: {
    wides: { type: Number, default: 0 },
    noBalls: { type: Number, default: 0 },
    byes: { type: Number, default: 0 },
    legByes: { type: Number, default: 0 },
    penalties: { type: Number, default: 0 },
    total: { type: Number, default: 0 }
  },
  currentBatsman1: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
  currentBatsman2: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
  onStrikeBatsman: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
  currentBowler: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
  status: {
    type: String,
    enum: ["upcoming", "live", "completed", "innings-break"],
    default: "upcoming"
  },
  oversHistory: [overSchema],
  batting: [batsmanStatsSchema],
  bowling: [bowlerStatsSchema],
  fallOfWickets: [{
    runs: { type: Number },
    wickets: { type: Number },
    player: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
    overs: { type: Number }
  }],
  partnerships: [partnershipSchema],
  runRate: { type: Number, default: 0 },
  requiredRunRate: { type: Number, default: 0 },
  target: { type: Number, default: 0 },
  powerplayOvers: { type: Number, default: 0 },
  powerplayConfig: {
    enabled: { type: Boolean, default: false },
    overs: { type: Number, default: 0, min: 0 }
  },
  declared: { type: Boolean, default: false }
});

const matchSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true
    },
    matchNumber: {
      type: Number
    },
    venue: {
      type: String,
      default: ""
    },
    matchType: {
      type: String,
      enum: ["6 Overs", "8 Overs", "T10", "T20", "ODI", "Test", "Tape Ball"],
      default: "T20"
    },
    matchCategory: {
      type: String,
      enum: [
        "School",
        "College",
        "University",
        "Organization",
        "Business",
        "Industry",
        "Club",
        "International",
        "Other"
      ],
      default: "Other"
    },
    category: {
      type: String,
      enum: ["School", "College", "University", "Organization", "Business", "Industry", "Club", "International", "Other"],
      default: "Other"
    },
    subCategory: {
      type: String,
      default: ""
    },
    ageGroup: {
      type: String,
      enum: ["U-10", "U-13", "U-15", "U-17", "U-19", "Open"],
      default: "Open"
    },
    organization: {
      type: String,
      default: ""
    },
    address: {
      town: String,
      district: String,
      city: String,
      province: String,
      country: { type: String, default: "Pakistan" }
    },
    tournament: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament"
    },
    totalOvers: {
      type: Number,
      default: 20
    },
    startAt: {
      type: Date
    },
    teams: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      required: true
    }],
    innings: [inningsSchema],
    currentInnings: {
      type: Number,
      default: 0
    },
    status: {
      type: String,
      enum: ["upcoming", "live", "innings-break", "completed", "abandoned", "pending_tie_resolution", "super_over"],
      default: "upcoming"
    },
    result: {
      winner: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
      margin: { type: String },
      description: { type: String },
      resultType: {
        type: String,
        enum: ["normal", "tie", "draw", "no result", "abandoned", "super_over"]
      }
    },
    tieResolution: {
      type: String,
      enum: ["pending", "declared_tie", "super_over"],
      default: null
    },
    tossWinner: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
    tossDecision: { type: String, enum: ["bat", "bowl"] },
    manOfMatch: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
    umpires: [{
      name: String,
      role: { type: String, enum: ["field", "third", "reserve"] }
    }],
    highlights: [{
      type: { type: String },
      description: { type: String },
      over: { type: Number },
      timestamp: { type: Date, default: Date.now }
    }],
    weather: {
      condition: String,
      temperature: Number
    },
    playingXI: [{
      team: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
      players: [{ type: mongoose.Schema.Types.ObjectId, ref: "Player" }]
    }],
    squad15: [{
      team: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
      players: [{ type: mongoose.Schema.Types.ObjectId, ref: "Player" }],
      captain: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
      viceCaptain: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
      wicketKeepers: [{ type: mongoose.Schema.Types.ObjectId, ref: "Player" }]
    }],
    twelfthMan: [{
      team: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
      player: { type: mongoose.Schema.Types.ObjectId, ref: "Player" }
    }],
    bowlingXI: [{
      team: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
      players: [{ type: mongoose.Schema.Types.ObjectId, ref: "Player" }]
    }],
    teamRoles: [{
      team: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
      captain: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
      viceCaptain: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
      wicketKeepers: [{ type: mongoose.Schema.Types.ObjectId, ref: "Player" }]
    }],
    series: {
      type: String,
      default: "",
      trim: true
    },
    espnMatchId: { type: String, default: "" },
    slug: { type: String, default: "" },
    resultText: { type: String, default: "" },
    statusText: { type: String, default: "" },
    commentary: { type: mongoose.Schema.Types.Mixed },
    seriesMatchNumber: {
      type: Number,
      default: null
    },
    seriesStanding: {
      matchesPlayed: { type: Number, default: 0 },
      position: { type: Number }
    },
    winProbabilityHistory: [{
      ball: { type: Number },
      over: { type: Number },
      team1: { type: Number }, // percentage
      team2: { type: Number }, // percentage
      timestamp: { type: Date, default: Date.now }
    }],
    drsReviews: [{
      team: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
      over: { type: Number },
      ball: { type: Number },
      requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
      result: { type: String, enum: ["upheld", "overturned", "umpire_call"] },
      type: { type: String, enum: ["lbw", "caught", "other"] },
      timestamp: { type: Date, default: Date.now }
    }],
    timeouts: [{
      team: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
      over: { type: Number },
      type: { type: String, default: "strategic" },
      timestamp: { type: Date, default: Date.now }
    }],
    superOvers: [{
      superOverNumber: { type: Number, required: true },
      battingFirst: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
      battingSecond: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
      innings: [inningsSchema],
      result: {
        winner: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
        margin: { type: String }
      },
      bowlers: [{
        team: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
        bowler: { type: mongoose.Schema.Types.ObjectId, ref: "Player" }
      }],
      batsmen: [{
        team: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
        players: [{ type: mongoose.Schema.Types.ObjectId, ref: "Player" }]
      }]
    }]
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

matchSchema.index({ status: 1, startAt: -1 });
matchSchema.index({ teams: 1 });
matchSchema.index({ tournament: 1 });

matchSchema.pre('save', function () {
  if (this.isModified('matchType')) {
    switch (this.matchType) {
      case '6 Overs': this.totalOvers = 6; break;
      case '8 Overs': this.totalOvers = 8; break;
      case 'T10': this.totalOvers = 10; break;
      case 'T20': this.totalOvers = 20; break;
      case 'ODI': this.totalOvers = 50; break;
      case 'Test': this.totalOvers = 90; break;
      case 'Tape Ball': this.totalOvers = 8; break;
      default: this.totalOvers = 20;
    }
  }
});

const Match = mongoose.models.Match || mongoose.model("Match", matchSchema);

export default Match;
