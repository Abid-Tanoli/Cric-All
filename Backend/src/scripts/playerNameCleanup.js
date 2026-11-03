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
  // Decision-support columns. They are appended so an older CSV (with only the
  // answer column above) remains valid input for applyPlayerNames.js.
  "candidate_real_players",
  "candidates_by_match",
  "similar_names",
  "similar_names_other_teams",
  "match_context",
  "bowler_reconciliation",
  // Team-resolution and looser candidate evidence. Appended again so a CSV
  // produced before these columns existed remains valid input.
  "team_conflict",
  "candidates_without_bowling_row",
  "candidates_without_batting_row",
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

const TBC_SUFFIX = /\s*\(TBC\)\s*$/i;
const isTbcName = (name) => TBC_SUFFIX.test(String(name || "").trim());
const stripTbcSuffix = (name) => String(name || "").replace(TBC_SUFFIX, "").trim();

export function levenshteinDistance(left, right) {
  const a = [...String(left || "")];
  const b = [...String(right || "")];
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      const substitution = previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1);
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        substitution,
      );
    }
    previous = current;
  }
  return previous[b.length];
}

// A small Soundex-style key. It is only a hint for the report, never a merge
// decision, so an approximate phonetic match is sufficient.
const phoneticKey = (value) => {
  const text = String(value || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!text) return "";
  const codes = {
    b: "1", f: "1", p: "1", v: "1",
    c: "2", g: "2", j: "2", k: "2", q: "2", s: "2", x: "2", z: "2",
    d: "3", t: "3",
    l: "4",
    m: "5", n: "5",
    r: "6",
  };
  let result = text[0];
  let previous = codes[text[0]] || "";
  for (const char of text.slice(1)) {
    const code = codes[char] || "";
    if (!code) continue;
    if (code !== previous) result += code;
    previous = code;
  }
  return result.padEnd(4, "0").slice(0, 4);
};

/**
 * Why a same-team squad name might be the person behind a placeholder. The
 * result is display text only: it is never applied automatically.
 */
export function similarNameReason(placeholderName, candidateName) {
  const left = normalizeName(stripTbcSuffix(placeholderName));
  const right = normalizeName(stripTbcSuffix(candidateName));
  if (!left || !right) return "";
  if (left === right) return "same normalized name";

  const leftTokens = left.split(" ").filter(Boolean);
  const rightTokens = right.split(" ").filter(Boolean);
  const rightCandidates = [right, ...rightTokens];
  let best = null;

  const compare = (a, b) => {
    const distance = levenshteinDistance(a, b);
    const minLength = Math.min(a.length, b.length);
    const maxLength = Math.max(a.length, b.length);
    const threshold = minLength <= 3 ? 1 : minLength <= 6 ? 2 : 3;
    if (
      distance > 0 &&
      distance <= threshold &&
      distance / maxLength <= 0.45 &&
      a[0] === b[0] &&
      (!best || distance < best.distance)
    ) {
      best = { distance, reason: `edit distance ${distance}` };
    }
  };

  for (const leftToken of leftTokens) {
    for (const rightCandidate of rightCandidates) compare(leftToken, rightCandidate);
  }
  if (best) return best.reason;

  // Shared prefixes catch a trailing spelling difference (Attaulla/Attaullah)
  // that is too long for the edit-distance threshold to be the only signal.
  for (const leftToken of leftTokens) {
    for (const rightCandidate of rightCandidates) {
      let prefix = 0;
      while (
        prefix < leftToken.length &&
        prefix < rightCandidate.length &&
        leftToken[prefix] === rightCandidate[prefix]
      ) prefix += 1;
      if (prefix >= 3 && prefix >= Math.ceil(Math.min(leftToken.length, rightCandidate.length) * 0.6)) {
        return `shared prefix "${leftToken.slice(0, prefix)}"`;
      }
    }
  }

  // Phonetic hints are deliberately conservative: they only apply when both
  // names are long enough to make a false positive unlikely.
  for (const leftToken of leftTokens) {
    if (leftToken.length < 4) continue;
    for (const rightCandidate of rightCandidates) {
      if (rightCandidate.length < 4) continue;
      if (phoneticKey(leftToken) === phoneticKey(rightCandidate)) {
        return "phonetic match";
      }
    }
  }
  return "";
}

const playerReferenceText = (player) =>
  player ? `${player.name} [${idOf(player)}]` : "";

const teamLabelOf = (teamById, value) => {
  const teamId = idOf(value);
  if (!teamId) return "";
  return teamById.get(teamId)?.name || "Unknown team";
};

const uniqueIds = (values) => [...new Set(values.map(idOf).filter(Boolean))];

