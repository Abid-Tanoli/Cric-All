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
import aiCommentary, {
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

test("AI commentary is off by default and only a stored true enables it", async () => {
  const settings = await getPlatformSettings();
  assert.equal(settings.aiCommentaryEnabled, false);

  __setAiCommentaryEnabledForTests(null);
  assert.equal(await isAiCommentaryEnabled(), false);

  await setPlatformSettings({ aiCommentaryEnabled: true });
  __setAiCommentaryEnabledForTests(null);
  assert.equal(await isAiCommentaryEnabled(), true);
});

test("the env var never enables AI by default; an explicit stored false wins over env", async () => {
  const previous = process.env.AI_COMMENTARY_ENABLED;
  try {
    // Even with the env var absent, a fresh database is off.
    delete process.env.AI_COMMENTARY_ENABLED;
    await SystemSettings.deleteMany({});
    __setAiCommentaryEnabledForTests(null);
    assert.equal(await isAiCommentaryEnabled(), false);

    // An explicit env value only seeds a fresh document; it is opt-in.
    process.env.AI_COMMENTARY_ENABLED = "true";
    await SystemSettings.deleteMany({});
    __setAiCommentaryEnabledForTests(null);
    assert.equal(await isAiCommentaryEnabled(), true);

    // A stored `false` is authoritative over the env value.
    await setPlatformSettings({ aiCommentaryEnabled: false });
    __setAiCommentaryEnabledForTests(null);
    assert.equal(await isAiCommentaryEnabled(), false);
  } finally {
    if (previous === undefined) delete process.env.AI_COMMENTARY_ENABLED;
    else process.env.AI_COMMENTARY_ENABLED = previous;
    __setAiCommentaryEnabledForTests(null);
  }
});

test("with AI off, ball commentary is the non-AI text and the AI client is never called", async (t) => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  const previousApiKey = aiCommentary.apiKey;
  process.env.ANTHROPIC_API_KEY = "sk-test-not-real";
  aiCommentary.apiKey = "sk-test-not-real";

  let aiCalls = 0;
  // Spy on the only method that would touch the Anthropic API for a ball.
  await t.mock.method(aiCommentary, "_aiEnrichVivid", async () => {
    aiCalls += 1;
    return "AI enriched text";
  });

  try {
    await setPlatformSettings({ aiCommentaryEnabled: false });
    __setAiCommentaryEnabledForTests(null);
    assert.equal(await isAiCommentaryEnabled(), false);

    const result = await aiCommentary.generateBallCommentary({
      runs: 4,
      batsmanName: "Ali Raza",
      bowlerName: "Imran Khan",
      pitchLine: "off_stump",
      pitchLength: "full",
      ballMovement: "none",
      shotType: "cover_drive",
      shotDirection: "off",
    });

    assert.equal(aiCalls, 0, "zero AI calls while the flag is off even with a key present");
    assert.equal(
      result.short,
      "Imran Khan to Ali Raza, full on off stump, straight delivery, Ali Raza Cover Drive to off, four!",
    );
    assert.match(result.vivid, /Ali Raza/i);
    assert.match(result.vivid, /on off stump/);
    assert.match(result.vivid, /Cover Drive/);
    assert.doesNotMatch(result.vivid, /AI enriched text/);
  } finally {
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
    aiCommentary.apiKey = previousApiKey;
  }
});

test("with AI switched on, the AI enrich method runs and replaces the vivid line", async (t) => {
  let aiCalls = 0;
  // `apiKey` is fixed at construction time from the environment, so a test
  // cannot opt in by racing an env var against the module's import. Poke the
  // singleton directly (and restore it afterwards).
  const previousApiKey = aiCommentary.apiKey;
  aiCommentary.apiKey = "sk-test-not-real";
  await t.mock.method(aiCommentary, "_aiEnrichVivid", async () => {
    aiCalls += 1;
    return "AI enriched text";
  });

  try {
    await setPlatformSettings({ aiCommentaryEnabled: true });
    __setAiCommentaryEnabledForTests(null);

    const result = await aiCommentary.generateBallCommentary({
      runs: 6,
      batsmanName: "Ali Raza",
      bowlerName: "Imran Khan",
      pitchLine: "middle_stump",
      pitchLength: "full_toss",
      ballMovement: "none",
      shotType: "slog",
    });

    assert.equal(aiCalls, 1);
    assert.equal(result.vivid, "AI enriched text");
    assert.equal(
      result.short,
      "Imran Khan to Ali Raza, full toss on middle stump, straight delivery, Ali Raza Slog to the outfield, six!",
    );
  } finally {
    aiCommentary.apiKey = previousApiKey;
    __setAiCommentaryEnabledForTests(null);
  }
});

test("over summary and edited-ball regeneration fall back without any AI call when off", async (t) => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-test-not-real";
  await t.mock.method(aiCommentary, "_aiEnrichVivid", async () => "AI enriched text");

  try {
    await setPlatformSettings({ aiCommentaryEnabled: false });
    __setAiCommentaryEnabledForTests(null);

    const over = await aiCommentary.generateOverSummary({
      overNumber: 2,
      bowlerName: "Imran Khan",
      runsThisOver: 8,
      wicketsThisOver: 1,
      oversFigures: "2-0-12-1",
      ballsSummary: [],
      score: 45,
      wickets: 2,
      totalOvers: 8,
    });
    assert.match(over, /Imran Khan/);
    assert.match(over, /8 runs/);

    const edited = await aiCommentary.regenerateEditedBallCommentary({
      overNumber: 3,
      ballNumber: 4,
      oldType: "dot",
      oldRuns: 0,
      newType: "four",
      newRuns: 4,
      bowlerName: "Imran Khan",
      batsmanName: "Ali Raza",
    });
    assert.match(edited.short, /corrected: four for 4 runs/i);
  } finally {
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
    __setAiCommentaryEnabledForTests(null);
  }
});
