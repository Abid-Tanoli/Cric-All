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

const notFound = (res, message = "Not found") => res.status(404).json({ message });

// OrgAccessError carries the right status/code; anything else from the service
// layer is a genuine bug and becomes a 500.
function handleServiceError(res, error, fallback) {
  if (error instanceof OrgAccessError) {
    return res.status(error.status).json({ message: error.message, code: error.code });
  }
  return res.status(500).json({ message: fallback, error: error.message });
}

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
 * Direct add for an account that already exists AND has verified its email.
 * The invitation flow is the default because it works for people who have not
 * signed up yet.
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

    const invitee = await User.findOne({ email: req.body.email });
    if (!invitee) {
      return res.status(404).json({
        message: "No account exists with that email address. Send an invitation instead.",
        code: "USER_NOT_FOUND",
      });
    }
    if (invitee.status === "suspended") {
      return res.status(409).json({ message: "That account is suspended.", code: "ACCOUNT_SUSPENDED" });
    }
    if (invitee.emailVerified !== true) {
      return res.status(422).json({
        message: "That account has not verified its email yet. Send an invitation instead.",
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
      targetLabel: invitee.email,
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
        .populate("inviter", "name email")
        .populate("invitee", "name email")
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean(),
      Invitation.countDocuments(query),
    ]);

    res.status(200).json({
      items: items.map((inv) => ({ ...inv, tokenHash: undefined })),
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

    const email = req.body.email;
    if (org.owner) {
      const ownerUser = await User.findById(org.owner).select("email");
      if (ownerUser && ownerUser.email === email) {
        return res.status(400).json({ message: "The owner is already part of this organization.", code: "OWNER_IS_MEMBER" });
      }
    }

    const existingMember = await Membership.findOne({
      organization: org._id,
      status: "active",
      user: { $in: await User.find({ email }).distinct("_id") },
    });
    if (existingMember) {
      return res.status(409).json({ message: "That account is already a member.", code: "ALREADY_MEMBER" });
    }

    // One open invitation per address: refresh the existing one.
    const token = generateInvitationToken();
    const existing = await Invitation.findOne({ organization: org._id, email, status: "pending" });
    let invitation;
    if (existing) {
      existing.roles = roles;
      existing.message = req.body.message || "";
      existing.tokenHash = hashInvitationToken(token);
      existing.expiresAt = getInvitationExpiry();
      existing.inviter = req.user._id;
      existing.invitee = (await User.findOne({ email }))?._id || null;
      existing.respondedAt = null;
      await existing.save();
      invitation = existing;
    } else {
      invitation = await Invitation.create({
        organization: org._id,
        inviter: req.user._id,
        invitee: (await User.findOne({ email }))?._id || null,
        email,
        roles,
        message: req.body.message || "",
        tokenHash: hashInvitationToken(token),
        expiresAt: getInvitationExpiry(),
        status: "pending",
      });
    }

    await recordAudit({
      req,
      organization: org._id,
      action: "invitation.created",
      targetType: "invitation",
      targetId: invitation._id,
      targetLabel: email,
      metadata: { roles },
    });

    const link = `${FRONTEND_URL}/organization/invitations/${token}`;
    const mail = await sendMail({
      to: email,
      subject: `You have been invited to join ${org.name} on CricAll`,
      text:
        `Hello,\n\n` +
        `${req.user.name} invited you to join "${org.name}" on CricAll as ${roleLabels(roles)}.\n\n` +
        `${req.body.message ? `${req.body.message}\n\n` : ""}` +
        `Accept the invitation:\n${link}\n\n` +
        `You need a CricAll account registered with ${email} and a verified email address to accept.\n` +
        `This invitation expires in ${Math.round((invitation.expiresAt - Date.now()) / 86400000)} day(s).\n`,
    });

    res.status(201).json({
      message: `Invitation sent to ${email}.`,
      invitation: { ...invitation.toObject(), tokenHash: undefined },
      mailDelivered: mail.delivered,
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
      targetLabel: invitation.email,
    });

    res.status(200).json({ message: "Invitation revoked." });
  } catch (error) {
    res.status(500).json({ message: "Failed to revoke invitation", error: error.message });
  }
};

/** The signed-in user's invitation inbox. */
export const listMyInvitations = async (req, res) => {
  try {
    const email = String(req.user.email || "").toLowerCase();
    const invitations = await Invitation.find({
      email,
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

    res.status(200).json({
      organization: invitation.organization,
      inviter: invitation.inviter ? { _id: invitation.inviter._id, name: invitation.inviter.name } : null,
      roles: invitation.roles,
      // The address is echoed so the invitee can see which of their accounts
      // the invitation belongs to — it is their own address, already known.
      forAccount: req.user ? String(req.user.email).toLowerCase() === invitation.email : false,
      emailVerified: req.user?.emailVerified === true,
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
 * signed-in, email-verified account matches the invited address", and that is
 * enforced identically below.
 */
const loadInvitationForActor = async (req, selector) => {
  const invitation = await Invitation.findOne(selector);
  if (!invitation) return { status: 410, body: { message: "This invitation is no longer valid.", code: "INVITATION_INVALID" } };

  if (invitation.status !== "pending") {
    return { status: 410, body: { message: `This invitation is already ${invitation.status}.`, code: "INVITATION_INVALID" } };
  }
  if (String(req.user.email).toLowerCase() !== invitation.email) {
    return {
      status: 403,
      body: {
        message: "This invitation was sent to a different email address. Sign in with that account to accept it.",
        code: "INVITATION_EMAIL_MISMATCH",
      },
    };
  }
  if (isInvitationExpired(invitation.expiresAt)) {
    invitation.status = "expired";
    await invitation.save();
    return { status: 410, body: { message: "This invitation has expired.", code: "INVITATION_EXPIRED" } };
  }
  return { invitation };
};

/** Shared by the token and the id entry points. */
const completeAcceptance = async (req, res, invitation) => {
  if (req.user.emailVerified !== true) {
    return res.status(403).json({
      message: "Verify your email address before accepting an invitation.",
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
    targetLabel: invitation.email,
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
    targetLabel: invitation.email,
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
    const result = await loadInvitationForActor(req, { _id: req.params.id });
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
    if (req.user.emailVerified !== true) {
      return res.status(403).json({
        message: "Verify your email address before accepting an invitation.",
        code: "EMAIL_NOT_VERIFIED",
      });
    }

    const invitation = await Invitation.findOne({ tokenHash: hashInvitationToken(token) });
    if (!invitation || invitation.status !== "pending") {
      return res.status(410).json({ message: "This invitation is no longer valid.", code: "INVITATION_INVALID" });
    }
    if (isInvitationExpired(invitation.expiresAt)) {
      invitation.status = "expired";
      await invitation.save();
      return res.status(410).json({ message: "This invitation has expired.", code: "INVITATION_EXPIRED" });
    }
    if (String(req.user.email).toLowerCase() !== invitation.email) {
      return res.status(403).json({
        message: "This invitation was sent to a different email address. Sign in with that account to accept it.",
        code: "INVITATION_EMAIL_MISMATCH",
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
      targetLabel: invitation.email,
      metadata: { roles: invitation.roles },
    });

    const org = await TeamOrganization.findById(invitation.organization).select("name slug");
    res.status(200).json({
      message: `You joined ${org?.name || "the organization"}.`,
      organization: org,
      member: memberSummary({ ...membership.toObject(), user: req.user }),
    });
  } catch (error) {
    handleServiceError(res, error, "Failed to accept invitation");
  }
};

export const rejectOrgInvitation = async (req, res) => {
  try {
    const token = String(req.body.token || "");
    const invitation = await Invitation.findOne({ tokenHash: hashInvitationToken(token) });
    if (!invitation || invitation.status !== "pending") {
      return res.status(410).json({ message: "This invitation is no longer valid.", code: "INVITATION_INVALID" });
    }
    if (String(req.user.email).toLowerCase() !== invitation.email) {
      return res.status(403).json({
        message: "This invitation was sent to a different email address.",
        code: "INVITATION_EMAIL_MISMATCH",
      });
    }

    invitation.status = "rejected";
    invitation.respondedAt = new Date();
    await invitation.save();

    await recordAudit({
      req,
      organization: invitation.organization,
      action: "invitation.rejected",
      targetType: "invitation",
      targetId: invitation._id,
      targetLabel: invitation.email,
    });

    res.status(200).json({ message: "Invitation declined." });
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
