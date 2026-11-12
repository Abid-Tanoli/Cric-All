// Keep the Admin picker in step with the backend quota rules:
// match override -> format default -> ceil(overs / 5).
export const FORMAT_BOWLER_LIMITS = {
  T20: 4,
  ODI: 10,
  T10: 2,
  '6 Overs': 2,
  '8 Overs': 2,
  'Super Over': 1,
  'Tape Ball': null,
  Test: null,
};

export function getBowlerQuota(match) {
  const configured = Number(match?.maxBowlerOvers);
  if (Number.isFinite(configured) && configured > 0) return configured;

  const formatLimit = FORMAT_BOWLER_LIMITS[match?.matchType];
  if (Number.isFinite(formatLimit) && formatLimit > 0) return formatLimit;

  const overs = Number(match?.totalOvers);
  return Math.ceil((Number.isFinite(overs) && overs > 0 ? overs : 20) / 5);
}

export function getBowlerBalls(stats) {
  if (!stats) return 0;
  const balls = Number(stats.balls);
  if (Number.isFinite(balls) && balls > 0) return balls;
  return Math.max(0, Math.round(Number(stats.overs || 0) * 6));
}

export function hasReachedBowlerQuota(stats, quota) {
  return getBowlerBalls(stats) >= Number(quota) * 6;
}
