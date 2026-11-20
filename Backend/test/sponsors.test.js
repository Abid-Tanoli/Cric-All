import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.JWT_SECRET = process.env.JWT_SECRET || "sponsor-test-secret";
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "cricall-sponsors-"));
process.env.UPLOADS_DIR = uploadDir;

import express from "express";
import mongoose from "mongoose";
import { startTestDb, stopTestDb } from "./helpers/testDb.js";
import User from "../src/models/User.js";
import Admin from "../src/models/Admin.js";
import TeamOrganization from "../src/models/TeamOrganization.js";
import Membership from "../src/models/Membership.js";
import Tournament from "../src/models/Tournament.js";
import Sponsor from "../src/models/Sponsor.js";
import AuditLog from "../src/models/AuditLog.js";
import { generateToken } from "../src/utils/jwt.js";

// These tests mount the real routers in-process against a throwaway MongoDB.
// They never call the developer's localhost:5000 server, so the known local
// ECONNREFUSED issue cannot affect this suite.

let mongod;
let server;
let baseUrl;
let adminRoutes;
let organizationRoutes;
let tournamentRoutes;

before(async () => {
  mongod = await startTestDb();
  ({ default: adminRoutes } = await import("../src/routes/adminRoutes.js"));
  ({ default: organizationRoutes } = await import("../src/routes/organizationRoutes.js"));
  ({ default: tournamentRoutes } = await import("../src/routes/tournamentRoutes.js"));

  const app = express();
  app.use(express.json());
  app.use("/admin", adminRoutes);
  app.use("/organizations", organizationRoutes);
  app.use("/tournaments", tournamentRoutes);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await stopTestDb(mongod);
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Admin.deleteMany({}),
    TeamOrganization.deleteMany({}),
    Membership.deleteMany({}),
    Tournament.deleteMany({}),
    Sponsor.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);
});

