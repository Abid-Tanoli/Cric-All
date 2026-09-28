import User from "../models/User.js";
import { generateToken } from "../utils/jwt.js";
import logger from "../utils/logger.js";
import {
  verifyGoogleIdToken,
  GoogleVerificationError,
} from "../services/googleVerifier.js";

const log = logger.child({ service: "googleAuth" });

function publicUser(user, picture) {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    accountType: user.accountType,
    emailVerified: user.emailVerified === true,
    status: user.status || "active",
    ...(picture ? { picture } : {}),
  };
}

function addProvider(user, provider, providerUserId = "") {
  const providers = Array.isArray(user.authProviders) ? user.authProviders.slice() : [];
  const exists = providers.some(
    (p) => p.provider === provider && (!providerUserId || p.providerUserId === providerUserId),
  );
  if (!exists) providers.push({ provider, providerUserId });
  user.authProviders = providers;
}

/**
 * Resolve a verified Google identity to exactly one User document.
 *
 * Linking rules (never two accounts for one email):
 *  - Google email matches an existing verified account  → link Google to it.
 *  - Google email matches an existing UNVERIFIED
 *    password account → Google proves the mailbox, so the account is marked
 *    verified AND the old password + all sessions are invalidated (blocks
 *    pre-registration account takeover), then Google is linked.
 *  - No account → create one that is already verified and passwordless.
 *  - Google id already attached → plain sign-in.
 */
async function resolveGoogleUser(identity) {
  const { googleId, email } = identity;

  // +password so we can tell whether a legacy account has a real password
  // (passwordSet defaults to false on documents created before that field).
  let user = await User.findOne({ googleId }).select("+password");

  if (!user) {
    user = await User.findOne({ email }).select("+password");
  }

  if (user) {
    if (user.googleId && user.googleId !== googleId) {
      const err = new Error("This email is already linked to a different Google account.");
      err.code = "GOOGLE_ID_CONFLICT";
      throw err;
    }

    const unverified = user.emailVerified !== true;
    const hadPassword = Boolean(user.password) || user.passwordSet === true;
    const invalidatePassword = unverified && hadPassword;

    if (!user.googleId) {
      user.googleId = googleId;
    }
    addProvider(user, "google", googleId);

    if (unverified) {
      // Google asserts the mailbox is verified → trust it, and drop any
      // password an attacker could have registered before the real owner.
      user.emailVerified = true;
      user.emailVerifiedAt = new Date();
    }
    if (invalidatePassword) {
      user.tokenVersion = (user.tokenVersion || 0) + 1;
      user.passwordSet = false;
    }

    user.lastLoginAt = new Date();
    await user.save();

    if (invalidatePassword) {
      await User.updateOne(
        { _id: user._id },
        {
          $unset: { password: "", resetPasswordToken: "", resetPasswordExpires: "" },
        },
      );
      user.password = undefined;
    }

    return { user, created: false, invalidatedPassword: invalidatePassword };
  }

  // Brand-new identity.
  user = await User.create({
    name: identity.name || email.split("@")[0],
    email,
    googleId,
    role: "viewer",
    accountType: "viewer",
    emailVerified: true,
    emailVerifiedAt: new Date(),
    passwordSet: false,
    authProviders: [{ provider: "google", providerUserId: googleId }],
    lastLoginAt: new Date(),
  });
  return { user, created: true };
}

async function handleGoogleAuth(req, res, { adminPath = false } = {}) {
  let identity;
  try {
    const { credential } = req.body || {};
    if (!credential) {
      return res.status(400).json({ message: "Google credential is required" });
    }
    identity = await verifyGoogleIdToken(credential);
  } catch (error) {
    if (error instanceof GoogleVerificationError) {
      log.warn({ event: "google.verify_failed", code: error.code }, "google token rejected");
      if (error.code === "GOOGLE_CLIENT_ID_MISSING") {
        return res.status(503).json({
          message: "Google sign-in is not configured on this server.",
          code: error.code,
        });
      }
      return res.status(401).json({ message: "Google authentication failed" });
    }
    log.error({ event: "google.verify_error", err: error.message }, "google verification error");
    return res.status(401).json({ message: "Google authentication failed" });
  }

  try {
    const { user, created, invalidatedPassword } = await resolveGoogleUser(identity);

    if (adminPath && !created && user.role !== "admin" && user.role !== "scorer") {
      return res.status(403).json({ message: "Not authorized as admin. Use a different account." });
    }

    const token = generateToken(user);

    res.json({
      token,
      user: publicUser(user, identity.picture),
      ...(invalidatedPassword
        ? { notice: "Your password was removed because this account was previously unverified. Use Google to sign in, then set a new password." }
        : {}),
    });
  } catch (error) {
    if (error.code === "GOOGLE_ID_CONFLICT") {
      return res.status(409).json({ message: error.message, code: error.code });
    }
    if (error?.code === 11000) {
      // Lost a race on the unique email index — the other request created the
      // account; resolve against it instead of failing the user.
      try {
        const existing = await User.findOne({ email: identity.email });
        if (existing) {
          const token = generateToken(existing);
          return res.json({ token, user: publicUser(existing, identity.picture) });
        }
      } catch {
        /* fall through to generic error */
      }
    }
    log.error({ event: "google.auth_failed", err: error.message }, "google auth failed");
    res.status(401).json({ message: "Google authentication failed" });
  }
}

export async function googleLogin(req, res) {
  return handleGoogleAuth(req, res, { adminPath: false });
}

export async function googleAdminLogin(req, res) {
  return handleGoogleAuth(req, res, { adminPath: true });
}
