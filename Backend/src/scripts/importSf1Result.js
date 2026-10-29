// Import the All Baldia T20 SF1 result (Baldia Zalmi vs Sky Sports) as a DRAFT
// manual scorecard on the EXISTING semi-final fixture. The fixture is converted
// in place: same _id, same tournament link, same bracket slot.
//
//   node src/scripts/importSf1Result.js                 # dry run (default)
//   node src/scripts/importSf1Result.js --apply         # write the draft
//   node src/scripts/importSf1Result.js --force-test    # allow a test/e2e DB
//
// Safety and scope
// ---------------
//   * Dry run by default; --apply is the only way to write.
//   * Finds the tournament by name and SF1 by tournament + stage + stageLabel;
//     refuses to create a second SF1 or to create a missing tournament/fixture.
//   * Verifies the fixture teams are Baldia Zalmi and Sky Sports.
//   * Refuses anything that is not an empty upcoming live fixture and refuses
//     to overwrite ball-by-ball data. Conversion goes through the same
//     `applyManualMatch` service the Admin manual-scorecard save uses.
//   * Never publishes. The result is written with manualDraft=true and
//     status="upcoming", so the public bracket/stats ignore it until the owner
//     presses Publish in Admin (or runs publishManualMatches.js).
//   * Re-running is idempotent: an existing manual SF1 is SKIPped.
//   * Match specifics live only in data/sf1Result.json and data/sf1NameMap.json.
//   * The Mongo URI is read from MONGO_URL and never printed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import Match from "../models/Match.js";
import Team from "../models/Team.js";
import Player from "../models/Player.js";
import Tournament from "../models/Tournament.js";
import Ball from "../models/Ball.js";
import Delivery from "../models/Delivery.js";
import {
  convertUpcomingFixtureToManualDraft,
  isEmptyUpcomingFixture,
} from "../controllers/manualScorecardController.js";
import {
  validateManualScorecard,
  parseOvers,
  normalizeDismissalType,
} from "../services/manualScorecard.js";
import { isTestTarget } from "./createSemiFinals.js";
import { getMongoTarget } from "../utils/mongoTarget.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(SCRIPT_DIR, "../..");
dotenv.config({ path: path.join(BACKEND_ROOT, ".env"), quiet: true });

mongoose.set("autoIndex", false);

export const DATA_FILE = path.join(SCRIPT_DIR, "data", "sf1Result.json");
export const NAME_MAP_FILE = path.join(SCRIPT_DIR, "data", "sf1NameMap.json");
export const CREATE_PREFIX = "CREATE:";
export const PLACEHOLDER_ID_PREFIX = "placeholder-player:";

const idOf = (value) => String(value?._id || value || "");
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const normalizeName = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function parseCreateMappingValue(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.toUpperCase().startsWith(CREATE_PREFIX)) return null;
  const name = trimmed.slice(CREATE_PREFIX.length).trim();
  if (!name) return { name: "", error: "CREATE mapping needs a player name after CREATE:" };
  return { name };
}

export function mappingFor(mapping, teamName, sourceName) {
  if (!mapping) return "";
  const scoped = mapping[`${teamName}::${sourceName}`];
  if (scoped !== undefined) return scoped;
  const plain = mapping[sourceName];
  return plain !== undefined ? plain : "";
}

