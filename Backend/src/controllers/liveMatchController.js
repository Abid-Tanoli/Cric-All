import Ball from "../models/Ball.js";
import Match from "../models/Match.js";

export const addBall = async (req, res) => {
  try {
    const { matchId } = req.params;
    const data = req.body;

    const ball = await Ball.create({ matchId, ...data });

    const match = await Match.findById(matchId);

    match.score.runs += data.runs;
    if (data.isWicket) match.score.wickets += 1;

    match.score.overs = data.over + data.ball / 6;
    await match.save({ validateModifiedOnly: true });

    req.io.to(`match-${matchId}`).emit("ball-update", {
      ball,
      score: match.score
    });

    res.status(201).json({ success: true, ball, score: match.score });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
