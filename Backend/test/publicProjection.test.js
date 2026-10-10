import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";

import mongoose from "mongoose";
import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import User from "../src/models/User.js";
import Admin from "../src/models/Admin.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import TeamOrganization from "../src/models/TeamOrganization.js";
import TeamCategory from "../src/models/TeamCategory.js";
import Membership from "../src/models/Membership.js";
import AuditLog from "../src/models/AuditLog.js";
import { createOrganization } from "../src/controllers/organizationController.js";
import { getPlayers, getPlayer, getPlayerRanking, listFreeAgents } from "../src/controllers/playerController.js";
import {
  listTeams,
  getTeam,
  getTeamPlayers,
  updateTeam as adminUpdateTeam,
} from "../src/controllers/teamsController.js";
import { getOrganizationTeams } from "../src/controllers/organizationController.js";
import { listOrgTeams, createOrgTeam } from "../src/controllers/orgTeamsController.js";
import { getFreeAgents } from "../src/services/playerService.js";
import { getTeamPlayerRankings } from "../src/services/rankingService.js";
import {
  PLAYER_PUBLIC_FIELDS,
  TEAM_PUBLIC_FIELDS,
  PLAYER_ROSTER_FIELDS,
  resolveViewerContext,
  sanitizePlayerPublic,
  sanitizeTeamPublic,
  anonymousViewer,
} from "../src/utils/publicProjection.js";

let mongod;

before(async () => {
  mongod = await startTestDb();
  // Round 5: several tests assert that the *database* rejects a duplicate team
  // name, which is the whole point of the partial unique indexes. Mongoose
  // builds indexes in the background after connect, so without waiting for init
  // the first inserts would race the index build and the test would pass or fail
  // by luck.
  await Team.init();
});

after(async () => {
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Admin.deleteMany({}),
    Team.deleteMany({}),
    Player.deleteMany({}),
    TeamOrganization.deleteMany({}),
    TeamCategory.deleteMany({}),
    Membership.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);
  await TeamCategory.seedDefaults();
});

let counter = 0;
async function makeUser(overrides = {}) {
  counter += 1;
  return User.create({
    name: `Proj Person ${counter}`,
    email: `proj-${counter}-${Math.random().toString(36).slice(2, 8)}@openctest.dev`,
    password: "password-123",
    role: "scorer",
    accountType: "organization_admin",
    emailVerified: true,
    ...overrides,
  });
}

async function makeOrg(owner, name = "Projection Org") {
  const res = mockRes();
  await createOrganization(mockReq({ user: owner, principalType: "user", body: { name } }), res);
  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
  return res.body.organization;
}

/**
 * A player carrying every field the audit flagged as a leak, so a test fails if
 * any of them reaches an anonymous caller.
 */
async function makeFullyLoadedPlayer(overrides = {}) {
  counter += 1;
  return Player.create({
    name: `Loaded Player ${counter}`,
    playingRole: "Batsman",
    battingStyle: "Right-handed",
    imageUrl: "http://x/p.jpg",
    address: { town: "Town", district: "District", city: "Lahore", province: "Punjab", country: "Pakistan" },
    birthInfo: { date: new Date("1990-05-17"), place: "Lahore" },
    gallery: [{ url: "http://x/g1.jpg", caption: "g", addedAt: new Date() }],
    videos: [{ url: "http://x/v1.mp4", title: "v", addedAt: new Date() }],
    socialLinks: { facebook: "fb", instagram: "ig", twitter: "", youtube: "", whatsapp: "" },
    stats: { runs: 100, wickets: 5 },
    ...overrides,
  });
}

async function makeAdmin(username) {
  counter += 1;
  return Admin.create({
    name: `Root ${username}`,
    email: `${username}-${counter}@openctest.dev`,
    username,
    password: "password-123",
    role: "superadmin",
  });
}

/** An anonymous request; `overrides` is merged over the empty defaults. */
const anon = (overrides = {}) => mockReq({ query: {}, params: {}, ...overrides });

// ===========================================================================
// 1. The exact public key set
// ===========================================================================

test("public player key set is exactly the whitelist — nothing else can appear", async () => {
  const player = await makeFullyLoadedPlayer({ createdBy: (await makeUser())._id });
  const body = sanitizePlayerPublic(player.toObject(), {});

  assert.deepStrictEqual(
    Object.keys(body).sort(),
    [...PLAYER_PUBLIC_FIELDS].sort(),
    "the public body must be the whitelist and nothing more",
  );
  for (const leaked of ["createdBy", "birthInfo", "__v", "isSeed", "seedSource", "seedVersion"]) {
    assert.ok(!(leaked in body), `${leaked} must not appear in a public player body`);
  }
});