function loadJsonFile(file, label) {
  if (!fs.existsSync(file)) throw new Error(`${label} was not found: ${file}`);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must contain a JSON object.`);
  }
  return parsed;
}

export function loadImportFiles({ dataFile = DATA_FILE, nameMapFile = NAME_MAP_FILE } = {}) {
  const data = loadJsonFile(dataFile, "SF1 result data");
  const mapping = loadJsonFile(nameMapFile, "SF1 name map");
  if (!data.tournamentName) throw new Error("sf1Result.json has no tournamentName.");
  if (!data.match?.stage || !data.match?.stageLabel) {
    throw new Error("sf1Result.json has no match.stage/stageLabel.");
  }
  if (!Array.isArray(data.innings) || data.innings.length !== 2) {
    throw new Error("sf1Result.json must contain exactly two innings.");
  }
  return { data, mapping, dataFile, nameMapFile };
}

function squadKey(team) {
  return String(team?._id || team);
}

export async function loadSquad(team) {
  const rosterIds = (team.players || []).map(idOf).filter(Boolean);
  let players = rosterIds.length
    ? await Player.find({ _id: { $in: rosterIds } }).select("name team").lean()
    : [];
  let source = "Team.players";
  let warning = "";
  if (!players.length) {
    players = await Player.find({ team: team._id }).select("name team").lean();
    source = "Player.team fallback";
    if (players.length) warning = "Team.players is empty; used Player.team roster instead";
  } else {
    const byId = new Map(players.map((player) => [String(player._id), player]));
    const missing = rosterIds.filter((id) => !byId.has(id));
    if (missing.length) {
      warning = `${missing.length} Team.players id(s) have no Player document and were ignored`;
    }
  }
  return {
    team,
    source,
    warning,
    players: players
      .filter((player) => player && player.name)
      .map((player) => ({ _id: String(player._id), name: player.name }))
      .sort((a, b) => normalizeName(a.name).localeCompare(normalizeName(b.name))),
  };
}

/**
 * Create the explicitly listed CREATE: placeholders, or reuse an existing
 * player with the same name on that team. Scoping by team is deliberate: Sky
 * Sports' "Ali (TBC)" is a different player from Orangi United's.
 */
export async function ensurePlaceholderPlayers(specs, { dryRun = false } = {}) {
  const result = { wouldCreate: [], created: [], reused: [], errors: [] };
  const unique = new Map();
  for (const spec of specs || []) {
    if (!spec?.teamId || !spec?.name) {
      result.errors.push(`invalid placeholder spec: ${JSON.stringify(spec)}`);
      continue;
    }
    const key = `${spec.teamId}::${normalizeName(spec.name)}`;
    if (!unique.has(key)) unique.set(key, spec);
  }

  for (const spec of unique.values()) {
    const team = await Team.findById(spec.teamId).select("name players").lean();
    if (!team) {
      result.errors.push(`team ${spec.teamName || spec.teamId} was not found`);
      continue;
    }
    const rosterIds = (team.players || []).map(idOf).filter(Boolean);
    const candidates = await Player.find({
      $or: [
        { team: team._id },
        ...(rosterIds.length ? [{ _id: { $in: rosterIds } }] : []),
      ],
    })
      .select("name team")
      .lean();
    const existing = candidates.find(
      (player) => normalizeName(player.name) === normalizeName(spec.name),
    );
    if (existing) {
      if (!dryRun && !rosterIds.includes(String(existing._id))) {
        await Team.updateOne({ _id: team._id }, { $addToSet: { players: existing._id } });
      }
      result.reused.push({ id: String(existing._id), name: existing.name, team: team.name });
      continue;
    }
    if (dryRun) {
      result.wouldCreate.push({ name: spec.name, team: team.name, teamId: String(team._id) });
      continue;
    }
    const player = await Player.create({ name: spec.name, team: team._id, role: "" });
    await Team.updateOne({ _id: team._id }, { $addToSet: { players: player._id } });
    result.created.push({ id: String(player._id), name: player.name, team: team.name });
  }
  return result;
}

export function resolveTeamByName(teams, name) {
  const wanted = normalizeName(name);
  const matches = (teams || []).filter((team) => normalizeName(team?.name) === wanted);
  if (matches.length === 1) return { team: matches[0] };
  if (!matches.length) return { error: `team "${name}" was not found in the tournament` };
  return {
    error: `team name "${name}" is ambiguous (${matches
      .map((team) => `${team.name} ${idOf(team)}`)
      .join(", ")})`,
  };
}

function resolveSquadPlayer(squad, name) {
  const wanted = normalizeName(name);
  const matches = (squad.players || []).filter(
    (player) => normalizeName(player.name) === wanted,
  );
  if (matches.length === 1) return { player: matches[0] };
  if (!matches.length) {
    return { error: `"${name}" was not found in ${squad.team.name}'s squad` };
  }
  return {
    error: `"${name}" is ambiguous in ${squad.team.name}'s squad (${matches
      .map((player) => player.name)
      .join(", ")})`,
  };
}

function mapSourceName({ sourceName, squad, mapping, createSpecs }) {
  const value = mappingFor(mapping, squad.team.name, sourceName);
  const create = parseCreateMappingValue(value);
  if (create) {
    if (create.error) return { error: create.error };
    const existing = resolveSquadPlayer(squad, create.name);
    if (!existing.error) {
      return {
        player: existing.player,
        reason: "CREATE mapping (existing player)",
        create: false,
      };
    }
    const synthetic = {
      _id: `${PLACEHOLDER_ID_PREFIX}${squadKey(squad.team)}:${normalizeName(create.name)}`,
      name: create.name,
      placeholder: true,
    };
    squad.players.push(synthetic);
    createSpecs.push({ teamId: squadKey(squad.team), teamName: squad.team.name, name: create.name });
    return { player: synthetic, reason: "CREATE mapping (placeholder)", create: true };
  }

  const targetName =
    typeof value === "string" && value.trim() ? value.trim() : sourceName;
  const resolved = resolveSquadPlayer(squad, targetName);
  if (resolved.error) return { error: resolved.error };
  return { player: resolved.player, reason: targetName === sourceName ? "exact squat name" : "name map", create: false };
}

