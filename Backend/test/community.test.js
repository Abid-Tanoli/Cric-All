/**
 * Community content (step C) — end-to-end behaviour of /api/community.
 *
 * Everything runs against the live local API (127.0.0.1:5000) on the
 * disposable loopback database, exactly like the other HTTP suites:
 * guard proofs first, fixtures through the public API only, and assertions
 * on responses — never on raw collections. The two fixture exceptions are
 * the same ones the cross-tenant suite uses: resetPlatformAdmins() and
 * createPlatformAdmin(), because POST /admin/register closes permanently.
 *
 * Why the fixture users here are registered with plain fake names:
 * community reads hide reserved test names (OPENCODE_TEST_ etc.) from every
 * public surface — a suite that used the shared bootstrap would then be
 * unable to see its own posts anywhere. One reserved-name author is created
 * on purpose (reservedAuthor) to prove that hiding works.
 *
 * Rate-limit budgets are honoured deliberately: the create limiter is
 * 5 posts/minute per user, so every fixture that creates posts stays at or
 * below its own budget, and the test that is *about* the limiter spends a
 * dedicated user's (burstUser's) whole budget. Order of tests matters:
 * tests mutate shared settings (postMode, daily limit, communityEnabled,
 * bannedPosters) and restore them inline before the next test runs.
 */

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { API_BASE, assertLocalTarget, assertServerIsLocal } from "./e2e/lib/guard.js";
import { createClient } from "./e2e/lib/http.js";
import { resetPlatformAdmins, createPlatformAdmin } from "./helpers/localFixtures.js";

const PASSWORD = "OpencodeLocal!2026";
const LOG_PATH = process.env.E2E_BACKEND_LOG || "backend.log";
const ABSENT_ID = "0123456789abcdef01234567";
const OPERATOR_ID = encodeURIComponent(JSON.stringify({ $ne: null }));

// ---------------------------------------------------------------------------
// Console-mail token plumbing — same mechanism as e2e/lib/bootstrap.js, but
// with its own cursor and no name prefix (see header comment).
// ---------------------------------------------------------------------------

let logCursor = 0;

function syncLogCursor() {
  if (!existsSync(LOG_PATH)) {
    logCursor = 0;
    return;
  }
  logCursor = readFileSync(LOG_PATH, "utf8").length;
}

function readNewLog() {
  if (!existsSync(LOG_PATH)) return "";
  const text = readFileSync(LOG_PATH, "utf8");
  const chunk = text.slice(logCursor);
  logCursor = text.length;
  return chunk;
}

function extractVerifyToken(text, recipient) {
  const re = /verify-email\/([A-Za-z0-9_-]{16,128})/;
  const needle = String(recipient).toLowerCase();
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.toLowerCase().includes(needle)) continue;
    const m = line.match(re);
    if (m) return m[1];
  }
  return null;
}