/** Every side attached to a fixture, from `teams` and the innings fallback. */
function fixtureTeamIds(match) {
  const ids = [];
  for (const team of match?.teams || []) ids.push(idOf(team));
  for (const innings of match?.innings || []) ids.push(idOf(innings?.team));
  for (const over of match?.superOvers || []) {
    for (const innings of over?.innings || []) ids.push(idOf(innings?.team));
  }
  return uniqueIds(ids);
}

/**
 * The side bowling in an innings is the fixture side that is not batting.
 * `innings.team` is the batting side; it must never be used as the bowler's
 * team by itself.
 */
function opposingTeamIdFor(match, innings) {
  const battingTeamId = idOf(innings?.team);
  if (!battingTeamId) return "";
  return fixtureTeamIds(match).find((teamId) => teamId !== battingTeamId) || "";
}

/**
 * Players with a bowling row for `teamId` in this match. A bowling row belongs
 * to the fielding side, so it is only counted when `teamId` is the side that is
 * not batting in that innings.
 */
function playersWithBowlingRowForTeam(match, teamId) {
  const ids = new Set();
  const inningsList = [
    ...(match.innings || []),
    ...(match.superOvers || []).flatMap((over) => over.innings || []),
  ];
  for (const innings of inningsList) {
    const battingTeamId = idOf(innings.team);
    // No batting side means the row cannot be assigned safely. Counting it for
    // every team can only remove a candidate; it can never invent one.
    if (battingTeamId && battingTeamId === teamId) continue;
    for (const row of innings.bowling || []) ids.add(idOf(row.player));
  }
  ids.delete("");
  return ids;
}

/** Players with a batting row (including an all-zero DNB row) for `teamId`. */
function playersWithBattingRowForTeam(match, teamId) {
  const ids = new Set();
  const inningsList = [
    ...(match.innings || []),
    ...(match.superOvers || []).flatMap((over) => over.innings || []),
  ];
  for (const innings of inningsList) {
    const battingTeamId = idOf(innings.team);
    if (battingTeamId && battingTeamId !== teamId) continue;
    for (const row of innings.batting || []) ids.add(idOf(row.player));
  }
  ids.delete("");
  return ids;
}

const hasBowlingRow = (match, playerId) =>
  (match.innings || []).some((innings) =>
    (innings.bowling || []).some((row) => idOf(row.player) === playerId));

const hasBattingRow = (match, playerId) =>
  (match.innings || []).some((innings) =>
    (innings.batting || []).some((row) => idOf(row.player) === playerId));

const candidateNames = (candidates) =>
  candidates.map((candidate) => playerReferenceText(candidate)).filter(Boolean).join("; ") || "(none)";

/**
 * Players who already have a row for `teamId` in this match. Candidate
 * discovery uses the inverse: a squad member with no batting, bowling, DNB,
 * XI or twelfth-man reference cannot be the person behind a placeholder who
 * also appears in that match.
 */
function playersWithRowsForTeam(match, teamId) {
  const ids = new Set();
  const add = (value) => {
    const id = idOf(value);
    if (id) ids.add(id);
  };
  const addWhenTeam = (ownerTeam, value) => {
    const owner = idOf(ownerTeam);
    if (!owner || owner === teamId) add(value);
  };

  const inningsList = [
    ...(match.innings || []),
    ...(match.superOvers || []).flatMap((over) => over.innings || []),
  ];
  for (const innings of inningsList) {
    const battingTeam = idOf(innings.team);
    // An innings without a team cannot be assigned safely, so count every
    // reference as a row for the team. Over-reporting here can only remove a
    // candidate; it can never invent one.
    const addBatting = (value) => {
      if (!battingTeam || battingTeam === teamId) add(value);
    };
    const addFielding = (value) => {
      if (!battingTeam || battingTeam !== teamId) add(value);
    };

    for (const player of [
      innings.currentBatsman1,
      innings.currentBatsman2,
      innings.onStrikeBatsman,
      ...(innings.battingOrder || []),
    ]) addBatting(player);
    for (const row of innings.batting || []) {
      addBatting(row.player);
      addFielding(row.dismissedBy);
      addFielding(row.fielder);
      for (const shot of row.shots || []) addFielding(shot.bowler);
    }
    for (const row of innings.bowling || []) addFielding(row.player);
    for (const row of innings.fallOfWickets || []) {
      addBatting(row.player);
      addFielding(row.fielder);
    }
    for (const row of innings.partnerships || []) {
      addBatting(row.batsman1);
      addBatting(row.batsman2);
    }
    addFielding(innings.currentBowler);
    addFielding(innings.twelfthManBowlBlock?.player);
    for (const over of innings.oversHistory || []) {
      addFielding(over.bowler);
      for (const ball of over.balls || []) {
        addBatting(ball.batsmanOnStrike);
        addBatting(ball.batsmanNonStrike);
        addBatting(ball.dismissedPlayer);
        addFielding(ball.bowler);
        addFielding(ball.fielder);
      }
    }
  }

  for (const over of match.superOvers || []) {
    for (const entry of over.bowlers || []) addWhenTeam(entry.team || over.team, entry.bowler);
    for (const entry of over.batsmen || []) {
      for (const player of entry.players || []) {
        addWhenTeam(entry.team || over.team, player);
      }
    }
  }

  for (const group of [...(match.playingXI || []), ...(match.bowlingXI || [])]) {
    for (const player of group.players || []) addWhenTeam(group.team, player);
    addWhenTeam(group.team, group.captain);
    addWhenTeam(group.team, group.viceCaptain);
    for (const player of group.wicketKeepers || []) addWhenTeam(group.team, player);
  }
  for (const entry of match.twelfthMan || []) addWhenTeam(entry.team, entry.player);
  for (const entry of match.impactPlayers || []) {
    addWhenTeam(entry.team, entry.player);
    addWhenTeam(entry.team, entry.replaces);
  }
  for (const entry of match.teamRoles || []) {
    addWhenTeam(entry.team, entry.captain);
    addWhenTeam(entry.team, entry.viceCaptain);
    for (const player of entry.wicketKeepers || []) addWhenTeam(entry.team, player);
  }
  for (const entry of match.drsReviews || []) addWhenTeam(entry.team, entry.requestedBy);
  add(match.manOfMatch);
  add(match.result?.playerOfMatch);
  return ids;
}

