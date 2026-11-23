import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";
process.env.FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

import User from "../src/models/User.js";
import Team from "../src/models/Team.js";
import TeamOrganization from "../src/models/TeamOrganization.js";
import Location from "../src/models/Location.js";
import Membership from "../src/models/Membership.js";
import AuditLog from "../src/models/AuditLog.js";
import SystemSettings from "../src/models/SystemSettings.js";
import { createOrganization } from "../src/controllers/organizationController.js";
import { createTeam, ensureDefaultTeam, updateTeam } from "../src/services/teamService.js";
import { ORG_TYPES } from "../src/services/organizationService.js";
import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";

let mongod;

before(async () => {
  mongod = await startTestDb();
  await Team.init();
});

after(async () => {
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Location.deleteMany({}),
    Team.deleteMany({}),
    TeamOrganization.deleteMany({}),
    Membership.deleteMany({}),
    AuditLog.deleteMany({}),
    SystemSettings.deleteMany({}),
  ]);
});

let counter = 0;
async function makeUser() {
  counter += 1;
  return User.create({
    name: `Default Team Owner ${counter}`,
    email: `default-team-${counter}-${Math.random().toString(36).slice(2, 8)}@openctest.dev`,
    password: "password-123",
    role: "scorer",
    accountType: "organization_admin",
    emailVerified: true,
  });
}

async function createOrg(owner, body = {}) {
  const res = mockRes();
  await createOrganization(
    mockReq({ user: owner, principalType: "user", body: { name: "Default Team Org", ...body } }),
    res
  );
  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
  return res.body;
}

async function makeLocationTree() {
  const country = await Location.create({ type: "country", name: "Pakistan", source: "test" });
  const province = await Location.create({ type: "province", name: "Punjab", parent: country._id, source: "test" });
  const district = await Location.create({ type: "district", name: "Lahore", parent: province._id, source: "test" });
  const city = await Location.create({ type: "city", name: "Lahore City", parent: district._id, source: "test" });
  const town = await Location.create({ type: "town", name: "Model Town", parent: city._id, source: "test" });
  return {
    refs: {
      countryId: country._id,
      provinceId: province._id,
      districtId: district._id,
      cityId: city._id,
      townId: town._id,
    },
    labels: { country: "Pakistan", province: "Punjab", district: "Lahore", city: "Lahore City", town: "Model Town" },
  };
}

test("createOrganization creates one inherited 1st XI team for every orgType", async () => {
  for (const orgType of ORG_TYPES) {
    const owner = await makeUser();
    const { refs, labels } = await makeLocationTree();
    const name = `${orgType} cricket club`;
    const body = await createOrg(owner, {
      name,
      orgType,
      locationRefs: refs,
      locationLabels: labels,
      location: { city: "Lahore", country: "Pakistan", area: "Model Town" },
    });

    assert.equal(body.defaultTeamCreated, true);
    assert.equal(body.defaultTeamError, "");
    assert.equal(body.defaultTeam.name, name);
    assert.equal(body.defaultTeam.teamRole, "1st XI");
    assert.equal(String(body.defaultTeam.organizationRef?._id || body.defaultTeam.organizationRef), String(body.organization._id));
    assert.equal(body.defaultTeam.address.city, "Lahore");
    assert.equal(body.defaultTeam.address.country, "Pakistan");
    assert.deepEqual(
      Object.fromEntries(Object.entries(body.defaultTeam.locationRefs).map(([key, value]) => [key, String(value)])),
      Object.fromEntries(Object.entries(refs).map(([key, value]) => [key, String(value)]))
    );

    const teams = await Team.find({ organizationRef: body.organization._id });
    assert.equal(teams.length, 1);
    assert.equal(teams[0].teamRole, "1st XI");

    // The default team uses the same permission model as a manual team: the
    // creator's only new row is the founding org owner, never a new role path.
    const memberships = await Membership.find({ organization: body.organization._id });
    assert.equal(memberships.length, 1);
    assert.deepEqual(memberships[0].roles, ["owner"]);
    assert.equal(String(memberships[0].user), String(owner._id));

    await User.deleteMany({});
    await Location.deleteMany({});
    await Team.deleteMany({});
    await TeamOrganization.deleteMany({});
    await Membership.deleteMany({});
    await AuditLog.deleteMany({});
  }
});

test("a retry and a concurrent double submit never duplicate the default team", async () => {
  const owner = await makeUser();
  const body = await createOrg(owner, { name: "Retry Club", createDefaultTeam: false });
  const org = await TeamOrganization.findById(body.organization._id);

  const first = await ensureDefaultTeam(org, owner._id);
  const second = await ensureDefaultTeam(org, owner._id);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(String(first.team._id), String(second.team._id));

  const [a, b] = await Promise.all([ensureDefaultTeam(org, owner._id), ensureDefaultTeam(org, owner._id)]);
  assert.equal(await Team.countDocuments({ organizationRef: org._id, teamRole: "1st XI" }), 1);
  assert.equal(String(a.team._id), String(b.team._id));
});

test("createDefaultTeam: false opts out and existing organizations are not backfilled", async () => {
  const owner = await makeUser();
  const body = await createOrg(owner, { name: "Opt Out Club", createDefaultTeam: false });
  assert.equal(body.defaultTeam, null);
  assert.equal(body.defaultTeamCreated, false);
  assert.equal(await Team.countDocuments({ organizationRef: body.organization._id }), 0);

  // A direct retry of the create call must not backfill an existing org either.
  const again = mockRes();
  await createOrganization(
    mockReq({ user: owner, principalType: "user", body: { name: "Other Opt Out Club", createDefaultTeam: false } }),
    again
  );
  assert.equal(again.body.defaultTeam, null);
});

test("a failing team step still creates the organization and reports the failure", async () => {
  const owner = await makeUser();
  const originalSave = Team.prototype.save;
  Team.prototype.save = async function failingTeamSave() {
    if (this.constructor.modelName === "Team") throw new Error("simulated team failure");
    return originalSave.apply(this, arguments);
  };
  let body;
  try {
    body = await createOrg(owner, { name: "Failure Club" });
  } finally {
    Team.prototype.save = originalSave;
  }

  assert.equal(body.organization.name, "Failure Club");
  assert.equal(body.defaultTeam, null);
  assert.equal(body.defaultTeamCreated, false);
  assert.match(body.defaultTeamError, /default team was not created/i);
  assert.match(body.message, /default team was not created/i);
  assert.equal(await TeamOrganization.countDocuments({ name: "Failure Club" }), 1);
  assert.equal(await Team.countDocuments({}), 0);
});

test("teamRole validates on create and can be changed through the team service", async () => {
  const owner = await makeUser();
  const body = await createOrg(owner, { name: "Role Club", createDefaultTeam: false });
  const org = await TeamOrganization.findById(body.organization._id);

  await assert.rejects(
    () => createTeam({ name: "Invalid Role", organizationRef: org._id, teamRole: "Third XI" }),
    /Team role must be one of/
  );

  const team = await createTeam({
    name: "Second XI",
    organizationRef: org._id,
    organization: org.name,
    teamRole: "2nd XI",
  });
  assert.equal(team.teamRole, "2nd XI");
  const updated = await updateTeam(team._id, { teamRole: "women" });
  assert.equal(updated.teamRole, "women");
  await assert.rejects(() => updateTeam(team._id, { teamRole: "U21" }), /Team role must be one of/);
});