test("public team key set is exactly the whitelist", async () => {
  const team = await Team.create({
    name: `Whitelist Team ${counter}`,
    phone: "0300-1234567",
    email: "team@example.test",
    latitude: 31.5,
    longitude: 74.3,
    managedBy: (await makeUser())._id,
    players: [],
  });
  const body = sanitizeTeamPublic(team.toObject(), {});

  assert.deepStrictEqual(
    Object.keys(body).sort(),
    [...TEAM_PUBLIC_FIELDS].sort(),
    "the public body must be the whitelist and nothing more",
  );
  for (const leaked of ["managedBy", "isInternal", "__v", "isSeed", "seedSource", "seedVersion"]) {
    assert.ok(!(leaked in body), `${leaked} must not appear in a public team body`);
  }
});

test("REGRESSION: a brand-new field added to the Player schema is not exposed by default", async () => {
  // The point of a whitelist. Adding a column to Player.js must not widen the
  // public body; the schema is read so this fails loudly if someone adds a path
  // that the whitelist does not already cover.
  const schemaPaths = Object.keys(Player.schema.paths)
    .filter((p) => !["_id", "__v"].includes(p))
    // `schema.paths` is flat and dotted ("address.city"); the whitelist is in
    // top-level terms, so compare like with like.
    .map((p) => p.split(".")[0]);
  const intentionallyWithheld = new Set([
    // No privacy flag opts date of birth in, and these are internal provenance
    // rather than profile data. `gallery`/`videos` are deliberately NOT listed:
    // they are on the whitelist and gated by `privacy.gallery`/`privacy.videos`.
    "birthInfo",
    "createdBy",
    "isSeed",
    "seedSource",
    "seedVersion",
    // oct11-A data-entry fields kept off the public surface: `phone` is a
    // contact detail (a phone number must not reach a public profile) and
    // `isPartTimeBowler` is a classification nothing public renders.
    // `jerseyNumber` is NOT withheld — the public player page renders it, so it
    // lives on PLAYER_PUBLIC_FIELDS instead.
    "phone",
    "isPartTimeBowler",
  ]);
  const unaccountedFor = schemaPaths.filter(
    (p) => !PLAYER_PUBLIC_FIELDS.includes(p) && !intentionallyWithheld.has(p),
  );

  assert.deepStrictEqual(
    unaccountedFor,
    [],
    "every Player schema path must be either on the public whitelist or listed as deliberately withheld",
  );

  // And the live behaviour: a field present on the document but not on the
  // whitelist is dropped.
  const player = await makeFullyLoadedPlayer();
  const raw = player.toObject();
  raw.someBrandNewField = "should not survive";
  const body = sanitizePlayerPublic(raw, {});
  assert.ok(!("someBrandNewField" in body), "an unlisted field is dropped even when present on the document");
});

// ===========================================================================
// 2. Privacy flags, on and off
// ===========================================================================

test("privacy off: location, social links and media are visible, DOB never is", async () => {
  const player = await makeFullyLoadedPlayer({
    privacy: { contactInfo: "public", socialLinks: "public", location: "public", gallery: "public", videos: "public" },
  });
  const body = sanitizePlayerPublic(player.toObject(), {});

  assert.strictEqual(body.address.city, "Lahore", "location public keeps the city");
  assert.strictEqual(body.socialLinks.instagram, "ig", "socialLinks public keeps the handle");
  assert.ok(!("birthInfo" in body), "no privacy flag opts date of birth in, so it is withheld");

  // Round 5: these flags used to be inert. `gallery`/`videos` were not on the
  // whitelist, so the `hidden` branches could never fire and a player who had
  // chosen "public" still saw no media of their own.
  assert.strictEqual(body.gallery.length, 1, "gallery public keeps the photo");
  assert.strictEqual(body.gallery[0].url, "http://x/g1.jpg");
  assert.strictEqual(body.videos.length, 1, "videos public keeps the clip");
  assert.strictEqual(body.videos[0].url, "http://x/v1.mp4");
});

test("privacy on: gallery and videos are blanked, not dropped", async () => {
  const player = await makeFullyLoadedPlayer({
    privacy: { contactInfo: "public", socialLinks: "public", location: "public", gallery: "hidden", videos: "hidden" },
  });
  const body = sanitizePlayerPublic(player.toObject(), {});

  // Blanked, not removed: the key set stays stable so a consumer can read
  // `player.gallery` without checking whether the record had one.
  assert.ok("gallery" in body, "the key is still present when the media is hidden");
  assert.deepStrictEqual(body.gallery, []);
  assert.ok("videos" in body);
  assert.deepStrictEqual(body.videos, []);
  assert.deepStrictEqual(Object.keys(body).sort(), [...PLAYER_PUBLIC_FIELDS].sort());
});