function inningsChecks(raw, bowling, batting, extras, totalOvers) {
  const errors = [];
  const notes = [];
  const battingRuns = batting.reduce((sum, row) => sum + (Number(row.runs) || 0), 0);
  const extrasTotal =
    Number(extras.wides || 0) +
    Number(extras.noBalls || 0) +
    Number(extras.byes || 0) +
    Number(extras.legByes || 0) +
    Number(extras.penalties || 0);
  const bowlingRuns = bowling.reduce((sum, row) => sum + (Number(row.runs) || 0), 0);
  const bowlingWickets = bowling.reduce((sum, row) => sum + (Number(row.wickets) || 0), 0);
  const byes = Number(extras.byes || 0);
  const legByes = Number(extras.legByes || 0);
  const runOuts = batting.filter(
    (row) => row.isOut && String(row.dismissalType || "").toLowerCase() === "run out",
  ).length;
  const wickets = batting.filter((row) => row.isOut).length;
  const ballsFaced = batting.reduce((sum, row) => sum + (Number(row.balls) || 0), 0);

  const inningsOvers = parseOvers(raw.overs);
  if (!inningsOvers.valid) errors.push(`innings overs: ${inningsOvers.reason}`);
  let bowlingBalls = 0;
  for (const row of bowling) {
    const parsed = parseOvers(row.overs);
    if (!parsed.valid) {
      errors.push(`bowler ${row.name} overs: ${parsed.reason}`);
      continue;
    }
    bowlingBalls += parsed.balls;
  }

  if (battingRuns + extrasTotal !== Number(raw.runs)) {
    errors.push(
      `batting runs ${battingRuns} + extras ${extrasTotal} = ${battingRuns + extrasTotal}, expected ${raw.runs}`,
    );
  }
  if (bowlingRuns + byes + legByes !== Number(raw.runs)) {
    errors.push(
      `bowler runs ${bowlingRuns} + byes ${byes} + leg byes ${legByes} = ${bowlingRuns + byes + legByes}, expected ${raw.runs}`,
    );
  }
  if (inningsOvers.valid && bowlingBalls !== inningsOvers.balls) {
    errors.push(
      `bowler overs total ${bowlingBalls} ball(s), innings says ${inningsOvers.balls} ball(s)`,
    );
  }
  if (wickets !== Number(raw.wickets)) {
    errors.push(`batting card has ${wickets} wicket(s), innings says ${raw.wickets}`);
  }
  if (bowlingWickets + runOuts !== Number(raw.wickets)) {
    errors.push(
      `bowler wickets ${bowlingWickets} + run out(s) ${runOuts} = ${bowlingWickets + runOuts}, expected ${raw.wickets}`,
    );
  }
  if (inningsOvers.valid && inningsOvers.overs > Number(totalOvers)) {
    errors.push(`innings overs ${raw.overs} exceed the ${totalOvers}-over quota`);
  }
  for (const row of batting) {
    if (Number(row.fours) * 4 + Number(row.sixes) * 6 > Number(row.runs)) {
      errors.push(
        `"${row.name}" boundary runs ${Number(row.fours) * 4 + Number(row.sixes) * 6} exceed ${row.runs} run(s)`,
      );
    }
  }
  if (ballsFaced !== (inningsOvers.valid ? inningsOvers.balls : 0)) {
    notes.push(
      `batters faced ${ballsFaced} ball(s) vs ${inningsOvers.valid ? inningsOvers.balls : "?"} legal ball(s) bowled (informational only)`,
    );
  }

  return {
    errors,
    notes,
    checks: {
      battingRuns,
      extrasTotal,
      total: battingRuns + extrasTotal,
      bowlingRuns,
      byes,
      legByes,
      bowlingTotal: bowlingRuns + byes + legByes,
      inningsBalls: inningsOvers.valid ? inningsOvers.balls : 0,
      bowlingBalls,
      wickets,
      bowlingWickets,
      runOuts,
      ballsFaced,
      overs: raw.overs,
    },
  };
}

