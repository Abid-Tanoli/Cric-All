import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";

import express from "express";
import mongoose from "mongoose";
import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import User from "../src/models/User.js";
import Team from "../src/models/Team.js";
import Match from "../src/models/Match.js";
import Series from "../src/models/Series.js";
import Membership from "../src/models/Membership.js";
import { createOrganization } from "../src/controllers/organizationController.js";
import { generateToken } from "../src/utils/jwt.js";

// Series management screen (PR B): the series detail with a server-computed
// score, linking/unlinking existing fixtures, creating a fixture inside a
// series, and completion. The score is derived only from recorded match results;
// no route here accepts a manual point or winner edit.

let mongod;
let server;
let baseUrl;

before(async () => {
  mongod = await startTestDb();
  const { default: organizationRoutes } = await import("../src/routes/organizationRoutes.js");
  const app = express();
  app.use(express.json());
  app.use("/organizations", organizationRoutes);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Team.deleteMany({}),
    Match.deleteMany({}),
    Series.deleteMany({}),
    Membership.deleteMany({}),
  ]);
});

function call(method, path, token, body) {
  return new Promise((resolve) => {
    const url = new URL(path, `${baseUrl}/`);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };
    const r = http.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        let data = null;
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
        resolve({ status: res.statusCode, body: data });
      });
    });
    r.on("error", (err) => resolve({ status: 0, body: { message: err.message } }));
    if (body !== undefined) r.write(JSON.stringify(body));
    r.end();
  });
}

let counter = 0;
const uniq = () => {
  counter += 1;
  return `${counter}-${Math.random().toString(36).slice(2, 8)}`;
};

async function makeUser(overrides = {}) {
  return User.create({
    name: `Series Person ${uniq()}`,
    email: `series-${uniq()}@openctest.dev`,
    password: "password-123",
    role: "scorer",
    accountType: "organization_admin",
    emailVerified: true,
    ...overrides,
  });
}

async function makeOrg(owner, name) {
  const res = mockRes();
  await createOrganization(mockReq({ user: owner, principalType: "user", body: { name } }), res);
  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
  return res.body.organization;
}

const plusDays = (days) => new Date(Date.now() + days * 86_400_000);

const makeMatch = (org, teams, overrides = {}) =>
  Match.create({
    title: `Series fixture ${uniq()}`,
    venue: "Series Ground",
    matchType: "T20",
    startAt: plusDays(0),
    teams,
    organizationRef: org._id,
    organization: org.name,
    status: "upcoming",
    innings: [
      { team: teams[0], status: "upcoming" },
      { team: teams[1], status: "upcoming" },
    ],
    ...overrides,
  });

/**
 * A fresh tenant per test: an owner, a manager (create_match but not
 * manage_competitions), a scorer (neither), an outsider, and a second org with
 * its own team, series and fixture.
 */
async function makeWorld() {
  const tag = uniq();
  const owner = await makeUser();
  const manager = await makeUser();
  const scorer = await makeUser();
  const stranger = await makeUser();
  const otherOwner = await makeUser();

  const org = await makeOrg(owner, `Series Club ${tag}`);
  const otherOrg = await makeOrg(otherOwner, `Other Series Club ${tag}`);
  await Membership.create({ organization: org._id, user: manager._id, roles: ["manager"], status: "active" });
  await Membership.create({ organization: org._id, user: scorer._id, roles: ["score_handler"], status: "active" });

  const [team1, team2, team3, otherTeam1, otherTeam2] = await Team.create([
    { name: `Series Team One ${tag}`, organizationRef: org._id },
    { name: `Series Team Two ${tag}`, organizationRef: org._id },
    { name: `Series Team Three ${tag}`, organizationRef: org._id },
    { name: `Other Series One ${tag}`, organizationRef: otherOrg._id },
    { name: `Other Series Two ${tag}`, organizationRef: otherOrg._id },
  ]);

  const series = await Series.create({
    name: `Main Series ${tag}`,
    slug: `main-series-${tag}`,
    matchType: "T20",
    status: "ongoing",
    startDate: plusDays(-3),
    endDate: plusDays(3),
    teams: [team1._id, team2._id],
    organizationRef: org._id,
  });
  const otherSeries = await Series.create({
    name: `Other Series ${tag}`,
    slug: `other-series-${tag}`,
    matchType: "T20",
    status: "ongoing",
    startDate: plusDays(-3),
    endDate: plusDays(3),
    teams: [otherTeam1._id, otherTeam2._id],
    organizationRef: otherOrg._id,
  });

  const win1 = await makeMatch(org, [team1._id, team2._id], {
    series: String(series._id),
    seriesMatchNumber: 1,
    status: "completed",
    result: { winner: team1._id, resultType: "normal", margin: "5 runs", description: "Team One won by 5 runs" },
  });
  const win2 = await makeMatch(org, [team2._id, team1._id], {
    series: String(series._id),
    seriesMatchNumber: 2,
    status: "completed",
    result: { winner: team2._id, resultType: "normal", margin: "3 wickets" },
  });
  const tie = await makeMatch(org, [team1._id, team2._id], {
    series: String(series._id),
    seriesMatchNumber: 3,
    status: "completed",
    result: { resultType: "tie", description: "Match tied" },
  });
  const abandoned = await makeMatch(org, [team1._id, team2._id], {
    series: String(series._id),
    seriesMatchNumber: 4,
    status: "abandoned",
  });
  const live = await makeMatch(org, [team2._id, team1._id], {
    series: String(series._id),
    seriesMatchNumber: 5,
    status: "live",
  });

  const eligible = await makeMatch(org, [team1._id, team2._id]);
  const ineligible = await makeMatch(org, [team1._id, team3._id]);
  const otherMatch = await makeMatch(otherOrg, [otherTeam1._id, otherTeam2._id]);

  return {
    owner,
    manager,
    scorer,
    stranger,
    otherOwner,
    org,
    otherOrg,
    team1,
    team2,
    team3,
    otherTeam1,
    otherTeam2,
    series,
    otherSeries,
    win1,
    win2,
    tie,
    abandoned,
    live,
    eligible,
    ineligible,
    otherMatch,
  };
}

