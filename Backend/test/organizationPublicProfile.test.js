// PR 8 — the public club page.
//
// What this suite pins down:
//   * slug generation is lowercase, URL-safe, collision-safe and never returns a
//     reserved word that would shadow an API/app route;
//   * GET /organizations/public/:slug answers a strict public projection — no
//     registration number, contact email/phone, members, owner or audit data;
//   * social links and location obey the organization's existing privacy flags;
//   * a private, inactive, reserved-name or unknown club is a 404, not a 403;
//   * the page carries only PUBLIC teams, upcoming fixtures and recent results
//     across those teams, plus a club-level top-performers block;
//   * the owner visibility toggle is persisted and audited;
//   * the slug backfill is dry-run by default, collision-safe and idempotent,
//     including ownerless legacy clubs.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";

import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import User from "../src/models/User.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import Match from "../src/models/Match.js";
import Membership from "../src/models/Membership.js";
import AuditLog from "../src/models/AuditLog.js";
import TeamOrganization from "../src/models/TeamOrganization.js";
import {
  getOrganizationChain,
  getOrganizationChildren,
  getOrganizationTree,
  getPublicOrganizationBySlug,
  getRootOrganizations,
  updateOrganization,
} from "../src/controllers/organizationController.js";
import {
  generateOrgSlug,
  RESERVED_ORG_SLUGS,
} from "../src/services/membershipService.js";
import validate from "../src/middleware/validate.js";
import { updateOrganizationSchema } from "../src/validators/orgValidators.js";
import { backfillOrgSlugs } from "../src/scripts/backfillOrgSlugs.js";

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
    Match.deleteMany({}),
    Membership.deleteMany({}),
    AuditLog.deleteMany({}),
    TeamOrganization.deleteMany({}),
  ]);
});

let counter = 0;

async function makeUser(overrides = {}) {
  counter += 1;
  return User.create({
    name: `Club Person ${counter}`,
    email: `club-${counter}-${Math.random().toString(36).slice(2, 8)}@openctest.dev`,
    password: "password-123",
    role: "scorer",
    accountType: "organization_admin",
    emailVerified: true,
    ...overrides,
  });
}

async function makeOrg(overrides = {}) {
  counter += 1;
  return TeamOrganization.create({
    name: `Crescent Club ${counter}`,
    slug: `crescent-club-${counter}`,
    orgType: "local_club",
    isActive: true,
    ...overrides,
  });
}

async function makeTeam(org, overrides = {}) {
  counter += 1;
  return Team.create({
    name: `Club Team ${counter}`,
    organizationRef: org?._id || null,
    isPublic: true,
    isActive: true,
    ...overrides,
  });
}

async function makeMatch(home, away, overrides = {}) {
  return Match.create({
    title: `${home.name} vs ${away.name}`,
    teams: [home._id, away._id],
    status: "upcoming",
    startAt: new Date("2026-07-01T10:00:00.000Z"),
    venue: "Club Ground",
    ...overrides,
  });
}

async function readClub(slug, req = {}) {
  const res = mockRes();
  await getPublicOrganizationBySlug(
    mockReq({ params: { slug }, ...req }),
    res
  );
  return res;
}

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

test("slug generation lowercases, strips punctuation and is URL-safe", async () => {
  assert.equal(await generateOrgSlug("Crescent Cricket Club"), "crescent-cricket-club");
  assert.equal(await generateOrgSlug("  St. Mary's  XI!! "), "st-mary-s-xi");
  assert.equal(await generateOrgSlug("کرکٹ کلب"), "organization");
});

test("a taken slug gets a numeric suffix instead of colliding", async () => {
  await makeOrg({ name: "Gulberg Stars", slug: "gulberg-stars" });
  assert.equal(await generateOrgSlug("Gulberg Stars"), "gulberg-stars-2");

  await makeOrg({ name: "Gulberg Stars 2", slug: "gulberg-stars-2" });
  assert.equal(await generateOrgSlug("Gulberg Stars"), "gulberg-stars-3");
});

test("reserved route words are never handed out as a slug", async () => {
  for (const word of ["public", "my", "admin", "roots"]) {
    assert.ok(RESERVED_ORG_SLUGS.has(word));
    const generated = await generateOrgSlug(word);
    assert.notEqual(generated, word);
    assert.ok(generated.startsWith(`${word}-`));
  }
});

// ---------------------------------------------------------------------------
// Public projection
// ---------------------------------------------------------------------------

