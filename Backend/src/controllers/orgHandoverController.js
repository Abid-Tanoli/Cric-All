import crypto from "crypto";
import mongoose from "mongoose";
import User from "../models/User.js";
import TeamOrganization from "../models/TeamOrganization.js";
import Membership from "../models/Membership.js";
import {
  normalizeRoles,
  syncLegacyMembersArray,
  upsertMembership,
} from "../services/membershipService.js";
import { isPlatformAdmin } from "../middleware/orgAccess.js";
import { normalizePhone } from "../utils/phone.js";
import { recordAudit } from "../utils/audit.js";
import logger from "../utils/logger.js";

const log = logger.child({ service: "org-handover" });

// Readable, high-entropy temporary password. The alphabet omits characters
// that are easy to confuse when an operator reads the value out over the phone
// (I/l/1, O/0). The fixed suffix guarantees both a letter and a digit, so the
// value always passes validatePasswordStrength even if the random draw is
// unlucky.
const TEMP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function generateTemporaryPassword() {
  let password = "";
  for (let i = 0; i < 14; i += 1) {
    // randomInt() is the crypto module's unbiased secure generator; taking a
    // random byte modulo the alphabet length would bias the first characters.
    password += TEMP_ALPHABET[crypto.randomInt(TEMP_ALPHABET.length)];
  }
  return `${password}7a`;
}

function ownerSummary(user) {
  return {
    _id: user._id,
    name: user.name,
    email: user.email || "",
    phone: user.phone || "",
    accountType: user.accountType,
  };
}

function conflict(res, message, code) {
  return res.status(409).json({ message, code });
}

/**
 * POST /api/admin/organizations/:id/handover
 *
 * Platform-admin only. Finds or creates the person's User account, makes them
 * the organization owner, and optionally issues a temporary password.
 *
 * Why a temporary password at all: the admin is handing the organization to
 * somebody who may not have an account yet, and the platform has no guaranteed
 * mail/SMS delivery configured. The account is therefore created with a
 * password the admin can pass on privately; `mustChangePassword` sends the
 * owner to the change-password screen on first login, and the temp value is
 * never stored in plain text anywhere.
 *
 * The email/phone is marked verified because the platform admin has identified
 * the person and is deliberately handing the organization to them. The audit
 * entry records that this was an admin handover, not a self-service
 * verification.
 */
