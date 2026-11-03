import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const NAME_MAPS = [
  { label: "QF", file: path.join(SCRIPT_DIR, "data", "qfNameMap.json") },
  { label: "SF1", file: path.join(SCRIPT_DIR, "data", "sf1NameMap.json") },
  { label: "SF2", file: path.join(SCRIPT_DIR, "data", "sf2NameMap.json") },
];

export const CSV_HEADERS = [
  "player_id",
  "placeholder_name",
  "team_name",
  "source_name",
  "match_count",
  "match_labels",
  "runs_batted",
  "balls_batted",
  "overs_bowled",
  "runs_bowled",
  "wickets_bowled",
  "real_name_or_existing_player_id",
  "duplicate_same_team",
  "duplicate_across_teams",
  "allow_cross_team",
];

export const idOf = (value) => String(value?._id || value || "");
export const normalizeName = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field === "") {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell !== "")) rows.push(row);
  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  if (!rows.length) return [];

  const headers = rows[0].map((header) => header.trim());
  if (new Set(headers).size !== headers.length) throw new Error("CSV has duplicate headers.");
  return rows.slice(1).map((cells, index) => {
    if (cells.length !== headers.length) {
      throw new Error(`CSV row ${index + 2} has ${cells.length} cells; expected ${headers.length}.`);
    }
    return Object.fromEntries(headers.map((header, cell) => [header, cells[cell]]));
  });
}

export function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers, rows) {
  return [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\r\n") + "\r\n";
}

export function loadNameMapEntries() {
  const entries = [];
  for (const mapFile of NAME_MAPS) {
    if (!fs.existsSync(mapFile.file)) {
      throw new Error(`${mapFile.label} name map was not found: ${mapFile.file}`);
    }
    const mapping = JSON.parse(fs.readFileSync(mapFile.file, "utf8"));
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
      throw new Error(`${mapFile.label} name map must contain a JSON object.`);
    }
    for (const [key, value] of Object.entries(mapping)) {
      const delimiter = key.indexOf("::");
      entries.push({
        matchLabel: mapFile.label,
        teamName: delimiter < 0 ? "" : key.slice(0, delimiter),
        sourceName: delimiter < 0 ? key : key.slice(delimiter + 2),
        mappedValue: String(value),
      });
    }
  }
  return entries;
}

export function matchLabel(match) {
  const stage = String(match?.stageLabel || "").trim();
  if (/^(QF|SF)\s*\d+$/i.test(stage)) return stage.toUpperCase().replace(/\s+/g, "");
  const text = `${match?.title || ""} ${match?.round || ""}`;
  const found = text.match(/\b(QF|SF)\s*(\d+)\b/i);
  return found ? `${found[1].toUpperCase()}${found[2]}` : stage || "Unlabelled";
}

const oversAsBalls = (overs) => {
  const numeric = Number(overs || 0);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  const whole = Math.floor(numeric);
  const balls = Math.round((numeric - whole) * 10);
  return whole * 6 + Math.min(balls, 5);
};

const formatOvers = (balls) => `${Math.floor(balls / 6)}.${balls % 6}`;

const matchAppearance = (match, playerId) => {
  let runs = 0;
  let balls = 0;
  let bowlingBalls = 0;
  let bowlingRuns = 0;
  let wickets = 0;
  let appeared = false;
  for (const innings of match.innings || []) {
    for (const batting of innings.batting || []) {
      if (idOf(batting.player) !== playerId) continue;
      appeared = true;
      runs += Number(batting.runs || 0);
      balls += Number(batting.balls || 0);
    }
    for (const bowling of innings.bowling || []) {
      if (idOf(bowling.player) !== playerId) continue;
      appeared = true;
      bowlingBalls += Number.isFinite(Number(bowling.balls)) && Number(bowling.balls) > 0
        ? Number(bowling.balls)
        : oversAsBalls(bowling.overs);
      bowlingRuns += Number(bowling.runs || 0);
      wickets += Number(bowling.wickets || 0);
    }
    if ((innings.fallOfWickets || []).some((entry) => idOf(entry.player) === playerId)) {
      appeared = true;
    }
  }
  for (const group of [...(match.playingXI || []), ...(match.squad15 || []), ...(match.bowlingXI || [])]) {
    if ((group.players || []).some((player) => idOf(player) === playerId)) appeared = true;
  }
  for (const entry of match.twelfthMan || []) {
    if (idOf(entry.player) === playerId) appeared = true;
  }
  for (const entry of match.impactPlayers || []) {
    if (idOf(entry.player) === playerId || idOf(entry.replaces) === playerId) appeared = true;
  }
  if (idOf(match.manOfMatch) === playerId) appeared = true;
  return { appeared, runs, balls, bowlingBalls, bowlingRuns, wickets };
};

