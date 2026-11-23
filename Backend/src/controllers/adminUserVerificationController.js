import User from "../models/User.js";
import { recordAudit } from "../utils/audit.js";
import { invalidateEmailCode } from "../utils/emailVerification.js";
import logger from "../utils/logger.js";

const log = logger.child({ service: "admin-user-verification" });

const clamp = (value, fallback, min, max) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

/**
 * GET /api/admin/users — support view of platform User accounts.
 * Only non-secret fields are projected; verification hashes are never sent.
 */
export const listUsers = async (req, res) => {
  try {
    const page = clamp(req.query.page, 1, 1, 100000);
    const limit = clamp(req.query.limit, 25, 1, 100);
    const filter = {};
    const search = String(req.query.search || "").trim();
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { name: { $regex: escaped, $options: "i" } },
        { email: { $regex: escaped, $options: "i" } },
      ];
    }
    if (req.query.emailVerified === "true" || req.query.emailVerified === "false") {
      filter.emailVerified = req.query.emailVerified === "true";
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("name email phone emailVerified emailVerifiedAt phoneVerified status accountType createdAt")
        .lean(),
      User.countDocuments(filter),
    ]);

    res.json({
      users,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    log.error({ event: "admin.users.list_failed", err: err.message }, "could not list users");
    res.status(500).json({ message: "Could not list users" });
  }
};

/**
 * POST /api/admin/users/:id/mark-email-verified { note }
 * Audited support override for a user who cannot receive the code (lost
 * mailbox, mail-provider outage, accessibility issue, ...). Never issues or
 * reveals a code, and never touches Admin accounts or admin login.
 */
export const markEmailVerified = async (req, res) => {
  try {
    const note = String(req.body?.note || "").trim().slice(0, 500);
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const alreadyVerified = user.emailVerified === true;
    if (!alreadyVerified) {
      user.emailVerified = true;
      user.emailVerifiedAt = new Date();
      invalidateEmailCode(user);
      await user.save();
    }

    await recordAudit({
      req,
      action: "admin.user_email_verified",
      targetType: "user",
      targetId: user._id,
      targetLabel: user.email || String(user._id),
      metadata: { manual: true, alreadyVerified, note },
    });

    res.json({
      message: alreadyVerified
        ? "This email was already verified. The override was recorded in the audit log."
        : "Email marked verified. The override was recorded in the audit log.",
      alreadyVerified,
      user: {
        _id: user._id,
        email: user.email || "",
        emailVerified: true,
        emailVerifiedAt: user.emailVerifiedAt,
        phoneVerified: user.phoneVerified === true,
      },
    });
  } catch (err) {
    log.error({ event: "admin.users.verify_failed", err: err.message }, "manual verification failed");
    res.status(500).json({ message: "Could not mark the email as verified" });
  }
};
