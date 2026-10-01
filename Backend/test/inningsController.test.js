import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import Match from "../src/models/Match.js";
import { endInnings } from "../src/controllers/inningsController.js";

let mongod;

before(async () => {
  mongod = await startTestDb();
});

after(async () => {
  await stopTestDb(mongod);
});

test("a Super Over chase reports wickets remaining out of two", async () => {
  const [first, second] = await Team.create([
    { name: "OPENCODE_TEST_super_over_first" },
    { name: "OPENCODE_TEST_super_over_second" },
  ]);
  const match = await Match.create({
    title: "OPENCODE_TEST_super_over_margin",
    matchType: "Super Over",
    totalOvers: 1,
    teams: [first._id, second._id],
    status: "live",
    innings: [
      { team: first._id, runs: 5, wickets: 1, status: "completed" },
      { team: second._id, runs: 6, wickets: 1, status: "live", overs: 0, balls: 3 },
    ],
    currentInnings: 1,
  });

  const res = mockRes();
  await endInnings(mockReq({ params: { matchId: String(match._id) }, body: { inningsIndex: 1 } }), res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.match.result.margin, "1 wicket");
  assert.match(res.body.match.result.description, /won by 1 wicket/);
});
