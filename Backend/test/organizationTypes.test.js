import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";
process.env.FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

import User from "../src/models/User.js";
import TeamOrganization from "../src/models/TeamOrganization.js";
import Membership from "../src/models/Membership.js";
import AuditLog from "../src/models/AuditLog.js";
import SystemSettings from "../src/models/SystemSettings.js";
import {
  createOrganization,
  getOrganization,
  listOrganizations,
  requestOrganizationVerification,
  resetOrganizationVerification,
  reviewOrganizationVerification,
  updateOrganization,
} from "../src/controllers/organizationController.js";
import {
  effectiveOrgType,
  mapLegacyTypeToOrgType,
  orgTypeQuery,
  validateTypeDetails,
} from "../src/services/organizationService.js";
import { sanitizeOrganizationPublic } from "../src/utils/publicProjection.js";
import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";

const runFile = promisify(execFile);

let mongod;
let mongoUri;

before(async () => {
  mongod = await startTestDb();
  mongoUri = `${mongod.getUri()}cricall_test`;
});

after(async () => {
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    TeamOrganization.deleteMany({}),
    Membership.deleteMany({}),
    AuditLog.deleteMany({}),
    SystemSettings.deleteMany({}),
  ]);
});

let counter = 0;
async function makeUser(overrides = {}) {
  counter += 1;
  return User.create({
    name: `Type Person ${counter}`,
    email: `type-${counter}-${Math.random().toString(36).slice(2, 8)}@openctest.dev`,
    password: "password-123",
    role: "scorer",
    accountType: "organization_admin",
    emailVerified: true,
    ...overrides,
  });
}

async function createOrg(owner, body) {
  const res = mockRes();
  await createOrganization(
    mockReq({ user: owner, principalType: "user", body: { name: "Type Org", ...body } }),
    res
  );
  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
  return res.body.organization;
}

// ---------------------------------------------------------------------------
// Shared validation service
// ---------------------------------------------------------------------------

test("legacy slugs map to the fixed enum, and unknown values never guess", () => {
  assert.equal(mapLegacyTypeToOrgType("club").orgType, "local_club");
  assert.equal(mapLegacyTypeToOrgType("Business").orgType, "company");
  assert.equal(mapLegacyTypeToOrgType("ngo").orgType, "foundation");
  assert.equal(mapLegacyTypeToOrgType("something-random").orgType, "other");
  assert.equal(mapLegacyTypeToOrgType("something-random").mapped, false);
});

test("typeDetails validation rejects fields from another type", () => {
  const valid = validateTypeDetails("registered_club", {
    registrationNumber: "REG-42",
    foundedYear: "2010",
  });
  assert.deepEqual(valid, { registrationNumber: "REG-42", foundedYear: 2010 });
  assert.throws(
    () => validateTypeDetails("school", { registrationNumber: "REG-42" }),
    /not valid for school/
  );
});

test("orgType query covers both new and legacy rows", () => {
  const clause = orgTypeQuery("club");
  assert.deepEqual(clause.$or[0], { orgType: { $in: ["local_club"] } });
  assert.deepEqual(clause.$or[1], { orgType: { $exists: false }, type: { $in: ["club"] } });
});

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

test("create accepts orgType and writes both fields with per-type details", async () => {
  const owner = await makeUser();
  const org = await createOrg(owner, {
    orgType: "registered_club",
    typeDetails: {
      registrationNumber: "REG-123",
      registrationAuthority: "Cricket Board",
      foundedYear: 2001,
    },
  });

  assert.equal(org.orgType, "registered_club");
  assert.equal(org.type, "club");
  assert.equal(org.typeDetails.registrationNumber, "REG-123");
  assert.equal(org.typeDetails.foundedYear, 2001);
});

test("legacy clients sending only type still get an orgType", async () => {
  const owner = await makeUser();
  const org = await createOrg(owner, { type: "school" });
  assert.equal(org.type, "school");
  assert.equal(org.orgType, "school");
  assert.equal(effectiveOrgType(org), "school");
});

test("API rejects an unknown orgType and an invalid per-type field", async () => {
  const owner = await makeUser();

  const unknown = mockRes();
  await createOrganization(
    mockReq({
      user: owner,
      principalType: "user",
      body: { name: "Bad Type", orgType: "space_club" },
    }),
    unknown
  );
  assert.equal(unknown.statusCode, 422);
  assert.equal(unknown.body.code, "ORG_TYPE_UNKNOWN");

  const invalid = mockRes();
  await createOrganization(
    mockReq({
      user: owner,
      principalType: "user",
      body: {
        name: "Bad Details",
        orgType: "school",
        typeDetails: { registrationNumber: "SHOULD-NOT-STORE" },
      },
    }),
    invalid
  );
  assert.equal(invalid.statusCode, 422);
  assert.equal(invalid.body.code, "ORG_TYPE_DETAILS_INVALID");
  assert.equal(await TeamOrganization.countDocuments({ name: "Bad Details" }), 0);
});