function buildInningsPlan(raw, context) {
  const { teams, squads, mapping, totalOvers, createSpecs } = context;
  const errors = [];
  const notes = [];
  const where = `innings ${raw.number || ""}`.trim();

  const battingLookup = resolveTeamByName(teams, raw.battingTeam);
  const bowlingLookup = resolveTeamByName(teams, raw.bowlingTeam);
  if (battingLookup.error || bowlingLookup.error) {
    errors.push(
      ...[battingLookup.error, bowlingLookup.error].filter(Boolean).map((error) => `${where}: ${error}`),
    );
    return { errors, notes, innings: null, mapping: [] };
  }
  const battingTeam = battingLookup.team;
  const bowlingTeam = bowlingLookup.team;
  const battingSquad = squads.get(squadKey(battingTeam));
  const bowlingSquad = squads.get(squadKey(bowlingTeam));
  if (!battingSquad?.players?.length) errors.push(`${where}: batting squad for ${battingTeam.name} is empty`);
  if (!bowlingSquad?.players?.length) errors.push(`${where}: bowling squad for ${bowlingTeam.name} is empty`);
  if (errors.length) return { errors, notes, innings: null, mapping: [] };

  const rowMappings = [];
  const batting = [];
  for (const [index, row] of (raw.batting || []).entries()) {
    const mapped = mapSourceName({
      sourceName: row.name,
      squad: battingSquad,
      mapping,
      createSpecs,
    });
    rowMappings.push({ role: "batting", row: index + 1, sourceName: row.name, ...mapped });
    if (mapped.error) {
      errors.push(`${where} batting row ${index + 1} "${row.name}": ${mapped.error}`);
      continue;
    }
    const dismissalTypeRaw = normalizeDismissalType(row.dismissal?.type);
    const notOut = !dismissalTypeRaw || dismissalTypeRaw === "not out";
    const isRetiredHurt = dismissalTypeRaw === "retired hurt";
    const isRetired = dismissalTypeRaw === "retired";
    const isOut = !notOut && !isRetiredHurt && !isRetired;
    const dismissalType = isOut ? dismissalTypeRaw : "";
    batting.push({
      sourceName: row.name,
      player: String(mapped.player._id),
      runs: Number(row.runs) || 0,
      balls: Number(row.balls) || 0,
      fours: Number(row.fours) || 0,
      sixes: Number(row.sixes) || 0,
      isOut,
      isRetiredHurt,
      isRetired,
      dismissalType,
      dismissalText: String(row.dismissalText || "").trim(),
      dismissedBy: null,
      fielder: null,
    });
  }

  const bowling = [];
  for (const [index, row] of (raw.bowling || []).entries()) {
    const mapped = mapSourceName({
      sourceName: row.name,
      squad: bowlingSquad,
      mapping,
      createSpecs,
    });
    rowMappings.push({ role: "bowling", row: index + 1, sourceName: row.name, ...mapped });
    if (mapped.error) {
      errors.push(`${where} bowling row ${index + 1} "${row.name}": ${mapped.error}`);
      continue;
    }
    bowling.push({
      sourceName: row.name,
      player: String(mapped.player._id),
      overs: String(row.overs ?? ""),
      maidens: Number(row.maidens) || 0,
      runs: Number(row.runs) || 0,
      wickets: Number(row.wickets) || 0,
    });
  }

  const bowlerBySource = new Map(bowling.map((row) => [row.sourceName, row]));
  for (const [index, row] of (raw.batting || []).entries()) {
    const target = batting[index];
    if (!target) continue;
    const bowlerSource = row.dismissal?.bowler;
    if (!bowlerSource) continue;
    const bowler = bowlerBySource.get(bowlerSource);
    if (!bowler) {
      errors.push(`${where} batting row ${index + 1} "${row.name}": bowler "${bowlerSource}" is not in the bowling card`);
      continue;
    }
    target.dismissedBy = bowler.player;
    if (!target.dismissalText && target.dismissalType) {
      target.dismissalText = `${target.dismissalType} b ${bowlerSource}`;
    }
  }

  const battingBySource = new Map(batting.map((row) => [row.sourceName, row]));
  const fallOfWickets = [];
  for (const [index, row] of (raw.fallOfWickets || []).entries()) {
    const batter = battingBySource.get(row.player);
    if (!batter) {
      errors.push(`${where} fall of wicket ${index + 1}: batter "${row.player}" is not in the batting card`);
      continue;
    }
    fallOfWickets.push({
      runs: Number(row.runs) || 0,
      wickets: Number(row.wickets) || 0,
      player: batter.player,
      overs: String(row.overs ?? ""),
    });
  }

  const extras = {
    wides: Number(raw.extras?.wides) || 0,
    noBalls: Number(raw.extras?.noBalls) || 0,
    byes: Number(raw.extras?.byes) || 0,
    legByes: Number(raw.extras?.legByes) || 0,
    penalties: Number(raw.extras?.penalties) || 0,
  };
  const checked = inningsChecks(raw, bowling, batting, extras, totalOvers);
  errors.push(...checked.errors);
  notes.push(...checked.notes);
  if (fallOfWickets.length !== Number(raw.wickets)) {
    errors.push(`${where}: ${fallOfWickets.length} fall(s) of wicket recorded, expected ${raw.wickets}`);
  }
  for (let index = 1; index < fallOfWickets.length; index += 1) {
    if (fallOfWickets[index].runs < fallOfWickets[index - 1].runs) {
      errors.push(`${where}: fall-of-wicket runs must not decrease`);
    }
    if (fallOfWickets[index].wickets <= fallOfWickets[index - 1].wickets) {
      errors.push(`${where}: fall-of-wicket wicket numbers must increase`);
    }
  }

  return {
    errors,
    notes,
    mapping: rowMappings,
    checks: checked.checks,
    innings: {
      team: squadKey(battingTeam),
      runs: Number(raw.runs) || 0,
      wickets: Number(raw.wickets) || 0,
      overs: String(raw.overs ?? ""),
      extras,
      batting,
      bowling,
      fallOfWickets,
    },
  };
}

