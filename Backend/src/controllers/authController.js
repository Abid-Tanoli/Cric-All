import User from "../models/User.js";
import Player from "../models/Player.js";
import { generateToken } from "../utils/jwt.js";
import { validatePasswordStrength } from "../utils/password.js";
import { sendMail } from "../utils/mailer.js";
import {
  generateResetToken,
  hashResetToken,
  getResetTokenExpiry,
  isResetTokenExpired,
} from "../utils/passwordReset.js";
import {
  hashVerificationToken,
  isVerificationExpired,
  issueVerificationEmail,
} from "../utils/emailVerification.js";
import logger from "../utils/logger.js";

const log = logger.child({ service: "auth" });

const userFrontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

// Everything the client is allowed to see about its own account.
function publicUser(user, extra = {}) {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    accountType: user.accountType,
    organizationCategory: user.organizationCategory,
    organizationName: user.organizationName,
    emailVerified: user.emailVerified === true,
    status: user.status || "active",
    ...extra,
  };
}

function isDuplicateKeyError(err) {
  return err?.code === 11000 || /E11000/i.test(err?.message || "");
}

export const registerUser = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      accountType = "viewer",
      organizationCategory = "",
      organizationName = "",
      phone = "",
      joinIntent = "",
      playerProfile
    } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Email setters (lowercase/trim) normalize both sides of this lookup.
    const userExists = await User.findOne({ email });
    if (userExists) {
      // Explicit, actionable message on the register form (requested UX).
      return res.status(409).json({
        message: "An account with this email already exists. Please sign in instead.",
        code: "EMAIL_TAKEN",
      });
    }

    const requestedType = ["player", "handler", "organization_admin", "viewer"].includes(accountType)
      ? accountType
      : "viewer";
    const role = requestedType === "handler" || requestedType === "organization_admin" ? "scorer" : "viewer";

    const newUser = await User.create({
      name,
      email,
      password,
      role,
      accountType: requestedType,
      organizationCategory,
      organizationName,
      phone,
      joinIntent,
      emailVerified: false,
      authProviders: [{ provider: "password" }],
    });

    if (requestedType === "player" && playerProfile) {
      await Player.create({
        name,
        playingRole: playerProfile.playingRole || "",
        battingStyle: playerProfile.battingStyle || "",
        bowlingStyle: playerProfile.bowlingStyle || "",
        category: playerProfile.category || "Other",
        subCategory: playerProfile.subCategory || "",
        ageGroup: playerProfile.ageGroup || "Open",
        organization: playerProfile.organizationName || "",
        address: {
          town: playerProfile.location?.town || "",
          district: playerProfile.location?.district || "",
          city: playerProfile.location?.city || "",
          province: playerProfile.location?.province || "",
          country: "Pakistan"
        },
      });
    }

    // Verification mail is best-effort: registration still succeeds if the
    // mail driver is not configured yet (the link is in the server log).
    const verification = await issueVerificationEmail(newUser, { frontendUrl: userFrontendUrl });

    const token = generateToken(newUser);

    res.status(201).json({
      token,
      user: publicUser(newUser),
      requiresEmailVerification: true,
      verificationSent: verification.sent,
      verificationReason: verification.reason,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(409).json({
        message: "An account with this email already exists. Please sign in instead.",
        code: "EMAIL_TAKEN",
      });
    }
    log.error({ event: "register.failed", err: err.message }, "registration failed");
    res.status(500).json({ message: "Registration failed" });
  }
};

export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const user = await User.findOne({ email }).select("+password");

    // Google-only accounts have no password: comparePassword would throw, so
    // short-circuit into the same generic failure as a wrong password.
    if (!user || !user.password) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    if (user.status === "suspended") {
      return res.status(403).json({
        message: "This account has been suspended.",
        code: "ACCOUNT_SUSPENDED",
      });
    }

    user.lastLoginAt = new Date();
    await user.save();

    const token = generateToken(user);

    res.json({
      token,
      user: publicUser(user),
    });
  } catch (err) {
    log.error({ event: "login.failed", err: err.message }, "login failed");
    res.status(500).json({ message: "Login failed" });
  }
};

