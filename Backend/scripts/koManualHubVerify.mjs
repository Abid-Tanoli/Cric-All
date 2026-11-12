#!/usr/bin/env node
/**
 * One-off verification for manual scorecard vs tournament hub.
 * Local only - must run against http://127.0.0.1:5000 with DB cric-all-e2e.
 */

import { API_BASE, assertLocalTarget, assertServerIsLocal } from "../test/e2e/lib/guard.js";
import { createClient } from "../test/e2e/lib/http.js";
import { randomBytes } from "node:crypto";

const TEST_PREFIX = "KO_";
const ADMIN_EMAIL = `${TEST_PREFIX}admin@example.test`;
const ADMIN_PASSWORD = randomBytes(24).toString("base64url");

const log = (...a) => process.stdout.write(`${a.join(" ")}\n`);

let checks = [];
function check(label, ok, detail = "") {
  checks.push({ label, ok: !!ok, detail });
  log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` - ${detail}` : ""}`);
}

async function ensureAdmin(api) {
  const register = await api.post(
    "/admin/register",
    { name: `${TEST_PREFIX}Admin`, email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    { expect: null },
  );
  if (register.status === 201 && register.body?.token) {
    api.setToken(register.body.token);
    return { created: true, token: register.body.token };
  }
  const login = await api.post("/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { expect: null });
  if (login.status === 200 && login.body?.token) {
    api.setToken(login.body.token);
    return { created: false, token: login.body.token };
  }
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("no JWT_SECRET");
  const mongoose = (await import("mongoose")).default;
  const Admin = (await import("../src/models/Admin.js")).default;
  const jwt = (await import("jsonwebtoken")).default;
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URL || "mongodb://127.0.0.1:27017/cric-all-e2e", { serverSelectionTimeoutMS: 15_000 });
  }
  const admin = await Admin.findOne({ email: ADMIN_EMAIL }) || await Admin.findOne({}).sort({ createdAt: 1 });
  if (!admin) throw new Error("no admin found");
  const token = jwt.sign({ id: admin._id }, secret);
  api.setToken(token);
  await mongoose.disconnect();
  return { created: false, token };
}

async function main() {
  assertLocalTarget();
  await assertServerIsLocal();

  const api = createClient({ apiBase: API_BASE });
  await ensureAdmin(api);

  log("Creating teams KO Alpha, KO Beta (public)...");
  const t1 = await api.post("/teams", { name: "KO Alpha" }, { expect: [200, 201] });
  const t2 = await api.post("/teams", { name: "KO Beta" }, { expect: [200, 201] });
  const teamA = String(t1.body?.team?._id || t1.body?._id);
  const teamB = String(t2.body?.team?._id || t2.body?._id);
  check("Teams created", teamA && teamB, `${teamA} / ${teamB}`);

  const makePlayers = async (teamId, prefix) => {
    const ids = [];
    for (let i = 1; i <= 11; i++) {
      const roles = ["Batsman", "Bowler", "All-Rounder", "Wicket-Keeper"];
      const res = await api.post("/players", {
        name: `${prefix} Kopl ${i === 1 ? "One" : i === 2 ? "Two" : i === 3 ? "Three" : i === 4 ? "Four" : i === 5 ? "Five" : i === 6 ? "Six" : i === 7 ? "Seven" : i === 8 ? "Eight" : i === 9 ? "Nine" : i === 10 ? "Ten" : "Eleven"}`,
        team: teamId,
        playingRole: roles[(i - 1) % roles.length],
      }, { expect: [200, 201] });
      ids.push(String(res.body?.player?._id || res.body?._id));
    }
    return ids;
  };

  const pA = await makePlayers(teamA, "Alpha");
  const pB = await makePlayers(teamB, "Beta");
  check("Players created", pA.length === 11 && pB.length === 11);

  log("Creating knockout tournament...");
  const now = new Date();
  const start = new Date(now.getTime() - 86400000).toISOString().split("T")[0];
  const end = new Date(now.getTime() + 86400000).toISOString().split("T")[0];
  const tRes = await api.post("/tournaments", { name: "KO Manual QF Verify", type: "knockout", teams: [teamA, teamB], startDate: start, endDate: end }, { expect: [200, 201] });
  const tid = String(tRes.body?.tournament?._id || tRes.body?._id);
  check("Tournament created", !!tid, tid);

  await api.post(`/tournaments/${tid}/squad`, { teamId: teamA, players: pA }, { expect: [200] });
  await api.post(`/tournaments/${tid}/squad`, { teamId: teamB, players: pB }, { expect: [200] });

  const manualM1 = {
    title: "KO QF: Alpha vs Beta",
    teamA, teamB,
    tournamentId: tid,
    stage: "quarter_final",
    totalOvers: 20,
    tossWinner: teamA,
    tossDecision: "bat",
    venue: "Test Ground",
    startAt: new Date().toISOString(),
    manOfMatch: pA[0],
    result: { resultType: "normal", winner: teamA, margin: "8 runs", description: "KO Alpha won by 8 runs" },
    innings: [
      {
        team: teamA,
        overs: 20,
        balls: 120,
        runs: 193,
        wickets: 7,
        extras: { wides: 5, byes: 2, legByes: 3, noBalls: 1, total: 11 },
        batting: [
          { player: pA[0], runs: 74, balls: 52, fours: 8, sixes: 2, isOut: true, dismissalType: "caught", fielder: pB[2] },
          { player: pA[1], runs: 40, balls: 35, fours: 4, sixes: 1, isOut: true, dismissalType: "bowled" },
          { player: pA[2], runs: 30, balls: 18, fours: 3, sixes: 2, isOut: true, dismissalType: "lbw" },
          { player: pA[3], runs: 15, balls: 8, fours: 2, sixes: 0, isOut: true, dismissalType: "caught", fielder: pB[3] },
          { player: pA[4], runs: 10, balls: 5, fours: 1, sixes: 0, isOut: true, dismissalType: "caught", fielder: pB[4] },
          { player: pA[5], runs: 8, balls: 6, fours: 0, sixes: 1, isOut: false },
          { player: pA[6], runs: 5, balls: 3, fours: 1, sixes: 0, isOut: true, dismissalType: "run out", fielder: pB[1] },
        ],
        bowling: [
          { player: pB[5], overs: 4, balls: 24, maidens: 0, runs: 35, wickets: 2 },
          { player: pB[6], overs: 4, balls: 24, maidens: 0, runs: 45, wickets: 2 },
          { player: pB[7], overs: 4, balls: 24, maidens: 0, runs: 32, wickets: 1 },
          { player: pB[8], overs: 4, balls: 24, maidens: 0, runs: 40, wickets: 2 },
        ],
        fallOfWickets: [{ runs: 114, wickets: 1 }, { runs: 144, wickets: 2 }, { runs: 164, wickets: 3 }, { runs: 179, wickets: 4 }, { runs: 182, wickets: 5 }, { runs: 189, wickets: 6 }, { runs: 193, wickets: 7 }]
      },
      {
        team: teamB,
        overs: 18.3,
        balls: 111,
        runs: 185,
        wickets: 10,
        extras: { wides: 4, byes: 1, legByes: 2, noBalls: 0, total: 7 },
        batting: [
          { player: pB[0], runs: 45, balls: 38, fours: 5, sixes: 1, isOut: true, dismissalType: "caught", fielder: pA[2] },
          { player: pB[1], runs: 25, balls: 20, fours: 3, sixes: 1, isOut: true, dismissalType: "bowled" },
          { player: pB[2], runs: 20, balls: 15, fours: 2, sixes: 0, isOut: true, dismissalType: "lbw" },
          { player: pB[3], runs: 30, balls: 22, fours: 4, sixes: 0, isOut: true, dismissalType: "caught", fielder: pA[4] },
          { player: pB[4], runs: 15, balls: 8, fours: 2, sixes: 0, isOut: true, dismissalType: "bowled" },
          { player: pB[5], runs: 12, balls: 6, fours: 1, sixes: 1, isOut: true, dismissalType: "caught", fielder: pA[5] },
          { player: pB[6], runs: 5, balls: 3, fours: 1, sixes: 0, isOut: true, dismissalType: "caught", fielder: pA[1] },
          { player: pB[7], runs: 2, balls: 2, fours: 0, sixes: 0, isOut: true, dismissalType: "run out", fielder: pA[7] },
          { player: pB[8], runs: 1, balls: 1, fours: 0, sixes: 0, isOut: true, dismissalType: "bowled" },
          { player: pB[9], runs: 0, balls: 1, fours: 0, sixes: 0, isOut: true, dismissalType: "bowled" },
          { player: pB[10], runs: 0, balls: 0, fours: 0, sixes: 0, isOut: true, dismissalType: "bowled" },
        ],
        bowling: [
          { player: pA[5], overs: 4, balls: 24, maidens: 0, runs: 35, wickets: 2 },
          { player: pA[6], overs: 4, balls: 24, maidens: 0, runs: 28, wickets: 3 },
          { player: pA[7], overs: 3.3, balls: 21, maidens: 0, runs: 30, wickets: 2 },
          { player: pA[8], overs: 4, balls: 24, maidens: 0, runs: 45, wickets: 2 },
          { player: pA[9], overs: 3, balls: 18, maidens: 0, runs: 40, wickets: 1 },
        ],
        fallOfWickets: [{ runs: 70, wickets: 1 }, { runs: 95, wickets: 2 }, { runs: 115, wickets: 3 }, { runs: 140, wickets: 4 }, { runs: 152, wickets: 5 }, { runs: 160, wickets: 6 }, { runs: 165, wickets: 7 }, { runs: 170, wickets: 8 }, { runs: 180, wickets: 9 }, { runs: 185, wickets: 10 }]
      }
    ]
  };

  log("Publishing manual QF match (M1)...");
  const m1Res = await api.post("/matches/manual", manualM1, { expect: [200, 201] });
  const m1Id = String(m1Res.body?.match?._id || m1Res.body?._id);
  check("M1 created", !!m1Id, m1Id);
  if (!m1Id) throw new Error("no m1 id");

  const manualM2 = {
    title: "KO SF Draft: Alpha vs Beta",
    teamA, teamB,
    tournamentId: tid,
    stage: "semi_final",
    totalOvers: 20,
    draft: true,
    tossWinner: teamA,
    tossDecision: "bat",
    venue: "Test Ground",
    startAt: new Date(Date.now() + 86400000).toISOString(),
    manOfMatch: pA[0],
    innings: [
      {
        team: teamA,
        overs: 20, balls: 120, runs: 999, wickets: 9,
        extras: { total: 10 },
        batting: [{ player: pA[0], runs: 999, balls: 60, fours: 50, sixes: 50, isOut: false }],
        bowling: [],
        fallOfWickets: []
      },
      {
        team: teamB,
        overs: 20, balls: 120, runs: 0, wickets: 0,
        extras: { total: 0 },
        batting: [],
        bowling: [],
        fallOfWickets: []
      }
    ]
  };
  const m2Res = await api.post("/matches/manual", manualM2, { expect: [200, 201] });
  const m2Id = String(m2Res.body?.match?._id || m2Res.body?._id);
  check("M2 draft created", !!m2Id, m2Id);

  const asGuest = createClient({ apiBase: API_BASE });
  const endpoints = [
    `/tournaments/${tid}/content`,
    `/tournaments/${tid}/stats`,
    `/tournaments/${tid}/standings`,
    `/tournaments/${tid}/fixtures`,
    `/tournaments/${tid}/points-table`,
  ];
  for (const ep of endpoints) {
    const r = await asGuest.get(ep, { expect: 200 });
    check(`GET ${ep}`, r.status === 200);
  }
  const sum = await asGuest.get(`/matches/${m1Id}/summary`, { expect: 200 });
  check("GET /api/matches/:id/summary", sum.status === 200);
  const sbody = sum.body || {};
  const hasLiveFields = Object.keys(sbody).some(k => k.includes("ballByBall") || k.includes("live") || (k.includes("over") && k.includes("current")));
  check("Summary has no live/ball-by-ball fields", !hasLiveFields, JSON.stringify(Object.keys(sbody)));

  const stats = await asGuest.get(`/tournaments/${tid}/stats`, { expect: 200 });
  const sb = stats.body || {};
  check("Stats matchCount is 1 (draft excluded)", sb.matchCount === 1, String(sb.matchCount));
  const has999 = JSON.stringify(sb).includes("999");
  check("Stats do not include draft 999", !has999, has999 ? "FOUND" : "OK");

  const std = await asGuest.get(`/tournaments/${tid}/standings`, { expect: 200 });
  check("Standings rows ok", Array.isArray(std.body?.rows));

  const fx = await asGuest.get(`/tournaments/${tid}/fixtures`, { expect: 200 });
  const fixtures = fx.body?.fixtures || fx.body || [];
  const hasM1 = fixtures.some(f => String(f._id || f.id) === m1Id && f.status === "completed");
  check("Fixtures includes completed M1", hasM1);

  const tr = sb.topRunScorers || [];
  const koplOne = tr.find(x => (x.name || "").includes("Kopl One"));
  check("Top run scorers include Kopl One", !!koplOne, JSON.stringify(koplOne));
  if (koplOne) check("Kopl One runs 74", koplOne.runs === 74, String(koplOne.runs));

  const tw = sb.topWicketTakers || [];
  const koplSix = tw.find(x => (x.name || "").includes("Kopl Six"));
  check("Top wicket takers include Kopl Six", !!koplSix, JSON.stringify(koplSix));
  if (koplSix) check("Kopl Six wickets 3", koplSix.wickets === 3, String(koplSix.wickets));

  log("\n=== Summary ===");
  for (const c of checks) {
    log(`${c.ok ? "✓" : "✗"} ${c.label}${c.detail ? " (" + c.detail + ")" : ""}`);
  }
  const allOk = checks.every(c => c.ok);
  log(allOk ? "\nPASS: manual QF results appear correctly in the hub" : "\nFAIL: some checks failed");
  process.exit(allOk ? 0 : 1);
}

main().catch(e => {
  console.error("ABORTED", e);
  process.exit(2);
});
