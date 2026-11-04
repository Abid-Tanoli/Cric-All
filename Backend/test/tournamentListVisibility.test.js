import test, { before, after } from "node:test";
import assert from "node:assert/strict";

process.env.VERCEL = "1";
process.env.MONGO_URL = "";
delete process.env.MONGODB_URI;
delete process.env.MONGO_URI;
process.env.JWT_SECRET = process.env.JWT_SECRET || "tournament-list-visibility-test-secret";
process.env.LOG_REQUESTS = "false";

import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import { getTournaments } from "../src/controllers/TournamentController.js";
import Tournament from "../src/models/Tournament.js";
import Team from "../src/models/Team.js";
import Match from "../src/models/Match.js";

// Regression coverage for the public /series board.
//
// The board used to load /tournaments only when /events was empty, so a single
// production event hid every tournament. The list endpoint also used
// `teams: { $nin: hidden }`, which dropped a tournament if ANY participant was
// private, and it returned the stored status ("upcoming") instead of the same
// derived status the tournament hub shows. These tests pin the endpoint's side
// of the contract: all tournaments are returned, a past-dated but unfinished
// final reads "ongoing", status filters use the derived value, and only a
// tournament whose entire team list is hidden is omitted.

const TEAM_NAMES = [
  "Baldia Zalmi",
  "Sky Sports",
  "Young Star",
  "Khan Associates",
  "Orangi Warriors",
  "Orangi United",
  "Malir Friends",
  "Gulshan XI",
];

const FINAL_START = new Date("2026-11-01T05:30:00.000Z");
const STORED_END = new Date("2026-10-11T00:00:00.000Z");

let mongod;
let target;
let completed;
let partiallyHidden;
let allHidden;
let publicTeam;
let hiddenTeam;

const matchDoc = ({ tournament, stage, status, startAt, teamA, teamB }) => ({
  title: `${stage} ${status}`,
  tournament: tournament._id,
  stage,
  stageLabel: stage === "final" ? "Final" : stage.toUpperCase(),
  round: stage,
  status,
  startAt,
  teams: [teamA._id, teamB._id],
  source: "manual",
});

async function seed() {
  const teams = await Team.create(TEAM_NAMES.map((name) => ({ name })));
  const byName = new Map(teams.map((team) => [team.name, team]));
  publicTeam = byName.get("Baldia Zalmi");
  hiddenTeam = await Team.create({ name: "Private XI", isPublic: false });
  const hiddenTeam2 = await Team.create({ name: "Private United", isPublic: false });

  target = await Tournament.create({
    name: "All Baldia T20 Hard Ball Cricket Tournament",
    slug: "all-baldia-t20-hard-ball",
    type: "knockout",
    format: "T20",
    status: "upcoming",
    startDate: new Date("2026-10-01T00:00:00.000Z"),
    endDate: STORED_END,
    teams: teams.map((team) => team._id),
  });

  const qf1 = await Match.create(matchDoc({
    tournament: target,
    stage: "quarter_final",
    status: "completed",
    startAt: new Date("2026-10-04T05:00:00.000Z"),
    teamA: byName.get("Baldia Zalmi"),
    teamB: byName.get("Sky Sports"),
  }));
  const qf2 = await Match.create(matchDoc({
    tournament: target,
    stage: "quarter_final",
    status: "completed",
    startAt: new Date("2026-10-05T05:00:00.000Z"),
    teamA: byName.get("Young Star"),
    teamB: byName.get("Khan Associates"),
  }));
  const sf1 = await Match.create(matchDoc({
    tournament: target,
    stage: "semi_final",
    status: "completed",
    startAt: new Date("2026-10-11T04:30:00.000Z"),
    teamA: byName.get("Orangi Warriors"),
    teamB: byName.get("Orangi United"),
  }));
  const sf2 = await Match.create(matchDoc({
    tournament: target,
    stage: "semi_final",
    status: "completed",
    startAt: new Date("2026-10-11T05:00:00.000Z"),
    teamA: byName.get("Malir Friends"),
    teamB: byName.get("Gulshan XI"),
  }));
  // Past-dated relative to the list request, but still unfinished. This is the
  // exact shape that made the tournament read "upcoming" (and drop out of any
  // date-based board) even though its semi-finals were already played.
  const final = await Match.create(matchDoc({
    tournament: target,
    stage: "final",
    status: "upcoming",
    startAt: FINAL_START,
    teamA: byName.get("Baldia Zalmi"),
    teamB: byName.get("Young Star"),
  }));

  target.matches = [qf1._id, qf2._id, sf1._id, sf2._id, final._id];
  await target.save();

  completed = await Tournament.create({
    name: "Baldia Champions Cup",
    slug: "baldia-champions-cup",
    type: "knockout",
    status: "completed",
    startDate: new Date("2026-09-01T00:00:00.000Z"),
    endDate: new Date("2026-09-20T00:00:00.000Z"),
    teams: [byName.get("Baldia Zalmi")._id, byName.get("Sky Sports")._id],
  });
  const completedFinal = await Match.create(matchDoc({
    tournament: completed,
    stage: "final",
    status: "completed",
    startAt: new Date("2026-09-20T05:00:00.000Z"),
    teamA: byName.get("Baldia Zalmi"),
    teamB: byName.get("Sky Sports"),
  }));
  completed.matches = [completedFinal._id];
  await completed.save();

  partiallyHidden = await Tournament.create({
    name: "Baldia Mixed Visibility Cup",
    slug: "baldia-mixed-visibility-cup",
    type: "league",
    status: "upcoming",
    startDate: new Date("2026-12-01T00:00:00.000Z"),
    endDate: new Date("2026-12-10T00:00:00.000Z"),
    teams: [publicTeam._id, hiddenTeam._id],
  });

  allHidden = await Tournament.create({
    name: "Baldia Private Cup",
    slug: "baldia-private-cup",
    type: "league",
    status: "upcoming",
    startDate: new Date("2026-12-11T00:00:00.000Z"),
    endDate: new Date("2026-12-20T00:00:00.000Z"),
    teams: [hiddenTeam._id, hiddenTeam2._id],
  });
}

