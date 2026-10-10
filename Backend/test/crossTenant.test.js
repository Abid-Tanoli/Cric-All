/**
 * Phase 11 - cross-tenant authorization matrix.
 *
 * Two tenants are built by the normal E2E bootstrap (Org A, Org B) plus a set of
 * actors the public API cannot produce, and every resource is then attacked from
 * every one of the seven principals in the matrix. The point is not to re-check
 * that permissions exist - `orgPermissions.test.js` does that - but to prove
 * that no principal can reach across the tenant boundary.
 *
 * The rules encoded below:
 *
 *   - A read that returns somebody else's private rows is a FAIL, and so is any
 *     write that changes the victim's document, even one that answers 4xx for
 *     the wrong reason. Denials are therefore asserted *twice*: the response
 *     must be a 4xx, and the victim must be byte-identical afterwards. A route
 *     that rejects the request but leaks the mutation has still failed.
 *   - A 5xx is always a FAIL. A malformed or hostile id that crashes the
 *     handler is a defect even when nothing was written.
 *   - 404 rather than 403 is the *preferred* answer for another tenant's
 *     document: the existence of somebody else's team is not the caller's
 *     business. Tests accept 403 as "not authorised" too, because both are
 *     refusals, but never accept 2xx.
 *   - `owner` and the platform `admin` are only allowed to run destructive verbs
 *     in the final blocks, once every denial has been recorded against intact
 *     victims. Block order is load-bearing and is asserted by the comment on
 *     `after`.
 *
 * No request in this file bypasses the API, and no verdict is written directly.
 * `helpers/localFixtures.js` is used only to build actors (see its header for
 * the two the API cannot create); every result below comes from HTTP.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import { API_BASE, assertLocalTarget, assertServerIsLocal } from "./e2e/lib/guard.js";
import { createClient } from "./e2e/lib/http.js";
import { bootstrap, createMatch, registerVerifiedUser, TEST_PREFIX } from "./e2e/lib/bootstrap.js";
import { resetPlatformAdmins, setUserSuspended, createPlatformAdmin } from "./helpers/localFixtures.js";

// Same disposable local-only fixture password the rest of the E2E suite uses.
const FIXTURE_PASSWORD = "OpencodeLocal!2026";

let ctx;
let world;

/** Every principal in the matrix, in the order the report lists them. */
const ACTORS = ["anonymous", "verified", "orgAMember", "orgBMember", "owner", "admin", "suspended"];

// --- assertion helpers -------------------------------------------------------

// The shared client spells DELETE `del`, because `delete` is a reserved word.
const VERB = { get: "get", post: "post", put: "put", patch: "patch", delete: "del" };

function call(api, method, path, body) {
  return api[VERB[method] || method](path, body);
}

async function assertRefused({ api, method, path, body, label }) {
  const res = await call(api, method, path, body);
  assert.ok(
    res.status < 500,
    `FAIL 5xx  ${label}: ${method} ${path} answered ${res.status}; a hostile or malformed request must never reach the error path`,
  );
  assert.ok(
    res.status >= 400,
    `FAIL IDOR ${label}: ${method} ${path} answered ${res.status}; this principal must not be allowed to do this`,
  );
  return res;
}

async function assertPermitted({ api, method, path, body, label }) {
  const res = await call(api, method, path, body);
  assert.ok(
    res.status >= 200 && res.status < 300,
    `FAIL 2xx  ${label}: ${method} ${path} answered ${res.status} - ${JSON.stringify(res.body)}`,
  );
  return res;
}

/**
 * The core IDOR check. Snapshots the victim, runs the request, then proves the
 * victim is unchanged. `snapshot` is read through an account that *is* allowed to
 * see it, so the comparison is against ground truth rather than the victim's own
 * possibly-tainted view.
 */
async function assertWriteRefused({ api, method, path, body, label, snapshot }) {
  const before = await snapshot();
  assert.ok(before, `${label}: could not snapshot the victim before the request`);

  await assertRefused({ api, method, path, body, label });

  const after = await snapshot();
  assert.equal(after, before, `FAIL MUTATED ${label}: ${method} ${path} was refused but the victim document changed`);
}

/** A read of private rows must not hand back the tenant's private data. */
async function assertPrivateNotLeaked({ api, path, label, mustNotContain }) {
  const res = await api.get(path);
  assert.ok(
    res.status < 500,
    `FAIL 5xx  ${label}: GET ${path} answered ${res.status}`,
  );

  const raw = JSON.stringify(res.body ?? null);
  for (const needle of mustNotContain) {
    assert.ok(
      !raw.includes(needle),
      `FAIL LEAK ${label}: GET ${path} answered ${res.status} and leaked "${needle}" to a principal that may not see it`,
    );
  }
  return res;
}

// --- world ------------------------------------------------------------------

