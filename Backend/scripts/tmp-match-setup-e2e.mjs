// Disposable E2E seed for the match-setup squad fix. Never point this at a real DB.
import mongoose from "mongoose";
import Admin from "../src/models/Admin.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import Tournament from "../src/models/Tournament.js";
import Match from "../src/models/Match.js";
import SystemSettings, { PLATFORM_KEY } from "../src/models/SystemSettings.js";

const URI = "mongodb://127.0.0.1:27017/cric-all-e2e";

await mongoose.connect(URI, { serverSelectionTimeoutMS: 10000 });
await mongoose.connection.dropDatabase();
console.log("Dropped disposable database cric-all-e2e");

await SystemSettings.create({
  key: PLATFORM_KEY,
  value: { enableSuperSub: true },
});

await Admin.create({
  name: "E2E Admin",
  email: "e2e-admin@cricall.test",
  password: "E2eAdmin!2345",
  role: "superadmin",
});

const makeTeam = async (name, shortName, rosterSize) => {
  const players = await Player.create(
    Array.from({ length: 19 }, (_, index) => ({
      name: `${name} Player ${String(index + 1).padStart(2, "0")}`,
      team: null,
      playingRole: index < 5 ? "Batsman" : index < 8 ? "All-Rounder" : "Bowler",
      isPublic: true,
    })),
  );
  const team = await Team.create({
    name,
    shortName,
    isPublic: true,
    players: players.slice(0, rosterSize).map((player) => player._id),
  });
  await Player.updateMany(
    { _id: { $in: players.map((player) => player._id) } },
    { $set: { team: team._id } },
  );
  return { team, players };
};

const sky = await makeTeam("Sky Sports", "SKY", 7);
const star = await makeTeam("Young Star", "", 6);

const tournament = await Tournament.create({
  name: "E2E All Baldia T20 2026",
  shortName: "ALLBALDIA",
  slug: "e2e-all-baldia-t20-2026",
  type: "knockout",
  startDate: new Date("2026-10-11T00:00:00.000Z"),
  endDate: new Date("2026-11-01T00:00:00.000Z"),
  teams: [sky.team._id, star.team._id],
  rules: { twelfthManEnabled: true },
  tournamentSquads: [
    { team: sky.team._id, players: sky.players.map((player) => player._id) },
    { team: star.team._id, players: star.players.map((player) => player._id) },
  ],
});

const match = await Match.create({
  title: "Final - Sky Sports vs Young Star",
  venue: "Tahirabad Ground",
  matchType: "T20",
  totalOvers: 20,
  startAt: new Date("2026-11-01T05:30:00.000Z"),
  teams: [sky.team._id, star.team._id],
  tournament: tournament._id,
  status: "upcoming",
  playingXI: [],
  twelfthMan: [],
});

tournament.matches = [match._id];
await tournament.save();

console.log(
  JSON.stringify({
    admin: "e2e-admin@cricall.test",
    matchId: String(match._id),
    tournamentId: String(tournament._id),
    skyTeamId: String(sky.team._id),
    starTeamId: String(star.team._id),
    skySquadSize: sky.players.length,
    starSquadSize: star.players.length,
    skyRosterSize: sky.team.players.length,
    starRosterSize: star.team.players.length,
    startAt: match.startAt.toISOString(),
  }),
);

await mongoose.disconnect();