function matchContextFor(match, playerId, teamId, teamById) {
  const fixture = fixtureTeamIds(match)
    .map((id) => teamLabelOf(teamById, id) || "Unknown team")
    .join(" vs ") || "unknown fixture";

  const appearances = [];
  for (const [index, innings] of (match.innings || []).entries()) {
    const battingRoles = [];
    const fieldingRoles = [];
    if ((innings.battingOrder || []).some((player) => idOf(player) === playerId)) battingRoles.push("batting order");
    if ((innings.batting || []).some((row) => idOf(row.player) === playerId)) battingRoles.push("batting card");
    if ((innings.fallOfWickets || []).some((row) => idOf(row.player) === playerId)) battingRoles.push("fall of wicket");
    if ((innings.partnerships || []).some((row) =>
      idOf(row.batsman1) === playerId || idOf(row.batsman2) === playerId)) battingRoles.push("partnership");
    if ((innings.bowling || []).some((row) => idOf(row.player) === playerId)) fieldingRoles.push("bowling card");
    if (idOf(innings.currentBowler) === playerId) fieldingRoles.push("current bowler");
    if (idOf(innings.twelfthManBowlBlock?.player) === playerId) fieldingRoles.push("twelfth-man bowl block");
    // A player can be credited on either side of an over-history ball, so the
    // batting and fielding roles are collected separately.
    if ((innings.oversHistory || []).some((over) =>
      (over?.balls || []).some((ball) =>
        [ball?.batsmanOnStrike, ball?.batsmanNonStrike, ball?.dismissedPlayer]
          .some((player) => idOf(player) === playerId)))) {
      battingRoles.push("over history");
    }
    if ((innings.oversHistory || []).some((over) =>
      idOf(over?.bowler) === playerId ||
      (over?.balls || []).some((ball) =>
        [ball?.bowler, ball?.fielder].some((player) => idOf(player) === playerId)))) {
      fieldingRoles.push("over history");
    }

    const battingTeamId = idOf(innings.team);
    const fieldingTeamId = battingTeamId ? opposingTeamIdFor(match, innings) : "";
    if (battingRoles.length) {
      appearances.push(
        `${teamLabelOf(teamById, battingTeamId) || `innings ${index + 1}`} (${[...new Set(battingRoles)].join(", ")})`,
      );
    }
    if (fieldingRoles.length) {
      appearances.push(
        `${teamLabelOf(teamById, fieldingTeamId) || `innings ${index + 1} fielding`} (${[...new Set(fieldingRoles)].join(", ")})`,
      );
    }
  }

  for (const group of match.playingXI || []) {
    if ((group.players || []).some((player) => idOf(player) === playerId)) {
      appearances.push(`${teamLabelOf(teamById, group.team) || "match"} (playing XI)`);
    }
  }
  for (const entry of match.twelfthMan || []) {
    if (idOf(entry.player) === playerId) {
      appearances.push(`${teamLabelOf(teamById, entry.team) || "match"} (twelfth man)`);
    }
  }
  for (const entry of match.impactPlayers || []) {
    if (idOf(entry.player) === playerId) {
      appearances.push(`${teamLabelOf(teamById, entry.team) || "match"} (impact player)`);
    }
    if (idOf(entry.replaces) === playerId) {
      appearances.push(`${teamLabelOf(teamById, entry.team) || "match"} (replaced by impact player)`);
    }
  }
  if (idOf(match.manOfMatch) === playerId) appearances.push("man of the match");

  const unique = [...new Set(appearances)];
  return `${matchLabel(match)}: ${fixture}; innings: ${unique.length ? unique.join("; ") : "no scored appearance"}`;
}