test("privacy on: location is blanked and social links are emptied", async () => {
  const player = await makeFullyLoadedPlayer({
    privacy: { contactInfo: "public", socialLinks: "hidden", location: "hidden" },
  });
  const body = sanitizePlayerPublic(player.toObject(), {});

  for (const field of ["town", "district", "city", "province", "country"]) {
    assert.strictEqual(body.address[field], "", `${field} must be blanked when location is hidden`);
  }
  for (const key of Object.keys(body.socialLinks)) {
    assert.strictEqual(body.socialLinks[key], "", `${key} must be blanked when socialLinks is hidden`);
  }
});

test("team privacy: contactInfo and location flags gate phone, email, coordinates", async () => {
  const hidden = await Team.create({
    name: `Hidden Team ${counter}`,
    phone: "0300-0000000",
    email: "hidden@example.test",
    website: "https://example.test",
    fullAddress: "12 Private Road",
    latitude: 31.5,
    longitude: 74.3,
    address: { town: "T", district: "D", city: "Lahore", province: "P", country: "Pakistan" },
    privacy: { contactInfo: "hidden", socialLinks: "hidden", location: "hidden" },
  });
  const body = sanitizeTeamPublic(hidden.toObject(), {});
  assert.strictEqual(body.phone, "");
  assert.strictEqual(body.email, "");
  assert.strictEqual(body.website, "");
  assert.strictEqual(body.fullAddress, "");
  assert.strictEqual(body.latitude, "");
  assert.strictEqual(body.longitude, "");
  assert.strictEqual(body.address.city, "");

  const shown = await Team.create({
    name: `Shown Team ${counter}`,
    phone: "0300-1111111",
    email: "shown@example.test",
    latitude: 31.5,
    privacy: { contactInfo: "public", socialLinks: "public", location: "public" },
  });
  const shownBody = sanitizeTeamPublic(shown.toObject(), {});
  assert.strictEqual(shownBody.phone, "0300-1111111");
  assert.strictEqual(shownBody.email, "shown@example.test");
  assert.strictEqual(shownBody.latitude, 31.5);
});

// ===========================================================================
// 3. Owner / org manager / platform admin escalation
// ===========================================================================

test("the creator sees their own full document, a stranger does not", async () => {
  const creator = await makeUser();
  const player = await makeFullyLoadedPlayer({ createdBy: creator._id });

  const ownerViewer = await resolveViewerContext({ user: creator, principalType: "user" });
  const ownerBody = sanitizePlayerPublic(player.toObject(), { viewer: ownerViewer });
  assert.ok(ownerBody.birthInfo, "the creator keeps date of birth on their own profile");
  assert.ok(Array.isArray(ownerBody.gallery));
  assert.strictEqual(String(ownerBody.createdBy), String(creator._id));

  const strangerViewer = await resolveViewerContext({ user: await makeUser(), principalType: "user" });
  const strangerBody = sanitizePlayerPublic(player.toObject(), { viewer: strangerViewer });
  assert.ok(!strangerBody.birthInfo, "an unrelated account must not see date of birth");
  assert.ok(!strangerBody.createdBy);
});

test("a manager of the owning organization sees the full player document", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, "Managed Players Org");
  const team = await Team.create({ name: `Managed XI ${counter}`, organizationRef: org._id });
  const player = await makeFullyLoadedPlayer({ team: team._id, createdBy: (await makeUser())._id });

  const managerViewer = await resolveViewerContext({ user: owner, principalType: "user" });
  const body = sanitizePlayerPublic(player.toObject(), {
    viewer: managerViewer,
    playerOrgId: String(org._id),
  });
  assert.ok(body.birthInfo, "the owning organization's manager keeps full access");

  const outsider = await makeUser();
  const outsiderViewer = await resolveViewerContext({ user: outsider, principalType: "user" });
  const outsiderBody = sanitizePlayerPublic(player.toObject(), {
    viewer: outsiderViewer,
    playerOrgId: String(org._id),
  });
  assert.ok(!outsiderBody.birthInfo, "an outsider does not");
});

test("a platform admin sees everything, an anonymous viewer sees the projection", async () => {
  const admin = await makeAdmin("root");
  const player = await makeFullyLoadedPlayer();

  const adminViewer = await resolveViewerContext({ user: admin, principalType: "admin" });
  assert.strictEqual(adminViewer.isPlatformAdmin, true);
  assert.ok(sanitizePlayerPublic(player.toObject(), { viewer: adminViewer }).birthInfo);

  assert.strictEqual(anonymousViewer().isPlatformAdmin, false);
  assert.strictEqual(anonymousViewer().userId, null);
  assert.ok(!sanitizePlayerPublic(player.toObject(), {}).birthInfo);
});

// ===========================================================================
// 4. Every public read endpoint
// ===========================================================================

