import mongoose from "mongoose";
import User from "../models/User.js";
import Membership from "../models/Membership.js";
import Invitation from "../models/Invitation.js";
import HandlerRequest from "../models/HandlerRequest.js";
import MatchOfficial from "../models/MatchOfficial.js";
import Player from "../models/Player.js";
import Team from "../models/Team.js";
import Event from "../models/Event.js";
import TeamOrganization from "../models/TeamOrganization.js";

export class AccountDeletionError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * Remove one user account and every reference to it.
 *
 * Ordering matters: the User document is removed last, so if any step above
 * throws, the account still exists and the person can retry instead of being
 * left with a half-deleted identity they can no longer log into.
 *
 * What is deliberately NOT deleted:
 *   - AuditLog rows. The trail is append-only and `actorLabel` is denormalized
 *     exactly so a deleted or renamed account does not erase history.
 *   - Player profiles, Teams and Events. Those are public records that other
 *     people's scorecards depend on; we only drop the pointer to the creator.
 */
export async function deleteUserAccount(userId, { email = "" } = {}) {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new AccountDeletionError(400, "INVALID_USER_ID", "Invalid account id");
  }

  // An organization must always have at least one owner (see
  // assertNotLastOwner). Refuse the deletion rather than silently orphan the
  // org: the person can promote another member to owner and come back.
  const ownedMemberships = await Membership.find({
    user: userId,
    status: "active",
    roles: "owner",
  })
    .select("organization")
    .lean();

  const lastOwnerOrgs = [];
  for (const membership of ownedMemberships) {
    const remainingOwners = await Membership.countDocuments({
      organization: membership.organization,
      status: "active",
      roles: "owner",
      user: { $ne: userId },
    });
    if (remainingOwners === 0) {
      const org = await TeamOrganization.findById(membership.organization).select("name").lean();
      lastOwnerOrgs.push({
        _id: String(membership.organization),
        name: org?.name || "Unknown organization",
      });
    }
  }

  if (lastOwnerOrgs.length) {
    throw new AccountDeletionError(
      409,
      "ACCOUNT_OWNS_ORGANIZATION",
      "Promote another member to owner of your organization before deleting the account.",
      { organizations: lastOwnerOrgs }
    );
  }

  // Ownership of an org with co-owners passes to whoever is left, rather than
  // leaving TeamOrganization.owner pointing at a user id that no longer exists.
  for (const membership of ownedMemberships) {
    const heir = await Membership.findOne({
      organization: membership.organization,
      status: "active",
      roles: "owner",
      user: { $ne: userId },
    }).select("user");

    await TeamOrganization.updateOne(
      { owner: userId, _id: membership.organization },
      heir ? { $set: { owner: heir.user } } : { $set: { owner: null } }
    );
  }

  const cleanup = {
    // Registrations and unanswered invitations addressed to this address, so a
    // deleted account does not leave a live invite that can never be accepted.
    invitations: await Invitation.deleteMany({
      $or: [{ invitee: userId }, { inviter: userId }, ...(email ? [{ email }] : [])],
    }).then((r) => r.deletedCount || 0),
    handlerRequests: await HandlerRequest.deleteMany({ user: userId }).then((r) => r.deletedCount || 0),
    matchOfficials: await MatchOfficial.deleteMany({ userId }).then((r) => r.deletedCount || 0),
    memberships: await Membership.deleteMany({ user: userId }).then((r) => r.deletedCount || 0),
    legacyOrgMembers: await TeamOrganization.updateMany(
      { "members.user": userId },
      { $pull: { members: { user: userId } } }
    ).then((r) => r.modifiedCount || 0),
    // Public content keeps existing; only the dangling creator pointer goes.
    playersUnlinked: await Player.updateMany({ createdBy: userId }, { $unset: { createdBy: 1 } }).then(
      (r) => r.modifiedCount || 0
    ),
    teamsUnmanaged: await Team.updateMany({ managedBy: userId }, { $unset: { managedBy: 1 } }).then(
      (r) => r.modifiedCount || 0
    ),
    eventsUnmanaged: await Event.updateMany(
      { $or: [{ createdBy: userId }, { managedBy: userId }] },
      { $unset: { createdBy: 1, managedBy: 1 } }
    ).then((r) => r.modifiedCount || 0),
    orgsUncreated: await TeamOrganization.updateMany(
      { createdBy: userId, owner: { $ne: userId } },
      { $set: { createdBy: null } }
    ).then((r) => r.modifiedCount || 0),
  };

  const deleted = await User.findByIdAndDelete(userId);
  if (!deleted) {
    throw new AccountDeletionError(404, "USER_NOT_FOUND", "Account not found");
  }

  return { email: deleted.email, cleanup };
}