const tokensOf = (w) => ({
  owner: generateToken(w.owner),
  manager: generateToken(w.manager),
  scorer: generateToken(w.scorer),
  stranger: generateToken(w.stranger),
  otherOwner: generateToken(w.otherOwner),
});

const seriesPath = (w, seriesId = w.series._id) => `/organizations/${w.org._id}/series/${seriesId}`;

test("detail returns the linked matches in order and a score derived from results", async () => {
  const w = await makeWorld();
  const tokens = tokensOf(w);

  const res = await call("GET", seriesPath(w), tokens.manager);
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.name, w.series.name);
  assert.strictEqual(res.body.matches.length, 5);
  assert.deepStrictEqual(
    res.body.matches.map((match) => match.seriesMatchNumber),
    [1, 2, 3, 4, 5]
  );

  const score = res.body.score;
  assert.strictEqual(score.completed, 3);
  assert.strictEqual(score.ties, 1);
  assert.strictEqual(score.noResult, 1);
  assert.strictEqual(score.outcome, "drawn");
  assert.strictEqual(score.winner, null);

  const one = score.teams.find((row) => String(row.team._id) === String(w.team1._id));
  const two = score.teams.find((row) => String(row.team._id) === String(w.team2._id));
  assert.strictEqual(one.wins, 1);
  assert.strictEqual(two.wins, 1);
  assert.strictEqual(one.ties, 1);
  assert.strictEqual(one.noResult, 1);

  const foreign = await call(
    "GET",
    `/organizations/${w.otherOrg._id}/series/${w.series._id}`,
    tokens.otherOwner
  );
  assert.strictEqual(foreign.status, 404);

  const stranger = await call("GET", seriesPath(w), tokens.stranger);
  assert.strictEqual(stranger.status, 403);
});

test("managers can link and unlink an eligible fixture, and create one in the series", async () => {
  const w = await makeWorld();
  const tokens = tokensOf(w);

  const linked = await call("POST", `${seriesPath(w)}/matches/${w.eligible._id}`, tokens.manager);
  assert.strictEqual(linked.status, 200, JSON.stringify(linked.body));
  const linkedRow = linked.body.matches.find((match) => String(match._id) === String(w.eligible._id));
  assert.ok(linkedRow);
  assert.strictEqual(linkedRow.seriesMatchNumber, 6);
  assert.strictEqual(linked.body.matches.length, 6);

  const stored = await Match.findById(w.eligible._id).lean();
  assert.strictEqual(stored.series, String(w.series._id));
  assert.strictEqual(stored.seriesMatchNumber, 6);

  const again = await call("POST", `${seriesPath(w)}/matches/${w.eligible._id}`, tokens.manager);
  assert.strictEqual(again.status, 409);
  assert.strictEqual(again.body.code, "MATCH_ALREADY_LINKED");

  const outsiderTeam = await call("POST", `${seriesPath(w)}/matches/${w.ineligible._id}`, tokens.manager);
  assert.strictEqual(outsiderTeam.status, 422);
  assert.strictEqual(outsiderTeam.body.code, "MATCH_TEAM_NOT_IN_SERIES");

  const foreignMatch = await call("POST", `${seriesPath(w)}/matches/${w.otherMatch._id}`, tokens.manager);
  assert.strictEqual(foreignMatch.status, 404);
  assert.strictEqual(foreignMatch.body.code, "MATCH_NOT_FOUND");

  const refused = await call("POST", `${seriesPath(w)}/matches/${w.ineligible._id}`, tokens.scorer);
  assert.strictEqual(refused.status, 403);

  const unlinked = await call("DELETE", `${seriesPath(w)}/matches/${w.eligible._id}`, tokens.manager);
  assert.strictEqual(unlinked.status, 200, JSON.stringify(unlinked.body));
  assert.strictEqual(unlinked.body.matches.length, 5);
  const cleared = await Match.findById(w.eligible._id).lean();
  assert.strictEqual(cleared.series, "");
  assert.strictEqual(cleared.seriesMatchNumber, null);

  const created = await call("POST", `/organizations/${w.org._id}/matches`, tokens.manager, {
    teams: [w.team1._id, w.team2._id],
    series: String(w.series._id),
    startAt: plusDays(1).toISOString(),
  });
  assert.strictEqual(created.status, 201, JSON.stringify(created.body));
  assert.strictEqual(created.body.match.series, String(w.series._id));
  assert.strictEqual(created.body.match.seriesMatchNumber, 6);

  const notInSeries = await call("POST", `/organizations/${w.org._id}/matches`, tokens.manager, {
    teams: [w.team1._id, w.team3._id],
    series: String(w.series._id),
  });
  assert.strictEqual(notInSeries.status, 422);
  assert.strictEqual(notInSeries.body.code, "MATCH_TEAM_NOT_IN_SERIES");
});

