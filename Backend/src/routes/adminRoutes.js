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
import CricketShot from "../models/CricketShot.js";
import FieldingPosition from "../models/FieldingPosition.js";
import {
  listHandlerRequests,
  approveHandlerRequest,
  rejectHandlerRequest
} from "../controllers/handlerController.js";

const router = express.Router();

router.post("/register", registerAdmin);
router.post("/login", loginAdmin);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password/:token", resetPassword);
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

// Admin: review handler/org-admin creation requests
router.get("/handler-requests", auth.protect, auth.requireAdmin, listHandlerRequests);
router.post("/handler-requests/:id/approve", auth.protect, auth.requireAdmin, approveHandlerRequest);
router.post("/handler-requests/:id/reject", auth.protect, auth.requireAdmin, rejectHandlerRequest);

export default router;
