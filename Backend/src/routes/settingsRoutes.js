import express from "express";
import {
  getExternalApiSettingsHandler,
  updateExternalApiSettingsHandler,
} from "../controllers/settingsController.js";
import auth from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/external-api", auth.protect, auth.requireAdmin, getExternalApiSettingsHandler);
router.put("/external-api", auth.protect, auth.requireSuperAdmin, updateExternalApiSettingsHandler);

export default router;