function bowlerReconciliationFor(match, playerId, teamId, teamById) {
  const lines = [];
  for (const innings of match.innings || []) {
    const battingTeamId = idOf(innings.team);
    const bowlingRows = innings.bowling || [];
    // The scorecard decides where the placeholder bowled. Do not use the
    // resolved Player.team to choose the innings: a placeholder whose
    // Player.team is stale would otherwise reconcile the wrong side.
    if (!bowlingRows.some((row) => idOf(row.player) === playerId)) continue;
    const fieldingTeamId = battingTeamId ? opposingTeamIdFor(match, innings) : teamId;

    const battingRows = innings.batting || [];
    if (
      !bowlingRows.length &&
      !battingRows.length &&
      !Number(innings.runs) &&
      !Number(innings.wickets) &&
      !Number(innings.balls)
    ) continue;

    let bowlingBalls = 0;
    let bowlingRuns = 0;
    let bowlingWickets = 0;
    let own = null;
    for (const row of bowlingRows) {
      const balls = Number(row.balls) > 0 ? Number(row.balls) : oversAsBalls(row.overs);
      const runs = Number(row.runs) || 0;
      const wickets = Number(row.wickets) || 0;
      bowlingBalls += balls;
      bowlingRuns += runs;
      bowlingWickets += wickets;
      if (idOf(row.player) === playerId) own = { balls, runs, wickets };
    }

    const extras = innings.extras || {};
    const wides = Number(extras.wides) || 0;
    const noBalls = Number(extras.noBalls) || 0;
    const byes = Number(extras.byes) || 0;
    const legByes = Number(extras.legByes) || 0;
    const penalties = Number(extras.penalties) || 0;
    const extraTotal = Number(extras.total) > 0
      ? Number(extras.total)
      : wides + noBalls + byes + legByes + penalties;

    const battingRuns = battingRows.reduce((sum, row) => sum + (Number(row.runs) || 0), 0);
    const declaredRuns = Number(innings.runs);
    const totalRuns = declaredRuns > 0 ? declaredRuns : battingRuns + extraTotal;

    const outWickets = battingRows.filter((row) => {
      if (row.isOut === true) return true;
      if (row.isOut === false) return false;
      return Boolean(row.dismissalType);
    }).length;
    const declaredWickets = Number(innings.wickets);
    const totalWickets = declaredWickets > 0 ? declaredWickets : outWickets;

    const declaredBalls = Number(innings.balls);
    const battingBalls = battingRows.reduce((sum, row) => sum + (Number(row.balls) || 0), 0);
    const totalBalls = declaredBalls > 0
      ? declaredBalls
      : oversAsBalls(innings.overs) || battingBalls;

    const nonBowlerWickets = battingRows.filter((row) => {
      const type = String(row.dismissalType || "").trim().toLowerCase();
      return row.isRetired === true ||
        row.isRetiredHurt === true ||
        type.includes("run out") ||
        type === "retired" ||
        type === "retired hurt" ||
        type === "obstructing the field" ||
        type === "obstruction" ||
        type === "timed out" ||
        type === "handled the ball";
    }).length;

    const expectedBowlerRuns = totalRuns - byes - legByes - penalties;
    const expectedBowlerWickets = totalWickets - nonBowlerWickets;
    const deltaText = (delta) => {
      if (!delta.balls && !delta.runs && !delta.wickets) return "reconciled";
      const overs = `${delta.balls < 0 ? "-" : ""}${formatOvers(Math.abs(delta.balls))}`;
      return `unreconciled ${overs} ov / ${delta.runs > 0 ? "+" : ""}${delta.runs} r / ${delta.wickets > 0 ? "+" : ""}${delta.wickets} w`;
    };
    const teamDelta = {
      balls: totalBalls - bowlingBalls,
      runs: expectedBowlerRuns - bowlingRuns,
      wickets: expectedBowlerWickets - bowlingWickets,
    };

    let line = `${matchLabel(match)}: ${teamLabelOf(teamById, battingTeamId) || "Unknown team"} batting ${totalRuns}/${totalWickets} (${formatOvers(totalBalls)} ov; extras ${extraTotal}: w${wides} nb${noBalls} b${byes} lb${legByes} p${penalties}) vs ${teamLabelOf(teamById, fieldingTeamId) || "Unknown team"} bowling ${formatOvers(bowlingBalls)} ov / ${bowlingRuns} r / ${bowlingWickets} w -> team ${deltaText(teamDelta)}`;
    if (own) {
      const withoutPlaceholder = {
        balls: totalBalls - (bowlingBalls - own.balls),
        runs: expectedBowlerRuns - (bowlingRuns - own.runs),
        wickets: expectedBowlerWickets - (bowlingWickets - own.wickets),
      };
      line += `; placeholder ${formatOvers(own.balls)} ov / ${own.runs} r / ${own.wickets} w; without placeholder ${deltaText(withoutPlaceholder)}`;
    }
    lines.push(line);
  }
  return lines.join(" | ");
}

