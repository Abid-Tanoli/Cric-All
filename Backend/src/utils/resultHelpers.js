// Shared result/chase formatting. `innings.balls` is the legal-ball count and
// `innings.overs` is already floor(balls / 6), so the two must never be added
// together. Everything that needs "balls remaining" goes through here.

export function totalMatchBalls(match) {
  return Math.max(0, Math.round(Number(match?.totalOvers || 0) * 6));
}

export function ballsRemaining(match, innings) {
  return Math.max(0, totalMatchBalls(match) - Number(innings?.balls || 0));
}

export function computeChaseState(match, innings) {
  const runsNeeded = Math.max(0, Number(innings?.target || 0) - Number(innings?.runs || 0));
  const left = ballsRemaining(match, innings);
  const requiredRunRate = left > 0
    ? Number(((runsNeeded / left) * 6).toFixed(2))
    : 0;
  return { runsNeeded, ballsRemaining: left, requiredRunRate };
}

const teamName = (innings, fallback) =>
  innings?.team?.name || innings?.team?.shortName || fallback;

export function buildMatchResult({ innings1, innings2, match, maxWickets = 10, superOverAvailable = false }) {
  if (!innings1 || !innings2) return null;

  const first = innings1;
  const second = innings2;
  const firstName = teamName(first, "Team 1");
  const secondName = teamName(second, "Team 2");

  if (Number(second.runs || 0) > Number(first.runs || 0)) {
    const wicketsLeft = Math.max(0, Number(maxWickets || 10) - Number(second.wickets || 0));
    const wicketsWord = wicketsLeft === 1 ? "wicket" : "wickets";
    const left = ballsRemaining(match, second);
    return {
      winner: second.team,
      margin: `${wicketsLeft} ${wicketsWord}`,
      description: `${secondName} won by ${wicketsLeft} ${wicketsWord} (${left} balls remaining)`,
      resultType: "normal",
    };
  }

  if (Number(first.runs || 0) > Number(second.runs || 0)) {
    const runMargin = Number(first.runs || 0) - Number(second.runs || 0);
    return {
      winner: first.team,
      margin: `${runMargin} runs`,
      description: `${firstName} won by ${runMargin} runs`,
      resultType: "normal",
    };
  }

  return {
    winner: null,
    margin: "tie",
    description: "Match tied",
    resultType: "tie",
    isTie: true,
    superOverAvailable,
  };
}

export function buildNoResultResult(description = "Match abandoned - no result") {
  return {
    winner: null,
    margin: "no result",
    description,
    resultType: "no result",
  };
}
