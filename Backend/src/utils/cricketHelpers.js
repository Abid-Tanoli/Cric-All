export const getBallRunText = (ball = {}) => {
  const runs = Number(ball.runs || 0);
  if (ball.isWicket) return "OUT!";
  if (ball.isWide) return "wide";
  if (ball.isNoBall) return "no ball";
  if (runs === 0) return "no run";
  if (runs === 1) return "1 run";
  if (runs === 4) return "FOUR";
  if (runs === 6) return "SIX";
  return `${runs} runs`;
};

export const normalizeBallRunText = (matchOrMatches) => {
  const matches = Array.isArray(matchOrMatches) ? matchOrMatches : [matchOrMatches];

  matches.forEach((match) => {
    match?.innings?.forEach((innings) => {
      innings?.oversHistory?.forEach((over) => {
        over?.balls?.forEach((ball) => {
          ball.runs = Number(ball.runs || 0);
          if (!ball.runText) {
            ball.runText = getBallRunText(ball);
          }
        });
      });
    });
  });

  return matchOrMatches;
};