async function buildPlan({ data, mapping, tournament, match, teams }) {
  const errors = [];
  const notes = [];
  const createSpecs = [];
  const squadByTeam = {};
  const squads = new Map();
  for (const team of teams) {
    const squad = await loadSquad(team);
    squads.set(squadKey(team), squad);
    if (squad.warning) notes.push(`${team.name}: ${squad.warning}`);
  }

  const teamA = resolveTeamByName(teams, data.match.teamA);
  const teamB = resolveTeamByName(teams, data.match.teamB);
  if (teamA.error || teamB.error) {
    errors.push(...[teamA.error, teamB.error].filter(Boolean));
  }
  if (!teamA.team || !teamB.team) {
    return { errors, notes, innings: [], mapping: [], payload: null, validator: null, createSpecs, squads };
  }

  const expectedTeams = new Set([squadKey(teamA.team), squadKey(teamB.team)]);
  const actualTeams = new Set((match.teams || []).map(idOf));
  if (
    actualTeams.size !== 2 ||
    [...expectedTeams].some((id) => !actualTeams.has(id))
  ) {
    errors.push(
      `SF1 fixture teams are ${(match.teams || []).map(idOf).join(", ") || "(missing)"}; expected ${data.match.teamA} and ${data.match.teamB}`,
    );
  }

  const inningsPlans = [];
  for (const raw of data.innings) {
    const plan = buildInningsPlan(raw, {
      teams,
      squads,
      mapping,
      totalOvers: Number(data.match.totalOvers) || 20,
      createSpecs,
    });
    inningsPlans.push(plan);
    errors.push(...plan.errors);
    notes.push(...plan.notes);
  }

  const toss = resolveTeamByName([teamA.team, teamB.team], data.match.tossWinner);
  if (toss.error) errors.push(`toss winner: ${toss.error}`);
  const resultWinner = resolveTeamByName([teamA.team, teamB.team], data.result?.winner);
  if (resultWinner.error) errors.push(`result winner: ${resultWinner.error}`);

  const payload = {
    tournamentId: idOf(tournament),
    stage: data.match.stage,
    stageLabel: data.match.stageLabel,
    round: match.round || data.match.stageLabel,
    teamA: idOf(match.teams?.[0]),
    teamB: idOf(match.teams?.[1]),
    startAt: match.startAt ? new Date(match.startAt).toISOString() : data.match.startAt,
    totalOvers: Number(data.match.totalOvers) || 20,
    venue: match.venue || data.match.venue || "",
    title: data.match.title || match.title,
    matchCategory: data.match.matchCategory || match.matchCategory || "Club",
    tossWinner: toss.team ? squadKey(toss.team) : "",
    tossDecision: data.match.tossDecision || "",
    draft: true,
    innings: inningsPlans.map((plan) => plan.innings).filter(Boolean),
    result: {
      resultType: data.result?.resultType || "normal",
      winner: resultWinner.team ? squadKey(resultWinner.team) : "",
      margin: data.result?.margin || "",
      note: data.result?.note || "",
    },
    manOfMatch: data.manOfMatch || "",
  };

  for (const squad of squads.values()) {
    squadByTeam[squadKey(squad.team)] = squad.players.map((player) => String(player._id));
  }
  const validator = validateManualScorecard(payload, {
    teamIds: [idOf(match.teams?.[0]), idOf(match.teams?.[1])],
    totalOvers: payload.totalOvers,
    squadByTeam,
    requireComplete: true,
  });
  if (!validator.ok) {
    errors.push(
      ...validator.errors.map((error) => `manual validator ${error.path}: ${error.message}`),
    );
  }

  return {
    errors,
    notes,
    innings: inningsPlans,
    mapping: inningsPlans.flatMap((plan) => plan.mapping || []),
    payload,
    validator,
    createSpecs,
    squads,
  };
}