const publishedOrDraft = (match) =>
  match?.manualDraft === true ||
  ["live", "completed", "innings-break", "innings_break", "toss_done", "super_over", "pending_tie_resolution", "abandoned"]
    .includes(String(match?.status || "").toLowerCase());

const addPlayerTeam = (assignments, playerRef, teamRef) => {
  const playerId = idOf(playerRef);
  if (!playerId) return;
  const teamId = idOf(teamRef);
  if (!assignments.has(playerId)) {
    // A scorecard row can lack side information (older fixtures omit
    // innings.team). The reference still counts; the player's DB team or roster
    // fills the assignment in later.
    assignments.set(playerId, teamId || "");
    return;
  }
  if (teamId && !assignments.get(playerId)) assignments.set(playerId, teamId);
};

/**
 * Map every player referenced by a played (or draft) scorecard to the side they
 * appeared for. Player.team is not required: an imported placeholder can be
 * missing that link while still being present in Team.players and in the
 * innings/XI data the public squad view reads.
 */
export function collectMatchPlayerReferences(matches = []) {
  const assignments = new Map();
  const add = addPlayerTeam;

  for (const match of matches) {
    if (!publishedOrDraft(match)) continue;

    for (const group of [...(match.playingXI || []), ...(match.squad15 || []), ...(match.bowlingXI || [])]) {
      const team = group?.team;
      for (const player of group?.players || []) add(assignments, player, team);
      add(assignments, group?.captain, team);
      add(assignments, group?.viceCaptain, team);
      for (const player of group?.wicketKeepers || []) add(assignments, player, team);
    }
    for (const entry of match.twelfthMan || []) add(assignments, entry?.player, entry?.team);
    for (const entry of match.impactPlayers || []) {
      add(assignments, entry?.player, entry?.team);
      add(assignments, entry?.replaces, entry?.team);
    }
    for (const entry of match.teamRoles || []) {
      const team = entry?.team;
      add(assignments, entry?.captain, team);
      add(assignments, entry?.viceCaptain, team);
      for (const player of entry?.wicketKeepers || []) add(assignments, player, team);
    }
    for (const entry of match.drsReviews || []) add(assignments, entry?.requestedBy, entry?.team);
    add(assignments, match.manOfMatch);
    add(assignments, match.result?.playerOfMatch);

    const inningsList = [...(match.innings || [])];
    for (const over of match.superOvers || []) {
      inningsList.push(...(over.innings || []));
      for (const entry of over.bowlers || []) add(assignments, entry?.bowler, entry?.team || over?.team);
      for (const entry of over.batsmen || []) {
        for (const player of entry?.players || []) add(assignments, player, entry?.team || over?.team);
      }
    }

    for (const innings of inningsList) {
      const battingTeam = innings?.team;
      // A batting row belongs to the innings' own side. A bowling or fielding
      // reference belongs to the other side in the fixture. Never assign a
      // bowler to the innings' batting team.
      const fieldingTeam = battingTeam ? opposingTeamIdFor(match, innings) : "";
      const addBatting = (player) => add(assignments, player, battingTeam);
      const addFielding = (player) => add(assignments, player, fieldingTeam);
      for (const player of [
        innings?.currentBatsman1,
        innings?.currentBatsman2,
        innings?.onStrikeBatsman,
        ...(innings?.battingOrder || []),
      ]) addBatting(player);
      addFielding(innings?.currentBowler);
      addFielding(innings?.twelfthManBowlBlock?.player);
      for (const row of innings?.batting || []) {
        addBatting(row?.player);
        addFielding(row?.dismissedBy);
        addFielding(row?.fielder);
        for (const shot of row?.shots || []) addFielding(shot?.bowler);
      }
      for (const row of innings?.bowling || []) addFielding(row?.player);
      for (const row of innings?.fallOfWickets || []) {
        addBatting(row?.player);
        addFielding(row?.fielder);
      }
      for (const row of innings?.partnerships || []) {
        addBatting(row?.batsman1);
        addBatting(row?.batsman2);
      }
      for (const over of innings?.oversHistory || []) {
        addFielding(over?.bowler);
        for (const ball of over?.balls || []) {
          addBatting(ball?.batsmanOnStrike);
          addBatting(ball?.batsmanNonStrike);
          addBatting(ball?.dismissedPlayer);
          addFielding(ball?.bowler);
          addFielding(ball?.fielder);
        }
      }
    }
  }
  return assignments;
}

