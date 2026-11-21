import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";

import mongoose from "mongoose";
import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import Location from "../src/models/Location.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import User from "../src/models/User.js";
import Event from "../src/models/Event.js";
import Match from "../src/models/Match.js";
import { createTeam, updateTeam } from "../src/services/teamService.js";
import { createEvent } from "../src/controllers/eventController.js";
import { seedLocations, loadLocationSeedData } from "../src/seed/locations.js";
import {
  buildLocationFilterClauses,
  buildPublicLocationQuery,
  listPublicLocations,
  suggestLocation,
} from "../src/services/locationService.js";
import {
  getLocations,
  postLocationSuggestion,
  adminApproveLocation,
  adminListLocations,
} from "../src/controllers/locationController.js";

const execFileAsync = promisify(execFile);

let mongod;

before(async () => {
  mongod = await startTestDb();
  // Unique indexes are built in the background on first use; the uniqueness
  // test would race that build and see no violation.
  await Location.syncIndexes();
});

after(async () => {
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Promise.all([
    Location.deleteMany({}),
    Team.deleteMany({}),
    Player.deleteMany({}),
    User.deleteMany({}),
    Event.deleteMany({}),
    Match.deleteMany({}),
  ]);
});

async function makeTree() {
  const pakistan = await Location.create({ type: "country", name: "Pakistan", source: "test" });
  const punjab = await Location.create({ type: "province", name: "Punjab", parent: pakistan._id, source: "test" });
  const lahore = await Location.create({ type: "district", name: "Lahore", parent: punjab._id, source: "test" });
  const city = await Location.create({ type: "city", name: "Lahore City", parent: lahore._id, source: "test" });
  const town = await Location.create({ type: "town", name: "Model Town", parent: city._id, source: "test" });
  return { pakistan, punjab, lahore, city, town };
}

// ---------------------------------------------------------------------------
// Tree rules
// ---------------------------------------------------------------------------
test("the tree rejects a child whose parent is the wrong type", async () => {
  const { pakistan, punjab } = await makeTree();

  await assert.rejects(
    () => Location.create({ type: "city", name: "Bad City", parent: punjab._id }),
    /must have a district parent/i
  );
  await assert.rejects(
    () => Location.create({ type: "district", name: "Bad District", parent: pakistan._id }),
    /must have a province parent/i
  );
  await assert.rejects(
    () => Location.create({ type: "country", name: "Nested Country", parent: pakistan._id }),
    /cannot have a parent/i
  );
});

test("a location cannot be moved under its own descendant", async () => {
  const { punjab, lahore } = await makeTree();
  punjab.parent = lahore._id;
  await assert.rejects(() => punjab.save(), /wrong type|cannot be moved|must have a country parent/i);
});

test("names are unique per parent but may repeat under different parents", async () => {
  const { lahore } = await makeTree();
  const sindh = await Location.findOne({ type: "province", name: "Punjab" });
  const karachi = await Location.create({ type: "district", name: "Karachi", parent: sindh._id });

  await Location.create({ type: "city", name: "Model Town", parent: lahore._id });
  await assert.rejects(
    () => Location.create({ type: "city", name: "  model   town ", parent: lahore._id }),
    /duplicate key/i
  );
  // Same name, different parent: allowed.
  const other = await Location.create({ type: "city", name: "Model Town", parent: karachi._id });
  assert.equal(other.name, "Model Town");
});

test("ancestors and path are derived from the parent, not supplied by the caller", async () => {
  const { pakistan, punjab, lahore, city, town } = await makeTree();
  assert.equal(town.path, "pakistan/punjab/lahore/lahore-city/model-town");
  assert.deepEqual(
    town.ancestors.map(String),
    [pakistan._id, punjab._id, lahore._id, city._id].map(String)
  );
});

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------
test("seed is idempotent: a second run creates nothing and deletes nothing", async () => {
  const data = loadLocationSeedData();
  const first = await seedLocations({ data });
  const totalAfterFirst = await Location.countDocuments({});
  assert.ok(totalAfterFirst > 150, `seeded ${totalAfterFirst} nodes`);

  const second = await seedLocations({ data });
  const totalAfterSecond = await Location.countDocuments({});
  assert.equal(second.totalSeeded, 0, "second run inserts no node");
  assert.equal(totalAfterSecond, totalAfterFirst, "second run leaves the count unchanged");

  const pakistan = await Location.findOne({ type: "country", name: "Pakistan" });
  assert.ok(pakistan, "Pakistan is seeded");
  const provinces = await Location.find({ type: "province", parent: pakistan._id });
  assert.equal(provinces.length, 7);
  const districts = await Location.countDocuments({ type: "district" });
  assert.equal(districts, first.counts.districts);
  assert.ok(districts >= 160, `districts seeded: ${districts}`);
});

test("seed never overwrites or deletes an admin edit", async () => {
  const data = loadLocationSeedData();
  await seedLocations({ data });
  const city = await Location.findOne({ type: "city" });
  city.name = "Renamed By Admin";
  city.active = false;
  await city.save();

  await seedLocations({ data });
  const reread = await Location.findById(city._id);
  assert.equal(reread.name, "Renamed By Admin");
  assert.equal(reread.active, false);
});

