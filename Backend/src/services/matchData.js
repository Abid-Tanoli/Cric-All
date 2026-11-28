// Rows that exist only for one match. Deleting a match used to leave them
// behind (B16): balls, deliveries and commentary of a match nobody can open.

import mongoose from "mongoose";
import Ball from "../models/Ball.js";
import Commentary from "../models/Commentary.js";
import Delivery from "../models/Delivery.js";
import Event from "../models/Event.js";
import MatchAnalytics from "../models/MatchAnalytics.js";
import MatchOfficial from "../models/MatchOfficial.js";
import Partnership from "../models/Partnership.js";
import Review from "../models/Review.js";

export const MATCH_DATA = [
  { model: Ball, field: "matchId" },
  { model: Delivery, field: "matchId" },
  { model: Commentary, field: "match" },
  { model: Partnership, field: "matchId" },
  { model: Review, field: "matchId" },
  { model: MatchAnalytics, field: "matchId" },
  { model: MatchOfficial, field: "matchId" },
];

/**
 * Deletes the per-match rows of the given matches and drops them from any
 * Event.matches list. Call it next to the Match delete. Returns the counts
 * removed, by collection.
 */
export async function deleteMatchData(matchIds) {
  const ids = (Array.isArray(matchIds) ? matchIds : [matchIds])
    .filter(Boolean)
    .map((id) => new mongoose.Types.ObjectId(String(id?._id || id)));
  if (!ids.length) return {};

  const removed = {};
  for (const { model, field } of MATCH_DATA) {
    const { deletedCount } = await model.deleteMany({ [field]: { $in: ids } });
    if (deletedCount) removed[model.collection.collectionName] = deletedCount;
  }
  await Event.updateMany({ matches: { $in: ids } }, { $pull: { matches: { $in: ids } } });
  return removed;
}