function printValidationTable(plan, log) {
  log("");
  log("Validation table:");
  for (const inningsPlan of plan.innings || []) {
    if (!inningsPlan.checks) {
      log(`  Innings ${inningsPlan.innings?.team || "?"}: FAIL (not validated)`);
      continue;
    }
    const c = inningsPlan.checks;
    const status = inningsPlan.errors.length ? "FAIL" : "OK";
    log(
      `  Innings: batting ${c.battingRuns} + extras ${c.extrasTotal} = ${c.total} (declared ${inningsPlan.innings.runs}); ` +
        `bowling ${c.bowlingRuns} + byes/leg-byes ${c.byes}/${c.legByes} = ${c.bowlingTotal} (declared ${inningsPlan.innings.runs}); ` +
        `overs ${c.overs} (${c.bowlingBalls}/${c.inningsBalls} balls); ` +
        `wickets ${c.wickets} (bowler ${c.bowlingWickets} + run out ${c.runOuts}); ` +
        `boundaries OK — ${status}`,
    );
  }
  for (const note of plan.notes || []) log(`  note: ${note}`);
}

function printNameMap(plan, log) {
  log("");
  log("Name map:");
  for (const row of plan.mapping || []) {
    if (row.error) {
      log(`  [${row.role}] "${row.sourceName}" -> UNRESOLVED: ${row.error}`);
    } else {
      log(
        `  [${row.role}] "${row.sourceName}" -> ${row.player.name}${row.player.placeholder ? " (placeholder)" : ""} (${row.reason})`,
      );
    }
  }
}

function printPlaceholders(placeholders, log) {
  if (!placeholders) return;
  const rows = [
    ...(placeholders.wouldCreate || []).map((row) => `would create ${row.name} in ${row.team}`),
    ...(placeholders.created || []).map((row) => `created ${row.name} in ${row.team} -> ${row.id}`),
    ...(placeholders.reused || []).map((row) => `reused ${row.name} in ${row.team} -> ${row.id}`),
  ];
  if (!rows.length) return;
  log("");
  log("Placeholder players:");
  for (const row of rows) log(`  ${row}`);
}

function printHeader({ apply, data, databaseName, forceTest, tournament, match }, log) {
  log("");
  log("=== All Baldia T20 SF1 import ======================================");
  log(`  Mode        : ${apply ? "APPLY" : "DRY RUN (no writes)"}`);
  log(`  Data file   : ${DATA_FILE}`);
  log(`  Name map    : ${NAME_MAP_FILE}`);
  log(`  Database    : ${databaseName}${forceTest ? " (test/e2e guard bypassed with --force-test)" : ""}`);
  log(`  Tournament  : ${tournament ? `${tournament.name} (${tournament._id})` : `MISSING "${data.tournamentName}"`}`);
  if (match) {
    log(
      `  SF1 fixture : ${match._id}  ${match.title || ""}  status=${match.status} source=${match.source} draft=${match.manualDraft === true}`,
    );
  }
}

function printPlan(plan, { match, data }, log, placeholders = null) {
  log("");
  log("Plan:");
  log(`  UPDATE match ${match._id} in place (same _id, same Tournament.matches link)`);
  log(`  source live -> manual, manualDraft true, status upcoming`);
  log(`  stage=${data.match.stage} stageLabel=${data.match.stageLabel} teams=${data.match.teamA} vs ${data.match.teamB}`);
  log(`  toss=${data.match.tossWinner} elected to ${data.match.tossDecision}`);
  log(
    `  result=${data.result.winner} by ${data.result.margin} (${data.result.resultType}) — draft only, not published`,
  );
  log(`  man of the match: ${data.manOfMatch ? data.manOfMatch : "(empty)"}`);
  const creates = [...new Map(plan.createSpecs.map((row) => [`${row.teamId}:${row.name}`, row])).values()];
  if (creates.length) {
    log("  CREATE players:");
    for (const row of creates) log(`    ${row.name} -> ${row.teamName}`);
  } else {
    log("  CREATE players: none");
  }
  printValidationTable(plan, log);
  printNameMap(plan, log);
  printPlaceholders(placeholders, log);
}

function printBlockers(errors, log) {
  log("");
  log(`BLOCKED (${errors.length}) — nothing was written:`);
  for (const error of errors) log(`  - ${error}`);
}

async function findTournament(data) {
  const tournaments = await Tournament.find({
    name: { $regex: `^${escapeRegex(data.tournamentName)}$`, $options: "i" },
  })
    .select("name type format teams matches")
    .lean();
  if (tournaments.length === 1) return tournaments[0];
  if (!tournaments.length) throw new Error(`tournament "${data.tournamentName}" was not found; this script never creates it`);
  throw new Error(`${tournaments.length} tournaments match "${data.tournamentName}"; refusing to guess`);
}

