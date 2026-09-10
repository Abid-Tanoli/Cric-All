import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import Team from "../models/Team.js";
import Player from "../models/Player.js";
import Match from "../models/Match.js";
import Ball from "../models/Ball.js";
import Commentary from "../models/Commentary.js";
import { assertMongoDatabaseName, getMongoTarget } from "../utils/mongoTarget.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const SEED_TAG = "cric-all:initial-seed";
const SEED_ORGANIZATION = "Cric-All Starter Seed";
const SEED_SERIES = "Cric-All Starter Matches";
const SEED_SOURCE = "seedInitialData";
const SEED_VERSION = "initial-2026-06";
const SHOULD_RESET = process.argv.includes("--reset");

const sharedAddress = {
  town: "Central",
  district: "Karachi",
  city: "Karachi",
  province: "Sindh",
  country: "Pakistan",
};

const seedTeams = [
  {
    name: "BQ Falcons",
    shortName: "BQF",
    homeGround: "BQ Cricket Ground",
    teamColorPrimary: "#006d77",
    teamColorSecondary: "#ffd166",
  },
  {
    name: "BQ Titans",
    shortName: "BQT",
    homeGround: "BQ Sports Complex",
    teamColorPrimary: "#1d3557",
    teamColorSecondary: "#e63946",
  },
  {
    name: "BQ Strikers",
    shortName: "BQS",
    homeGround: "BQ Academy Ground",
    teamColorPrimary: "#2a9d8f",
    teamColorSecondary: "#264653",
  },
  {
    name: "BQ Royals",
    shortName: "BQR",
    homeGround: "BQ Club Ground",
    teamColorPrimary: "#5a189a",
    teamColorSecondary: "#fca311",
  },
];

const rosterTemplate = [
  { label: "Captain", role: "Batsman", playingRole: "Batsman", battingStyle: "Right-handed", bowlingStyle: "Not Applicable" },
  { label: "Wicket Keeper", role: "Wicket-Keeper", playingRole: "Wicket-Keeper", battingStyle: "Right-handed", bowlingStyle: "Not Applicable" },
  { label: "Opener", role: "Batsman", playingRole: "Batsman", battingStyle: "Left-handed", bowlingStyle: "Not Applicable" },
  { label: "Top Order", role: "Batsman", playingRole: "Batsman", battingStyle: "Right-handed", bowlingStyle: "Right-arm Off-break" },
  { label: "All Rounder", role: "All-Rounder", playingRole: "All-Rounder", battingStyle: "Right-handed", bowlingStyle: "Right-arm Medium" },
  { label: "Batting All Rounder", role: "Batting-All-Rounder", playingRole: "Batting-All-Rounder", battingStyle: "Left-handed", bowlingStyle: "Left-arm Orthodox" },
  { label: "Bowling All Rounder", role: "Bowling-All-Rounder", playingRole: "Bowling-All-Rounder", battingStyle: "Right-handed", bowlingStyle: "Right-arm Fast-Medium" },
  { label: "Fast Bowler", role: "Bowler", playingRole: "Bowler", battingStyle: "Right-handed", bowlingStyle: "Right-arm Fast" },
  { label: "Medium Pacer", role: "Bowler", playingRole: "Bowler", battingStyle: "Right-handed", bowlingStyle: "Right-arm Medium-Pace" },
  { label: "Spinner", role: "Bowler", playingRole: "Bowler", battingStyle: "Left-handed", bowlingStyle: "Left-arm Orthodox" },
  { label: "Finisher", role: "All-Rounder", playingRole: "All-Rounder", battingStyle: "Right-handed", bowlingStyle: "Right-arm Leg-break" },
];

const seedMatches = [
  {
    title: "BQ Falcons vs BQ Titans",
    slug: "cric-all-initial-seed-falcons-vs-titans",
    teamNames: ["BQ Falcons", "BQ Titans"],
    venue: "BQ Cricket Ground",
    daysFromNow: 1,
    seriesMatchNumber: 1,
  },
  {
    title: "BQ Strikers vs BQ Royals",
    slug: "cric-all-initial-seed-strikers-vs-royals",
    teamNames: ["BQ Strikers", "BQ Royals"],
    venue: "BQ Academy Ground",
    daysFromNow: 2,
    seriesMatchNumber: 2,
  },
];

