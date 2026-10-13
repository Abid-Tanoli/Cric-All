import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

// Same in-process harness as the other HTTP suites: VERCEL=1 so index.js does
// not bind a port, MONGO_URL="" so dotenv cannot inject a real database, and an
// ephemeral listener owned by this file.
process.env.VERCEL = "1";
process.env.MONGO_URL = "";
delete process.env.MONGODB_URI;
delete process.env.MONGO_URI;
process.env.JWT_SECRET = process.env.JWT_SECRET || "tournament-hub-test-secret";
process.env.LOG_REQUESTS = "false";

import { startTestDb, stopTestDb } from "./helpers/testDb.js";
import Admin from "../src/models/Admin.js";
import User from "../src/models/User.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import Match from "../src/models/Match.js";
import Tournament from "../src/models/Tournament.js";
import TournamentMedia from "../src/models/TournamentMedia.js";
import TournamentArticle from "../src/models/TournamentArticle.js";
import { computeTournamentStats } from "../src/services/tournamentStats.js";

const PREFIX = "TournamentHub";
let mongod;
let server;
let base;

const rnd = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const uniq = (label) => `${PREFIX} ${label} ${rnd()}`;
const DATES = { startDate: "2026-10-01T00:00:00.000Z", endDate: "2026-10-20T00:00:00.000Z" };

async function makeTournament(label, extra = {}) {
  return Tournament.create({ name: uniq(label), slug: `hub-${rnd()}`, ...DATES, ...extra });
}

