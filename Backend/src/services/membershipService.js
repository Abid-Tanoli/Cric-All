import mongoose from "mongoose";
import Membership from "../models/Membership.js";
import TeamOrganization from "../models/TeamOrganization.js";
import { uniqueSlug } from "../utils/slug.js";
import {
  ORG_ROLES,
  permissionsForRoles,
  sanitizeRequestedRoles,
} from "../permissions/orgPermissions.js";
import { recordAudit, SYSTEM_ACTOR } from "../utils/audit.js";

export class OrgAccessError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const OID = (value) =>
  value && mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(String(value)) : value;

export function normalizeRoles(roles) {
  if (!Array.isArray(roles)) return [];
  return [...new Set(roles.filter((role) => ORG_ROLES.includes(role)))];
}

/** Free, unique public slug for a new organization. */
export async function generateOrgSlug(name, excludeId = null) {
  return uniqueSlug(name, async (candidate) => {
    const query = { slug: candidate };
    if (excludeId) query._id = { $ne: OID(excludeId) };
    return Boolean(await TeamOrganization.exists(query));
  });
}

export async function getMembership(organizationId, userId) {
  if (!mongoose.Types.ObjectId.isValid(organizationId) || !userId) return null;
  return Membership.findOne({
    organization: OID(organizationId),
    user: userId,
  });
}

/** Active memberships carrying the literal `owner` role. */
export async function listOwners(organizationId) {
  return Membership.find({
    organization: OID(organizationId),
    status: "active",
    roles: "owner",
  }).lean();
}

export async function countActiveOwners(organizationId, { excludeUser = null } = {}) {
  const query = {
    organization: OID(organizationId),
    status: "active",
    roles: "owner",
  };
  if (excludeUser) query.user = { $ne: OID(excludeUser) };
  return Membership.countDocuments(query);
}

/**
 * Reject any change that would leave the organization with no owner.
 * `nextRoles` is null when the membership is being removed entirely.
 */
export async function assertNotLastOwner({ membership, nextRoles, action = "change" }) {
  if (!membership?.roles?.includes("owner")) return;
  if (nextRoles === null || !normalizeRoles(nextRoles).includes("owner")) {
    const remaining = await countActiveOwners(membership.organization, {
      excludeUser: membership.user,
    });
    if (remaining === 0) {
      throw new OrgAccessError(
        400,
        "LAST_OWNER_PROTECTED",
        "An organization must always have at least one owner. Promote another member to owner first."
      );
    }
  }
  void action;
}

/**
 * Create (or reactivate) a membership. Honours the compound unique index by
 * updating an existing row instead of inserting a second one.
 */
export async function upsertMembership({
  organization,
  user,
  roles,
  invitedBy = null,
  source = "direct",
  req = null,
}) {
  const finalRoles = normalizeRoles(roles);
  if (finalRoles.length === 0) finalRoles.push("player");

  const existing = await Membership.findOne({ organization: OID(organization), user });
  let membership;

  if (existing) {
    const before = existing.roles || [];
    if (before.includes("owner") && !finalRoles.includes("owner")) {
      await assertNotLastOwner({ membership: existing, nextRoles: finalRoles, action: "demote" });
    }
    existing.roles = finalRoles;
    existing.status = "active";
    existing.removedAt = null;
    if (invitedBy) existing.invitedBy = invitedBy;
    existing.source = source;
    existing.joinedAt = new Date();
    await existing.save();
    membership = existing;
    await recordAudit({
      req,
      organization: OID(organization),
      action: "membership.roles_changed",
      targetType: "membership",
      targetId: membership._id,
      targetLabel: String(user),
      metadata: { from: before, to: finalRoles },
    });
  } else {
    membership = await Membership.create({
      organization: OID(organization),
      user,
      roles: finalRoles,
      invitedBy,
      source,
      status: "active",
      joinedAt: new Date(),
    });
    await recordAudit({
      req,
      organization: OID(organization),
      action: "membership.added",
      targetType: "membership",
      targetId: membership._id,
      targetLabel: String(user),
      metadata: { roles: finalRoles, source },
    });
  }

  // Keep the deprecated org.members[] array in step so the Admin app's older
  // read path keeps rendering. Membership stays the source of truth.
  await syncLegacyMembersArray(membership.organization);
  return membership;
}

