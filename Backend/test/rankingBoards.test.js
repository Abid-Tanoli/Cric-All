import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";

import { startTestDb, stopTestDb } from "./helpers/testDb.js";
import Team from "../src/models/Team.js";
import TeamOrganization from "../src/models/TeamOrganization.js";
import TeamRanking from "../src/models/TeamRanking.js";
import * as rankingService from "../src/services/rankingService.js";
import * as rankingController from "../src/controllers/rankingController.js";

let mongod;

before(async () => {
  mongod = await startTestDb();
});

after(async () => {
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Promise.all([
    Team.deleteMany({}),
    TeamOrganization.deleteMany({}),
    TeamRanking.deleteMany({}),
  ]);
});

async function seedTeam(name, { orgType = "other", teamType = "local_team", city = "" } = {}) {
  const org = await TeamOrganization.create({ name: `${name} Org`, type: orgType });
  const team = await Team.create({
    name,
    isPublic: true,
    type: teamType,
    organizationRef: org._id,
    address: { city },
  });
  await TeamRanking.create({ team: team._id, rating: 50, points: 10, overallRank: 1 });
  return { team, org };
}

test("team rankings can be filtered by organization type", async () => {
  const club = await seedTeam("Alpha Club", { orgType: "club" });
  await seedTeam("Beta School", { orgType: "school" });

  const result = await rankingService.getOverallRankings({ orgType: "club" });

  assert.equal(result.length, 1);
  assert.equal(String(result[0].team._id), String(club.team._id));
});

test("team rankings can be filtered by team type", async () => {
  await seedTeam("Gamma Local", { teamType: "local_team" });
  const league = await seedTeam("Delta League", { teamType: "league_team" });

  const result = await rankingService.getOverallRankings({ teamType: "league_team" });

  assert.equal(result.length, 1);
  assert.equal(String(result[0].team._id), String(league.team._id));
});

test("team rankings can be filtered by city", async () => {
  await seedTeam("Lahore XI", { city: "Lahore" });
  await seedTeam("Karachi XI", { city: "Karachi" });

  const result = await rankingService.getOverallRankings({ city: "Lahore" });

  assert.equal(result.length, 1);
});

test("an organization type with no matches returns an empty board", async () => {
  await seedTeam("Some Club", { orgType: "club" });

  const result = await rankingService.getOverallRankings({ orgType: "does-not-exist" });

  assert.deepEqual(result, []);
});

test("the duplicate generic player-ranking implementation is retired", () => {
  // Task 4: player leaderboards live in exactly one place — rankingsController
  // (mounted at /players/rankings). The old service/handler pair was removed.
  assert.equal(rankingService.computePlayerRankings, undefined);
  assert.equal(rankingController.getPlayerRankings, undefined);
  // The legitimately different, team-scoped player ranking is still present.
  assert.equal(typeof rankingController.getTeamPlayerRankings, "function");
});
