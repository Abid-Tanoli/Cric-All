import crypto from "crypto";
import mongoose from "mongoose";
import User from "../models/User.js";
import TeamOrganization from "../models/TeamOrganization.js";
import Membership from "../models/Membership.js";
import {
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

function withSession(query, session) {
  return session ? query.session(session) : query;
}

async function realUserExists(userId, session) {
  const query = User.findOne({ _id: userId }).select("_id").lean();
  return Boolean(await withSession(query, session));
}

/**
 * True only when a previous run already produced the clean end state: this
 * user owns the organization, holds the only active owner/admin membership, and
 * no platform-admin placeholder membership is left behind.
 */
async function handoverAlreadyApplied(org, user) {
  if (!org.owner || String(org.owner) !== String(user._id)) return false;

  const target = await Membership.findOne({
    organization: org._id,
    user: user._id,
    status: "active",
  });
  if (!target || !(target.roles || []).includes("owner")) return false;

  const otherPrivileged = await Membership.countDocuments({
    organization: org._id,
    status: "active",
    user: { $ne: user._id },
    roles: { $in: ["owner", "admin"] },
  });
  return otherPrivileged === 0;
}

async function transactionsSupported() {
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    return Boolean(hello?.setName || hello?.msg === "isdbgrid");
  } catch {
    return false;
  }
}

const USER_ROLLBACK_FIELDS = [
  "name",
  "email",
  "phone",
  "password",
  "passwordSet",
  "emailVerified",
  "emailVerifiedAt",
  "phoneVerified",
  "phoneVerifiedAt",
  "mustChangePassword",
  "tokenVersion",
  "authProviders",
  "role",
  "accountType",
  "status",
];

async function captureRollbackState({ org, user }) {
  const [memberships, savedUser] = await Promise.all([
    Membership.find({ organization: org._id }).lean(),
    user ? User.findById(user._id).select("+password").lean() : null,
  ]);

  return {
    organizationId: org._id,
    owner: org.owner || null,
    legacyMembers: (org.members || []).map((member) => ({
      user: member.user,
      role: member.role,
      joinedAt: member.joinedAt,
    })),
    memberships,
    user: savedUser,
  };
}

async function restoreRollbackState(state, journal) {
  if (state.user) {
    const $set = {};
    const $unset = {};
    for (const field of USER_ROLLBACK_FIELDS) {
      if (state.user[field] === undefined) $unset[field] = "";
      else $set[field] = state.user[field];
    }
    const update = {};
    if (Object.keys($set).length) update.$set = $set;
    if (Object.keys($unset).length) update.$unset = $unset;
    if (Object.keys(update).length) {
      await User.collection.updateOne({ _id: state.user._id }, update);
    }
  } else if (journal.createdUserId) {
    await User.deleteOne({ _id: journal.createdUserId });
  }

  await Membership.deleteMany({ organization: state.organizationId });
  if (state.memberships.length > 0) {
    await Membership.collection.insertMany(state.memberships);
  }
  await TeamOrganization.collection.updateOne(
    { _id: state.organizationId },
    { $set: { owner: state.owner, members: state.legacyMembers } }
  );
}

/**
 * All handover writes. Called inside a transaction when the deployment supports
 * one, otherwise the caller compensates by restoring the captured snapshot.
 */
