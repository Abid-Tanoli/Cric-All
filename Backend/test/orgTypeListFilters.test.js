import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";
process.env.FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

import Team from "../src/models/Team.js";
import TeamOrganization from "../src/models/TeamOrganization.js";
import Player from "../src/models/Player.js";
import Tournament from "../src/models/Tournament.js";
import Match from "../src/models/Match.js";
import Membership from "../src/models/Membership.js";
import { listOrganizations } from "../src/controllers/organizationController.js";
import { listTeams } from "../src/controllers/teamsController.js";
import { getPlayers } from "../src/controllers/playerController.js";
import { getTournaments } from "../src/controllers/TournamentController.js";
import { getMatches } from "../src/controllers/matchController.js";
import { InvalidOrgTypeFilterError, parseOrgTypeFilter } from "../src/services/organizationService.js";
import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";

let mongod;

before(async () => {
  mongod = await startTestDb();
  await Promise.all([Team.init(), TeamOrganization.init()]);
});

after(async () => {
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Promise.all([
    Team.deleteMany({}),
    TeamOrganization.deleteMany({}),
    Player.deleteMany({}),
    Tournament.deleteMany({}),
    Match.deleteMany({}),
    Membership.deleteMany({}),
  ]);
});

const call = async (controller, query) => {
  const res = mockRes();
  await controller(mockReq({ query }), res);
  return res;
};

async function fixtures() {
  const club = await TeamOrganization.create({ name: "Filter Club", orgType: "local_club", type: "club" });
  const school = await TeamOrganization.create({ name: "Filter School", orgType: "school", type: "school" });
  // A pre-migration row: raw insert bypasses the model hook that backfills orgType.
  const legacyResult = await TeamOrganization.collection.insertOne({
    name: "Legacy Club",
    type: "club",
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const legacy = { _id: legacyResult.insertedId };

  const clubTeam = await Team.create({
    name: "Filter Club XI",
    organization: club.name,
    organizationRef: club._id,
    teamRole: "1st XI",
    category: "Club",
  });
  const schoolTeam = await Team.create({
    name: "Filter School XI",
    organization: school.name,
    organizationRef: school._id,
    teamRole: "1st XI",
    category: "School",
  });
  const legacyTeam = await Team.create({
    name: "Legacy Club XI",
    organization: legacy.name,
    organizationRef: legacy._id,
    category: "Club",
  });

  const day = new Date();
  await Player.create([
    { name: "Club Player", team: clubTeam._id },
    { name: "School Player", team: schoolTeam._id },
    { name: "Legacy Player", team: legacyTeam._id },
  ]);
  await Tournament.create([
    { name: "Club Cup", startDate: day, endDate: day, organizationRef: club._id },
    { name: "School Cup", startDate: day, endDate: day, organizationRef: school._id },
    { name: "Legacy Cup", startDate: day, endDate: day, organizationRef: legacy._id },
  ]);
  await Match.create([
    { title: "Club Match", startAt: day, status: "upcoming", teams: [clubTeam._id] },
    { title: "School Match", startAt: day, status: "upcoming", teams: [schoolTeam._id] },
    { title: "Legacy Match", startAt: day, status: "upcoming", teams: [legacyTeam._id] },
  ]);
}

test("orgType filter parsing accepts single and comma values, rejects everything else", () => {
  assert.deepEqual(parseOrgTypeFilter(undefined), []);
  assert.deepEqual(parseOrgTypeFilter("all"), []);
  assert.deepEqual(parseOrgTypeFilter("local_club"), ["local_club"]);
  assert.deepEqual(parseOrgTypeFilter("local_club, school"), ["local_club", "school"]);
  assert.throws(() => parseOrgTypeFilter("planet"), InvalidOrgTypeFilterError);
  assert.throws(() => parseOrgTypeFilter("local_club,"), InvalidOrgTypeFilterError);
  assert.throws(() => parseOrgTypeFilter("club"), InvalidOrgTypeFilterError);
});

test("organizations filter by one type, several types, and legacy rows", async () => {
  await fixtures();
  const club = await call(listOrganizations, { orgType: "local_club" });
  assert.equal(club.statusCode, 200);
  assert.deepEqual(club.body.items.map((org) => org.name).sort(), ["Filter Club", "Legacy Club"]);

  const both = await call(listOrganizations, { orgType: "local_club,school" });
  assert.deepEqual(both.body.items.map((org) => org.name).sort(), ["Filter Club", "Filter School", "Legacy Club"]);

  const all = await call(listOrganizations, {});
  assert.equal(all.body.total, 3);

  const invalid = await call(listOrganizations, { orgType: "space_club" });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.code, "ORG_TYPE_FILTER_INVALID");
});

test("teams filter by org type through the team organization", async () => {
  await fixtures();
  const names = async (query) => {
    const res = await call(listTeams, { scope: "organization", ...query });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    return res.body.map((team) => team.name).sort();
  };
  assert.deepEqual(await names({ orgType: "local_club" }), ["Filter Club XI", "Legacy Club XI"]);
  assert.deepEqual(await names({ orgType: "local_club,school" }), ["Filter Club XI", "Filter School XI", "Legacy Club XI"]);
  assert.deepEqual(await names({}), ["Filter Club XI", "Filter School XI", "Legacy Club XI"]);
  assert.equal((await call(listTeams, { orgType: "nope" })).statusCode, 400);
});

test("players filter by their team's organization type", async () => {
  await fixtures();
  const names = async (query) => {
    const res = await call(getPlayers, { limit: 100, ...query });
    assert.equal(res.statusCode, 200);
    return res.body.players.map((player) => player.name).sort();
  };
  assert.deepEqual(await names({ orgType: "local_club" }), ["Club Player", "Legacy Player"]);
  assert.deepEqual(await names({ orgType: "school" }), ["School Player"]);
  assert.deepEqual(await names({}), ["Club Player", "Legacy Player", "School Player"]);
  assert.equal((await call(getPlayers, { orgType: "nope" })).statusCode, 400);
});

test("tournaments filter by their owning organization's type", async () => {
  await fixtures();
  const names = async (query) => {
    const res = await call(getTournaments, { ...query });
    assert.equal(res.statusCode, 200);
    return res.body.map((tournament) => tournament.name).sort();
  };
  assert.deepEqual(await names({ orgType: "local_club" }), ["Club Cup", "Legacy Cup"]);
  assert.deepEqual(await names({ orgType: "local_club,school" }), ["Club Cup", "Legacy Cup", "School Cup"]);
  assert.deepEqual(await names({}), ["Club Cup", "Legacy Cup", "School Cup"]);
  assert.equal((await call(getTournaments, { orgType: "nope" })).statusCode, 400);
});

test("matches filter through their teams' organizations", async () => {
  await fixtures();
  const titles = async (query) => {
    const res = await call(getMatches, { ...query });
    assert.equal(res.statusCode, 200);
    return res.body.map((match) => match.title).sort();
  };
  assert.deepEqual(await titles({ orgType: "local_club" }), ["Club Match", "Legacy Match"]);
  assert.deepEqual(await titles({ orgType: "local_club,school" }), ["Club Match", "Legacy Match", "School Match"]);
  assert.deepEqual(await titles({}), ["Club Match", "Legacy Match", "School Match"]);
  assert.equal((await call(getMatches, { orgType: "nope" })).statusCode, 400);
});
