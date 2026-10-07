import express from "express";
import { 
  registerUser, 
  loginUser, 
  logoutUser,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
  verifyPhone,
  resendPhoneOtp,
  getProfile,
  deleteAccount
} from "../controllers/authController.js";
import { googleLogin, googleAdminLogin } from "../controllers/googleAuthController.js";
import { protect } from "../middleware/authMiddleware.js";
import validate from "../middleware/validate.js";
import rateLimiter from "../middleware/rateLimiter.js";
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  googleAuthSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  verifyPhoneSchema,
  resendPhoneOtpSchema,
} from "../validators/authValidators.js";

const router = express.Router();

// Brute-force / mail-bomb protection on every credential-adjacent endpoint.
// Limits are per IP (plus the route); see .env.example for nothing — they are
// intentionally fixed, generous enough for normal use and automated tests.
const registerLimit = rateLimiter({ windowMs: 10 * 60 * 1000, max: 30 });
const loginLimit = rateLimiter({ windowMs: 5 * 60 * 1000, max: 25 });
const forgotLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 5 });
const resetLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
const verifyLimit = rateLimiter({ windowMs: 10 * 60 * 1000, max: 30 });
const resendLimit = rateLimiter({ windowMs: 10 * 60 * 1000, max: 8 });
const googleLimit = rateLimiter({ windowMs: 5 * 60 * 1000, max: 25 });

router.post("/register", registerLimit, validate(registerSchema), registerUser);
router.post("/login", loginLimit, validate(loginSchema), loginUser);
router.post("/logout", logoutUser);
router.post("/forgot-password", forgotLimit, validate(forgotPasswordSchema), forgotPassword);
router.post("/reset-password/:token", resetLimit, validate(resetPasswordSchema), resetPassword);

router.post("/verify-email", verifyLimit, validate(verifyEmailSchema), verifyEmail);
router.post("/resend-verification", resendLimit, validate(resendVerificationSchema), resendVerification);

// Phone verification: same rate-limit + per-account cool-down design as the
// email endpoints; OTP guessing is additionally capped per account inside the
// controller (5 wrong attempts burns the code).
router.post("/verify-phone", verifyLimit, validate(verifyPhoneSchema), verifyPhone);
router.post("/resend-phone-otp", resendLimit, validate(resendPhoneOtpSchema), resendPhoneOtp);

router.post("/google", googleLimit, validate(googleAuthSchema), googleLogin);
router.post("/google/admin", googleLimit, validate(googleAuthSchema), googleAdminLogin);

router.get("/profile", protect, getProfile);

// Self-service account deletion. Deliberately `protect` only and not
// `requireVerifiedEmail`: an unverified account that cannot prove its mailbox
// is exactly the account that most needs a way to be removed, and requiring
// verification here would leave those people permanently stuck.
router.delete("/account", protect, deleteAccount);

export default router;
