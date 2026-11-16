// AI commentary is opt-in. When it is off the scoring screen falls back to
// plain result commentary and hides the analysis-only capture controls.
export function getScoringVisibility(useAICommentary = false) {
  const aiEnabled = Boolean(useAICommentary);
  return {
    aiEnabled,
    showPitchMap: aiEnabled,
    showGround: aiEnabled,
    showShotTypePicker: aiEnabled,
    showBallMovement: aiEnabled,
    showNormalBallFielder: aiEnabled,
    showAdvancedAnalysis: aiEnabled,
    showBasicCommentary: !aiEnabled,
  };
}

export function describeBall(ball = {}) {
  if (!ball) return '';
  if (ball.wicketCancelled) return 'No ball, wicket cancelled';
  if (ball.isWicket) {
    const type = ball.wicketType || 'wicket';
    return `OUT, ${type}`;
  }
  if (ball.isWide) return 'Wide';
  if (ball.isNoBall) {
    const runs = Number(ball.runs) || 0;
    return runs > 0 ? `No ball + ${runs}` : 'No ball';
  }
  if (ball.isBye) {
    const runs = Number(ball.runs) || 0;
    return `Bye, ${runs} run${runs === 1 ? '' : 's'}`;
  }
  if (ball.isLegBye) {
    const runs = Number(ball.runs) || 0;
    return `Leg bye, ${runs} run${runs === 1 ? '' : 's'}`;
  }

  const runs = Number(ball.runs) || 0;
  if (runs === 0) return 'Dot ball';
  if (runs === 4) return 'FOUR';
  if (runs === 6) return 'SIX';
  return `${runs} run${runs === 1 ? '' : 's'}`;
}