test("GET /players — anonymous response is the public projection", async () => {
  await makeFullyLoadedPlayer({ name: "Listable One" });
  const res = mockRes();
  await getPlayers(anon(), res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.players.length, 1);
  const [row] = res.body.players;
  assert.deepStrictEqual(Object.keys(row).sort(), [...PLAYER_PUBLIC_FIELDS].sort());
  for (const leaked of ["createdBy", "birthInfo"]) {
    assert.ok(!(leaked in row), `${leaked} leaked from GET /players`);
  }
});

test("GET /players/:id — anonymous response is the public projection", async () => {
  const player = await makeFullyLoadedPlayer();
  const res = mockRes();
  await getPlayer(anon({ params: { id: String(player._id) } }), res);

  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(Object.keys(res.body).sort(), [...PLAYER_PUBLIC_FIELDS].sort());
  assert.ok(!("createdBy" in res.body));
  assert.ok(!("birthInfo" in res.body));
});

test("GET /players/ranking — paginated, projected, and bounded", async () => {
  const many = [];
  for (let i = 0; i < 60; i += 1) {
    many.push(await makeFullyLoadedPlayer({ name: `Ranked ${i}` }));
  }
  void many;

  const res = mockRes();
  await getPlayerRanking(anon({ query: { limit: "25" } }), res);

  assert.strictEqual(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.items));
  assert.strictEqual(res.body.items.length, 25, "the limit is honoured");
  assert.strictEqual(res.body.total, 60);
  assert.strictEqual(res.body.totalPages, 3);
  for (const leaked of ["createdBy", "birthInfo"]) {
    assert.ok(!(leaked in res.body.items[0]), `${leaked} leaked from GET /players/ranking`);
  }

  // Hard ceiling: a caller asking for everything is capped.
  const greedy = mockRes();
  await getPlayerRanking(anon({ query: { limit: "100000" } }), greedy);
  assert.ok(greedy.body.items.length <= 200, "a huge limit is clamped");
});

test("GET /players/free-agents — projected and bounded", async () => {
  await makeFullyLoadedPlayer({ name: "Unattached One" });
  const res = mockRes();
  await listFreeAgents(anon(), res);
  assert.strictEqual(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.items));
  assert.deepStrictEqual(Object.keys(res.body.items[0]).sort(), [...PLAYER_PUBLIC_FIELDS].sort());
  assert.ok(!("birthInfo" in res.body.items[0]), "the free-agents list is not the one place the projection is skipped");
});

test("GET /teams/:id/players — the roster is projected for anonymous callers", async () => {
  const team = await Team.create({ name: `Squad XI ${counter}` });
  await makeFullyLoadedPlayer({ name: "Squad Player", team: team._id });

  const res = mockRes();
  await getTeamPlayers(anon({ params: { id: String(team._id) } }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.length, 1);
  assert.deepStrictEqual(Object.keys(res.body[0]).sort(), [...PLAYER_PUBLIC_FIELDS].sort());
  for (const leaked of ["createdBy", "birthInfo"]) {
    assert.ok(!(leaked in res.body[0]), `${leaked} leaked from GET /teams/:id/players`);
  }
});

test("GET /teams/:id/players — the owning organization's manager sees their own player in full", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, "Squad Owner Org");
  const team = await Team.create({ name: `Managed Squad ${counter}`, organizationRef: org._id });
  await makeFullyLoadedPlayer({ name: "Managed Squad Player", team: team._id });

  const res = mockRes();
  await getTeamPlayers(
    mockReq({ user: owner, principalType: "user", params: { id: String(team._id) }, query: {} }),
    res,
  );
  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body[0].birthInfo, "a manager keeps full access to their own roster");
});

test("GET /rankings-v2/players/team/:teamId — embedded player is projected", async () => {
  const team = await Team.create({ name: `Ranked XI ${counter}` });
  await makeFullyLoadedPlayer({ name: "Embedded One", team: team._id });

  const rows = await getTeamPlayerRankings(String(team._id));
  assert.strictEqual(rows.length, 1);
  for (const leaked of ["createdBy", "birthInfo"]) {
    assert.ok(!(leaked in rows[0].player), `${leaked} leaked from the team ranking embed`);
  }
  // The ranking arithmetic downstream still needs stats and _id.
  assert.strictEqual(rows[0].teamRuns, 100);
  assert.ok(rows[0].teamPlayerRating > 0);
});