async function list(query = {}) {
  const res = mockRes();
  await getTournaments(mockReq({ query }), res);
  return res;
}

before(async () => {
  mongod = await startTestDb();
  await seed();
});

after(async () => {
  await stopTestDb(mongod);
});

test("the public list includes a tournament even when other local events exist", async () => {
  const res = await list();
  assert.equal(res.statusCode, 200);

  const ids = res.body.map((row) => String(row._id));
  assert.ok(ids.includes(String(target._id)), "target tournament is listed");
  assert.ok(ids.includes(String(completed._id)), "completed tournament is listed");
});

test("a past-dated but unfinished final reads ongoing and extends the public end date", async () => {
  const res = await list();
  const row = res.body.find((item) => String(item._id) === String(target._id));
  assert.ok(row, "target tournament is present");
  assert.equal(row.status, "upcoming", "stored status is left untouched");
  assert.equal(row.publicStatus, "ongoing");
  assert.equal(new Date(row.publicEndDate).toISOString(), FINAL_START.toISOString());
});

test("status filtering uses the derived public status", async () => {
  const ongoing = await list({ status: "ongoing" });
  const ongoingIds = ongoing.body.map((row) => String(row._id));
  assert.ok(ongoingIds.includes(String(target._id)));
  assert.ok(!ongoingIds.includes(String(completed._id)));

  // "in-progress" is accepted as an alias for the derived "ongoing" value.
  const alias = await list({ status: "in-progress" });
  assert.ok(alias.body.some((row) => String(row._id) === String(target._id)));

  const done = await list({ status: "completed" });
  const doneIds = done.body.map((row) => String(row._id));
  assert.ok(doneIds.includes(String(completed._id)));
  assert.ok(!doneIds.includes(String(target._id)));

  // An unknown status is ignored instead of silently emptying the board.
  const unknown = await list({ status: "not-a-status" });
  assert.ok(unknown.body.length >= 3);
});

test("a partially hidden tournament stays listed with only the hidden team stripped", async () => {
  const res = await list();
  const row = res.body.find((item) => String(item._id) === String(partiallyHidden._id));
  assert.ok(row, "partially hidden tournament is present");
  assert.equal(row.teams.length, 1);
  assert.equal(String(row.teams[0]._id), String(publicTeam._id));
});

test("a tournament whose entire team list is hidden is omitted", async () => {
  const res = await list();
  const ids = res.body.map((row) => String(row._id));
  assert.ok(!ids.includes(String(allHidden._id)));
});
