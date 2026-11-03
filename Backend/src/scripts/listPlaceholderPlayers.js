// Read-only review report:
//   node src/scripts/listPlaceholderPlayers.js
//   node src/scripts/listPlaceholderPlayers.js --squads-file /path/to/original-squads.csv
//   node src/scripts/listPlaceholderPlayers.js --output /tmp/player-review.csv
//
// Reads MONGO_URL from Backend/.env, never prints it, and writes only the
// owner-editable CSV file. The report is self-sufficient on the live DB:
// tournament squads come from Tournament.tournamentSquads, with Team.players
// and the match scorecards as the fallback when squads are empty. It reports
// every (TBC) player, every CREATE name-map target, and any scorecard player
// outside their side's squad. Pass --squads-file only to add the canonical
// source CSV as extra original-squad evidence.
//
// Decision-support columns (appended, so older CSVs stay valid):
//   candidate_real_players  same-team squad members with no batting, bowling,
//                           DNB, XI or twelfth-man row in EVERY match the
//                           placeholder appears in (the intersection).
//   candidates_by_match     the same candidate list per match, so a player who
//                           is only free in one match is still visible.
//   similar_names           same-team squad names close to the placeholder
//                           (edit distance, shared prefix, phonetic hint).
//   similar_names_other_teams
//                           the same normalized name on another team. This is
//                           information only, never a merge suggestion.
//   match_context           match label, fixture teams, and the innings/roles
//                           in which the placeholder appears.
//   bowler_reconciliation   the side's bowling totals vs the opposing batting
//                           card, plus the placeholder's own spell and the
//                           unreconciled figures without that spell.
//   team_conflict           every disagreeing team source (squad, roster,
//                           CREATE map, Player.team, scorecard) when a player
//                           cannot be assigned one side without contradiction.
//   candidates_without_bowling_row
//                           same-team squad members with no bowling row in each
//                           match the placeholder bowled (they may have batted).
//   candidates_without_batting_row
//                           same-team squad members with no batting row in each
//                           match the placeholder batted (they may have bowled).
//
// Team resolution is squad/roster membership first, then the CREATE map, then
// Player.team. Scorecards only fill a remaining gap. A batting card belongs to
// the innings' own team; a bowling/fielding row belongs to the other team in
// the fixture, never to the innings' batting team.
//
// The report never fills real_name_or_existing_player_id. The owner remains the
// only person who chooses a rename or merge.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import Event from "../models/Event.js";
import Match from "../models/Match.js";
import Player from "../models/Player.js";
import Team from "../models/Team.js";
import Tournament from "../models/Tournament.js";
import { getMongoTarget } from "../utils/mongoTarget.js";
import {
  buildPlayerReview,
  collectMatchPlayerReferences,
  CSV_HEADERS,
  idOf,
  loadNameMapEntries,
  normalizeName,
  parseCsv,
  resolvePlayerTeams,
  toCsv,
} from "./playerNameCleanup.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(SCRIPT_DIR, "../..");
dotenv.config({ path: path.join(BACKEND_ROOT, ".env"), quiet: true });

export const TOURNAMENT_NAME = "All Baldia T20 Hard Ball Cricket Tournament";

function optionValue(args, option) {
  const index = args.findIndex((arg) => arg === option || arg.startsWith(`${option}=`));
  if (index < 0) return "";
  if (args[index].includes("=")) return args[index].slice(args[index].indexOf("=") + 1);
  const value = args[index + 1] || "";
  return value.startsWith("--") ? "" : value;
}

function originalSquadNamesFromCsv(filePath) {
  if (!filePath) return new Map();
  const rows = parseCsv(fs.readFileSync(filePath, "utf8"));
  if (!rows.length) throw new Error("The supplied original-squads CSV has no player rows.");
  const headers = Object.keys(rows[0]);
  const teamColumn = ["team", "team_name"].find((header) => headers.includes(header));
  const playerColumn = ["player_name", "name"].find((header) => headers.includes(header));
  if (!teamColumn || !playerColumn) {
    throw new Error("Original-squads CSV must contain team and player_name (or team_name and name) columns.");
  }
  const names = new Map();
  for (const row of rows) {
    const team = normalizeName(row[teamColumn]);
    const player = normalizeName(row[playerColumn]);
    if (!team || !player) continue;
    if (!names.has(team)) names.set(team, new Set());
    names.get(team).add(player);
  }
  return names;
}

export function reportDuplicatePlayers(players, teams, playerTeams = new Map()) {
  const teamNames = new Map(teams.map((team) => [String(team._id), team.name]));
  const byName = new Map();
  for (const player of players) {
    const key = normalizeName(player.name);
    const group = byName.get(key) || [];
    const teamId = String(playerTeams.get(String(player._id)) || player.team || "");
    group.push({
      player_id: String(player._id),
      name: player.name,
      team: teamNames.get(teamId) || "Unknown team",
    });
    byName.set(key, group);
  }
  return [...byName.values()]
    .filter((group) => group.length > 1)
    .flatMap((group) => {
      const teamsForName = new Set(group.map((player) => player.team));
      const sameTeamCount = new Map();
      for (const player of group) {
        sameTeamCount.set(player.team, (sameTeamCount.get(player.team) || 0) + 1);
      }
      return group.map((player) => ({
        ...player,
        duplicate_same_team: sameTeamCount.get(player.team) > 1 ? "YES" : "",
        duplicate_across_teams: teamsForName.size > 1 ? "YES" : "",
      }));
    });
}

