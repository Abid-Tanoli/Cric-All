// T0.2: a partial update must change only the fields the caller sent.
//
// zod 4 still applies `.default()` to a key that is missing from the body, even
// inside `.partial()`. Before this fix the team and player update schemas turned
// `{ name: "x" }` into a full body of empty values, so an owner renaming a team
// blanked its logo, colours, contact, socials and privacy and made a hidden team
// public; any player update wiped the player's location.
//
// Every write test goes through the real `validate()` middleware and then the
// controller, because the bug lived in the validator: calling the controller
// with a hand-built body would never have caught it.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";

import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import validate from "../src/middleware/validate.js";
import User from "../src/models/User.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import Location from "../src/models/Location.js";
import TeamCategory from "../src/models/TeamCategory.js";
import TeamOrganization from "../src/models/TeamOrganization.js";
import Membership from "../src/models/Membership.js";
import AuditLog from "../src/models/AuditLog.js";
import { createOrganization } from "../src/controllers/organizationController.js";
import { updateOrgTeam } from "../src/controllers/orgTeamsController.js";
import { updatePlayer } from "../src/controllers/playerController.js";
import { createOrgTeamSchema, updateOrgTeamSchema } from "../src/validators/teamValidators.js";
import { adminUpdatePlayerSchema, updatePlayerSchema } from "../src/validators/playerValidators.js";

let mongod;
before(async () => {
  mongod = await startTestDb();
});
after(async () => {
  await stopTestDb(mongod);
});
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Team.deleteMany({}),
    Player.deleteMany({}),
    Location.deleteMany({}),
    TeamOrganization.deleteMany({}),
    Membership.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);
  await TeamCategory.seedDefaults();
});

let counter = 0;
async function makeUser(overrides = {}) {
  counter += 1;
  return User.create({
    name: `Defaults Person ${counter}`,
    email: `defaults-${counter}-${Math.random().toString(36).slice(2, 8)}@openctest.dev`,
    password: "password-123",
    role: "scorer",
    accountType: "organization_admin",
    emailVerified: true,
    ...overrides,
  });
}

async function makeOrg(owner) {
  const res = mockRes();
  await createOrganization(
    mockReq({ user: owner, principalType: "user", body: { name: `Defaults Org ${counter}`, createDefaultTeam: false } }),
    res,
  );
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  return res.body.organization;
}

/** Run a request through the route's validator, then the controller. */
async function throughRoute(schema, controller, reqFields) {
  const req = mockReq(reqFields);
  const res = mockRes();
  let passed = false;
  validate(schema)(req, res, () => {
    passed = true;
  });
  assert.ok(passed, `validator rejected the body: ${JSON.stringify(res.body)}`);
  await controller(req, res);
  return res;
}

const comparable = (doc) => {
  const plain = JSON.parse(JSON.stringify(doc));
  delete plain.updatedAt;
  delete plain.__v;
  return plain;
};

// ---------------------------------------------------------------------------
// The schemas themselves
// ---------------------------------------------------------------------------

test("an empty update body stays empty for every fixed schema", () => {
  for (const [name, schema] of [
    ["updateOrgTeamSchema", updateOrgTeamSchema],
    ["updatePlayerSchema", updatePlayerSchema],
    ["adminUpdatePlayerSchema", adminUpdatePlayerSchema],
  ]) {
    const result = schema.safeParse({});
    assert.equal(result.success, true, `${name}: ${JSON.stringify(result.error?.issues)}`);
    assert.deepEqual(result.data, {}, `${name} added keys the caller never sent`);
  }
});

test("only the sent keys come out, and values are still validated and trimmed", () => {
  assert.deepEqual(updateOrgTeamSchema.parse({ name: "  Lions  " }), { name: "Lions" });
  assert.deepEqual(updateOrgTeamSchema.parse({ isPublic: false }), { isPublic: false });
  assert.deepEqual(updateOrgTeamSchema.parse({ isActive: false }), { isActive: false });
  assert.equal(updateOrgTeamSchema.safeParse({ logo: "ftp://bad" }).success, false);
  assert.equal(updateOrgTeamSchema.safeParse({ email: "not-an-email" }).success, false);
  assert.equal(updateOrgTeamSchema.safeParse({ teamColorPrimary: "red" }).success, false);
  // An explicit empty value is still a deliberate clear.
  assert.deepEqual(updateOrgTeamSchema.parse({ logo: "" }), { logo: "" });

  assert.deepEqual(updatePlayerSchema.parse({ name: "Ali" }), { name: "Ali" });
  assert.deepEqual(adminUpdatePlayerSchema.parse({ stats: { runs: 10 } }), { stats: { runs: 10 } });
});

test("the update schemas still refuse unknown keys and keep their cross-field rule", () => {
  const injected = updateOrgTeamSchema.safeParse({ organizationRef: "507f1f77bcf86cd799439011" });
  assert.equal(injected.success, false);
  assert.ok(injected.error.issues.some((issue) => issue.code === "unrecognized_keys"));
  assert.equal(updateOrgTeamSchema.safeParse({ players: [] }).success, false, "players stays omitted");

  assert.equal(updatePlayerSchema.safeParse({ createdBy: "507f1f77bcf86cd799439011" }).success, false);
  assert.equal(adminUpdatePlayerSchema.safeParse({ owner: "x" }).success, false);

  for (const schema of [updatePlayerSchema, adminUpdatePlayerSchema]) {
    const both = schema.safeParse({ age: 20, birthInfo: { date: "2000-01-01" } });
    assert.equal(both.success, false, "age and birthInfo.date together are still refused");
  }
});

