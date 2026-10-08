import User from "../models/User.js";
import Player from "../models/Player.js";
import TeamOrganization from "../models/TeamOrganization.js";
import TeamCategory from "../models/TeamCategory.js";
import { generateToken } from "../utils/jwt.js";
import { generateOrgSlug, upsertMembership } from "../services/membershipService.js";
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
import { normalizePhone } from "../utils/phone.js";
import {
  hashOtp,
  isOtpExpired,
  issuePhoneOtp,
  MAX_OTP_ATTEMPTS,
} from "../utils/phoneVerification.js";
import logger from "../utils/logger.js";
import { recordAudit } from "../utils/audit.js";
import { deleteUserAccount, AccountDeletionError } from "../services/accountDeletionService.js";

const log = logger.child({ service: "auth" });

const userFrontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

// Everything the client is allowed to see about its own account.
function publicUser(user, extra = {}) {
  return {
    _id: user._id,
    name: user.name,
    email: user.email || "",
    phone: user.phone || "",
    role: user.role,
    accountType: user.accountType,
    organizationCategory: user.organizationCategory,
    organizationName: user.organizationName,
    emailVerified: user.emailVerified === true,
    phoneVerified: user.phoneVerified === true,
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
      phone,
      joinIntent = "",
      playerProfile
    } = req.body;

    // Phone and email are alternative identifiers: signup needs a name, a
    // password, and at least one of email/phone (the register schema enforces
    // the same rule before this runs).
    const phoneInput = typeof phone === "string" ? phone.trim() : "";
    const normalizedPhone = phoneInput ? normalizePhone(phoneInput) : null;
    if (phoneInput && !normalizedPhone) {
      return res.status(400).json({ message: "Please provide a valid phone number" });
    }
    if (!name || !password || (!email && !normalizedPhone)) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Email setters (lowercase/trim) normalize both sides of this lookup, and
    // phone is stored pre-normalized, so both duplicate checks compare
    // canonical values.
    if (email) {
      const emailExists = await User.findOne({ email });
      if (emailExists) {
        // Explicit, actionable message on the register form (requested UX).
        return res.status(409).json({
          message: "An account with this email already exists. Please sign in instead.",
          code: "EMAIL_TAKEN",
        });
      }
    }
    if (normalizedPhone) {
      const phoneExists = await User.findOne({ phone: normalizedPhone });
      if (phoneExists) {
        return res.status(409).json({
          message: "An account with this phone number already exists. Please sign in instead.",
          code: "PHONE_TAKEN",
        });
      }
    }

    const requestedType = ["player", "handler", "organization_admin", "viewer"].includes(accountType)
      ? accountType
      : "viewer";
    const role = requestedType === "handler" || requestedType === "organization_admin" ? "scorer" : "viewer";

    const newUser = await User.create({
      name,
      ...(email ? { email } : {}),
      ...(normalizedPhone ? { phone: normalizedPhone } : {}),
      password,
      role,
      accountType: requestedType,
      organizationCategory,
      organizationName,
      joinIntent,
      emailVerified: false,
      phoneVerified: false,
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

    // Organization admins get their organization at signup — the historical
    // dead end was registering with an org name and getting nothing back.
    // Best-effort: registration still succeeds if this lookup/create fails.
    let organization = null;
    if (requestedType === "organization_admin" && organizationName?.trim()) {
      try {
        let category = null;
        if (organizationCategory) {
          category = await TeamCategory.findOne({
            name: { $regex: `^${organizationCategory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
          }).catch(() => null);
        }
        organization = await TeamOrganization.create({
          name: organizationName.trim(),
          category: category?._id,
          slug: await generateOrgSlug(organizationName.trim()),
          owner: newUser._id,
          createdBy: newUser._id,
        });
        // The founding owner is a Membership row, not just a pointer on the
        // org — that is what the permission layer reads.
        await upsertMembership({
          organization: organization._id,
          user: newUser._id,
          roles: ["owner"],
          source: "signup",
        });
      } catch (orgErr) {
        log.warn({ event: "register.org_create_failed", err: orgErr.message }, "signup organization creation failed");
      }
    }

    // Both verification steps are best-effort: registration still succeeds if
    // the mail/SMS drivers are not configured yet (the link/code is in the
    // server log). The account itself is usable immediately either way.
    const verification = email
      ? await issueVerificationEmail(newUser, { frontendUrl: userFrontendUrl })
      : { sent: false, reason: "no_email" };
    const phoneVerification = normalizedPhone
      ? await issuePhoneOtp(newUser, { force: true })
      : null;

    const token = generateToken(newUser);

    res.status(201).json({
      token,
      user: publicUser(newUser),
      organization: organization
        ? {
            _id: organization._id,
            name: organization.name,
            slug: organization.slug,
            verificationStatus: organization.verificationStatus,
          }
        : null,
      requiresEmailVerification: Boolean(newUser.email),
      verificationSent: verification.sent,
      verificationReason: verification.reason,
      requiresPhoneVerification: Boolean(normalizedPhone),
      phoneVerification,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      // Race on a unique index: `keyPattern` says which identifier was taken.
      const phoneRace = Boolean(err.keyPattern?.phone) || /phone/i.test(err.message || "");
      return res.status(409).json(
        phoneRace
          ? {
              message: "An account with this phone number already exists. Please sign in instead.",
              code: "PHONE_TAKEN",
            }
          : {
              message: "An account with this email already exists. Please sign in instead.",
              code: "EMAIL_TAKEN",
            },
      );
    }
    log.error({ event: "register.failed", err: err.message }, "registration failed");
    res.status(500).json({ message: "Registration failed" });
  }
};

export const loginUser = async (req, res) => {
  try {
    // Login by email or by phone — same password either way. OTP is for
    // verifying the number, not for every login.
    const { email, phone, identifier, password } = req.body;
    const loginId = (identifier || email || phone || "").trim();

    if (!loginId || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const lookup = [{ email: loginId.toLowerCase() }];
    const normalizedPhone = normalizePhone(loginId);
    if (normalizedPhone) lookup.push({ phone: normalizedPhone });

    const user = await User.findOne({ $or: lookup }).select("+password");

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

/**
 * POST /api/auth/verify-phone { phone, otp }
 * Mirrors verifyEmail: single-use (the stored hash is cleared on match),
 * expiring, and now attempt-limited — a 6-digit code must not be guessable.
 * The response is intentionally generic for unknown phones (no enumeration).
 */
export const verifyPhone = async (req, res) => {
  try {
    const { phone, otp } = req.body;
    const normalized = typeof phone === "string" ? normalizePhone(phone) : null;
    if (!normalized || !otp) {
      return res.status(400).json({ message: "Phone number and verification code are required" });
    }

    const invalid = {
      message: "This verification code is invalid or has expired.",
      code: "OTP_INVALID",
    };

    const user = await User.findOne({ phone: normalized })
      .select("+phoneVerificationOtp");
    if (!user || !user.phoneVerificationOtp || isOtpExpired(user.phoneVerificationExpires)) {
      return res.status(400).json(invalid);
    }
    if ((user.phoneVerificationAttempts || 0) >= MAX_OTP_ATTEMPTS) {
      return res.status(400).json({
        message: "Too many incorrect attempts. Request a new code.",
        code: "OTP_INVALID",
      });
    }

    if (user.phoneVerificationOtp !== hashOtp(otp)) {
      user.phoneVerificationAttempts = (user.phoneVerificationAttempts || 0) + 1;
      const exhausted = user.phoneVerificationAttempts >= MAX_OTP_ATTEMPTS;
      if (exhausted) {
        // Burn the code so it cannot be tried again.
        user.phoneVerificationOtp = undefined;
        user.phoneVerificationExpires = undefined;
      }
      await user.save();
      return res.status(400).json(
        exhausted
          ? {
              message: "Too many incorrect attempts. Request a new code.",
              code: "OTP_INVALID",
            }
          : invalid,
      );
    }

    user.phoneVerified = true;
    user.phoneVerifiedAt = new Date();
    user.phoneVerificationOtp = undefined;
    user.phoneVerificationExpires = undefined;
    user.phoneVerificationAttempts = 0;
    await user.save();

    res.status(200).json({
      message: "Phone number verified. You can now use all account features.",
      user: publicUser(user),
    });
  } catch (err) {
    log.error({ event: "verify-phone.failed", err: err.message }, "phone verification failed");
    res.status(500).json({ message: "Phone verification failed" });
  }
};

/**
 * POST /api/auth/resend-phone-otp { phone }
 * Same contract as resend-verification: generic 200 for unknown or already
 * verified numbers (no enumeration) plus a per-account cool-down. The one
 * non-generic case is when the code genuinely could not be delivered anywhere
 * — that says so instead of silently pretending it was sent.
 */
export const resendPhoneOtp = async (req, res) => {
  try {
    const { phone } = req.body;
    const normalized = typeof phone === "string" ? normalizePhone(phone) : null;
    if (!normalized) return res.status(400).json({ message: "Phone number is required" });

    const user = await User.findOne({ phone: normalized });

    const generic = {
      message: "If an account exists for that phone number and is unverified, a new code has been sent.",
    };

    if (!user || user.phoneVerified === true) {
      return res.status(200).json(generic);
    }

    const result = await issuePhoneOtp(user);

    if (result.reason === "cooldown") {
      return res.status(429).json({
        message: "A verification code was sent recently. Please wait a minute before requesting another.",
        code: "RESEND_COOLDOWN",
      });
    }
    if (!result.sent) {
      return res.status(400).json({
        message: result.message,
        code: "NO_DELIVERY_CHANNEL",
      });
    }

    res.status(200).json(generic);
  } catch (err) {
    log.error({ event: "resend-phone-otp.failed", err: err.message }, "resend phone OTP failed");
    res.status(500).json({ message: "Could not resend verification code" });
  }
};

export const deleteAccount = async (req, res) => {
  try {
    // `protect` also accepts platform Admin tokens. Deleting a user account is
    // a user-only action, so an Admin token must not fall through to it.
    if (req.principalType !== "user") {
      return res.status(403).json({
        message: "This endpoint deletes a user account, not an admin account.",
        code: "WRONG_PRINCIPAL",
      });
    }

    await deleteUserAccount(req.user.id, { email: req.user.email, phone: req.user.phone });

    // Recorded after the delete, so it survives as the durable record that
    // this account id was removed and why.
    await recordAudit({
      req,
      action: "user.account_deleted",
      targetType: "user",
      targetId: req.user.id,
      targetLabel: req.user.email,
      metadata: { selfService: true },
    });

    res.json({ message: "Account deleted" });
  } catch (err) {
    if (err instanceof AccountDeletionError) {
      return res.status(err.status).json({
        message: err.message,
        code: err.code,
        ...(err.organizations ? { organizations: err.organizations } : {}),
      });
    }
    log.error({ event: "account.delete_failed", err: err.message }, "account deletion failed");
    res.status(500).json({ message: "Could not delete the account" });
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