test("the public club read exposes a strict projection with no private fields", async () => {
  const org = await makeOrg({
    name: "Gulberg Stars",
    slug: "gulberg-stars",
    type: "club",
    description: "A neighbourhood club.",
    logoUrl: "/uploads/club-logo.webp",
    coverUrl: "https://cdn.example.com/cover.jpg",
    location: { city: "Lahore", area: "Gulberg", address: "12 Street", country: "Pakistan" },
    locationLabels: { country: "Pakistan", province: "Punjab", district: "Lahore", city: "Lahore", town: "" },
    contact: { phone: "03001234567", email: "secret@club.test" },
    socialLinks: { instagram: "https://instagram.com/gulberg" },
    typeDetails: {
      registrationNumber: "REG-999",
      registrationAuthority: "District Sports Board",
      affiliation: "LCCA",
    },
    verificationStatus: "verified",
    verifiedBy: (await makeUser())._id,
    verificationNote: "internal note",
    owner: (await makeUser())._id,
    members: [{ user: (await makeUser())._id, role: "admin" }],
    privacy: { contactInfo: "public", socialLinks: "public", location: "public" },
  });

  const res = await readClub("gulberg-stars");
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));

  const club = res.body.organization;
  assert.equal(club.name, "Gulberg Stars");
  assert.equal(club.slug, "gulberg-stars");
  assert.equal(club.orgType, "local_club");
  assert.equal(club.verificationStatus, "verified");
  assert.equal(club.socialLinks.instagram, "https://instagram.com/gulberg");
  assert.equal(club.location.city, "Lahore");

  const wire = JSON.stringify(res.body);
  for (const forbidden of [
    "REG-999",
    "registrationNumber",
    "registrationAuthority",
    "secret@club.test",
    "03001234567",
    "internal note",
    "verificationNote",
    "verifiedBy",
    "createdBy",
  ]) {
    assert.ok(!wire.includes(forbidden), `public club body leaked ${forbidden}`);
  }
  assert.equal(club.members, undefined);
  assert.equal(club.owner, undefined);
  assert.equal(club.contact, undefined);
});

test("hidden location and social links are blanked, not leaked", async () => {
  await makeOrg({
    slug: "private-details",
    location: { city: "Lahore", area: "", address: "12 Street", country: "Pakistan" },
    socialLinks: { facebook: "https://facebook.com/club" },
    privacy: { contactInfo: "public", socialLinks: "hidden", location: "hidden" },
  });

  const res = await readClub("private-details");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.organization.location, {});
  assert.equal(res.body.organization.socialLinks.facebook, "");
});

test("only public teams of the club are listed", async () => {
  const org = await makeOrg({ slug: "team-filter" });
  const publicTeam = await makeTeam(org, { name: "Public XI", isPublic: true });
  await makeTeam(org, { name: "Hidden XI", isPublic: false });
  await makeTeam(org, { name: "OPENCODE_TEST_Hidden", isPublic: true });
  const otherOrg = await makeOrg({ slug: "other-club" });
  await makeTeam(otherOrg, { name: "Other Club XI", isPublic: true });

  const res = await readClub("team-filter");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(
    res.body.teams.map((team) => team.name),
    [publicTeam.name]
  );
  assert.equal(res.body.organization.branchCount, 1);
});

test("upcoming fixtures and recent results span every public team of the club", async () => {
  const org = await makeOrg({ slug: "fixtures-club" });
  const first = await makeTeam(org, { name: "First XI" });
  const second = await makeTeam(org, { name: "Second XI" });
  const rival = await makeTeam(null, { name: "Township Titans" });

  const soon = await makeMatch(first, rival, {
    startAt: new Date("2026-06-01T10:00:00.000Z"),
  });
  const later = await makeMatch(second, rival, {
    startAt: new Date("2026-06-03T10:00:00.000Z"),
  });
  const done = await makeMatch(second, rival, {
    status: "completed",
    startAt: new Date("2026-05-01T10:00:00.000Z"),
    innings: [
      { team: second._id, runs: 150, wickets: 6, overs: 20 },
      { team: rival._id, runs: 140, wickets: 8, overs: 20 },
    ],
    result: { winner: second._id, description: "Second XI won by 10 runs" },
  });

  const res = await readClub("fixtures-club");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(
    res.body.upcomingMatches.map((match) => String(match._id)),
    [String(soon._id), String(later._id)]
  );
  assert.deepEqual(
    res.body.recentResults.map((match) => String(match._id)),
    [String(done._id)]
  );
  assert.equal(res.body.recentResults[0].result.description, "Second XI won by 10 runs");
});

test("a fixture against a hidden team does not appear on a visible club page", async () => {
  const org = await makeOrg({ slug: "hidden-opponent" });
  const team = await makeTeam(org, { name: "Visible XI" });
  const hidden = await makeTeam(null, { name: "Hidden Rivals", isPublic: false });
  await makeMatch(team, hidden, { startAt: new Date("2026-06-01T10:00:00.000Z") });

  const res = await readClub("hidden-opponent");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.upcomingMatches, []);
});

