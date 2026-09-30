import test from "node:test";
import assert from "node:assert/strict";

import {
  ALL_PERMISSIONS,
  ORG_ROLES,
  PERMISSIONS,
  grantableRoles,
  isOrgAdminRole,
  isValidRole,
  permissionsForRole,
  permissionsForRoles,
  roleHasPermission,
  sanitizeRequestedRoles,
} from "../src/permissions/orgPermissions.js";

test("role vocabulary and permission set are closed", () => {
  for (const role of ORG_ROLES) {
    assert.ok(isValidRole(role), `${role} is a known role`);
  }
  assert.ok(!isValidRole("superuser"));
  for (const permission of ALL_PERMISSIONS) {
    assert.ok(permission.includes("_"), "permissions are snake_case verbs");
  }
});

test("every role maps to a subset of the closed permission set", () => {
  for (const role of ORG_ROLES) {
    for (const permission of permissionsForRole(role)) {
      assert.ok(ALL_PERMISSIONS.includes(permission), `${role} -> ${permission} is known`);
    }
  }
});

test("owner and admin hold every permission; the closed set has no extras", () => {
  assert.deepEqual(permissionsForRole("owner").sort(), [...ALL_PERMISSIONS].sort());
  assert.deepEqual(permissionsForRole("admin").sort(), [...ALL_PERMISSIONS].sort());
});

test("role permission matrix (table-driven)", () => {
  const cases = [
    ["owner", PERMISSIONS.MANAGE_ORG, true],
    ["owner", PERMISSIONS.SCORE_MATCH, true],
    ["admin", PERMISSIONS.MANAGE_MEMBERS, true],
    ["admin", PERMISSIONS.MANAGE_ORG, true],
    ["manager", PERMISSIONS.MANAGE_TEAMS, true],
    ["manager", PERMISSIONS.SCORE_MATCH, true],
    ["manager", PERMISSIONS.MANAGE_MEMBERS, false],
    ["manager", PERMISSIONS.MANAGE_ORG, false],
    ["team_manager", PERMISSIONS.MANAGE_TEAMS, true],
    ["team_manager", PERMISSIONS.MANAGE_PLAYERS, true],
    ["team_manager", PERMISSIONS.CREATE_MATCH, false],
    ["coach", PERMISSIONS.MANAGE_PLAYERS, true],
    ["coach", PERMISSIONS.MANAGE_TEAMS, false],
    ["captain", PERMISSIONS.MANAGE_PLAYERS, true],
    ["vice_captain", PERMISSIONS.MANAGE_PLAYERS, false],
    ["vice_captain", PERMISSIONS.VIEW_ANALYTICS, true],
    ["score_handler", PERMISSIONS.SCORE_MATCH, true],
    ["score_handler", PERMISSIONS.MANAGE_MEMBERS, false],
    ["score_handler", PERMISSIONS.CREATE_MATCH, false],
    ["social_media_handler", PERMISSIONS.PUBLISH_CONTENT, true],
    ["social_media_handler", PERMISSIONS.MANAGE_SOCIAL_LINKS, true],
    ["social_media_handler", PERMISSIONS.SCORE_MATCH, false],
    ["content_manager", PERMISSIONS.MODERATE_COMMENTS, true],
    ["content_manager", PERMISSIONS.MANAGE_TEAMS, false],
    ["player", PERMISSIONS.VIEW_ANALYTICS, true],
    ["player", PERMISSIONS.MANAGE_PLAYERS, false],
    ["staff", PERMISSIONS.VIEW_ANALYTICS, true],
    ["staff", PERMISSIONS.PUBLISH_CONTENT, false],
  ];

  for (const [role, permission, expected] of cases) {
    assert.strictEqual(
      roleHasPermission([role], permission),
      expected,
      `${role} ${expected ? "may" : "may NOT"} ${permission}`,
    );
  }
});

test("multiple roles union their permissions (a club manager who also scores)", () => {
  const combined = permissionsForRoles(["team_manager", "score_handler"]);
  assert.ok(combined.includes(PERMISSIONS.MANAGE_TEAMS));
  assert.ok(combined.includes(PERMISSIONS.SCORE_MATCH));
  assert.ok(!combined.includes(PERMISSIONS.MANAGE_MEMBERS));
});

test("unknown roles and permissions are ignored, never granted", () => {
  assert.deepEqual(permissionsForRoles(["ghost"]), []);
  assert.strictEqual(roleHasPermission(["owner"], "delete_everything"), false);
  assert.strictEqual(roleHasPermission(["owner", "ghost"], PERMISSIONS.MANAGE_ORG), true);
});

test("only owners may grant owner/admin; everyone else gets the safe subset", () => {
  const ownerGrantable = grantableRoles(["owner"]);
  assert.ok(ownerGrantable.includes("owner"));
  assert.ok(ownerGrantable.includes("admin"));

  for (const role of ["admin", "manager", "team_manager", "player"]) {
    const grantable = grantableRoles([role]);
    assert.ok(!grantable.includes("owner"), `${role} cannot grant owner`);
    assert.ok(!grantable.includes("admin"), `${role} cannot grant admin`);
    assert.ok(grantable.includes("score_handler"));
  }
});

test("sanitizeRequestedRoles strips privileged roles for non-owners", () => {
  assert.deepEqual(
    sanitizeRequestedRoles(["owner", "admin", "coach"], ["admin"]),
    ["coach"],
  );
  assert.deepEqual(
    sanitizeRequestedRoles(["owner", "admin", "coach"], ["owner"]).sort(),
    ["admin", "coach", "owner"],
  );
  assert.deepEqual(sanitizeRequestedRoles(["ghost", "coach"], ["owner"]), ["coach"]);
});

test("isOrgAdminRole distinguishes org-level admins from everyone else", () => {
  assert.strictEqual(isOrgAdminRole(["owner"]), true);
  assert.strictEqual(isOrgAdminRole(["admin"]), true);
  assert.strictEqual(isOrgAdminRole(["manager"]), false);
  assert.strictEqual(isOrgAdminRole([]), false);
});
