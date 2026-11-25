/**
 * Owner-scoped image upload: magic bytes, compression, quota, tenancy and audit.
 *
 * Runs a tiny Express app with the REAL auth/org guards and multer wrapper
 * against a disposable Mongo database and a temporary uploads directory, so no
 * test writes into the repository tree and no live server is required.
 */

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cricall-org-upload-"));
process.env.UPLOADS_DIR = uploadsDir;
process.env.JWT_SECRET = "org-upload-test-secret";
process.env.REQUIRE_VERIFIED_ACCOUNT = "true";
process.env.PUBLIC_BACKEND_URL = "http://uploads.test";
process.env.ORG_UPLOAD_QUOTA_MB = "200";

const express = (await import("express")).default;
const jwt = (await import("jsonwebtoken")).default;
const sharp = (await import("sharp")).default;
const { startTestDb, stopTestDb } = await import("./helpers/testDb.js");
const User = (await import("../src/models/User.js")).default;
const TeamOrganization = (await import("../src/models/TeamOrganization.js")).default;
const Membership = (await import("../src/models/Membership.js")).default;
const OrgUpload = (await import("../src/models/OrgUpload.js")).default;
const AuditLog = (await import("../src/models/AuditLog.js")).default;
const { protect, requireVerifiedEmail } = await import("../src/middleware/authMiddleware.js");
const validateObjectId = (await import("../src/middleware/validateObjectId.js")).default;
const { requireAnyOrgPermission } = await import("../src/middleware/orgAccess.js");
const { PERMISSIONS } = await import("../src/permissions/orgPermissions.js");
const rateLimiter = (await import("../src/middleware/rateLimiter.js")).default;
const { imageUploadSingle } = await import("../src/middleware/imageUpload.js");
const { uploadOrganizationImage, deleteOrganizationImage } = await import(
  "../src/controllers/orgUploadController.js"
);
const { assertImageMagic, processImageUpload } = await import("../src/utils/imagePipeline.js");
const { cacheControlForUpload, isUploadedFilename } = await import("../src/utils/photoStore.js");
const { releaseOrgUpload } = await import("../src/services/orgUploadService.js");
const { orgTeamAddPlayersSchema } = await import("../src/validators/teamValidators.js");

const app = express();
const guard = [
  protect,
  requireVerifiedEmail,
  validateObjectId("id"),
  requireAnyOrgPermission(PERMISSIONS.MANAGE_PLAYERS, PERMISSIONS.PUBLISH_CONTENT),
  rateLimiter({ windowMs: 60_000, max: 500 }),
];
app.post("/api/organizations/:id/uploads/image", ...guard, imageUploadSingle("image"), uploadOrganizationImage);
app.delete("/api/organizations/:id/uploads/image/:filename", ...guard, deleteOrganizationImage);
app.use(
  "/uploads",
  express.static(uploadsDir, {
    setHeaders(res, filePath) {
      const value = cacheControlForUpload(path.basename(filePath));
      if (value) res.setHeader("Cache-Control", value);
    },
  })
);

let mongod;
let server;
let base;

before(async () => {
  mongod = await startTestDb();
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await stopTestDb(mongod);
  fs.rmSync(uploadsDir, { recursive: true, force: true });
});

let counter = 0;
async function makeUser(overrides = {}) {
  counter += 1;
  return User.create({
    name: `Upload Person ${counter}`,
    email: `upload-${counter}-${crypto.randomBytes(3).toString("hex")}@example.test`,
    password: "password-123",
    emailVerified: true,
    tokenVersion: 0,
    accountType: "organization_admin",
    ...overrides,
  });
}

async function makeOrg(roles = ["owner"]) {
  const owner = await makeUser();
  const org = await TeamOrganization.create({ name: `Upload Org ${counter}` });
  if (roles.length) {
    await Membership.create({ organization: org._id, user: owner._id, roles, status: "active" });
  }
  return { owner, org };
}

function tokenFor(user) {
  return jwt.sign({ id: String(user._id), tv: user.tokenVersion || 0 }, process.env.JWT_SECRET);
}

async function makePhoto(width = 2400, height = 1600) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 40 + (width % 120), g: 90, b: 160 },
    },
  })
    .png()
    .toBuffer();
}

function formFor(buffer, { filename = "photo.png", type = "image/png" } = {}) {
  const form = new FormData();
  form.append("image", new Blob([buffer], { type }), filename);
  return form;
}

async function postImage(orgId, token, form) {
  return fetch(`${base}/api/organizations/${orgId}/uploads/image`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
}

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    TeamOrganization.deleteMany({}),
    Membership.deleteMany({}),
    OrgUpload.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);
});