const publishedOrDraft = (match) =>
  match?.manualDraft === true ||
  ["live", "completed", "innings-break", "innings_break", "toss_done", "super_over", "pending_tie_resolution", "abandoned"]
    .includes(String(match?.status || "").toLowerCase());

export function buildPlayerReview({
  tournament,
  teams,
  players,
  matches,
  mapEntries,
  originalSquadNames = new Map(),
}) {
  const teamById = new Map(teams.map((team) => [idOf(team), team]));
  const originalSquadIds = new Set(
    (tournament.tournamentSquads || []).flatMap((entry) => (entry.players || []).map(idOf)),
  );
  const mapTargets = mapEntries.flatMap((entry) => {
    const value = entry.mappedValue.trim();
    if (!value || value.toUpperCase() === "SKIP") return [];
    return [{
      ...entry,
      targetName: value.toUpperCase().startsWith("CREATE:") ? value.slice(7).trim() : value,
    }];
  });
  const relevantMatches = matches.filter(publishedOrDraft);
  const duplicateNames = new Map();
  for (const player of players) {
    const key = normalizeName(player.name);
    const teamId = idOf(player.team);
    const existing = duplicateNames.get(key) || [];
    existing.push({ id: idOf(player), teamId });
    duplicateNames.set(key, existing);
  }

  const rows = [];
  for (const player of players) {
    const playerId = idOf(player);
    const teamId = idOf(player.team);
    const team = teamById.get(teamId);
    if (!team) continue;
    const targetMappings = mapTargets.filter((entry) =>
      normalizeName(entry.teamName) === normalizeName(team.name) &&
      normalizeName(entry.targetName) === normalizeName(player.name),
    );
    const isTbc = /\(TBC\)$/i.test(String(player.name || "").trim());
    const hasOriginalSquadEvidence = originalSquadIds.size > 0 || originalSquadNames.size > 0;
    const isOriginalPlayer = originalSquadIds.has(playerId) ||
      originalSquadNames.get(normalizeName(team.name))?.has(normalizeName(player.name));
    const isOutsideOriginalSquad = hasOriginalSquadEvidence
      ? !isOriginalPlayer
      : targetMappings.some((entry) => entry.mappedValue.toUpperCase().startsWith("CREATE:"));
    if (!isTbc && !(isOutsideOriginalSquad && targetMappings.length)) continue;

    const stats = { runs: 0, balls: 0, bowlingBalls: 0, bowlingRuns: 0, wickets: 0 };
    const labels = [];
    for (const match of relevantMatches) {
      const appearance = matchAppearance(match, playerId);
      if (!appearance.appeared) continue;
      labels.push(matchLabel(match));
      stats.runs += appearance.runs;
      stats.balls += appearance.balls;
      stats.bowlingBalls += appearance.bowlingBalls;
      stats.bowlingRuns += appearance.bowlingRuns;
      stats.wickets += appearance.wickets;
    }
    const sourceNames = targetMappings.map((entry) => `${entry.matchLabel}: ${entry.sourceName}`);
    if (!sourceNames.length && isTbc) {
      const mappedSources = mapEntries
        .filter((entry) =>
          normalizeName(entry.teamName) === normalizeName(team.name) &&
          normalizeName(entry.sourceName) === normalizeName(String(player.name).replace(/\s*\(TBC\)$/i, "")),
        )
        .map((entry) => `${entry.matchLabel}: ${entry.sourceName}`);
      if (mappedSources.length) sourceNames.push(...mappedSources);
      else sourceNames.push(`Unmapped: ${String(player.name).replace(/\s*\(TBC\)$/i, "")}`);
    }
    const duplicateMatches = duplicateNames.get(normalizeName(player.name)) || [];
    const sameTeamDuplicates = duplicateMatches.filter((entry) => entry.teamId === teamId).length > 1;
    const crossTeamDuplicates = new Set(duplicateMatches.map((entry) => entry.teamId)).size > 1;
    rows.push({
      player_id: playerId,
      placeholder_name: player.name,
      team_name: team.name,
      source_name: [...new Set(sourceNames)].join("; "),
      match_count: labels.length,
      match_labels: [...new Set(labels)].join("; "),
      runs_batted: stats.runs,
      balls_batted: stats.balls,
      overs_bowled: formatOvers(stats.bowlingBalls),
      runs_bowled: stats.bowlingRuns,
      wickets_bowled: stats.wickets,
      real_name_or_existing_player_id: "",
      duplicate_same_team: sameTeamDuplicates ? "YES" : "",
      duplicate_across_teams: crossTeamDuplicates ? "YES" : "",
    });
  }
  return rows;
}