async function findSf1(tournament, data) {
  const matches = await Match.find({
    tournament: tournament._id,
    stage: data.match.stage,
    stageLabel: data.match.stageLabel,
  }).select(
    "title matchNumber venue matchType totalOvers matchCategory matchSubcategory round stage stageLabel tournament teams innings status source manualDraft result tossWinner tossDecision startAt",
  );
  if (matches.length === 1) return matches[0];
  if (!matches.length) {
    throw new Error(
      `no ${data.match.stageLabel} fixture exists for "${data.match.stage}"; this script never creates the bracket slot`,
    );
  }
  throw new Error(
    `${matches.length} fixtures use ${data.match.stageLabel}; refusing to guess which one (${matches
      .map((match) => match._id)
      .join(", ")})`,
  );
}

async function loadTournamentTeams(tournament) {
  const ids = (tournament.teams || []).map(idOf).filter(Boolean);
  if (!ids.length) return [];
  return Team.find({ _id: { $in: ids } }).select("name shortName players").lean();
}

function postCheck(saved, { match, tournament, data }) {
  const errors = [];
  if (String(saved._id) !== String(match._id)) errors.push("_id changed");
  if (saved.source !== "manual") errors.push(`source is ${saved.source}, expected manual`);
  if (saved.manualDraft !== true) errors.push(`manualDraft is ${saved.manualDraft}, expected true`);
  if (saved.status !== "upcoming") errors.push(`status is ${saved.status}, expected upcoming`);
  if (saved.stage !== data.match.stage) errors.push(`stage is ${saved.stage}`);
  if (saved.stageLabel !== data.match.stageLabel) errors.push(`stageLabel is ${saved.stageLabel}`);
  if (String(saved.tournament) !== String(tournament._id)) errors.push("tournament link changed");
  const savedTeams = new Set((saved.teams || []).map(idOf));
  if (
    savedTeams.size !== 2 ||
    !savedTeams.has(idOf(match.teams?.[0])) ||
    !savedTeams.has(idOf(match.teams?.[1]))
  ) {
    errors.push("teams changed");
  }
  if (String(saved.startAt?.toISOString?.() || saved.startAt) !== String(match.startAt?.toISOString?.() || match.startAt)) {
    errors.push("startAt changed");
  }
  if (String(saved.venue || "") !== String(match.venue || "")) errors.push("venue changed");
  return errors;
}

async function verifyLinked(matchId, tournamentId) {
  const fresh = await Tournament.findById(tournamentId).select("matches").lean();
  return (fresh?.matches || []).some((id) => idOf(id) === idOf(matchId));
}

/**
 * Run the import against an open mongoose connection. Exported for tests.
 * `log` defaults to console.log; pass a no-op to keep test output quiet.
 */