test("create schemas keep their defaults", () => {
  const created = createOrgTeamSchema.parse({ name: "New XI" });
  assert.equal(created.isPublic, true);
  assert.equal(created.teamRole, "1st XI");
  assert.equal(created.teamColorPrimary, "#00a650");
});

// ---------------------------------------------------------------------------
// Teams, through validate() + updateOrgTeam
// ---------------------------------------------------------------------------

async function makeFullTeam(org, overrides = {}) {
  return Team.create({
    name: "Full Lions",
    shortName: "FUL",
    organizationRef: org._id,
    organization: org.name,
    teamRole: "2nd XI",
    category: "Club",
    ageGroup: "U-19",
    description: "Old description",
    homeGround: "Old Ground",
    establishedYear: 2001,
    logo: "/uploads/full-lions.webp",
    website: "https://lions.example",
    phone: "03001234567",
    email: "lions@openctest.dev",
    address: { town: "Town", district: "District", city: "Karachi", province: "Sindh", country: "Pakistan" },
    teamColorPrimary: "#112233",
    teamColorSecondary: "#445566",
    socialLinks: { facebook: "https://facebook.com/lions", instagram: "https://instagram.com/lions" },
    privacy: { contactInfo: "hidden", socialLinks: "hidden", location: "hidden", media: "hidden" },
    isPublic: false,
    ...overrides,
  });
}

test("the owner's team edit form changes only what it sends", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const team = await makeFullTeam(org);
  const before = comparable(await Team.findById(team._id).lean());

  // Exactly the payload Frontend/User/src/pages/organization/OrgTeams.jsx sends.
  const body = {
    name: "Renamed Lions",
    shortName: "REN",
    teamRole: "2nd XI",
    ageGroup: "U-19",
    homeGround: "New Ground",
    description: "New description",
  };
  const res = await throughRoute(updateOrgTeamSchema, updateOrgTeam, {
    user: owner,
    principalType: "user",
    params: { id: String(org._id), teamId: String(team._id) },
    org,
    body,
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));

  const after = comparable(await Team.findById(team._id).lean());
  assert.deepEqual(after, { ...before, ...body });
  assert.equal(after.isPublic, false, "a hidden team stays hidden");
  assert.equal(after.logo, "/uploads/full-lions.webp");
  assert.equal(after.privacy.contactInfo, "hidden");
});

test("an unrelated update never makes a hidden team public", async () => {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const team = await makeFullTeam(org);

  const res = await throughRoute(updateOrgTeamSchema, updateOrgTeam, {
    user: owner,
    principalType: "user",
    params: { id: String(org._id), teamId: String(team._id) },
    org,
    body: { description: "Only this" },
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const after = await Team.findById(team._id).lean();
  assert.equal(after.isPublic, false);
  assert.equal(after.description, "Only this");
  assert.equal(after.teamColorPrimary, "#112233");
});

// ---------------------------------------------------------------------------
// Players, through validate() + updatePlayer
// ---------------------------------------------------------------------------

async function makeLocatedPlayer(creator) {
  const country = await Location.create({ name: "Pakistan", type: "country" });
  const player = await Player.create({
    name: "Located Player",
    role: "Batsman",
    playingRole: "Batsman",
    createdBy: creator._id,
    locationRefs: { countryId: country._id },
  });
  const stored = await Player.findById(player._id).lean();
  assert.equal(stored.locationLabels?.country, "Pakistan", "the location hook resolved the label");
  return stored;
}

test("a self-service player edit keeps the player's location", async () => {
  const creator = await makeUser();
  const player = await makeLocatedPlayer(creator);

  const res = await throughRoute(updatePlayerSchema, updatePlayer, {
    user: creator,
    principalType: "user",
    params: { id: String(player._id) },
    body: { name: "Renamed Player" },
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));

  const after = await Player.findById(player._id).lean();
  assert.equal(after.name, "Renamed Player");
  assert.equal(String(after.locationRefs.countryId), String(player.locationRefs.countryId));
  assert.equal(after.locationLabels.country, "Pakistan");
  assert.equal(after.role, "Batsman");
});

test("the Admin stats-only update keeps the player's location", async () => {
  const creator = await makeUser();
  const admin = await makeUser({ role: "admin" });
  const player = await makeLocatedPlayer(creator);

  // Frontend/Admin/src/store/slices/playersSlice.js sends `{ stats }` alone.
  const res = await throughRoute(adminUpdatePlayerSchema, updatePlayer, {
    user: admin,
    principalType: "admin",
    params: { id: String(player._id) },
    body: { stats: { runs: 42 } },
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));

  const after = await Player.findById(player._id).lean();
  assert.equal(after.stats.runs, 42);
  assert.equal(String(after.locationRefs.countryId), String(player.locationRefs.countryId));
  assert.equal(after.locationLabels.country, "Pakistan");
});

test("a player edit that sends a location still changes it", async () => {
  const creator = await makeUser();
  const player = await makeLocatedPlayer(creator);
  const other = await Location.create({ name: "Afghanistan", type: "country" });

  const res = await throughRoute(updatePlayerSchema, updatePlayer, {
    user: creator,
    principalType: "user",
    params: { id: String(player._id) },
    body: { locationRefs: { countryId: String(other._id) } },
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const after = await Player.findById(player._id).lean();
  assert.equal(after.locationLabels.country, "Afghanistan");
});
