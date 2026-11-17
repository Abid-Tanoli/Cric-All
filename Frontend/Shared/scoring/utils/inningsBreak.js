import { getBowlerBalls } from './bowlerQuota';
import { formatOversFromBalls, normalizeOversText } from './overs';

const idOf = (value) => String(value?._id || value || '');

const normalizeStatus = (status) => (status === 'innings-break' ? 'innings_break' : status);

const playerName = (player, fallback = 'Player') => {
    if (!player) return fallback;
    if (typeof player === 'object' && player.name) return player.name;
    return fallback;
};

export function hasOpeners(innings) {
    return Boolean(
        innings &&
        innings.onStrikeBatsman &&
        innings.currentBatsman1 &&
        innings.currentBatsman2
    );
}

// The break screen is only for "first innings complete, chase not started".
// Once the second innings has openers (or is live), the normal scoring UI and
// the existing setup wizard take over again.
export function getInningsBreakContext(match) {
    if (!match) return null;
    if (normalizeStatus(match.status) !== 'innings_break') return null;

    const currentIndex = Number(match.currentInnings);
    if (!Number.isInteger(currentIndex) || currentIndex < 1) return null;

    const current = match.innings?.[currentIndex];
    const finished = match.innings?.[currentIndex - 1];
    if (!current || !finished) return null;
    if (finished.status !== 'completed') return null;
    if (current.status === 'completed' || current.status === 'live') return null;
    if (hasOpeners(current)) return null;

    return { currentIndex, current, finished };
}

export function shouldShowInningsBreak(match) {
    return Boolean(getInningsBreakContext(match));
}

export function getChaseSummary({ finishedInnings, currentInnings, totalOvers }) {
    const target = Number(currentInnings?.target) || (Number(finishedInnings?.runs) || 0) + 1;
    const runs = Number(currentInnings?.runs) || 0;
    const balls = Number(currentInnings?.balls) || 0;
    const totalBalls = Math.max(0, Math.round((Number(totalOvers) || 0) * 6));
    const ballsRemaining = Math.max(0, totalBalls - balls);
    const runsNeeded = Math.max(0, target - runs);
    const requiredRunRate = ballsRemaining > 0
        ? Math.round((runsNeeded / (ballsRemaining / 6)) * 100) / 100
        : 0;

    return { target, runs, balls, runsNeeded, ballsRemaining, requiredRunRate };
}

export function getExtrasBreakdown(innings) {
    const extras = innings?.extras || {};
    const parts = {
        wides: Number(extras.wides) || 0,
        noBalls: Number(extras.noBalls) || 0,
        byes: Number(extras.byes) || 0,
        legByes: Number(extras.legByes) || 0,
        penalties: Number(extras.penalties) || 0,
    };
    const fallback = parts.wides + parts.noBalls + parts.byes + parts.legByes + parts.penalties;
    return { ...parts, total: Number(extras.total ?? fallback) || 0 };
}

export function getTopBatters(innings, limit = 3) {
    return (innings?.batting || [])
        .filter((row) => row && ((Number(row.balls) || 0) > 0 || (Number(row.runs) || 0) > 0 || row.isOut))
        .slice()
        .sort((a, b) => (Number(b.runs) || 0) - (Number(a.runs) || 0) || (Number(b.balls) || 0) - (Number(a.balls) || 0))
        .slice(0, limit)
        .map((row) => {
            const balls = Number(row.balls) || 0;
            const runs = Number(row.runs) || 0;
            return {
                id: idOf(row.player),
                name: playerName(row.player, 'Batter'),
                runs,
                balls,
                fours: Number(row.fours) || 0,
                sixes: Number(row.sixes) || 0,
                isOut: Boolean(row.isOut),
                strikeRate: balls > 0 ? Math.round((runs / balls) * 10000) / 100 : 0,
            };
        });
}

export function getTopBowlers(innings, limit = 3) {
    return (innings?.bowling || [])
        .filter((row) => getBowlerBalls(row) > 0)
        .slice()
        .sort((a, b) => (Number(b.wickets) || 0) - (Number(a.wickets) || 0) || (Number(a.runs) || 0) - (Number(b.runs) || 0))
        .slice(0, limit)
        .map((row) => {
            const balls = getBowlerBalls(row);
            const runs = Number(row.runs) || 0;
            return {
                id: idOf(row.player),
                name: playerName(row.player, 'Bowler'),
                balls,
                overs: formatOversFromBalls(balls),
                maidens: Number(row.maidens) || 0,
                runs,
                wickets: Number(row.wickets) || 0,
                economy: balls > 0 ? Math.round((runs / (balls / 6)) * 100) / 100 : 0,
            };
        });
}

export function getFallOfWickets(innings) {
    return (innings?.fallOfWickets || []).map((wicket, index) => ({
        key: wicket?._id || index,
        wickets: Number(wicket?.wicket ?? wicket?.wickets ?? index + 1) || 0,
        runs: Number(wicket?.runs) || 0,
        overs: normalizeOversText(wicket?.overs),
        name: playerName(wicket?.player, 'Batter'),
    }));
}

export function getOversSummaryRows(innings) {
    return (innings?.bowling || [])
        .filter((row) => getBowlerBalls(row) > 0)
        .map((row) => {
            const balls = getBowlerBalls(row);
            return {
                id: idOf(row.player),
                name: playerName(row.player, 'Bowler'),
                balls,
                overs: formatOversFromBalls(balls),
                maidens: Number(row.maidens) || 0,
                runs: Number(row.runs) || 0,
                wickets: Number(row.wickets) || 0,
            };
        });
}

export function getInningsBreakData(match) {
    const context = getInningsBreakContext(match);
    if (!context) return null;

    const { finished, current } = context;
    const finishedTeam = (match.teams || []).find((team) => idOf(team) === idOf(finished.team)) || null;
    const chasingTeam = (match.teams || []).find((team) => idOf(team) === idOf(current.team)) || null;
    const balls = Number(finished.balls) || 0;

    return {
        ...context,
        match,
        finishedTeam,
        chasingTeam,
        score: {
            runs: Number(finished.runs) || 0,
            wickets: Number(finished.wickets) || 0,
            overs: formatOversFromBalls(balls),
            balls,
        },
        extras: getExtrasBreakdown(finished),
        chase: getChaseSummary({
            finishedInnings: finished,
            currentInnings: current,
            totalOvers: match.totalOvers,
        }),
        topBatters: getTopBatters(finished),
        topBowlers: getTopBowlers(finished),
        fallOfWickets: getFallOfWickets(finished),
        oversSummary: getOversSummaryRows(finished),
    };
}