test("GET /teams — anonymous list includes public, but not private, organization-owned teams", async () => {
  // Create the admin first: `makeAdmin` advances the shared fixture counter, so
  // building it after the teams would make the assertion look for the wrong name.
  const admin = await makeAdmin("catalogue");
  const owner = await makeUser();
  const org = await makeOrg(owner, "Tenant Org");
  await Team.create({
    name: `Private Tenant ${counter}`,
    organizationRef: org._id,
    isPublic: false,
  });
  await Team.create({
    name: `Public Tenant ${counter}`,
    organizationRef: org._id,
    isPublic: true,
  });
  await Team.create({ name: `Public Platform ${counter}` });

  const res = mockRes();
  await listTeams(anon(), res);
  const names = res.body.map((t) => t.name);
  assert.ok(!names.some((n) => n.startsWith("Private Tenant")), "private org-owned teams are not in the public list");
  assert.ok(names.includes(`Public Tenant ${counter}`), "public org-owned teams are in the public list");
  assert.ok(names.includes(`Public Platform ${counter}`), "org-less platform teams are");

  // Naming the scope or the organization describes *which* teams, not *whether*
  // private ones are revealed. Fix B pins that: a stranger never sees a private
  // team, no matter which query shape they use.
  const scoped = mockRes();
  await listTeams(anon({ query: { scope: "organization" } }), scoped);
  assert.ok(
    !scoped.body.some((t) => t.name.startsWith("Private Tenant")),
    "?scope=organization does not reveal a private team to a stranger",
  );

  const byOrg = mockRes();
  await listTeams(anon({ query: { organizationRef: String(org._id) } }), byOrg);
  assert.ok(
    !byOrg.body.some((t) => t.name.startsWith("Private Tenant")),
    "naming an organization does not reveal a private team to a stranger",
  );
  assert.ok(
    byOrg.body.some((t) => t.name === `Public Tenant ${counter}`),
    "the organization's public teams are still visible",
  );

  // The platform admin is the one viewer the visibility filter does not apply
  // to — the Admin app's own catalogue depends on it.
  const adminRes = mockRes();
  await listTeams(mockReq({ user: admin, principalType: "admin", query: {} }), adminRes);
  assert.ok(
    adminRes.body.some((t) => t.name === `Private Tenant ${counter}`),
    "a platform admin still sees private teams",
  );
});

test("GET /teams — a reserved fixture name is hidden from the public list and search", async () => {
  // Fix B: the e2e/bootstrap fixtures carry reserved prefixes. They must not
  // surface on any public read even though they are otherwise ordinary teams.
  await Team.create({ name: `E2E_Leaky_XI_${counter}`, isPublic: true });

  const listed = mockRes();
  await listTeams(anon(), listed);
  assert.ok(
    !listed.body.some((t) => t.name.startsWith("E2E_Leaky_XI_")),
    "a reserved-name team is absent from the anonymous catalogue",
  );

  const searched = mockRes();
  await listTeams(anon({ query: { search: "E2E_Leaky" } }), searched);
  assert.ok(
    !searched.body.some((t) => t.name.startsWith("E2E_Leaky_XI_")),
    "searching its name does not surface a reserved fixture",
  );

  // A platform admin still sees it, so the fixtures remain debuggable.
  const admin = await makeAdmin("fixture");
  const adminRes = mockRes();
  await listTeams(mockReq({ user: admin, principalType: "admin", query: {} }), adminRes);
  assert.ok(
    adminRes.body.some((t) => t.name.startsWith("E2E_Leaky_XI_")),
    "a platform admin can still see fixture teams",
  );
});

test("GET /teams — an unpublished org-owned team stays out even when the name is searched", async () => {
  // Regression: the tenancy filter and the free-text filter were both written to
  // `query.$or`, so `?search=` replaced the tenancy clause outright. Keep the
  // private fixture explicit so this also catches a search bypass of isPublic.
  const owner = await makeUser();
  const org = await makeOrg(owner, "Searchable Tenant Org");
  await Team.create({
    name: `Findable Secret ${counter}`,
    organizationRef: org._id,
    isPublic: false,
  });

  const res = mockRes();
  await listTeams(anon({ query: { search: "Findable" } }), res);
  const names = res.body.map((t) => t.name);
  assert.ok(
    !names.some((n) => n.startsWith("Findable Secret")),
    "a matching search term must not bypass the tenancy filter",
  );
});

test("GET /teams — isPublic defaults to true and org-owned teams appear in the public list", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, "Public By Default Org");

  const implicit = await Team.create({ name: `Default Public ${counter}`, organizationRef: org._id });
  assert.strictEqual(implicit.isPublic, true, "new teams are public by default");

  const listed = mockRes();
  await listTeams(anon(), listed);
  assert.ok(
    listed.body.some((t) => t.name === `Default Public ${counter}`),
    "a default-public org-owned team is publicly listed",
  );
});

test("GET /teams — public list is sanitized (no managedBy)", async () => {
  await Team.create({ name: `Managed Public ${counter}`, managedBy: (await makeUser())._id });
  const res = mockRes();
  await listTeams(anon(), res);
  assert.ok(!("managedBy" in res.body[0]), "managedBy must not be in a public list");
});

