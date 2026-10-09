import * as rankingService from "../services/rankingService.js";
import { resolveViewerContext } from "../utils/publicProjection.js";

const isTransientDbError = (error) => (
  error?.name === "MongooseError" ||
  error?.name === "MongoServerSelectionError" ||
  error?.name === "MongoNetworkTimeoutError" ||
  /timed out|buffering|not connected/i.test(error?.message || "")
);

export const getOverallRankings = async (req, res) => {
  try {
    const rankings = await rankingService.getOverallRankings(req.query);
    res.status(200).json(rankings);
  } catch (error) {
    if (isTransientDbError(error)) return res.status(200).json([]);
    res.status(500).json({ message: "Failed to fetch rankings", error: error.message });
  }
};

export const getCategoryRankings = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const rankings = await rankingService.getCategoryRankings(categoryId);
    res.status(200).json(rankings);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch category rankings", error: error.message });
  }
};

export const getCrossCategoryRankings = async (req, res) => {
  try {
    const result = await rankingService.getCrossCategoryRankings();
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch cross-category rankings", error: error.message });
  }
};

export const getTeamPlayerRankings = async (req, res) => {
  try {
    const { teamId } = req.params;
    // Round 5: the route now identifies the caller when it can, so a manager of
    // the owning organization (or a platform admin) sees their own squad's full
    // player documents embedded in the ranking; everyone else gets the public
    // projection. The ranking arithmetic reads `stats` either way.
    const viewer = await resolveViewerContext(req);
    const rankings = await rankingService.getTeamPlayerRankings(teamId, viewer);
    if (rankings === null) {
      return res.status(404).json({ message: "Team not found" });
    }
    res.status(200).json(rankings);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch player rankings", error: error.message });
  }
};

export const getPlayerRankings = async (req, res) => {
  try {
    const result = await rankingService.computePlayerRankings();
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ message: "Failed to compute player rankings", error: error.message });
  }
};

export const recomputeRankings = async (req, res) => {
  try {
    await rankingService.computeAllRankings();
    res.status(200).json({ message: "Rankings recomputed successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to recompute rankings", error: error.message });
  }
};

export const recomputeTeamRanking = async (req, res) => {
  try {
    const ranking = await rankingService.computeTeamRanking(req.params.teamId);
    res.status(200).json({ ranking, message: "Team ranking recomputed" });
  } catch (error) {
    res.status(500).json({ message: "Failed to recompute team ranking", error: error.message });
  }
};
