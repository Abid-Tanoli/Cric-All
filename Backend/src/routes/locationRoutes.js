import express from "express";
import { protect, requireAdmin, requireVerifiedEmail } from "../middleware/authMiddleware.js";
import validateObjectId from "../middleware/validateObjectId.js";
import rateLimiter from "../middleware/rateLimiter.js";
import {
  getLocations,
  getLocationPathById,
  postLocationSuggestion,
  adminListLocations,
  adminListSuggestions,
  adminCreateLocation,
  adminUpdateLocation,
  adminApproveLocation,
  adminRejectLocation,
  adminMergeLocation,
} from "../controllers/locationController.js";

const router = express.Router();
const admin = [protect, requireAdmin, requireVerifiedEmail];

// Public reads. They are cached in-process and by the browser/CDN for a minute,
// so a cascading dropdown costs one request per level per minute.
router.get("/", rateLimiter({ windowMs: 60_000, max: 180 }), getLocations);
router.get("/:id/path", validateObjectId("id"), getLocationPathById);

// "Other (add new)": authenticated users only, deduped, unapproved until an
// admin acts on it. Ten suggestions per hour is enough for a real form.
router.post(
  "/suggest",
  protect,
  requireVerifiedEmail,
  rateLimiter({ windowMs: 60 * 60_000, max: 10 }),
  postLocationSuggestion
);

// Admin tree management. Registered before any /:id route.
router.get("/admin", ...admin, adminListLocations);
router.get("/admin/suggestions", ...admin, adminListSuggestions);
router.post("/admin", ...admin, adminCreateLocation);
router.patch("/admin/:id", ...admin, validateObjectId("id"), adminUpdateLocation);
router.post("/admin/:id/approve", ...admin, validateObjectId("id"), adminApproveLocation);
router.post("/admin/:id/reject", ...admin, validateObjectId("id"), adminRejectLocation);
router.post("/admin/:id/merge", ...admin, validateObjectId("id"), adminMergeLocation);

export default router;