const eachArray = (value, callback) => {
  for (const row of value || []) callback(row);
};
const swap = (object, key, fromId, toId) => {
  if (object && idOf(object[key]) === fromId) object[key] = toId;
};
const swapArray = (object, key, fromId, toId) => {
  if (!object || !Array.isArray(object[key])) return;
  const mapped = object[key].map((value) => idOf(value) === fromId ? toId : value);
  const unique = new Map(mapped.map((value) => [idOf(value) || String(value), value]));
  object[key] = [...unique.values()];
};

export function rewriteInningsPlayerReferences(innings, fromId, toId) {
  swap(innings, "currentBatsman1", fromId, toId);
  swap(innings, "currentBatsman2", fromId, toId);
  swap(innings, "onStrikeBatsman", fromId, toId);
  swap(innings, "currentBowler", fromId, toId);
  swap(innings?.twelfthManBowlBlock, "player", fromId, toId);
  swapArray(innings, "battingOrder", fromId, toId);
  eachArray(innings?.batting, (row) => {
    swap(row, "player", fromId, toId);
    swap(row, "dismissedBy", fromId, toId);
    swap(row, "fielder", fromId, toId);
    eachArray(row?.shots, (shot) => swap(shot, "bowler", fromId, toId));
  });
  eachArray(innings?.bowling, (row) => swap(row, "player", fromId, toId));
  eachArray(innings?.fallOfWickets, (row) => {
    swap(row, "player", fromId, toId);
    swap(row, "fielder", fromId, toId);
  });
  eachArray(innings?.partnerships, (row) => {
    swap(row, "batsman1", fromId, toId);
    swap(row, "batsman2", fromId, toId);
  });
  eachArray(innings?.oversHistory, (over) => {
    swap(over, "bowler", fromId, toId);
    eachArray(over?.balls, (ball) => {
      for (const key of ["batsmanOnStrike", "batsmanNonStrike", "bowler", "dismissedPlayer", "fielder"]) {
        swap(ball, key, fromId, toId);
      }
    });
  });
}

export function rewriteMatchPlayerReferences(match, fromId, toId) {
  swap(match, "manOfMatch", fromId, toId);
  swap(match?.result, "playerOfMatch", fromId, toId);
  eachArray(match?.innings, (innings) => rewriteInningsPlayerReferences(innings, fromId, toId));
  eachArray(match?.playingXI, (entry) => swapArray(entry, "players", fromId, toId));
  eachArray(match?.squad15, (entry) => {
    swapArray(entry, "players", fromId, toId);
    swap(entry, "captain", fromId, toId);
    swap(entry, "viceCaptain", fromId, toId);
    swapArray(entry, "wicketKeepers", fromId, toId);
  });
  eachArray(match?.twelfthMan, (entry) => swap(entry, "player", fromId, toId));
  eachArray(match?.impactPlayers, (entry) => {
    swap(entry, "player", fromId, toId);
    swap(entry, "replaces", fromId, toId);
  });
  eachArray(match?.bowlingXI, (entry) => swapArray(entry, "players", fromId, toId));
  eachArray(match?.teamRoles, (entry) => {
    swap(entry, "captain", fromId, toId);
    swap(entry, "viceCaptain", fromId, toId);
    swapArray(entry, "wicketKeepers", fromId, toId);
  });
  eachArray(match?.drsReviews, (entry) => swap(entry, "requestedBy", fromId, toId));
  eachArray(match?.superOvers, (over) => {
    eachArray(over?.innings, (innings) => rewriteInningsPlayerReferences(innings, fromId, toId));
    eachArray(over?.bowlers, (entry) => swap(entry, "bowler", fromId, toId));
    eachArray(over?.batsmen, (entry) => swapArray(entry, "players", fromId, toId));
  });
}

export function inningsHasDuplicateScoreRows(match, fromTo) {
  const check = (innings, label) => {
    for (const field of ["batting", "bowling"]) {
      const ids = (innings[field] || []).map((row) => {
        const id = idOf(row.player);
        return fromTo.get(id) || id;
      });
      const sourceIds = new Set((innings[field] || []).map((row) => idOf(row.player)));
      const hasMergedSource = [...sourceIds].some((id) => fromTo.has(id));
      if (hasMergedSource && new Set(ids).size !== ids.length) {
        return `${label} has duplicate ${field} rows after the requested merge.`;
      }
    }
    return "";
  };
  for (const [index, innings] of (match.innings || []).entries()) {
    const error = check(innings, `${matchLabel(match)} innings ${index + 1}`);
    if (error) return error;
  }
  for (const [overIndex, over] of (match.superOvers || []).entries()) {
    for (const [index, innings] of (over.innings || []).entries()) {
      const error = check(innings, `${matchLabel(match)} Super Over ${overIndex + 1} innings ${index + 1}`);
      if (error) return error;
    }
  }
  return "";
}
