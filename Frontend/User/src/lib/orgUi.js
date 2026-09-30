// Organization role/permission vocabulary for the User app.
//
// Mirrors Backend/src/permissions/orgPermissions.js. It is duplicated on
// purpose: the browser needs labels and an ordering without a round trip, and
// the API remains the authority (every action below is re-checked server side
// by requireOrgPermission, so a stale copy here can never widen access).

export const PERMISSIONS = Object.freeze({
  MANAGE_ORG: "manage_org",
  MANAGE_MEMBERS: "manage_members",
  INVITE_MEMBERS: "invite_members",
  MANAGE_TEAMS: "manage_teams",
  MANAGE_PLAYERS: "manage_players",
  CREATE_MATCH: "create_match",
  SCORE_MATCH: "score_match",
  PUBLISH_CONTENT: "publish_content",
  MODERATE_COMMENTS: "moderate_comments",
  MANAGE_SOCIAL_LINKS: "manage_social_links",
  VIEW_ANALYTICS: "view_analytics",
});

export const ORG_ROLES = Object.freeze([
  "owner",
  "admin",
  "manager",
  "coach",
  "captain",
  "vice_captain",
  "score_handler",
  "social_media_handler",
  "content_manager",
  "team_manager",
  "player",
  "staff",
]);

export const ORG_ROLE_LABELS = Object.freeze({
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  coach: "Coach",
  captain: "Captain",
  vice_captain: "Vice Captain",
  score_handler: "Score Handler",
  social_media_handler: "Social Media Handler",
  content_manager: "Content Manager",
  team_manager: "Team Manager",
  player: "Player",
  staff: "Staff",
});

export const ORG_ROLE_DESCRIPTIONS = Object.freeze({
  owner: "Full control of the organization, including ownership and role grants.",
  admin: "Full control of the organization except granting owner/admin roles.",
  manager: "Runs teams, players, matches and content day to day.",
  coach: "Manages players and sees analytics.",
  captain: "Manages the squad and sees analytics.",
  vice_captain: "Sees analytics and supports the captain.",
  score_handler: "Runs ball-by-ball scoring for assigned matches.",
  social_media_handler: "Publishes posts and maintains the social links.",
  content_manager: "Publishes and moderates content.",
  team_manager: "Manages teams and their players.",
  player: "Sees analytics for the organization they play for.",
  staff: "General staff with read-only analytics access.",
});

export const PERMISSION_LABELS = Object.freeze({
  manage_org: "Organization settings",
  manage_members: "Manage members & roles",
  invite_members: "Invite new members",
  manage_teams: "Create & manage teams",
  manage_players: "Manage players & squads",
  create_match: "Create matches & tournaments",
  score_match: "Score matches",
  publish_content: "Publish news & updates",
  moderate_comments: "Moderate comments",
  manage_social_links: "Edit social links",
  view_analytics: "View analytics",
});

/** Roles the signed-in user may hand out. The API sends this per organization. */
export function grantableRoles(grantable) {
  if (Array.isArray(grantable) && grantable.length > 0) return grantable;
  return ORG_ROLES.filter((role) => role !== "owner" && role !== "admin");
}

export function can(permissions, permission) {
  return Array.isArray(permissions) && permissions.includes(permission);
}

export function isOwner(roles) {
  return Array.isArray(roles) && roles.includes("owner");
}

/** Ownership is transferred, never invited or self-granted. */
export function grantableInviteRoles(grantable) {
  return grantableRoles(grantable).filter((role) => role !== "owner");
}

export const roleLabel = (role) => ORG_ROLE_LABELS[role] || role;
export const roleLabels = (roles = []) => roles.map(roleLabel).join(", ") || "No role";

export const invitationStatusStyles = Object.freeze({
  pending: "bg-amber-100 text-amber-800 border-amber-300",
  accepted: "bg-green-100 text-green-800 border-green-300",
  rejected: "bg-red-100 text-red-800 border-red-300",
  expired: "bg-slate-100 text-slate-600 border-slate-300",
  revoked: "bg-slate-100 text-slate-600 border-slate-300",
});

export const verificationStyles = Object.freeze({
  verified: "bg-green-100 text-green-800 border-green-300",
  pending: "bg-amber-100 text-amber-800 border-amber-300",
  unverified: "bg-slate-100 text-slate-600 border-slate-300",
  rejected: "bg-red-100 text-red-800 border-red-300",
});

export function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function daysUntil(value) {
  if (!value) return null;
  const diff = new Date(value).getTime() - Date.now();
  if (Number.isNaN(diff)) return null;
  return Math.ceil(diff / 86400000);
}
