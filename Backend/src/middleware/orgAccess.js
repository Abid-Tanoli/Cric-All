import mongoose from "mongoose";
import TeamOrganization from "../models/TeamOrganization.js";
import Membership from "../models/Membership.js";
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  isOrgAdminRole,
  permissionsForRoles,
  roleHasPermission,
} from "../permissions/orgPermissions.js";

// Platform supervision: Admin-collection principals and admin/superadmin users
// keep full control over every organization (the Admin app is supervisory).
// Every write they make goes through an audited path — see recordAudit() —
// so supervision is visible in the org's own audit log rather than silent.
export function isPlatformAdmin(req) {
  if (req?.principalType === "admin") return true;
  return req?.user?.role === "admin" || req?.user?.role === "superadmin";
}

// Routes are mounted in two shapes: /organizations/:id/... and
// /organizations/:orgId/teams/... — accept either.
export function orgIdFromReq(req) {
  return req?.params?.orgId || req?.params?.id || null;
}

/**
 * Full access picture for one (user, organization) pair.
 * Returns nulls rather than throwing so callers can pick their own 403 shape.
 */
export async function resolveOrgAccess(org, user) {
  if (!org || !user?._id) {
    return { membership: null, roles: [], permissions: [] };
  }
  const membership = await Membership.findOne({
    organization: org._id,
    user: user._id,
    status: "active",
  }).lean();

  if (!membership) {
    return { membership: null, roles: [], permissions: [] };
  }
  const roles = membership.roles || [];
  return { membership, roles, permissions: permissionsForRoles(roles) };
}

export function accessSummary(access) {
  return {
    roles: access?.roles || [],
    permissions: access?.permissions || [],
    isOwner: (access?.roles || []).includes("owner"),
    isOrgAdmin: isOrgAdminRole(access?.roles || []),
  };
}

/** True when the user currently holds an active membership in the org. */
export async function hasActiveMembership(organizationId, userId) {
  if (!mongoose.Types.ObjectId.isValid(organizationId) || !userId) return false;
  const found = await Membership.exists({
    organization: organizationId,
    user: userId,
    status: "active",
  });
  return Boolean(found);
}

export async function listMembershipsForUser(userId) {
  return Membership.find({ user: userId, status: "active" }).lean();
}

// POST /organizations — platform admins, or verified users who signed up as
// organization admins. Everything else (players, handlers, viewers) is
// rejected with ORG_ADMIN_REQUIRED.
export const requireOrgAdminType = (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Not authorized" });
  if (isPlatformAdmin(req)) return next();
  if (req.principalType === "user" && req.user.accountType === "organization_admin") return next();
  return res.status(403).json({
    message: "Only organization admins can create organizations.",
    code: "ORG_ADMIN_REQUIRED",
  });
};

/**
 * Core guard. Resolves the organization, loads the caller's active membership
 * and enforces `permission` (pass null to require membership only — read
 * access). Sets `req.org` and `req.orgAccess` for the controller.
 */
export function requireOrgPermission(permission) {
  return orgPermissionGuard(permission ? [permission] : []);
}

function orgPermissionGuard(required) {
  return async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Not authorized" });

      const orgId = orgIdFromReq(req);
      if (!orgId || !mongoose.Types.ObjectId.isValid(orgId)) {
        return res.status(404).json({ message: "Organization not found" });
      }

      const org = await TeamOrganization.findById(orgId);
      if (!org) return res.status(404).json({ message: "Organization not found" });

      if (isPlatformAdmin(req)) {
        req.org = org;
        req.orgAccess = {
          via: "platform_admin",
          membership: null,
          roles: [],
          permissions: [...ALL_PERMISSIONS],
        };
        return next();
      }

      const access = await resolveOrgAccess(org, req.user);
      if (!access.membership) {
        return res.status(403).json({
          message: "You are not a member of this organization.",
          code: "ORG_MEMBERSHIP_REQUIRED",
        });
      }

      if (required.length && !required.some((p) => roleHasPermission(access.roles, p))) {
        return res.status(403).json({
          message: "Your role in this organization does not allow this action.",
          code: "ORG_PERMISSION_DENIED",
          requiredPermission: required.length === 1 ? required[0] : required,
        });
      }

      req.org = org;
      req.orgAccess = { via: "membership", ...access };
      return next();
    } catch (err) {
      return res.status(500).json({ message: "Failed to check organization access" });
    }
  };
}

/**
 * Passes when the member holds *any* of the listed permissions.
 *
 * Needed because some reads are a prerequisite of an unrelated write: to
 * schedule a fixture you must be able to see which teams this organization owns
 * and who is on their roster, but a fixture manager (create_match) is not
 * necessarily a team manager (manage_teams). Demanding manage_teams for that
 * read would make "manage matches" unusable for exactly the roles it is for.
 */
export function requireAnyOrgPermission(...permissions) {
  return orgPermissionGuard(permissions);
}

// Any active member of the organization (read-level access).
export const requireOrgMembership = requireOrgPermission(null);

// Backwards-compatible alias: manage_org is what "owner or admin" used to mean.
export const requireOrgWrite = requireOrgPermission(PERMISSIONS.MANAGE_ORG);

/** Requires the literal `owner` role — used for role grants and ownership. */
export const requireOrgOwner = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ message: "Not authorized" });

    const orgId = orgIdFromReq(req);
    if (!orgId || !mongoose.Types.ObjectId.isValid(orgId)) {
      return res.status(404).json({ message: "Organization not found" });
    }

    const org = await TeamOrganization.findById(orgId);
    if (!org) return res.status(404).json({ message: "Organization not found" });

    if (isPlatformAdmin(req)) {
      req.org = org;
      req.orgAccess = { via: "platform_admin", membership: null, roles: [], permissions: [...ALL_PERMISSIONS] };
      return next();
    }

    const access = await resolveOrgAccess(org, req.user);
    if (!access.membership || !access.roles.includes("owner")) {
      return res.status(403).json({
        message: "Only an organization owner can do this.",
        code: "ORG_OWNER_REQUIRED",
      });
    }

    req.org = org;
    req.orgAccess = { via: "membership", ...access };
    return next();
  } catch (err) {
    return res.status(500).json({ message: "Failed to check organization access" });
  }
};

export default {
  isPlatformAdmin,
  orgIdFromReq,
  resolveOrgAccess,
  accessSummary,
  hasActiveMembership,
  listMembershipsForUser,
  requireOrgAdminType,
  requireOrgPermission,
  requireOrgMembership,
  requireOrgWrite,
  requireOrgOwner,
};
