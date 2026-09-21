import express from "express";
import { 
  registerUser, 
  loginUser, 
  logoutUser,
  forgotPassword,
  resetPassword,
  getProfile 
} from "../controllers/authController.js";
import { googleLogin, googleAdminLogin } from "../controllers/googleAuthController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/logout", logoutUser);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password/:token", resetPassword);

router.post("/google", googleLogin);
router.post("/google/admin", googleAdminLogin);

router.get("/profile", protect, getProfile);

export default router;