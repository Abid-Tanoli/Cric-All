import mongoose from "mongoose";
import Match from "../models/Match.js";
import { PERMISSIONS, roleHasPermission } from "../permissions/orgPermissions.js";
import { isPlatformAdmin, resolveOrgAccess } from "./orgAccess.js";

// Phase 9: who may write to a match.
//
// The permission matrix has always carried `score_match` (owner, admin,
// manager, score_handler) and the UI labels those roles, but the scoring routes
// were mounted behind the platform-wide `requireAdmin`. That made the permission
// dead: an invited score handler was shown a role that could do nothing, and
// every `403 Admin role required` came from a check that ignored the tenant.
//
// The rule is now the same shape as every other organization write: the match
// carries its tenant in `organizationRef`, the caller's active Membership in
// *that* organization is what grants the right, and platform Admins keep
// supervisory access (audited, as everywhere else). A match with no
// `organizationRef` is a pre-Phase-6 fixture with no tenant, so it stays
// platform-admin-only rather than falling open.
//
// Two permissions, because "running the match" and "picking the squad" are
// different jobs:
//
//   SCORE_MATCH  ball-by-ball and the innings around it — /score, /field-click,
//                /edit-ball, /end-innings, /toss, /status, /mom. This is what
//                the `score_handler` role is for.
//   CREATE_MATCH squad composition — /playing-xi, /openers, /squad15,
//                /twelfth-man, /bowling-xi, /team-roles. This mirrors the
//                org-scoped `PUT /organizations/:id/matches/:matchId/squads`,
//                which has always been gated on CREATE_MATCH (see
//                `matchWrite` in organizationRoutes.js). A score_handler must
//                not be able to appoint captains and wicket-keepers.

/**
 * Resolve write access to one match against a specific org permission.
 *
 * Returns `{ allowed, via, reason, organization, requiredPermission }`. `via` is
 * one of platform_admin, membership (a role holding the permission) or none,
 * and is what the audit entry records so a later reader can tell which rule let
 * the call through.
 */
export async function resolveMatchAccess(
  req,
  match,
  requiredPermission = PERMISSIONS.SCORE_MATCH
) {
  if (!req?.user) return { allowed: false, via: "none", reason: "Not signed in" };

  if (isPlatformAdmin(req)) {
    return {
      allowed: true,
      via: "platform_admin",
      organization: match?.organizationRef || null,
      requiredPermission,
    };
  }

  const organizationId = match?.organizationRef || null;
  if (!organizationId) {
    return {
      allowed: false,
      via: "none",
      reason: "This match does not belong to an organization, so only a platform admin can change it.",
      code: "MATCH_PLATFORM_ONLY",
      requiredPermission,
    };
  }

  const access = await resolveOrgAccess({ _id: organizationId }, req.user);
  if (!access.membership) {
    return {
      allowed: false,
      via: "none",
      reason: "You are not a member of this organization.",
      code: "ORG_MEMBERSHIP_REQUIRED",
      organization: organizationId,
      requiredPermission,
    };
  }

  if (!roleHasPermission(access.roles, requiredPermission)) {
    return {
      allowed: false,
      via: "none",
      reason: requiredPermission === PERMISSIONS.SCORE_MATCH
        ? "Your role in this organization does not allow scoring."
        : "Your role in this organization does not allow setting the squads for a match.",
      code: "ORG_PERMISSION_DENIED",
      requiredPermission,
      organization: organizationId,
    };
  }

  return {
    allowed: true,
    via: "membership",
    organization: organizationId,
    roles: access.roles,
    requiredPermission,
  };
}

/** Back-compat alias: scoring access is the SCORE_MATCH specialization. */
export const resolveMatchScoreAccess = (req, match) =>
  resolveMatchAccess(req, match, PERMISSIONS.SCORE_MATCH);

/**
 * Express guard for match write routes. `idParam` is the route parameter that
 * holds the match id, so the same guard serves `:id` and `:matchId` routes.
 *
 * Sets `req.matchAccess` for downstream controllers and auditing.
 */
export function requireMatchAccess(idParam = "matchId", permission = PERMISSIONS.SCORE_MATCH) {
  return async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Not authorized" });

      const matchId = req.params?.[idParam];
      if (!matchId || !mongoose.Types.ObjectId.isValid(matchId)) {
        return res.status(400).json({ message: "Match id is not valid" });
      }

      const match = await Match.findById(matchId).select("organizationRef").lean();
      if (!match) return res.status(404).json({ message: "Match not found" });

      const access = await resolveMatchAccess(req, match, permission);
      req.matchAccess = access;
      if (!access.allowed) {
        return res.status(403).json({
          message: access.reason,
          code: access.code || "ORG_PERMISSION_DENIED",
          requiredPermission: access.requiredPermission || permission,
        });
      }

      return next();
    } catch (err) {
      return res.status(500).json({ message: "Failed to check match access" });
    }
  };
}

/** Guard for ball-by-ball and innings routes. */
export const requireMatchScoreAccess = (idParam = "matchId") =>
  requireMatchAccess(idParam, PERMISSIONS.SCORE_MATCH);

export default { resolveMatchAccess, resolveMatchScoreAccess, requireMatchAccess, requireMatchScoreAccess };
