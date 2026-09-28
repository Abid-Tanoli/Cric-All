import jwt from "jsonwebtoken";
import Admin from "../models/Admin.js";
import User from "../models/User.js";

export const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer"))
      return res.status(401).json({ message: "Not authorized, no token" });

    const token = authHeader.split(" ")[1];

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: "Server configuration error" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    let user = await Admin.findById(decoded.id).select("-password");
    let principalType = "admin";
    if (!user) {
      user = await User.findById(decoded.id).select("-password");
      principalType = "user";
    }
    if (!user) {
      return res.status(401).json({
        message: "Session expired. Please login again.",
        code: "AUTH_PRINCIPAL_NOT_FOUND"
      });
    }

    // Session invalidation: a bumped tokenVersion (password reset, Google
    // linking that dropped a password, suspension) kills every old token.
    if (principalType === "user") {
      const presented = decoded.tv ?? 0;
      if ((user.tokenVersion ?? 0) !== presented) {
        return res.status(401).json({
          message: "Session expired. Please login again.",
          code: "AUTH_TOKEN_VERSION_MISMATCH"
        });
      }

      if (user.status === "suspended") {
        return res.status(403).json({
          message: "This account has been suspended.",
          code: "ACCOUNT_SUSPENDED"
        });
      }
    }

    req.user = user;
    req.principalType = principalType;
    next();
  } catch (err) {
    res.status(401).json({ message: "Not authorized" });
  }
};

export const requireAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Not authorized" });
  if (req.user.role !== "admin" && req.user.role !== "superadmin")
    return res.status(403).json({ message: "Admin role required" });
  next();
};

export const requireSuperAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Not authorized" });
  if (req.user.role !== "superadmin")
    return res.status(403).json({ message: "Super admin access required" });
  next();
};

// Privileged actions (creating organizations/teams/matches, publishing,
// inviting members) require a proven email address. Platform Admin principals
// (Admin collection) are not email-verified accounts and pass straight through.
export const requireVerifiedEmail = (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Not authorized" });
  if (req.principalType === "admin") return next();
  if (req.user.emailVerified !== true) {
    return res.status(403).json({
      message: "Please verify your email address before performing this action.",
      code: "EMAIL_NOT_VERIFIED",
    });
  }
  next();
};

export default { protect, requireAdmin, requireSuperAdmin, requireVerifiedEmail };