test("top performers are aggregated across the club's teams", async () => {
  const org = await makeOrg({ slug: "performers-club" });
  const first = await makeTeam(org, { name: "Performer XI" });

  const batter = await Player.create({
    name: "Ayesha Khan",
    team: first._id,
    stats: { matches: 8, runs: 420, wickets: 2, strikeRate: 121.5, average: 60 },
  });
  const bowler = await Player.create({
    name: "Nida Dar",
    team: first._id,
    stats: { matches: 8, runs: 90, wickets: 18, strikeRate: 88.2, average: 20 },
  });
  await Team.updateOne(
    { _id: first._id },
    { $addToSet: { players: { $each: [batter._id, bowler._id] } } }
  );

  const res = await readClub("performers-club");
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.topPerformers.topRunScorer.name, "Ayesha Khan");
  assert.equal(res.body.topPerformers.topWicketTaker.name, "Nida Dar");
  assert.ok(res.body.topPerformers.bestPlayers.length >= 2);
});

test("empty clubs return empty blocks rather than failing", async () => {
  await makeOrg({ slug: "brand-new-club" });
  const res = await readClub("brand-new-club");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.teams, []);
  assert.deepEqual(res.body.upcomingMatches, []);
  assert.deepEqual(res.body.recentResults, []);
  assert.deepEqual(res.body.topPerformers.bestPlayers, []);
  assert.equal(res.body.topPerformers.topRunScorer, null);
});

// ---------------------------------------------------------------------------
// 404 rules
// ---------------------------------------------------------------------------

test("a private club is a 404, never a 403", async () => {
  await makeOrg({ slug: "hidden-club", isPublic: false });
  const res = await readClub("hidden-club");
  assert.equal(res.statusCode, 404);
});

test("an inactive, reserved-name or unknown slug is a 404", async () => {
  await makeOrg({ slug: "inactive-club", isActive: false });
  await makeOrg({ slug: "reserved-club", name: "OPENCODE_TEST_Club" });

  assert.equal((await readClub("inactive-club")).statusCode, 404);
  assert.equal((await readClub("reserved-club")).statusCode, 404);
  assert.equal((await readClub("does-not-exist")).statusCode, 404);
  assert.equal((await readClub("")).statusCode, 404);
});

// ---------------------------------------------------------------------------
// Visibility toggle
// ---------------------------------------------------------------------------

test("the owner can switch the public page off and the change is audited", async () => {
  const owner = await makeUser();
  const org = await makeOrg({ slug: "toggle-club", isPublic: true, owner: owner._id });
  await Membership.create({ organization: org._id, user: owner._id, roles: ["owner"] });

  const res = mockRes();
  await updateOrganization(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id) },
      org,
      body: { isPublic: false },
    }),
    res
  );

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.organization.isPublic, false);

  const fresh = await TeamOrganization.findById(org._id).lean();
  assert.equal(fresh.isPublic, false);

  const audit = await AuditLog.findOne({
    organization: org._id,
    action: "org.visibility_changed",
  }).lean();
  assert.ok(audit, "expected an org.visibility_changed audit entry");
  assert.equal(audit.metadata.publicPage, false);

  // And the public page is now a 404.
  assert.equal((await readClub("toggle-club")).statusCode, 404);
});

test("the visibility toggle changes nothing else on the stored club", async () => {
  const owner = await makeUser();
  const org = await makeOrg({
    slug: "full-club",
    orgType: "school",
    type: "school",
    description: "Our story",
    logoUrl: "https://img.example/logo.png",
    foundedYear: 1998,
    socialLinks: { instagram: "https://instagram.com/full" },
    privacy: { contactInfo: "hidden", socialLinks: "hidden", location: "hidden" },
    typeDetails: { institutionName: "Full School" },
  });
  await Membership.create({ organization: org._id, user: owner._id, roles: ["owner"] });
  const before = await TeamOrganization.findById(org._id).lean();

  // Through the real request validator: the wipe happened there, so calling the
  // controller directly could never catch it.
  const req = mockReq({
    user: owner,
    principalType: "user",
    params: { id: String(org._id) },
    org,
    body: { isPublic: false },
  });
  const res = mockRes();
  validate(updateOrganizationSchema)(req, res, () => {});
  await updateOrganization(req, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));

  const { updatedAt: _a, isPublic: beforePublic, ...kept } = before;
  const { updatedAt: _b, isPublic: afterPublic, ...now } = await TeamOrganization.findById(org._id).lean();
  assert.equal(beforePublic, true);
  assert.equal(afterPublic, false);
  assert.deepEqual(now, kept);
});

