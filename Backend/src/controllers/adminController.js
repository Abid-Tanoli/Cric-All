import Admin from "../models/Admin.js";
import { generateToken } from "../utils/jwt.js";
import bcrypt from "bcryptjs";
import { validatePasswordStrength } from "../utils/password.js";
import logger from "../utils/logger.js";
import {
  generateResetToken,
  hashResetToken,
  getResetTokenExpiry,
  isResetTokenExpired,
} from "../utils/passwordReset.js";

const adminFrontendUrl = process.env.ADMIN_URL || "http://localhost:5174";

// One response for every way registration can be closed. The caller must not be
// able to tell "the flag is off" from "admins already exist" from "someone beat
// you to it", because those are exactly the probes an attacker would run to
// decide whether to keep hammering the endpoint.
const REGISTRATION_CLOSED = "Admin registration is closed.";

const GENERIC_INTERNAL_ERROR = "Something went wrong. Please try again.";

/**
 * Logs the real cause and tells the caller nothing.
 *
 * A Mongoose error string can carry collection names, index definitions, the
 * shape of a stored document and occasionally a fragment of the value that
 * failed - none of which belongs in an unauthenticated response body.
 */
function internalError(res, err, message, context = {}) {
  logger.error({ err, ...context }, message);
  return res.status(500).json({ message: GENERIC_INTERNAL_ERROR });
}

/**
 * The bootstrap switch. Absent, empty, "false", "0" and "no" all mean off, so a
 * typo fails closed rather than leaving registration wide open.
 */
export function adminRegistrationEnabled() {
  const raw = String(process.env.ALLOW_ADMIN_REGISTER ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

const BOOTSTRAP_CLAIM = "first-admin";

export const registerAdmin = async (req, res) => {
  try {
    // The flag is checked before anything else. Even with an empty collection,
    // an unset flag means this endpoint does not exist.
    if (!adminRegistrationEnabled()) {
      return res.status(403).json({ message: REGISTRATION_CLOSED });
    }

    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ message: "All fields are required" });

    const passwordError = validatePasswordStrength(password);
    if (passwordError) return res.status(400).json({ message: passwordError });

    const adminCount = await Admin.countDocuments();
    if (adminCount > 0) {
      return res.status(403).json({ message: REGISTRATION_CLOSED });
    }

    // Make sure the unique bootstrap index actually exists before relying on it
    // to arbitrate the race. Model.init() is memoised, so this is a one-off cost
    // rather than a per-request index build.
    await Admin.init();

    // The bootstrap account is always a superadmin. It is never taken from the
    // request body, and there is no second branch to get out of step with it.
    const admin = await Admin.create({
      name,
      email,
      password,
      role: "superadmin",
      bootstrapClaim: BOOTSTRAP_CLAIM,
    });
    const token = generateToken(admin);

    logger.info({ event: "admin.bootstrap.created", email: admin.email }, "first admin bootstrapped via API");
    res.status(201).json({ token, user: { _id: admin._id, name: admin.name, email: admin.email, role: admin.role } });
  } catch (err) {
    // Someone else won the race. The duplicate key on the bootstrap index is the
    // authoritative answer, so it is a refusal and not a server fault.
    if (err?.code === 11000) {
      return res.status(403).json({ message: REGISTRATION_CLOSED });
    }
    return internalError(res, err, "admin bootstrap failed", { route: "POST /admin/register" });
  }
};

export const createAdmin = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ message: "All fields are required" });

    const passwordError = validatePasswordStrength(password);
    if (passwordError) return res.status(400).json({ message: passwordError });

    const existing = await Admin.findOne({ email });
    if (existing) return res.status(400).json({ message: "Admin already exists" });

    // A superadmin cannot mint another superadmin through this endpoint.
    const admin = await Admin.create({ name, email, password, role: "admin" });
    const created = await Admin.findById(admin._id).select("-password");

    res.status(201).json(created);
  } catch (err) {
    return internalError(res, err, "admin request failed");
  }
};

export const loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: "All fields are required" });

    const admin = await Admin.findOne({ email });
    if (!admin) return res.status(400).json({ message: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

    const token = generateToken(admin);

    res.json({ token, user: { _id: admin._id, name: admin.name, email: admin.email, role: admin.role } });
  } catch (err) {
    return internalError(res, err, "admin request failed");
  }
};

export const getAdminProfile = async (req, res) => {
  try {
    const admin = req.user;
    if (!admin) return res.status(404).json({ message: "Admin not found" });
    res.json(admin);

  } catch (err) {
    return internalError(res, err, "admin request failed");
  }
};

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const admin = await Admin.findOne({ email }).select("+resetPasswordToken");
    if (admin) {
      const token = generateResetToken();
      admin.resetPasswordToken = hashResetToken(token);
      admin.resetPasswordExpires = getResetTokenExpiry();
      await admin.save();

      // TODO: send via email once an email service is configured
      console.log(`[Admin password reset] ${admin.email}: ${adminFrontendUrl}/admin/reset-password/${token}`);
    }

    // Always return the same generic success message so we don't leak
    // which email addresses are registered.
    res.status(200).json({ message: "If an account exists for this email, a reset link has been sent" });
  } catch (err) {
    return internalError(res, err, "admin request failed");
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
    const admin = await Admin.findOne({
      resetPasswordToken: hashedToken,
    }).select("+resetPasswordToken");

    if (!admin || isResetTokenExpired(admin.resetPasswordExpires)) {
      return res.status(400).json({ message: "Password reset token is invalid or has expired" });
    }

    admin.password = password;
    admin.resetPasswordToken = undefined;
    admin.resetPasswordExpires = undefined;
    await admin.save();

    res.status(200).json({ message: "Password reset successfully. You can now sign in." });
  } catch (err) {
    return internalError(res, err, "admin request failed");
  }
};

export const listAdmins = async (req, res) => {
  try {
    const admins = await Admin.find().select("-password");
    res.json(admins);
  } catch (err) {
    return internalError(res, err, "admin request failed");
  }
};

export const updateAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = req.body;
    const requester = req.user;

    const admin = await Admin.findById(id);
    if (!admin) return res.status(404).json({ message: "Admin not found" });

    const isSelf = String(requester._id) === String(admin._id);

    if (payload.role && String(payload.role) !== String(admin.role)) {
      if (isSelf) {
        return res.status(400).json({ message: "You cannot change your own role" });
      }
      if (requester.role !== "superadmin") {
        return res.status(403).json({ message: "Only a super admin can change another admin's role" });
      }
      if (!["admin", "superadmin"].includes(payload.role)) {
        return res.status(400).json({ message: "Invalid role" });
      }
      admin.role = payload.role;
    }

    admin.name = payload.name ?? admin.name;
    admin.email = payload.email ?? admin.email;
    if (payload.password) {
      const passwordError = validatePasswordStrength(payload.password);
      if (passwordError) return res.status(400).json({ message: passwordError });
      admin.password = payload.password;
    }

    await admin.save();
    const updated = await Admin.findById(id).select("-password");
    res.json(updated);
  } catch (err) {
    return internalError(res, err, "admin request failed");
  }
};

export const deleteAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const requester = req.user;

    if (String(requester._id) === String(id)) {
      return res.status(400).json({ message: "You cannot delete your own account" });
    }

    await Admin.findByIdAndDelete(id);
    res.json({ message: "Admin deleted" });
  } catch (err) {
    return internalError(res, err, "admin request failed");
  }
};