before(async () => {
  assertLocalTarget();
  await assertServerIsLocal();

  // POST /admin/register closes permanently once one Admin exists, and
  // DELETE /admin/:id refuses to remove the caller, so a suite that wants a
  // platform-admin principal has to reopen that window itself.
  await resetPlatformAdmins();

  // process.pid keeps the id unique even when `node --test` starts this file
  // and the NoSQL file in the same millisecond - the run id keys every fixture
  // email, and a collision would be a duplicate-key failure in an unrelated test.
  const runId = `p11_${process.pid}_${Date.now().toString(36)}`;
  ctx = await bootstrap({ makeClient: () => createClient({ apiBase: API_BASE }), runId });

  const actors = {};

  // --- principals the bootstrap did not already give us -------------------
  actors.anonymous = { label: "anonymous", api: createClient({ apiBase: API_BASE }) };

  actors.verified = await registerVerifiedUser(ctx.makeClient, {
    name: `P11_NoMembership_${runId}`,
    email: `opencode.test.nomembership.${runId}@example.test`,
    password: FIXTURE_PASSWORD,
    accountType: "player",
  });

  actors.orgAMember = ctx.scorer;

  // A genuine member of the *other* tenant - a stranger with a real, active
  // membership, which is a far better probe than a non-member. Direct add is the
  // dependable route because it needs no mail parse; the account is already
  // email-verified, which is all it requires.
  const bMember = await registerVerifiedUser(ctx.makeClient, {
    name: `P11_TenantBMember_${runId}`,
    email: `opencode.test.tenantb.${runId}@example.test`,
    password: FIXTURE_PASSWORD,
    accountType: "player",
  });
  await ctx.outsider.api.post(
    `/organizations/${ctx.otherOrgId}/members`,
    { email: bMember.email, roles: ["player"] },
    { expect: [200, 201] },
  );
  const bLogin = await bMember.api.post(
    "/auth/login",
    { email: bMember.email, password: FIXTURE_PASSWORD },
    { expect: [200] },
  );
  bMember.api.setToken(bLogin.body?.token);
  bMember.memberOf = String(ctx.otherOrgId);
  actors.orgBMember = bMember;

  actors.owner = ctx.owner;

  // A suspended account that holds a *real membership in tenant A*. Suspending a
  // genuine insider is the interesting case: its token and its permissions are
  // still valid on paper, so only the status check can stop it. No endpoint sets
  // `status`, so the fixture is written directly - see helpers/localFixtures.js.
  const suspended = await registerVerifiedUser(ctx.makeClient, {
    name: `P11_Suspended_${runId}`,
    email: `opencode.test.suspended.${runId}@example.test`,
    password: FIXTURE_PASSWORD,
    accountType: "player",
  });
  await ctx.owner.api.post(
    `/organizations/${ctx.orgId}/members`,
    { email: suspended.email, roles: ["player", "score_handler"] },
    { expect: [200, 201] },
  );
  assert.ok(
    await setUserSuspended(suspended.email),
    `fixture setup: no User document matched ${suspended.email}, so the suspended actor would not exist`,
  );
  suspended.memberOf = String(ctx.orgId);
  actors.suspended = suspended;

  // Platform admin: the one principal the public API cannot be relied on to
  // produce. POST /admin/register is now gated on ALLOW_ADMIN_REGISTER, which
  // the *server* process reads, so a test process cannot enable it for the
  // running server. The admin is therefore written into the disposable database
  // directly - see helpers/localFixtures.js.
  const adminEmail = `opencode.test.admin.${runId}@example.test`;
  const admin = await createPlatformAdmin({
    name: `${TEST_PREFIX}PlatformAdmin_${runId}`,
    email: adminEmail,
    password: FIXTURE_PASSWORD,
  });
  const adminApi = createClient({ apiBase: API_BASE });
  const adminLogin = await adminApi.post(
    "/admin/login",
    { email: adminEmail, password: FIXTURE_PASSWORD },
    { expect: [200] },
  );
  const adminToken = adminLogin.body?.token;
  assert.ok(adminToken, "platform admin login returned no token");
  adminApi.setToken(adminToken);
  actors.admin = {
    label: "admin",
    email: adminEmail,
    api: adminApi,
    token: adminToken,
    userId: admin.id,
    role: admin.role,
  };

  // --- victims, all inside tenant A ---------------------------------------
  const match = await createMatch({ ctx, title: "Victim" });
  const throwawayMatch = await createMatch({ ctx, title: "Disposable" });
  // A second throwaway fixture, so the permitted-delete cells can be asserted for
  // two different principals without one of them consuming the other's.
  const throwawayAdminMatch = await createMatch({ ctx, title: "DisposableAdmin" });

  const ownerPlayer = await ctx.owner.api.post(
    "/players",
    { name: `${TEST_PREFIX}VictimPlayer_${runId}`, playingRole: "Batsman", battingStyle: "Right-handed" },
    { expect: [200, 201] },
  );
  const ownerPlayerId = String(ownerPlayer.body?.player?._id || ownerPlayer.body?._id);

  const adminTournament = await adminApi.post(
    "/tournaments",
    {
      name: `${TEST_PREFIX}VictimTournament_${runId}`,
      shortName: `P11VT${runId}`.slice(0, 12),
      type: "knockout",
      startDate: "2026-01-01",
      endDate: "2026-02-01",
      teams: [ctx.teams.a.id, ctx.teams.b.id],
      venue: "Local Test Ground",
    },
    { expect: [200, 201] },
  );
  const tournamentId = String(adminTournament.body?.tournament?._id || adminTournament.body?._id);
  assert.ok(tournamentId, `tournament creation returned no id: ${JSON.stringify(adminTournament.body)}`);

  world = {
    runId,
    actors,
    victims: {
      orgId: ctx.orgId,
      otherOrgId: ctx.otherOrgId,
      memberUserId: ctx.scorer.userId,
      invitationId: ctx.invitationId,
      teamId: ctx.teams.a.id,
      otherTeamId: ctx.otherTeams.a.id,
      playerId: ownerPlayerId,
      matchId: match.matchId,
      tournamentId,
    },
    disposable: {
      matchId: throwawayMatch.matchId,
      adminMatchId: throwawayAdminMatch.matchId,
    },
  };
});