test("the anonymous hierarchy reads expose no private organization fields", async () => {
  const secret = {
    contact: { phone: "03001112223", email: "secret@openctest.dev" },
    typeDetails: { registrationNumber: "REG-SECRET" },
    verificationNote: "NOTE-SECRET",
    orgType: "registered_club",
  };
  const parent = await makeOrg({ slug: "parent-club", ...secret });
  const child = await makeOrg({ slug: "child-club", parent: parent._id, ...secret });
  await makeTeam(child, { email: "team-secret@openctest.dev", privacy: { contactInfo: "hidden" } });

  for (const [handler, id] of [
    [getRootOrganizations, parent._id],
    [getOrganizationChildren, parent._id],
    [getOrganizationChain, child._id],
    [getOrganizationTree, parent._id],
  ]) {
    const res = mockRes();
    await handler(mockReq({ params: { id: String(id) } }), res);
    const text = JSON.stringify(res.body);
    assert.equal(res.statusCode, 200, text);
    assert.match(text, /Crescent Club/, handler.name);
    assert.doesNotMatch(text, /03001112223|secret@openctest|REG-SECRET|NOTE-SECRET/, handler.name);
  }

  const admin = mockRes();
  await getOrganizationChain(
    mockReq({ params: { id: String(child._id) }, user: { _id: parent._id }, principalType: "admin" }),
    admin
  );
  assert.match(JSON.stringify(admin.body), /REG-SECRET/);
});

test("a match on the field is listed as live, not upcoming", async () => {
  const org = await makeOrg({ slug: "live-club" });
  const team = await makeTeam(org, { name: "Live XI" });
  const rival = await makeTeam(null, { name: "Live Rivals" });
  const live = await makeMatch(team, rival, { status: "live" });

  const res = await readClub("live-club");
  assert.deepEqual(res.body.liveMatches.map((match) => String(match._id)), [String(live._id)]);
  assert.deepEqual(res.body.upcomingMatches, []);
});

test("renaming a club keeps its existing public slug", async () => {
  const owner = await makeUser();
  const org = await makeOrg({ slug: "stable-slug", name: "Old Name", owner: owner._id });
  await Membership.create({ organization: org._id, user: owner._id, roles: ["owner"] });

  const res = mockRes();
  await updateOrganization(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id) },
      org,
      body: { name: "Brand New Name" },
    }),
    res
  );

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.organization.name, "Brand New Name");
  assert.equal(res.body.organization.slug, "stable-slug");

  const renamed = mockRes();
  await updateOrganization(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id) },
      org: await TeamOrganization.findById(org._id),
      body: { slug: "chosen-handle" },
    }),
    renamed
  );
  assert.equal(renamed.statusCode, 200, JSON.stringify(renamed.body));
  assert.equal(renamed.body.organization.slug, "chosen-handle");
});

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

test("the slug backfill is dry-run by default, collision-safe and idempotent", async () => {
  const legacyOne = await TeamOrganization.create({
    name: "Legacy Club One",
    slug: undefined,
    owner: null,
  });
  const legacyTwo = await TeamOrganization.create({
    name: "Legacy Club One",
    slug: undefined,
    owner: null,
  });
  const already = await makeOrg({ name: "Already Sluggish", slug: "already-sluggish" });

  const logs = [];
  const dry = await backfillOrgSlugs({ apply: false, log: (line) => logs.push(line) });
  assert.equal(dry.missingSlug, 2);
  assert.equal(dry.wouldWrite, 2);
  assert.equal(dry.written, 0);
  assert.equal(await TeamOrganization.countDocuments({ slug: { $exists: false } }), 2);

  const applied = await backfillOrgSlugs({ apply: true, log: (line) => logs.push(line) });
  assert.equal(applied.written, 2);
  assert.equal(applied.failed, 0);

  const first = await TeamOrganization.findById(legacyOne._id).lean();
  const second = await TeamOrganization.findById(legacyTwo._id).lean();
  assert.equal(first.slug, "legacy-club-one");
  assert.equal(second.slug, "legacy-club-one-2");
  assert.equal(first.owner, null);
  assert.equal((await TeamOrganization.findById(already._id).lean()).slug, "already-sluggish");

  const again = await backfillOrgSlugs({ apply: true, log: (line) => logs.push(line) });
  assert.equal(again.missingSlug, 0);
  assert.equal(again.written, 0);
  assert.equal((await TeamOrganization.findById(first._id).lean()).slug, "legacy-club-one");
});
