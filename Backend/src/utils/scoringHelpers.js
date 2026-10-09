import { getBallRunText } from "./cricketHelpers.js";

export const WICKET_TYPE_ALIASES = {
  "run out": "runOut",
  run_out: "runOut",
  "hit wicket": "hitWicket",
  hit_wicket: "hitWicket",
  "retired out": "retiredOut",
  retired_out: "retiredOut",
  "obstructing the field": "obstructingField",
  obstructing_the_field: "obstructingField",
  "hit the ball twice": "hitTwice",
  hit_twice: "hitTwice",
};

export const normalizeWicketType = (type = "") => {
  const value = String(type || "").trim();
  return WICKET_TYPE_ALIASES[value] || WICKET_TYPE_ALIASES[value.toLowerCase()] || value;
};

export const calculateWinProbability = (match) => {
  if (!match || !match.innings || match.innings.length === 0) return { team1: 50, team2: 50 };
  if (match.status === 'completed') {
    const winnerId = match.result?.winner?.toString();
    const team1Id = match.teams[0]?._id?.toString() || match.teams[0]?.toString();
    return winnerId === team1Id ? { team1: 100, team2: 0 } : { team1: 0, team2: 100 };
  }

  const currentInnIdx = match.currentInnings;
  const innings = match.innings[currentInnIdx];

  if (currentInnIdx === 0) {
    const crr = innings.runRate || 0;
    const projected = crr * match.totalOvers;
    const diff = projected - 180;
    const p1 = Math.max(10, Math.min(90, 50 + (diff / 2)));
    return { team1: p1, team2: 100 - p1 };
  }

  if (currentInnIdx === 1) {
    const target = innings.target || 0;
    if (target === 0) return { team1: 50, team2: 50 };

    const runsToGet = target - innings.runs;
    const totalBalls = match.totalOvers * 6;
    const ballsRemaining = totalBalls - innings.balls;

    if (runsToGet <= 0) return { team1: 0, team2: 100 };
    if (ballsRemaining <= 0) return { team1: 100, team2: 0 };

    const rrr = (runsToGet / ballsRemaining) * 6;
    const wicketsLeft = 10 - innings.wickets;

    let p2 = 50 + (6 - rrr) * 5 + (wicketsLeft - 5) * 5;
    p2 = Math.max(5, Math.min(95, p2));

    return { team1: 100 - p2, team2: p2 };
  }

  return { team1: 50, team2: 50 };
};

export const populateFullMatch = async (match) => {
  await match.populate([
    {
      path: "teams",
      select: "name shortName logo players",
      populate: { path: "players", select: "name playingRole role bowlingStyle" }
    },
    { path: "innings.team", select: "name shortName" },
    { path: "innings.batting.player", select: "name role playingRole bowlingStyle" },
    { path: "innings.bowling.player", select: "name role playingRole bowlingStyle" },
    { path: "innings.currentBatsman1", select: "name role playingRole bowlingStyle" },
    { path: "innings.currentBatsman2", select: "name role playingRole bowlingStyle" },
    { path: "innings.onStrikeBatsman", select: "name role playingRole bowlingStyle" },
    { path: "innings.currentBowler", select: "name role playingRole bowlingStyle" },
    { path: "innings.fallOfWickets.player", select: "name role playingRole bowlingStyle" },
    { path: "innings.partnerships.batsman1", select: "name role playingRole bowlingStyle" },
    { path: "innings.partnerships.batsman2", select: "name role playingRole bowlingStyle" },
    { path: "innings.oversHistory.balls.batsmanOnStrike", select: "name" },
    { path: "innings.oversHistory.balls.batsmanNonStrike", select: "name" },
    { path: "innings.oversHistory.balls.bowler", select: "name" },
    { path: "innings.oversHistory.bowler", select: "name" },
    { path: "playingXI.players", select: "name role playingRole bowlingStyle" },
    { path: "playingXI.team", select: "name shortName logo" },
    { path: "squad15.players", select: "name role playingRole bowlingStyle" },
    { path: "squad15.team", select: "name shortName logo" },
    { path: "twelfthMan.team", select: "name shortName logo" },
    { path: "twelfthMan.player", select: "name role playingRole bowlingStyle" },
    { path: "impactPlayers.team", select: "name shortName logo" },
    { path: "impactPlayers.player", select: "name role playingRole bowlingStyle" },
    { path: "impactPlayers.replaces", select: "name role playingRole bowlingStyle" },
    { path: "result.winner", select: "name shortName logo" },
    { path: "tossWinner", select: "name shortName" }
  ]);

  match.innings.forEach(inn => {
    inn.oversHistory.forEach(over => {
      over.balls.forEach(ball => {
        if (!ball.batsmanName && ball.batsmanOnStrike) {
          ball.batsmanName = ball.batsmanOnStrike.name || "Batsman";
        }
        if (!ball.bowlerName && ball.bowler) {
          ball.bowlerName = ball.bowler.name || "Bowler";
        }
        ball.runs = Number(ball.runs || 0);
        ball.runText = getBallRunText(ball);
      });
    });
  });

  return match;
};
