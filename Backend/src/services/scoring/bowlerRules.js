import { FORMATS } from './ScoringEngine.js';

const sameId = (a, b) => {
  const left = a?._id || a;
  const right = b?._id || b;
  return left != null && right != null && String(left) === String(right);
};

export function matchOvers(match) {
  const overs = Number(match?.totalOvers);
  if (Number.isFinite(overs) && overs > 0) return overs;
  const formatOvers = FORMATS[match?.matchType]?.maxOvers;
  return Number.isFinite(formatOvers) && formatOvers > 0 ? formatOvers : 20;
}

// The match's configured per-bowler maximum wins, then the format default,
// then a conservative ceil(overs / 5) (20 overs -> 4).
export function getBowlerQuota(match) {
  const configured = Number(match?.maxBowlerOvers);
  if (Number.isFinite(configured) && configured > 0) return configured;

  const formatQuota = FORMATS[match?.matchType]?.maxBowlerOvers;
  if (Number.isFinite(formatQuota) && formatQuota > 0) return formatQuota;

  return Math.ceil(matchOvers(match) / 5);
}

export function getBowlerBalls(innings, bowlerId) {
  const stats = (innings?.bowling || []).find((entry) => sameId(entry.player, bowlerId));
  if (!stats) return 0;
  const balls = Number(stats.balls);
  if (Number.isFinite(balls) && balls > 0) return balls;
  return Math.max(0, Math.round(Number(stats.overs || 0) * 6));
}

export function isOverInProgress(innings) {
  const overs = innings?.oversHistory || [];
  const lastOver = overs[overs.length - 1];
  if (!lastOver || !Array.isArray(lastOver.balls) || lastOver.balls.length === 0) return false;
  const legalBalls = lastOver.balls.filter((ball) => !ball.isWide && !ball.isNoBall).length;
  return legalBalls < 6;
}

export function currentOverNumber(innings) {
  const overs = innings?.oversHistory || [];
  const lastOver = overs[overs.length - 1];
  if (isOverInProgress(innings) && lastOver?.overNumber != null) return lastOver.overNumber;
  return Math.floor(Number(innings?.balls || 0) / 6);
}

export function previousCompletedOver(innings) {
  const overs = innings?.oversHistory || [];
  if (isOverInProgress(innings)) {
    return overs.length >= 2 ? overs[overs.length - 2] : null;
  }
  return overs[overs.length - 1] || null;
}

export function overBowlerMatches(over, bowlerId) {
  return !!over?.bowler && sameId(over.bowler, bowlerId);
}
