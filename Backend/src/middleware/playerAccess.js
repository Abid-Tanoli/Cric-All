import mongoose from "mongoose";
import Player from "../models/Player.js";
import Team from "../models/Team.js";
import Membership from "../models/Membership.js";
import { roleHasPermission } from "../permissions/orgPermissions.js";
import { PERMISSIONS } from "../permissions/orgPermissions.js";
import { isPlatformAdmin } from "./orgAccess.js";

// Phase 5: who may change a player profile.
//
// Product decision: a profile is a public claim about a person, so *creating*
// one is open to any verified account. Editing is not — otherwise the first
// person to type a famous cricketer's name could rewrite that profile, and
// squad membership (which is real, load-bearing data) would be editable by
// anyone. Three actors can therefore write:
//
//   1. the platform Admin app (supervisory, audited);
//   2. the account that created the profile, for the self-service fields;
//   3. a member of the organization that owns the player's team, holding
//      manage_players — this is how a coach fixes a squad list.
//
// Assignment to a team is NOT in this list on purpose. It is a separate,
// permission-checked action on the org team routes, so it can never be smuggled
// in through a profile edit.

const SELF_SERVICE_DISABLED_FIELDS = ["team", "stats", "isSeed", "seedSource", "seedVersion", "createdBy"];

/** The organization that owns a player's team, if the team belongs to one. */
async function teamOrganizationId(teamId) {
  if (!mongoose.Types.ObjectId.isValid(teamId)) return null;
  const team = await Team.findById(teamId).select("organizationRef").lean();
  return team?.organizationRef || null;
}

/**
 * Resolve write access to one player.
 *
 * Returns `{ allowed, via, reason }`. `via` is one of platform_admin,
 * creator, org_manager, none — it is recorded in the audit entry so a later
 * reader can tell which rule let the change through.
 */
export async function resolvePlayerWriteAccess(req, player) {
  if (!req?.user) return { allowed: false, via: "none", reason: "Not signed in" };

  if (isPlatformAdmin(req)) {
    return { allowed: true, via: "platform_admin", organization: null };
  }

  if (player?.createdBy && String(player.createdBy) === String(req.user._id)) {
    return { allowed: true, via: "creator", organization: null };
  }

  if (player?.team) {
    const organizationId = await teamOrganizationId(player.team);
    if (organizationId) {
      const membership = await Membership.findOne({
        organization: organizationId,
        user: req.user._id,
        status: "active",
      }).lean();
      if (membership && roleHasPermission(membership.roles || [], PERMISSIONS.MANAGE_PLAYERS)) {
        return { allowed: true, via: "org_manager", organization: organizationId };
      }
    }
  }

  return {
    allowed: false,
    via: "none",
    reason: "You can only edit player profiles you created, or players in a team you manage.",
  };
}

/**
 * Strips fields the acting user is not entitled to set.
 *
 * The route schema already rejects unknown keys, so this is about *known* keys
 * that are privileged: a creator sending `stats` or `team` gets them removed
 * rather than a 403, because the rest of their edit is legitimate and a
 * half-applied profile is worse than a rejected one. The stripped keys are
 * returned so the caller can tell the user what happened.
 *
 * `team` is privileged for *everyone* below platform admin, including an org
 * manager. Letting `manage_players` imply "may move players between teams" would
 * hand every coach a way to pull a player out of another organization's squad
 * and, more simply, to bypass the squad endpoints that already check the target
 * team's ownership and audit the move. Team membership has exactly one entry
 * point: the org team routes.
 */
export function applyPlayerFieldPolicy(body, access) {
  const payload = { ...body };
  const stripped = [];
  if (access?.via === "platform_admin") return { payload, stripped };

  for (const field of SELF_SERVICE_DISABLED_FIELDS) {
    if (field in payload) {
      delete payload[field];
      stripped.push(field);
    }
  }
  return { payload, stripped };
}

export default {
  resolvePlayerWriteAccess,
  applyPlayerFieldPolicy,
  SELF_SERVICE_DISABLED_FIELDS,
};
