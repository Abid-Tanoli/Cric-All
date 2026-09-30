import express from 'express';
import {
  getExternalApiSettingsHandler,
  getPlatformSettingsHandler,
  updateExternalApiSettingsHandler,
  updatePlatformSettingsHandler,
} from "../controllers/settingsController.js";
import auth from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/external-api", auth.protect, auth.requireAdmin, getExternalApiSettingsHandler);
router.put("/external-api", auth.protect, auth.requireSuperAdmin, updateExternalApiSettingsHandler);

router.get("/platform", auth.protect, auth.requireAdmin, getPlatformSettingsHandler);
router.put("/platform", auth.protect, auth.requireSuperAdmin, updatePlatformSettingsHandler);

export default router;
