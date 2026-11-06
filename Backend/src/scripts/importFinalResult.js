// Import the All Baldia T20 Final result (Sky Sports vs Young Star) as a DRAFT
// manual scorecard on the EXISTING final fixture. The fixture is converted in
// place: same _id, same tournament link, same bracket slot.
//
//   node src/scripts/importFinalResult.js                 # dry run (default)
//   node src/scripts/importFinalResult.js --apply         # write the draft
//   node src/scripts/importFinalResult.js --force-test    # allow a test/e2e DB
//
// Safety and scope
// ---------------
//   * Dry run by default; --apply is the only way to write.
//   * Finds the tournament by name and the Final by tournament + stage +
//     stageLabel; refuses to create a second Final or a missing fixture.
//   * Verifies the fixture _id and that its two teams are Sky Sports and
//     Young Star.
//   * Refuses anything that is not an empty upcoming live fixture and refuses
//     to overwrite ball-by-ball/live scoring data. It never publishes: the
//     result is written with manualDraft=true and status="upcoming".
//   * NEVER creates a player. Every source name (batter, bowler, fielder, man
//     of the match) must resolve to exactly one existing player in the correct
//     tournament squad. A missing or ambiguous name is printed with candidates
//     and BLOCKS the write. "CREATE:" mappings are rejected.
//   * Young Star batted first and Sky Sports chased. The fixture document
//     lists Sky Sports first, but the stored team/innings order is Young Star
//     then Sky Sports so the Admin manual editor opens with Team A / innings 1
//     = Young Star. The public title/date/venue are preserved.
//   * Re-running is idempotent: an existing manual Final is SKIPped.
//   * Match specifics live only in data/finalResult.json and
//     data/finalNameMap.json.
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
  formatOvers,
  normalizeDismissalType,
} from "../services/manualScorecard.js";
import { isTestTarget } from "./createSemiFinals.js";
import { getMongoTarget } from "../utils/mongoTarget.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(SCRIPT_DIR, "../..");
dotenv.config({ path: path.join(BACKEND_ROOT, ".env"), quiet: true });

mongoose.set("autoIndex", false);

export const DATA_FILE = path.join(SCRIPT_DIR, "data", "finalResult.json");
export const NAME_MAP_FILE = path.join(SCRIPT_DIR, "data", "finalNameMap.json");
export const CREATE_PREFIX = "CREATE:";

const idOf = (value) => String(value?._id || value || "");
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const normalizeName = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const isCreateMapping = (value) =>
  typeof value === "string" && value.trim().toUpperCase().startsWith(CREATE_PREFIX);

export function mappingFor(mapping, teamName, sourceName) {
  if (!mapping) return undefined;
  const scoped = mapping[`${teamName}::${sourceName}`];
  if (scoped !== undefined) return scoped;
  const plain = mapping[sourceName];
  return plain !== undefined ? plain : undefined;
}

function mappingValues(mapping, teamName, sourceName) {
  const value = mappingFor(mapping, teamName, sourceName);
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? value : [value];
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
  const data = loadJsonFile(dataFile, "Final result data");
  const mapping = loadJsonFile(nameMapFile, "Final name map");
  if (!data.tournamentName) throw new Error("finalResult.json has no tournamentName.");
  if (!data.match?.stage || !data.match?.stageLabel) {
    throw new Error("finalResult.json has no match.stage/stageLabel.");
  }
  if (!Array.isArray(data.innings) || data.innings.length !== 2) {
    throw new Error("finalResult.json must contain exactly two innings.");
  }
  if (
    data.match.storageTeamOrder !== undefined &&
    (!Array.isArray(data.match.storageTeamOrder) || data.match.storageTeamOrder.length !== 2)
  ) {
    throw new Error("finalResult.json match.storageTeamOrder must list exactly two teams.");
  }
  return { data, mapping, dataFile, nameMapFile };
}

function squadKey(team) {
  return String(team?._id || team);
}

const playerTeamId = (player) => String(player?.team?._id || player?.team || "");

