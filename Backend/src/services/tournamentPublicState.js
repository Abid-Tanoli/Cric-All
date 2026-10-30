import { normalizeBracketStage } from "./tournamentBracket.js";

// ---------------------------------------------------------------------------
// Public tournament state (header status + end date)
// ---------------------------------------------------------------------------
//
// `Tournament.status` and `Tournament.endDate` are stored fields, but the owner
// changes fixtures without editing the tournament row. That left the public
// header saying "upcoming" and showing the original one-day range after the
// quarter-finals and semi-finals had already been played.
//
// The public content endpoint therefore derives the two presentation values
// from the tournament's non-draft matches:
//   * status is "live" while a match is in progress, "ongoing" while a knockout
//     still has a final to play or once any match has been completed;
//   * status is "completed" only when the final is completed (knockout/mixed)
//     or every match is completed (league);
//   * the displayed end date is the later of the stored end date and the last
//     scheduled fixture, so a final on 1 November can extend an October range.
//
// Nothing here writes to the database. The stored fields remain the owner's
// record and can still be edited in Admin.

const LIVE_MATCH_STATUSES = new Set([
  "live",
  "toss_done",
  "innings_break",
  "innings-break",
  "super_over",
  "pending_tie_resolution",
]);

const FINISHED_MATCH_STATUSES = new Set(["completed", "abandoned"]);

const statusOf = (match) => String(match?.status || "").toLowerCase();

const validDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const latestMatchDate = (matches) =>
  matches.reduce((latest, match) => {
    const date = validDate(match?.startAt);
    if (!date) return latest;
    return !latest || date.getTime() > latest.getTime() ? date : latest;
  }, null);

/**
 * Pure: derive the status and end date the public header should show.
 *
 * @param {object} tournament  Tournament-like document (type/status/endDate).
 * @param {Array}  matches     Match-like documents (stage/stageLabel/status/startAt).
 * @returns {{ status: string, endDate: Date|null }}
 */
export function deriveTournamentPublicState(tournament = {}, matches = []) {
  const storedStatus = String(tournament?.status || "upcoming").toLowerCase();
  const storedEnd = validDate(tournament?.endDate);

  const visible = (matches || []).filter(
    (match) => match && match.manualDraft !== true && match.isDraft !== true,
  );
  if (!visible.length) return { status: storedStatus, endDate: storedEnd };

  const latest = latestMatchDate(visible);
  const endDate = latest && (!storedEnd || latest.getTime() > storedEnd.getTime())
    ? latest
    : storedEnd;

  const anyLive = visible.some((match) => LIVE_MATCH_STATUSES.has(statusOf(match)));
  if (anyLive) return { status: "live", endDate };

  const anyCompleted = visible.some((match) => statusOf(match) === "completed");
  const allFinished = visible.every((match) => FINISHED_MATCH_STATUSES.has(statusOf(match)));
  const stages = visible.map((match) => normalizeBracketStage(match));
  const isKnockout =
    String(tournament?.type || "").toLowerCase() === "knockout" ||
    stages.some((stage) => ["quarter_final", "semi_final", "final"].includes(stage));

  if (isKnockout) {
    // A knockout is only over when its final is over. With no final yet the
    // tournament is still in progress as soon as any earlier round is complete.
    const final = visible.find((match) => normalizeBracketStage(match) === "final");
    if (final) {
      return {
        status: statusOf(final) === "completed" ? "completed" : "ongoing",
        endDate,
      };
    }
    return { status: anyCompleted ? "ongoing" : "upcoming", endDate };
  }

  if (allFinished) return { status: "completed", endDate };
  if (anyCompleted) return { status: "ongoing", endDate };
  return { status: "upcoming", endDate };
}

export default { deriveTournamentPublicState };