let counter = 0;
const uniq = () => {
  counter += 1;
  return `${counter}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
};

async function request(method, urlPath, { token, body, form } = {}) {
  const headers = form ? {} : { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: form || (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: response.status, body: data };
}

async function makeUser(roles = []) {
  const tag = uniq();
  const user = await User.create({
    name: `Sponsor Person ${tag}`,
    email: `sponsor-${tag}@openctest.dev`,
    password: "password-123",
    accountType: "organization_admin",
    emailVerified: true,
  });
  return { user, token: generateToken(user), roles };
}

async function makeAdmin() {
  const tag = uniq();
  const admin = await Admin.create({
    name: `Sponsor Admin ${tag}`,
    email: `sponsor-admin-${tag}@openctest.dev`,
    password: "password-123",
    role: "admin",
  });
  return { admin, token: generateToken(admin) };
}

async function makeOrg(owner, label = "Club") {
  const tag = uniq();
  const org = await TeamOrganization.create({
    name: `${label} ${tag}`,
    slug: `${label.toLowerCase()}-${tag.toLowerCase()}`,
    owner: owner.user._id,
  });
  await Membership.create({
    organization: org._id,
    user: owner.user._id,
    roles: owner.roles.length ? owner.roles : ["owner"],
    status: "active",
  });
  return org;
}

async function makeTournament(org, label = "Cup") {
  const tag = uniq();
  return Tournament.create({
    name: `${label} ${tag}`,
    startDate: new Date(Date.now() - 86_400_000),
    endDate: new Date(Date.now() + 86_400_000),
    organizationRef: org?._id || null,
  });
}

const sponsorBody = (overrides = {}) => ({
  name: `Local Sponsor ${uniq()}`,
  logoUrl: "/uploads/1234567890123-abcdefabcdef-logo.png",
  tier: "supporting",
  ...overrides,
});

const adminCreate = (token, body) => request("POST", "/admin/sponsors", { token, body: sponsorBody(body) });
const orgPath = (org, tournament) => `/organizations/${org._id}/tournaments/${tournament._id}/sponsors`;
const orgCreate = (token, org, tournament, body = {}) =>
  request("POST", orgPath(org, tournament), { token, body: sponsorBody(body) });

const pngBuffer = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082", "hex");
const safeSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>');
const unsafeSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

function logoForm(buffer, filename = "logo.png", type = "image/png") {
  const form = new FormData();
  form.append("logo", new Blob([buffer], { type }), filename);
  return form;
}

describe("sponsor API", () => {
  test("limits active title and supporting sponsors per tournament", async () => {
    const { token } = await makeAdmin();
    const tournament = await makeTournament(null);

    const title = await adminCreate(token, { scope: "tournament", tournamentRef: String(tournament._id), tier: "title" });
    assert.equal(title.status, 201, JSON.stringify(title.body));

    const secondTitle = await adminCreate(token, { scope: "tournament", tournamentRef: String(tournament._id), tier: "title" });
    assert.equal(secondTitle.status, 400, JSON.stringify(secondTitle.body));
    assert.match(secondTitle.body.message, /one active title sponsor/i);

    for (let i = 0; i < 6; i += 1) {
      const created = await adminCreate(token, { scope: "tournament", tournamentRef: String(tournament._id) });
      assert.equal(created.status, 201, `supporting ${i + 1}: ${JSON.stringify(created.body)}`);
    }
    const seventh = await adminCreate(token, { scope: "tournament", tournamentRef: String(tournament._id) });
    assert.equal(seventh.status, 400, JSON.stringify(seventh.body));
    assert.match(seventh.body.message, /six active supporting sponsors/i);

    // A platform-wide sponsor occupies the same slots on every tournament.
    const platformTitle = await adminCreate(token, { scope: "platform", tier: "title" });
    assert.equal(platformTitle.status, 400);
    const platformSupporting = await adminCreate(token, { scope: "platform" });
    assert.equal(platformSupporting.status, 400);
  });

  test("platform-wide sponsors count towards tournament caps", async () => {
    const { token } = await makeAdmin();
    const tournament = await makeTournament(null);

    const platformTitle = await adminCreate(token, { scope: "platform", tier: "title" });
    assert.equal(platformTitle.status, 201, JSON.stringify(platformTitle.body));
    const localTitle = await adminCreate(token, { scope: "tournament", tournamentRef: String(tournament._id), tier: "title" });
    assert.equal(localTitle.status, 400);
  });

  test("validates links: https and wa.me allowed, javascript/data/http rejected", async () => {
    const { token } = await makeAdmin();
    const tournament = await makeTournament(null);
    const base = { scope: "tournament", tournamentRef: String(tournament._id) };

    for (const linkUrl of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "http://example.com/sponsor", "//example.com/sponsor"]) {
      const res = await adminCreate(token, { ...base, linkUrl });
      assert.equal(res.status, 400, `${linkUrl} should be rejected: ${JSON.stringify(res.body)}`);
    }
    for (const linkUrl of ["https://example.com/sponsor", "https://wa.me/15551234567", ""]) {
      const res = await adminCreate(token, { ...base, linkUrl });
      assert.equal(res.status, 201, `${linkUrl} should be accepted: ${JSON.stringify(res.body)}`);
    }
  });

  test("uploads only safe images and rejects executable content", async () => {
    const { token } = await makeAdmin();
    const url = "/admin/sponsors/logo";

    const png = await request("POST", url, { token, form: logoForm(pngBuffer) });
    assert.equal(png.status, 201, JSON.stringify(png.body));
    assert.match(png.body.url, /\/uploads\/.+\.png$/);

    const svg = await request("POST", url, {
      token,
      form: logoForm(safeSvg, "logo.svg", "image/svg+xml"),
    });
    assert.equal(svg.status, 201, JSON.stringify(svg.body));
    assert.match(svg.body.url, /\/uploads\/.+\.svg$/);

    const script = await request("POST", url, {
      token,
      form: logoForm(unsafeSvg, "bad.svg", "image/svg+xml"),
    });
    assert.equal(script.status, 400, JSON.stringify(script.body));
    assert.match(script.body.message, /unsafe/i);

    const fakePng = await request("POST", url, {
      token,
      form: logoForm(Buffer.from("<script>alert(1)</script>")),
    });
    assert.equal(fakePng.status, 400);

    const huge = await request("POST", url, {
      token,
      form: logoForm(Buffer.alloc(5 * 1024 * 1024 + 1, 1)),
    });
    assert.equal(huge.status, 400);
  });

  test("public endpoint returns only active safe fields, title first", async () => {
    const { token } = await makeAdmin();
    const tournament = await makeTournament(null);
    const other = await makeTournament(null);

    const supporting = await adminCreate(token, {
      scope: "tournament",
      tournamentRef: String(tournament._id),
      tier: "supporting",
      order: 5,
      linkUrl: "https://example.com/support",
    });
    const title = await adminCreate(token, {
      scope: "tournament",
      tournamentRef: String(tournament._id),
      tier: "title",
      order: 9,
    });
    await adminCreate(token, { scope: "tournament", tournamentRef: String(other._id) });
    await Sponsor.create(sponsorBody({
      scope: "tournament",
      tournamentRef: tournament._id,
      active: false,
      name: "Hidden Sponsor",
    }));

    const res = await request("GET", `/tournaments/${tournament._id}/sponsors`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.length, 2);
    assert.equal(res.body[0].name, title.body.name);
    assert.equal(res.body[1].name, supporting.body.name);
    for (const sponsor of res.body) {
      assert.deepEqual(Object.keys(sponsor).sort(), ["_id", "linkUrl", "logoUrl", "name", "order", "tier"]);
      assert.equal(sponsor.active, undefined);
      assert.equal(sponsor.createdBy, undefined);
      assert.equal(sponsor.scope, undefined);
      assert.equal(sponsor.tournamentRef, undefined);
    }
    assert.ok(!JSON.stringify(res.body).includes("Hidden Sponsor"));
  });

  test("public endpoint includes platform-wide sponsors", async () => {
    const { token } = await makeAdmin();
    const tournament = await makeTournament(null);
    const global = await adminCreate(token, { scope: "platform" });
    assert.equal(global.status, 201, JSON.stringify(global.body));

    const res = await request("GET", `/tournaments/${tournament._id}/sponsors`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.map((entry) => entry._id), [global.body._id]);
  });

  test("org owner can CRUD own sponsors but not another role or tenant", async () => {
    const owner = await makeUser();
    const manager = await makeUser(["manager"]);
    const outsider = await makeUser();
    const org = await makeOrg(owner);
    await Membership.create({ organization: org._id, user: manager.user._id, roles: ["manager"], status: "active" });
    const tournament = await makeTournament(org);

    const created = await orgCreate(owner.token, org, tournament, { name: "Owner Sponsor" });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.organizationRef, String(org._id));
    assert.equal(created.body.scope, "tournament");

    const denied = await orgCreate(manager.token, org, tournament);
    assert.equal(denied.status, 403, JSON.stringify(denied.body));
    const noMembership = await orgCreate(outsider.token, org, tournament);
    assert.equal(noMembership.status, 403, JSON.stringify(noMembership.body));

    const update = await request("PUT", `${orgPath(org, tournament)}/${created.body._id}`, {
      token: owner.token,
      body: { active: false, tier: "supporting" },
    });
    assert.equal(update.status, 200, JSON.stringify(update.body));
    assert.equal(update.body.active, false);

    const deleted = await request("DELETE", `${orgPath(org, tournament)}/${created.body._id}`, { token: owner.token });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  });

  test("cross-org sponsor ids are 404 and never mutated", async () => {
    const ownerA = await makeUser();
    const ownerB = await makeUser();
    const orgA = await makeOrg(ownerA);
    const orgB = await makeOrg(ownerB);
    const tournamentA = await makeTournament(orgA);
    const tournamentB = await makeTournament(orgB);

    const victim = await orgCreate(ownerB.token, orgB, tournamentB, { name: "Tenant B Sponsor" });
    assert.equal(victim.status, 201, JSON.stringify(victim.body));
    const before = await Sponsor.findById(victim.body._id).lean();

    // Using org A's id with org B's tournament must not resolve the tenant.
    const wrongTournament = await orgCreate(ownerA.token, orgA, tournamentB);
    assert.equal(wrongTournament.status, 404, JSON.stringify(wrongTournament.body));

    // A real sponsor from B cannot be updated through A's verified route.
    const crossUpdate = await request("PUT", `${orgPath(orgA, tournamentA)}/${victim.body._id}`, {
      token: ownerA.token,
      body: { name: "Hacked" },
    });
    assert.equal(crossUpdate.status, 404, JSON.stringify(crossUpdate.body));
    const crossDelete = await request("DELETE", `${orgPath(orgA, tournamentA)}/${victim.body._id}`, { token: ownerA.token });
    assert.equal(crossDelete.status, 404, JSON.stringify(crossDelete.body));

    const after = await Sponsor.findById(victim.body._id).lean();
    assert.equal(after.name, before.name);
    assert.equal(after.active, before.active);
  });

  test("deleting a sponsor is allowed for an owner and always audit-logged", async () => {
    const owner = await makeUser();
    const org = await makeOrg(owner);
    const tournament = await makeTournament(org);
    const created = await orgCreate(owner.token, org, tournament, { name: "Audited Sponsor" });
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const deleted = await request("DELETE", `${orgPath(org, tournament)}/${created.body._id}`, { token: owner.token });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    assert.equal(await Sponsor.findById(created.body._id), null);

    const audit = await AuditLog.findOne({
      action: "sponsor.deleted",
      targetType: "sponsor",
      targetId: created.body._id,
    }).lean();
    assert.ok(audit, "sponsor deletion must be audit-logged");
    assert.equal(String(audit.organization), String(org._id));
    assert.equal(audit.actorType, "user");
    assert.equal(audit.targetLabel, "Audited Sponsor");
    assert.equal(audit.metadata.via, "organization");
  });

  test("admin manages every sponsor and the tournament filter works", async () => {
    const { token } = await makeAdmin();
    const tournamentA = await makeTournament(null, "Cup A");
    const tournamentB = await makeTournament(null, "Cup B");
    const localA = await adminCreate(token, { scope: "tournament", tournamentRef: String(tournamentA._id) });
    await adminCreate(token, { scope: "tournament", tournamentRef: String(tournamentB._id) });
    const global = await adminCreate(token, { scope: "platform" });
    assert.equal(localA.status, 201);
    assert.equal(global.status, 201);

    const list = await request("GET", `/admin/sponsors?tournamentId=${tournamentA._id}`, { token });
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.map((entry) => entry._id).sort(), [localA.body._id, global.body._id].sort());

    const reorder = await request("PUT", "/admin/sponsors/reorder", {
      token,
      body: { ids: [global.body._id, localA.body._id] },
    });
    assert.equal(reorder.status, 200, JSON.stringify(reorder.body));

    const removed = await request("DELETE", `/admin/sponsors/${localA.body._id}`, { token });
    assert.equal(removed.status, 200);
    assert.equal(await Sponsor.findById(localA.body._id), null);
  });
});