test("GET /teams/:id — roster is projected, not whole player documents", async () => {
  const team = await Team.create({ name: `Detail XI ${counter}` });
  const player = await makeFullyLoadedPlayer({ name: "Rostered One", team: team._id });
  await Team.updateOne({ _id: team._id }, { $set: { players: [player._id] } });

  const res = mockRes();
  await getTeam(anon({ params: { id: String(team._id) } }), res);

  assert.strictEqual(res.statusCode, 200);
  const teamBody = res.body.data.team;
  assert.ok(!("managedBy" in teamBody));
  assert.strictEqual(teamBody.players.length, 1);
  const [rostered] = teamBody.players;
  assert.deepStrictEqual(
    Object.keys(rostered).sort(),
    [...PLAYER_ROSTER_FIELDS].sort(),
    "a roster entry is the roster projection",
  );
  for (const leaked of ["birthInfo", "gallery", "videos", "createdBy", "address", "stats"]) {
    assert.ok(!(leaked in rostered), `${leaked} leaked through the team roster`);
  }
});

test("GET /organizations/:id/teams — the public org page does not leak player documents", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, "Public Org Page");
  const team = await Team.create({ name: `Org Page XI ${counter}`, organizationRef: org._id });
  const player = await makeFullyLoadedPlayer({ name: "Org Page Player", team: team._id });
  await Team.updateOne({ _id: team._id }, { $set: { players: [player._id] } });

  const res = mockRes();
  await getOrganizationTeams(anon({ params: { id: String(org._id) } }), res);

  assert.strictEqual(res.statusCode, 200);
  const [row] = res.body;
  assert.ok(!("managedBy" in row));
  assert.strictEqual(row.players.length, 1);
  const [rostered] = row.players;
  assert.deepStrictEqual(Object.keys(rostered).sort(), [...PLAYER_ROSTER_FIELDS].sort());
  assert.ok(!("birthInfo" in rostered), "date of birth must not reach the public org page");
  assert.ok(!("createdBy" in rostered));
});

test("orgTeamsController teamPayload honours the roster projection and keeps playerCount", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner, "Payload Org");
  const res = mockRes();
  await createOrgTeam(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id) },
      body: { name: `Payload Team ${counter}`, category: "Club" },
      org,
      orgAccess: { via: "membership", roles: ["owner"], permissions: [] },
    }),
    res,
  );
  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
  assert.strictEqual(res.body.team.playerCount, 0, "playerCount survives the sanitizer");

  const listRes = mockRes();
  await listOrgTeams(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id) },
      query: {},
      org,
      orgAccess: { via: "membership", roles: ["owner"], permissions: [] },
    }),
    listRes,
  );
  assert.strictEqual(listRes.statusCode, 200);
  assert.strictEqual(listRes.body.items.length, 1);
  assert.ok(!("managedBy" in listRes.body.items[0]));
});

// ===========================================================================
// 5. Team tenancy: per-organization name uniqueness
// ===========================================================================

test("two organizations may each own a team with the same name", async () => {
  const a = await makeOrg(await makeUser(), "Org A");
  const b = await makeOrg(await makeUser(), "Org B");

  const first = await Team.create({ name: "Rising Stars", organizationRef: a._id });
  const second = await Team.create({ name: "Rising Stars", organizationRef: b._id });

  assert.ok(first._id);
  assert.ok(second._id);
  assert.notStrictEqual(String(first._id), String(second._id));
});

test("the same organization may not hold two teams with the same name", async () => {
  const a = await makeOrg(await makeUser(), "Org A");
  await Team.create({ name: "Rising Stars", organizationRef: a._id });

  await assert.rejects(
    () => Team.create({ name: "Rising Stars", organizationRef: a._id }),
    /duplicate key/i,
    "the compound unique index rejects the second one",
  );
});

test("org-less platform teams keep global name uniqueness", async () => {
  await Team.create({ name: "Global Platform XI" });
  await assert.rejects(
    () => Team.create({ name: "Global Platform XI" }),
    /duplicate key/i,
    "an org-less name still collides platform-wide",
  );
});

test("name uniqueness is case-insensitive", async () => {
  const a = await makeOrg(await makeUser(), "Case Org");
  await Team.create({ name: "Strikers", organizationRef: a._id });
  await assert.rejects(
    () => Team.create({ name: "strikers", organizationRef: a._id }),
    /duplicate key/i,
    "case does not create a second team",
  );
});