async function applyHandover({
  req,
  org,
  user,
  accountCreated,
  newUserPayload,
  temporaryPassword,
  session,
  journal,
}) {
  let ownerUser = user;
  const previousOwnerId = org.owner ? String(org.owner) : null;

  if (accountCreated) {
    const [created] = await User.create([newUserPayload], { session: session || undefined });
    ownerUser = created;
    journal.createdUserId = created._id;
  } else {
    await ownerUser.save(session ? { session } : undefined);
  }

  // Promote first: the organization is never left without an owner, not even
  // between two writes.
  await upsertMembership({
    organization: org._id,
    user: ownerUser._id,
    roles: ["owner"],
    source: "admin",
    req,
    session,
  });

  // A handover replaces the management team. Any other active owner/admin
  // membership is either a platform-admin placeholder (there is no User behind
  // it) or an outgoing manager. Both must lose privileged access, otherwise the
  // old owner could keep creating matches and a second owner would remain.
  const otherPrivileged = await withSession(
    Membership.find({
      organization: org._id,
      status: "active",
      user: { $ne: ownerUser._id },
      roles: { $in: ["owner", "admin"] },
    }),
    session
  );

  let previousOwnerDemoted = false;
  let phantomMembershipsRemoved = 0;
  let privilegedMembershipsDemoted = 0;

  for (const membership of otherPrivileged) {
    if (!(await realUserExists(membership.user, session))) {
      await Membership.deleteOne(
        { _id: membership._id },
        session ? { session } : undefined
      );
      phantomMembershipsRemoved += 1;
      continue;
    }

    membership.roles = ["player"];
    membership.status = "active";
    membership.removedAt = null;
    await membership.save(session ? { session } : undefined);
    privilegedMembershipsDemoted += 1;
    if (previousOwnerId && String(membership.user) === previousOwnerId) {
      previousOwnerDemoted = true;
    }
  }

  if (!org.owner || String(org.owner) !== String(ownerUser._id)) {
    org.owner = ownerUser._id;
    await org.save(session ? { session } : undefined);
  }

  // upsertMembership() synced the legacy array while the outgoing managers were
  // still privileged. Re-sync after demoting them so the deprecated
  // org.members[] view matches the authoritative Membership rows.
  await syncLegacyMembersArray(org._id, session);

  await recordAudit({
    req,
    organization: org._id,
    action: "org.handover_completed",
    targetType: "user",
    targetId: ownerUser._id,
    targetLabel: ownerUser.email || ownerUser.phone || String(ownerUser._id),
    metadata: {
      previousOwner: previousOwnerId,
      previousOwnerDemoted,
      accountCreated,
      temporaryPasswordIssued: Boolean(temporaryPassword),
      phantomMembershipsRemoved,
      privilegedMembershipsDemoted,
      identifiers: { email: ownerUser.email || "", phone: ownerUser.phone || "" },
      // Deliberately records that verification was admin-vouched. The value
      // of the temporary password is never written to the audit log.
      identityVerifiedBy: "admin_handover",
    },
    session,
  });

  return {
    ownerUser,
    previousOwnerId,
    previousOwnerDemoted,
    phantomMembershipsRemoved,
    privilegedMembershipsDemoted,
  };
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
    let newUserPayload = null;

    if (!user) {
      temporaryPassword = generateTemporaryPassword();
      newUserPayload = {
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
      };
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

      // Running the same handover twice for the same person must change
      // nothing. A requested password reset is an explicit exception.
      if (req.body.resetExistingPassword !== true && (await handoverAlreadyApplied(org, user))) {
        return res.status(200).json({
          message: "That person already owns this organization.",
          organization: { _id: org._id, name: org.name },
          owner: ownerSummary(user),
          accountCreated: false,
          temporaryPassword: null,
          mustChangePassword: Boolean(user.mustChangePassword),
          loginIdentifiers: {
            email: user.email || "",
            phone: user.phone || "",
          },
          unchanged: true,
        });
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
    }

    const journal = { createdUserId: null };
    const rollbackState = await captureRollbackState({
      org,
      user: accountCreated ? null : user,
    });

    const run = (session) =>
      applyHandover({
        req,
        org,
        user,
        accountCreated,
        newUserPayload,
        temporaryPassword,
        session,
        journal,
      });

    let result;
    if (await transactionsSupported()) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          result = await run(session);
        });
      } finally {
        await session.endSession();
      }
    } else {
      try {
        result = await run(null);
      } catch (error) {
        try {
          await restoreRollbackState(rollbackState, journal);
        } catch (rollbackError) {
          log.error(
            { event: "org.handover_rollback_failed", err: rollbackError.message },
            "organization handover rollback failed"
          );
        }
        throw error;
      }
    }

    const { ownerUser } = result;
    res.status(200).json({
      message: accountCreated
        ? "Organization handed over. Share the temporary password with the new owner."
        : "Organization handed over.",
      organization: { _id: org._id, name: org.name },
      owner: ownerSummary(ownerUser),
      accountCreated,
      temporaryPassword,
      mustChangePassword: Boolean(ownerUser.mustChangePassword),
      loginIdentifiers: {
        email: ownerUser.email || "",
        phone: ownerUser.phone || "",
      },
    });
  } catch (error) {
    if (error?.code === 11000) {
      return conflict(
        res,
        "An account with that email or phone number was created in the meantime. Try again.",
        "OWNER_ACCOUNT_TAKEN"
      );
    }
    log.error({ event: "org.handover_failed", err: error.message }, "organization handover failed");
    res.status(500).json({ message: "Could not hand over the organization" });
  }
};

export default { handoverOrganization };
