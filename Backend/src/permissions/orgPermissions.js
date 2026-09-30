// Single source of truth for organization roles and what each one may do.
//
// Why a map and not booleans: a real club has several score handlers and
// several social-media volunteers, and permissions must be explainable in one
// place. `ALL_PERMISSIONS` is the closed set the API accepts; anything not in
// it cannot be granted, so adding a permission here immediately widens the
// surface of every role that lists it.

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

export const ALL_PERMISSIONS = Object.freeze(Object.values(PERMISSIONS));

// Role vocabulary. Several people can hold the same role (Phase 2 spec) — a
// club may run three score handlers and two social-media volunteers.
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

// Human labels for the UI. Kept here so the backend, the User app and the
// Admin app cannot drift into three different vocabularies.
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

// Only these roles may act on the organization itself.
const ORG_ADMIN_ROLES = ["owner", "admin"];

// Only owners may hand out (or take back) owner/admin. Enforced here rather
// than in each controller so the rule cannot be forgotten in a new endpoint.
const PRIVILEGED_ROLES = ["owner", "admin"];

const VIEW_ONLY = [PERMISSIONS.VIEW_ANALYTICS];

const ROLE_PERMISSIONS = Object.freeze({
  owner: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS,
  manager: [
    PERMISSIONS.MANAGE_TEAMS,
    PERMISSIONS.MANAGE_PLAYERS,
    PERMISSIONS.CREATE_MATCH,
    PERMISSIONS.SCORE_MATCH,
    PERMISSIONS.PUBLISH_CONTENT,
    PERMISSIONS.MODERATE_COMMENTS,
    PERMISSIONS.MANAGE_SOCIAL_LINKS,
    PERMISSIONS.VIEW_ANALYTICS,
  ],
  team_manager: [PERMISSIONS.MANAGE_TEAMS, PERMISSIONS.MANAGE_PLAYERS, PERMISSIONS.VIEW_ANALYTICS],
  coach: [PERMISSIONS.MANAGE_PLAYERS, PERMISSIONS.VIEW_ANALYTICS],
  captain: [PERMISSIONS.MANAGE_PLAYERS, PERMISSIONS.VIEW_ANALYTICS],
  vice_captain: VIEW_ONLY,
  score_handler: [PERMISSIONS.SCORE_MATCH, PERMISSIONS.VIEW_ANALYTICS],
  social_media_handler: [
    PERMISSIONS.PUBLISH_CONTENT,
    PERMISSIONS.MANAGE_SOCIAL_LINKS,
    PERMISSIONS.VIEW_ANALYTICS,
  ],
  content_manager: [
    PERMISSIONS.PUBLISH_CONTENT,
    PERMISSIONS.MODERATE_COMMENTS,
    PERMISSIONS.MANAGE_SOCIAL_LINKS,
    PERMISSIONS.VIEW_ANALYTICS,
  ],
  player: VIEW_ONLY,
  staff: VIEW_ONLY,
});

export function isValidRole(role) {
  return ORG_ROLES.includes(role);
}

export function isValidPermission(permission) {
  return ALL_PERMISSIONS.includes(permission);
}

export function permissionsForRole(role) {
  return ROLE_PERMISSIONS[role] ? [...ROLE_PERMISSIONS[role]] : [];
}

/** Union of the permissions granted by every role a member holds. */
export function permissionsForRoles(roles = []) {
  const set = new Set();
  for (const role of roles) {
    if (!isValidRole(role)) continue;
    for (const permission of ROLE_PERMISSIONS[role]) set.add(permission);
  }
  return ALL_PERMISSIONS.filter((permission) => set.has(permission));
}

export function roleHasPermission(roles = [], permission) {
  if (!isValidPermission(permission)) return false;
  return roles.some((role) => (ROLE_PERMISSIONS[role] || []).includes(permission));
}

export function isOrgAdminRole(roles = []) {
  return roles.some((role) => ORG_ADMIN_ROLES.includes(role));
}

export function hasPrivilegedRole(roles = []) {
  return roles.some((role) => PRIVILEGED_ROLES.includes(role));
}

/** Roles an actor holding `actorRoles` is allowed to grant to somebody else. */
export function grantableRoles(actorRoles = []) {
  if (!actorRoles.includes("owner")) return ORG_ROLES.filter((role) => !PRIVILEGED_ROLES.includes(role));
  return [...ORG_ROLES];
}

/** Drops unknown roles and the privileged ones when the actor is not an owner. */
export function sanitizeRequestedRoles(requested = [], actorRoles = []) {
  const unique = [...new Set(requested.filter(isValidRole))];
  if (actorRoles.includes("owner")) return unique;
  return unique.filter((role) => !PRIVILEGED_ROLES.includes(role));
}

export default {
  PERMISSIONS,
  ALL_PERMISSIONS,
  ORG_ROLES,
  ORG_ROLE_LABELS,
  ORG_ROLE_DESCRIPTIONS,
  isValidRole,
  isValidPermission,
  permissionsForRole,
  permissionsForRoles,
  roleHasPermission,
  isOrgAdminRole,
  hasPrivilegedRole,
  grantableRoles,
  sanitizeRequestedRoles,
};
