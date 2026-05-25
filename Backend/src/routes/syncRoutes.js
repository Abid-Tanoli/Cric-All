import { Router } from "express";
import {
  getAvailableSeries,
  syncSeries,
  syncMatch,
  syncLiveScores,
  syncAll,
  getSyncLog,
} from "../controllers/syncController.js";

const router = Router();

router.get("/series", getAvailableSeries);
router.get("/log", getSyncLog);
router.post("/series/:slug/:seriesId", syncSeries);
router.post("/match/:seriesSlug/:seriesId/:slug/:matchId", syncMatch);
router.post("/live", syncLiveScores);
router.post("/all", syncAll);

export default router;