/**
 * Resolve each player's side from every source, in the required priority:
 *   1. membership in the tournament squad or Team.players roster,
 *   2. the CREATE entry in the QF/SF name map,
 *   3. Player.team.
 * The scorecard (with bowling rows assigned to the fielding side) is the last
 * resort for a player none of the above knows. A disagreement is reported in
 * `conflicts` instead of being silently discarded.
 */
export function resolvePlayerTeams({
  tournament,
  teams = [],
  players = [],
  matches = [],
  mapEntries = [],
}) {
  const teamById = new Map(teams.map((team) => [idOf(team), team]));
  const teamByName = new Map(teams.map((team) => [normalizeName(team.name), team]));
  const squadByPlayer = new Map();
  const rosterByPlayer = new Map();
  const createByPlayer = new Map();
  const add = (map, playerId, teamId) => {
    if (!playerId || !teamId) return;
    if (!map.has(playerId)) map.set(playerId, new Set());
    map.get(playerId).add(teamId);
  };

  for (const entry of tournament?.tournamentSquads || []) {
    const teamId = idOf(entry.team);
    for (const player of entry.players || []) add(squadByPlayer, idOf(player), teamId);
  }
  for (const team of teams) {
    const teamId = idOf(team);
    for (const player of team.players || []) add(rosterByPlayer, idOf(player), teamId);
  }
  for (const entry of mapEntries) {
    const value = String(entry?.mappedValue || "").trim();
    if (!value.toUpperCase().startsWith("CREATE:")) continue;
    const targetName = value.slice("CREATE:".length).trim();
    if (!targetName) continue;
    const team = teamByName.get(normalizeName(entry.teamName));
    if (!team) continue;
    for (const player of players) {
      if (normalizeName(player.name) !== normalizeName(targetName)) continue;
      add(createByPlayer, idOf(player), idOf(team));
    }
  }

  const scorecardTeams = collectMatchPlayerReferences(matches);
  const assignments = new Map();
  const conflicts = new Map();
  const sourceList = (map, playerId) => [...(map.get(playerId) || [])];
  const label = (teamId) => teamById.get(teamId)?.name || "Unknown team";

  for (const player of players) {
    const playerId = idOf(player);
    const squad = sourceList(squadByPlayer, playerId);
    const roster = sourceList(rosterByPlayer, playerId);
    const create = sourceList(createByPlayer, playerId);
    const scorecard = [scorecardTeams.get(playerId)].filter(Boolean);
    const ownTeamId = idOf(player.team);

    const chosen = squad[0] ||
      roster[0] ||
      create[0] ||
      (teamById.has(ownTeamId) ? ownTeamId : "") ||
      scorecard[0] ||
      "";
    if (chosen) assignments.set(playerId, chosen);

    const distinct = uniqueIds([
      ...squad,
      ...roster,
      ...create,
      ...(ownTeamId ? [ownTeamId] : []),
      ...scorecard,
    ]).filter((teamId) => teamById.has(teamId));
    if (distinct.length <= 1) continue;

    const parts = [];
    if (squad.length) parts.push(`tournament squad=${squad.map(label).join("+")}`);
    if (roster.length) parts.push(`Team.players=${roster.map(label).join("+")}`);
    if (create.length) parts.push(`CREATE map=${create.map(label).join("+")}`);
    if (ownTeamId) parts.push(`Player.team=${label(ownTeamId)}`);
    if (scorecard.length) parts.push(`scorecard=${scorecard.map(label).join("+")}`);
    conflicts.set(playerId, parts.join("; "));
  }

  return { assignments, conflicts, scorecardTeams };
}