// ---------------------------------------------------------------------------
// Pipeline unit checks
// ---------------------------------------------------------------------------

test("valid JPEG/PNG/WebP inputs are accepted and shrunk to WebP + thumbnail", async () => {
  for (const type of ["png", "jpeg", "webp"]) {
    const source = await sharp({
      create: { width: 2400, height: 1600, channels: 3, background: { r: 30, g: 90, b: 150 } },
    })
      [type]()
      .toBuffer();
    const processed = await processImageUpload(source, `image/${type === "jpeg" ? "jpeg" : type}`, `${type}.${type}`);
    const meta = await sharp(processed.main).metadata();
    const thumb = await sharp(processed.thumbnail).metadata();
    assert.equal(meta.format, "webp");
    assert.ok(Math.max(meta.width, meta.height) <= 1600, `${type} longest edge must be <= 1600`);
    assert.ok(Math.max(thumb.width, thumb.height) <= 400, `${type} thumbnail edge must be <= 400`);
    assert.ok(processed.main.length < 300 * 1024, `${type} main should be under 300 KB`);
    assert.ok(processed.thumbnail.length < processed.main.length, "thumbnail is smaller than the main image");
  }
});

test("a fake file with an image extension is rejected by magic bytes", async () => {
  await assert.rejects(
    () => processImageUpload(Buffer.from("this is definitely not an image"), "image/png", "fake.png"),
    /does not match its image type/
  );
  // The shared byte check also covers the existing admin route.
  assert.throws(() => assertImageMagic(Buffer.from("GIF89a-nope"), "image/jpeg"), /does not match/);
});

test("animated and huge-pixel inputs are rejected", async () => {
  const png = await makePhoto(200, 200);
  // Insert an acTL marker into a valid PNG: APNG frames must never be accepted.
  const idat = png.indexOf(Buffer.from("IDAT")) - 4;
  const animatedPng = Buffer.concat([png.subarray(0, idat), Buffer.from("acTL"), png.subarray(idat)]);
  await assert.rejects(() => processImageUpload(animatedPng, "image/png", "animated.png"), /Animated/);

  const webp = await sharp({ create: { width: 200, height: 200, channels: 3, background: "blue" } })
    .webp()
    .toBuffer();
  const animatedWebp = Buffer.concat([webp.subarray(0, 12), Buffer.from("ANIM"), webp.subarray(12)]);
  await assert.rejects(() => processImageUpload(animatedWebp, "image/webp", "animated.webp"), /Animated/);

  const huge = await makePhoto(8000, 8000); // 64 megapixels, still a tiny PNG
  await assert.rejects(() => processImageUpload(huge, "image/png", "huge.png"), /pixels|too large/);
});

// ---------------------------------------------------------------------------
// Route: auth, permissions, tenancy, quota, storage and audit
// ---------------------------------------------------------------------------

test("owner upload returns a /uploads URL, writes only WebP + thumbnail and audits it", async () => {
  const { owner, org } = await makeOrg();
  const before = fs.readdirSync(uploadsDir).length;
  const source = await makePhoto();
  const res = await postImage(org._id, tokenFor(owner), formFor(source));
  const raw = await res.text();
  assert.equal(res.status, 201, raw);
  const body = JSON.parse(raw);

  assert.ok(body.url.startsWith("http://uploads.test/uploads/"));
  assert.match(body.filename, /^[0-9a-f]{64}\.webp$/);
  assert.match(body.thumbnailUrl, /-thumb\.webp$/);
  assert.ok(body.bytes > 0 && body.bytes < 300 * 1024);
  assert.equal(body.quotaBytes, 200 * 1024 * 1024);

  const names = fs.readdirSync(uploadsDir);
  assert.equal(names.length, before + 2, "only the WebP and its thumbnail are stored");
  assert.ok(names.includes(body.filename));
  assert.ok(names.includes(path.basename(new URL(body.thumbnailUrl).pathname)));
  assert.ok(!names.some((name) => name.endsWith(".png")), "original must be discarded");
  assert.equal(cacheControlForUpload(body.filename), "public, max-age=31536000, immutable");
  assert.ok(isUploadedFilename(body.filename));

  const record = await OrgUpload.findOne({ organization: org._id, filename: body.filename });
  assert.equal(record?.bytes, body.bytes);
  assert.ok(record.uploader.equals(owner._id));
  const audit = await AuditLog.findOne({ organization: org._id, action: "org.upload_image" });
  assert.ok(audit, "upload is audited on the organization");

  const fetched = await fetch(`${base}/uploads/${body.filename}`);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.headers.get("cache-control"), "public, max-age=31536000, immutable");
});

