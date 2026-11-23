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
  hashEmailCode,
  isEmailCodeExpired,
  isEmailCoolingDown,
  issueEmailCode,
  invalidateEmailCode,
  MAX_EMAIL_CODE_ATTEMPTS,
} from "../utils/emailVerification.js";
import { checkEmailPolicy, normalizeEmail } from "../utils/emailPolicy.js";
import { canSendVerification, recordVerificationSend } from "../utils/verificationBudget.js";
import { normalizePhone } from "../utils/phone.js";
import logger from "../utils/logger.js";
import { recordAudit } from "../utils/audit.js";
import { deleteUserAccount, AccountDeletionError } from "../services/accountDeletionService.js";

const log = logger.child({ service: "auth" });

const userFrontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

const EMAIL_POLICY_MESSAGES = {
  INVALID_EMAIL: "Please use a valid email address",
  DISPOSABLE_EMAIL: "Please use a permanent email address (temporary mailboxes are not accepted)",
  NO_MX_RECORD: "This email domain cannot receive mail. Please use a different address",
};

/**
 * Issue a verification code with the shared hourly budget (per user + per IP).
 * Never throws into a request path: mailer already swallows delivery errors.
 */
async function deliverVerificationCode(user, req, { force = false } = {}) {
  const budget = canSendVerification(user, req);
  if (!budget.allowed) {
    return { sent: false, reason: "rate_limited", retryAfterMs: budget.retryAfterMs };
  }
  const result = await issueEmailCode(user, { force });
  if (result.sent) recordVerificationSend(user, req);
  return result;
}

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
    // The client needs these two to show the right password screen: a
    // Google-only account sets a password instead of changing one, and an
    // account handed over by an admin is nudged to replace the temporary one.
    passwordSet: user.passwordSet === true,
    mustChangePassword: user.mustChangePassword === true,
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
    const normalizedEmail = email ? normalizeEmail(email) : "";
    if (!name || !password || (!normalizedEmail && !normalizedPhone)) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Strict syntax, a small maintained disposable list, and an MX check that
    // fails open. DNS is consulted via Node's built-in resolver only, and a
    // timeout/SERVFAIL never blocks signup.
    if (normalizedEmail) {
      const policy = await checkEmailPolicy(normalizedEmail);
      if (!policy.ok) {
        return res.status(400).json({
          message: EMAIL_POLICY_MESSAGES[policy.reason] || "Please use a valid email address",
          code: policy.reason,
        });
      }
    }

    // Email setters (lowercase/trim) normalize both sides of this lookup, and
    // phone is stored pre-normalized, so both duplicate checks compare
    // canonical values.
    if (normalizedEmail) {
      const emailExists = await User.findOne({ email: normalizedEmail });
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
      ...(normalizedEmail ? { email: normalizedEmail } : {}),
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
        battingPosition: playerProfile.battingPosition || "",
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
        // Optional tree selection from the registration form. The Player model
        // resolves labels and ancestors, so an unapproved "Other" suggestion
        // the registrant just created works here without a second request.
        ...(playerProfile.location?.locationRefs ? { locationRefs: playerProfile.location.locationRefs } : {}),
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

    // Email verification is best-effort: registration still succeeds if the
    // mail driver is not configured yet (with MAIL_DRIVER=console the code is
    // written to the backend log for local testing). Phone/SMS verification is
    // deferred — no SMS is sent and the phone is always shown as "not verified".
    const verification = normalizedEmail
      ? await deliverVerificationCode(newUser, req, { force: true })
      : { sent: false, reason: "no_email" };

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
      requiresPhoneVerification: false,
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
    // Choosing a new password through the emailed link satisfies the same
    // requirement as the signed-in change-password screen.
    user.mustChangePassword = false;
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
 * POST /api/auth/change-password { currentPassword, newPassword }
 *
 * The signed-in way to replace a password. `forgot-password` remains the
 * signed-out way. A Google-only account has no password to compare against, so
 * it may set one with `currentPassword` omitted; every account that already has
 * a password must prove it knows the old one.
 *
 * Bumping `tokenVersion` invalidates every other session, and the response
 * carries a fresh token so this session survives the bump.
 */
export const changePassword = async (req, res) => {
  try {
    if (req.principalType !== "user") {
      return res.status(403).json({
        message: "Use the admin password reset flow for an admin account.",
        code: "WRONG_PRINCIPAL",
      });
    }

    const { currentPassword = "", newPassword } = req.body;
    const passwordError = validatePasswordStrength(newPassword);
    if (passwordError) return res.status(400).json({ message: passwordError });

    const user = await User.findById(req.user._id).select("+password");
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.passwordSet && user.password) {
      if (!currentPassword) {
        return res.status(400).json({
          message: "Enter your current password.",
          code: "CURRENT_PASSWORD_REQUIRED",
        });
      }
      const matches = await user.comparePassword(currentPassword);
      if (!matches) {
        return res.status(400).json({
          message: "Your current password is incorrect.",
          code: "CURRENT_PASSWORD_INVALID",
        });
      }
      if (currentPassword === newPassword) {
        return res.status(400).json({
          message: "Choose a password different from your current one.",
          code: "PASSWORD_UNCHANGED",
        });
      }
    }

    user.password = newPassword;
    user.mustChangePassword = false;
    // A password change is a session-invalidating event; the fresh token below
    // is the only one that keeps working.
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    const token = generateToken(user);
    res.status(200).json({
      message: "Password changed successfully.",
      token,
      user: publicUser(user),
    });
  } catch (err) {
    log.error({ event: "change-password.failed", err: err.message }, "change password failed");
    res.status(500).json({ message: "Could not change the password" });
  }
};