export const logoutUser = async (req, res) => {
  res.json({ message: "Logged out successfully" });
};

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const user = await User.findOne({ email }).select("+resetPasswordToken");
    if (user) {
      const token = generateResetToken();
      user.resetPasswordToken = hashResetToken(token);
      user.resetPasswordExpires = getResetTokenExpiry();
      await user.save();

      await sendMail({
        to: user.email,
        subject: "Reset your CricAll password",
        text:
          `Hello ${user.name},\n\n` +
          `Reset your password using this link (valid for 30 minutes):\n\n` +
          `${userFrontendUrl}/reset-password/${token}\n\n` +
          `If you did not request this, you can ignore this message.\n`,
      });
    }

    // Always return the same generic success message so we don't leak
    // which email addresses are registered.
    res.status(200).json({ message: "If an account exists for this email, a reset link has been sent" });
  } catch (err) {
    log.error({ event: "forgot-password.failed", err: err.message }, "forgot password failed");
    res.status(500).json({ message: "Password reset request failed" });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ message: "Token and new password are required" });
    }

    const passwordError = validatePasswordStrength(password);
    if (passwordError) return res.status(400).json({ message: passwordError });

    const hashedToken = hashResetToken(token);
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
    }).select("+password +resetPasswordToken");

    if (!user || isResetTokenExpired(user.resetPasswordExpires)) {
      return res.status(400).json({ message: "Password reset token is invalid or has expired" });
    }

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    // Password changed → every previously issued token is now invalid.
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    res.status(200).json({ message: "Password reset successfully. You can now sign in." });
  } catch (err) {
    log.error({ event: "reset-password.failed", err: err.message }, "reset password failed");
    res.status(500).json({ message: "Password reset failed" });
  }
};

/**
 * POST /api/auth/verify-email { token }
 * Single-use: the stored hash is cleared as soon as it matches.
 */
export const verifyEmail = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: "Verification token is required" });

    const hashed = hashVerificationToken(token);
    const user = await User.findOne({ emailVerificationToken: hashed })
      .select("+emailVerificationToken");

    if (!user || isVerificationExpired(user.emailVerificationExpires)) {
      return res.status(400).json({
        message: "This verification link is invalid or has expired.",
        code: "VERIFY_TOKEN_INVALID",
      });
    }

    user.emailVerified = true;
    user.emailVerifiedAt = new Date();
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    res.status(200).json({
      message: "Email verified. You can now use all account features.",
      user: publicUser(user),
    });
  } catch (err) {
    log.error({ event: "verify-email.failed", err: err.message }, "email verification failed");
    res.status(500).json({ message: "Email verification failed" });
  }
};

/**
 * POST /api/auth/resend-verification { email }
 * Always generic (no account enumeration) and rate-limited at the route.
 * A per-account cool-down prevents mail bombing.
 */
export const resendVerification = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const user = await User.findOne({ email });

    const generic = {
      message: "If an account exists for that email and is unverified, a new link has been sent.",
    };

    if (!user || user.emailVerified === true) {
      return res.status(200).json(generic);
    }

    const result = await issueVerificationEmail(user, { frontendUrl: userFrontendUrl });

    if (result.reason === "cooldown") {
      return res.status(429).json({
        message: "A verification link was sent recently. Please wait a minute before requesting another.",
        code: "RESEND_COOLDOWN",
      });
    }

    res.status(200).json(generic);
  } catch (err) {
    log.error({ event: "resend-verification.failed", err: err.message }, "resend verification failed");
    res.status(500).json({ message: "Could not resend verification email" });
  }
};

export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(publicUser(user));
  } catch (err) {
    log.error({ event: "profile.failed", err: err.message }, "profile fetch failed");
    res.status(500).json({ message: "Profile fetch failed" });
  }
};