test("teamService.createTeam refuses a duplicate inside one organization and allows it across two", async () => {
  const teamService = await import("../src/services/teamService.js");
  const a = await makeOrg(await makeUser(), "Svc Org A");
  const b = await makeOrg(await makeUser(), "Svc Org B");

  await teamService.createTeam({ name: "Coastal XI", organizationRef: a._id });

  await assert.rejects(
    () => teamService.createTeam({ name: "Coastal XI", organizationRef: a._id }),
    /already exists/i,
  );
  await assert.rejects(
    () => teamService.createTeam({ name: "coastal xi", organizationRef: a._id }),
    /already exists/i,
    "the service check is case-insensitive like the index",
  );

  const other = await teamService.createTeam({ name: "Coastal XI", organizationRef: b._id });
  assert.ok(other._id, "a different organization may reuse the name");
});

test("teamService.updateTeam keeps a rename inside the owning organization", async () => {
  const teamService = await import("../src/services/teamService.js");
  const a = await makeOrg(await makeUser(), "Update Org A");
  const b = await makeOrg(await makeUser(), "Update Org B");
  await teamService.createTeam({ name: "Alpha XI", organizationRef: a._id });
  await teamService.createTeam({ name: "Beta XI", organizationRef: b._id });
  await teamService.createTeam({ name: "Gamma XI", organizationRef: a._id });
  const alpha = await Team.findOne({ name: "Alpha XI" });

  // A name held by a *different* organization is a legal rename: that is the whole
  // point of per-organization uniqueness.
  const renamedAcross = await teamService.updateTeam(String(alpha._id), { name: "Beta XI" });
  assert.strictEqual(renamedAcross.name, "Beta XI", "another organization's name is not a collision");

  // A name already held inside the *same* organization is not.
  const gamma = await Team.findOne({ name: "Gamma XI" });
  await assert.rejects(
    () => teamService.updateTeam(String(gamma._id), { name: "Beta XI" }),
    /already exists/i,
    "renaming onto a name the same organization already uses is refused",
  );
});

// ===========================================================================
// 6. Platform-admin org move / orphan guard
// ===========================================================================

test("PUT /teams/:id refuses to move a team between organizations without the explicit flag", async () => {
  const a = await makeOrg(await makeUser(), "Move Org A");
  const b = await makeOrg(await makeUser(), "Move Org B");
  const team = await Team.create({ name: `Movable ${counter}`, organizationRef: a._id });

  const admin = await makeAdmin("mover");

  const refused = mockRes();
  await adminUpdateTeam(
    mockReq({ user: admin, principalType: "admin", params: { id: String(team._id) }, body: { organizationRef: String(b._id) } }),
    refused,
  );
  assert.strictEqual(refused.statusCode, 409);
  assert.strictEqual(refused.body.code, "TEAM_ORG_CHANGE_REQUIRES_FLAG");

  const still = await Team.findById(team._id);
  assert.ok(still.organizationRef.equals(a._id), "the team did not move");
});

test("PUT /teams/:id refuses to orphan a team without the explicit flag", async () => {
  const a = await makeOrg(await makeUser(), "Orphan Org");
  const team = await Team.create({ name: `Orphanable ${counter}`, organizationRef: a._id });
  const admin = await makeAdmin("orphaner");

  const refused = mockRes();
  await adminUpdateTeam(
    mockReq({ user: admin, principalType: "admin", params: { id: String(team._id) }, body: { organizationRef: null } }),
    refused,
  );
  assert.strictEqual(refused.statusCode, 409);
  assert.strictEqual(refused.body.code, "TEAM_ORG_CHANGE_REQUIRES_FLAG");
});

test("PUT /teams/:id performs and audits the move when the flag is present", async () => {
  const a = await makeOrg(await makeUser(), "Audited Org A");
  const b = await makeOrg(await makeUser(), "Audited Org B");
  const team = await Team.create({ name: `Audited ${counter}`, organizationRef: a._id });
  const admin = await makeAdmin("auditor");

  const res = mockRes();
  await adminUpdateTeam(
    mockReq({
      user: admin,
      principalType: "admin",
      params: { id: String(team._id) },
      body: { organizationRef: String(b._id), allowOrganizationChange: true },
    }),
    res,
  );
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));

  const moved = await Team.findById(team._id);
  assert.ok(moved.organizationRef.equals(b._id), "the team moved");
  assert.ok(!("allowOrganizationChange" in moved.toObject()), "the supervisory flag is not persisted");

  const audit = await AuditLog.findOne({ action: "team.organization_changed" });
  assert.ok(audit, "the organization change is audited");
  assert.strictEqual(audit.metadata.fromOrganization, String(a._id));
  assert.strictEqual(audit.metadata.toOrganization, String(b._id));
  assert.strictEqual(audit.actorType, "admin");
});

