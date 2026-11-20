import { getBowlerBalls, getBowlerQuota, hasReachedBowlerQuota } from './bowlerQuota';

const idOf = (value) => String(value?._id || value || '');

const legalBallCount = (over) =>
  Array.isArray(over?.balls)
    ? over.balls.filter((ball) => !ball.isWide && !ball.isNoBall).length
    : 0;

export function formatBowlerOvers(balls) {
  const total = Math.max(0, Number(balls) || 0);
  return `${Math.floor(total / 6)}.${total % 6}`;
}

export function getLastCompletedOver(innings) {
  const overs = innings?.oversHistory || [];
  for (let index = overs.length - 1; index >= 0; index -= 1) {
    if (legalBallCount(overs[index]) >= 6) return overs[index];
  }
  return null;
}

export function getLastOverBowlerId(innings) {
  const over = getLastCompletedOver(innings);
  return idOf(over?.bowler);
}

// A new bowler is required once an over has been completed and the scorer has
// not yet named someone other than the bowler who just finished that over.
export function isOverComplete(innings) {
  if (!innings) return false;
  const lastOver = getLastCompletedOver(innings);
  return Boolean(lastOver) && (Number(innings.balls) || 0) % 6 === 0;
}

export function isNextBowlerRequired(innings) {
  if (!innings || innings.status === 'completed') return false;
  if (!isOverComplete(innings)) return false;
  const lastBowlerId = getLastOverBowlerId(innings);
  const currentBowlerId = idOf(innings.currentBowler);
  return !currentBowlerId || currentBowlerId === lastBowlerId;
}

export function buildBowlerOptions({ bowlers = [], bowlingStats = [], lastOverBowlerId, quota }) {
  const eligible = [];
  const ineligible = [];
  const limit = Number(quota) || 0;

  bowlers.forEach((player) => {
    const playerId = idOf(player);
    if (!playerId) return;
    const stats = (bowlingStats || []).find(
      (row) => idOf(row.player) === playerId
    );
    const balls = getBowlerBalls(stats);
    const reasons = [];

    if (lastOverBowlerId && String(lastOverBowlerId) === playerId) {
      reasons.push('Bowled last over');
    }
    if (limit > 0 && hasReachedBowlerQuota(stats, limit)) {
      reasons.push(`Quota of ${limit} overs completed`);
    }

    const option = {
      _id: player._id || player,
      name: player.name || 'Player',
      playingRole: player.playingRole || '',
      bowlingStyle: player.bowlingStyle || '',
      balls,
      overs: formatBowlerOvers(balls),
      runs: Number(stats?.runs) || 0,
      wickets: Number(stats?.wickets) || 0,
      maidens: Number(stats?.maidens) || 0,
      oversRemaining: limit > 0
        ? Math.max(0, Math.round((limit - balls / 6) * 10) / 10)
        : null,
      reasons,
    };

    if (reasons.length > 0) ineligible.push(option);
    else eligible.push(option);
  });

  return { eligible, ineligible };
}

const overNumberOf = (over) => (Number(over?.overNumber) || 0) + 1;

// Player id -> the (1-based) over numbers that player bowled, in order.
export function getBowlerOverNumbers(innings) {
  const map = new Map();
  (innings?.oversHistory || []).forEach((over) => {
    const ballBowler = (over?.balls || []).find((ball) => ball?.bowler)?._id
      || (over?.balls || []).find((ball) => ball?.bowler)?.bowler;
    const bowlerId = idOf(over?.bowler) || idOf(ballBowler);
    if (!bowlerId) return;
    if (!map.has(bowlerId)) map.set(bowlerId, []);
    const list = map.get(bowlerId);
    const number = overNumberOf(over);
    if (!list.includes(number)) list.push(number);
  });
  return map;
}

// Splits the bowling side into "already bowled" (first over first, with the
// over numbers and the existing eligibility reasons attached) and "yet to
// bowl" (roster order, always selectable). Eligibility itself is decided by
// buildBowlerOptions, so the backend rules stay the only source of truth.
export function buildBowlerGroups({ bowlers = [], bowlingStats = [], lastOverBowlerId, quota, innings }) {
  const { eligible, ineligible } = buildBowlerOptions({
    bowlers,
    bowlingStats,
    lastOverBowlerId,
    quota,
  });
  const optionsById = new Map(
    [...eligible, ...ineligible].map((option) => [String(option._id), option])
  );
  const rosterOrder = new Map(bowlers.map((player, index) => [idOf(player), index]));
  const overNumbers = getBowlerOverNumbers(innings);

  const all = bowlers
    .map((player) => optionsById.get(idOf(player)))
    .filter(Boolean)
    .map((option) => ({
      ...option,
      overNumbers: overNumbers.get(String(option._id)) || [],
    }));

  const hasBowled = (option) => option.overNumbers.length > 0 || option.balls > 0;
  const orderOf = (option) => rosterOrder.get(String(option._id)) ?? 0;

  const bowled = all
    .filter(hasBowled)
    .sort(
      (a, b) =>
        (a.overNumbers[0] ?? Number.MAX_SAFE_INTEGER) -
          (b.overNumbers[0] ?? Number.MAX_SAFE_INTEGER) || orderOf(a) - orderOf(b)
    );
  const yetToBowl = all.filter((option) => !hasBowled(option)).sort(orderOf);

  return { bowled, yetToBowl };
}

export function getOversSummary({ totalOvers, quota, innings }) {
  const matchOvers = Number(totalOvers) || 0;
  return {
    totalOvers: matchOvers,
    quota: Number(quota) || 0,
    bowled: formatBowlerOvers(innings?.balls),
  };
}

export { getBowlerQuota };
