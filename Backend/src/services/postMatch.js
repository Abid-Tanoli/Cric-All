import Match from "../models/Match.js";
import Player from "../models/Player.js";
import { recordAudit } from "../utils/audit.js";
import { computeTeamRanking, refreshRankingPositions } from "./rankingService.js";
import { buildPlayerCareerStats, loadMatchDocsForPlayers } from "./playerStats.js";
import { recomputeTournamentPoints } from "./tournamentService.js";
import { invalidateTournamentStatsCache } from "./tournamentStats.js";

// ---------------------------------------------------------------------------
// Post-match recompute pipeline
// ---------------------------------------------------------------------------
//
// A match used to reach `completed` through several different handlers, and
// only some of them refreshed the derived tables:
//
//   * /end-innings (the scoring UI's completion call) refreshed nothing;
//   * PUT /matches/:id/status refreshed the tournament points table only;
//   * manual scorecards refreshed the points table only;
//   * undo/edit after completion refreshed nothing.
//
// Team rankings were only ever rebuilt by the admin "recompute all" action and
// `Player.stats` was written by seed scripts, so the public leaderboards (which
// aggregate `Player.stats`) could stay at zero for a whole season.
//
// This module is the one place that refreshes the three derived stores after a
// match changes. Every step is a from-scratch rebuild of the underlying data:
//
//   1. `TeamRanking` for both teams of the match (computeTeamRanking),
//      then the overall/category rank numbers for the whole board.
//   2. `Player.stats` for every player who can hold a stat line in the match,
//      rebuilt from the completed match documents (never incremented).
//   3. The tournament points table (and the public stats cache) when the
//      match belongs to a tournament.
//
// Because every step is a rebuild, the pipeline is idempotent (running it twice
// yields the same rows) and status-aware: when a completed match is undone the
// same call removes its contribution instead of needing a second code path.
//
// Completion must never fail because of this work, so every step is isolated:
// failures are logged, written to the audit log for the Admin screens, and
// returned in `errors` for the caller to surface. Nothing here throws.
// ---------------------------------------------------------------------------

// The subset of `Player.stats` (models/Player.js) that is derived from match
// documents. The full set is always written so a stale value cannot survive.
const PLAYER_STAT_FIELDS = Object.freeze([
  "matches",
  "innings",
  "notOuts",
  "runs",
  "fours",
  "sixes",
  "highScore",
  "average",
  "strikeRate",
  "fifties",
  "hundreds",
  "wickets",
  "bowlingAverage",
  "economy",
  "bestBowling",
  "fourWickets",
  "fiveWickets",
  "dotBalls",
  "catches",
  "stumpings",
  "runOuts",
]);

const idOf = (value) => {
  if (!value) return null;
  if (typeof value === "object") return value._id ? String(value._id) : null;
  return String(value);
};

/**
 * Every player who could hold a stat line for this match: batting and bowling
 * rows, fielders credited with a dismissal, and both playing XIs.
 *
 * The XI matters for undo: reverting the last ball can pop a batting row while
 * the player is still in the XI, and their career figures must still be rebuilt
 * (down) rather than left at the pre-undo value.
 */
export function matchPlayerIds(match) {
  const ids = new Set();
  const add = (value) => {
    const id = idOf(value);
    if (id) ids.add(id);
  };

  for (const innings of match?.innings || []) {
    for (const row of innings.batting || []) {
      add(row.player);
      add(row.fielder);
    }
    for (const row of innings.bowling || []) add(row.player);
  }
  for (const side of match?.playingXI || []) {
    for (const player of side.players || []) add(player);
  }

  return [...ids];
}

/** The `Player.stats` subdocument for one computed career, field by field. */
function statsDocument(career) {
  const doc = {};
  for (const field of PLAYER_STAT_FIELDS) {
    if (career[field] !== undefined) doc[field] = career[field];
  }
  return doc;
}

/** Which of the derived fields differ between the stored and rebuilt values. */
function changedStatFields(current, next) {
  const changed = [];
  for (const field of PLAYER_STAT_FIELDS) {
    if (next[field] === undefined) continue;
    if (field === "bestBowling") {
      if (String(current?.[field] ?? "") !== String(next[field] ?? "")) changed.push(field);
      continue;
    }
    const from = Number(current?.[field] ?? 0);
    const to = Number(next[field] ?? 0);
    if (!Number.isFinite(from) || !Number.isFinite(to) ? String(current?.[field]) !== String(next[field]) : from !== to) {
      changed.push(field);
    }
  }
  return changed;
}

const describeError = (error) => (error?.message ? String(error.message) : String(error));