function buildPlayerSpecs(teamName) {
  const prefix = teamName.replace(/^BQ\s+/, "");
  return rosterTemplate.map((slot, index) => ({
    ...slot,
    name: `${prefix} ${slot.label}`,
    battingOrder: index + 1,
  }));
}

function isSeedManagedTeam(team) {
  return team?.organization === SEED_ORGANIZATION || team?.tags?.includes(SEED_TAG);
}

function buildTeamDocument(team) {
  return {
    ...team,
    type: "local_team",
    category: "Club",
    subCategory: "Starter",
    ageGroup: "Open",
    organization: SEED_ORGANIZATION,
    address: sharedAddress,
    fullAddress: "Karachi, Sindh, Pakistan",
    area: "Central",
    isActive: true,
    profileComplete: true,
    tags: [SEED_TAG, "starter-data"],
    isSeed: true,
    seedSource: SEED_SOURCE,
    seedVersion: SEED_VERSION,
  };
}

function buildPlayerDocument(player, teamId) {
  return {
    name: player.name,
    role: player.role,
    playingRole: player.playingRole,
    battingStyle: player.battingStyle,
    bowlingStyle: player.bowlingStyle,
    team: teamId,
    campus: "Starter roster",
    category: "Club",
    subCategory: "Starter",
    ageGroup: "Open",
    organization: SEED_ORGANIZATION,
    address: sharedAddress,
    isSeed: true,
    seedSource: SEED_SOURCE,
    seedVersion: SEED_VERSION,
    teamHistory: [
      {
        team: teamId,
        from: new Date(),
        isCurrent: true,
      },
    ],
  };
}

function buildInnings(teamId, players) {
  return {
    team: teamId,
    battingOrder: players.map((player) => player._id),
    runs: 0,
    wickets: 0,
    overs: 0,
    balls: 0,
    extras: {
      wides: 0,
      noBalls: 0,
      byes: 0,
      legByes: 0,
      penalties: 0,
      total: 0,
    },
    status: "upcoming",
    batting: [],
    bowling: [],
    oversHistory: [],
    fallOfWickets: [],
    partnerships: [],
    runRate: 0,
    requiredRunRate: 0,
    target: 0,
    powerplayConfig: {
      enabled: true,
      overs: 6,
    },
  };
}

function buildMatchDocument(matchSpec, teamDocs, playersByTeamName) {
  const [teamOne, teamTwo] = teamDocs;
  const teamOnePlayers = playersByTeamName.get(teamOne.name) || [];
  const teamTwoPlayers = playersByTeamName.get(teamTwo.name) || [];
  const startAt = new Date(Date.now() + matchSpec.daysFromNow * 24 * 60 * 60 * 1000);

  return {
    title: matchSpec.title,
    venue: matchSpec.venue,
    matchType: "T20",
    matchCategory: "Club",
    category: "Club",
    subCategory: "Starter",
    ageGroup: "Open",
    organization: SEED_ORGANIZATION,
    address: sharedAddress,
    totalOvers: 20,
    startAt,
    teams: [teamOne._id, teamTwo._id],
    innings: [
      buildInnings(teamOne._id, teamOnePlayers),
      buildInnings(teamTwo._id, teamTwoPlayers),
    ],
    currentInnings: 0,
    status: "upcoming",
    playingXI: [
      { team: teamOne._id, players: teamOnePlayers.map((player) => player._id) },
      { team: teamTwo._id, players: teamTwoPlayers.map((player) => player._id) },
    ],
    squad15: [
      {
        team: teamOne._id,
        players: teamOnePlayers.map((player) => player._id),
        captain: teamOnePlayers[0]?._id,
        viceCaptain: teamOnePlayers[4]?._id,
        wicketKeepers: teamOnePlayers[1]?._id ? [teamOnePlayers[1]._id] : [],
      },
      {
        team: teamTwo._id,
        players: teamTwoPlayers.map((player) => player._id),
        captain: teamTwoPlayers[0]?._id,
        viceCaptain: teamTwoPlayers[4]?._id,
        wicketKeepers: teamTwoPlayers[1]?._id ? [teamTwoPlayers[1]._id] : [],
      },
    ],
    teamRoles: [
      {
        team: teamOne._id,
        captain: teamOnePlayers[0]?._id,
        viceCaptain: teamOnePlayers[4]?._id,
        wicketKeepers: teamOnePlayers[1]?._id ? [teamOnePlayers[1]._id] : [],
      },
      {
        team: teamTwo._id,
        captain: teamTwoPlayers[0]?._id,
        viceCaptain: teamTwoPlayers[4]?._id,
        wicketKeepers: teamTwoPlayers[1]?._id ? [teamTwoPlayers[1]._id] : [],
      },
    ],
    series: SEED_SERIES,
    seriesMatchNumber: matchSpec.seriesMatchNumber,
    slug: matchSpec.slug,
    statusText: "Upcoming",
    isSeed: true,
    seedSource: SEED_SOURCE,
    seedVersion: SEED_VERSION,
    powerplayConfig: {
      enabled: true,
      overs: 6,
      type: "standard",
      battingPowerplayOvers: 0,
      fieldersOutsideCircle: 2,
    },
  };
}