/**
 * POST /api/auth/verify-email { email, code }
 *
 * A 6-digit, 10-minute, single-use code. Only its SHA-256 hash is stored.
 * Five wrong guesses invalidate the code; a new one must then be requested.
 */
export const verifyEmail = async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ message: "Email address and verification code are required" });
    }

    const invalid = {
      message: "This verification code is invalid or has expired.",
      code: "VERIFY_CODE_INVALID",
    };
    const user = await User.findOne({ email: normalizeEmail(email) })
      .select("+emailVerificationCode");

    if (!user || !user.emailVerificationCode || isEmailCodeExpired(user.emailVerificationExpires)) {
      return res.status(400).json(invalid);
    }
    if ((user.emailVerificationAttempts || 0) >= MAX_EMAIL_CODE_ATTEMPTS) {
      return res.status(400).json({
        message: "Too many incorrect attempts. Request a new code.",
        code: "VERIFY_CODE_INVALID",
      });
    }

    if (user.emailVerificationCode !== hashEmailCode(code)) {
      user.emailVerificationAttempts = (user.emailVerificationAttempts || 0) + 1;
      const exhausted = user.emailVerificationAttempts >= MAX_EMAIL_CODE_ATTEMPTS;
      if (exhausted) invalidateEmailCode(user);
      await user.save();
      return res.status(400).json(
        exhausted
          ? { message: "Too many incorrect attempts. Request a new code.", code: "VERIFY_CODE_INVALID" }
          : invalid,
      );
    }

    user.emailVerified = true;
    user.emailVerifiedAt = new Date();
    invalidateEmailCode(user);
    await user.save();

    await recordAudit({
      req,
      action: "user.email_verified",
      targetType: "user",
      targetId: user._id,
      targetLabel: user.email,
    });

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
 *
 * The response is deliberately generic for unknown, already-verified and
 * cooled-down addresses: it must not reveal whether an account exists. The
 * 60s per-account cooldown and the rolling-hour user/IP budget are still
 * enforced — they simply skip the send instead of changing the response.
 */
export const resendVerification = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const generic = {
      message: "If an account exists for that email and is unverified, a new code has been sent.",
    };
    const user = await User.findOne({ email: normalizeEmail(email) });

    if (!user || user.emailVerified === true || isEmailCoolingDown(user.verificationSentAt)) {
      return res.status(200).json(generic);
    }

    await deliverVerificationCode(user, req);
    res.status(200).json(generic);
  } catch (err) {
    log.error({ event: "resend-verification.failed", err: err.message }, "resend verification failed");
    res.status(500).json({ message: "Could not resend verification email" });
  }
};

/**
 * POST /api/auth/change-verification-email { email } (authenticated)
 *
 * "Wrong email?" on the code-entry screen. Replaces the address, clears all
 * verification secrets and restarts the flow. Changing an already-verified
 * address re-verifies it: the mailbox that was proven is no longer on file.
 */
export const changeVerificationEmail = async (req, res) => {
  try {
    if (req.principalType !== "user") {
      return res.status(403).json({
        message: "This endpoint is for user accounts only.",
        code: "WRONG_PRINCIPAL",
      });
    }
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const normalized = normalizeEmail(email);
    const policy = await checkEmailPolicy(normalized);
    if (!policy.ok) {
      return res.status(400).json({
        message: EMAIL_POLICY_MESSAGES[policy.reason] || "Please use a valid email address",
        code: policy.reason,
      });
    }

    const existing = await User.findOne({ email: normalized });
    if (existing && String(existing._id) !== String(req.user._id)) {
      return res.status(409).json({
        message: "An account with this email already exists. Please sign in instead.",
        code: "EMAIL_TAKEN",
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const previousEmail = user.email || "";
    user.email = normalized;
    user.emailVerified = false;
    user.emailVerifiedAt = undefined;
    invalidateEmailCode(user);
    await user.save();

    const result = await deliverVerificationCode(user, req, { force: true });

    await recordAudit({
      req,
      action: "user.email_change_requested",
      targetType: "user",
      targetId: user._id,
      targetLabel: normalized,
      metadata: { previousEmail, verificationSent: result.sent },
    });

    res.status(200).json({
      message: "Verification email updated. Enter the new code to continue.",
      email: normalized,
      requiresEmailVerification: true,
      verificationSent: result.sent,
      verificationReason: result.reason,
      user: publicUser(user),
    });
  } catch (err) {
    log.error({ event: "change-verification-email.failed", err: err.message }, "change verification email failed");
    res.status(500).json({ message: "Could not change the verification email" });
  }
};

// Phone/SMS verification is deferred. The endpoints are kept so older clients
// get a clear answer instead of a 404, but they never send an SMS and never
// flip phoneVerified — the UI shows the phone as "not verified".
const PHONE_VERIFICATION_DEFERRED = {
  message: "Phone verification is currently unavailable. Please verify your email address instead.",
  code: "PHONE_VERIFICATION_DEFERRED",
};

export const verifyPhone = async (req, res) =>
  res.status(400).json(PHONE_VERIFICATION_DEFERRED);

export const resendPhoneOtp = async (req, res) =>
  res.status(400).json(PHONE_VERIFICATION_DEFERRED);

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
