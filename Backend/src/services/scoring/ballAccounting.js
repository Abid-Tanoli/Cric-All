// Single source of truth for what ONE delivery changes on an innings.
//
// Both the live apply path (ScoringEngine.processDelivery) and the undo path
// (scoreController.revertLastBall) read this, so the two can never disagree
// about extras, batter/bowler figures or dot balls. The engine writes the
// canonical fields onto the ball record (`batsmanRuns`, `extraRuns`,
// `penaltyRuns`, the wide/no-ball/bye/leg-bye flags, `isWicket`, `wicketType`);
// this helper interprets exactly those fields, so apply and revert share one
// definition of the delivery's impact.
//
// `ball` may be an engine ball record or a persisted Match.innings.oversHistory
// ball sub-document. The persisted schema stores the runs off the bat in `runs`
// (it has no `batsmanRuns` column, so that engine field is dropped on save), so
// fall back to `runs` when `batsmanRuns` is absent. For an engine record the two
// are always equal, which keeps apply and revert reading the same value.

// Dismissals that are never credited to the bowler: a run-out is completed by a
// fielder and the rest are umpire decisions. Shared with the engine so the apply
// path and the undo path agree on whether the bowler's wicket count moved.
export const NON_BOWLER_DISMISSALS = new Set([
  'runOut', 'retiredOut', 'obstructingField', 'hitTwice', 'handledBall', 'timedOut'
]);

export function computeBallAccounting(ball = {}) {
  const isWide = !!ball.isWide;
  const isNoBall = !!ball.isNoBall;
  const isBye = !!ball.isBye;
  const isLegBye = !!ball.isLegBye;
  // A "legal" delivery consumes one of the six balls in the over; byes and
  // leg-byes are legal too, wides and no-balls are not.
  const isLegal = !isWide && !isNoBall;
  // "Plain legal" = charged to the bowler as a normal ball (excludes byes and
  // leg-byes, which are legal but are not the bowler's ball in the figures the
  // engine keeps).
  const isPlainLegal = isLegal && !isBye && !isLegBye;

  const batsmanRuns = ball.batsmanRuns != null ? ball.batsmanRuns : (ball.runs || 0);
  const extraRuns = ball.extraRuns || 0;
  const penaltyRuns = ball.penaltyRuns || 0;
  const isWicket = !!ball.isWicket;

  const isFour = ball.isFour != null ? !!ball.isFour : batsmanRuns === 4;
  const isSix = ball.isSix != null ? !!ball.isSix : batsmanRuns === 6;

  // Penalty runs are awarded through their own path (no ball record), but the
  // persisted flag lets revert put them back if they ever do appear here.
  const isPenalty = penaltyRuns > 0 && isPlainLegal;

  return {
    isWide,
    isNoBall,
    isBye,
    isLegBye,
    isLegal,
    isPlainLegal,
    isWicket,
    batsmanRuns,
    extraRuns,
    penaltyRuns,
    totalRuns: batsmanRuns + extraRuns + penaltyRuns,
    extras: {
      wides: isWide ? extraRuns : 0,
      noBalls: isNoBall ? 1 : 0,
      byes: isBye ? extraRuns : 0,
      legByes: isLegBye ? extraRuns : 0,
      penalties: isPenalty ? penaltyRuns : 0,
    },
    batting: {
      runs: batsmanRuns,
      balls: isLegal ? 1 : 0,
      dotBalls: isLegal && batsmanRuns === 0 && !isWicket ? 1 : 0,
      fours: isFour ? 1 : 0,
      sixes: isSix ? 1 : 0,
    },
    bowling: {
      balls: isLegal ? 1 : 0,
      runs: isWide || isNoBall ? extraRuns + batsmanRuns : isPlainLegal ? batsmanRuns : 0,
      wides: isWide ? 1 : 0,
      noBalls: isNoBall ? 1 : 0,
      dotBalls: isPlainLegal && batsmanRuns === 0 ? 1 : 0,
      wickets: isWicket && !NON_BOWLER_DISMISSALS.has(ball.wicketType) ? 1 : 0,
    },
  };
}

export default computeBallAccounting;