async function waitForVerifyToken(recipient) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const token = extractVerifyToken(readNewLog(), recipient);
    if (token) return token;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no verify-email token for ${recipient} in ${LOG_PATH}`);
}

async function registerPlainUser({ label, name, accountType = "player" }) {
  const api = createClient({ apiBase: API_BASE });
  const email = `${label}.${runId}@example.test`.toLowerCase();
  await api.post(
    "/auth/register",
    { name, email, password: PASSWORD, accountType },
    { expect: [200, 201] }
  );
  const token = await waitForVerifyToken(email);
  await api.post("/auth/verify-email", { token }, { expect: [200] });
  const login = await api.post("/auth/login", { email, password: PASSWORD }, { expect: [200] });
  api.setToken(login.body?.token);
  const profile = await api.get("/auth/profile", { expect: [200] });
  const u = profile.body?.user || profile.body;
  const userId = String(u?._id || "");
  assert.ok(userId, `no user id for ${email}`);
  return { label, name, email, userId, token: login.body?.token, api };
}

// ---------------------------------------------------------------------------
// World state
// ---------------------------------------------------------------------------

let runId;
let anon;
let adminApi;
let adminToken;
let owner;
let member;
let linked;
let stranger;
let author;
let visAuthor;
let xUser;
let mediaUser;
let dailyUser;
let burstUser;
let disabledUser;
let reservedAuthor;

let orgId;
let teamId;
let reservedTeamId;
let playerId;
let ownerTeamPostId;
let socialPostId;
let socialCommentId;
let autoSharePostId;

function feedIds(body) {
  return (body?.posts || []).map((p) => String(p._id));
}

async function setSettings(patch) {
  return adminApi.patch("/community/admin/settings", patch, { expect: [200] });
}

async function createSelfPost(user, extra = {}, opts = {}) {
  const res = await user.api.post(
    "/community/posts",
    {
      kind: "story",
      subject: { type: "user", ref: user.userId },
      ...extra,
    },
    { expect: [201], ...opts }
  );
  return res.body.post;
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

before(async () => {
  assertLocalTarget();
  await assertServerIsLocal();
  syncLogCursor();

  runId = `comm_${process.pid}_${Date.now().toString(36)}`;
  anon = createClient({ apiBase: API_BASE });

  // Platform admin — the same documented fixture exception as crossTenant.
  await resetPlatformAdmins();
  const adminFixture = await createPlatformAdmin({
    name: "Farhan Qadir",
    email: `community.admin.${runId}@example.test`,
    password: PASSWORD,
  });
  adminApi = createClient({ apiBase: API_BASE });
  const adminLogin = await adminApi.post(
    "/admin/login",
    { email: adminFixture.email, password: PASSWORD },
    { expect: [200] }
  );
  adminToken = adminLogin.body?.token;
  assert.ok(adminToken, "admin login returned no token");
  adminApi.setToken(adminToken);

  // 12 plain-name users (see header for why they are not bootstrap users).
  owner = await registerPlainUser({ label: "owner", name: "Nadia Fairholt", accountType: "organization_admin" });
  member = await registerPlainUser({ label: "member", name: "Tobin Mersey" });
  linked = await registerPlainUser({ label: "linked", name: "Junaid Bumpers" });
  stranger = await registerPlainUser({ label: "stranger", name: "Rory Fenlow" });
  author = await registerPlainUser({ label: "author", name: "Priya Stallworth" });
  visAuthor = await registerPlainUser({ label: "vis", name: "Marcus Tidal" });
  xUser = await registerPlainUser({ label: "xuser", name: "Elif Brandt" });
  mediaUser = await registerPlainUser({ label: "media", name: "Otto Fencepost" });
  dailyUser = await registerPlainUser({ label: "daily", name: "Omar Quillvane" });
  burstUser = await registerPlainUser({ label: "burst", name: "Sana Reddy" });
  disabledUser = await registerPlainUser({ label: "disabled", name: "Wes Okonkwo" });
  reservedAuthor = await registerPlainUser({
    label: "hidden",
    name: `OPENCODE_TEST_CommHidden_${runId}`,
  });

  // Organization + teams (owned by owner, who signed up as organization_admin).
  const orgRes = await owner.api.post(
    "/organizations",
    {
      name: `Coverdrive Cricket Club ${runId}`,
      type: "club",
      shortName: `CC${runId.replace(/[^a-zA-Z0-9]/g, "").slice(-6)}`,
    },
    { expect: [200, 201] }
  );
  orgId = String(orgRes.body?.organization?._id || orgRes.body?._id || "");
  assert.ok(orgId, `no organization id in ${JSON.stringify(orgRes.body)}`);

  const teamRes = await owner.api.post(
    `/organizations/${orgId}/teams`,
    { name: `Hill Park Strikers ${runId}`, isPublic: false },
    { expect: [200, 201] }
  );
  teamId = String(teamRes.body?.team?._id || teamRes.body?._id || "");
  assert.ok(teamId, `no team id in ${JSON.stringify(teamRes.body)}`);

  const reservedTeamRes = await owner.api.post(
    `/organizations/${orgId}/teams`,
    { name: `OPENCODE_TEST_ShadowXI_${runId}`, isPublic: false },
    { expect: [200, 201] }
  );
  reservedTeamId = String(reservedTeamRes.body?.team?._id || reservedTeamRes.body?._id || "");
  assert.ok(reservedTeamId, "no reserved team id");

  // member joins with the "player" role: an active membership whose role has
  // no publish/manage permission (exercises the role branch of authorizeSubject).
  await owner.api.post(
    `/organizations/${orgId}/members`,
    { email: member.email, roles: ["player"] },
    { expect: [200, 201] }
  );

  // The player linkage used by player posts: Player.createdBy, set by
  // playerController.createPlayer on POST /api/players.
  const playerRes = await linked.api.post(
    "/players",
    { name: `Fawad Netside ${runId}`, playingRole: "Batsman", battingStyle: "Right-handed" },
    { expect: [200, 201] }
  );
  playerId = String(playerRes.body?.player?._id || playerRes.body?._id || "");
  assert.ok(playerId, `no player id in ${JSON.stringify(playerRes.body)}`);

  // Community settings default to communityEnabled:false — open them up.
  await setSettings({
    communityEnabled: true,
    postMode: "auto",
    maxPostsPerUserPerDay: 10,
    maxImagesPerPost: 6,
    bannedPosters: [],
  });
});

after(async () => {
  assert.ok(orgId, "world was never built; the suite did not run");
  // Leave the settings at their shipped defaults for any later suite.
  await adminApi.patch(
    "/community/admin/settings",
    {
      communityEnabled: false,
      postMode: "auto",
      maxPostsPerUserPerDay: 10,
      maxImagesPerPost: 6,
      bannedPosters: [],
    },
    { expect: [200] }
  );
});

// ---------------------------------------------------------------------------
// T1 — CRUD happy path
// ---------------------------------------------------------------------------

test("posts are created, read back, edited and deleted by their author only", async () => {
  const p1 = await createSelfPost(author, {
    title: "Dressing room notes",
    body: "We chased 174 in the last over.",
  });
  assert.equal(p1.status, "published", "postMode auto publishes immediately");
  assert.equal(String(p1.authorUser), author.userId, "the author comes from the token, never the body");

  // Server-owned fields are not writable from the client (strict schema).
  const spoof = await author.api.post("/community/posts", {
    kind: "story",
    subject: { type: "user", ref: author.userId },
    title: "Spoof attempt",
    authorUser: stranger.userId,
    status: "hidden",
    reportCount: 99,
    shareCount: 99,
  });
  assert.equal(spoof.status, 400, JSON.stringify(spoof.body));
  assert.equal(spoof.body?.message, "Validation failed");

  const read = await anon.get(`/community/posts/${p1._id}`, { expect: [200] });
  assert.equal(read.body.post.title, "Dressing room notes");
  assert.equal(read.body.post.authorUser.name, author.name, "author name is populated for readers");

  const feed = await anon.get(`/community/feed?subjectType=user&subjectId=${author.userId}`, { expect: [200] });
  assert.ok(feedIds(feed.body).includes(String(p1._id)), "the new post is in the filtered feed");

  const edit = await author.api.patch(
    `/community/posts/${p1._id}`,
    { title: "Dressing room notes (edited)" },
    { expect: [200] }
  );
  assert.equal(edit.body.post.title, "Dressing room notes (edited)");

  const strangerEdit = await stranger.api.patch(`/community/posts/${p1._id}`, { title: "not mine" });
  assert.equal(strangerEdit.status, 403);
  assert.equal(strangerEdit.body?.code, "COMMUNITY_NOT_AUTHOR");

  const strangerDelete = await stranger.api.del(`/community/posts/${p1._id}`);
  assert.equal(strangerDelete.status, 403);
  assert.equal(strangerDelete.body?.code, "COMMUNITY_NOT_AUTHOR");

  const del = await author.api.del(`/community/posts/${p1._id}`, undefined, { expect: [200] });
  assert.equal(del.body.message, "Post deleted");
  assert.equal((await anon.get(`/community/posts/${p1._id}`)).status, 404);

  const feedAfter = await anon.get(`/community/feed?subjectType=user&subjectId=${author.userId}`, { expect: [200] });
  assert.ok(!feedIds(feedAfter.body).includes(String(p1._id)), "deleted posts leave the feed");
  assert.equal(
    (await author.api.del(`/community/posts/${p1._id}`)).status,
    404,
    "a soft-deleted post is gone for everyone"
  );
});

// ---------------------------------------------------------------------------
// T2 — likes, comments, shares
// ---------------------------------------------------------------------------

test("likes toggle, comments belong to their author, shares count and stay encoded", async () => {
  const p2 = await createSelfPost(author, {
    title: `Wahab's "last-over" <3 & the tie`,
    body: "Three sixes, then the impossible catch.",
  });
  socialPostId = String(p2._id);

  const like1 = await stranger.api.post(`/community/posts/${p2._id}/like`, undefined, { expect: [200] });
  assert.deepEqual(like1.body, { liked: true });
  let read = await anon.get(`/community/posts/${p2._id}`, { expect: [200] });
  assert.equal(read.body.post.likeCount, 1);

  const like2 = await stranger.api.post(`/community/posts/${p2._id}/like`, undefined, { expect: [200] });
  assert.deepEqual(like2.body, { liked: false });
  read = await anon.get(`/community/posts/${p2._id}`, { expect: [200] });
  assert.equal(read.body.post.likeCount, 0);

  await stranger.api.post(`/community/posts/${p2._id}/like`, undefined, { expect: [200] }); // back on

  const c1 = await stranger.api.post(
    `/community/posts/${p2._id}/comments`,
    { body: "Absolute scenes at the death." },
    { expect: [201] }
  );
  assert.equal(c1.body.comment.body, "Absolute scenes at the death.");
  const c2 = await author.api.post(
    `/community/posts/${p2._id}/comments`,
    { body: "Thanks - it took all of them." },
    { expect: [201] }
  );
  socialCommentId = String(c2.body.comment._id);

  const list = await anon.get(`/community/posts/${p2._id}/comments`, { expect: [200] });
  assert.equal(list.body.comments.length, 2);

  const wrongDelete = await author.api.del(`/community/posts/${p2._id}/comments/${c1.body.comment._id}`);
  assert.equal(wrongDelete.status, 403);
  assert.equal(wrongDelete.body?.code, "COMMUNITY_NOT_AUTHOR");

  await stranger.api.del(`/community/posts/${p2._id}/comments/${c1.body.comment._id}`, undefined, { expect: [200] });
  const after = await anon.get(`/community/posts/${p2._id}/comments`, { expect: [200] });
  assert.equal(after.body.comments.length, 1);
  assert.equal(String(after.body.comments[0]._id), String(c2.body.comment._id));

  // Shares: no login required, and the title never lands raw in a URL.
  const s1 = await anon.post(`/community/posts/${p2._id}/share`, undefined, { expect: [200], retryOn429: false });
  assert.equal(s1.body.shareCount, 1);
  assert.match(s1.body.url, /^https?:\/\/.+\/community\/post\//);
  for (const [net, url] of Object.entries(s1.body.urls)) {
    assert.ok(!/[<>" ]/.test(url), `${net} share URL must percent-encode the title, got ${url}`);
  }
  assert.ok(!JSON.stringify(s1.body.urls).includes("<3"), "no raw angle bracket may survive into a share URL");

  const s2 = await anon.post(`/community/posts/${p2._id}/share`, undefined, { expect: [200], retryOn429: false });
  assert.equal(s2.body.shareCount, 2);

  // The stored title is plain text, exactly as sent — never unescaped markup.
  read = await anon.get(`/community/posts/${p2._id}`, { expect: [200] });
  assert.equal(read.body.post.title, `Wahab's "last-over" <3 & the tie`);
});

// ---------------------------------------------------------------------------
// T3 — permission matrix
// ---------------------------------------------------------------------------

test("permission matrix: team posts need org rights, player posts need the createdBy link", async () => {
  // A stranger with no membership at all.
  const strangerTeam = await stranger.api.post("/community/posts", {
    kind: "story",
    subject: { type: "team", ref: teamId },
    title: "Let me in",
  });
  assert.equal(strangerTeam.status, 403);
  assert.equal(strangerTeam.body?.code, "COMMUNITY_SUBJECT_DENIED");
  assert.match(strangerTeam.body?.message, /not a member/i);

  // A member of the org whose "player" role has no publish permission.
  const memberTeam = await member.api.post("/community/posts", {
    kind: "story",
    subject: { type: "team", ref: teamId },
    title: "I play here",
  });
  assert.equal(memberTeam.status, 403);
  assert.equal(memberTeam.body?.code, "COMMUNITY_SUBJECT_DENIED");
  assert.match(memberTeam.body?.message, /role/i);

  // The owner (manage_teams + publish_content) may post.
  const ownerTeam = await owner.api.post(
    "/community/posts",
    { kind: "story", subject: { type: "team", ref: teamId }, title: "Preseason friendly" },
    { expect: [201] }
  );
  ownerTeamPostId = String(ownerTeam.body.post._id);
  assert.equal(ownerTeam.body.post.status, "published");

  // A platform admin posts for a team they are not a member of.
  const adminTeam = await adminApi.post(
    "/community/posts",
    { kind: "story", subject: { type: "team", ref: teamId }, title: "Maintenance window" },
    { expect: [201] }
  );

  const teamFeed = await anon.get(`/community/teams/${teamId}/posts`, { expect: [200] });
  const teamFeedIds = feedIds(teamFeed.body);
  assert.ok(teamFeedIds.includes(ownerTeamPostId), "owner's team post is in the team feed");
  assert.ok(teamFeedIds.includes(String(adminTeam.body.post._id)), "admin's team post is in the team feed");

  // Player subject: the linkage is Player.createdBy (POST /api/players).
  const linkedPlayer = await linked.api.post(
    "/community/posts",
    { kind: "story", subject: { type: "player", ref: playerId }, title: "Nets day vlog" },
    { expect: [201] }
  );
  const strangerPlayer = await stranger.api.post("/community/posts", {
    kind: "story",
    subject: { type: "player", ref: playerId },
    title: "Not me",
  });
  assert.equal(strangerPlayer.status, 403);
  assert.equal(strangerPlayer.body?.code, "COMMUNITY_SUBJECT_DENIED");
  assert.match(strangerPlayer.body?.message, /not linked/i);
  const adminPlayer = await adminApi.post(
    "/community/posts",
    { kind: "story", subject: { type: "player", ref: playerId }, title: "Profile update" },
    { expect: [201] }
  );

  const playerFeed = await anon.get(`/community/players/${playerId}/posts`, { expect: [200] });
  const playerFeedIds = feedIds(playerFeed.body);
  assert.ok(playerFeedIds.includes(String(linkedPlayer.body.post._id)), "linked user's player post");
  assert.ok(playerFeedIds.includes(String(adminPlayer.body.post._id)), "admin's player post");

  // A user subject can only be yourself.
  const asOther = await stranger.api.post("/community/posts", {
    kind: "story",
    subject: { type: "user", ref: author.userId },
    title: "Pupilage",
  });
  assert.equal(asOther.status, 403);
  assert.equal(asOther.body?.code, "COMMUNITY_SUBJECT_DENIED");
  assert.match(asOther.body?.message, /only post as yourself/i);

  // Reserved-name teams are invisible to the community layer entirely.
  const reservedTeamPost = await owner.api.post("/community/posts", {
    kind: "story",
    subject: { type: "team", ref: reservedTeamId },
    title: "Ghosts",
  });
  assert.equal(reservedTeamPost.status, 404);
  assert.equal(reservedTeamPost.body?.code, "COMMUNITY_SUBJECT_NOT_FOUND");

  const absentTeamPost = await owner.api.post("/community/posts", {
    kind: "story",
    subject: { type: "team", ref: ABSENT_ID },
    title: "Nowhere",
  });
  assert.equal(absentTeamPost.status, 404);
  assert.equal(absentTeamPost.body?.code, "COMMUNITY_SUBJECT_NOT_FOUND");

  const badType = await owner.api.post("/community/posts", {
    kind: "story",
    subject: { type: "club", ref: teamId },
    title: "Wrong type",
  });
  assert.equal(badType.status, 400);
  assert.equal(badType.body?.message, "Validation failed");

  // Anonymous writes never start.
  const anonPost = await anon.post("/community/posts", {
    kind: "story",
    subject: { type: "user", ref: author.userId },
    title: "Anon",
  });
  assert.equal(anonPost.status, 401);
});

// ---------------------------------------------------------------------------
// T4 — moderation visibility + admin queue guards
// ---------------------------------------------------------------------------

test("hidden and removed posts never appear publicly; admins run the queue", async () => {
  const ph = await createSelfPost(visAuthor, {
    title: "Controversial take",
    body: "The neutral umpire had a shocker.",
  });

  const hide = await adminApi.post(`/community/admin/posts/${ph._id}/hide`, undefined, { expect: [200] });
  assert.equal(hide.body.post.status, "hidden");

  assert.equal((await anon.get(`/community/posts/${ph._id}`)).status, 404);
  assert.equal((await stranger.api.get(`/community/posts/${ph._id}`)).status, 404);
  const authorSees = await visAuthor.api.get(`/community/posts/${ph._id}`, { expect: [200] });
  assert.equal(authorSees.body.post.status, "hidden", "the author still sees their own hidden post");
  const strangerComments = await stranger.api.get(`/community/posts/${ph._id}/comments`);
  assert.equal(strangerComments.status, 404, "comments of a non-public post are non-public");
  const feedCheck = await anon.get(`/community/feed?subjectType=user&subjectId=${visAuthor.userId}`, {
    expect: [200],
  });
  assert.ok(!feedIds(feedCheck.body).includes(String(ph._id)), "hidden posts leave the public feed");

  const hiddenQueue = await adminApi.get("/community/admin/queue?status=hidden", { expect: [200] });
  assert.ok(feedIds(hiddenQueue.body).includes(String(ph._id)), "the moderation queue shows hidden posts");

  const remove = await adminApi.post(`/community/admin/posts/${ph._id}/remove`, undefined, { expect: [200] });
  assert.equal(remove.body.post.status, "removed");
  assert.equal((await anon.get(`/community/posts/${ph._id}`)).status, 404);

  const restore = await adminApi.post(`/community/admin/posts/${ph._id}/restore`, undefined, { expect: [200] });
  assert.equal(restore.body.post.status, "published");
  assert.equal((await anon.get(`/community/posts/${ph._id}`)).status, 200);

  // A team post follows the same rule inside the team feed.
  await adminApi.post(`/community/admin/posts/${ownerTeamPostId}/hide`, undefined, { expect: [200] });
  const teamFeedHidden = await anon.get(`/community/teams/${teamId}/posts`, { expect: [200] });
  assert.ok(!feedIds(teamFeedHidden.body).includes(ownerTeamPostId), "hidden team post leaves the team feed");
  await adminApi.post(`/community/admin/posts/${ownerTeamPostId}/restore`, undefined, { expect: [200] });
  const teamFeedBack = await anon.get(`/community/teams/${teamId}/posts`, { expect: [200] });
  assert.ok(feedIds(teamFeedBack.body).includes(ownerTeamPostId));

  // Queue access guards.
  assert.equal((await anon.get("/community/admin/queue")).status, 401);
  assert.equal((await owner.api.get("/community/admin/queue")).status, 403);
  assert.equal((await adminApi.get("/community/admin/queue?status=bogus")).status, 400);

  // Cursor operators are swallowed, never 5xx.
  const cursorOp = await adminApi.get("/community/admin/queue?status=hidden&cursor[$ne]=1", { expect: [200] });
  assert.ok(Array.isArray(cursorOp.body.posts));

  // Operator / malformed ids on admin actions are 4xx, never 5xx.
  assert.equal((await adminApi.post(`/community/admin/posts/${OPERATOR_ID}/approve`)).status, 400);
  assert.equal((await adminApi.post(`/community/admin/posts/${ABSENT_ID}/approve`)).status, 404);
  assert.equal((await adminApi.post(`/community/admin/posts/${OPERATOR_ID}/restore`)).status, 400);
  assert.equal((await adminApi.post(`/community/admin/users/${OPERATOR_ID}/ban-poster`)).status, 400);

  // A non-admin can never moderate.
  assert.equal((await owner.api.post(`/community/admin/posts/${ownerTeamPostId}/hide`)).status, 403);
});

// ---------------------------------------------------------------------------
// T5 — approval mode
// ---------------------------------------------------------------------------

test("postMode approval holds posts for review; only the author and admins see them", async () => {
  await setSettings({ postMode: "approval" });
  const pp = await createSelfPost(visAuthor, {
    title: "Opinion piece",
    body: "Bring back the single-innings final.",
  });
  autoSharePostId = String(pp._id);
  assert.equal(pp.status, "pending", "approval mode parks new posts as pending");

  assert.equal((await anon.get(`/community/posts/${pp._id}`)).status, 404);
  assert.equal(
    (await stranger.api.get(`/community/posts/${pp._id}`)).status,
    404,
    "pending posts are invisible to everyone but author and admins"
  );
  const authorView = await visAuthor.api.get(`/community/posts/${pp._id}`, { expect: [200] });
  assert.equal(authorView.body.post.status, "pending");
  const adminView = await adminApi.get(`/community/posts/${pp._id}`, { expect: [200] });
  assert.equal(adminView.body.post.status, "pending");

  const feed = await anon.get(`/community/feed?subjectType=user&subjectId=${visAuthor.userId}`, { expect: [200] });
  assert.ok(!feedIds(feed.body).includes(String(pp._id)), "pending posts leave the public feed");

  const pendingQueue = await adminApi.get("/community/admin/queue?status=pending", { expect: [200] });
  assert.ok(feedIds(pendingQueue.body).includes(String(pp._id)));

  const approve = await adminApi.post(`/community/admin/posts/${pp._id}/approve`, undefined, { expect: [200] });
  assert.equal(approve.body.post.status, "published");
  assert.equal((await anon.get(`/community/posts/${pp._id}`)).status, 200);

  await setSettings({ postMode: "auto" });
  const pa = await createSelfPost(visAuthor, {
    title: "Auto again",
    body: "Back to instant publish.",
  });
  autoSharePostId = String(pa._id); // clean, unshared published post for T7
  assert.equal(pa.status, "published", "postMode auto is restored");
});

// ---------------------------------------------------------------------------
// T6 — reports and auto-hide
// ---------------------------------------------------------------------------

test("three distinct reports auto-hide a post; self-reports and duplicates are refused", async () => {
  const pr = await createSelfPost(visAuthor, {
    title: "Rumour mill",
    body: "Someone is leaking team news.",
  });

  const self = await visAuthor.api.post(`/community/posts/${pr._id}/report`, { reason: "spam" });
  assert.equal(self.status, 400);
  assert.equal(self.body?.code, "COMMUNITY_SELF_REPORT");

  const r1 = await stranger.api.post(
    `/community/posts/${pr._id}/report`,
    { reason: "spam" },
    { expect: [201] }
  );
  assert.deepEqual(r1.body, { reportCount: 1, status: "published" });

  const dup = await stranger.api.post(`/community/posts/${pr._id}/report`, { reason: "abuse" });
  assert.equal(dup.status, 409);
  assert.equal(dup.body?.code, "COMMUNITY_ALREADY_REPORTED");

  const r2 = await owner.api.post(`/community/posts/${pr._id}/report`, { reason: "abuse" }, { expect: [201] });
  assert.equal(r2.body.reportCount, 2);

  const r3 = await linked.api.post(`/community/posts/${pr._id}/report`, { reason: "hate" }, { expect: [201] });
  assert.equal(r3.body.reportCount, 3);
  assert.equal(r3.body.status, "hidden", "the third distinct report hides the post automatically");

  assert.equal((await anon.get(`/community/posts/${pr._id}`)).status, 404);
  const hiddenQueue = await adminApi.get("/community/admin/queue?status=hidden", { expect: [200] });
  assert.ok(feedIds(hiddenQueue.body).includes(String(pr._id)));

  const badReason = await member.api.post(`/community/posts/${pr._id}/report`, { reason: "because" });
  assert.equal(badReason.status, 400);
  assert.equal(badReason.body?.message, "Validation failed");

  await adminApi.post(`/community/admin/posts/${pr._id}/restore`, undefined, { expect: [200] });
  assert.equal((await anon.get(`/community/posts/${pr._id}`)).status, 200, "an admin restore brings it back");
});

// ---------------------------------------------------------------------------
// T7 — rate limits
// ---------------------------------------------------------------------------

test("rate limits: 5 posts per minute, the daily budget, 20 shares per minute per IP", async () => {
  // Per-minute create cap — burstUser spends its whole 5/min budget.
  for (let i = 1; i <= 5; i++) {
    const ok = await burstUser.api.post(
      "/community/posts",
      { kind: "story", subject: { type: "user", ref: burstUser.userId }, title: `Burst ${i}` },
      { expect: [201] }
    );
    assert.equal(ok.body.post.status, "published");
  }
  const burst429 = await burstUser.api.post(
    "/community/posts",
    { kind: "story", subject: { type: "user", ref: burstUser.userId }, title: "Burst 6" },
    { retryOn429: false }
  );
  assert.equal(burst429.status, 429);
  assert.match(burst429.body?.message || "", /Too many requests/);

  // Daily budget, enforced by maxPostsPerUserPerDay.
  await setSettings({ maxPostsPerUserPerDay: 1 });
  await dailyUser.api.post(
    "/community/posts",
    { kind: "story", subject: { type: "user", ref: dailyUser.userId }, title: "Daily one" },
    { expect: [201] }
  );
  const second = await dailyUser.api.post(
    "/community/posts",
    { kind: "story", subject: { type: "user", ref: dailyUser.userId }, title: "Daily two" },
    { retryOn429: false }
  );
  assert.equal(second.status, 429);
  assert.equal(second.body?.code, "COMMUNITY_DAILY_LIMIT");
  await setSettings({ maxPostsPerUserPerDay: 10 });

  // Strict per-IP share cap: 20 per minute; the 21st within the window is refused.
  assert.ok(autoSharePostId, "T5 must have produced a clean published post");
  const shareStatuses = [];
  for (let i = 0; i < 21; i++) {
    const res = await anon.post(`/community/posts/${autoSharePostId}/share`, undefined, {
      retryOn429: false,
    });
    shareStatuses.push(res.status);
  }
  assert.ok(
    shareStatuses.slice(0, 20).every((s) => s === 200),
    `first 20 shares should pass, got: ${shareStatuses}`
  );
  assert.equal(shareStatuses[20], 429, "the 21st share within a minute is rate-limited per IP");
});

// ---------------------------------------------------------------------------
// T8 — communityEnabled=false
// ---------------------------------------------------------------------------

test("communityEnabled=false: every write is 403 COMMUNITY_DISABLED, every public read empties", async () => {
  await setSettings({ communityEnabled: false });

  const writes = [
    await disabledUser.api.post("/community/posts", {
      kind: "story",
      subject: { type: "user", ref: disabledUser.userId },
      title: "Nope",
    }),
    await disabledUser.api.patch(`/community/posts/${socialPostId}`, { title: "Nope" }),
    await disabledUser.api.del(`/community/posts/${socialPostId}`),
    await disabledUser.api.post(`/community/posts/${socialPostId}/like`),
    await disabledUser.api.post(`/community/posts/${socialPostId}/comments`, { body: "Nope" }),
    await disabledUser.api.del(`/community/posts/${socialPostId}/comments/${socialCommentId}`),
    await disabledUser.api.post(`/community/posts/${socialPostId}/report`, { reason: "spam" }),
    await anon.post(`/community/posts/${socialPostId}/share`),
  ];
  for (const [i, res] of writes.entries()) {
    assert.equal(res.status, 403, `write #${i} answered ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body?.code, "COMMUNITY_DISABLED", `write #${i} code`);
  }

  // Public reads empty out instead of leaking content.
  const feed = await anon.get("/community/feed", { expect: [200] });
  assert.deepEqual(feed.body.posts, []);
  assert.equal(feed.body.hasMore, false);

  const post = await anon.get(`/community/posts/${socialPostId}`);
  assert.equal(post.status, 404);
  assert.equal(post.body?.code, "COMMUNITY_DISABLED");

  const comments = await anon.get(`/community/posts/${socialPostId}/comments`, { expect: [200] });
  assert.deepEqual(comments.body.comments, []);

  const teamPosts = await anon.get(`/community/teams/${teamId}/posts`, { expect: [200] });
  assert.deepEqual(teamPosts.body.posts, []);

  const playerPosts = await anon.get(`/community/players/${playerId}/posts`, { expect: [200] });
  assert.deepEqual(playerPosts.body.posts, []);

  // Admin surfaces keep working while the community is off.
  const queue = await adminApi.get("/community/admin/queue", { expect: [200] });
  assert.ok(Array.isArray(queue.body.posts));
  const settings = await adminApi.get("/community/admin/settings", { expect: [200] });
  assert.equal(settings.body.communityEnabled, false);

  // Re-enable and smoke-test one write.
  await setSettings({ communityEnabled: true });
  const smoke = await disabledUser.api.post(
    "/community/posts",
    { kind: "story", subject: { type: "user", ref: disabledUser.userId }, title: "Back on" },
    { expect: [201] }
  );
  assert.equal((await anon.get(`/community/posts/${smoke.body.post._id}`)).status, 200);
  await disabledUser.api.del(`/community/posts/${smoke.body.post._id}`, undefined, { expect: [200] });
});

// ---------------------------------------------------------------------------
// T8b — public runtime config (GET /community/config)
// ---------------------------------------------------------------------------

test("GET /community/config is public and mirrors the runtime switches only", async () => {
  // No auth header at all — the SPA needs this before login.
  await setSettings({ communityEnabled: false, postMode: "auto" });
  const off = await anon.get("/community/config", { expect: [200] });
  assert.deepEqual(off.body, { enabled: false, postMode: "auto" });

  await setSettings({ postMode: "approval" });
  const approval = await anon.get("/community/config", { expect: [200] });
  assert.deepEqual(approval.body, { enabled: false, postMode: "approval" });

  // Only the two switches leak — never limits or the ban list.
  assert.deepEqual(Object.keys(approval.body).sort(), ["enabled", "postMode"]);

  await setSettings({ communityEnabled: true, postMode: "auto" });
  const on = await anon.get("/community/config", { expect: [200] });
  assert.deepEqual(on.body, { enabled: true, postMode: "auto" });
});

// ---------------------------------------------------------------------------
// T9 — reserved test-prefix names
// ---------------------------------------------------------------------------

test("reserved test-prefix authors are hidden from every public community surface", async () => {
  const hiddenPost = await createSelfPost(reservedAuthor, {
    title: "Should never be listed",
    body: "Fixture author.",
  });

  const feed = await anon.get("/community/feed", { expect: [200] });
  assert.ok(
    !feedIds(feed.body).includes(String(hiddenPost._id)),
    "the reserved author's post must not appear in the feed"
  );

  assert.equal((await anon.get(`/community/posts/${hiddenPost._id}`)).status, 404);
  assert.equal((await stranger.api.get(`/community/posts/${hiddenPost._id}`)).status, 404);
  assert.equal(
    (await reservedAuthor.api.get(`/community/posts/${hiddenPost._id}`)).status,
    404,
    "even the author's own URL is closed to reserved names"
  );

  const share = await anon.post(`/community/posts/${hiddenPost._id}/share`);
  assert.equal(share.status, 404, "share refuses reserved posts");

  const teamPosts = await anon.get(`/community/teams/${reservedTeamId}/posts`, { expect: [200] });
  assert.deepEqual(teamPosts.body.posts, [], "a reserved team name reads as empty");

  // The post still exists — moderation is not blinded by the hiding rule.
  const queue = await adminApi.get("/community/admin/queue?status=published", { expect: [200] });
  assert.ok(feedIds(queue.body).includes(String(hiddenPost._id)));
});

// ---------------------------------------------------------------------------
// T10 — XSS, media validation, upload caps
// ---------------------------------------------------------------------------

test("HTML is refused, own-upload URLs only, allowlisted video, upload caps are 400s", async () => {
  // HTML anywhere in text is a validation failure and is never echoed back.
  const xssTitle = await xUser.api.post("/community/posts", {
    kind: "story",
    subject: { type: "user", ref: xUser.userId },
    title: "<script>alert(1)</script>",
  });
  assert.equal(xssTitle.status, 400);
  assert.equal(xssTitle.body?.message, "Validation failed");
  assert.ok(
    !JSON.stringify(xssTitle.body).includes("<script>"),
    "the rejection must not echo the markup back"
  );

  const xssBody = await xUser.api.post("/community/posts", {
    kind: "story",
    subject: { type: "user", ref: xUser.userId },
    body: "<img src=x onerror=alert(1)>",
  });
  assert.equal(xssBody.status, 400);

  const xssComment = await xUser.api.post(`/community/posts/${socialPostId}/comments`, {
    body: "<b>bold take</b>",
  });
  assert.equal(xssComment.status, 400);

  // Entities round-trip byte for byte — they are never unescaped into markup.
  const entity = "&lt;script&gt;alert(1)&lt;/script&gt;";
  const ent = await xUser.api.post(
    `/community/posts/${socialPostId}/comments`,
    { body: entity },
    { expect: [201] }
  );
  const back = await anon.get(`/community/posts/${socialPostId}/comments`, { expect: [200] });
  const stored = back.body.comments.find((c) => String(c._id) === String(ent.body.comment._id));
  assert.ok(stored, "the entity comment exists");
  assert.equal(stored.body, entity, "an entity-looking body round-trips byte for byte");

  // Images must be this platform's own /uploads/ URLs.
  const external = await xUser.api.post("/community/posts", {
    kind: "photo",
    subject: { type: "user", ref: xUser.userId },
    media: [{ url: "https://cdn.example.com/pic.jpg" }],
  });
  assert.equal(external.status, 400);
  assert.equal(external.body?.code, "COMMUNITY_EXTERNAL_IMAGE");

  const wrongExt = await xUser.api.post("/community/posts", {
    kind: "photo",
    subject: { type: "user", ref: xUser.userId },
    media: [{ url: "/uploads/payload.php" }],
  });
  assert.equal(wrongExt.status, 400);
  assert.equal(wrongExt.body?.code, "COMMUNITY_IMAGE_TYPE");

  // Per-post image ceiling (schema layer).
  const tooMany = await mediaUser.api.post("/community/posts", {
    kind: "photo",
    subject: { type: "user", ref: mediaUser.userId },
    media: Array.from({ length: 7 }, (_, i) => ({ url: `/uploads/pic${i}.jpg` })),
  });
  assert.equal(tooMany.status, 400);
  assert.equal(tooMany.body?.message, "Validation failed");

  // Video allowlist.
  const badVideo = await mediaUser.api.post("/community/posts", {
    kind: "video",
    subject: { type: "user", ref: mediaUser.userId },
    videoUrl: "https://evil.example.com/watch?v=abc",
  });
  assert.equal(badVideo.status, 400);
  assert.equal(badVideo.body?.code, "COMMUNITY_VIDEO_NOT_ALLOWED");

  // A clean payload with an own-upload image and an allowlisted video passes.
  const good = await mediaUser.api.post(
    "/community/posts",
    {
      kind: "photo",
      subject: { type: "user", ref: mediaUser.userId },
      title: "Club day gallery",
      media: [{ url: "/uploads/club-day-1.jpg", alt: "The winning six" }],
      videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    },
    { expect: [201] }
  );
  assert.equal(good.body.post.media.length, 1);
  assert.equal(good.body.post.videoProvider, "youtube");
  await mediaUser.api.del(`/community/posts/${good.body.post._id}`, undefined, { expect: [200] });

  // The admin-tunable image ceiling (validatePostMedia).
  await setSettings({ maxImagesPerPost: 1 });
  const overCap = await mediaUser.api.post("/community/posts", {
    kind: "photo",
    subject: { type: "user", ref: mediaUser.userId },
    media: [{ url: "/uploads/a.jpg" }, { url: "/uploads/b.jpg" }],
  });
  assert.equal(overCap.status, 400);
  assert.equal(overCap.body?.code, "COMMUNITY_TOO_MANY_IMAGES");
  await setSettings({ maxImagesPerPost: 6 });

  // The upload endpoint rejects wrong type and oversize as 400s, not 500s.
  const gifForm = new FormData();
  gifForm.append("image", new Blob([Buffer.from("GIF89a-not-a-real-image")], { type: "image/gif" }), "tiny.gif");
  const gifRes = await fetch(`${API_BASE}/upload/image`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
    body: gifForm,
  });
  assert.equal(gifRes.status, 400, "wrong image type must be a client error");

  const bigForm = new FormData();
  bigForm.append(
    "image",
    new Blob([Buffer.alloc(5 * 1024 * 1024 + 1, 7)], { type: "image/jpeg" }),
    "huge.jpg"
  );
  const bigRes = await fetch(`${API_BASE}/upload/image`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
    body: bigForm,
  });
  assert.equal(bigRes.status, 400, "oversize image must be a client error");

  const noAuth = await fetch(`${API_BASE}/upload/image`, { method: "POST" });
  assert.equal(noAuth.status, 401, "upload requires auth");

  const noFile = await adminApi.post("/upload/image");
  assert.equal(noFile.status, 400, "a request without a file is a client error");
});