async function req(method, path, { token, body, form } = {}) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}${path}`, { method, headers, body: payload });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON reply: the status code is the assertion target
  }
  return { status: res.status, body: json };
}

async function makeAdminToken() {
  const admin = await Admin.create({
    name: uniq("admin"),
    email: `${PREFIX}.${rnd()}@example.com`,
    password: "a-password-hash-that-is-never-compared",
    role: "superadmin",
  });
  return jwt.sign({ id: String(admin._id) }, process.env.JWT_SECRET);
}

async function makeUserToken() {
  const user = await User.create({ name: uniq("user"), email: `${PREFIX}.u.${rnd()}@example.com`, emailVerified: true });
  return jwt.sign({ id: String(user._id), tv: 0 }, process.env.JWT_SECRET);
}

async function makeTeam(label, extra = {}) {
  return Team.create({ name: uniq(label), ...extra });
}

async function makePlayers(team, count, label) {
  const players = [];
  for (let i = 0; i < count; i += 1) {
    players.push(await Player.create({ name: uniq(`${label} P${i}`), team: team._id }));
  }
  return players;
}

/**
 * A completed "manual scorecard" match: two innings whose batting/bowling arrays
 * hold the same numbers a ball-by-ball innings would produce. This is exactly
 * the input shape documented at the top of services/tournamentStats.js.
 */
async function makeManualMatch({ tournament, teamA, teamB, batsmen, bowlers, result, title }) {
  return Match.create({
    title: title || uniq("Manual Match"),
    tournament,
    teams: [teamA._id, teamB._id],
    status: "completed",
    result,
    startAt: new Date("2026-10-01T09:00:00.000Z"),
    innings: [
      {
        team: teamA._id,
        runs: 160,
        wickets: 4,
        balls: 120,
        batting: batsmen.map((player) => ({
          player: player._id,
          runs: 60,
          balls: 40,
          fours: 6,
          sixes: 3,
          isOut: true,
          dismissalType: "bowled",
        })),
        bowling: bowlers.map((player) => ({ player: player._id, balls: 24, overs: 4, maidens: 0, runs: 20, wickets: 2 })),
      },
      {
        team: teamB._id,
        runs: 161,
        wickets: 6,
        balls: 118,
        batting: batsmen.map((player) => ({ player: player._id, runs: 10, balls: 12, isOut: true, dismissalType: "caught" })),
        bowling: bowlers.map((player) => ({ player: player._id, balls: 24, overs: 4, runs: 30, wickets: 1 })),
      },
    ],
  });
}

before(async () => {
  mongod = await startTestDb();
  const { default: app } = await import("../src/index.js");
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => {
    server?.closeAllConnections?.();
    server?.close(resolve);
  });
  await stopTestDb(mongod);
});

// ---------------------------------------------------------------------------
// Pure aggregation: manual scorecard, tie and no-result
// ---------------------------------------------------------------------------

test("computeTournamentStats aggregates a manual scorecard and counts tie/no-result matches", () => {
  const batsman = { _id: "p1", name: "Opener" };
  const bowler = { _id: "b1", name: "Spearhead" };
  const team = { _id: "t1", name: "Reds" };

  const innings = {
    team,
    batting: [
      { player: batsman, runs: 70, balls: 45, fours: 8, sixes: 2, isOut: true, dismissalType: "bowled" },
    ],
    bowling: [{ player: bowler, balls: 24, overs: 4, maidens: 1, runs: 18, wickets: 4 }],
  };

  const matches = [
    { _id: "m1", status: "completed", result: { resultType: "normal" }, teams: [team], innings: [innings] },
    // A tied match is still "completed" and must contribute.
    { _id: "m2", status: "completed", result: { resultType: "tie" }, teams: [team], innings: [innings] },
    // A no-result match is also completed and must contribute.
    { _id: "m3", status: "completed", result: { resultType: "no result" }, teams: [team], innings: [innings] },
    // An abandoned match must NOT contribute.
    { _id: "m4", status: "abandoned", result: { resultType: "abandoned" }, teams: [team], innings: [innings] },
  ];

  const stats = computeTournamentStats({ matches, minBallsFaced: 30, minOvers: 5 });

  assert.equal(stats.matchCount, 3, "three completed matches contribute");
  assert.equal(stats.topRunScorers[0].runs, 210, "70 runs across three completed matches");
  assert.equal(stats.topRunScorers[0].innings, 3);
  assert.equal(stats.topWicketTakers[0].wickets, 12, "4 wickets across three completed matches");
  assert.equal(stats.topWicketTakers[0].bestFigures, "4/18");
  assert.equal(stats.empty, false);
  assert.equal(stats.hasBatting, true);
  assert.equal(stats.hasBowling, true);
  // The qualified strike-rate list needs minBallsFaced; 45 balls qualifies.
  assert.equal(stats.bestStrikeRates[0].playerId, "p1");
  // Economy qualifies at >= minOvers (5) overs = 30 balls. The three completed
  // matches accumulate 72 balls (12 overs) and 54 runs for "b1": economy 4.5.
  assert.equal(stats.bestEconomy.length, 1);
  assert.equal(stats.bestEconomy[0].playerId, "b1");
  assert.equal(stats.bestEconomy[0].economy, 4.5);
});

// ---------------------------------------------------------------------------
// Public stats over HTTP, hidden/test team filtering
// ---------------------------------------------------------------------------

test("GET /api/tournaments/:id/stats returns completed-match leaders and hides test teams", async () => {
  const tournament = await makeTournament("Stats Cup", { teams: [] });
  const teamA = await makeTeam("Stats A");
  const teamB = await makeTeam("Stats B");
  const hidden = await makeTeam(`${PREFIX} HIDDEN`, { isPublic: false });
  // The name must START with the reserved prefix (isReservedTestName checks the
  // beginning of the string, so uniq()'s "TournamentHub " prefix would defeat it).
  const reserved = await Team.create({ name: `OPENCODE_TEST_${rnd()}` });

  const batsmen = await makePlayers(teamA, 2, "Bat");
  const bowlers = await makePlayers(teamB, 2, "Bowl");
  const hiddenPlayers = await makePlayers(hidden, 1, "Ghost");
  const reservedPlayers = await makePlayers(reserved, 1, "Reserved");

  tournament.teams = [teamA._id, teamB._id, hidden._id, reserved._id];
  await tournament.save();

  await makeManualMatch({ tournament: tournament._id, teamA, teamB, batsmen, bowlers, result: { resultType: "normal" } });
  await makeManualMatch({
    tournament: tournament._id,
    teamA: hidden,
    teamB: reserved,
    batsmen: hiddenPlayers,
    bowlers: reservedPlayers,
    result: { resultType: "normal" },
  });
  // A live match whose innings must never be counted.
  await Match.create({
    title: uniq("Live Match"),
    tournament: tournament._id,
    teams: [teamA._id, teamB._id],
    status: "live",
    innings: [{ team: teamA._id, batting: [{ player: batsmen[0]._id, runs: 999, balls: 10 }] }],
  });

  const res = await req("GET", `/api/tournaments/${tournament._id}/stats?fresh=1`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.matchCount, 1, "only the one completed public match counts");

  const names = res.body.topRunScorers.map((r) => r.playerId);
  assert.ok(names.length > 0);
  const hiddenIds = new Set([...hiddenPlayers, ...reservedPlayers].map((p) => String(p._id)));
  for (const row of res.body.topRunScorers) {
    assert.ok(!hiddenIds.has(row.playerId), "no hidden/reserved player leaks into run scorers");
  }
  assert.equal(res.body.topRunScorers[0].runs, 70, "60 from innings 1 plus 10 from innings 2");
});

// ---------------------------------------------------------------------------
// Public content + settings
// ---------------------------------------------------------------------------

test("GET /api/tournaments/:id/content returns defaults, and admin PUT updates visibility", async () => {
  const admin = await makeAdminToken();
  const tournament = await makeTournament("Content Cup");

  const before = await req("GET", `/api/tournaments/${tournament._id}/content`);
  assert.equal(before.status, 200);
  assert.equal(before.body.visibility.photos, true);
  assert.equal(before.body.visibility.videos, true);
  assert.equal(before.body.counts.photos, 0);

  const put = await req("PUT", `/api/tournaments/admin/${tournament._id}/content`, {
    token: admin,
    body: {
      shortDescription: "<b>Big</b> series!",
      visibility: { photos: false, videos: false },
      stats: { minBallsFaced: 20 },
    },
  });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.settings.visibility.photos, false);
  assert.equal(put.body.settings.stats.minBallsFaced, 20);

  const after = await req("GET", `/api/tournaments/${tournament._id}/content`);
  assert.equal(after.body.visibility.photos, false);
  assert.equal(after.body.overview.shortDescription, "Big series!", "HTML is stripped from short text");
});

// ---------------------------------------------------------------------------
// Admin auth: 401 anonymous, 403 non-admin, 201 admin
// ---------------------------------------------------------------------------

test("admin content routes require a platform admin", async () => {
  const tournament = await makeTournament("Auth Cup");

  const anon = await req("POST", `/api/tournaments/admin/${tournament._id}/articles`, { body: { title: "x" } });
  assert.equal(anon.status, 401);

  const user = await makeUserToken();
  const forbidden = await req("POST", `/api/tournaments/admin/${tournament._id}/articles`, {
    token: user,
    body: { title: "x" },
  });
  assert.equal(forbidden.status, 403);

  const admin = await makeAdminToken();
  const created = await req("POST", `/api/tournaments/admin/${tournament._id}/articles`, {
    token: admin,
    body: { title: "Preview", body: "Hello", published: true },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
});

// ---------------------------------------------------------------------------
// Articles: XSS-safe storage, published vs draft
// ---------------------------------------------------------------------------

test("articles are XSS-sanitized and drafts stay private", async () => {
  const admin = await makeAdminToken();
  const tournament = await makeTournament("Article Cup");

  const created = await req("POST", `/api/tournaments/admin/${tournament._id}/articles`, {
    token: admin,
    body: {
      title: "<script>alert('x')</script>Match Report",
      body: "<p>Great win</p><script>steal()</script><img src=x onerror=alert(1)>",
      published: true,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const slug = created.body.article.slug;
  assert.ok(!/script/i.test(created.body.article.title), "script tag stripped from title");
  assert.ok(!/<script/i.test(created.body.article.body), "script tag stripped from body");
  assert.ok(!/onerror/i.test(created.body.article.body), "inline event handler stripped from body");

  // Public detail is reachable by slug and sanitized.
  const detail = await req("GET", `/api/tournaments/${tournament._id}/articles/${slug}`);
  assert.equal(detail.status, 200);
  assert.ok(!/<script/i.test(detail.body.article.body));

  // A draft must not appear publicly but must appear in the admin list.
  const draft = await req("POST", `/api/tournaments/admin/${tournament._id}/articles`, {
    token: admin,
    body: { title: "Draft Only", body: "secret", published: false },
  });
  assert.equal(draft.status, 201);

  const publicList = await req("GET", `/api/tournaments/${tournament._id}/articles`);
  assert.equal(publicList.body.total, 1, "only the published article is public");

  const adminList = await req("GET", `/api/tournaments/admin/${tournament._id}/content`, { token: admin });
  assert.equal(adminList.status, 200);
  assert.equal(adminList.body.articles.length, 2, "admin sees the draft too");
});

// ---------------------------------------------------------------------------
// Input validation / NoSQL-injection rejection
// ---------------------------------------------------------------------------

test("object payloads are rejected instead of reaching a query", async () => {
  const admin = await makeAdminToken();
  const tournament = await makeTournament("Inject Cup");

  const injContent = await req("PUT", `/api/tournaments/admin/${tournament._id}/content`, {
    token: admin,
    body: { shortDescription: { $ne: null } },
  });
  assert.equal(injContent.status, 400, "object shortDescription is rejected");

  const injArticle = await req("POST", `/api/tournaments/admin/${tournament._id}/articles`, {
    token: admin,
    body: { title: { $ne: null }, published: true },
  });
  assert.equal(injArticle.status, 400, "object title is rejected");
});

// ---------------------------------------------------------------------------
// Standings reuse the existing points table
// ---------------------------------------------------------------------------

test("GET /api/tournaments/:id/standings reuses the points table and adds form", async () => {
  const tournament = await makeTournament("Table Cup", { type: "league" });
  const teamA = await makeTeam("Table A");
  const teamB = await makeTeam("Table B");
  tournament.teams = [teamA._id, teamB._id];
  tournament.pointsTable = [
    { team: teamA._id, matchesPlayed: 1, won: 1, lost: 0, points: 2, netRunRate: 1.5 },
    { team: teamB._id, matchesPlayed: 1, won: 0, lost: 1, points: 0, netRunRate: -1.5 },
  ];
  await tournament.save();

  await Match.create({
    title: uniq("Table Match"),
    tournament: tournament._id,
    teams: [teamA._id, teamB._id],
    status: "completed",
    result: { resultType: "normal", winner: teamA._id },
    startAt: new Date("2026-10-02T09:00:00.000Z"),
  });

  const res = await req("GET", `/api/tournaments/${tournament._id}/standings`);
  assert.equal(res.status, 200);
  assert.equal(res.body.rows.length, 2);
  assert.equal(res.body.rows[0].team.name, teamA.name, "leaders sort first");
  assert.deepEqual(res.body.rows[0].form, ["W"]);
  assert.deepEqual(res.body.rows[1].form, ["L"]);
});

// ---------------------------------------------------------------------------
// Photo upload + delete + orphan-free tournament delete
// ---------------------------------------------------------------------------

const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("admin photo upload, listing, and tournament delete remove media rows and files", async () => {
  const admin = await makeAdminToken();
  const tournament = await makeTournament("Photo Cup");

  const form = new FormData();
  form.append("image", new Blob([ONE_PX_PNG], { type: "image/png" }), "pixel.png");
  form.append("caption", "<b>Nice</b> shot");

  const upload = await req("POST", `/api/tournaments/admin/${tournament._id}/photos`, { token: admin, form });
  assert.equal(upload.status, 201, JSON.stringify(upload.body));
  const mediaId = upload.body.media._id;
  assert.equal(upload.body.media.caption, "Nice shot", "caption is sanitized");

  const list = await req("GET", `/api/tournaments/${tournament._id}/photos`);
  assert.equal(list.body.total, 1);
  assert.equal(list.body.items[0]._id, mediaId);

  const content = await req("GET", `/api/tournaments/${tournament._id}/content`);
  assert.equal(content.body.counts.photos, 1);

  // Deleting the tournament must remove its media rows (no orphaned uploads).
  const del = await req("DELETE", `/api/tournaments/${tournament._id}`, { token: admin });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal(await TournamentMedia.countDocuments({ tournament: tournament._id }), 0);
  assert.equal(await TournamentArticle.countDocuments({ tournament: tournament._id }), 0);
});

test("deleting a single photo soft-deletes it and it leaves the public list", async () => {
  const admin = await makeAdminToken();
  const tournament = await makeTournament("Photo Del");

  const form = new FormData();
  form.append("image", new Blob([ONE_PX_PNG], { type: "image/png" }), "one.png");
  const upload = await req("POST", `/api/tournaments/admin/${tournament._id}/photos`, { token: admin, form });
  const mediaId = upload.body.media._id;

  const del = await req("DELETE", `/api/tournaments/admin/${tournament._id}/media/${mediaId}`, { token: admin });
  assert.equal(del.status, 200);

  const list = await req("GET", `/api/tournaments/${tournament._id}/photos`);
  assert.equal(list.body.total, 0, "soft-deleted photo is gone from the public list");
  const row = await TournamentMedia.findById(mediaId).lean();
  assert.ok(row.deletedAt, "row is retained with a deletedAt marker");
});

// ---------------------------------------------------------------------------
// Video URL allow-list
// ---------------------------------------------------------------------------

test("videos accept only allow-listed hosts and store just the URL/id", async () => {
  const admin = await makeAdminToken();
  const tournament = await makeTournament("Video Cup");

  const bad = await req("POST", `/api/tournaments/admin/${tournament._id}/videos`, {
    token: admin,
    body: { url: "https://evil.example.com/steal" },
  });
  assert.equal(bad.status, 400);

  const good = await req("POST", `/api/tournaments/admin/${tournament._id}/videos`, {
    token: admin,
    body: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Highlights" },
  });
  assert.equal(good.status, 201, JSON.stringify(good.body));
  assert.equal(good.body.media.provider, "youtube");
  assert.equal(good.body.media.videoId, "dQw4w9WgXcQ");

  const list = await req("GET", `/api/tournaments/${tournament._id}/videos`);
  assert.equal(list.body.total, 1);
});

// ---------------------------------------------------------------------------
// Slug resolution keeps old /series links working
// ---------------------------------------------------------------------------

test("public reads resolve a tournament by slug as well as id", async () => {
  const slug = `hub-slug-${rnd()}`;
  await makeTournament("Slug Cup", { slug });
  const res = await req("GET", `/api/tournaments/${slug}/content`);
  assert.equal(res.status, 200);
  assert.equal(res.body.overview.format !== undefined, true);
});