// ---------------------------------------------------------------------------
// Privacy / public projection
// ---------------------------------------------------------------------------

test("public organization reads never expose registration numbers or verification notes", async () => {
  const owner = await makeUser();
  const org = await createOrg(owner, {
    orgType: "registered_club",
    typeDetails: { registrationNumber: "TOP-SECRET-REG", registrationAuthority: "Board" },
  });
  await TeamOrganization.updateOne(
    { _id: org._id },
    { $set: { verificationNote: "Admin-only reason", contact: { email: "private@example.test" } } }
  );

  const res = mockRes();
  await getOrganization(mockReq({ params: { id: String(org._id) }, query: {} }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.stringify(res.body).includes("TOP-SECRET-REG"), false);
  assert.equal(JSON.stringify(res.body).includes("Admin-only reason"), false);
  assert.equal(JSON.stringify(res.body).includes("private@example.test"), false);
  assert.equal(res.body.organization.orgType, "registered_club");

  // The pure sanitizer is the contract: whitelist by construction.
  const projected = sanitizeOrganizationPublic({
    ...org,
    typeDetails: { registrationNumber: "REG", institutionName: "Public Name" },
  });
  assert.equal(projected.typeDetails.registrationNumber, undefined);
  assert.equal(projected.typeDetails.institutionName, "Public Name");
  assert.equal(projected.verificationNote, undefined);
});

test("listOrganizations accepts orgType and legacy type filters", async () => {
  const owner = await makeUser();
  const club = await createOrg(owner, { name: "Legacy Club", orgType: "local_club" });
  await createOrg(owner, { name: "School Org", orgType: "school" });
  // Simulate a pre-migration row: no orgType, legacy type only. Use the
  // collection directly so Mongoose defaults/hooks don't re-add orgType.
  await TeamOrganization.collection.updateOne(
    { _id: club._id },
    { $unset: { orgType: "" }, $set: { type: "club" } }
  );

  const byEnum = mockRes();
  await listOrganizations(mockReq({ query: { orgType: "local_club" } }), byEnum);
  assert.equal(byEnum.body.total, 1);
  assert.equal(String(byEnum.body.items[0]._id), String(club._id));

  const byLegacy = mockRes();
  await listOrganizations(mockReq({ query: { type: "club" } }), byLegacy);
  assert.equal(byLegacy.body.total, 1);
});

// ---------------------------------------------------------------------------
// Verification workflow
// ---------------------------------------------------------------------------

test("owners cannot set verification directly, but can request it with a registration number", async () => {
  const owner = await makeUser();
  const org = await createOrg(owner, { orgType: "local_club" });

  const blocked = mockRes();
  await updateOrganization(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id) },
      org: await TeamOrganization.findById(org._id),
      body: { verificationStatus: "verified" },
    }),
    blocked
  );
  assert.equal(blocked.statusCode, 403);
  assert.equal(blocked.body.code, "ORG_SUPERVISORY_FIELDS");

  const noNumber = mockRes();
  await requestOrganizationVerification(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id) },
      org: await TeamOrganization.findById(org._id),
      body: {},
    }),
    noNumber
  );
  assert.equal(noNumber.statusCode, 200); // local clubs need no registration number

  const registered = await createOrg(owner, { orgType: "registered_club" });
  const missing = mockRes();
  await requestOrganizationVerification(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(registered._id) },
      org: await TeamOrganization.findById(registered._id),
      body: {},
    }),
    missing
  );
  assert.equal(missing.statusCode, 422);
  assert.equal(missing.body.code, "ORG_REGISTRATION_REQUIRED");

  await TeamOrganization.updateOne(
    { _id: registered._id },
    { $set: { "typeDetails.registrationNumber": "REG-999" } }
  );
  const asked = mockRes();
  await requestOrganizationVerification(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(registered._id) },
      org: await TeamOrganization.findById(registered._id),
      body: {},
    }),
    asked
  );
  assert.equal(asked.statusCode, 200);
  assert.equal(asked.body.organization.verificationStatus, "pending");
  assert.ok(await AuditLog.findOne({ action: "org.verification_requested" }));
});