export function buildPlayerReview({
  tournament,
  teams,
  players,
  matches,
  mapEntries,
  originalSquadNames = new Map(),
  playerTeams = new Map(),
  teamConflicts = new Map(),
}) {
  const teamById = new Map(teams.map((team) => [idOf(team), team]));
  const squadByTeam = new Map();
  for (const entry of tournament.tournamentSquads || []) {
    const teamId = idOf(entry.team);
    if (!squadByTeam.has(teamId)) squadByTeam.set(teamId, new Set());
    for (const player of entry.players || []) squadByTeam.get(teamId).add(idOf(player));
  }
  const rosterByTeam = new Map(
    teams.map((team) => [idOf(team), new Set((team.players || []).map(idOf))]),
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
  const matchPlayerTeams = collectMatchPlayerReferences(relevantMatches);
  const referencedPlayerIds = new Set(matchPlayerTeams.keys());

  // Roster membership is the DB fallback for a team with no tournament squad,
  // and is more specific than a stale Player.team link. Explicit assignments
  // (roster/match/CREATE discovery) win over Player.team.
  const assignments = new Map(matchPlayerTeams);
  for (const team of teams) {
    for (const player of team.players || []) assignments.set(idOf(player), idOf(team));
  }
  for (const [playerId, teamId] of playerTeams) assignments.set(playerId, teamId);

  const playerById = new Map(players.map((player) => [idOf(player), player]));
  // The tournament squad is the authority. Team.players is the DB fallback for
  // a team with no squad, and the assigned players are the last resort for
  // older data where neither list was maintained.
  const squadPlayersByTeam = new Map();
  for (const team of teams) {
    const teamId = idOf(team);
    const dbSquad = squadByTeam.get(teamId);
    const roster = rosterByTeam.get(teamId) || new Set();
    const assigned = players
      .filter((player) => assignments.get(idOf(player)) === teamId)
      .map((player) => idOf(player));
    const ids = dbSquad && dbSquad.size > 0
      ? [...dbSquad]
      : roster.size > 0
        ? [...roster]
        : assigned;
    squadPlayersByTeam.set(
      teamId,
      [...new Set(ids)].map((id) => playerById.get(id)).filter(Boolean),
    );
  }

  // Candidate membership depends on the match, so cache the "players with a
  // row for this side" set instead of recalculating it for every placeholder.
  const matchRowsCache = new Map();
  const rowsInMatchFor = (match, teamId) => {
    const key = `${idOf(match)}::${teamId}`;
    if (!matchRowsCache.has(key)) matchRowsCache.set(key, playersWithRowsForTeam(match, teamId));
    return matchRowsCache.get(key);
  };

  const duplicateNames = new Map();
  for (const player of players) {
    const key = normalizeName(player.name);
    const teamId = assignments.get(idOf(player)) || idOf(player.team);
    const existing = duplicateNames.get(key) || [];
    existing.push({ id: idOf(player), teamId });
    duplicateNames.set(key, existing);
  }

  const rows = [];
  for (const player of players) {
    const playerId = idOf(player);
    const playerTeamId = idOf(player.team);
    const teamId = assignments.get(playerId) ||
      (teamById.has(playerTeamId) ? playerTeamId : "");
    const team = teamById.get(teamId);
    if (!team) continue;
    const targetMappings = mapTargets.filter((entry) =>
      normalizeName(entry.teamName) === normalizeName(team.name) &&
      normalizeName(entry.targetName) === normalizeName(player.name),
    );
    const isTbc = /\(TBC\)$/i.test(String(player.name || "").trim());
    const isCreateTarget = targetMappings.some(
      (entry) => entry.mappedValue.toUpperCase().startsWith("CREATE:"),
    );
    const csvNames = originalSquadNames.get(normalizeName(team.name));
    const teamSquad = squadByTeam.get(teamId);
    const roster = rosterByTeam.get(teamId) || new Set();
    // When a tournament squad exists in the DB it is the authority. Otherwise
    // fall back to Team.players so an empty tournamentSquads array does not
    // turn every match participant into a "missing" player.
    const isOriginalByDb = teamSquad
      ? teamSquad.has(playerId)
      : roster.has(playerId);
    const isOriginalByCsv = Boolean(csvNames?.has(normalizeName(player.name)));
    const hasSquadEvidence = Boolean(teamSquad) || roster.size > 0 || Boolean(csvNames?.size);
    const isOutsideOriginalSquad = hasSquadEvidence
      ? !(isOriginalByDb || isOriginalByCsv)
      : true;
    const isReferencedInMatches = referencedPlayerIds.has(playerId);
    if (
      !isTbc &&
      !isCreateTarget &&
      !(isReferencedInMatches && isOutsideOriginalSquad)
    ) continue;

    const stats = { runs: 0, balls: 0, bowlingBalls: 0, bowlingRuns: 0, wickets: 0 };
    const labels = [];
    const appearedMatches = [];
    for (const match of relevantMatches) {
      const appearance = matchAppearance(match, playerId);
      if (!appearance.appeared) continue;
      appearedMatches.push(match);
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

    const teamSquadPlayers = squadPlayersByTeam.get(teamId) || [];
    const perMatchCandidates = appearedMatches.map((match) => {
      const rowsInMatch = rowsInMatchFor(match, teamId);
      const candidates = teamSquadPlayers.filter((candidate) => {
        const candidateId = idOf(candidate);
        return candidateId !== playerId &&
          !isTbcName(candidate.name) &&
          !rowsInMatch.has(candidateId);
      });
      return { match, candidates };
    });
    const candidateSets = perMatchCandidates.map((entry) => new Set(entry.candidates.map(idOf)));
    const intersection = candidateSets.length
      ? [...candidateSets[0]].filter((id) => candidateSets.every((set) => set.has(id)))
      : [];
    const candidateById = new Map(teamSquadPlayers.map((candidate) => [idOf(candidate), candidate]));
    const candidateRealPlayers = intersection
      .map((id) => playerReferenceText(candidateById.get(id)))
      .filter(Boolean)
      .join("; ");
    const candidatesByMatch = perMatchCandidates
      .map((entry) => {
        const names = entry.candidates
          .map((candidate) => playerReferenceText(candidate))
          .filter(Boolean);
        return `${matchLabel(entry.match)}: ${names.length ? names.join("; ") : "(none)"}`;
      })
      .join(" | ");

    // Looser evidence for a bowler or batter placeholder: same-team squad
    // members who lack the relevant row in that match, even if they have a row
    // on the other side of the scorecard. The strict columns above are kept.
    const candidatesWithoutBowlingRow = appearedMatches
      .filter((match) => hasBowlingRow(match, playerId))
      .map((match) => {
        const bowlers = playersWithBowlingRowForTeam(match, teamId);
        const candidates = teamSquadPlayers.filter((candidate) => {
          const candidateId = idOf(candidate);
          return candidateId !== playerId &&
            !isTbcName(candidate.name) &&
            !bowlers.has(candidateId);
        });
        return `${matchLabel(match)}: ${candidateNames(candidates)}`;
      })
      .join(" | ");
    const candidatesWithoutBattingRow = appearedMatches
      .filter((match) => hasBattingRow(match, playerId))
      .map((match) => {
        const batters = playersWithBattingRowForTeam(match, teamId);
        const candidates = teamSquadPlayers.filter((candidate) => {
          const candidateId = idOf(candidate);
          return candidateId !== playerId &&
            !isTbcName(candidate.name) &&
            !batters.has(candidateId);
        });
        return `${matchLabel(match)}: ${candidateNames(candidates)}`;
      })
      .join(" | ");

    const placeholderKey = normalizeName(stripTbcSuffix(player.name));
    const similarNames = [];
    const seenSimilar = new Set();
    for (const candidate of teamSquadPlayers) {
      const candidateId = idOf(candidate);
      if (candidateId === playerId || seenSimilar.has(candidateId) || isTbcName(candidate.name)) continue;
      const reason = similarNameReason(player.name, candidate.name);
      if (!reason) continue;
      seenSimilar.add(candidateId);
      similarNames.push(`${playerReferenceText(candidate)} (${reason})`);
    }
    similarNames.sort((left, right) => left.localeCompare(right));

    // Same name on another team is informational only. It is deliberately kept
    // out of candidate_real_players and is never a merge suggestion: an
    // applyPlayerNames cross-team merge still needs the explicit row opt-in.
    const otherTeamNames = [];
    const seenOtherTeams = new Set();
    for (const otherTeam of teams) {
      const otherTeamId = idOf(otherTeam);
      if (otherTeamId === teamId) continue;
      for (const candidate of squadPlayersByTeam.get(otherTeamId) || []) {
        const candidateId = idOf(candidate);
        if (seenOtherTeams.has(candidateId) || isTbcName(candidate.name)) continue;
        if (normalizeName(stripTbcSuffix(candidate.name)) !== placeholderKey) continue;
        seenOtherTeams.add(candidateId);
        otherTeamNames.push(`${otherTeam.name}: ${playerReferenceText(candidate)}`);
      }
    }
    otherTeamNames.sort((left, right) => left.localeCompare(right));

    const matchContext = appearedMatches
      .map((match) => matchContextFor(match, playerId, teamId, teamById))
      .join(" | ");
    // Reconciliation is for placeholder bowlers. It is blank for a batter so
    // the column does not imply a bowling question that does not exist.
    const bowlerReconciliation = appearedMatches
      .filter((match) => (match.innings || []).some((innings) =>
        (innings.bowling || []).some((row) => idOf(row.player) === playerId)))
      .map((match) => bowlerReconciliationFor(match, playerId, teamId, teamById))
      .filter(Boolean)
      .join(" | ");

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
      allow_cross_team: "",
      candidate_real_players: candidateRealPlayers,
      candidates_by_match: candidatesByMatch,
      similar_names: similarNames.join("; "),
      similar_names_other_teams: otherTeamNames.join("; "),
      match_context: matchContext,
      bowler_reconciliation: bowlerReconciliation,
      team_conflict: teamConflicts.get(playerId) || "",
      candidates_without_bowling_row: candidatesWithoutBowlingRow,
      candidates_without_batting_row: candidatesWithoutBattingRow,
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
