import express from "express";
import mongoose from "mongoose";
import Match from "../models/Match.js";
import { generateCommentaryForBall } from "../services/commentaryService.js";
import { protect, requireAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/generate", protect, requireAdmin, async (req, res) => {
  try {
    // This admin on-demand path has no match in its URL. When the caller names a
    // match, respect that match's AI commentary flag and make no provider call.
    let skipAi = false;
    if (mongoose.Types.ObjectId.isValid(req.body?.matchId)) {
      const match = await Match.findById(req.body.matchId).select("useAiCommentary");
      skipAi = !match || match.useAiCommentary !== true;
    }
    const commentary = await generateCommentaryForBall(req.body, { skipAi });
    res.json({ commentary });
  } catch (error) {
    console.error("Commentary generation error:", error);
    res.json({ commentary: generateFallbackCommentary(req.body) });
  }
});

function generateFallbackCommentary(data) {
  const { bowlerName, batsmanName, runs, isWicket, pitchLength, pitchLine, shotType, groundZone, fieldedByName, fieldedByPosition } = data;
  let text = `${bowlerName} to ${batsmanName}.`;
  if (pitchLength && pitchLine) text += ` ${pitchLength} delivery ${pitchLine}.`;
  if (shotType) text += ` Plays the ${shotType}`;
  if (groundZone) text += ` towards ${groundZone.replace("-", " ")}`;
  if (fieldedByName) text += ` ${fieldedByName} at ${fieldedByPosition || "the fielding position"} gives chase.`;
  if (isWicket) text += ` AND IT'S A WICKET!`;
  else if (runs === 6) text += ` and it sails over the ropes for SIX!`;
  else if (runs === 4) text += ` and it races away to the boundary for FOUR!`;
  else if (runs === 0) text += ` no run, well bowled.`;
  return text;
}

export default router;