export async function removeMembership({ membership, req = null, actor = null }) {
  await assertNotLastOwner({ membership, nextRoles: null, action: "remove" });
  const organizationId = membership.organization;
  membership.status = "removed";
  membership.removedAt = new Date();
  membership.roles = [];
  await membership.save();
  await recordAudit({
    req,
    actor: actor || undefined,
    organization: organizationId,
    action: "membership.removed",
    targetType: "membership",
    targetId: membership._id,
    targetLabel: String(membership.user),
  });
  await syncLegacyMembersArray(organizationId);
  return membership;
}

/** Recomputes TeamOrganization.members[] from the authoritative Membership rows. */
export async function syncLegacyMembersArray(organizationId) {
  const memberships = await Membership.find({
    organization: OID(organizationId),
    status: "active",
  })
    .select("user roles")
    .lean();

  const members = memberships
    .filter((m) => !(m.roles || []).includes("owner"))
    .map((m) => ({
      user: m.user,
      role: (m.roles || []).some((r) => ["owner", "admin", "manager"].includes(r)) ? "admin" : "member",
      joinedAt: new Date(),
    }));

  await TeamOrganization.updateOne(
    { _id: OID(organizationId) },
    { $set: { members } }
  );
}

/** Roles a caller may grant, filtered by the caller's own privileges. */
export function rolesForGrant(actorRoles, requested) {
  return sanitizeRequestedRoles(requested, actorRoles);
}

export function assertNoSelfEscalation(actorUserId, targetUserId) {
  if (actorUserId && targetUserId && String(actorUserId) === String(targetUserId)) {
    throw new OrgAccessError(
      403,
      "SELF_ROLE_CHANGE_FORBIDDEN",
      "You cannot change your own roles. Ask another owner.",
    );
  }
}

export async function listMembers(organizationId, { page = 1, limit = 50, role = "", search = "" } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safePage = Math.max(Number(page) || 1, 1);

  const query = { organization: OID(organizationId), status: "active" };
  if (role) query.roles = role;

  if (search) {
    const escaped = String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matching = await Membership.find({ ...query, user: { $exists: true } })
      .populate("user", "name email phone accountType")
      .lean();
    const hits = matching.filter((m) => {
      const needle = escaped.toLowerCase();
      // Phone-only accounts have no email, so a name-or-email search would
      // make them unfindable in their own organization's roster. The digits of
      // the query are compared against the digits on file, so "+92 300 1234"
      // finds "923001234" regardless of how the roster row was written.
      const searchDigits = escaped.replace(/\D/g, "");
      const phoneDigits = String(m.user?.phone || "").replace(/\D/g, "");
      return (
        (m.user?.name || "").toLowerCase().includes(needle) ||
        (m.user?.email || "").toLowerCase().includes(needle) ||
        (searchDigits.length >= 3 && phoneDigits.includes(searchDigits))
      );
    });
    const ids = hits.map((m) => m._id);
    const total = hits.length;
    const items = hits.slice((safePage - 1) * safeLimit, safePage * safeLimit);
    return { items, total, page: safePage, limit: safeLimit, pages: Math.max(Math.ceil(total / safeLimit), 1) };
  }

  const [items, total] = await Promise.all([
    Membership.find(query)
      .populate("user", "name email phone accountType emailVerified phoneVerified")
      .populate("invitedBy", "name email")
      .sort({ createdAt: 1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    Membership.countDocuments(query),
  ]);

  return {
    items,
    total,
    page: safePage,
    limit: safeLimit,
    pages: Math.max(Math.ceil(total / safeLimit), 1),
  };
}

export function memberSummary(membership) {
  const roles = normalizeRoles(membership.roles);
  return {
    _id: membership._id,
    user: membership.user
      ? {
          _id: membership.user._id,
          name: membership.user.name,
          email: membership.user.email,
          phone: membership.user.phone || "",
          accountType: membership.user.accountType,
          emailVerified: membership.user.emailVerified,
          phoneVerified: membership.user.phoneVerified,
        }
      : null,
    roles,
    permissions: permissionsForRoles(roles),
    isOwner: roles.includes("owner"),
    status: membership.status,
    source: membership.source,
    invitedBy: membership.invitedBy
      ? { _id: membership.invitedBy._id, name: membership.invitedBy.name }
      : null,
    joinedAt: membership.joinedAt,
  };
}

export { OID, recordAudit, SYSTEM_ACTOR };
