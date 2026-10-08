import mongoose from "mongoose";
import User from "../models/User.js";
import Team from "../models/Team.js";
import TeamOrganization from "../models/TeamOrganization.js";
import Membership from "../models/Membership.js";
import Invitation, {
  generateInvitationToken,
  getInvitationExpiry,
  hashInvitationToken,
  isInvitationExpired,
} from "../models/Invitation.js";
import AuditLog from "../models/AuditLog.js";
import { recordAudit } from "../utils/audit.js";
import { sendMail } from "../utils/mailer.js";
import { sendSms } from "../utils/smsSender.js";
import { formatPhone, normalizePhone } from "../utils/phone.js";
import { isIdentityVerified } from "../middleware/authMiddleware.js";
import { isPlatformAdmin } from "../middleware/orgAccess.js";
import {
  ORG_ROLE_LABELS,
  grantableRoles,
  permissionsForRoles,
  roleHasPermission,
} from "../permissions/orgPermissions.js";
import {
  OrgAccessError,
  assertNoSelfEscalation,
  getMembership,
  listMembers,
  memberSummary,
  normalizeRoles,
  removeMembership,
  rolesForGrant,
  upsertMembership,
} from "../services/membershipService.js";

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

const lower = (v) => String(v || "").trim().toLowerCase();

const notFound = (res, message = "Not found") => res.status(404).json({ message });

// OrgAccessError carries the right status/code; anything else from the service
// layer is a genuine bug and becomes a 500.
function handleServiceError(res, error, fallback) {
  if (error instanceof OrgAccessError) {
    return res.status(error.status).json({ message: error.message, code: error.code });
  }
  return res.status(500).json({ message: fallback, error: error.message });
}

/** How an invitation is addressed, for messages and UI labels. */
const invitationChannel = (invitation) =>
  invitation?.phone && !invitation?.email ? "phone" : invitation?.email ? "email" : "phone";

// Kept apart from the generic message: an email-addressed invitation that does
// not belong to this account has always answered INVITATION_EMAIL_MISMATCH, and
// clients (plus the test-suite) key off that exact code.
const invitationMismatchCode = (invitation) =>
  invitationChannel(invitation) === "phone" ? "INVITATION_PHONE_MISMATCH" : "INVITATION_EMAIL_MISMATCH";

const invitationAddress = (invitation) => {
  if (invitation?.email) return invitation.email;
  if (invitation?.phone) return formatPhone(invitation.phone) || String(invitation.phone);
  return "unknown address";
};

/**
 * Does this account own the address the invitation was sent to?
 *
 * `requireVerified: false` answers "is this the right account" (the preview
 * page uses it to decide which banner to show). `requireVerified: true`
 * answers "may this account accept" and is the actual authorization gate: an
 * invitation to a phone number needs that phone VERIFIED on this account, an
 * invitation to an email needs that email verified. A verified phone never
 * vouches for an unverified email and vice versa — an unverified identifier is
 * a claim, not proof.
 */
const matchesInvitationAddress = (user, invitation, { requireVerified = true } = {}) => {
  if (!user || !invitation) return false;
  if (invitation.email) {
    const emailOk = lower(user.email) === invitation.email;
    if (emailOk && (!requireVerified || user.emailVerified === true)) return true;
  }
  if (invitation.phone) {
    const phoneOk = user.phone && user.phone === invitation.phone;
    if (phoneOk && (!requireVerified || user.phoneVerified === true)) return true;
  }
  return false;
};

/** Every account whose email or phone equals the supplied address. */
const findAccountsByAddress = ({ email, phone }) => {
  const or = [];
  if (email) or.push({ email });
  if (phone) or.push({ phone });
  return or.length ? User.find({ $or: or }).select("_id name email phone emailVerified phoneVerified status") : [];
};

const addressClause = ({ email, phone }) => {
  const or = [];
  if (email) or.push({ email });
  if (phone) or.push({ phone });
  return or.length ? { $or: or } : null;
};

/**
 * ALREADY_MEMBER is an organization fact, not an account-existence fact: the
 * caller already holds INVITE_MEMBERS and can read the roster, so telling them
 * "this address is already in your org" leaks nothing they could not see by
 * listing members. Detection has to cover phone-addressed members too, not
 * just email ones.
 */