// ---------------------------------------------------------------------------
// T11 — banned posters
// ---------------------------------------------------------------------------

test("a banned poster is refused every community write until unbanned", async () => {
  const ban = await adminApi.post(
    `/community/admin/users/${dailyUser.userId}/ban-poster`,
    undefined,
    { expect: [200] }
  );
  assert.ok(ban.body.bannedPosters.includes(dailyUser.userId));
  const settingsAfterBan = await adminApi.get("/community/admin/settings", { expect: [200] });
  assert.ok(settingsAfterBan.body.bannedPosters.includes(dailyUser.userId));

  const create = await dailyUser.api.post("/community/posts", {
    kind: "story",
    subject: { type: "user", ref: dailyUser.userId },
    title: "While banned",
  });
  assert.equal(create.status, 403);
  assert.equal(create.body?.code, "COMMUNITY_POSTER_BANNED");

  const comment = await dailyUser.api.post(`/community/posts/${socialPostId}/comments`, {
    body: "Still banned",
  });
  assert.equal(comment.status, 403);
  assert.equal(comment.body?.code, "COMMUNITY_POSTER_BANNED");

  const like = await dailyUser.api.post(`/community/posts/${socialPostId}/like`);
  assert.equal(like.status, 403);
  assert.equal(like.body?.code, "COMMUNITY_POSTER_BANNED");

  // Unban restores access.
  await setSettings({ bannedPosters: [] });
  const after = await dailyUser.api.post(
    "/community/posts",
    { kind: "story", subject: { type: "user", ref: dailyUser.userId }, title: "Unbanned" },
    { expect: [201] }
  );
  await dailyUser.api.del(`/community/posts/${after.body.post._id}`, undefined, { expect: [200] });
});

// ---------------------------------------------------------------------------
// T12 — operator payloads on the admin surface (the public ones live in
// noSqlInjection.test.js, which probes every community route pattern).
// ---------------------------------------------------------------------------

test("operator payloads in admin settings are refused and change nothing", async () => {
  const op = await adminApi.patch("/community/admin/settings", { communityEnabled: { $ne: true } });
  assert.equal(op.status, 400);
  assert.equal(op.body?.message, "Validation failed");

  const opBan = await adminApi.patch("/community/admin/settings", { bannedPosters: { $ne: [] } });
  assert.equal(opBan.status, 400);

  const read = await adminApi.get("/community/admin/settings", { expect: [200] });
  assert.equal(read.body.communityEnabled, true, "the operator patch must not have applied");
  assert.deepEqual(read.body.bannedPosters, []);
});