export async function loadSquad(team) {
  const teamId = squadKey(team);
  const rosterIds = (team.players || []).map(idOf).filter(Boolean);
  let rosterPlayers = rosterIds.length
    ? await Player.find({ _id: { $in: rosterIds } }).select("name team").lean()
    : [];
  let players = rosterPlayers.filter((player) => playerTeamId(player) === teamId);
  let source = "Team.players";
  let warning = "";
  if (rosterPlayers.length) {
    const byId = new Map(rosterPlayers.map((player) => [String(player._id), player]));
    const missing = rosterIds.filter((id) => !byId.has(id));
    const foreign = rosterPlayers.length - players.length;
    const messages = [];
    if (foreign) messages.push(`${foreign} Team.players id(s) belong to another team and were ignored`);
    if (missing.length) messages.push(`${missing.length} Team.players id(s) have no Player document and were ignored`);
    warning = messages.join("; ");
  }
  if (!players.length) {
    players = await Player.find({ team: team._id }).select("name team").lean();
    source = "Player.team fallback";
    if (players.length) {
      warning = `${warning ? `${warning}; ` : ""}used Player.team roster instead`;
    }
  }
  return {
    team,
    source,
    warning,
    players: players
      .filter((player) => player && player.name && playerTeamId(player) === teamId)
      .map((player) => ({ _id: String(player._id), name: player.name, team: playerTeamId(player) }))
      .sort((a, b) => normalizeName(a.name).localeCompare(normalizeName(b.name))),
  };
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

function squadCandidates(squad) {
  return (squad.players || []).map((player) => player.name);
}

function resolveSquadPlayer(squad, name) {
  const wanted = normalizeName(name);
  const teamId = squadKey(squad.team);
  const matches = (squad.players || []).filter(
    (player) => normalizeName(player.name) === wanted && playerTeamId(player) === teamId,
  );
  if (matches.length === 1) return { player: matches[0] };
  if (!matches.length) return { error: `"${name}" was not found in ${squad.team.name}'s squad` };
  return {
    error: `"${name}" is ambiguous in ${squad.team.name}'s squad (${matches
      .map((player) => player.name)
      .join(", ")})`,
  };
}

function findSquadPlayerOnOtherTeam(squads, expectedTeamId, name) {
  const wanted = normalizeName(name);
  for (const squad of squads.values()) {
    if (squadKey(squad.team) === expectedTeamId) continue;
    const player = (squad.players || []).find((row) => normalizeName(row.name) === wanted);
    if (player) return { player, team: squad.team };
  }
  return null;
}

/**
 * Resolve one source name to exactly one existing squad player. A mapping value
 * may be a string or an array of acceptable existing names; arrays let an
 * uncertain live name match whichever one of two spellings the squad carries,
 * but more than one match is an ambiguity and BLOCKS.
 */
function mapSourceName({ sourceName, squad, squads, mapping, role, inningsLabel }) {
  const expectedTeam = squad.team;
  const expectedTeamId = squadKey(expectedTeam);
  const values = mappingValues(mapping, expectedTeam.name, sourceName);
  const row = {
    role,
    innings: inningsLabel,
    sourceName,
    team: expectedTeam.name,
    teamId: expectedTeamId,
  };

  if (values.some((value) => isCreateMapping(value))) {
    return {
      ...row,
      error: `name map for "${sourceName}" uses a CREATE: value; this importer never creates players`,
      candidates: squadCandidates(squad),
    };
  }

  if (values.length) {
    const matched = new Map();
    const ambiguous = [];
    for (const rawTarget of values) {
      const target = String(rawTarget ?? "").trim();
      if (!target) continue;
      const resolved = resolveSquadPlayer(squad, target);
      if (resolved.player) matched.set(resolved.player._id, resolved.player);
      else if (resolved.error && /is ambiguous/.test(resolved.error)) ambiguous.push(resolved.error);
    }
    if (ambiguous.length) {
      return { ...row, error: ambiguous.join("; "), candidates: squadCandidates(squad) };
    }
    if (matched.size === 1) {
      return { ...row, player: [...matched.values()][0], reason: "name map" };
    }
    if (matched.size > 1) {
      return {
        ...row,
        error: `name map for "${sourceName}" matches more than one ${expectedTeam.name} player (${[
          ...matched.values(),
        ]
          .map((player) => player.name)
          .join(", ")})`,
        candidates: squadCandidates(squad),
      };
    }
    const other = values
      .map((value) => findSquadPlayerOnOtherTeam(squads, expectedTeamId, value))
      .find(Boolean);
    if (other) {
      return {
        ...row,
        error: `name map for "${sourceName}" points to player "${other.player.name}" of ${other.team.name}; expected a player in ${expectedTeam.name}`,
        candidates: squadCandidates(squad),
      };
    }
    return {
      ...row,
      error: `name map for "${sourceName}" did not match any ${expectedTeam.name} player (tried: ${values
        .map((value) => String(value))
        .join(", ")})`,
      candidates: squadCandidates(squad),
    };
  }

  const resolved = resolveSquadPlayer(squad, sourceName);
  if (resolved.player) return { ...row, player: resolved.player, reason: "exact squad name" };
  if (resolved.error && /is ambiguous/.test(resolved.error)) {
    return { ...row, error: resolved.error, candidates: squadCandidates(squad) };
  }
  const other = findSquadPlayerOnOtherTeam(squads, expectedTeamId, sourceName);
  if (other) {
    return {
      ...row,
      error: `"${sourceName}" belongs to ${other.team.name}, not ${expectedTeam.name}`,
      candidates: squadCandidates(squad),
    };
  }
  return {
    ...row,
    error: `"${sourceName}" was not found in ${expectedTeam.name}'s squad`,
    candidates: squadCandidates(squad),
  };
}

/** Resolve the man of the match against both squads; must be unique overall. */
function resolveManOfMatch(sourceName, squads, mapping) {
  if (!sourceName) return { player: null };
  const allPlayers = [...squads.values()].flatMap((squad) => squad.players);
  const wanted = normalizeName(sourceName);
  const direct = allPlayers.filter((player) => normalizeName(player.name) === wanted);
  if (direct.length === 1) return { player: direct[0], reason: "exact squad name" };
  if (direct.length > 1) {
    return {
      error: `man of the match "${sourceName}" is ambiguous across the two squads (${direct
        .map((player) => player.name)
        .join(", ")})`,
      candidates: [...new Set(allPlayers.map((player) => player.name))],
    };
  }

  const matched = new Map();
  for (const squad of squads.values()) {
    for (const rawTarget of mappingValues(mapping, squad.team.name, sourceName)) {
      if (isCreateMapping(rawTarget)) {
        return {
          error: `man of the match "${sourceName}" uses a CREATE: mapping; this importer never creates players`,
          candidates: [...new Set(allPlayers.map((player) => player.name))],
        };
      }
      const resolved = allPlayers.filter(
        (player) => normalizeName(player.name) === normalizeName(rawTarget),
      );
      for (const player of resolved) matched.set(player._id, player);
    }
  }
  if (matched.size === 1) return { player: [...matched.values()][0], reason: "name map" };
  if (matched.size > 1) {
    return {
      error: `man of the match "${sourceName}" is ambiguous (${[...matched.values()]
        .map((player) => player.name)
        .join(", ")})`,
      candidates: [...new Set(allPlayers.map((player) => player.name))],
    };
  }
  return {
    error: `man of the match "${sourceName}" did not match exactly one existing player`,
    candidates: [...new Set(allPlayers.map((player) => player.name))],
  };
}

function buildDismissalText(row, dismissalType) {
  if (!dismissalType) return "";
  const bowler = row.dismissal?.bowler || "";
  const fielder = row.dismissal?.fielder || "";
  if (dismissalType === "caught") {
    return fielder ? `caught ${fielder} b ${bowler}` : `caught b ${bowler}`;
  }
  if (dismissalType === "stumped") {
    return fielder ? `stumped ${fielder} b ${bowler}` : `stumped b ${bowler}`;
  }
  if (dismissalType === "run out") {
    return fielder ? `run out (${fielder})` : "run out";
  }
  if (dismissalType === "bowled") return `bowled b ${bowler}`;
  if (dismissalType === "lbw") return `lbw b ${bowler}`;
  return bowler ? `${dismissalType} b ${bowler}` : dismissalType;
}

function creditedWickets(batting) {
  const counts = new Map();
  for (const row of batting) {
    if (!row.isOut || row.dismissalType === "run out" || !row.dismissedBy) continue;
    counts.set(row.dismissedBy, (counts.get(row.dismissedBy) || 0) + 1);
  }
  return counts;
}

function inningsChecks(raw, bowling, batting, extras, totalOvers) {
  const errors = [];
  const notes = [];
  const validations = [];
  const add = (label, ok, detail) => {
    validations.push({ label, ok, detail });
    if (!ok) errors.push(`${label}: ${detail}`);
  };

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
  const credited = creditedWickets(batting);

  const inningsOvers = parseOvers(raw.overs);
  add(
    "innings overs valid",
    inningsOvers.valid,
    inningsOvers.valid ? `"${raw.overs}" = ${inningsOvers.balls} legal balls` : inningsOvers.reason,
  );

  let bowlingBalls = 0;
  let bowlingOversValid = true;
  for (const row of bowling) {
    const parsed = parseOvers(row.overs);
    if (!parsed.valid) {
      bowlingOversValid = false;
      errors.push(`bowler ${row.name} overs: ${parsed.reason}`);
      continue;
    }
    bowlingBalls += parsed.balls;
  }
  add(
    "bowler overs valid",
    bowlingOversValid,
    bowlingOversValid ? "every bowler over figure is valid" : "one or more bowler over figures are invalid",
  );

  add(
    "batting + extras = total",
    battingRuns + extrasTotal === Number(raw.runs),
    `batting ${battingRuns} + extras ${extrasTotal} = ${battingRuns + extrasTotal}, expected ${raw.runs}`,
  );
  add(
    "bowler runs + byes/leg-byes = total",
    bowlingRuns + byes + legByes === Number(raw.runs),
    `bowler runs ${bowlingRuns} + byes ${byes} + leg byes ${legByes} = ${
      bowlingRuns + byes + legByes
    }, expected ${raw.runs}`,
  );
  add(
    "bowler overs = innings overs",
    inningsOvers.valid && bowlingBalls === inningsOvers.balls,
    `bowler overs total ${bowlingBalls} ball(s), innings says ${
      inningsOvers.valid ? inningsOvers.balls : "?"
    } ball(s)`,
  );
  add(
    "wicket count",
    wickets === Number(raw.wickets),
    `batting card has ${wickets} wicket(s), innings says ${raw.wickets}`,
  );
  add(
    "bowler wickets + run outs = wickets",
    bowlingWickets + runOuts === Number(raw.wickets),
    `bowler wickets ${bowlingWickets} + run out(s) ${runOuts} = ${
      bowlingWickets + runOuts
    }, expected ${raw.wickets}`,
  );
  add(
    "innings overs within quota",
    !inningsOvers.valid || inningsOvers.overs <= Number(totalOvers),
    `innings ${raw.overs} must not exceed the ${totalOvers}-over quota`,
  );

  const boundaryErrors = [];
  for (const row of batting) {
    if (Number(row.fours) * 4 + Number(row.sixes) * 6 > Number(row.runs)) {
      boundaryErrors.push(
        `"${row.name}" boundary runs ${Number(row.fours) * 4 + Number(row.sixes) * 6} exceed ${
          row.runs
        } run(s)`,
      );
    }
  }
  add(
    "boundaries",
    boundaryErrors.length === 0,
    boundaryErrors.length ? boundaryErrors.join("; ") : "4s and 6s fit inside every batter's runs",
  );

  const missingBowler = batting.filter(
    (row) => row.isOut && row.dismissalType !== "run out" && !row.dismissedBy,
  );
  add(
    "every non-run-out dismissal has a bowler",
    missingBowler.length === 0,
    missingBowler.length
      ? `missing bowler for ${missingBowler.map((row) => row.name).join(", ")}`
      : "all credited dismissals reference a bowler",
  );

  const wicketMismatches = bowling
    .filter((row) => (credited.get(row.player) || 0) !== Number(row.wickets))
    .map(
      (row) =>
        `${row.name} card says ${row.wickets} wicket(s), dismissals credit ${
          credited.get(row.player) || 0
        }`,
    );
  add(
    "per-bowler credited wickets",
    wicketMismatches.length === 0,
    wicketMismatches.length ? wicketMismatches.join("; ") : "each bowler's wickets match the dismissals",
  );

  if (ballsFaced !== (inningsOvers.valid ? inningsOvers.balls : 0)) {
    notes.push(
      `batters faced ${ballsFaced} ball(s) vs ${
        inningsOvers.valid ? inningsOvers.balls : "?"
      } legal ball(s) bowled (informational only)`,
    );
  }

  return {
    errors,
    notes,
    validations,
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

/**
 * Partnerships are source-only validation data (the manual schema does not
 * store them). Each partnership must add up to the matching fall of wicket,
 * name the outgoing batter, keep the survivor in the next pair, and sum to the
 * innings total/balls.
 */
function validatePartnerships(raw, batting) {
  const partnerships = raw.partnerships || [];
  if (!partnerships.length) return { errors: [], notes: [], validation: null };
  const errors = [];
  const notes = [];
  const battingNames = new Set(batting.map((row) => row.sourceName));
  const fow = raw.fallOfWickets || [];

  if (partnerships.length !== fow.length + 1) {
    errors.push(
      `${partnerships.length} partnerships recorded, expected ${fow.length + 1} (one per wicket plus the unbroken stand)`,
    );
  }

  let runs = 0;
  let balls = 0;
  for (const [index, partnership] of partnerships.entries()) {
    const pair = Array.isArray(partnership.batters) ? partnership.batters : [];
    if (pair.length !== 2 || pair[0] === pair[1]) {
      errors.push(`partnership ${index + 1}: needs two different batters`);
      continue;
    }
    for (const name of pair) {
      if (!battingNames.has(name)) {
        errors.push(`partnership ${index + 1}: batter "${name}" is not in the batting card`);
      }
    }

    runs += Number(partnership.runs) || 0;
    balls += Number(partnership.balls) || 0;
    const wicket = fow[index];
    if (!wicket) {
      if (partnership.out) {
        errors.push(`partnership ${index + 1}: unbroken stand cannot have an outgoing batter`);
      }
      continue;
    }

    if (runs !== Number(wicket.runs)) {
      errors.push(
        `partnership ${index + 1}: cumulative runs ${runs} do not equal fall-of-wicket ${wicket.wickets} at ${wicket.runs}`,
      );
    }
    const fallOvers = parseOvers(wicket.overs);
    if (fallOvers.valid && balls !== fallOvers.balls) {
      errors.push(
        `partnership ${index + 1}: cumulative balls ${balls} do not equal fall-of-wicket overs ${wicket.overs} (${fallOvers.balls} balls)`,
      );
    }

    if (!partnership.out) {
      errors.push(`partnership ${index + 1}: missing the outgoing batter who fell at ${wicket.runs}`);
    } else {
      if (!pair.includes(partnership.out)) {
        errors.push(
          `partnership ${index + 1}: outgoing batter "${partnership.out}" is not one of ${pair.join(
            " / ",
          )}`,
        );
      }
      if (normalizeName(partnership.out) !== normalizeName(wicket.player)) {
        errors.push(
          `partnership ${index + 1}: outgoing batter "${partnership.out}" does not match fall-of-wicket batter "${wicket.player}"`,
        );
      }
      const next = partnerships[index + 1];
      const survivor = pair.find((name) => name !== partnership.out);
      if (next && survivor && !next.batters.includes(survivor)) {
        errors.push(
          `partnership ${index + 1}: surviving batter "${survivor}" is missing from partnership ${
            index + 2
          }`,
        );
      }
    }
  }

  if (runs !== Number(raw.runs)) {
    errors.push(`partnership runs ${runs} do not equal the innings total ${raw.runs}`);
  }
  const inningsOvers = parseOvers(raw.overs);
  if (inningsOvers.valid && balls !== inningsOvers.balls) {
    errors.push(
      `partnership balls ${balls} do not equal the innings ${raw.overs} (${inningsOvers.balls} balls)`,
    );
  }

  return {
    errors,
    notes,
    validation: {
      label: "partnerships vs fall of wickets",
      ok: errors.length === 0,
      detail: errors.length
        ? errors[0]
        : `${partnerships.length} partnership(s) sum to ${runs} runs in ${balls} balls and reconcile every fall`,
    },
  };
}

function buildInningsPlan(raw, context) {
  const { teams, squads, mapping, totalOvers } = context;
  const errors = [];
  const notes = [];
  const mappingRows = [];
  const validations = [];
  const where = `innings ${raw.number || ""}`.trim();

  const battingLookup = resolveTeamByName(teams, raw.battingTeam);
  const bowlingLookup = resolveTeamByName(teams, raw.bowlingTeam);
  if (battingLookup.error || bowlingLookup.error) {
    errors.push(
      ...[battingLookup.error, bowlingLookup.error].filter(Boolean).map((error) => `${where}: ${error}`),
    );
    return { errors, notes, innings: null, mapping: mappingRows, validations: [] };
  }
  const battingTeam = battingLookup.team;
  const bowlingTeam = bowlingLookup.team;
  if (squadKey(battingTeam) === squadKey(bowlingTeam)) {
    errors.push(`${where}: batting and bowling teams must be different`);
    return { errors, notes, innings: null, mapping: mappingRows, validations: [] };
  }
  const battingSquad = squads.get(squadKey(battingTeam));
  const bowlingSquad = squads.get(squadKey(bowlingTeam));
  if (!battingSquad?.players?.length) errors.push(`${where}: batting squad for ${battingTeam.name} is empty`);
  if (!bowlingSquad?.players?.length) errors.push(`${where}: bowling squad for ${bowlingTeam.name} is empty`);
  if (errors.length) return { errors, notes, innings: null, mapping: mappingRows, validations: [] };

  validations.push({
    label: `${where} team ownership`,
    ok: true,
    detail: `${battingTeam.name} bats, ${bowlingTeam.name} bowls`,
  });

  const batting = [];
  for (const [index, row] of (raw.batting || []).entries()) {
    const mapped = mapSourceName({
      sourceName: row.name,
      squad: battingSquad,
      squads,
      mapping,
      role: "batting",
      inningsLabel: where,
    });
    mappingRows.push(mapped);
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
      dismissalText: String(row.dismissalText || "").trim() || buildDismissalText(row, dismissalType),
      dismissedBy: null,
      fielder: null,
    });
  }

  const bowling = [];
  const bowlingBySource = new Map();
  for (const [index, row] of (raw.bowling || []).entries()) {
    const mapped = mapSourceName({
      sourceName: row.name,
      squad: bowlingSquad,
      squads,
      mapping,
      role: "bowling",
      inningsLabel: where,
    });
    mappingRows.push(mapped);
    if (mapped.error) {
      errors.push(`${where} bowling row ${index + 1} "${row.name}": ${mapped.error}`);
      continue;
    }
    const bowlingRow = {
      sourceName: row.name,
      player: String(mapped.player._id),
      overs: formatOvers(row.overs),
      maidens: Number(row.maidens) || 0,
      runs: Number(row.runs) || 0,
      wickets: Number(row.wickets) || 0,
    };
    if (bowlingBySource.has(row.name)) {
      errors.push(`${where} bowling row ${index + 1}: duplicate bowler "${row.name}"`);
      continue;
    }
    bowlingBySource.set(row.name, bowlingRow);
    bowling.push(bowlingRow);
  }

  const bowlingPlayerIds = new Set();
  for (const row of bowling) {
    if (bowlingPlayerIds.has(row.player)) {
      errors.push(`${where}: the same player appears twice in the bowling card`);
    }
    bowlingPlayerIds.add(row.player);
  }

  for (const [index, row] of (raw.batting || []).entries()) {
    const target = batting[index];
    if (!target) continue;

    const bowlerSource = row.dismissal?.bowler;
    if (bowlerSource && target.dismissalType !== "run out") {
      // Resolve the dismissal bowler through the same existing-player map, then
      // match the resulting player id to a bowling-card row. This lets the
      // scorebook use "Kamran" for the bowler while the card carries the
      // merged "Kamran Bhai" spell, without duplicating the player.
      const bowlerMapped = mapSourceName({
        sourceName: bowlerSource,
        squad: bowlingSquad,
        squads,
        mapping,
        role: "bowler-ref",
        inningsLabel: where,
      });
      mappingRows.push(bowlerMapped);
      if (bowlerMapped.error) {
        errors.push(
          `${where} batting row ${index + 1} "${row.name}" bowler "${bowlerSource}": ${bowlerMapped.error}`,
        );
      } else {
        const bowler = bowling.find((row) => row.player === String(bowlerMapped.player._id));
        if (!bowler) {
          errors.push(
            `${where} batting row ${index + 1} "${row.name}": bowler "${bowlerSource}" resolves to ${bowlerMapped.player.name} but is not in the bowling card`,
          );
        } else {
          target.dismissedBy = bowler.player;
        }
      }
    }

    const fielderSource = row.dismissal?.fielder;
    if (fielderSource) {
      const fielder = mapSourceName({
        sourceName: fielderSource,
        squad: bowlingSquad,
        squads,
        mapping,
        role: "fielder",
        inningsLabel: where,
      });
      mappingRows.push(fielder);
      if (fielder.error) {
        errors.push(
          `${where} batting row ${index + 1} "${row.name}" fielder "${fielderSource}": ${fielder.error}`,
        );
      } else {
        target.fielder = String(fielder.player._id);
      }
    }
  }

  const battingBySource = new Map(batting.map((row) => [row.sourceName, row]));
  const battingPlayerIds = new Set();
  for (const row of batting) {
    if (battingPlayerIds.has(row.player)) {
      errors.push(`${where}: the same player appears twice in the batting card`);
    }
    battingPlayerIds.add(row.player);
  }

  const fallOfWickets = [];
  for (const [index, row] of (raw.fallOfWickets || []).entries()) {
    let player = null;
    if (row.player) {
      const batter = battingBySource.get(row.player);
      if (!batter) {
        errors.push(`${where} fall of wicket ${index + 1}: batter "${row.player}" is not in the batting card`);
        continue;
      }
      player = batter.player;
    }
    fallOfWickets.push({
      sourceName: row.player,
      runs: Number(row.runs) || 0,
      wickets: Number(row.wickets) || 0,
      player,
      overs: formatOvers(row.overs),
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
  validations.push(...checked.validations);

  const fowSupplied = raw.fallOfWickets !== null && raw.fallOfWickets !== undefined;
  const fowValidation = {
    label: "fall of wickets",
    ok: true,
    detail: `${fallOfWickets.length} fall(s) recorded`,
  };
  if (!fowSupplied) {
    // A null array is an explicit "the source did not supply this"; it is not
    // a contradiction, so it must not block the import. A partial list still
    // has to match the wicket count below.
    fowValidation.detail = `not supplied by the source (${raw.wickets} wicket(s) not cross-checked)`;
    notes.push(`${where}: fall of wickets not supplied by the source; count not validated`);
  } else if (fallOfWickets.length !== Number(raw.wickets)) {
    fowValidation.ok = false;
    fowValidation.detail = `${fallOfWickets.length} fall(s) of wicket recorded, expected ${raw.wickets}`;
    errors.push(`${where}: ${fowValidation.detail}`);
  }
  for (let index = 1; index < fallOfWickets.length; index += 1) {
    if (fallOfWickets[index].runs < fallOfWickets[index - 1].runs) {
      fowValidation.ok = false;
      fowValidation.detail = "fall-of-wicket runs must not decrease";
      errors.push(`${where}: ${fowValidation.detail}`);
      break;
    }
    if (fallOfWickets[index].wickets <= fallOfWickets[index - 1].wickets) {
      fowValidation.ok = false;
      fowValidation.detail = "fall-of-wicket wicket numbers must increase";
      errors.push(`${where}: ${fowValidation.detail}`);
      break;
    }
  }
  validations.push(fowValidation);

  const partnershipCheck = validatePartnerships(raw, batting);
  errors.push(...partnershipCheck.errors);
  notes.push(...partnershipCheck.notes);
  if (partnershipCheck.validation) validations.push(partnershipCheck.validation);

  return {
    errors,
    notes,
    mapping: mappingRows,
    validations,
    checks: checked.checks,
    innings: {
      team: squadKey(battingTeam),
      runs: Number(raw.runs) || 0,
      wickets: Number(raw.wickets) || 0,
      overs: formatOvers(raw.overs),
      extras,
      batting: batting.map(({ sourceName, ...row }) => row),
      bowling: bowling.map(({ sourceName, ...row }) => row),
      fallOfWickets: fallOfWickets.map(({ sourceName, ...row }) => row),
    },
  };
}

async function buildPlan({ data, mapping, tournament, match, teams }) {
  const errors = [];
  const notes = [];
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
    return {
      errors,
      notes,
      innings: [],
      mapping: [],
      payload: null,
      validator: null,
      squads,
      storageTeamIds: [],
    };
  }

  const expectedTeams = new Set([squadKey(teamA.team), squadKey(teamB.team)]);
  const fixtureTeams = (match.teams || []).map(idOf);
  const actualTeams = new Set(fixtureTeams);
  if (
    fixtureTeams.length !== 2 ||
    actualTeams.size !== 2 ||
    [...expectedTeams].some((id) => !actualTeams.has(id)) ||
    [...actualTeams].some((id) => !expectedTeams.has(id))
  ) {
    errors.push(
      `Final fixture teams are ${fixtureTeams.join(", ") || "(missing)"}; expected ${data.match.teamA} and ${data.match.teamB}`,
    );
  }

  // Decide the stored order. When the data pins it, it must be exactly the
  // fixture's two teams once each and it must match the chronological innings
  // order, because the manual editor treats the first stored team/innings as
  // Team A / innings 1.
  let storageTeamIds = fixtureTeams;
  if (data.match.storageTeamOrder) {
    const resolvedOrder = data.match.storageTeamOrder.map((name) => resolveTeamByName(teams, name));
    const orderErrors = resolvedOrder.map((row) => row.error).filter(Boolean);
    if (orderErrors.length) {
      errors.push(...orderErrors.map((error) => `storageTeamOrder: ${error}`));
    } else {
      const ids = resolvedOrder.map((row) => squadKey(row.team));
      if (ids[0] === ids[1] || ids.some((id) => !expectedTeams.has(id))) {
        errors.push("storageTeamOrder must list the fixture's two teams exactly once");
      } else {
        storageTeamIds = ids;
        const chronological = (data.innings || []).map((raw) => {
          const resolved = resolveTeamByName(teams, raw.battingTeam);
          return resolved.team ? squadKey(resolved.team) : "";
        });
        if (chronological.some((id, index) => id !== storageTeamIds[index])) {
          errors.push(
            "storageTeamOrder must equal the chronological innings batting order so the manual editor opens with the team that batted first",
          );
        }
      }
    }
  }

  const inningsPlans = [];
  const seenBatting = new Set();
  for (const raw of data.innings) {
    const plan = buildInningsPlan(raw, {
      teams,
      squads,
      mapping,
      totalOvers: Number(data.match.totalOvers) || 20,
    });
    inningsPlans.push(plan);
    errors.push(...plan.errors);
    notes.push(...plan.notes);
    if (plan.innings?.team) {
      if (seenBatting.has(plan.innings.team)) {
        errors.push(`the same team cannot bat twice (${plan.innings.team})`);
      }
      seenBatting.add(plan.innings.team);
    }
  }
  if (seenBatting.size && !storageTeamIds.every((id) => seenBatting.has(id))) {
    errors.push("both stored teams must appear once as a batting team");
  }

  let tossTeam = null;
  if (data.match.tossWinner) {
    const toss = resolveTeamByName([teamA.team, teamB.team], data.match.tossWinner);
    if (toss.error) errors.push(`toss winner: ${toss.error}`);
    else tossTeam = toss.team;
  }
  const resultWinner = resolveTeamByName([teamA.team, teamB.team], data.result?.winner);
  if (resultWinner.error) errors.push(`result winner: ${resultWinner.error}`);

  const manOfMatch = resolveManOfMatch(data.manOfMatch, squads, mapping);
  manOfMatch.sourceName = data.manOfMatch || "";
  if (manOfMatch.error) {
    errors.push(manOfMatch.error);
    notes.push(`man-of-the-match candidates: ${manOfMatch.candidates.join(", ")}`);
  }

  const payload = {
    tournamentId: idOf(tournament),
    stage: data.match.stage,
    stageLabel: data.match.stageLabel,
    round: match.round || data.match.stageLabel,
    teamA: storageTeamIds[0] || "",
    teamB: storageTeamIds[1] || "",
    startAt: match.startAt ? new Date(match.startAt).toISOString() : data.match.startAt,
    totalOvers: Number(data.match.totalOvers) || Number(match.totalOvers) || 20,
    venue: match.venue || data.match.venue || "",
    title: match.title || data.match.title || "",
    matchCategory: data.match.matchCategory || match.matchCategory || "Club",
    tossWinner: tossTeam ? squadKey(tossTeam) : "",
    tossDecision: data.match.tossDecision || "",
    draft: true,
    innings: inningsPlans.map((plan) => plan.innings).filter(Boolean),
    result: {
      resultType: data.result?.resultType || "normal",
      winner: resultWinner.team ? squadKey(resultWinner.team) : "",
      margin: data.result?.margin || "",
      note: data.result?.note || "",
    },
    manOfMatch: manOfMatch.player ? String(manOfMatch.player._id) : "",
  };

  for (const squad of squads.values()) {
    squadByTeam[squadKey(squad.team)] = squad.players.map((player) => String(player._id));
  }
  const validator = validateManualScorecard(payload, {
    teamIds: storageTeamIds,
    totalOvers: payload.totalOvers,
    squadByTeam,
    requireComplete: true,
  });
  const validatorValidation = {
    label: "manual scorecard validator",
    ok: validator.ok,
    detail: validator.ok
      ? "all manual-scorecard rules pass"
      : validator.errors.map((error) => `${error.path}: ${error.message}`).join("; "),
  };
  if (!validator.ok) {
    errors.push(...validator.errors.map((error) => `manual validator ${error.path}: ${error.message}`));
  }

  return {
    errors,
    notes,
    innings: inningsPlans,
    mapping: inningsPlans.flatMap((plan) => plan.mapping || []),
    payload,
    validator,
    validatorValidation,
    manOfMatch,
    squads,
    storageTeamIds,
  };
}

function printHeader({ apply, data, databaseName, forceTest, tournament, match }, log) {
  log("");
  log("=== All Baldia T20 Final import =====================================");
  log(`  Mode        : ${apply ? "APPLY" : "DRY RUN (no writes)"}`);
  log(`  Data file   : ${DATA_FILE}`);
  log(`  Name map    : ${NAME_MAP_FILE}`);
  log(`  Database    : ${databaseName}${forceTest ? " (test/e2e guard bypassed with --force-test)" : ""}`);
  log(`  Tournament  : ${tournament ? `${tournament.name} (${tournament._id})` : `MISSING "${data.tournamentName}"`}`);
  if (match) {
    log(
      `  Final       : ${match._id}  ${match.title || ""}  status=${match.status} source=${match.source} draft=${match.manualDraft === true}`,
    );
    log(
      `  Fixture teams: ${(match.teams || []).map((team) => team.name || idOf(team)).join(" vs ") || "(missing)"}`,
    );
  }
}

function printValidationTable(plan, log) {
  log("");
  log("Validation (PASS/FAIL):");
  for (const inningsPlan of plan.innings || []) {
    const team = inningsPlan.innings?.team || "?";
    log(`  Innings ${inningsPlan.innings?.team || "?"}:`);
    for (const check of inningsPlan.validations || []) {
      log(`    ${check.ok ? "PASS" : "FAIL"}  ${check.label}: ${check.detail}`);
    }
  }
  if (plan.validatorValidation) {
    log(`  ${plan.validatorValidation.ok ? "PASS" : "FAIL"}  ${plan.validatorValidation.label}: ${plan.validatorValidation.detail}`);
  }
  for (const note of plan.notes || []) log(`  note: ${note}`);
}

function printNameMap(plan, log) {
  log("");
  log("Name map (existing players only):");
  let unresolved = 0;
  for (const row of plan.mapping || []) {
    if (row.error) {
      unresolved += 1;
      log(`  [${row.role}] "${row.sourceName}" [${row.team || "?"}] -> UNRESOLVED: ${row.error}`);
      log(`      candidates: ${(row.candidates || []).join(", ") || "(none)"}`);
    } else {
      log(
        `  [${row.role}] "${row.sourceName}" [${row.team || "?"}] -> ${row.player.name} (${row.reason})`,
      );
    }
  }
  if (plan.manOfMatch?.error) {
    unresolved += 1;
    log(`  [man-of-match] "${plan.manOfMatch.sourceName || ""}" -> UNRESOLVED: ${plan.manOfMatch.error}`);
    log(`      candidates: ${(plan.manOfMatch.candidates || []).join(", ") || "(none)"}`);
  } else if (plan.manOfMatch?.player) {
    log(`  [man-of-match] -> ${plan.manOfMatch.player.name} (${plan.manOfMatch.reason})`);
  }
  log(`  unresolved names: ${unresolved}`);
}

function printResolvedScorecard(plan, log) {
  const teamName = (id) => {
    const squad = plan.squads?.get(String(id));
    return squad?.team?.name || String(id);
  };
  log("");
  log("Resolved scorecard:");
  const rows = (plan.innings || []).map((inningsPlan) => {
    const innings = inningsPlan.innings;
    if (!innings) return "FAIL (not resolved)";
    return `${teamName(innings.team)} ${innings.runs}/${innings.wickets} (${innings.overs})`;
  });
  log(`  ${rows.join(" vs ")}`);
}

function printExactFields(plan, { match, data }, log) {
  const payload = plan.payload || {};
  const teamName = (id) => {
    const squad = plan.squads?.get(String(id));
    return squad?.team?.name || String(id);
  };
  log("");
  log("Exact fields to write (draft, not published):");
  log(`  match._id          : ${match._id} (updated in place; never re-created)`);
  log(`  tournament         : ${payload.tournamentId} (unchanged link)`);
  log(`  stage/stageLabel   : ${payload.stage} / ${payload.stageLabel}`);
  log(`  round              : ${payload.round}`);
  log(`  title (preserved)  : ${payload.title}`);
  log(`  venue (preserved)  : ${payload.venue}`);
  log(`  startAt (preserved): ${payload.startAt}`);
  log(`  totalOvers         : ${payload.totalOvers}`);
  log(`  matchCategory      : ${payload.matchCategory}`);
  log(`  teams (stored)     : [${teamName(payload.teamA)}, ${teamName(payload.teamB)}]`);
  log(
    `  fixture order      : [${(match.teams || []).map((team) => team.name || idOf(team)).join(", ")}] -> reordered in place so Team A / innings 1 = ${teamName(payload.teamA)}`,
  );
  log(`  toss               : ${payload.tossWinner ? teamName(payload.tossWinner) : "(empty)"} ${payload.tossDecision || ""}`.trim());
  log(`  result             : ${payload.result.resultType} | winner=${teamName(payload.result.winner)} | margin=${payload.result.margin}`);
  log(`  result.description : ${payload.result.note}`);
  log(`  manOfMatch         : ${plan.manOfMatch?.player ? plan.manOfMatch.player.name : "(empty)"}`);
  log(`  source/manualDraft : manual / true; status upcoming`);
  log(`  players created    : none`);
  for (const innings of payload.innings || []) {
    log(
      `  innings ${teamName(innings.team)}: ${innings.runs}/${innings.wickets} in ${innings.overs}; extras ${JSON.stringify(
        innings.extras,
      )}; ${innings.batting.length} batter(s), ${innings.bowling.length} bowler(s), ${innings.fallOfWickets.length} fall(s)`,
    );
  }
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
  if (!tournaments.length) {
    throw new Error(`tournament "${data.tournamentName}" was not found; this script never creates it`);
  }
  throw new Error(`${tournaments.length} tournaments match "${data.tournamentName}"; refusing to guess`);
}

async function findFinal(tournament, data) {
  const matches = await Match.find({
    tournament: tournament._id,
    stage: data.match.stage,
    stageLabel: data.match.stageLabel,
  })
    .select(
      "title matchNumber venue matchType totalOvers matchCategory matchSubcategory round stage stageLabel tournament teams innings status source manualDraft result tossWinner tossDecision startAt",
    )
    .populate("teams", "name shortName");
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

async function verifyLinked(matchId, tournamentId) {
  const fresh = await Tournament.findById(tournamentId).select("matches").lean();
  return (fresh?.matches || []).some((id) => idOf(id) === idOf(matchId));
}

function sameDate(a, b) {
  return String(a?.toISOString?.() || a || "") === String(b?.toISOString?.() || b || "");
}

async function postCheck(saved, { match, tournament, data, storageTeamIds, playerCountBefore }) {
  const errors = [];
  if (String(saved._id) !== String(match._id)) errors.push("_id changed");
  if (saved.source !== "manual") errors.push(`source is ${saved.source}, expected manual`);
  if (saved.manualDraft !== true) errors.push(`manualDraft is ${saved.manualDraft}, expected true`);
  if (saved.status !== "upcoming") errors.push(`status is ${saved.status}, expected upcoming`);
  if (saved.stage !== data.match.stage) errors.push(`stage is ${saved.stage}`);
  if (saved.stageLabel !== data.match.stageLabel) errors.push(`stageLabel is ${saved.stageLabel}`);
  if (String(saved.tournament) !== String(tournament._id)) errors.push("tournament link changed");
  if (!sameDate(saved.startAt, match.startAt)) errors.push("startAt changed");
  if (String(saved.venue || "") !== String(match.venue || "")) errors.push("venue changed");
  if (String(saved.title || "") !== String(match.title || "")) errors.push("title changed");

  const savedTeams = (saved.teams || []).map(idOf);
  if (
    savedTeams.length !== 2 ||
    !storageTeamIds.every((id, index) => savedTeams[index] === id)
  ) {
    errors.push(`stored team order is ${savedTeams.join(", ")}, expected ${storageTeamIds.join(", ")}`);
  }
  const savedInnings = (saved.innings || []).map((innings) => idOf(innings.team));
  if (!storageTeamIds.every((id, index) => savedInnings[index] === id)) {
    errors.push(`stored innings order is ${savedInnings.join(", ")}, expected ${storageTeamIds.join(", ")}`);
  }
  if (await Player.countDocuments({}) !== playerCountBefore) {
    errors.push("Player document count changed (this importer must never create players)");
  }
  return errors;
}

/**
 * Run the import against an open mongoose connection. Exported for tests.
 * `log` defaults to console.log; pass a no-op to keep test output quiet.
 */
export async function runImportFinalResult({
  apply = false,
  log = console.log,
  data: injectedData = null,
  nameMap: injectedNameMap = null,
  databaseName = "",
  forceTest = false,
  expectedFinalId = null,
} = {}) {
  const { data, mapping } = injectedData
    ? { data: injectedData, mapping: injectedNameMap || {} }
    : loadImportFiles();
  const report = { apply, outcome: "DRY_RUN", blocked: false, plan: null };

  const tournament = await findTournament(data);
  const match = await findFinal(tournament, data);
  printHeader({ apply, data, databaseName, forceTest, tournament, match }, log);

  const blockers = [];
  const requiredFinalId = expectedFinalId || data.match.id;
  if (requiredFinalId && String(match._id) !== String(requiredFinalId)) {
    blockers.push(
      `Final _id is ${match._id}, expected ${requiredFinalId}; refusing to touch a different fixture`,
    );
  }
  if (match.source === "manual") {
    log("");
    log(
      `SKIP ${data.match.stageLabel} ${match._id}: already a manual scorecard (draft=${match.manualDraft === true}, status=${match.status}). Nothing to do.`,
    );
    report.outcome = "SKIP";
    return report;
  }
  if (match.source !== "live") blockers.push(`fixture source is "${match.source}", expected "live"`);
  if (!isEmptyUpcomingFixture(match)) {
    blockers.push(
      `fixture is not an empty upcoming fixture (status=${match.status}); refusing to overwrite scoring data`,
    );
  }

  const [ballCount, deliveryCount] = await Promise.all([
    Ball.countDocuments({ matchId: match._id }),
    Delivery.countDocuments({ matchId: match._id }),
  ]);
  if (ballCount || deliveryCount) {
    blockers.push(
      `fixture already has ${ballCount} ball(s) and ${deliveryCount} delivery record(s); refusing to overwrite`,
    );
  }
  if (!(await verifyLinked(match._id, tournament._id))) {
    blockers.push(`fixture ${match._id} is not linked from Tournament.matches; refusing to convert`);
  }
  if (blockers.length) {
    report.blocked = true;
    printBlockers(blockers, log);
    return report;
  }

  const teams = await loadTournamentTeams(tournament);
  const plan = await buildPlan({ data, mapping, tournament, match, teams });
  report.plan = plan;
  printResolvedScorecard(plan, log);
  printValidationTable(plan, log);
  printNameMap(plan, log);
  printExactFields(plan, { match, data }, log);

  if (plan.errors.length) {
    report.blocked = true;
    printBlockers(plan.errors, log);
    return report;
  }

  if (!apply) {
    log("");
    log("Dry run complete. Nothing was written.");
    return report;
  }

  const playerCountBefore = await Player.countDocuments({});
  const result = await convertUpcomingFixtureToManualDraft(match._id, plan.payload, {
    teamOrder: plan.storageTeamIds,
  });
  if (!result.ok) {
    report.blocked = true;
    const errors = result.errors
      ? result.errors.map((error) => `${error.path}: ${error.message}`)
      : [result.message || "conversion failed"];
    printBlockers(errors, log);
    return report;
  }

  const saved = await Match.findById(match._id);
  const postErrors = await postCheck(saved, {
    match,
    tournament,
    data,
    storageTeamIds: plan.storageTeamIds,
    playerCountBefore,
  });
  if (!(await verifyLinked(match._id, tournament._id))) postErrors.push("Tournament.matches link lost");
  if (postErrors.length) {
    throw new Error(`post-write verification failed: ${postErrors.join("; ")}`);
  }

  report.outcome = "APPLIED";
  const teamNameById = new Map(teams.map((team) => [squadKey(team), team.name]));
  const savedScorecard = (saved.innings || [])
    .map(
      (innings) =>
        `${teamNameById.get(String(innings.team)) || "?"} ${innings.runs}/${innings.wickets}`,
    )
    .join(" vs ");
  log("");
  log("APPLIED — DRAFT only (nothing was published).");
  log(`  match      : ${saved._id}`);
  log(`  tournament : ${saved.tournament} (still linked)`);
  log(`  scorecard  : ${savedScorecard}`);
  log(`  result     : ${data.result.winner} won by ${data.result.margin}`);
  log(`  team order : ${plan.storageTeamIds.map((id) => teamNameById.get(id)).join(" then ")} (Admin Team A first)`);
  log(`  visibility : manualDraft=true, status=upcoming — hidden until Publish`);
  return report;
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
    const report = await runImportFinalResult({ apply, databaseName, forceTest });
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