test("a no-op organizationRef (same value) is not treated as a move", async () => {
  const a = await makeOrg(await makeUser(), "NoOp Org");
  const team = await Team.create({ name: `NoOp ${counter}`, organizationRef: a._id });
  const admin = await makeAdmin("noop");

  const res = mockRes();
  await adminUpdateTeam(
    mockReq({
      user: admin,
      principalType: "admin",
      params: { id: String(team._id) },
      body: { organizationRef: String(a._id), description: "still fine" },
    }),
    res,
  );
  assert.strictEqual(res.statusCode, 200, "re-sending the same organization is not a move");
});

// ===========================================================================
// 7. The latent city bug
// ===========================================================================

test("updateTeamLocation writes city to address.city, not a phantom top-level field", async () => {
  const { updateTeamLocation } = await import("../src/controllers/teamsController.js");
  const team = await Team.create({
    name: `Located ${counter}`,
    address: { town: "", district: "", city: "", province: "", country: "Pakistan" },
  });

  const res = mockRes();
  await updateTeamLocation(mockReq({ params: { id: String(team._id) }, body: { city: "Multan" } }), res);
  assert.strictEqual(res.statusCode, 200);

  const stored = await Team.findById(team._id);
  assert.strictEqual(stored.address.city, "Multan", "the city actually persisted");
  assert.ok(!("city" in stored.toObject()), "no phantom top-level city field was invented");
  assert.strictEqual(res.body.applied.city, "Multan", "the response echoes what stuck");
});

test("teamService.createTeam keeps a flat city instead of dropping it", async () => {
  // The create path had the same latent bug the location endpoint did: a
  // top-level `city` was assigned to a field Team.js does not declare, so strict
  // mode discarded it and a city given at creation time was silently lost.
  const teamService = await import("../src/services/teamService.js");

  const flat = await teamService.createTeam({ name: `Flat City ${counter}`, city: "Multan" });
  assert.strictEqual(flat.address.city, "Multan", "a flat city lands in address.city");
  assert.ok(!("city" in flat.toObject()), "no phantom top-level city field was invented");

  // An explicit address object wins over the flat field rather than being
  // clobbered by it.
  const both = await teamService.createTeam({
    name: `Both City ${counter}`,
    city: "Ignored",
    address: { town: "T", district: "D", city: "Quetta", province: "B", country: "Pakistan" },
  });
  assert.strictEqual(both.address.city, "Quetta", "address.city is not overwritten by the flat field");
  assert.strictEqual(both.address.town, "T", "the rest of the address survives");

  // A flat city fills a gap in a partial address object.
  const partial = await teamService.createTeam({
    name: `Partial City ${counter}`,
    city: "Peshawar",
    address: { town: "T" },
  });
  assert.strictEqual(partial.address.city, "Peshawar");
});

test("getTeamProfile branches carry address, not a phantom city path", async () => {
  // The branch query selected `city`, which is not a Team path, so it silently
  // returned nothing for every branch. It must now come from `address`.
  const owner = await makeUser();
  const org = await makeOrg(owner, "Branch City Org");
  const team = await Team.create({
    name: `Branch Parent ${counter}`,
    organizationRef: org._id,
    address: { town: "", district: "", city: "Lahore", province: "", country: "Pakistan" },
  });
  await Team.create({
    name: `Branch Child ${counter}`,
    organizationRef: org._id,
    isActive: true,
    branchName: "Branch",
    address: { town: "", district: "", city: "Karachi", province: "", country: "Pakistan" },
  });

  const teamService = await import("../src/services/teamService.js");
  const profile = await teamService.getTeamProfile(String(team._id), null);
  const branch = profile.branches.find((b) => b.name === `Branch Child ${counter}`);
  assert.ok(branch, "the sibling branch is listed");
  assert.strictEqual(branch.address.city, "Karachi", "the branch's city is readable");
  assert.ok(!("city" in branch), "and still no invented top-level city field");
});

// ===========================================================================
// 8. Roster stays usable for the UI
// ===========================================================================

test("the roster projection still carries the fields the frontend renders", async () => {
  const team = await Team.create({ name: `UI Roster ${counter}` });
  const player = await makeFullyLoadedPlayer({
    name: "Rendered Player",
    team: team._id,
    role: "Batsman",
    playingRole: "Batsman",
    imageUrl: "http://x/p.jpg",
  });
  await Team.updateOne({ _id: team._id }, { $set: { players: [player._id] } });

  const res = mockRes();
  await getTeam(anon({ params: { id: String(team._id) } }), res);
  const [rostered] = res.body.data.team.players;

  // PlayerCard.jsx and the fixture squad editor render exactly these.
  for (const field of ["_id", "name", "role", "playingRole", "imageUrl"]) {
    assert.ok(field in rostered, `the UI needs roster.${field}`);
  }
  assert.strictEqual(rostered.name, "Rendered Player");
  assert.strictEqual(rostered.imageUrl, "http://x/p.jpg");
});