/**
 * Rebuild every derived table that depends on one match.
 *
 * @param {string|import("mongoose").Types.ObjectId} matchId
 * @param {object} [options]
 * @param {string} [options.reason] short label for logs/audit ("innings:ended").
 * @param {boolean} [options.apply] false computes the same plan without writing
 *   anything, for `npm run stats:recompute` dry runs.
 * @param {boolean} [options.refreshRanks] false skips the board-wide rank
 *   re-derivation; a bulk run calls `refreshRankingPositions` once itself.
 * @returns {Promise<{ok: boolean, applied: boolean, matchId: string, reason: string,
 *   status: string|null, teams: string[], players: {playerId: string, name: string,
 *   changed: string[]}[], tournament: string|null, errors: string[]}>}
 */
export async function runPostMatchPipeline(
  matchId,
  { reason = "completion", apply = true, refreshRanks = true } = {},
) {
  const outcome = {
    ok: true,
    applied: Boolean(apply),
    matchId: matchId ? String(matchId) : "",
    reason,
    status: null,
    teams: [],
    players: [],
    tournament: null,
    errors: [],
  };

  if (!matchId) {
    outcome.ok = false;
    outcome.errors.push("match id is required");
    return outcome;
  }

  let match;
  try {
    match = await Match.findById(matchId);
  } catch (error) {
    outcome.ok = false;
    outcome.errors.push(`load match: ${describeError(error)}`);
  }
  if (!match) {
    if (!outcome.errors.length) outcome.errors.push("match not found");
    outcome.ok = false;
    await reportFailure(outcome);
    return outcome;
  }

  outcome.status = match.status || null;
  const teamIds = (match.teams || []).map(idOf).filter(Boolean);
  outcome.teams = teamIds;
  outcome.tournament = match.tournament ? idOf(match.tournament) : null;

  // 1. Team rankings. Each team is rebuilt from its completed matches; the
  //    rank numbers are then re-derived for the whole board (a match changes
  //    other teams' positions too). Rankings are a write-only step, so a dry
  //    run only lists the teams it would rebuild.
  if (apply) {
    for (const teamId of teamIds) {
      try {
        await computeTeamRanking(teamId);
      } catch (error) {
        outcome.errors.push(`ranking ${teamId}: ${describeError(error)}`);
      }
    }
    if (refreshRanks) {
      try {
        await refreshRankingPositions();
      } catch (error) {
        outcome.errors.push(`ranking positions: ${describeError(error)}`);
      }
    }
  }

  // 2. Player career figures, rebuilt from the completed match documents.
  const playerIds = matchPlayerIds(match);
  if (playerIds.length) {
    try {
      const [matches, currentPlayers] = await Promise.all([
        loadMatchDocsForPlayers(playerIds),
        Player.find({ _id: { $in: playerIds } }).select("name stats").lean(),
      ]);
      const currentById = new Map(
        currentPlayers.map((player) => [String(player._id), player]),
      );

      const updates = [];
      for (const playerId of playerIds) {
        const current = currentById.get(playerId);
        // A stale id on an innings row (deleted player) has nothing to write.
        if (!current) continue;
        try {
          const career = buildPlayerCareerStats(matches, playerId);
          const next = statsDocument(career);
          const changed = changedStatFields(current.stats, next);
          outcome.players.push({ playerId, name: current.name || "", changed });
          if (apply) updates.push({ playerId, next });
        } catch (error) {
          outcome.errors.push(`player stats ${playerId}: ${describeError(error)}`);
        }
      }

      if (apply && updates.length) {
        await Player.bulkWrite(
          updates.map(({ playerId, next }) => ({
            updateOne: {
              filter: { _id: playerId },
              // Replace the whole subdocument: a shorter career must not leave
              // the previous value behind on any field.
              update: { $set: { stats: next } },
            },
          })),
          { ordered: false },
        );
      }
    } catch (error) {
      outcome.errors.push(`player stats: ${describeError(error)}`);
    }
  }

  // 3. Tournament points table. recomputeTournamentPoints already drops the
  //    public stats cache before and after; the extra invalidation keeps the
  //    read-after-completion path safe when the recompute itself failed.
  if (outcome.tournament) {
    if (apply) {
      try {
        await recomputeTournamentPoints(outcome.tournament);
      } catch (error) {
        outcome.errors.push(`tournament points: ${describeError(error)}`);
      }
      try {
        invalidateTournamentStatsCache(outcome.tournament);
      } catch (error) {
        outcome.errors.push(`tournament cache: ${describeError(error)}`);
      }
    }
  }

  if (outcome.errors.length) {
    outcome.ok = false;
    await reportFailure(outcome);
  }
  return outcome;
}

/** Log and audit a failed pipeline so the completion is still visible to Admin. */
async function reportFailure(outcome) {
  console.error(
    `[post-match] ${outcome.reason} recompute failed for match ${outcome.matchId}: ${outcome.errors.join("; ")}`,
  );
  await recordAudit({
    action: "match.post_match_failed",
    targetType: "match",
    targetId: outcome.matchId,
    targetLabel: outcome.matchId,
    metadata: {
      reason: outcome.reason,
      status: outcome.status,
      errors: outcome.errors.slice(0, 20),
    },
  });
}

export default { runPostMatchPipeline, matchPlayerIds };
