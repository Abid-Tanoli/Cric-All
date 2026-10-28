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
import { computeTournamentStats, inningsForMatch } from "../src/services/tournamentStats.js";
import { buildTournamentBracket } from "../src/services/tournamentBracket.js";

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
async function makeManualMatch({ tournament, teamA, teamB, batsmen, bowlers, result, title, fielders }) {
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
        // teamA is fielding in this innings, so a caught dismissal credits one of
        // teamA's players; that fielder must reach the public leaderboard.
        batting: batsmen.map((player, i) => ({
          player: player._id,
          runs: 10,
          balls: 12,
          isOut: true,
          dismissalType: "caught",
          fielder: fielders && fielders.length ? fielders[i % fielders.length]._id : undefined,
        })),
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
  const keeper = { _id: "f1", name: "Gloves" };
  const bowler = { _id: "b1", name: "Spearhead" };
  const team = { _id: "t1", name: "Reds" };

  const innings = {
    team,
    batting: [
      { player: batsman, runs: 70, balls: 45, fours: 8, sixes: 2, isOut: true, dismissalType: "bowled" },
      { player: { _id: "p2", name: "Finisher" }, runs: 12, balls: 9, isOut: true, dismissalType: "caught", fielder: keeper },
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
  // Fielding: the caught dismissal credits the named fielder in all three matches.
  assert.equal(stats.hasFielding, true);
  assert.equal(stats.topFielders[0].playerId, "f1");
  assert.equal(stats.topFielders[0].catches, 3);
  assert.equal(stats.topFielders[0].total, 3);
  assert.equal(stats.topFielders[0].matches, 3, "distinct completed matches count once each");
  // Boundary meter: tournament-wide 4s/6s plus a top-five compact list.
  assert.equal(stats.boundaryMeter.sixes, 6, "two sixes per innings across three matches");
  assert.equal(stats.boundaryMeter.fours, 24);
  assert.equal(stats.boundaryMeter.mostSixes[0].playerId, "p1");
  assert.equal(stats.boundaryMeter.mostSixes[0].count, 6);
  assert.equal(stats.boundaryMeter.mostSixes[0].name, "Opener");
  // The qualified strike-rate list needs minBallsFaced; 45 balls qualifies.
  assert.equal(stats.bestStrikeRates[0].playerId, "p1");
  // Economy qualifies at >= minOvers (5) overs = 30 balls. The three completed
  // matches accumulate 72 balls (12 overs) and 54 runs for "b1": economy 4.5.
  assert.equal(stats.bestEconomy.length, 1);
  assert.equal(stats.bestEconomy[0].playerId, "b1");
  assert.equal(stats.bestEconomy[0].economy, 4.5);
});

// ---------------------------------------------------------------------------
// Pure aggregation: team totals, did-not-bat rows, overs notation, drafts
// ---------------------------------------------------------------------------

test("computeTournamentStats totals a scorecard without counting drafts, DNB rows or 3.4 as 20 balls", () => {
  const teamA = { _id: "t1", name: "Reds", shortName: "RED" };
  const teamB = { _id: "t2", name: "Blues", shortName: "BLU" };
  const opener = { _id: "p1", name: "Opener" };
  const dnb = { _id: "p2", name: "Did Not Bat" };
  const bowler = { _id: "b1", name: "Spearhead" };
  const otherBowler = { _id: "b2", name: "Second Change" };

  const inningsA = {
    team: teamA,
    runs: 150,
    wickets: 6,
    balls: 120,
    extras: { wides: 5, noBalls: 2, byes: 1, legByes: 0, penalties: 0, total: 8 },
    batting: [
      // The 156* shape from the imported QF scorecards.
      { player: opener, runs: 136, balls: 59, fours: 8, sixes: 14, isOut: false },
      // An all-zero row with no dismissal is "did not bat" and must not count.
      { player: dnb, runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false },
    ],
    bowling: [
      // Cricket notation only: no `balls` field. 3.4 overs = 22 balls, not 20.
      { player: bowler, overs: 3.4, maidens: 0, runs: 30, wickets: 3, wides: 2, noBalls: 1 },
    ],
  };

  const inningsB = {
    team: teamB,
    runs: 151,
    wickets: 5,
    balls: 118,
    batting: [{ player: otherBowler, runs: 80, balls: 50, fours: 4, sixes: 2, isOut: true, dismissalType: "bowled" }],
    bowling: [{ player: otherBowler, balls: 24, overs: 4, maidens: 1, runs: 20, wickets: 2 }],
  };

  const match = {
    _id: "m1",
    status: "completed",
    teams: [teamA, teamB],
    result: { resultType: "normal", winner: teamB._id },
    innings: [inningsA, inningsB],
  };

  // A published-status draft must not count anyway: the draft flag wins.
  const draft = { ...match, _id: "draft", manualDraft: true, innings: [{ ...inningsA, runs: 999 }] };

  const stats = computeTournamentStats({ matches: [match, draft], minBallsFaced: 30, minOvers: 1 });

  assert.equal(stats.matchCount, 1, "the manual draft is excluded even with status completed");
  assert.equal(stats.totalRuns, 301, "150 + 151, not the draft's 999");
  assert.equal(stats.totalWickets, 11);
  assert.equal(stats.totalFours, 12);
  assert.equal(stats.totalSixes, 16);
  assert.equal(stats.tournamentTotals.runs, 301);
  assert.equal(stats.tournamentTotals.wides, 5, "innings extras take precedence over per-bowler wides");
  assert.equal(stats.tournamentTotals.noBalls, 2);

  const openerRow = stats.topRunScorers.find((row) => row.playerId === opener._id);
  assert.equal(openerRow.runs, 136);
  assert.equal(openerRow.innings, 1);
  assert.equal(openerRow.notOuts, 1);
  assert.equal(openerRow.highestText, "136*", "highest score keeps the not-out star");
  assert.equal(stats.topRunScorers.some((row) => row.playerId === dnb._id), false, "DNB row is not an innings");
  assert.equal(stats.highestScores[0].runs, 136);
  assert.equal(stats.highestScores[0].notOut, true);

  const bowlerRow = stats.topWicketTakers.find((row) => row.playerId === bowler._id);
  assert.equal(bowlerRow.balls, 22, "3.4 overs parses as 22 balls");
  assert.equal(bowlerRow.oversText, "3.4");
  assert.equal(bowlerRow.wides, 2);
  assert.equal(bowlerRow.noBalls, 1);

  const reds = stats.teamStats.find((row) => row.teamId === teamA._id);
  const blues = stats.teamStats.find((row) => row.teamId === teamB._id);
  assert.equal(reds.played, 1);
  assert.equal(reds.lost, 1);
  assert.equal(reds.runs, 150, "runs scored");
  assert.equal(reds.runsConceded, 151);
  assert.equal(reds.wickets, 5, "wickets taken by Reds");
  assert.equal(reds.wicketsLost, 6);
  assert.equal(reds.highestTotal, 150);
  assert.equal(reds.lowestTotal, 150);
  assert.equal(reds.fours, 8);
  assert.equal(reds.sixes, 14);
  assert.equal(blues.played, 1);
  assert.equal(blues.won, 1);
  assert.equal(blues.wickets, 6);
});

// ---------------------------------------------------------------------------
// Pure bracket: stage rows, auto-advanced semis, placeholders, champion
// ---------------------------------------------------------------------------

test("buildTournamentBracket renders quarter-finals, auto-advanced semis, placeholders and a champion", () => {
  const team = (id, name) => ({ _id: id, name, shortName: name.slice(0, 3) });
  const t1 = team("t1", "Reds");
  const t2 = team("t2", "Blues");
  const t3 = team("t3", "Greens");
  const t4 = team("t4", "Yellows");
  const t5 = team("t5", "Pinks");
  const t6 = team("t6", "Purples");
  const t7 = team("t7", "Oranges");
  const t8 = team("t8", "Browns");
  const qf = (id, label, a, b, winner) => ({
    _id: id,
    stage: "quarter_final",
    stageLabel: label,
    status: "completed",
    teams: [a, b],
    result: { resultType: "normal", winner: winner._id },
    innings: [{ team: a, runs: 140, wickets: 8, balls: 120 }],
  });
  const qf1 = qf("m1", "QF1", t1, t2, t1);
  const qf2 = qf("m2", "QF2", t3, t4, t3);
  const qf3 = qf("m3", "QF3", t5, t6, t5);
  const qf4 = qf("m4", "QF4", t7, t8, t7);
  const qfDraft = qf("md", "QF5", t1, t3, t1);
  qfDraft.manualDraft = true;

  const sf1 = {
    _id: "m5",
    stage: "semi_final",
    stageLabel: "SF1",
    status: "upcoming",
    teams: [t1, t3],
    result: {},
    innings: [],
  };

  const beforeFinal = buildTournamentBracket([qf1, qf2, qf3, qf4, qfDraft, sf1], { type: "knockout" });
  assert.equal(beforeFinal.isKnockout, true);
  const stage = (name) => beforeFinal.stages.find((row) => row.stage === name);
  assert.equal(stage("quarter_final").matches.length, 4, "the draft quarter-final is hidden");
  assert.equal(stage("semi_final").matches.length, 2, "one real semi plus the expected missing one");
  assert.equal(stage("semi_final").matches[0].teams[0]._id, "t1", "the published semi already carries the QF winner");
  assert.equal(stage("semi_final").matches[1].placeholder, true);
  assert.equal(stage("semi_final").matches[1].label, "Winner QF3");
  assert.equal(stage("final").matches.length, 1);
  assert.equal(stage("final").matches[0].placeholder, true);
  assert.equal(stage("final").matches[0].label, "Winner SF1");
  assert.equal(beforeFinal.champion, null);

  const final = {
    _id: "m6",
    stage: "final",
    stageLabel: "Final",
    status: "completed",
    teams: [t1, t3],
    result: { resultType: "normal", winner: t1._id, description: "Reds won by 5 wickets" },
    innings: [{ team: t1, runs: 152, wickets: 5, balls: 118 }],
  };
  const afterFinal = buildTournamentBracket([qf1, qf2, qf3, qf4, sf1, final], { type: "knockout" });
  assert.equal(afterFinal.champion._id, "t1");
  assert.equal(afterFinal.champion.name, "Reds");
  const finalCard = afterFinal.stages.find((row) => row.stage === "final").matches[0];
  assert.equal(finalCard.winner._id, "t1");
  assert.equal(finalCard.result.description, "Reds won by 5 wickets");
  assert.equal(finalCard.teams.find((row) => row._id === "t1").score.text, "152/5");
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

  await makeManualMatch({ tournament: tournament._id, teamA, teamB, batsmen, bowlers, result: { resultType: "normal" }, fielders: batsmen });
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

  // The fielding leaderboard is populated through the same public endpoint and
  // credits a teamA player; the hidden match's fielders (if any) stay out.
  assert.ok(Array.isArray(res.body.topFielders));
  assert.equal(res.body.topFielders.length, 2, "the two teamA players took the two catches");
  assert.equal(res.body.topFielders[0].catches, 1);
  assert.equal(res.body.topFielders[0].total, 1);
  assert.ok(res.body.topFielders.every((r) => !hiddenIds.has(r.playerId)));

  // Boundary meter totals the completed public match's sixes/fours.
  assert.equal(res.body.boundaryMeter.sixes, 6);
  assert.equal(res.body.boundaryMeter.fours, 12);
  assert.equal(res.body.hasFielding, true);
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
// Knockout standings and manual-draft visibility
// ---------------------------------------------------------------------------

test("GET /api/tournaments/:id/standings returns a knockout bracket and hides drafts", async () => {
  const tournament = await makeTournament("Knockout Cup", { type: "knockout" });
  const teamA = await makeTeam("KO A");
  const teamB = await makeTeam("KO B");
  const teamC = await makeTeam("KO C");
  const teamD = await makeTeam("KO D");
  tournament.teams = [teamA._id, teamB._id, teamC._id, teamD._id];
  await tournament.save();

  const qf1 = await Match.create({
    title: uniq("KO QF1"),
    tournament: tournament._id,
    teams: [teamA._id, teamB._id],
    stage: "quarter_final",
    stageLabel: "QF1",
    status: "completed",
    result: { resultType: "normal", winner: teamA._id, description: "KO A won by 5 wickets" },
    innings: [{ team: teamA._id, runs: 150, wickets: 5, balls: 118 }],
  });
  const qfDraft = await Match.create({
    title: uniq("KO QF2 draft"),
    tournament: tournament._id,
    teams: [teamC._id, teamD._id],
    stage: "quarter_final",
    stageLabel: "QF2",
    status: "completed",
    manualDraft: true,
    result: { resultType: "normal", winner: teamC._id },
  });
  await Match.create({
    title: uniq("KO SF1"),
    tournament: tournament._id,
    teams: [teamA._id, teamC._id],
    stage: "semi_final",
    stageLabel: "SF1",
    status: "upcoming",
  });

  const res = await req("GET", `/api/tournaments/${tournament._id}/standings`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.isKnockout, true);
  assert.deepEqual(res.body.rows, [], "a knockout has no points rows");
  assert.ok(res.body.bracket, "the bracket payload is present");
  assert.equal(res.body.bracket.isKnockout, true);

  const stages = Object.fromEntries(res.body.bracket.stages.map((stage) => [stage.stage, stage]));
  const qfIds = stages.quarter_final.matches.map((match) => match.matchId);
  assert.ok(qfIds.includes(String(qf1._id)));
  assert.ok(!qfIds.includes(String(qfDraft._id)), "the draft quarter-final is not public");
  assert.equal(stages.semi_final.matches[0].teams[0]._id, String(teamA._id));
  assert.equal(stages.final.matches[0].placeholder, true);
  assert.equal(stages.final.matches[0].label, "Winner SF1");
});

test("manual drafts are hidden from public tournament/match reads but visible to an admin", async () => {
  const admin = await makeAdminToken();
  const tournament = await makeTournament("Draft Cup", { type: "knockout" });
  const teamA = await makeTeam("Draft A");
  const teamB = await makeTeam("Draft B");
  tournament.teams = [teamA._id, teamB._id];
  await tournament.save();

  const published = await Match.create({
    title: uniq("Published fixture"),
    tournament: tournament._id,
    teams: [teamA._id, teamB._id],
    stage: "quarter_final",
    stageLabel: "QF1",
    status: "completed",
    result: { resultType: "normal", winner: teamA._id },
  });
  const draft = await Match.create({
    title: uniq("Private draft"),
    tournament: tournament._id,
    teams: [teamA._id, teamB._id],
    stage: "quarter_final",
    stageLabel: "QF2",
    status: "upcoming",
    manualDraft: true,
  });
  // Normal match creation links each fixture back onto the tournament; the
  // detail endpoint reads that populated list, so mirror it here.
  tournament.matches = [published._id, draft._id];
  await tournament.save();

  const publicTournament = await req("GET", `/api/tournaments/${tournament._id}`);
  assert.equal(publicTournament.status, 200);
  assert.ok(
    !publicTournament.body.matches.some((match) => String(match._id) === String(draft._id)),
    "a guest's tournament payload has no draft fixture",
  );

  const adminTournament = await req("GET", `/api/tournaments/${tournament._id}`, { token: admin });
  assert.ok(
    adminTournament.body.matches.some((match) => String(match._id) === String(draft._id)),
    "the admin still sees the draft for editing",
  );

  const publicFixtures = await req("GET", `/api/tournaments/${tournament._id}/fixtures`);
  assert.ok(!publicFixtures.body.some((match) => String(match._id) === String(draft._id)));
  const adminFixtures = await req("GET", `/api/tournaments/${tournament._id}/fixtures`, { token: admin });
  assert.ok(adminFixtures.body.some((match) => String(match._id) === String(draft._id)));

  const publicList = await req("GET", `/api/matches?tournament=${tournament._id}`);
  assert.equal(publicList.status, 200);
  assert.ok(!publicList.body.some((match) => String(match._id) === String(draft._id)));
  const adminList = await req("GET", `/api/matches?tournament=${tournament._id}`, { token: admin });
  assert.ok(adminList.body.some((match) => String(match._id) === String(draft._id)));

  const publicMatch = await req("GET", `/api/matches/${draft._id}`);
  assert.equal(publicMatch.status, 404, "a known draft id must not render publicly");
  const adminMatch = await req("GET", `/api/matches/${draft._id}`, { token: admin });
  assert.equal(adminMatch.status, 200);
  assert.equal(adminMatch.body._id, String(draft._id));
});

test("published manual matches expose both team names on the public tournament and fixtures endpoints", async () => {
  const tournament = await makeTournament("Manual Team Names", { type: "knockout" });
  const teamA = await makeTeam("Manual Names A", {
    shortName: "MNA",
    logo: "/uploads/manual-names-a.png",
  });
  const teamB = await makeTeam("Manual Names B", {
    shortName: "MNB",
    logo: "/uploads/manual-names-b.png",
  });
  tournament.teams = [teamA._id, teamB._id];
  await tournament.save();

  const match = await Match.create({
    title: uniq("Published manual QF"),
    tournament: tournament._id,
    teams: [teamA._id, teamB._id],
    stage: "quarter_final",
    stageLabel: "QF1",
    status: "completed",
    source: "manual",
    manualDraft: false,
    result: {
      resultType: "normal",
      winner: teamA._id,
      description: `${teamA.name} won by 5 runs.`,
    },
    innings: [
      { team: teamA._id, runs: 150, wickets: 5, balls: 120, status: "completed" },
      { team: teamB._id, runs: 145, wickets: 8, balls: 120, status: "completed" },
    ],
  });
  // The hub reads the tournament's linked matches, not a Match.find().
  tournament.matches = [match._id];
  await tournament.save();

  const hub = await req("GET", `/api/tournaments/${tournament._id}`);
  assert.equal(hub.status, 200, JSON.stringify(hub.body));
  const hubMatch = (hub.body.matches || []).find((row) => String(row._id) === String(match._id));
  assert.ok(hubMatch, "the published manual match is in the hub payload");
  assert.deepEqual(
    hubMatch.teams.map((team) => team.name).sort(),
    [teamA.name, teamB.name].sort(),
    "both match teams are populated on the hub payload",
  );
  assert.deepEqual(
    hubMatch.teams.map((team) => team.shortName).sort(),
    [teamA.shortName, teamB.shortName].sort(),
    "short names are available for the fixture card",
  );
  assert.deepEqual(
    hubMatch.teams.map((team) => team.logo).sort(),
    [teamA.logo, teamB.logo].sort(),
    "logos are available for the fixture card",
  );
  assert.deepEqual(
    hubMatch.innings.map((row) => row.team.name),
    [teamA.name, teamB.name],
    "innings team refs are populated in batting order",
  );
  assert.deepEqual(
    hubMatch.innings.map((row) => row.team.shortName),
    [teamA.shortName, teamB.shortName],
  );

  const fixtures = await req("GET", `/api/tournaments/${tournament._id}/fixtures`);
  assert.equal(fixtures.status, 200, JSON.stringify(fixtures.body));
  const fixtureMatch = (fixtures.body || []).find((row) => String(row._id) === String(match._id));
  assert.ok(fixtureMatch, "the published manual match is in the fixtures fallback payload");
  assert.deepEqual(
    fixtureMatch.teams.map((team) => team.name).sort(),
    [teamA.name, teamB.name].sort(),
  );
  assert.deepEqual(
    fixtureMatch.innings.map((row) => row.team.name),
    [teamA.name, teamB.name],
    "the fixtures fallback also populates innings team refs",
  );

  const detail = await req("GET", `/api/matches/${match._id}`);
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.deepEqual(
    detail.body.teams.map((team) => team.name).sort(),
    [teamA.name, teamB.name].sort(),
    "match detail remains populated",
  );
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

// ---------------------------------------------------------------------------
// (3) Manual scorecards: the single documented plug-in seam
// ---------------------------------------------------------------------------

test("inningsForMatch is the one documented manual-scorecard plug-in seam", () => {
  const innings = [
    {
      team: { _id: "t1", name: "Reds" },
      batting: [{ player: { _id: "p1", name: "Opener" }, runs: 12, balls: 9 }],
    },
  ];
  // The canonical shape is returned unchanged.
  assert.deepEqual(inningsForMatch({ innings }), innings);
  // Every "nothing to read" input returns an empty list, never throws.
  assert.deepEqual(inningsForMatch({}), []);
  assert.deepEqual(inningsForMatch(null), []);
  assert.deepEqual(inningsForMatch(undefined), []);
  assert.deepEqual(inningsForMatch({ innings: "not-an-array" }), []);
  assert.deepEqual(inningsForMatch({ innings: { nope: true } }), []);
});

test("a completed match with no scorecard yields an empty, non-misleading stats payload", async () => {
  const tournament = await makeTournament("No Scorecard Cup");
  const teamA = await makeTeam("NS A");
  const teamB = await makeTeam("NS B");
  tournament.teams = [teamA._id, teamB._id];
  await tournament.save();

  // Completed, with a result, but NO innings / batting / bowling — the shape a
  // much later manual scorecard will fill in. It must contribute no phantom row.
  await Match.create({
    title: uniq("No Data Match"),
    tournament: tournament._id,
    teams: [teamA._id, teamB._id],
    status: "completed",
    result: { resultType: "normal", winner: teamA._id },
    startAt: new Date("2026-10-03T09:00:00.000Z"),
  });

  const res = await req("GET", `/api/tournaments/${tournament._id}/stats?fresh=1`);
  assert.equal(res.status, 200);
  assert.equal(res.body.empty, true, "the UI shows the empty state, not zeros dressed as data");
  assert.equal(res.body.matchCount, 0, "a completed match with no innings contributes nothing");
  assert.equal(res.body.hasBatting, false);
  assert.equal(res.body.hasBowling, false);
  for (const key of [
    "topRunScorers",
    "topWicketTakers",
    "topFielders",
    "highestScores",
    "bestBowling",
    "bestStrikeRates",
    "bestEconomy",
    "mostSixes",
    "mostFours",
  ]) {
    assert.deepEqual(res.body[key], [], `${key} must be empty`);
  }
  assert.equal(res.body.boundaryMeter.sixes, 0);
  assert.equal(res.body.boundaryMeter.fours, 0);
  assert.deepEqual(res.body.boundaryMeter.mostSixes, []);
  assert.deepEqual(res.body.boundaryMeter.mostFours, []);

  // The sidebar reads the same two endpoints; the points table is also empty.
  const standings = await req("GET", `/api/tournaments/${tournament._id}/standings`);
  assert.equal(standings.status, 200);
  assert.equal(standings.body.hasStandings, false);
  assert.deepEqual(standings.body.rows, []);
});

// ---------------------------------------------------------------------------
// (a) Draft articles / unpublished media never reach a public route
// ---------------------------------------------------------------------------

test("unpublished media stays off the public hub but remains visible to the admin", async () => {
  const admin = await makeAdminToken();
  const tournament = await makeTournament("Unpublished Cup");

  // One published photo and video through the real routes.
  const pubForm = new FormData();
  pubForm.append("image", new Blob([ONE_PX_PNG], { type: "image/png" }), "pub.png");
  const pubPhoto = await req("POST", `/api/tournaments/admin/${tournament._id}/photos`, {
    token: admin,
    form: pubForm,
  });
  assert.equal(pubPhoto.status, 201);
  await req("POST", `/api/tournaments/admin/${tournament._id}/videos`, {
    token: admin,
    body: { url: "https://youtu.be/aaaaaaaaaaa", title: "Published" },
  });

  // One unpublished photo and video, stored directly.
  await TournamentMedia.create({
    tournament: tournament._id,
    kind: "photo",
    url: "/uploads/hidden.png",
    published: false,
    deletedAt: null,
  });
  await TournamentMedia.create({
    tournament: tournament._id,
    kind: "video",
    url: "https://youtu.be/bbbbbbbbbbb",
    provider: "youtube",
    videoId: "bbbbbbbbbbb",
    published: false,
    deletedAt: null,
  });

  const photos = await req("GET", `/api/tournaments/${tournament._id}/photos`);
  assert.equal(photos.body.total, 1, "only the published photo is public");
  assert.equal(photos.body.items.length, 1);
  const videos = await req("GET", `/api/tournaments/${tournament._id}/videos`);
  assert.equal(videos.body.total, 1, "only the published video is public");
  assert.ok(!videos.body.items.some((v) => v.videoId === "bbbbbbbbbbb"));

  const content = await req("GET", `/api/tournaments/${tournament._id}/content`);
  assert.equal(content.body.counts.photos, 1, "the count ignores unpublished rows");
  assert.equal(content.body.counts.videos, 1);

  const adminList = await req("GET", `/api/tournaments/admin/${tournament._id}/content`, { token: admin });
  assert.equal(adminList.status, 200);
  assert.equal(adminList.body.media.filter((m) => m.kind === "photo").length, 2, "admin sees both photos");
  assert.equal(adminList.body.media.filter((m) => m.kind === "video").length, 2, "admin sees both videos");
});

// ---------------------------------------------------------------------------
// (b) Hidden / test teams never leak through standings (the teams tab and stats
//     are covered by their own tests above)
// ---------------------------------------------------------------------------

test("standings hide hidden/test teams and never name a hidden next opponent", async () => {
  const tournament = await makeTournament("Hidden Table Cup", { type: "league" });
  const teamA = await makeTeam("Visible A");
  const teamB = await makeTeam("Visible B");
  const hidden = await makeTeam("Hidden Tea", { isPublic: false });
  const reserved = await Team.create({ name: `E2E_${rnd()}` });

  tournament.teams = [teamA._id, teamB._id, hidden._id, reserved._id];
  tournament.pointsTable = [
    { team: teamA._id, matchesPlayed: 1, won: 1, points: 2, netRunRate: 1 },
    { team: hidden._id, matchesPlayed: 1, won: 1, points: 2, netRunRate: 5 },
    { team: reserved._id, matchesPlayed: 1, won: 1, points: 2, netRunRate: 6 },
    { team: teamB._id, matchesPlayed: 1, won: 0, points: 0, netRunRate: -1 },
  ];
  await tournament.save();

  // Visible A's next fixture is against the hidden team: the opponent must not
  // be named even though the match itself is public.
  await Match.create({
    title: uniq("Future vs Hidden"),
    tournament: tournament._id,
    teams: [teamA._id, hidden._id],
    status: "upcoming",
    startAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  const res = await req("GET", `/api/tournaments/${tournament._id}/standings`);
  assert.equal(res.status, 200);
  const ids = res.body.rows.map((r) => r.team._id);
  assert.ok(!ids.includes(String(hidden._id)), "a hidden team is not a standings row");
  assert.ok(!ids.includes(String(reserved._id)), "a reserved-test team is not a standings row");
  assert.equal(res.body.rows.length, 2);
  assert.ok(res.body.rows.every((r) => !/Hidden/i.test(r.team.name)));
  assert.ok(res.body.rows.every((r) => !/^E2E_/i.test(r.team.name)));
  const rowA = res.body.rows.find((r) => r.team._id === String(teamA._id));
  assert.equal(rowA.next, null, "a hidden next opponent is dropped, not named");

  // The public tournament document (what the Teams tab reads) is filtered too.
  const doc = await req("GET", `/api/tournaments/${tournament._id}`);
  assert.equal(doc.status, 200);
  const docTeamIds = (doc.body.teams || []).map((t) => String(t._id || t));
  assert.ok(!docTeamIds.includes(String(hidden._id)));
  assert.ok(!docTeamIds.includes(String(reserved._id)));
});

// ---------------------------------------------------------------------------
// (c) Article body: script, event handlers and javascript: links
// ---------------------------------------------------------------------------

test("article body sanitization strips scripts, handlers, iframes and javascript: links", async () => {
  const admin = await makeAdminToken();
  const tournament = await makeTournament("XSS Cup");

  const created = await req("POST", `/api/tournaments/admin/${tournament._id}/articles`, {
    token: admin,
    body: {
      title: "<script>alert(1)</script>Report",
      body:
        "<p>ok</p><script>steal()</script><img src=x onerror=alert(1)>" +
        "<iframe src=\"https://evil.example\"></iframe>" +
        "<a href=\"javascript:alert(document.cookie)\">click</a>" +
        "<svg onload=alert(2)></svg><style>body{x:1}</style>",
      published: true,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const slug = created.body.article.slug;

  const detail = await req("GET", `/api/tournaments/${tournament._id}/articles/${slug}`);
  assert.equal(detail.status, 200);
  const body = detail.body.article.body;
  assert.ok(!/<script/i.test(body), "script removed");
  assert.ok(!/<iframe/i.test(body), "iframe removed");
  assert.ok(!/<svg/i.test(body), "svg removed");
  assert.ok(!/<style/i.test(body), "style removed");
  assert.ok(!/onerror/i.test(body), "onerror removed");
  assert.ok(!/onload/i.test(body), "onload removed");
  assert.ok(!/javascript\s*:/i.test(body), "javascript: scheme removed");
  assert.ok(!/[<>]/.test(detail.body.article.title), "no markup characters remain in the title");

  // The public list summary is sanitized too.
  const list = await req("GET", `/api/tournaments/${tournament._id}/articles`);
  assert.ok(!/javascript\s*:/i.test(JSON.stringify(list.body)));
});

// ---------------------------------------------------------------------------
// (d) Video URL allow-list + no server-side fetch (SSRF)
// ---------------------------------------------------------------------------

test("video URLs are allow-listed, http(s)-only, and never fetched server-side", async () => {
  const admin = await makeAdminToken();
  const tournament = await makeTournament("SSRF Cup");

  const rejected = [
    "https://evil.example.com/steal",
    "http://169.254.169.254/latest/meta-data/", // cloud metadata: not allow-listed
    "http://localhost:5000/api/health", // internal service: not allow-listed
    "file:///etc/passwd", // wrong scheme
    "javascript:alert(1)", // wrong scheme
    "not a url",
  ];
  for (const url of rejected) {
    const res = await req("POST", `/api/tournaments/admin/${tournament._id}/videos`, {
      token: admin,
      body: { url },
    });
    assert.equal(res.status, 400, `rejected: ${url}`);
  }

  // No remote media row was created by any rejected attempt.
  assert.equal(await TournamentMedia.countDocuments({ tournament: tournament._id }), 0);

  // An accepted link stores only the URL/id — the payload is opaque to us.
  const ok = await req("POST", `/api/tournaments/admin/${tournament._id}/videos`, {
    token: admin,
    body: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
  });
  assert.equal(ok.status, 201);
  const stored = await TournamentMedia.findOne({ tournament: tournament._id, kind: "video" }).lean();
  assert.equal(stored.provider, "youtube");
  assert.equal(stored.videoId, "dQw4w9WgXcQ");
  assert.ok(stored.url.startsWith("https://"), "only a URL string is persisted");
  assert.equal(stored.body, undefined);
});

// ---------------------------------------------------------------------------
// (e) Upload type / size validation through the same pipeline
// ---------------------------------------------------------------------------

test("photo upload rejects a non-image and an oversized file with a 400", async () => {
  const admin = await makeAdminToken();
  const tournament = await makeTournament("Upload Cup");

  const badType = new FormData();
  badType.append("image", new Blob([Buffer.from("hello")], { type: "text/plain" }), "note.txt");
  const rejected = await req("POST", `/api/tournaments/admin/${tournament._id}/photos`, {
    token: admin,
    form: badType,
  });
  assert.equal(rejected.status, 400, JSON.stringify(rejected.body));

  const tooBig = new FormData();
  tooBig.append("image", new Blob([Buffer.alloc(5 * 1024 * 1024 + 16)], { type: "image/png" }), "big.png");
  const oversized = await req("POST", `/api/tournaments/admin/${tournament._id}/photos`, {
    token: admin,
    form: tooBig,
  });
  assert.equal(oversized.status, 400, JSON.stringify(oversized.body));

  assert.equal(await TournamentMedia.countDocuments({ tournament: tournament._id }), 0);
});

// ---------------------------------------------------------------------------
// (f) Every write route is platform-admin-only; hostile params are text, never
//     query operators
// ---------------------------------------------------------------------------

test("every admin write route refuses anonymous and non-admin callers", async () => {
  const tournament = await makeTournament("Write Auth Cup");
  const user = await makeUserToken();
  const id = tournament._id;
  const fakeId = "000000000000000000000000";

  const writes = [
    ["PUT", `/api/tournaments/admin/${id}/content`, { body: { city: "X" } }],
    ["POST", `/api/tournaments/admin/${id}/videos`, { body: { url: "https://youtu.be/aaaaaaaaaaa" } }],
    ["PUT", `/api/tournaments/admin/${id}/media/${fakeId}`, { body: { caption: "x" } }],
    ["DELETE", `/api/tournaments/admin/${id}/media/${fakeId}`, {}],
    ["POST", `/api/tournaments/admin/${id}/articles`, { body: { title: "x", body: "y" } }],
    ["PUT", `/api/tournaments/admin/${id}/articles/${fakeId}`, { body: { title: "x" } }],
    ["DELETE", `/api/tournaments/admin/${id}/articles/${fakeId}`, {}],
  ];

  for (const [method, path, opts] of writes) {
    const anon = await req(method, path, opts);
    assert.equal(anon.status, 401, `anonymous ${method} ${path}`);
    const asUser = await req(method, path, { ...opts, token: user });
    assert.equal(asUser.status, 403, `non-admin ${method} ${path}`);
  }

  // The multipart photo route is guarded before multer ever runs.
  const photoForm = new FormData();
  photoForm.append("image", new Blob([ONE_PX_PNG], { type: "image/png" }), "p.png");
  const anonPhoto = await req("POST", `/api/tournaments/admin/${id}/photos`, { form: photoForm });
  assert.equal(anonPhoto.status, 401);
});

test("a hostile id or body value is treated as text, never as a query operator", async () => {
  const payload = encodeURIComponent('{"$ne":null}');
  const byId = await req("GET", `/api/tournaments/${payload}/content`);
  assert.equal(byId.status, 404, "an object-shaped slug matches nothing and leaks nothing");

  const prefix = await req("GET", `/api/tournaments/${encodeURIComponent("$ne")}/stats`);
  assert.equal(prefix.status, 404);

  const admin = await makeAdminToken();
  const tournament = await makeTournament("Inject Param Cup");
  const city = await req("PUT", `/api/tournaments/admin/${tournament._id}/content`, {
    token: admin,
    body: { city: { $ne: null } },
  });
  assert.equal(city.status, 400, "an object city is rejected");
  const article = await req("POST", `/api/tournaments/admin/${tournament._id}/articles`, {
    token: admin,
    body: { title: "ok", body: { $ne: null } },
  });
  assert.equal(article.status, 400, "an object body is rejected");
});

// ---------------------------------------------------------------------------
// (g) Public responses expose no private fields
// ---------------------------------------------------------------------------

test("public hub responses expose no emails, passwords or admin ids", async () => {
  const adminDoc = await Admin.create({
    name: uniq("admin"),
    email: `${PREFIX}.leak.${rnd()}@example.com`,
    password: "a-password-hash-that-is-never-compared",
    role: "superadmin",
  });
  const admin = jwt.sign({ id: String(adminDoc._id) }, process.env.JWT_SECRET);
  const tournament = await makeTournament("Privacy Cup");
  tournament.content = { shortDescription: "Public series", city: "Lahore" };
  await tournament.save();

  await req("POST", `/api/tournaments/admin/${tournament._id}/articles`, {
    token: admin,
    body: { title: "Public Article", body: "Body text", published: true },
  });
  await req("POST", `/api/tournaments/admin/${tournament._id}/videos`, {
    token: admin,
    body: { url: "https://youtu.be/dQw4w9WgXcQ", title: "Highlights" },
  });

  const endpoints = [
    `/api/tournaments/${tournament._id}/content`,
    `/api/tournaments/${tournament._id}/stats?fresh=1`,
    `/api/tournaments/${tournament._id}/standings`,
    `/api/tournaments/${tournament._id}/photos`,
    `/api/tournaments/${tournament._id}/videos`,
    `/api/tournaments/${tournament._id}/articles`,
  ];
  for (const path of endpoints) {
    const res = await req("GET", path);
    assert.equal(res.status, 200, path);
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes(adminDoc.email), `${path} must not expose an admin email`);
    assert.ok(!/createdByAdmin/i.test(text), `${path} must not expose createdByAdmin`);
    assert.ok(!/password/i.test(text), `${path} must not expose a password`);
    assert.ok(!/"[^"]*@example\.com"/.test(text), `${path} must not expose any email address`);
  }
});