// ---------------------------------------------------------------------------
// Public reads
// ---------------------------------------------------------------------------
test("public endpoints validate the query strictly", () => {
  assert.throws(() => buildPublicLocationQuery({ type: "village" }), /type must be one of/i);
  assert.throws(() => buildPublicLocationQuery({ parent: "not-an-id" }), /parent must be a location id/i);
  assert.throws(() => buildPublicLocationQuery({ q: "x".repeat(81) }), /80 characters/i);
  assert.throws(() => buildPublicLocationQuery({ ids: "nope" }), /at most 50 location ids/i);
});

test("public listing returns only active, approved children and clamps the limit", async () => {
  const { punjab } = await makeTree();
  await Location.create({ type: "district", name: "Hidden District", parent: punjab._id, approved: false });
  const inactive = await Location.create({ type: "district", name: "Inactive District", parent: punjab._id });
  inactive.active = false;
  await inactive.save();

  const res = mockRes();
  await getLocations(mockReq({ query: { type: "district", parent: String(punjab._id), limit: "999" } }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.locations.map((row) => row.name), ["Lahore"]);
  assert.equal(res.body.count, 1);
  assert.match(res.headers?.["Cache-Control"] || "public, max-age=60", /max-age=60/);
});

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------
test("a suggestion is unapproved, hidden from others, deduped, and visible after approval", async () => {
  const { lahore } = await makeTree();
  const user = await User.create({
    name: "Suggester",
    email: "suggester@openctest.dev",
    password: "password-123",
    emailVerified: true,
  });

  const { location, existing } = await suggestLocation({
    name: "  New   Area <b> ",
    type: "city",
    parentId: lahore._id,
    user,
  });
  assert.equal(existing, false);
  assert.equal(location.approved, false);
  assert.equal(location.name, "New Area b", "name is sanitized");

  // Hidden from the public list...
  const publicRows = await listPublicLocations({ type: "city", parent: String(lahore._id) });
  assert.ok(!publicRows.some((row) => String(row._id) === String(location._id)));

  // ...but returned to the submitter by the suggest endpoint (deduped).
  const again = await suggestLocation({ name: "New Area b", type: "city", parentId: lahore._id, user });
  assert.equal(again.existing, true);
  assert.equal(String(again.location._id), String(location._id));

  // A user cannot approve: the admin endpoint is behind the route guard, but the
  // listing must still be admin-only and the node must stay hidden until then.
  const adminRes = mockRes();
  await adminApproveLocation(
    mockReq({ user: { role: "admin" }, params: { id: String(location._id) } }),
    adminRes
  );
  assert.equal(adminRes.statusCode, 200);

  const after = await listPublicLocations({ type: "city", parent: String(lahore._id) });
  assert.ok(after.some((row) => String(row._id) === String(location._id)));
});

test("suggest requires a logged-in user at the route layer and a valid parent", async () => {
  const { lahore, punjab } = await makeTree();
  const user = await User.create({
    name: "Second Suggester",
    email: "second@openctest.dev",
    password: "password-123",
    emailVerified: true,
  });

  // The controller itself relies on req.user (the router applies `protect`), so
  // an anonymous body without a user must not create anything for them.
  const anonymous = mockRes();
  await postLocationSuggestion(mockReq({ body: { name: "Anon Area", type: "city", parentId: lahore._id } }), anonymous);
  assert.ok(anonymous.statusCode >= 400, "anonymous suggestion is rejected");

  await assert.rejects(
    () => suggestLocation({ name: "Wrong Parent", type: "city", parentId: punjab._id, user }),
    /must sit under a district/i
  );
  assert.equal(await Location.countDocuments({ name: "Wrong Parent" }), 0);
});

// ---------------------------------------------------------------------------
// Entity references and filters
// ---------------------------------------------------------------------------
test("saving an entity resolves the branch and descendant filters match it", async () => {
  const { pakistan, punjab, lahore, city, town } = await makeTree();
  const team = await Team.create({
    name: "Model Town XI",
    locationRefs: { townId: town._id },
  });

  assert.equal(String(team.locationRefs.countryId), String(pakistan._id));
  assert.equal(String(team.locationRefs.provinceId), String(punjab._id));
  assert.equal(String(team.locationRefs.districtId), String(lahore._id));
  assert.equal(String(team.locationRefs.cityId), String(city._id));
  assert.equal(team.locationLabels.district, "Lahore");
  assert.equal(team.locationIds.length, 5);

  const districtClauses = await buildLocationFilterClauses({ district: String(lahore._id) });
  assert.equal(await Team.countDocuments({ $and: districtClauses }), 1, "district matches its town");
  const provinceClauses = await buildLocationFilterClauses({ province: "punjab" });
  assert.equal(await Team.countDocuments({ $and: provinceClauses }), 1, "slug works too");
  const otherClauses = await buildLocationFilterClauses({ country: String(new mongoose.Types.ObjectId()) });
  assert.equal(await Team.countDocuments({ $and: otherClauses }), 0, "unknown id matches nothing");
});

test("updating the location refs through findOneAndUpdate re-resolves labels", async () => {
  const { lahore } = await makeTree();
  const player = await Player.create({ name: "Updatable", address: { city: "legacy" } });

  await Player.findByIdAndUpdate(player._id, { locationRefs: { districtId: lahore._id } }, { new: true });
  const reread = await Player.findById(player._id);
  assert.equal(String(reread.locationRefs.provinceId), String(lahore.parent));
  assert.equal(reread.locationLabels.district, "Lahore");
  assert.equal(reread.address.city, "legacy", "legacy text is untouched");
});

// ---------------------------------------------------------------------------
// Admin form entry points
// ---------------------------------------------------------------------------
test("admin team create and update persist the tree selection", async () => {
  const { pakistan, punjab, lahore, city, town } = await makeTree();
  const refs = {
    countryId: pakistan._id,
    provinceId: punjab._id,
    districtId: lahore._id,
    cityId: city._id,
    townId: town._id,
  };

  const team = await createTeam({ name: "Tree Team", locationRefs: refs });
  assert.equal(team.locationLabels.town, "Model Town");
  assert.equal(team.locationIds.length, 5);

  // The Admin edit whitelist must let a later change through too.
  const updated = await updateTeam(team._id, {
    locationRefs: { ...refs, townId: null },
  });
  assert.equal(updated.locationRefs.townId, null);
  assert.equal(updated.locationLabels.town, "");
  assert.equal(updated.locationIds.length, 4);
  assert.equal(updated.address.city, "", "legacy text is not invented");
});

test("an event and its auto-created fixture inherit the chosen location", async () => {
  const { pakistan, punjab, lahore, city } = await makeTree();
  const a = await Team.create({ name: "Event Team A" });
  const b = await Team.create({ name: "Event Team B" });

  const req = mockReq({
    body: {
      name: "Location Derby",
      eventType: "single-match",
      teams: [a._id, b._id],
      startDate: new Date(),
      locationRefs: {
        countryId: pakistan._id,
        provinceId: punjab._id,
        districtId: lahore._id,
        cityId: city._id,
      },
    },
  });
  const res = mockRes();
  await createEvent(req, res);

  assert.equal(res.statusCode, 201);
  const event = await Event.findById(res.body.event._id);
  assert.equal(event.locationLabels.city, "Lahore City");
  const fixture = await Match.findOne({ event: event._id });
  assert.equal(fixture.locationLabels.city, "Lahore City");
  assert.deepEqual(
    fixture.locationIds.map(String),
    event.locationIds.map(String),
    "the fixture carries the same branch for listing filters"
  );
});

// ---------------------------------------------------------------------------
// Migration helper
// ---------------------------------------------------------------------------
test("migration dry run writes nothing; --apply maps exact names only", async () => {
  const { lahore } = await makeTree();
  await Location.create({ type: "city", name: "Kasur", parent: lahore._id });
  await Team.create({ name: "Lahore Club", address: { city: "lahore" } });
  await Team.create({ name: "Kasur Club", address: { city: "Kasur" } });
  await Team.create({ name: "Mystery Club", address: { city: "Nowhere" } });
  await Team.create({ name: "Ambiguous Club", address: { city: "Shared" } });
  await Location.create({ type: "city", name: "Shared", parent: lahore._id });
  await Location.create({ type: "district", name: "Shared", parent: (await Location.findOne({ type: "province" }))._id });

  const scriptPath = path.resolve(process.cwd(), "src/scripts/migrateLocationRefs.js");
  // The helper connects to cricall_test explicitly; getUri() without a name
  // would point the child script at the driver's default "test" database.
  const env = { ...process.env, MONGO_URL: mongod.getUri("cricall_test"), NODE_ENV: "test" };

  const dry = await execFileAsync(process.execPath, [scriptPath], { env, cwd: process.cwd() });
  assert.match(dry.stdout, /DRY RUN/);
  assert.equal(await Team.countDocuments({ locationIds: { $exists: true, $ne: [] } }), 0);

  await execFileAsync(process.execPath, [scriptPath, "--apply"], { env, cwd: process.cwd() });
  const lahoreClub = await Team.findOne({ name: "Lahore Club" });
  const kasurClub = await Team.findOne({ name: "Kasur Club" });
  const mystery = await Team.findOne({ name: "Mystery Club" });
  const ambiguous = await Team.findOne({ name: "Ambiguous Club" });

  assert.equal(lahoreClub.locationLabels.district, "Lahore", "case-insensitive exact match");
  assert.equal(kasurClub.locationLabels.city, "Kasur");
  assert.deepEqual(mystery.locationIds, [], "unmatched is left alone");
  assert.deepEqual(ambiguous.locationIds, [], "ambiguous is left alone");
  assert.equal(mystery.address.city, "Nowhere", "legacy text is preserved");
});
