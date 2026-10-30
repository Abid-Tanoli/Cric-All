import express from "express";
import {
  registerAdmin,
  loginAdmin,
  listAdmins,
  getAdminProfile,
  createAdmin,
  updateAdmin,
  deleteAdmin,
  forgotPassword,
  resetPassword,
} from "../controllers/adminController.js";
import auth from "../middleware/authMiddleware.js";
import rateLimiter from "../middleware/rateLimiter.js";
import validate from "../middleware/validate.js";
import validateObjectId from "../middleware/validateObjectId.js";
import CricketShot from "../models/CricketShot.js";
import FieldingPosition from "../models/FieldingPosition.js";
import {
  listHandlerRequests,
  approveHandlerRequest,
  rejectHandlerRequest
} from "../controllers/handlerController.js";
import { handoverOrganization } from "../controllers/orgHandoverController.js";
import { handoverOrganizationSchema } from "../validators/orgValidators.js";

const router = express.Router();

// Credential endpoints are brute-force and enumeration surfaces, so they are
// throttled on the same terms as the user auth routes (see authRoutes.js) and in
// some cases more tightly, because an admin token authorises the whole platform.
// The registration limit is deliberately tight: it is a one-shot bootstrap that
// should never be hit twice in a window, let alone by a script.
const registerLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
const loginLimit = rateLimiter({ windowMs: 5 * 60 * 1000, max: 20 });
const forgotLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 5 });
const resetLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
const handoverLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 30 });

// A handover response can contain a one-time temporary password. Never let a
// browser, proxy or shared cache store it.
const noStore = (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
};

router.post("/register", registerLimit, registerAdmin);
router.post("/login", loginLimit, loginAdmin);
router.post("/forgot-password", forgotLimit, forgotPassword);
router.post("/reset-password/:token", resetLimit, resetPassword);
router.get("/profile", auth.protect, getAdminProfile);

router.get("/", auth.protect, auth.requireAdmin, listAdmins);
router.post("/create", auth.protect, auth.requireSuperAdmin, createAdmin);
router.put("/:id", auth.protect, auth.requireSuperAdmin, updateAdmin);
router.delete("/:id", auth.protect, auth.requireSuperAdmin, deleteAdmin);

// Admin: Cricket Shots
router.post("/shots", auth.protect, auth.requireAdmin, async (req, res) => {
  try {
    const shot = await CricketShot.create(req.body);
    res.status(201).json(shot);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.put("/shots/:id", auth.protect, auth.requireAdmin, async (req, res) => {
  try {
    const shot = await CricketShot.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!shot) return res.status(404).json({ message: "Shot not found" });
    res.json(shot);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Admin: Fielding Positions
router.post("/fielding-positions", auth.protect, auth.requireAdmin, async (req, res) => {
  try {
    const pos = await FieldingPosition.create(req.body);
    res.status(201).json(pos);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.put("/fielding-positions/:id", auth.protect, auth.requireAdmin, async (req, res) => {
  try {
    const pos = await FieldingPosition.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!pos) return res.status(404).json({ message: "Position not found" });
    res.json(pos);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Admin: hand an organization over to its owner. This is deliberately an
// Admin-app endpoint: it can create a User account and issue a temporary
// password, so it must not be reachable from the self-service org routes.
router.post(
  "/organizations/:id/handover",
  handoverLimit,
  noStore,
  auth.protect,
  auth.requireAdmin,
  validateObjectId("id"),
  validate(handoverOrganizationSchema),
  handoverOrganization
);

// Admin: review handler/org-admin creation requests
router.get("/handler-requests", auth.protect, auth.requireAdmin, listHandlerRequests);
router.post("/handler-requests/:id/approve", auth.protect, auth.requireAdmin, approveHandlerRequest);
router.post("/handler-requests/:id/reject", auth.protect, auth.requireAdmin, rejectHandlerRequest);

export default router;
