import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";

import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import SystemSettings, {
  getPlatformSettings,
  setPlatformSettings,
} from "../src/models/SystemSettings.js";
import * as teamService from "../src/services/teamService.js";
import * as playerService from "../src/services/playerService.js";
import { createPlayer } from "../src/controllers/playerController.js";
import { createTeam } from "../src/controllers/teamsController.js";
import {
  isAiCommentaryEnabled,
  __setAiCommentaryEnabledForTests,
} from "../src/services/aiCommentary.js";

// Terminal A (oct11-A): the admin data-entry guarantees — no duplicate players
// or teams, the four search keys, the printable team ID, and the AI kill switch.

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
    Player.deleteMany({}),
    SystemSettings.deleteMany({}),
  ]);
  __setAiCommentaryEnabledForTests(null);
});

async function makeTeam(overrides = {}) {
  return Team.create({ name: "Oct11 Eagles", isPublic: true, ...overrides });
}

function req(body, user = { _id: new mongoose.Types.ObjectId() }) {
  return mockReq({ body, user });
}

// --- duplicate players ------------------------------------------------------

test("a second player of the same name in the same team is rejected", async () => {
  const team = await makeTeam();
  await Player.create({ name: "Ali Raza", team: team._id });

  await assert.rejects(
    () =>
      playerService.assertPlayerNotDuplicate({
        name: "  ali   raza ",
        team: team._id,
      }),
    (err) => err.code === "PLAYER_DUPLICATE" && /Ali Raza/.test(err.message)
  );
});

test("the same name in a different team is allowed", async () => {
  const teamA = await makeTeam({ name: "Oct11 Eagles" });
  const teamB = await makeTeam({ name: "Oct11 Lions" });
  await Player.create({ name: "Ali Raza", team: teamA._id });

  await assert.doesNotReject(() =>
    playerService.assertPlayerNotDuplicate({ name: "Ali Raza", team: teamB._id })
  );
});

test("the same phone number anywhere is rejected", async () => {
  const teamA = await makeTeam({ name: "Oct11 Eagles" });
  const teamB = await makeTeam({ name: "Oct11 Lions" });
  await Player.create({ name: "Ali Raza", team: teamA._id, phone: "923001234567" });

  await assert.rejects(
    () =>
      playerService.assertPlayerNotDuplicate({
        name: "Different Name",
        team: teamB._id,
        phone: "0300 1234567",
      }),
    (err) => err.code === "PLAYER_DUPLICATE"
  );
});

test("createPlayer returns 409 naming the existing player", async () => {
  const team = await makeTeam();
  await Player.create({ name: "Ali Raza", team: team._id });

  const res = mockRes();
  await createPlayer(req({ name: "Ali Raza", team: team._id }), res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "PLAYER_DUPLICATE");
  assert.equal(res.body.existing.name, "Ali Raza");
});

// --- duplicate teams --------------------------------------------------------

test("assertTeamNameAvailable names the existing team", async () => {
  await teamService.createTeam({ name: "Oct11 Eagles" });

  await assert.rejects(
    () => teamService.assertTeamNameAvailable("Oct11 Eagles", null),
    (err) => err.code === "TEAM_NAME_TAKEN" && /Oct11 Eagles/.test(err.message)
  );
});

test("createTeam returns 409 for a duplicate name", async () => {
  const first = mockRes();
  await createTeam(req({ name: "Oct11 Eagles" }), first);
  assert.equal(first.statusCode, 201);

  const second = mockRes();
  await createTeam(req({ name: "Oct11 Eagles" }), second);
  assert.equal(second.statusCode, 409);
  assert.equal(second.body.code, "TEAM_NAME_TAKEN");
});

// --- four search keys -------------------------------------------------------

test("listTeams finds a team by its id and by its club id", async () => {
  const clubId = new mongoose.Types.ObjectId();
  const team = await makeTeam({ organizationRef: clubId });

  const byTeamId = await teamService.listTeams({ search: String(team._id) });
  assert.equal(byTeamId.length, 1);
  assert.equal(String(byTeamId[0]._id), String(team._id));

  const byClubId = await teamService.listTeams({ search: String(clubId) });
  assert.equal(byClubId.length, 1);
  assert.equal(String(byClubId[0]._id), String(team._id));
});

test("listTeams escapes regex metacharacters in the search term", async () => {
  await makeTeam({ name: "Oct11 Eagles" });

  const results = await teamService.listTeams({ search: ".*" });
  assert.equal(results.length, 0);
});

// --- AI kill switch ---------------------------------------------------------

test("AI commentary is on by default and can be switched off", async () => {
  const settings = await getPlatformSettings();
  assert.equal(settings.aiCommentaryEnabled, true);

  await setPlatformSettings({ aiCommentaryEnabled: false });
  __setAiCommentaryEnabledForTests(null);
  assert.equal(await isAiCommentaryEnabled(), false);

  await setPlatformSettings({ aiCommentaryEnabled: true });
  __setAiCommentaryEnabledForTests(null);
  assert.equal(await isAiCommentaryEnabled(), true);
});