test("player and staff roles are denied; another org's id is denied", async () => {
  const { org } = await makeOrg(["owner"]);
  for (const role of ["player", "staff"]) {
    const limited = await makeUser({ accountType: "player", role: "viewer" });
    await Membership.create({ organization: org._id, user: limited._id, roles: [role] });
    const res = await postImage(org._id, tokenFor(limited), formFor(await makePhoto(200, 200)));
    assert.equal(res.status, 403, `${role} must not upload`);
    assert.equal((await res.json()).code, "ORG_PERMISSION_DENIED");
  }

  const { owner } = await makeOrg(["owner"]);
  const foreign = await TeamOrganization.create({ name: "Foreign Org" });
  const res = await postImage(foreign._id, tokenFor(owner), formFor(await makePhoto(200, 200)));
  assert.equal(res.status, 403, "membership in another org does not grant access");
  assert.equal((await res.json()).code, "ORG_MEMBERSHIP_REQUIRED");
});

test("a fake PNG with a valid extension is rejected at the route", async () => {
  const { owner, org } = await makeOrg();
  const res = await postImage(org._id, tokenFor(owner), formFor(Buffer.from("not really a png")));
  assert.equal(res.status, 400);
  assert.match((await res.json()).message, /does not match its image type/);
  assert.equal(await OrgUpload.countDocuments({}), 0);
});

test("quota exceeded returns 413 and leaves no stored bytes or record", async () => {
  const { owner, org } = await makeOrg();
  process.env.ORG_UPLOAD_QUOTA_MB = "0.0001"; // ~104 bytes, smaller than any WebP
  try {
    const before = fs.readdirSync(uploadsDir).length;
    const res = await postImage(org._id, tokenFor(owner), formFor(await makePhoto(600, 400)));
    assert.equal(res.status, 413);
    const body = await res.json();
    assert.equal(body.code, "ORG_UPLOAD_QUOTA_EXCEEDED");
    assert.match(body.message, /quota exceeded/i);
    assert.equal(await OrgUpload.countDocuments({ organization: org._id }), 0);
    assert.equal(fs.readdirSync(uploadsDir).length, before, "rejected upload cleans up its files");
  } finally {
    process.env.ORG_UPLOAD_QUOTA_MB = "200";
  }
});

test("deleting a photo frees both files and its quota row", async () => {
  const { owner, org } = await makeOrg();
  const uploadRes = await postImage(org._id, tokenFor(owner), formFor(await makePhoto(800, 600)));
  assert.equal(uploadRes.status, 201);
  const body = await uploadRes.json();
  assert.equal(await OrgUpload.countDocuments({ organization: org._id }), 1);

  const del = await fetch(
    `${base}/api/organizations/${org._id}/uploads/image/${body.filename}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${tokenFor(owner)}` } }
  );
  const delRaw = await del.text();
  assert.equal(del.status, 200, delRaw);
  assert.equal(JSON.parse(delRaw).removed, true);
  assert.equal(await OrgUpload.countDocuments({ organization: org._id }), 0);
  assert.ok(!fs.existsSync(path.join(uploadsDir, body.filename)));
  assert.ok(!fs.existsSync(path.join(uploadsDir, path.basename(new URL(body.thumbnailUrl).pathname))));

  // Same cleanup path used when a player photo is replaced or removed.
  const second = await postImage(org._id, tokenFor(owner), formFor(await makePhoto(700, 500)));
  const secondBody = await second.json();
  assert.equal(await releaseOrgUpload(secondBody.url, org._id), true);
  assert.equal(await OrgUpload.countDocuments({ organization: org._id }), 0);
});

test("newPlayer schema accepts only own /uploads image URLs", async () => {
  const hash = crypto.randomBytes(32).toString("hex");
  const own = { playerIds: [], newPlayer: { name: "Photo Player", imageUrl: `/uploads/${hash}.webp` } };
  assert.equal(orgTeamAddPlayersSchema.safeParse(own).success, true);

  for (const imageUrl of [
    "https://evil.test/uploads/photo.webp",
    "/uploads/../../secrets.txt",
    "/uploads/not-a-server-file.jpg",
  ]) {
    const parsed = orgTeamAddPlayersSchema.safeParse({
      playerIds: [],
      newPlayer: { name: "Photo Player", imageUrl },
    });
    assert.equal(parsed.success, false, `${imageUrl} must be refused`);
  }
});