after(async () => {
  // Left in place deliberately. The destructive blocks consume the victims, so
  // a cleanup that tried to run first would destroy the fixtures the denials
  // are measured against.
  assert.ok(world?.victims?.orgId, "world was never built; the suite did not run");
});

// --- snapshots --------------------------------------------------------------
// Every snapshot is taken through the platform admin or the tenant owner, i.e.
// an account that is genuinely entitled to the document.

const snapshots = {
  organization: () => async () => {
    const r = await world.actors.admin.api.get(`/organizations/${world.victims.orgId}`);
    return JSON.stringify(r.body?.organization ?? r.body);
  },
  membership: () => async () => {
    const r = await world.actors.owner.api.get(`/organizations/${world.victims.orgId}/members`);
    const m = (r.body?.members ?? r.body?.items ?? []).find(
      (x) => String(x.user?._id ?? x._id) === world.victims.memberUserId,
    );
    return JSON.stringify(m);
  },
  invitation: () => async () => {
    const r = await world.actors.owner.api.get(`/organizations/${world.victims.orgId}/invitations`);
    const list = r.body?.invitations ?? r.body?.items ?? [];
    const i = list.find((x) => String(x._id) === world.victims.invitationId);
    return JSON.stringify(i ?? null);
  },
  team: () => async () => {
    const r = await world.actors.admin.api.get(`/teams/${world.victims.teamId}`);
    return JSON.stringify(r.body?.team ?? r.body);
  },
  player: () => async () => {
    const r = await world.actors.admin.api.get(`/players/${world.victims.playerId}`);
    return JSON.stringify(r.body?.player ?? r.body);
  },
  match: () => async () => {
    const r = await world.actors.admin.api.get(`/matches/${world.victims.matchId}`);
    return JSON.stringify(r.body?.match ?? r.body);
  },
  tournament: () => async () => {
    const r = await world.actors.admin.api.get(`/tournaments/${world.victims.tournamentId}`);
    return JSON.stringify(r.body?.tournament ?? r.body);
  },
};

// --- the matrix -------------------------------------------------------------

const v = () => world.victims;

/** Actors that must never be able to write to tenant A. */
const crossTenantWriters = ["anonymous", "verified", "orgAMember", "orgBMember", "suspended"];