test("completion is a competition edit and writes the derived winner", async () => {
  const w = await makeWorld();
  const tokens = tokensOf(w);

  // Give one side a second win so the series has a unique champion.
  await Match.updateOne({ _id: w.win2._id }, { result: { winner: w.team1._id, resultType: "normal" } });

  const managerComplete = await call("POST", `${seriesPath(w)}/complete`, tokens.manager);
  assert.strictEqual(managerComplete.status, 403);

  const completed = await call("POST", `${seriesPath(w)}/complete`, tokens.owner);
  assert.strictEqual(completed.status, 200, JSON.stringify(completed.body));
  assert.strictEqual(completed.body.status, "completed");
  assert.strictEqual(completed.body.score.outcome, "winner");
  assert.strictEqual(String(completed.body.score.winner._id), String(w.team1._id));
  assert.strictEqual(String(completed.body.winner._id), String(w.team1._id));

  const stored = await Series.findById(w.series._id).lean();
  assert.strictEqual(stored.status, "completed");
  assert.strictEqual(String(stored.winner), String(w.team1._id));

  const frozenLink = await call("POST", `${seriesPath(w)}/matches/${w.eligible._id}`, tokens.owner);
  assert.strictEqual(frozenLink.status, 409);
  assert.strictEqual(frozenLink.body.code, "SERIES_COMPLETED");

  const frozenUnlink = await call("DELETE", `${seriesPath(w)}/matches/${w.live._id}`, tokens.owner);
  assert.strictEqual(frozenUnlink.status, 409);
  assert.strictEqual(frozenUnlink.body.code, "SERIES_COMPLETED");

  const frozenCreate = await call("POST", `/organizations/${w.org._id}/matches`, tokens.owner, {
    teams: [w.team1._id, w.team2._id],
    series: String(w.series._id),
  });
  assert.strictEqual(frozenCreate.status, 409);
  assert.strictEqual(frozenCreate.body.code, "SERIES_COMPLETED");

  const removed = await call("DELETE", seriesPath(w), tokens.owner);
  assert.strictEqual(removed.status, 403, JSON.stringify(removed.body));
});

test("a tie at the top completes as a draw with no winner stored", async () => {
  const w = await makeWorld();
  const tokens = tokensOf(w);

  const completed = await call("POST", `${seriesPath(w)}/complete`, tokens.owner);
  assert.strictEqual(completed.status, 200, JSON.stringify(completed.body));
  assert.strictEqual(completed.body.score.outcome, "drawn");
  assert.strictEqual(completed.body.score.winner, null);
  assert.strictEqual(completed.body.winner, null);

  const stored = await Series.findById(w.series._id).lean();
  assert.strictEqual(stored.status, "completed");
  assert.strictEqual(stored.winner, null);
});

test("an update cannot award a series by sending a winner", async () => {
  const w = await makeWorld();
  const tokens = tokensOf(w);

  const updated = await call("PUT", seriesPath(w), tokens.owner, {
    venue: "Updated Ground",
    winner: String(w.team2._id),
  });
  assert.strictEqual(updated.status, 200, JSON.stringify(updated.body));

  const stored = await Series.findById(w.series._id).lean();
  assert.strictEqual(stored.venue, "Updated Ground");
  assert.ok(!stored.winner);
});
