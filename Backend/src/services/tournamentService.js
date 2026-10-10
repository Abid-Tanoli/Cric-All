import Tournament from "../models/Tournament.js";
import Match from "../models/Match.js";

export const DEFAULT_POINTS = { win: 2, tie: 1, noResult: 1 };

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const idOf = (value) => String(value?._id || value || "");
const sameId = (a, b) => Boolean(idOf(a)) && idOf(a) === idOf(b);

/** Points awarded for a result type on a tournament (pointsConfig, else default). */
export const pointsConfigOf = (tournament, key) => {
  const cfg = tournament?.pointsConfig || {};
  const value = toNumber(cfg?.[key], DEFAULT_POINTS[key]);
  return value >= 0 ? value : DEFAULT_POINTS[key];
};

/**
 * Recompute a tournament's points table from its completed matches, from
 * scratch. This is idempotent by construction: re-running it after a result is
 * re-saved rebuilds the same rows, so a completed match can never double-count.
 *
 * Tie and no-result are distinct rows (`tied` / `noResult`), each earning the
 * configured tie / noResult points. NRR uses a full-quota overs model per
 * match (each team is charged the match's total overs).
 */
export const recomputeTournamentPoints = async (tournamentId) => {
  const tournament = await Tournament.findById(tournamentId).populate({
    path: "matches",
    populate: { path: "teams", select: "name" },
  });

  if (!tournament) return null;

  const newPointsTable = (tournament.teams || []).map((teamId) => ({
    team: teamId,
    matchesPlayed: 0,
    won: 0,
    lost: 0,
    tied: 0,
    noResult: 0,
    points: 0,
    netRunRate: 0,
    for: 0,
    against: 0,
    wicketsFor: 0,
    wicketsAgainst: 0,
    seriesForm: [],
  }));

  const rowFor = (teamId) =>
    newPointsTable.find((row) => sameId(row.team, teamId));

  const finishedMatches = (tournament.matches || []).filter(
    (match) => match?.status === "completed" && Array.isArray(match?.teams) && match.teams.length === 2,
  );

  for (const match of finishedMatches) {
    const team1 = match.teams[0];
    const team2 = match.teams[1];
    const t1 = rowFor(team1);
    const t2 = rowFor(team2);
    if (!t1 || !t2) continue;

    t1.matchesPlayed += 1;
    t2.matchesPlayed += 1;

    const resultType = match.result?.resultType;
    const isTie = resultType === "tie";
    const isNoResult = resultType === "no result" || resultType === "no_result";

    if (isTie || isNoResult) {
      const points = pointsConfigOf(tournament, isTie ? "tie" : "noResult");
      if (isTie) {
        t1.tied += 1;
        t2.tied += 1;
        t1.seriesForm.push("T");
        t2.seriesForm.push("T");
      } else {
        t1.noResult += 1;
        t2.noResult += 1;
        t1.seriesForm.push("NR");
        t2.seriesForm.push("NR");
      }
      t1.points += points;
      t2.points += points;
    } else if (match.result?.winner) {
      const winPoints = pointsConfigOf(tournament, "win");
      const winner = match.result.winner;
      const teamWins = sameId(winner, team1);
      const winningRow = teamWins ? t1 : t2;
      const losingRow = teamWins ? t2 : t1;
      winningRow.won += 1;
      winningRow.points += winPoints;
      winningRow.seriesForm.push("W");
      losingRow.lost += 1;
      losingRow.seriesForm.push("L");
    }

    const inn1 = match.innings?.[0];
    const inn2 = match.innings?.[1];
    if (inn1 && inn2) {
      t1.for += toNumber(inn1.runs);
      t1.against += toNumber(inn2.runs);
      t1.wicketsFor += toNumber(inn2.wickets);
      t1.wicketsAgainst += toNumber(inn1.wickets);

      t2.for += toNumber(inn2.runs);
      t2.against += toNumber(inn1.runs);
      t2.wicketsFor += toNumber(inn1.wickets);
      t2.wicketsAgainst += toNumber(inn2.wickets);
    }

    // Full-quota overs model: each side is charged the match's total overs.
    const overs = Math.max(toNumber(match.totalOvers, 20), 1);
    t1.__oversFaced = (t1.__oversFaced || 0) + overs;
    t2.__oversFaced = (t2.__oversFaced || 0) + overs;
  }

  newPointsTable.forEach((row) => {
    const oversFaced = row.__oversFaced || 0;
    row.netRunRate =
      oversFaced > 0
        ? Number(((row.for / oversFaced) - (row.against / oversFaced)).toFixed(3))
        : 0;
    row.seriesForm = (row.seriesForm || []).slice(-5);
    delete row.__oversFaced;
  });

  tournament.pointsTable = newPointsTable;
  await tournament.save();
  return tournament;
};