export const handoverOrganization = async (req, res) => {
  try {
    if (!isPlatformAdmin(req)) {
      return res.status(403).json({
        message: "Only a platform admin can hand over an organization.",
        code: "PLATFORM_ADMIN_REQUIRED",
      });
    }

    const orgId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(orgId)) {
      return res.status(400).json({ message: "Invalid organization id" });
    }

    const org = await TeamOrganization.findById(orgId);
    if (!org) return res.status(404).json({ message: "Organization not found" });

    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const phoneInput = String(req.body.phone || "").trim();
    const phone = phoneInput ? normalizePhone(phoneInput) : "";

    if (!name) return res.status(400).json({ message: "The owner's name is required" });
    if (phoneInput && !phone) {
      return res.status(400).json({ message: "Please provide a valid phone number" });
    }
    if (!email && !phone) {
      return res.status(400).json({ message: "An email address or a phone number is required" });
    }

    // Look both identifiers up separately. Using one $or query would happily
    // return one account while the other identifier belongs to somebody else,
    // and the handover would silently merge two people's identities.
    const [byEmail, byPhone] = await Promise.all([
      email ? User.findOne({ email }).select("+password") : null,
      phone ? User.findOne({ phone }).select("+password") : null,
    ]);
    if (byEmail && byPhone && String(byEmail._id) !== String(byPhone._id)) {
      return conflict(
        res,
        "That email address and phone number belong to two different accounts.",
        "OWNER_IDENTIFIERS_CONFLICT"
      );
    }

    let user = byEmail || byPhone;
    const accountCreated = !user;
    let temporaryPassword = null;

    if (!user) {
      temporaryPassword = generateTemporaryPassword();
      try {
        user = await User.create({
          name,
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {}),
          password: temporaryPassword,
          role: "scorer",
          accountType: "organization_admin",
          emailVerified: Boolean(email),
          ...(email ? { emailVerifiedAt: new Date() } : {}),
          phoneVerified: Boolean(phone),
          ...(phone ? { phoneVerifiedAt: new Date() } : {}),
          mustChangePassword: true,
          authProviders: [{ provider: "password" }],
        });
      } catch (error) {
        if (error?.code === 11000) {
          return conflict(
            res,
            "An account with that email or phone number was created in the meantime. Try again.",
            "OWNER_ACCOUNT_TAKEN"
          );
        }
        throw error;
      }
    } else {
      if (user.status === "suspended") {
        return res.status(403).json({
          message: "That account is suspended. Reactivate it before handing over an organization.",
          code: "OWNER_ACCOUNT_SUSPENDED",
        });
      }

      // Never replace an identifier that is already on the account; that would
      // let a handover quietly move somebody else's login to a new address.
      if (email && user.email && user.email !== email) {
        return conflict(
          res,
          "That account already uses a different email address.",
          "OWNER_EMAIL_MISMATCH"
        );
      }
      if (phone && user.phone && user.phone !== phone) {
        return conflict(
          res,
          "That account already uses a different phone number.",
          "OWNER_PHONE_MISMATCH"
        );
      }

      if (email && !user.email) user.email = email;
      if (phone && !user.phone) user.phone = phone;
      if (email) {
        user.emailVerified = true;
        user.emailVerifiedAt = user.emailVerifiedAt || new Date();
      }
      if (phone) {
        user.phoneVerified = true;
        user.phoneVerifiedAt = user.phoneVerifiedAt || new Date();
      }

      // An existing password stays untouched unless the admin explicitly asks
      // for a reset. A Google-only account has no password, so it always gets
      // one; otherwise the person would have no way to sign in with the
      // credentials the admin is about to share.
      if (req.body.resetExistingPassword === true || !user.passwordSet || !user.password) {
        temporaryPassword = generateTemporaryPassword();
        user.password = temporaryPassword;
        user.mustChangePassword = true;
        // A password the admin now knows must not leave older sessions alive.
        // The person signs in again with the temporary password and is sent to
        // the change-password screen.
        user.tokenVersion = (user.tokenVersion || 0) + 1;
      }

      try {
        await user.save();
      } catch (error) {
        if (error?.code === 11000) {
          return conflict(
            res,
            "An account with that email or phone number was created in the meantime. Try again.",
            "OWNER_ACCOUNT_TAKEN"
          );
        }
        throw error;
      }
    }

    // Promote first, demote second: the organization must never be left without
    // an active owner, not even for the duration of two writes.
    await upsertMembership({
      organization: org._id,
      user: user._id,
      roles: ["owner"],
      source: "admin",
      req,
    });

    const previousOwnerId = org.owner ? String(org.owner) : null;
    let previousOwnerDemoted = false;
    if (previousOwnerId && previousOwnerId !== String(user._id)) {
      const previous = await Membership.findOne({
        organization: org._id,
        user: previousOwnerId,
      });
      // Only a real, active owner is demoted. A stale `org.owner` pointer must
      // not quietly promote an ordinary member to admin during a handover.
      if (
        previous &&
        previous.status === "active" &&
        (previous.roles || []).includes("owner")
      ) {
        previous.roles = normalizeRoles([
          ...(previous.roles || []).filter((role) => role !== "owner"),
          "admin",
        ]);
        await previous.save();
        previousOwnerDemoted = true;
        // upsertMembership() synced the legacy array while the previous owner
        // was still an owner, so it excluded them. Re-sync after the demotion
        // so the deprecated org.members[] view includes the new admin.
        await syncLegacyMembersArray(org._id);
      }
    }

    if (!org.owner || String(org.owner) !== String(user._id)) {
      org.owner = user._id;
      await org.save();
    }

    await recordAudit({
      req,
      organization: org._id,
      action: "org.handover_completed",
      targetType: "user",
      targetId: user._id,
      targetLabel: user.email || user.phone || String(user._id),
      metadata: {
        previousOwner: previousOwnerId,
        previousOwnerDemoted,
        accountCreated,
        temporaryPasswordIssued: Boolean(temporaryPassword),
        identifiers: { email: user.email || "", phone: user.phone || "" },
        // Deliberately records that verification was admin-vouched. The value
        // of the temporary password is never written to the audit log.
        identityVerifiedBy: "admin_handover",
      },
    });

    res.status(200).json({
      message: accountCreated
        ? "Organization handed over. Share the temporary password with the new owner."
        : "Organization handed over.",
      organization: { _id: org._id, name: org.name },
      owner: ownerSummary(user),
      accountCreated,
      temporaryPassword,
      mustChangePassword: Boolean(user.mustChangePassword),
      loginIdentifiers: {
        email: user.email || "",
        phone: user.phone || "",
      },
    });
  } catch (error) {
    log.error({ event: "org.handover_failed", err: error.message }, "organization handover failed");
    res.status(500).json({ message: "Could not hand over the organization" });
  }
};

export default { handoverOrganization };