const findActiveMemberByAddress = async (organizationId, address) => {
  const clause = addressClause(address);
  if (!clause) return null;
  const accounts = await findAccountsByAddress(address);
  if (!accounts.length) return null;
  return Membership.findOne({
    organization: organizationId,
    status: "active",
    user: { $in: accounts.map((a) => a._id) },
  });
};

const displayAddress = ({ email, phone } = {}) =>
  email || (phone ? formatPhone(phone) : "") || "";

const roleLabels = (roles) => roles.map((role) => ORG_ROLE_LABELS[role] || role).join(", ");

// ---------------------------------------------------------------------------
// My access in one organization — the User dashboard fetches this to decide
// which navigation entries to render, so the UI never shows an action the API
// would refuse.
// ---------------------------------------------------------------------------
export const getMyOrgAccess = async (req, res) => {
  try {
    const orgId = req.params.id || req.params.orgId;
    if (!mongoose.Types.ObjectId.isValid(orgId)) return notFound(res, "Organization not found");
    const org = await TeamOrganization.findById(orgId).select("name shortName slug logoUrl type isActive verificationStatus");
    if (!org) return notFound(res, "Organization not found");

    const membership = await Membership.findOne({
      organization: orgId,
      user: req.user._id,
      status: "active",
    }).lean();

    const platform = isPlatformAdmin(req);
    if (!membership && !platform) {
      return res.status(403).json({
        message: "You are not a member of this organization.",
        code: "ORG_MEMBERSHIP_REQUIRED",
      });
    }

    const roles = membership?.roles || [];
    res.status(200).json({
      organization: org,
      roles,
      permissions: platform ? permissionsForRoles(["owner"]) : permissionsForRoles(roles),
      isPlatformAdmin: platform,
      isMember: Boolean(membership),
      grantableRoles: grantableRoles(roles),
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to load your access", error: error.message });
  }
};

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------
export const listOrgMembers = async (req, res) => {
  try {
    const { page, limit, role, search } = req.query;
    const result = await listMembers(req.params.id || req.params.orgId, { page, limit, role, search });
    res.status(200).json({
      ...result,
      items: result.items.map(memberSummary),
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch members", error: error.message });
  }
};

/**
 * Direct add for an account that already exists AND has verified its identity.
 * The invitation flow is the default because it works for people who have not
 * signed up yet. The account can be found by email or by phone.
 */
export const addOrgMember = async (req, res) => {
  try {
    const org = req.org;
    const actorRoles = req.orgAccess?.roles || [];
    const requested = normalizeRoles(req.body.roles);
    const roles = rolesForGrant(actorRoles, requested);

    if (roles.length !== requested.length) {
      return res.status(403).json({
        message: "Only an owner can grant owner or admin roles.",
        code: "PRIVILEGED_ROLE_FORBIDDEN",
      });
    }

    const email = lower(req.body.email);
    const rawPhone = String(req.body.phone || "").trim();
    const phone = rawPhone ? normalizePhone(rawPhone) : "";
    if (rawPhone && !phone) {
      return res.status(400).json({ message: "Please use a valid phone number", code: "INVALID_PHONE" });
    }
    const clause = addressClause({ email, phone });
    if (!clause) {
      return res.status(400).json({
        message: "An email address or a phone number is required",
        code: "ADDRESS_REQUIRED",
      });
    }

    const invitee = await User.findOne(clause);
    if (!invitee) {
      return res.status(404).json({
        message: "No account exists with that email address or phone number. Send an invitation instead.",
        code: "USER_NOT_FOUND",
      });
    }
    if (invitee.status === "suspended") {
      return res.status(409).json({ message: "That account is suspended.", code: "ACCOUNT_SUSPENDED" });
    }
    if (!isIdentityVerified(invitee)) {
      return res.status(422).json({
        message: "That account has not verified its email or phone yet. Send an invitation instead.",
        code: "EMAIL_NOT_VERIFIED",
      });
    }
    if (org.owner && org.owner.equals(invitee._id)) {
      return res.status(400).json({ message: "The owner is already part of this organization.", code: "OWNER_IS_MEMBER" });
    }

    const existing = await Membership.findOne({ organization: org._id, user: invitee._id });
    if (existing && existing.status === "active") {
      return res.status(409).json({ message: "That account is already a member.", code: "ALREADY_MEMBER" });
    }

    const membership = await upsertMembership({
      organization: org._id,
      user: invitee._id,
      roles,
      invitedBy: req.user._id,
      source: "direct",
      req,
    });

    await recordAudit({
      req,
      organization: org._id,
      action: "member.added_directly",
      targetType: "user",
      targetId: invitee._id,
      targetLabel: displayAddress({ email: invitee.email, phone: invitee.phone }),
      metadata: { roles },
    });

    res.status(201).json({
      message: `${invitee.name} is now a ${roleLabels(roles)}.`,
      member: memberSummary({ ...membership.toObject(), user: invitee }),
    });
  } catch (error) {
    handleServiceError(res, error, "Failed to add member");
  }
};

export const updateOrgMemberRoles = async (req, res) => {
  try {
    const org = req.org;
    const actorRoles = req.orgAccess?.roles || [];
    const targetUserId = req.params.userId;
    if (!mongoose.Types.ObjectId.isValid(targetUserId)) return notFound(res, "Member not found");

    try {
      assertNoSelfEscalation(req.user?._id, targetUserId);
    } catch (error) {
      if (error instanceof OrgAccessError) {
        return res.status(error.status).json({ message: error.message, code: error.code });
      }
      throw error;
    }

    const requested = normalizeRoles(req.body.roles);
    const roles = rolesForGrant(actorRoles, requested);
    if (roles.length !== requested.length) {
      return res.status(403).json({
        message: "Only an owner can grant owner or admin roles.",
        code: "PRIVILEGED_ROLE_FORBIDDEN",
      });
    }

    const membership = await getMembership(org._id, targetUserId);
    if (!membership || membership.status !== "active") {
      return notFound(res, "Member not found");
    }
    if (org.owner && org.owner.equals(membership.user)) {
      return res.status(400).json({
        message: "The founding owner's roles are fixed. Transfer ownership to change them.",
        code: "OWNER_ROLE_FIXED",
      });
    }

    const before = [...(membership.roles || [])];
    const updated = await upsertMembership({
      organization: org._id,
      user: membership.user,
      roles,
      invitedBy: membership.invitedBy,
      source: membership.source,
      req,
    });

    res.status(200).json({
      message: "Roles updated.",
      from: before,
      member: memberSummary({ ...updated.toObject(), user: membership.user }),
    });
  } catch (error) {
    handleServiceError(res, error, "Failed to update member roles");
  }
};

export const removeOrgMember = async (req, res) => {
  try {
    const org = req.org;
    const targetUserId = req.params.userId;
    if (!mongoose.Types.ObjectId.isValid(targetUserId)) return notFound(res, "Member not found");

    if (org.owner && org.owner.equals(targetUserId)) {
      return res.status(400).json({
        message: "The owner cannot be removed. Transfer ownership first.",
        code: "OWNER_CANNOT_BE_REMOVED",
      });
    }

    const membership = await getMembership(org._id, targetUserId);
    if (!membership || membership.status !== "active") return notFound(res, "Member not found");

    // A member without manage_members may only remove themselves (leave).
    const canManage = req.orgAccess?.via === "platform_admin" || roleHasPermission(req.orgAccess?.roles || [], "manage_members");
    if (!canManage && String(membership.user) !== String(req.user._id)) {
      return res.status(403).json({
        message: "You do not have permission to remove other members.",
        code: "ORG_PERMISSION_DENIED",
        requiredPermission: "manage_members",
      });
    }

    await removeMembership({ membership, req });
    res.status(200).json({ message: "Member removed." });
  } catch (error) {
    handleServiceError(res, error, "Failed to remove member");
  }
};

/** Promote a member to owner / hand over ownership. Owner-only, self-exempt. */
export const transferOwnership = async (req, res) => {
  try {
    const org = req.org;
    const targetUserId = req.params.userId;
    if (!mongoose.Types.ObjectId.isValid(targetUserId)) return notFound(res, "Member not found");

    try {
      assertNoSelfEscalation(req.user?._id, targetUserId);
    } catch (error) {
      if (error instanceof OrgAccessError) {
        return res.status(error.status).json({ message: error.message, code: error.code });
      }
      throw error;
    }

    const target = await getMembership(org._id, targetUserId);
    if (!target || target.status !== "active") {
      return res.status(404).json({ message: "That person must be an active member before they can become owner.", code: "MEMBER_NOT_FOUND" });
    }

    const actorMembership = await getMembership(org._id, req.user._id);
    const previousOwnerUserId = org.owner;

    // The previous owner stays a member as an admin so the org never loses a
    // manager, and the "at least one owner" invariant still holds afterwards.
    if (previousOwnerUserId && String(previousOwnerUserId) !== String(targetUserId)) {
      const previous = await getMembership(org._id, previousOwnerUserId);
      if (previous && previous.status === "active") {
        previous.roles = normalizeRoles([
          ...(previous.roles || []).filter((role) => role !== "owner"),
          "admin",
        ]);
        await previous.save();
      }
    }

    const promoted = await upsertMembership({
      organization: org._id,
      user: target.user,
      roles: [...normalizeRoles(target.roles).filter((r) => r !== "admin"), "owner"],
      invitedBy: target.invitedBy,
      source: target.source,
      req,
    });

    org.owner = target.user;
    await org.save();

    await recordAudit({
      req,
      organization: org._id,
      action: "org.ownership_transferred",
      targetType: "user",
      targetId: target.user,
      targetLabel: String(target.user),
      metadata: { previousOwner: previousOwnerUserId ? String(previousOwnerUserId) : null },
    });

    res.status(200).json({
      message: "Ownership transferred.",
      member: memberSummary({ ...promoted.toObject(), user: target.user }),
    });
  } catch (error) {
    handleServiceError(res, error, "Failed to transfer ownership");
  }
};

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------
export const listOrgInvitations = async (req, res) => {
  try {
    const orgId = req.params.id || req.params.orgId;
    const { page, limit, status } = req.query;
    const safePage = Math.max(Number(page) || 1, 1);
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const query = { organization: orgId };
    if (status) query.status = status;

    const [items, total] = await Promise.all([
      Invitation.find(query)
        .populate("inviter", "name email phone")
        .populate("invitee", "name email phone")
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean(),
      Invitation.countDocuments(query),
    ]);

    res.status(200).json({
      // `channel` exists so the roster view can label a phone-only invitation
      // without every caller re-deriving the "phone wins when there is no
      // email" rule.
      items: items.map((inv) => ({ ...inv, tokenHash: undefined, channel: invitationChannel(inv) })),
      total,
      page: safePage,
      limit: safeLimit,
      pages: Math.max(Math.ceil(total / safeLimit), 1),
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch invitations", error: error.message });
  }
};

export const createOrgInvitation = async (req, res) => {
  try {
    const org = req.org;
    const actorRoles = req.orgAccess?.roles || [];
    const requested = normalizeRoles(req.body.roles);
    const roles = rolesForGrant(actorRoles, requested);
    if (roles.length !== requested.length) {
      return res.status(403).json({
        message: "Only an owner can invite people as owner or admin.",
        code: "PRIVILEGED_ROLE_FORBIDDEN",
      });
    }
    if (roles.includes("owner")) {
      return res.status(403).json({
        message: "Ownership is transferred separately, never granted by invitation.",
        code: "PRIVILEGED_ROLE_FORBIDDEN",
      });
    }

    const email = lower(req.body.email);
    const rawPhone = String(req.body.phone || "").trim();
    const phone = rawPhone ? normalizePhone(rawPhone) : "";
    if (rawPhone && !phone) {
      return res.status(400).json({
        message: "Please use a valid phone number",
        code: "INVALID_PHONE",
      });
    }
    if (!email && !phone) {
      return res.status(400).json({
        message: "An email address or a phone number is required",
        code: "ADDRESS_REQUIRED",
      });
    }
    const address = { email, phone };
    const addressedTo = displayAddress(address);

    if (org.owner) {
      const ownerUser = await User.findById(org.owner).select("email phone");
      if (
        ownerUser &&
        ((email && lower(ownerUser.email) === email) ||
          (phone && ownerUser.phone && ownerUser.phone === phone))
      ) {
        return res.status(400).json({ message: "The owner is already part of this organization.", code: "OWNER_IS_MEMBER" });
      }
    }

    const existingMember = await findActiveMemberByAddress(org._id, address);
    if (existingMember) {
      return res.status(409).json({ message: "That account is already a member.", code: "ALREADY_MEMBER" });
    }

    // One open invitation per address per organization: re-inviting the same
    // address refreshes the pending row instead of stacking a second one in
    // the inbox. The scan is over this organization's pending rows so a phone
    // and an email address are matched with the same rule.
    const pending = await Invitation.find({ organization: org._id, status: "pending" });
    const existing = pending.find(
      (inv) => (email && inv.email === email) || (phone && inv.phone === phone)
    ) || null;

    // The invitee pointer is a convenience (it pre-links the row to a known
    // account); it is never an authorization decision — acceptance is gated on
    // the signed-in account owning a VERIFIED copy of the invited address.
    const knownAccounts = await findAccountsByAddress(address);
    const invitee = knownAccounts[0]?._id || null;

    const token = generateInvitationToken();
    let invitation;
    if (existing) {
      existing.roles = roles;
      existing.message = req.body.message || "";
      existing.tokenHash = hashInvitationToken(token);
      existing.expiresAt = getInvitationExpiry();
      existing.inviter = req.user._id;
      existing.invitee = invitee;
      existing.email = email;
      existing.phone = phone;
      existing.respondedAt = null;
      invitation = existing;
    } else {
      invitation = new Invitation({
        organization: org._id,
        inviter: req.user._id,
        invitee,
        email,
        phone,
        roles,
        message: req.body.message || "",
        tokenHash: hashInvitationToken(token),
        expiresAt: getInvitationExpiry(),
        status: "pending",
      });
    }

    try {
      await invitation.save();
    } catch (error) {
      // The two partial unique indexes are the last line of defence against a
      // concurrent re-invite racing past the scan above.
      if (error?.code === 11000) {
        return res.status(409).json({
          message: "That address already has a pending invitation in this organization.",
          code: "INVITATION_ADDRESS_CONFLICT",
        });
      }
      throw error;
    }

    await recordAudit({
      req,
      organization: org._id,
      action: "invitation.created",
      targetType: "invitation",
      targetId: invitation._id,
      targetLabel: addressedTo,
      metadata: { roles, channel: invitationChannel(invitation) },
    });

    // --- delivery -----------------------------------------------------------
    // Two independent channels, each reported only for the address the caller
    // actually supplied. A phone invite may ALSO be emailed to the invitee's
    // verified email as a convenience, but that bonus must stay invisible in
    // the response: reporting it would tell the caller that the number has an
    // account with an email on it.
    const link = `${FRONTEND_URL}/organization/invitations/${token}`;
    const expiresNote = `${Math.round((invitation.expiresAt - Date.now()) / 86400000)} day(s)`;
    const invitationLine =
      `${req.user.name} invited you to join "${org.name}" on CricAll as ${roleLabels(roles)}.`;
    const noteLine = req.body.message ? `${req.body.message}\n\n` : "";
    const verifyLine = phone && !email
      ? `You need a CricAll account with this phone number verified to accept.`
      : `You need a CricAll account registered with ${addressedTo} and a verified email address to accept.`;

    let smsDelivered = false;
    if (phone) {
      const sms = await sendSms({
        to: phone,
        text:
          `${invitationLine}\n${req.body.message ? `${req.body.message}\n` : ""}` +
          `Accept: ${link}\n${verifyLine} Expires in ${expiresNote}.`,
      });
      smsDelivered = sms.delivered;
    }

    let mailDelivered = false;
    const mailRecipient = email || (phone && invitee && knownAccounts[0]?.emailVerified ? knownAccounts[0].email : "");
    if (mailRecipient) {
      const mail = await sendMail({
        to: mailRecipient,
        subject: `You have been invited to join ${org.name} on CricAll`,
        text:
          `Hello,\n\n` +
          `${invitationLine}\n\n` +
          `${noteLine}` +
          `Accept the invitation:\n${link}\n\n` +
          `${verifyLine}\n` +
          `This invitation expires in ${expiresNote}.\n`,
      });
      // Only a caller-supplied email is reported as a delivery channel.
      mailDelivered = Boolean(email) && mail.delivered;
    }

    // `delivered` only ever reflects the channels the caller addressed, so the
    // answer cannot hint at whether a phone number has an account behind it.
    const delivered = Boolean(email && mailDelivered) || Boolean(phone && smsDelivered);
    const message = delivered
      ? `Invitation sent to ${addressedTo}.`
      : `Invitation created for ${addressedTo}, but it could not be delivered there. It will appear in their CricAll inbox after they sign in and verify this address.`;

    res.status(201).json({
      message,
      invitation: { ...invitation.toObject(), tokenHash: undefined },
      mailDelivered,
      smsDelivered,
      delivered,
      channel: invitationChannel(invitation),
    });
  } catch (error) {
    handleServiceError(res, error, "Failed to create invitation");
  }
};

export const revokeOrgInvitation = async (req, res) => {
  try {
    const org = req.org;
    const invitation = await Invitation.findOne({
      _id: req.params.invitationId,
      organization: org._id,
    });
    if (!invitation) return notFound(res, "Invitation not found");
    if (invitation.status !== "pending") {
      return res.status(409).json({
        message: `That invitation is already ${invitation.status}.`,
        code: "INVITATION_NOT_PENDING",
      });
    }

    invitation.status = "revoked";
    invitation.respondedAt = new Date();
    await invitation.save();

    await recordAudit({
      req,
      organization: org._id,
      action: "invitation.revoked",
      targetType: "invitation",
      targetId: invitation._id,
      targetLabel: invitationAddress(invitation),
    });

    res.status(200).json({ message: "Invitation revoked." });
  } catch (error) {
    res.status(500).json({ message: "Failed to revoke invitation", error: error.message });
  }
};

/**
 * The signed-in user's invitation inbox.
 *
 * Visibility is keyed on VERIFIED identifiers only: an invitation sent to a
 * phone number shows up here only for an account that has verified that phone,
 * and an email invitation only for a verified email. Guessing (or owning an
 * unverified copy of) the address is not enough to read somebody else's
 * invitation.
 */
export const listMyInvitations = async (req, res) => {
  try {
    const clauses = [];
    if (req.user?.emailVerified === true && req.user.email) {
      clauses.push({ email: lower(req.user.email) });
    }
    if (req.user?.phoneVerified === true && req.user.phone) {
      clauses.push({ phone: req.user.phone });
    }

    if (!clauses.length) {
      // Nothing on this account is verified, so nothing can be addressed to it.
      return res.status(200).json([]);
    }

    const invitations = await Invitation.find({
      $or: clauses,
      status: "pending",
    })
      .populate("organization", "name shortName slug logoUrl")
      .populate("inviter", "name")
      .sort({ createdAt: -1 })
      .lean();

    const visible = invitations.filter((inv) => !isInvitationExpired(inv.expiresAt));
    for (const inv of invitations) {
      if (isInvitationExpired(inv.expiresAt)) {
        await Invitation.updateOne({ _id: inv._id }, { status: "expired" });
      }
    }

    res.status(200).json(
      visible.map((inv) => ({
        _id: inv._id,
        organization: inv.organization,
        inviter: inv.inviter ? { _id: inv.inviter._id, name: inv.inviter.name } : null,
        roles: inv.roles,
        message: inv.message,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt,
        // Which of the caller's own verified identifiers this is addressed to —
        // echoing it is safe because the inbox only matches verified ones.
        channel: invitationChannel(inv),
        addressedTo: invitationAddress(inv),
      }))
    );
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch your invitations", error: error.message });
  }
};

/** Resolve a raw token to the invitation payload (used by the accept page). */
export const previewInvitation = async (req, res) => {
  try {
    const token = String(req.params.token || "");
    if (token.length < 16) return res.status(400).json({ message: "Invalid invitation link", code: "INVITATION_INVALID" });

    const invitation = await Invitation.findOne({ tokenHash: hashInvitationToken(token) })
      .populate("organization", "name shortName slug logoUrl")
      .populate("inviter", "name")
      .lean();

    if (!invitation || invitation.status !== "pending" || isInvitationExpired(invitation.expiresAt)) {
      return res.status(410).json({
        message: "This invitation is no longer valid.",
        code: "INVITATION_INVALID",
      });
    }

    const forAccount = matchesInvitationAddress(req.user, invitation, { requireVerified: false });
    const identityOk = matchesInvitationAddress(req.user, invitation, { requireVerified: true });

    res.status(200).json({
      organization: invitation.organization,
      inviter: invitation.inviter ? { _id: invitation.inviter._id, name: invitation.inviter.name } : null,
      roles: invitation.roles,
      message: invitation.message,
      // "Is this invitation for the account looking at it?" — address match
      // only. Nothing about the invited address is echoed back when it is NOT
      // the caller's, or a stranger with a leaked link would learn it.
      forAccount,
      // Same rule as the acceptance gate: the identifier this invitation is
      // addressed to must be verified on this account. The field name is kept
      // because the invitation UI reads `emailVerified`.
      emailVerified: identityOk,
      channel: forAccount ? invitationChannel(invitation) : null,
      expiresAt: invitation.expiresAt,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to load invitation", error: error.message });
  }
};

/**
 * The invitation inbox lists invitations by id, not by token, so accepting from
 * there needs an id-based entry point. This is not a way around the checks: the
 * raw token is only ever an extra secret, the actual authorization is "the
 * signed-in account owns a VERIFIED copy of the invited address", and that is
 * enforced identically whether the caller arrives with a token or an id.
 *
 * `requireIdentity: false` is used by the decline paths — declining your own
 * invitation should not demand a verification step first.
 */
const loadInvitationForActor = async (req, selector, { requireIdentity = true } = {}) => {
  const invitation = await Invitation.findOne(selector);
  if (!invitation) return { status: 410, body: { message: "This invitation is no longer valid.", code: "INVITATION_INVALID" } };

  if (invitation.status !== "pending") {
    return { status: 410, body: { message: `This invitation is already ${invitation.status}.`, code: "INVITATION_INVALID" } };
  }
  if (isInvitationExpired(invitation.expiresAt)) {
    invitation.status = "expired";
    await invitation.save();
    return { status: 410, body: { message: "This invitation has expired.", code: "INVITATION_EXPIRED" } };
  }
  if (!matchesInvitationAddress(req.user, invitation, { requireVerified: false })) {
    const channel = invitationChannel(invitation);
    return {
      status: 403,
      body: {
        message:
          channel === "phone"
            ? "This invitation was sent to a different phone number. Sign in with that account to accept it."
            : "This invitation was sent to a different email address. Sign in with that account to accept it.",
        code: invitationMismatchCode(invitation),
      },
    };
  }
  if (requireIdentity && !matchesInvitationAddress(req.user, invitation, { requireVerified: true })) {
    const channel = invitationChannel(invitation);
    return {
      status: 403,
      body: {
        message:
          channel === "phone"
            ? "Verify your phone number before accepting an invitation sent to it, then reload this page."
            : "Verify your email address before accepting an invitation sent to it, then reload this page.",
        code: "EMAIL_NOT_VERIFIED",
      },
    };
  }
  return { invitation };
};

/** Shared by the token and the id entry points. */
const completeAcceptance = async (req, res, invitation) => {
  // Defense in depth: the loader already proved the address matches AND that
  // the matching identifier is verified. Re-assert it here so no future caller
  // can reach the membership write without both checks.
  if (!matchesInvitationAddress(req.user, invitation, { requireVerified: false })) {
    return res.status(403).json({
      message: "This invitation was sent to a different address. Sign in with that account to accept it.",
      code: invitationMismatchCode(invitation),
    });
  }
  if (!matchesInvitationAddress(req.user, invitation, { requireVerified: true })) {
    return res.status(403).json({
      message: "Verify your email address or phone number before accepting an invitation.",
      code: "EMAIL_NOT_VERIFIED",
    });
  }
  if (invitation.roles.includes("owner")) {
    return res.status(403).json({
      message: "This invitation grants a privileged role and must be approved by an owner.",
      code: "PRIVILEGED_ROLE_FORBIDDEN",
    });
  }

  const existing = await Membership.findOne({
    organization: invitation.organization,
    user: req.user._id,
  });
  if (existing && existing.status === "active") {
    invitation.status = "accepted";
    invitation.respondedAt = new Date();
    await invitation.save();
    return res.status(409).json({ message: "You are already a member of this organization.", code: "ALREADY_MEMBER" });
  }

  const membership = await upsertMembership({
    organization: invitation.organization,
    user: req.user._id,
    roles: invitation.roles,
    invitedBy: invitation.inviter,
    source: "invitation",
    req,
  });

  invitation.status = "accepted";
  invitation.respondedAt = new Date();
  invitation.invitee = req.user._id;
  await invitation.save();

  await recordAudit({
    req,
    organization: invitation.organization,
    action: "invitation.accepted",
    targetType: "invitation",
    targetId: invitation._id,
    targetLabel: invitationAddress(invitation),
    metadata: { roles: invitation.roles },
  });

  const org = await TeamOrganization.findById(invitation.organization).select("name slug");
  res.status(200).json({
    message: `You joined ${org?.name || "the organization"}.`,
    organization: org,
    member: memberSummary({ ...membership.toObject(), user: req.user }),
  });
};

/** Shared by the token and the id entry points. */
const completeRejection = async (req, res, invitation) => {
  invitation.status = "rejected";
  invitation.respondedAt = new Date();
  await invitation.save();

  await recordAudit({
    req,
    organization: invitation.organization,
    action: "invitation.rejected",
    targetType: "invitation",
    targetId: invitation._id,
    targetLabel: invitationAddress(invitation),
  });

  res.status(200).json({ message: "Invitation declined." });
};

export const acceptOrgInvitationById = async (req, res) => {
  try {
    const result = await loadInvitationForActor(req, { _id: req.params.id });
    if (!result.invitation) return res.status(result.status).json(result.body);
    await completeAcceptance(req, res, result.invitation);
  } catch (error) {
    handleServiceError(res, error, "Failed to accept invitation");
  }
};

export const rejectOrgInvitationById = async (req, res) => {
  try {
    // Declining never demands verification — the address match alone proves
    // this account is the one the invitation was sent to.
    const result = await loadInvitationForActor(req, { _id: req.params.id }, { requireIdentity: false });
    if (!result.invitation) return res.status(result.status).json(result.body);
    await completeRejection(req, res, result.invitation);
  } catch (error) {
    handleServiceError(res, error, "Failed to decline invitation");
  }
};

export const acceptOrgInvitation = async (req, res) => {
  try {
    const token = String(req.body.token || "");
    if (token.length < 16) {
      return res.status(400).json({ message: "Invalid invitation link", code: "INVITATION_INVALID" });
    }
    // Kept ahead of the lookup so an unverified account is told to verify
    // before it learns anything about whether the token exists.
    if (!isIdentityVerified(req.user)) {
      return res.status(403).json({
        message: "Verify your email address or phone number before accepting an invitation.",
        code: "EMAIL_NOT_VERIFIED",
      });
    }

    const result = await loadInvitationForActor(req, { tokenHash: hashInvitationToken(token) });
    if (!result.invitation) return res.status(result.status).json(result.body);
    await completeAcceptance(req, res, result.invitation);
  } catch (error) {
    handleServiceError(res, error, "Failed to accept invitation");
  }
};

export const rejectOrgInvitation = async (req, res) => {
  try {
    const token = String(req.body.token || "");
    if (token.length < 16) {
      return res.status(400).json({ message: "Invalid invitation link", code: "INVITATION_INVALID" });
    }
    const result = await loadInvitationForActor(req, { tokenHash: hashInvitationToken(token) }, { requireIdentity: false });
    if (!result.invitation) return res.status(result.status).json(result.body);
    await completeRejection(req, res, result.invitation);
  } catch (error) {
    res.status(500).json({ message: "Failed to decline invitation", error: error.message });
  }
};

// ---------------------------------------------------------------------------
// Audit log (organization owners read their own org; platform admins read all)
// ---------------------------------------------------------------------------
export const listOrgAuditLog = async (req, res) => {
  try {
    const isSupervisor = req.orgAccess?.via === "platform_admin";
    const organizationId = isSupervisor ? (req.query.organization || req.params.id || req.params.orgId) : (req.params.id || req.params.orgId);
    const safePage = Math.max(Number(req.query.page) || 1, 1);
    const safeLimit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

    const query = {};
    if (organizationId && mongoose.Types.ObjectId.isValid(organizationId)) {
      query.organization = organizationId;
    } else if (!isSupervisor) {
      return res.status(400).json({ message: "A valid organization id is required", code: "ORG_ID_REQUIRED" });
    }
    if (req.query.action) query.action = String(req.query.action).slice(0, 80);

    const [items, total] = await Promise.all([
      AuditLog.find(query)
        .populate("organization", "name shortName")
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean(),
      AuditLog.countDocuments(query),
    ]);

    res.status(200).json({
      items,
      total,
      page: safePage,
      limit: safeLimit,
      pages: Math.max(Math.ceil(total / safeLimit), 1),
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch audit log", error: error.message });
  }
};

/** Counts shown on the org dashboard header. */
export const getOrgOverview = async (req, res) => {
  try {
    const orgId = req.params.id || req.params.orgId;
    const [teamCount, memberCount, ownerCount, pendingInvitations] = await Promise.all([
      Team.countDocuments({ organizationRef: orgId, isActive: true }),
      Membership.countDocuments({ organization: orgId, status: "active" }),
      Membership.countDocuments({ organization: orgId, status: "active", roles: "owner" }),
      Invitation.countDocuments({ organization: orgId, status: "pending" }),
    ]);

    res.status(200).json({
      teamCount,
      memberCount,
      ownerCount,
      pendingInvitations,
      roles: req.orgAccess?.roles || [],
      permissions: req.orgAccess?.permissions || [],
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to load organization overview", error: error.message });
  }
};