/**
 * Legacy name kept so the score controller's completion hook
 * (`scoreController.js`) keeps working unchanged. Errors are logged, never
 * thrown: a failed standings rebuild must not break scoring.
 */
export const updateTournamentPoints = async (tournamentId) => {
  try {
    await recomputeTournamentPoints(tournamentId);
  } catch (error) {
    console.error("[TournamentSync] Error:", error);
  }
};

// --- Fixture generation (pure helpers, no DB) -------------------------------

export const nextPowerOfTwo = (n) => (n > 0 ? 2 ** Math.ceil(Math.log2(n)) : 0);

const rotateRow = (row) => {
  if (row.length < 3) return row;
  // Circle method: keep index 0 fixed, rotate the rest right by one.
  return [row[0], row[row.length - 1], ...row.slice(1, row.length - 1)];
};

/**
 * Single round-robin by the circle method. Odd team counts insert a BYE so
 * every round has a complete set of pairings.
 * Returns [{ round, matches: [{ team1, team2 }], bye }].
 * Undefined/empty team ids are treated as byes.
 */
export function generateRoundRobinRounds(teams) {
  if (!Array.isArray(teams) || teams.length < 2) return [];
  const row = teams.slice().filter((t) => t != null);
  const n = row.length;
  if (n < 2) return [];

  const slots = n % 2 === 1 ? [...row, null] : [...row];
  const m = slots.length;
  // With an even number of slots the circle method needs m-1 rounds; an odd
  // team count is padded to m = n+1 slots, so this is n rounds either way.
  const numRounds = m - 1;
  const rounds = [];

  for (let r = 0; r < numRounds; r += 1) {
    const matches = [];
    let bye = null;
    for (let i = 0; i < m / 2; i += 1) {
      const a = slots[i];
      const b = slots[m - 1 - i];
      if (a == null) bye = b;
      else if (b == null) bye = a;
      else matches.push({ team1: a, team2: b });
    }
    rounds.push({ round: r + 1, matches, bye });
    slots.splice(0, slots.length, ...rotateRow(slots));
  }
  return rounds;
}

/**
 * Seeded knockout bracket with byes to the next power of two.
 * Round 1 keeps concrete teams (top seeds that get a bye do not appear in
 * round 1); later rounds are placeholders (team1/team2 null, `isTbd: true`).
 * Returns { rounds: [{ round, matches: [{ round, matchNumber, team1, team2,
 * isTbd, label }] }] }.
 */
export function generateKnockoutRoundStructure(teams) {
  const seedOrder = Array.isArray(teams) ? teams.slice().filter((t) => t != null) : [];
  const n = seedOrder.length;
  const size = nextPowerOfTwo(n);
  const byes = Math.max(size - n, 0);

  const rounds = [];
  let matchNumber = 0;

  const roundOneCount = size / 2;
  const r1 = [];
  for (let i = 0; i < roundOneCount; i += 1) {
    matchNumber += 1;
    // The top `byes` seeds sit out round one, so seed `byes + i` faces seed
    // `n - 1 - i` (a mirror pairing that keeps 1-vs-last in later rounds).
    const team1 = byes + i < n ? seedOrder[byes + i] : null;
    const team2 = n - 1 - i >= byes ? seedOrder[n - 1 - i] : null;
    if (team1 == null || team2 == null || sameId(team1, team2)) {
      // Not enough concrete teams for a meaningful pair — collapse rather than
      // invent a self-pair.
      continue;
    }
    r1.push({ team1, team2, round: 1, matchNumber, isTbd: false });
  }
  rounds.push({ round: 1, matches: r1 });

  let pending = size / 2;
  for (let round = 2; pending >= 2; round += 1) {
    const count = pending / 2;
    const matches = [];
    let exact = true;
    for (let i = 0; i < count; i += 1) {
      matchNumber += 1;
      if (count === 1) {
        matches.push({ team1: null, team2: null, round, matchNumber, isTbd: true, label: "Final" });
      } else {
        matches.push({
          team1: null,
          team2: null,
          round,
          matchNumber,
          isTbd: true,
          label: `W${round === 2 ? "R1" : `R${round - 1}`}M${i + 1} vs W${round === 2 ? "R1" : `R${round - 1}`}M${i + 2}`,
        });
      }
    }
    rounds.push({ round, matches, exact });
    pending = count;
  }

  return { rounds, byes, size };
}

// --- Scheduling helper (shared by preview + apply) ---------------------------