export async function collectPlayerReport({ tournamentName = TOURNAMENT_NAME, squadsFile = "" } = {}) {
  const tournament = await Tournament.findOne({ name: tournamentName }).lean();
  if (!tournament) throw new Error(`Tournament "${tournamentName}" was not found.`);
  const eventIds = await Event.find({ name: tournamentName }).distinct("_id");
  const matches = await Match.find({
    $or: [
      { tournament: tournament._id },
      { _id: { $in: tournament.matches || [] } },
      { event: { $in: eventIds } },
    ],
  }).lean();
  const mapEntries = loadNameMapEntries();

  // Team scope comes from the tournament itself, its DB squads, and the teams
  // that actually appear in its fixtures. The last two matter on live data where
  // tournamentSquads is empty and the public squad view falls back to the match
  // and Team.players links.
  const teamIds = new Set();
  for (const team of tournament.teams || []) teamIds.add(idOf(team));
  for (const entry of tournament.tournamentSquads || []) teamIds.add(idOf(entry.team));
  for (const match of matches) {
    for (const team of match.teams || []) teamIds.add(idOf(team));
    for (const innings of match.innings || []) teamIds.add(idOf(innings.team));
    for (const over of match.superOvers || []) {
      for (const innings of over.innings || []) teamIds.add(idOf(innings.team));
    }
  }
  const scopedTeamIds = [...teamIds].filter(Boolean);
  const teams = await Team.find({ _id: { $in: scopedTeamIds } }).lean();

  const matchPlayerTeams = collectMatchPlayerReferences(matches);
  const rosterPlayerIds = teams.flatMap((team) => (team.players || []).map(idOf));
  const squadPlayerIds = (tournament.tournamentSquads || [])
    .flatMap((entry) => (entry.players || []).map(idOf));
  const referencedPlayerIds = [...matchPlayerTeams.keys()];
  const createTargets = mapEntries
    .filter((entry) => entry.mappedValue.trim().toUpperCase().startsWith("CREATE:"))
    .map((entry) => ({
      teamName: entry.teamName,
      name: entry.mappedValue.trim().slice("CREATE:".length).trim(),
    }))
    .filter((entry) => entry.name);
  const createNames = [...new Set(createTargets.map((entry) => entry.name))];

  // Candidates are everything the old Player.team-only query would have found,
  // plus roster ids, scorecard references, and CREATE targets matched by name.
  const playerQuery = {
    $or: [
      { team: { $in: scopedTeamIds } },
      { _id: { $in: [...new Set([...rosterPlayerIds, ...squadPlayerIds, ...referencedPlayerIds])] } },
      ...(createNames.length ? [{ name: { $in: createNames } }] : []),
    ],
  };
  const players = await Player.find(playerQuery).lean();

  // Resolve the side from squad/roster membership first, then the CREATE map,
  // then Player.team. A stale Player.team or an innings' batting side can no
  // longer move a bowler to the team they bowled against.
  const { assignments: playerTeams, conflicts: teamConflicts } = resolvePlayerTeams({
    tournament,
    teams,
    players,
    matches,
    mapEntries,
  });

  const reviewRows = buildPlayerReview({
    tournament,
    teams,
    players,
    matches,
    mapEntries,
    originalSquadNames: originalSquadNamesFromCsv(squadsFile),
    playerTeams,
    teamConflicts,
  });
  return {
    tournament,
    teams,
    players,
    matches,
    mapEntries,
    reviewRows,
    duplicateRows: reportDuplicatePlayers(players, teams, playerTeams),
  };
}

export async function main(args = process.argv.slice(2)) {
  const uri = process.env.MONGO_URL;
  if (!uri) {
    throw new Error("MONGO_URL is not set. The report never prints or accepts the URI on the command line.");
  }
  const { databaseName } = getMongoTarget(uri);
  if (!databaseName) throw new Error("MONGO_URL must include an explicit database name.");
  const squadsFile = optionValue(args, "--squads-file");
  const output = optionValue(args, "--output") ||
    path.join(os.tmpdir(), `player-name-cleanup-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`);

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });
  try {
    const report = await collectPlayerReport({ squadsFile });
    const mappingRows = report.mapEntries.map((entry) => ({
      import: entry.matchLabel,
      team: entry.teamName,
      scorer_source_name: entry.sourceName,
      mapped_squad_player: entry.mappedValue,
    }));
    console.log(`Tournament: ${report.tournament.name}`);
    console.log(`Players reviewed: ${report.reviewRows.length}`);
    if (!report.tournament.tournamentSquads?.length && !squadsFile) {
      console.warn(
        "No tournamentSquads data or --squads-file supplied; using Team.players and the match scorecards as the DB squad fallback.",
      );
    }
    console.log("\nPlaceholder / imported players:");
    console.table(report.reviewRows);
    console.log("\nNickname -> squad-player mappings (review every proposed match):");
    console.table(mappingRows);
    console.log("\nDuplicate player-name warnings:");
    console.table(report.duplicateRows);
    fs.writeFileSync(output, toCsv(CSV_HEADERS, report.reviewRows), { encoding: "utf8", flag: "wx" });
    console.log(`Owner-editable CSV written to: ${output}`);
    return report;
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Player review failed: ${error.message}`);
    process.exitCode = 1;
  });
}