async function connectToDatabase() {
  const mongoUrl = process.env.MONGO_URL || process.env.MONGO_URI;
  if (!mongoUrl) {
    throw new Error("MONGO_URL or MONGO_URI is required before running the seed script.");
  }

  const target = getMongoTarget(mongoUrl);
  if (!target.databaseName) {
    throw new Error("Mongo URL must include an explicit database name before running the seed script.");
  }
  assertMongoDatabaseName(mongoUrl);

  await mongoose.connect(mongoUrl, {
    serverSelectionTimeoutMS: 60000,
    connectTimeoutMS: 60000,
    socketTimeoutMS: 120000,
    heartbeatFrequencyMS: 15000,
    maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || 20),
    minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE || 1),
  });

  console.log(`Target database: ${target.host}/${target.databaseName}`);
}

function assertResetAllowed() {
  if (!SHOULD_RESET) return;

  if (process.env.NODE_ENV === "production") {
    throw new Error("--reset is refused when NODE_ENV=production.");
  }

  if (process.env.ALLOW_DB_RESET !== "true") {
    throw new Error("--reset requires ALLOW_DB_RESET=true. Export a database snapshot before resetting starter seed data.");
  }
}

async function resetSeedData() {
  const seedMatchSlugs = seedMatches.map((match) => match.slug);
  const seedPlayerNames = seedTeams.flatMap((team) => buildPlayerSpecs(team.name).map((player) => player.name));
  const seedTeamNames = seedTeams.map((team) => team.name);

  const matches = await Match.find({
    $or: [
      { isSeed: true, seedSource: SEED_SOURCE },
      { slug: { $in: seedMatchSlugs }, organization: SEED_ORGANIZATION },
      { series: SEED_SERIES, organization: SEED_ORGANIZATION },
    ],
  }).select("_id");
  const matchIds = matches.map((match) => match._id);

  const [ballsResult, commentaryResult, matchesResult] = await Promise.all([
    matchIds.length ? Ball.deleteMany({ matchId: { $in: matchIds } }) : { deletedCount: 0 },
    matchIds.length ? Commentary.deleteMany({ match: { $in: matchIds } }) : { deletedCount: 0 },
    matchIds.length ? Match.deleteMany({ _id: { $in: matchIds } }) : { deletedCount: 0 },
  ]);

  const teams = await Team.find({
    name: { $in: seedTeamNames },
    $or: [
      { isSeed: true, seedSource: SEED_SOURCE },
      { tags: SEED_TAG },
      { organization: SEED_ORGANIZATION },
    ],
  }).select("_id");
  const teamIds = teams.map((team) => team._id);

  const playerQuery = {
    name: { $in: seedPlayerNames },
    $and: [
      {
        $or: [
          { isSeed: true, seedSource: SEED_SOURCE },
          { organization: SEED_ORGANIZATION },
        ],
      },
    ],
  };

  if (teamIds.length) {
    playerQuery.$and.push({
      $or: [
        { team: { $in: teamIds } },
        { team: null },
        { team: { $exists: false } },
      ],
    });
  }

  const playersResult = await Player.deleteMany(playerQuery);
  const teamsResult = teamIds.length ? await Team.deleteMany({ _id: { $in: teamIds } }) : { deletedCount: 0 };

  console.log("--reset removed seed records only:");
  console.log(`  teams removed: ${teamsResult.deletedCount}`);
  console.log(`  players removed: ${playersResult.deletedCount}`);
  console.log(`  matches removed: ${matchesResult.deletedCount}`);
  console.log(`  balls removed: ${ballsResult.deletedCount}`);
  console.log(`  commentary removed: ${commentaryResult.deletedCount}`);
}