describe("Phase 11 - cross-tenant authorization matrix", () => {
  describe("organization", () => {
    test("private organization data is not readable across tenants", async () => {
      const { orgId } = v();
      for (const actorName of ["anonymous", "verified", "orgBMember", "suspended"]) {
        const api = world.actors[actorName].api;
        for (const suffix of ["/members", "/invitations", "/audit-log", "/teams/manage", "/access", "/overview"]) {
          await assertPrivateNotLeaked({
            api,
            path: `/organizations/${orgId}${suffix}`,
            label: `organization/${suffix} as ${actorName}`,
            // The owner actor's email and userId are the private payload that
            // must never reach any of these principals.
            mustNotContain: [world.actors.owner.userId, world.actors.owner.email],
          });
        }
      }
    });

    test("a member without MANAGE_ORG cannot rewrite or delete the organization", async () => {
      const { orgId } = v();
      for (const actorName of crossTenantWriters) {
        const api = world.actors[actorName].api;
        await assertWriteRefused({
          api,
          method: "put",
          path: `/organizations/${orgId}`,
          body: { name: `${TEST_PREFIX}PWNED_${world.runId}` },
          label: `organization update as ${actorName}`,
          snapshot: snapshots.organization(),
        });
        await assertWriteRefused({
          api,
          method: "delete",
          path: `/organizations/${orgId}`,
          label: `organization delete as ${actorName}`,
          snapshot: snapshots.organization(),
        });
      }
    });

    test("creating an organization requires an authenticated verified account", async () => {
      await assertRefused({
        api: world.actors.anonymous.api,
        method: "post",
        path: "/organizations",
        body: { name: `${TEST_PREFIX}Anon_${world.runId}`, type: "club" },
        label: "organization create as anonymous",
      });
    });

    test("the owner may update the organization", async () => {
      await assertPermitted({
        api: world.actors.owner.api,
        method: "put",
        path: `/organizations/${v().orgId}`,
        body: { description: `${TEST_PREFIX}matrix-updated` },
        label: "organization update as owner",
      });
    });
  });

  describe("membership", () => {
    test("the member roster is private to the tenant", async () => {
      const { orgId } = v();
      for (const actorName of ["anonymous", "verified", "orgBMember", "suspended"]) {
        await assertPrivateNotLeaked({
          api: world.actors[actorName].api,
          path: `/organizations/${orgId}/members`,
          label: `membership read as ${actorName}`,
          mustNotContain: [world.actors.orgAMember.userId],
        });
      }
    });

    test("nobody outside the tenant may promote, demote or remove its members", async () => {
      const { orgId, memberUserId } = v();
      const addBody = { email: world.actors.verified.email, roles: ["player"] };
      const patchBody = { roles: ["admin"] };

      for (const actorName of crossTenantWriters) {
        const api = world.actors[actorName].api;
        await assertWriteRefused({
          api,
          method: "post",
          path: `/organizations/${orgId}/members`,
          body: addBody,
          label: `membership create as ${actorName}`,
          snapshot: snapshots.membership(),
        });
        await assertWriteRefused({
          api,
          method: "patch",
          path: `/organizations/${orgId}/members/${memberUserId}`,
          body: patchBody,
          label: `membership update as ${actorName}`,
          snapshot: snapshots.membership(),
        });
        await assertWriteRefused({
          api,
          method: "delete",
          path: `/organizations/${orgId}/members/${memberUserId}`,
          label: `membership delete as ${actorName}`,
          snapshot: snapshots.membership(),
        });
      }
    });

    test("a tenant-B member cannot demote or evict a tenant-A member", async () => {
      const { orgId, memberUserId } = v();
      // The strongest cross-tenant case in the whole suite: a legitimate,
      // authenticated, non-admin member of a *different* tenant aiming at a
      // third party's role assignment.
      await assertWriteRefused({
        api: world.actors.orgBMember.api,
        method: "patch",
        path: `/organizations/${orgId}/members/${memberUserId}`,
        body: { roles: ["owner"] },
        label: "membership escalation as orgBMember",
        snapshot: snapshots.membership(),
      });
      await assertWriteRefused({
        api: world.actors.orgBMember.api,
        method: "delete",
        path: `/organizations/${orgId}/members/${memberUserId}`,
        label: "membership eviction as orgBMember",
        snapshot: snapshots.membership(),
      });
    });

    test("the owner may change a member's roles", async () => {
      await assertPermitted({
        api: world.actors.owner.api,
        method: "patch",
        path: `/organizations/${v().orgId}/members/${v().memberUserId}`,
        body: { roles: ["player", "score_handler"] },
        label: "membership update as owner",
      });
    });
  });

  describe("invitation", () => {
    test("invitations are private to the tenant", async () => {
      const { orgId } = v();
      for (const actorName of ["anonymous", "verified", "orgBMember", "suspended"]) {
        await assertPrivateNotLeaked({
          api: world.actors[actorName].api,
          path: `/organizations/${orgId}/invitations`,
          label: `invitation read as ${actorName}`,
          mustNotContain: [String(v().invitationId)],
        });
      }
    });

    test("nobody outside the tenant may invite, amend or revoke", async () => {
      const { orgId, invitationId } = v();
      for (const actorName of crossTenantWriters) {
        const api = world.actors[actorName].api;
        await assertWriteRefused({
          api,
          method: "post",
          path: `/organizations/${orgId}/invitations`,
          body: { email: `opencode.test.invite.${world.runId}.${actorName}@example.test`, roles: ["player"] },
          label: `invitation create as ${actorName}`,
          snapshot: snapshots.invitation(),
        });
        await assertWriteRefused({
          api,
          method: "delete",
          path: `/organizations/${orgId}/invitations/${invitationId}`,
          label: `invitation revoke as ${actorName}`,
          snapshot: snapshots.invitation(),
        });
      }
    });

    test("invitations have no update verb for anyone, including the owner", async () => {
      // Documented rather than merely untested: an invitation is immutable and
      // can only be revoked. Asserting it keeps a future PATCH from silently
      // arriving as an owner-only escape hatch.
      for (const actorName of ["anonymous", "owner", "admin"]) {
        const res = await world.actors[actorName].api.patch(
          `/organizations/${v().orgId}/invitations/${v().invitationId}`,
          { roles: ["admin"] },
        );
        assert.notEqual(res.status, 200, `invitation update as ${actorName} unexpectedly succeeded`);
      }
    });
  });

  describe("team", () => {
    test("the manage view is private to the tenant", async () => {
      const { orgId } = v();
      for (const actorName of ["anonymous", "verified", "orgBMember", "suspended"]) {
        await assertPrivateNotLeaked({
          api: world.actors[actorName].api,
          path: `/organizations/${orgId}/teams/manage`,
          label: `team manage-read as ${actorName}`,
          mustNotContain: [String(v().teamId)],
        });
      }
    });

    test("nobody outside the tenant may create, rename or delete its teams", async () => {
      const { orgId, teamId } = v();
      for (const actorName of crossTenantWriters) {
        const api = world.actors[actorName].api;
        await assertWriteRefused({
          api,
          method: "post",
          path: `/organizations/${orgId}/teams`,
          body: { name: `${TEST_PREFIX}PwnTeam_${world.runId}_${actorName}` },
          label: `team create as ${actorName}`,
          snapshot: snapshots.team(),
        });
        await assertWriteRefused({
          api,
          method: "patch",
          path: `/organizations/${orgId}/teams/${teamId}`,
          body: { name: `${TEST_PREFIX}PwnRename_${world.runId}` },
          label: `team update as ${actorName}`,
          snapshot: snapshots.team(),
        });
        await assertWriteRefused({
          api,
          method: "delete",
          path: `/organizations/${orgId}/teams/${teamId}`,
          label: `team delete as ${actorName}`,
          snapshot: snapshots.team(),
        });
      }
    });

    test("the global team write routes stay platform-admin-only", async () => {
      // /teams/:id is not org-scoped, so its only gate is requireAdmin. These
      // are the routes where a missing gate would hand the whole platform's team
      // table to any authenticated account.
      const { teamId } = v();
      for (const actorName of ["anonymous", "verified", "orgAMember", "orgBMember", "owner", "suspended"]) {
        const api = world.actors[actorName].api;
        await assertWriteRefused({
          api,
          method: "put",
          path: `/teams/${teamId}`,
          body: { name: `${TEST_PREFIX}GlobalPwn_${world.runId}` },
          label: `global team update as ${actorName}`,
          snapshot: snapshots.team(),
        });
        await assertWriteRefused({
          api,
          method: "delete",
          path: `/teams/${teamId}`,
          label: `global team delete as ${actorName}`,
          snapshot: snapshots.team(),
        });
      }
    });

    test("a tenant-B member cannot edit a tenant-A team through tenant B's own org id", async () => {
      // The classic confused-deputy IDOR: every id is well formed and every
      // check the middleware does make passes, because the caller really is a
      // team manager - of a different team.
      const { otherOrgId, teamId } = v();
      await assertWriteRefused({
        api: world.actors.orgBMember.api,
        method: "patch",
        path: `/organizations/${otherOrgId}/teams/${teamId}`,
        body: { name: `${TEST_PREFIX}CrossTenantRename_${world.runId}` },
        label: "team update via own org id, foreign team id",
        snapshot: snapshots.team(),
      });
    });

    test("a foreign org's squad cannot be edited", async () => {
      const { otherOrgId, teamId } = v();
      const playerId = world.actors.verified.userId;
      for (const actorName of ["orgAMember", "orgBMember"]) {
        await assertWriteRefused({
          api: world.actors[actorName].api,
          method: "post",
          path: `/organizations/${otherOrgId}/teams/${teamId}/players`,
          body: { playerIds: [String(v().otherTeamId)] },
          label: `squad add as ${actorName}`,
          snapshot: snapshots.team(),
        });
      }
      assert.ok(playerId, "fixture sanity");
    });

    test("the owner may rename a tenant-A team", async () => {
      await assertPermitted({
        api: world.actors.owner.api,
        method: "patch",
        path: `/organizations/${v().orgId}/teams/${v().teamId}`,
        body: { name: `${TEST_PREFIX}Renamed_${world.runId}` },
        label: "team update as owner",
      });
    });
  });

  describe("player", () => {
    test("a player may not be edited or deleted by another account", async () => {
      const { playerId } = v();
      for (const actorName of ["anonymous", "verified", "orgBMember", "orgAMember", "suspended"]) {
        const api = world.actors[actorName].api;
        await assertWriteRefused({
          api,
          method: "put",
          path: `/players/${playerId}`,
          body: { name: `${TEST_PREFIX}StolenPlayer_${world.runId}` },
          label: `player update as ${actorName}`,
          snapshot: snapshots.player(),
        });
        await assertWriteRefused({
          api,
          method: "delete",
          path: `/players/${playerId}`,
          label: `player delete as ${actorName}`,
          snapshot: snapshots.player(),
        });
      }
    });

    test("the owning account may update its own player", async () => {
      await assertPermitted({
        api: world.actors.owner.api,
        method: "put",
        path: `/players/${v().playerId}`,
        body: { name: `${TEST_PREFIX}RenamedVictimPlayer_${world.runId}` },
        label: "player update as owner",
      });
    });

    test("a verified account may create a player, but not carry a team on create", async () => {
      const res = await assertPermitted({
        api: world.actors.verified.api,
        method: "post",
        path: "/players",
        body: { name: `${TEST_PREFIX}OwnPlayer_${world.runId}` },
        label: "player create as verified",
      });
      // Self-service must not be able to smuggle a roster in through the
      // richer admin payload.
      const hostile = await world.actors.verified.api.post("/players", {
        name: `${TEST_PREFIX}Smuggle_${world.runId}`,
        team: String(v().otherTeamId),
      });
      assert.notEqual(hostile.status, 201, "self-service player create accepted a team assignment");
      assert.notEqual(hostile.status, 200, "self-service player create accepted a team assignment");
      assert.ok(res.status < 500);
    });
  });

  describe("match", () => {
    test("the tenant match list is private to the tenant", async () => {
      const { orgId } = v();
      for (const actorName of ["anonymous", "verified", "orgBMember", "suspended"]) {
        await assertPrivateNotLeaked({
          api: world.actors[actorName].api,
          path: `/organizations/${orgId}/matches`,
          label: `match list as ${actorName}`,
          mustNotContain: [String(v().matchId)],
        });
      }
    });

    test("nobody outside the tenant may schedule, edit or call off its fixtures", async () => {
      const { orgId, matchId } = v();
      for (const actorName of crossTenantWriters) {
        const api = world.actors[actorName].api;
        await assertWriteRefused({
          api,
          method: "post",
          path: `/organizations/${orgId}/matches`,
          body: { title: `${TEST_PREFIX}PwnMatch_${world.runId}`, venue: "X", matchType: "T20", teams: [v().teamId, world.victims.otherTeamId] },
          label: `match create as ${actorName}`,
          snapshot: snapshots.match(),
        });
        await assertWriteRefused({
          api,
          method: "patch",
          path: `/organizations/${orgId}/matches/${matchId}`,
          body: { title: `${TEST_PREFIX}PwnTitle_${world.runId}` },
          label: `match update as ${actorName}`,
          snapshot: snapshots.match(),
        });
        await assertWriteRefused({
          api,
          method: "delete",
          path: `/organizations/${orgId}/matches/${matchId}`,
          label: `match delete as ${actorName}`,
          snapshot: snapshots.match(),
        });
      }
    });

    test("the global match write routes stay platform-admin-only", async () => {
      const { matchId } = v();
      for (const actorName of ["anonymous", "verified", "orgAMember", "orgBMember", "owner", "suspended"]) {
        const api = world.actors[actorName].api;
        await assertWriteRefused({
          api,
          method: "put",
          path: `/matches/${matchId}`,
          body: { title: `${TEST_PREFIX}GlobalPwn_${world.runId}` },
          label: `global match update as ${actorName}`,
          snapshot: snapshots.match(),
        });
      }
    });

    test("a tenant-B member cannot score a tenant-A match", async () => {
      // score_match is resolved from Match.organizationRef rather than from a
      // client-supplied org id, so this is the case that would prove the tenant
      // is taken from the document and not the URL.
      const { matchId } = v();
      const res = await world.actors.orgBMember.api.post(`/matches/${matchId}/toss`, {
        tossWinner: "team_a",
        decision: "batting_first",
      });
      assert.ok(res.status < 500, `match toss as orgBMember returned ${res.status}`);
      assert.ok(
        res.status >= 400,
        `FAIL IDOR match scoring as orgBMember: POST /matches/${matchId}/toss answered ${res.status}`,
      );
    });

    test("the owner may reschedule its own fixture", async () => {
      await assertPermitted({
        api: world.actors.owner.api,
        method: "patch",
        path: `/organizations/${v().orgId}/matches/${v().matchId}`,
        body: { title: `${TEST_PREFIX}Rescheduled_${world.runId}` },
        label: "match update as owner",
      });
    });
  });

  describe("tournament", () => {
    test("tournament records are public reads for everyone, including anonymous", async () => {
      // Tournaments have no membership gate at all. That is a deliberate
      // product choice, so this row records "allowed" rather than silently
      // asserting a privacy rule the codebase never made.
      for (const actorName of ACTORS) {
        const res = await world.actors[actorName].api.get(`/tournaments/${v().tournamentId}`);
        assert.ok(res.status < 500, `tournament read as ${actorName} returned ${res.status}`);
        assert.equal(res.status, 200, `tournament read as ${actorName} returned ${res.status}`);
      }
    });

    test("every non-admin principal is refused the tournament write routes", async () => {
      const { tournamentId } = v();
      for (const actorName of ["anonymous", "verified", "orgAMember", "orgBMember", "owner", "suspended"]) {
        const api = world.actors[actorName].api;
        await assertWriteRefused({
          api,
          method: "put",
          path: `/tournaments/${tournamentId}`,
          body: { name: `${TEST_PREFIX}PwnTournament_${world.runId}` },
          label: `tournament update as ${actorName}`,
          snapshot: snapshots.tournament(),
        });
        await assertWriteRefused({
          api,
          method: "delete",
          path: `/tournaments/${tournamentId}`,
          label: `tournament delete as ${actorName}`,
          snapshot: snapshots.tournament(),
        });
      }
    });
  });

  describe("principals", () => {
    test("a suspended account is refused on every route that authenticates", async () => {
      const { orgId } = v();
      // Only routes that actually authenticate can refuse a suspended caller.
      // GET /organizations/:id is public by design, so a 200 there is not a
      // bypass and is asserted separately below - the distinction matters,
      // because "suspended" is an authentication verdict, not a visibility one.
      const protectedRoutes = [
        "/auth/profile",
        "/players/mine",
        `/organizations/${orgId}/members`,
        `/organizations/${orgId}/invitations`,
        `/organizations/${orgId}/teams/manage`,
        `/organizations/${orgId}/matches`,
        `/organizations/${orgId}/access`,
        `/organizations/${orgId}/audit-log`,
        "/notifications",
      ];
      for (const target of protectedRoutes) {
        const res = await world.actors.suspended.api.get(target);
        assert.ok(res.status < 500, `suspended read of ${target} returned ${res.status}`);
        assert.ok(res.status >= 400, `FAIL suspended account was served ${target} (status ${res.status})`);
      }
    });

    test("a suspended account is refused writes too, including inside its own tenant", async () => {
      // The suspended principal holds a live `score_handler` membership in
      // tenant A, so its permissions are real. Only the status check stands
      // between it and a write.
      const { orgId, teamId, matchId } = v();
      const writes = [
        { method: "put", path: `/organizations/${orgId}`, body: { description: `${TEST_PREFIX}Suspended` } },
        { method: "post", path: `/organizations/${orgId}/teams`, body: { name: `${TEST_PREFIX}SuspendedTeam_${world.runId}` } },
        { method: "patch", path: `/organizations/${orgId}/teams/${teamId}`, body: { name: `${TEST_PREFIX}SuspendedRename` } },
        { method: "post", path: `/organizations/${orgId}/matches`, body: { title: `${TEST_PREFIX}SuspendedMatch`, venue: "X", matchType: "T20", teams: [teamId, v().otherTeamId] } },
        { method: "patch", path: `/organizations/${orgId}/matches/${matchId}`, body: { title: `${TEST_PREFIX}SuspendedTitle` } },
        { method: "put", path: `/players/${v().playerId}`, body: { name: `${TEST_PREFIX}SuspendedPlayer` } },
      ];
      for (const w of writes) {
        await assertRefused({
          api: world.actors.suspended.api,
          method: w.method,
          path: w.path,
          body: w.body,
          label: `suspended ${w.method.toUpperCase()} ${w.path}`,
        });
      }
    });

    test("a public read is unaffected by suspension, which is intended", async () => {
      // Recorded so a future change to the public surface is a conscious
      // decision rather than a silent regression.
      const res = await world.actors.suspended.api.get(`/organizations/${v().orgId}`);
      assert.equal(res.status, 200, "the public organization profile is no longer public");
    });

    test("the matrix covered all seven principals", async () => {
      for (const actorName of ACTORS) {
        assert.ok(world.actors[actorName], `actor ${actorName} was never built`);
        assert.ok(world.actors[actorName].api, `actor ${actorName} has no client`);
      }
    });
  });

  // --- Round 4B: cells the original matrix recorded but never asserted --------
  //
  // Everything above attacks a victim from outside its tenant. Four cells were
  // left unasserted, and all four are real rather than pedantic:
  //
  //   1. A member of tenant A was never probed against tenant A's *own*
  //      privileged reads. Every `requireOrgPermission` on the read routes could
  //      be widened to `requireOrgMembership` and the suite would stay green,
  //      which would hand the invitation list and the audit log to every
  //      score_handler in every club.
  //   2. The entitled readers - the owner and the platform admin - were only ever
  //      used as snapshot *ground truth*. A snapshot tolerates a 403 (it just
  //      stringifies the error body), so a regression that locked the owner or
  //      the whole Admin app out of every organization screen would not fail one
  //      assertion in the file.
  //   3. `isPlatformAdmin` is a blanket bypass over every org-scoped route, and
  //      no test asserted that the bypass still works. The Admin app's entire
  //      reason to exist is that access, so a regression here breaks the product
  //      silently.
  //   4. Three create routes were only ever exercised on their success path, so
  //      their gates were never shown to actually gate.
  //
  // These blocks are appended, not interleaved: every snapshot-based denial above
  // has already run against an intact victim by the time they execute, so the
  // permitted writes below may consume the victims without invalidating a
  // recorded verdict.

  describe("intra-tenant privilege boundary", () => {
    test("a score_handler reads its own roster and overview, but not invitations, the audit log or the team manage view", async () => {
      // orgAMember holds exactly [score_match, view_analytics]. Reading is a
      // membership-level right; the three surfaces below are permission-gated, so
      // this is the boundary between "our member" and "our manager".
      const { orgId } = v();
      const api = world.actors.orgAMember.api;

      for (const suffix of ["/members", "/overview"]) {
        await assertPermitted({
          api,
          method: "get",
          path: `/organizations/${orgId}${suffix}`,
          label: `own-tenant read ${suffix} as orgAMember`,
        });
      }

      for (const suffix of ["/invitations", "/audit-log", "/teams/manage"]) {
        await assertRefused({
          api,
          method: "get",
          path: `/organizations/${orgId}${suffix}`,
          label: `own-tenant privileged read ${suffix} as orgAMember`,
        });
      }
    });
  });

  describe("entitled readers", () => {
    test("the owner and the platform admin can still read every org-scoped surface", async () => {
      // The complement of the denials above. Without this, "the snapshot helper
      // quietly stopped working" is indistinguishable from "the owner was locked
      // out".
      const { orgId } = v();
      const surfaces = ["/members", "/invitations", "/audit-log", "/teams/manage", "/access", "/overview"];
      for (const actorName of ["owner", "admin"]) {
        const api = world.actors[actorName].api;
        for (const suffix of surfaces) {
          await assertPermitted({
            api,
            method: "get",
            path: `/organizations/${orgId}${suffix}`,
            label: `entitled read ${suffix} as ${actorName}`,
          });
        }
      }
    });
  });

  describe("platform supervision", () => {
    test("the platform admin may write inside a tenant it holds no membership in", async () => {
      const { orgId, memberUserId, teamId, playerId } = v();

      await assertPermitted({
        api: world.actors.admin.api,
        method: "put",
        path: `/organizations/${orgId}`,
        body: { description: `${TEST_PREFIX}AdminSupervisedOrg` },
        label: "organization update as admin",
      });

      await assertPermitted({
        api: world.actors.admin.api,
        method: "patch",
        path: `/organizations/${orgId}/members/${memberUserId}`,
        body: { roles: ["player", "score_handler"] },
        label: "membership update as admin",
      });

      // Team, created and renamed through the tenant-scoped routes. If the
      // platform-admin bypass in orgAccess.js stopped applying, these 403.
      const created = await assertPermitted({
        api: world.actors.admin.api,
        method: "post",
        path: `/organizations/${orgId}/teams`,
        body: { name: `${TEST_PREFIX}AdminSupervised_${world.runId}` },
        label: "team create as admin",
      });
      const supervisedId = String(created.body?.team?._id || created.body?._id || "");
      assert.ok(supervisedId, `admin team create returned no id: ${JSON.stringify(created.body)}`);

      await assertPermitted({
        api: world.actors.admin.api,
        method: "patch",
        path: `/organizations/${orgId}/teams/${supervisedId}`,
        body: { name: `${TEST_PREFIX}AdminRenamed_${world.runId}` },
        label: "team update as admin",
      });

      // The global, non-org-scoped write routes, which the suite already proves
      // are refused to every other principal. Same gate, other side of it.
      await assertPermitted({
        api: world.actors.admin.api,
        method: "put",
        path: `/teams/${teamId}`,
        body: { name: `${TEST_PREFIX}AdminGlobalTeam_${world.runId}` },
        label: "global team update as admin",
      });
      await assertPermitted({
        api: world.actors.admin.api,
        method: "put",
        path: `/matches/${v().matchId}`,
        body: { title: `${TEST_PREFIX}AdminGlobalMatch_${world.runId}` },
        label: "global match update as admin",
      });
      await assertPermitted({
        api: world.actors.admin.api,
        method: "put",
        path: `/players/${playerId}`,
        body: { name: `${TEST_PREFIX}AdminGlobalPlayer_${world.runId}` },
        label: "global player update as admin",
      });
      await assertPermitted({
        api: world.actors.admin.api,
        method: "put",
        path: `/tournaments/${v().tournamentId}`,
        body: { name: `${TEST_PREFIX}AdminTournament_${world.runId}` },
        label: "tournament update as admin",
      });
    });

    test("the platform admin may add a member to any tenant", async () => {
      // `requireOrgPermission(INVITE_MEMBERS)` is bypassed for platform admins,
      // which is what lets the Admin app fix a club that invited nobody.
      const { orgId } = v();
      const res = await world.actors.admin.api.post(
        `/organizations/${orgId}/members`,
        { email: world.actors.verified.email, roles: ["player"] },
      );
      assert.ok(res.status < 500, `membership create as admin returned ${res.status}`);
      assert.ok(
        res.status >= 200 && res.status < 300,
        `FAIL platform admin was refused membership management: POST /organizations/${orgId}/members answered ${res.status} - ${JSON.stringify(res.body)}`,
      );
    });

    test("a destructive verb is still reachable for the principals entitled to it", async () => {
      // The suite is non-destructive everywhere else, so the success side of
      // DELETE is only asserted here, against fixtures nothing else reads. Two
      // throwaway matches exist precisely so the tenant-scoped owner path and the
      // global platform-admin path can both be proven without one eating the
      // other's fixture.
      await assertPermitted({
        api: world.actors.owner.api,
        method: "delete",
        path: `/organizations/${v().orgId}/matches/${world.disposable.matchId}`,
        label: "tenant match delete as owner",
      });

      await assertPermitted({
        api: world.actors.admin.api,
        method: "delete",
        path: `/matches/${world.disposable.adminMatchId}`,
        label: "global match delete as admin",
      });

      // Tournaments are platform-wide, so the entitled principal is the platform
      // admin on every verb. Created and removed here rather than reusing the
      // victim tournament, whose snapshot the denial blocks still need.
      const created = await assertPermitted({
        api: world.actors.admin.api,
        method: "post",
        path: "/tournaments",
        body: {
          name: `${TEST_PREFIX}P11_Throwaway_${world.runId}`,
          shortName: `P11X${world.runId}`.slice(0, 12),
          type: "knockout",
          startDate: "2026-01-01",
          endDate: "2026-02-01",
          teams: [v().teamId, v().otherTeamId],
        },
        label: "tournament create as admin",
      });
      const throwawayId = String(created.body?.tournament?._id || created.body?._id || "");
      assert.ok(throwawayId, `admin tournament create returned no id: ${JSON.stringify(created.body)}`);

      await assertPermitted({
        api: world.actors.admin.api,
        method: "delete",
        path: `/tournaments/${throwawayId}`,
        label: "tournament delete as admin",
      });
    });
  });

  describe("creation gates", () => {
    test("only an organization_admin account or a platform admin may create an organization", async () => {
      // Every actor below is a `player` account type or unauthenticated, so
      // requireOrgAdminType must refuse all of them - including a suspended one,
      // which is an account-status question that the route-level check would
      // otherwise never reach.
      for (const actorName of ["anonymous", "verified", "orgAMember", "orgBMember", "suspended"]) {
        await assertRefused({
          api: world.actors[actorName].api,
          method: "post",
          path: "/organizations",
          body: { name: `${TEST_PREFIX}P11_OrgCreate_${world.runId}_${actorName}`, type: "club" },
          label: `organization create as ${actorName}`,
        });
      }
    });

    test("only a platform admin may create a tournament", async () => {
      // Tournaments are platform-wide, not tenant-owned, so even the owner of a
      // club cannot mint one. The existing block proves PUT and DELETE are gated;
      // POST was only ever exercised on its success path.
      for (const actorName of ["anonymous", "verified", "orgAMember", "orgBMember", "owner", "suspended"]) {
        await assertRefused({
          api: world.actors[actorName].api,
          method: "post",
          path: "/tournaments",
          body: {
            name: `${TEST_PREFIX}P11_Tourn_${world.runId}_${actorName}`,
            shortName: `P11T${world.runId}`.slice(0, 12),
            type: "league",
            startDate: "2026-01-01",
            endDate: "2026-02-01",
            teams: [v().teamId, v().otherTeamId],
          },
          label: `tournament create as ${actorName}`,
        });
      }
    });

    test("a player profile needs an authenticated, unsuspended account", async () => {
      // Self-service profile creation was open to anybody until the schema split;
      // only the permitted path was covered, never the two principals that must
      // be turned away.
      for (const actorName of ["anonymous", "suspended"]) {
        await assertRefused({
          api: world.actors[actorName].api,
          method: "post",
          path: "/players",
          body: { name: `${TEST_PREFIX}P11_AnonPlayer_${world.runId}_${actorName}` },
          label: `player create as ${actorName}`,
        });
      }
    });
  });
});