export async function runImportSf1Result({
  apply = false,
  log = console.log,
  data: injectedData = null,
  nameMap: injectedNameMap = null,
  databaseName = "",
  forceTest = false,
} = {}) {
  const { data, mapping } = injectedData
    ? { data: injectedData, mapping: injectedNameMap || {} }
    : loadImportFiles();
  const report = { apply, outcome: "DRY_RUN", blocked: false, plan: null, placeholders: null };

  const tournament = await findTournament(data);
  const match = await findSf1(tournament, data);
  printHeader({ apply, data, databaseName, forceTest, tournament, match }, log);

  if (match.source === "manual") {
    log("");
    log(
      `SKIP ${data.match.stageLabel} ${match._id}: already a manual scorecard (draft=${match.manualDraft === true}, status=${match.status}). Nothing to do.`,
    );
    report.outcome = "SKIP";
    return report;
  }
  if (match.source !== "live") {
    report.blocked = true;
    printBlockers([`fixture source is "${match.source}", expected "live"`], log);
    return report;
  }
  if (!isEmptyUpcomingFixture(match)) {
    report.blocked = true;
    printBlockers(
      [
        `fixture is not an empty upcoming fixture (status=${match.status}); refusing to overwrite scoring data`,
      ],
      log,
    );
    return report;
  }

  const [ballCount, deliveryCount] = await Promise.all([
    Ball.countDocuments({ matchId: match._id }),
    Delivery.countDocuments({ matchId: match._id }),
  ]);
  if (ballCount || deliveryCount) {
    report.blocked = true;
    printBlockers(
      [`fixture already has ${ballCount} ball(s) and ${deliveryCount} delivery record(s); refusing to overwrite`],
      log,
    );
    return report;
  }

  if (!(await verifyLinked(match._id, tournament._id))) {
    report.blocked = true;
    printBlockers(
      [`fixture ${match._id} is not linked from Tournament.matches; refusing to convert`],
      log,
    );
    return report;
  }

  const teams = await loadTournamentTeams(tournament);
  let plan = await buildPlan({ data, mapping, tournament, match, teams });
  report.plan = plan;
  if (plan.errors.length) {
    report.blocked = true;
    printPlan(plan, { match, data }, log);
    printBlockers(plan.errors, log);
    return report;
  }

  if (!apply) {
    const placeholders = await ensurePlaceholderPlayers(plan.createSpecs, { dryRun: true });
    report.placeholders = placeholders;
    if (placeholders.errors.length) {
      report.blocked = true;
      printPlan(plan, { match, data }, log, placeholders);
      printBlockers(placeholders.errors, log);
      return report;
    }
    printPlan(plan, { match, data }, log, placeholders);
    log("");
    log("Dry run complete. Nothing was written.");
    return report;
  }

  // Apply: validate first, then create only the explicitly mapped placeholders,
  // then rebuild with their real ids and validate again before converting.
  let placeholders = await ensurePlaceholderPlayers(plan.createSpecs, { dryRun: false });
  report.placeholders = placeholders;
  if (placeholders.errors.length) {
    report.blocked = true;
    printPlan(plan, { match, data }, log, placeholders);
    printBlockers(placeholders.errors, log);
    return report;
  }
  if (placeholders.created.length || placeholders.reused.length) {
    const refreshedTeams = await loadTournamentTeams(tournament);
    plan = await buildPlan({ data, mapping, tournament, match, teams: refreshedTeams });
    report.plan = plan;
    if (plan.errors.length) {
      report.blocked = true;
      printPlan(plan, { match, data }, log, placeholders);
      printBlockers(plan.errors, log);
      return report;
    }
  }

  printPlan(plan, { match, data }, log, placeholders);
  const result = await convertUpcomingFixtureToManualDraft(match._id, plan.payload);
  if (!result.ok) {
    report.blocked = true;
    const errors = result.errors
      ? result.errors.map((error) => `${error.path}: ${error.message}`)
      : [result.message || "conversion failed"];
    printBlockers(errors, log);
    return report;
  }

  const saved = await Match.findById(match._id);
  const postErrors = postCheck(saved, { match, tournament, data });
  if (!(await verifyLinked(match._id, tournament._id))) postErrors.push("Tournament.matches link lost");
  if (postErrors.length) {
    throw new Error(`post-write verification failed: ${postErrors.join("; ")}`);
  }

  report.outcome = "APPLIED";
  log("");
  log("APPLIED — DRAFT only (nothing was published).");
  log(`  match      : ${saved._id}`);
  log(`  tournament : ${saved.tournament} (still linked)`);
  log(`  scorecard  : ${data.match.teamA} ${plan.innings[0]?.innings?.runs}/${plan.innings[0]?.innings?.wickets} vs ${data.match.teamB} ${plan.innings[1]?.innings?.runs}/${plan.innings[1]?.innings?.wickets}`);
  log(`  result     : ${data.result.winner} won by ${data.result.margin}`);
  log(`  visibility : manualDraft=true, status=upcoming — hidden until Publish`);
  return report;
}

function argValue(argv, flag) {
  const withEquals = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (withEquals) return withEquals.slice(flag.length + 1);
  const index = argv.indexOf(flag);
  return index !== -1 && argv[index + 1] && !argv[index + 1].startsWith("--")
    ? argv[index + 1]
    : "";
}

export async function main(argv = process.argv) {
  const args = argv.slice(2);
  const apply = args.includes("--apply");
  const forceTest = args.includes("--force-test");
  if (apply && args.includes("--dry-run")) {
    throw new Error("Pass either --apply or --dry-run, not both.");
  }
  const unknown = args.filter((arg) => !["--apply", "--dry-run", "--force-test"].includes(arg));
  if (unknown.length) throw new Error(`Unknown option(s): ${unknown.join(", ")}`);

  const uri = process.env.MONGO_URL;
  if (!uri) throw new Error("MONGO_URL is not set. The script never prints or accepts the URI on the command line.");
  const { databaseName } = getMongoTarget(uri);
  if (!databaseName) throw new Error("MONGO_URL has no explicit database name.");
  if (isTestTarget(databaseName) && !forceTest) {
    throw new Error(
      `Refusing a test/e2e database (${databaseName}${process.env.NODE_ENV === "test" ? ", NODE_ENV=test" : ""}). Pass --force-test only for a throwaway local database.`,
    );
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });
  try {
    const report = await runImportSf1Result({ apply, databaseName, forceTest });
    if (report.blocked) process.exitCode = 1;
    return report;
  } finally {
    await mongoose.disconnect();
  }
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error("");
    console.error(`REFUSING TO RUN: ${error.message}`);
    process.exitCode = 1;
  });
}