async function seedTeamRecords() {
  const teamsByName = new Map();
  let created = 0;
  let existing = 0;
  let skippedNameCollisions = 0;

  for (const teamSpec of seedTeams) {
    const current = await Team.findOne({ name: teamSpec.name });
    if (current) {
      existing += 1;
      if (!isSeedManagedTeam(current)) {
        skippedNameCollisions += 1;
        console.warn(`Skipped starter team "${teamSpec.name}" because an unmarked team with that name already exists.`);
      }
      teamsByName.set(teamSpec.name, current);
      continue;
    }

    const team = await Team.create(buildTeamDocument(teamSpec));
    teamsByName.set(teamSpec.name, team);
    created += 1;
  }

  return { teamsByName, created, existing, skippedNameCollisions };
}

async function seedPlayerRecords(teamsByName) {
  const playersByTeamName = new Map();
  let created = 0;
  let existing = 0;
  let skipped = 0;

  for (const teamSpec of seedTeams) {
    const team = teamsByName.get(teamSpec.name);
    if (!team || !isSeedManagedTeam(team)) {
      skipped += rosterTemplate.length;
      playersByTeamName.set(teamSpec.name, []);
      continue;
    }

    const players = [];
    for (const playerSpec of buildPlayerSpecs(teamSpec.name)) {
      let player = await Player.findOne({ name: playerSpec.name, team: team._id });
      if (player) {
        existing += 1;
      } else {
        player = await Player.create(buildPlayerDocument(playerSpec, team._id));
        created += 1;
      }
      players.push(player);
    }

    await Team.findByIdAndUpdate(team._id, {
      $addToSet: { players: { $each: players.map((player) => player._id) } },
    });
    playersByTeamName.set(teamSpec.name, players);
  }

  return { playersByTeamName, created, existing, skipped };
}

async function seedMatchRecords(teamsByName, playersByTeamName) {
  let created = 0;
  let existing = 0;
  let skipped = 0;

  for (const matchSpec of seedMatches) {
    const current = await Match.findOne({ slug: matchSpec.slug });
    if (current) {
      existing += 1;
      continue;
    }

    const teamDocs = matchSpec.teamNames.map((teamName) => teamsByName.get(teamName));
    if (teamDocs.some((team) => !team || !isSeedManagedTeam(team))) {
      skipped += 1;
      console.warn(`Skipped starter match "${matchSpec.title}" because one or both teams are not seed-managed.`);
      continue;
    }

    const hasFullRosters = matchSpec.teamNames.every((teamName) => (playersByTeamName.get(teamName) || []).length === 11);
    if (!hasFullRosters) {
      skipped += 1;
      console.warn(`Skipped starter match "${matchSpec.title}" because one or both rosters are incomplete.`);
      continue;
    }

    await Match.create(buildMatchDocument(matchSpec, teamDocs, playersByTeamName));
    created += 1;
  }

  return { created, existing, skipped };
}

async function seedInitialData() {
  console.warn("WARNING: This script creates dummy starter data only. Do not use it to restore real production cricket data.");
  assertResetAllowed();
  await connectToDatabase();

  if (SHOULD_RESET) {
    await resetSeedData();
  }

  const teamResult = await seedTeamRecords();
  const playerResult = await seedPlayerRecords(teamResult.teamsByName);
  const matchResult = await seedMatchRecords(teamResult.teamsByName, playerResult.playersByTeamName);

  console.log("Seed completed.");
  console.log(`teams created: ${teamResult.created}`);
  console.log(`teams already existed: ${teamResult.existing}`);
  console.log(`players created: ${playerResult.created}`);
  console.log(`players already existed: ${playerResult.existing}`);
  console.log(`matches created: ${matchResult.created}`);
  console.log(`matches already existed: ${matchResult.existing}`);

  if (teamResult.skippedNameCollisions || playerResult.skipped || matchResult.skipped) {
    console.log("Skipped records:");
    console.log(`  unmarked team name collisions: ${teamResult.skippedNameCollisions}`);
    console.log(`  players skipped: ${playerResult.skipped}`);
    console.log(`  matches skipped: ${matchResult.skipped}`);
  }
}

seedInitialData()
  .catch((error) => {
    console.error("Seed failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
