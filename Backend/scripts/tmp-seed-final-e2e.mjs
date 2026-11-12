import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import Tournament from "../src/models/Tournament.js";
import Match from "../src/models/Match.js";
import SystemSettings from "../src/models/SystemSettings.js";
import { parseScorecardWorkbook, mappingFor, parseCreateMappingValue } from "../src/scripts/importQfMatches.js";

const URI = "mongodb://127.0.0.1:27017/cric-all-e2e";
const TOURNAMENT_NAME = "All Baldia T20 Hard Ball Cricket Tournament";
const MAPPING = JSON.parse(
  fs.readFileSync(path.resolve("src/scripts/data/qfNameMap.json"), "utf8"),
);
const WORKBOOKS = [
  path.join(process.env.USERPROFILE, "Desktop", "qf-scorecards.xlsx"),
  path.join(process.env.USERPROFILE, "Desktop", "Match4_QF4_import.xlsx"),
];

const TEAM_NAMES = [
  "Ittehad Sports",
  "Baldia Zalmi",
  "Sky Sports",
  "Orangi United",
  "Young Star",
  "Khan Associates",
  "Family Stallions",
  "Orangi Warriors",
];

const normalize = (value) =>
  String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// The workbook uses a few short/legacy labels for the same eight teams.
const TEAM_ALIASES = {
  "family stallion": "Family Stallions",
  "family stallions": "Family Stallions",
  "orangi sports": "Orangi Warriors",
  "orangi warriors": "Orangi Warriors",
  "khan associate": "Khan Associates",
  "khan associates": "Khan Associates",
};

const teamForLabel = (label) => {
  const aliased = TEAM_ALIASES[normalize(label)];
  return teams.get(normalize(aliased || label));
};

await mongoose.connect(URI, { serverSelectionTimeoutMS: 10000 });
await mongoose.connection.dropDatabase();
console.log("Dropped disposable database cric-all-e2e");

const teams = new Map();
for (const name of TEAM_NAMES) {
  const team = await Team.create({ name, shortName: name.slice(0, 4).toUpperCase(), isPublic: true });
  teams.set(normalize(name), team);
}
console.log(`Created ${teams.size} teams`);

// Resolve each workbook row to the player name the importer expects in the
// squad: explicit mapping value wins, SKIP needs no player, CREATE: is the
// mapped placeholder name, otherwise the sheet name itself.
const wanted = new Map();
for (const file of WORKBOOKS) {
  const parsed = parseScorecardWorkbook(fs.readFileSync(file));
  for (const sheet of parsed.sheets) {
    for (const innings of sheet.innings) {
      for (const [role, rows, teamName] of [
        ["batting", innings.batting || [], innings.battingTeam],
        ["bowling", innings.bowling || [], innings.bowlingTeam],
      ]) {
        const team = teamForLabel(teamName);
        if (!team) continue;
        for (const row of rows) {
          const rawName = String(row.name || "").trim();
          if (!rawName && !mappingFor(MAPPING, teamName, "?")) continue;
          const mapped = mappingFor(MAPPING, teamName, rawName);
          let target = rawName;
          if (typeof mapped === "string") {
            if (mapped.trim().toUpperCase() === "SKIP") continue;
            const create = parseCreateMappingValue(mapped);
            target = create ? create.name : mapped.trim();
          }
          if (!target) continue;
          const key = `${team.name}::${normalize(target)}`;
          if (!wanted.has(key)) wanted.set(key, { team, name: target, role });
        }
      }
    }
  }
}

let created = 0;
for (const { team, name, role } of wanted.values()) {
  const player = await Player.create({
    name,
    team: team._id,
    playingRole: role === "batting" ? "Batsman" : "Bowler",
    isPublic: true,
  });
  team.players = [...(team.players || []), player._id];
  await team.save();
  created += 1;
}
console.log(`Created ${created} players across ${WORKBOOKS.length} workbook(s)`);

const settings = await SystemSettings.findOne({ key: "platform" });
if (!settings) {
  await SystemSettings.create({ key: "platform", value: { enableSuperSub: false } });
  console.log("Created default platform SystemSettings");
}

const tournament = await Tournament.create({
  name: TOURNAMENT_NAME,
  shortName: "ALLBALDIA",
  slug: "all-baldia-t20-hard-ball-2026-e2e",
  type: "knockout",
  format: "T20",
  venue: "Tahirabad Ground",
  status: "upcoming",
  startDate: new Date("2026-10-11T00:00:00.000Z"),
  endDate: new Date("2026-10-11T00:00:00.000Z"),
  teams: [...teams.values()].map((team) => team._id),
  matches: [],
  rules: { twelfthManEnabled: false },
});
console.log(`Created tournament ${tournament._id}`);

const stale = await Match.countDocuments({});
console.log(JSON.stringify({ tournamentId: String(tournament._id), teams: teams.size, players: created, matches: stale }));
await mongoose.disconnect();