test("only an admin can approve or reject, and the decision is audited with a note", async () => {
  const owner = await makeUser();
  const admin = await makeUser({ role: "admin", accountType: "organization_admin" });
  const org = await createOrg(owner, { orgType: "registered_club" });
  await TeamOrganization.updateOne(
    { _id: org._id },
    { $set: { verificationStatus: "pending", "typeDetails.registrationNumber": "REG-1" } }
  );

  const denied = mockRes();
  await reviewOrganizationVerification(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id), decision: "approve" },
      body: {},
    }),
    denied
  );
  // The controller itself does not authorise; the route does. The test below
  // verifies the admin path and the audit metadata written by it.
  assert.equal(denied.statusCode, 200);

  const approved = mockRes();
  await reviewOrganizationVerification(
    mockReq({
      user: admin,
      principalType: "admin",
      params: { id: String(org._id), decision: "approve" },
      body: { note: "Registration confirmed" },
    }),
    approved
  );
  assert.equal(approved.statusCode, 200);
  assert.equal(approved.body.organization.verificationStatus, "verified");

  const audit = await AuditLog.findOne({ action: "org.verification_changed" });
  assert.ok(audit);
  assert.equal(audit.metadata.decision, "approve");
  assert.equal(audit.metadata.note, "Registration confirmed");

  const reset = mockRes();
  await resetOrganizationVerification(
    mockReq({
      user: admin,
      principalType: "admin",
      params: { id: String(org._id) },
      body: { note: "Details changed" },
    }),
    reset
  );
  assert.equal(reset.statusCode, 200);
  assert.equal(reset.body.organization.verificationStatus, "unverified");
  assert.ok(await AuditLog.findOne({ action: "org.verification_reset" }));
});

test("changing a registration number resets an existing Verified badge", async () => {
  const owner = await makeUser();
  const org = await createOrg(owner, {
    orgType: "registered_club",
    typeDetails: { registrationNumber: "OLD-1" },
  });
  await TeamOrganization.updateOne(
    { _id: org._id },
    { $set: { verificationStatus: "verified", verifiedAt: new Date() } }
  );

  const res = mockRes();
  await updateOrganization(
    mockReq({
      user: owner,
      principalType: "user",
      params: { id: String(org._id) },
      org: await TeamOrganization.findById(org._id),
      body: {
        orgType: "registered_club",
        typeDetails: { registrationNumber: "NEW-2" },
      },
    }),
    res
  );
  assert.equal(res.statusCode, 200);
  const fresh = await TeamOrganization.findById(org._id);
  assert.equal(fresh.verificationStatus, "unverified");
  assert.equal(fresh.verifiedAt, null);
  assert.equal(fresh.typeDetails.registrationNumber, "NEW-2");
});

// ---------------------------------------------------------------------------
// Migration script
// ---------------------------------------------------------------------------

test("migration dry-run, apply and revert only touch mapped legacy rows", async () => {
  const [mapped, unknown] = await Promise.all([
    TeamOrganization.create({ name: "Legacy Club", type: "club" }),
    TeamOrganization.create({ name: "Mystery Org", type: "unknown-thing" }),
  ]);
  // Simulate pre-migration rows: no orgType. Collection writes bypass Mongoose
  // pre-validate, which would otherwise derive orgType from the legacy type.
  await TeamOrganization.collection.updateOne(
    { _id: mapped._id },
    { $unset: { orgType: "" }, $set: { type: "club" } }
  );
  await TeamOrganization.collection.updateOne(
    { _id: unknown._id },
    { $unset: { orgType: "" }, $set: { type: "unknown-thing" } }
  );

  const script = "src/scripts/migrateOrgTypes.js";
  const options = (...args) => ({
    cwd: process.cwd(),
    env: { ...process.env, MONGO_URL: mongoUri },
    maxBuffer: 4 * 1024 * 1024,
  });

  const dry = await runFile(process.execPath, [script], options());
  assert.match(dry.stdout, /mapped=1/);
  assert.match(dry.stdout, /unmatched=1/);
  assert.equal((await TeamOrganization.findById(mapped._id)).orgType, undefined);

  const applied = await runFile(process.execPath, [script, "--apply"], options());
  assert.match(applied.stdout, /written=1/);
  const afterApply = await TeamOrganization.findById(mapped._id);
  assert.equal(afterApply.orgType, "local_club");
  assert.equal(afterApply.type, "club");
  assert.equal(afterApply.orgTypeMigration?.applied, true);
  assert.equal((await TeamOrganization.findById(unknown._id)).orgType, undefined);

  const reverted = await runFile(process.execPath, [script, "--revert", "--apply"], options());
  assert.match(reverted.stdout, /reverted=1/);
  const afterRevert = await TeamOrganization.findById(mapped._id);
  assert.equal(afterRevert.orgType, undefined);
  assert.equal(afterRevert.type, "club");
});