const matchCategoryDefault = "Other";
const startAtFor = (base, index, gapHours) =>
  new Date(base.getTime() + index * Math.max(gapHours, 0) * 60 * 60 * 1000);

/**
 * Propose fixtures for a tournament without touching the DB.
 * options: { format: 'round-robin'|'group'|'knockout', startAt, gapHours, venue }
 * Returns a summary meant for both preview and apply.
 */
export function planTournamentFixtures(tournament, options = {}) {
  const format = options.format || "round-robin";
  const base = options.startAt ? new Date(options.startAt) : new Date();
  const gapHours = toNumber(options.gapHours, 2);
  const venue = options.venue || tournament.venue || "";
  const warnings = [];
  const planned = []; // { matchNumber, round, group, team1, team2, startAt, venue, isTbd }

  let matchNumber = 0;
  let nextStart = () => {
    const start = startAtFor(base, planned.length, gapHours);
    return start;
  };

  const pushr = (round, group, pair) => {
    matchNumber += 1;
    planned.push({
      matchNumber,
      round,
      group: group || "",
      team1: pair.team1,
      team2: pair.team2,
      startAt: nextStart(),
      venue,
      isTbd: !(pair.team1 != null && pair.team2 != null),
    });
  };

  if (format === "knockout" || tournament.type === "knockout") {
    const { rounds } = generateKnockoutRoundStructure(tournament.teams || []);
    for (const rd of rounds) {
      for (const match of rd.matches) {
        matchNumber += 1;
        planned.push({
          matchNumber,
          round: rd.round,
          group: "",
          team1: match.team1,
          team2: match.team2,
          startAt: nextStart(),
          venue,
          isTbd: match.isTbd,
        });
      }
    }
    if ((tournament.teams || []).length < 2) {
      warnings.push("Knockout requires at least 2 teams.");
    }
    return {
      format: "knockout",
      type: tournament.type,
      totalMatches: planned.filter((p) => !p.isTbd).length,
      tbdMatches: planned.filter((p) => p.isTbd).length,
      rounds: groupRounds(planned),
      matches: planned,
      warnings,
    };
  }

  if (format === "group" || tournament.type === "group-stage" || tournament.type === "mixed") {
    const groups = tournament.groups || [];
    if (!groups.length) {
      warnings.push("No groups assigned yet — assign groups before generating group fixtures.");
    }
    for (const group of groups) {
      const roundRows = generateRoundRobinRounds(group.teams || []);
      for (const rr of roundRows) {
        for (const match of rr.matches) {
          pushr(rr.round, group.name || "Group", match);
        }
        if (rr.bye != null) {
          planned.push({
            matchNumber: (matchNumber += 1),
            round: rr.round,
            group: group.name || "Group",
            team1: rr.bye,
            team2: null,
            startAt: nextStart(),
            venue,
            isTbd: true,
            bye: true,
          });
        }
      }
    }
    return {
      format: "group",
      type: tournament.type,
      totalMatches: planned.filter((p) => !p.isTbd).length,
      tbdMatches: planned.filter((p) => p.isTbd).length,
      rounds: groupRounds(planned),
      matches: planned,
      warnings,
    };
  }

  // league / round-robin default
  const roundRows = generateRoundRobinRounds(tournament.teams || []);
  for (const rr of roundRows) {
    for (const match of rr.matches) {
      pushr(rr.round, "", match);
    }
    if (rr.bye != null) {
      planned.push({
        matchNumber: (matchNumber += 1),
        round: rr.round,
        group: "",
        team1: rr.bye,
        team2: null,
        startAt: nextStart(),
        venue,
        isTbd: true,
        bye: true,
      });
    }
  }
  return {
    format: "round-robin",
    type: tournament.type,
    totalMatches: planned.filter((p) => !p.isTbd).length,
    tbdMatches: planned.filter((p) => p.isTbd).length,
    rounds: groupRounds(planned),
    matches: planned,
    warnings,
  };
}

const groupRounds = (planned) => {
  const map = new Map();
  for (const match of planned) {
    const key = `${match.round || 1}:${match.group || ""}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(match);
  }
  return Array.from(map.entries()).map(([key, matches]) => {
    const [round, group] = key.split(":");
    return { round: Number(round), group, matches };
  });
};

/** Unordered pair key used to detect duplicate fixtures. */
export const fixturePairKey = (teamA, teamB) => {
  const sorted = [idOf(teamA), idOf(teamB)].sort();
  return `pair:${sorted[0]}:${sorted[1]}`;
};

export default { updateTournamentPoints, recomputeTournamentPoints, planTournamentFixtures };