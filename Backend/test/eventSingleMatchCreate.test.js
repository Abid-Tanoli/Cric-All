import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { startTestDb, stopTestDb, mockReq, mockRes } from "./helpers/testDb.js";
import Event from "../src/models/Event.js";
import Match from "../src/models/Match.js";
import Team from "../src/models/Team.js";
import { createEvent, updateEvent } from "../src/controllers/eventController.js";

let mongod;

before(async () => {
  mongod = await startTestDb();
});

after(async () => {
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Promise.all([Event.deleteMany({}), Match.deleteMany({}), Team.deleteMany({})]);
});

test("single-match events own one linked upcoming fixture and edits never duplicate it", async () => {
  const teamA = await Team.create({ name: "Single Match A" });
  const teamB = await Team.create({ name: "Single Match B" });
  const body = {
    name: "Single Match Event",
    eventType: "single-match",
    teams: [teamA._id, teamB._id],
    format: "T20",
    startDate: "2026-01-02T10:00:00.000Z",
    venue: "Main Ground",
    totalMatches: 1,
  };

  const created = mockRes();
  await createEvent(mockReq({ body }), created);
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  assert.equal(created.body.event.totalMatches, 1);
  assert.equal(created.body.event.matches.length, 1);
  assert.equal(created.body.event.eventSquads.length, 0, "no squad is required");

  const matches = await Match.find({ event: created.body.event._id });
  assert.equal(matches.length, 1);
  const [match] = matches;
  assert.equal(match.status, "upcoming");
  assert.equal(match.title, body.name);
  assert.equal(match.venue, body.venue);
  assert.equal(match.matchType, body.format);
  assert.equal(String(match.teams[0]), String(teamA._id));
  assert.equal(String(match.teams[1]), String(teamB._id));
  assert.equal(match.innings.length, 2);

  const edited = mockRes();
  await updateEvent(
    mockReq({ params: { id: String(created.body.event._id) }, body: { name: "Single Match Event Renamed" } }),
    edited,
  );
  assert.equal(edited.statusCode, 200, JSON.stringify(edited.body));
  assert.equal(await Match.countDocuments({ event: created.body.event._id }), 1, "editing must not add another fixture");

  const series = mockRes();
  await createEvent(
    mockReq({
      body: {
        name: "Series Event",
        eventType: "series",
        teams: [teamA._id, teamB._id],
        format: "T20",
        totalTeams: 2,
        totalMatches: 2,
      },
    }),
    series,
  );
  assert.equal(series.statusCode, 201, JSON.stringify(series.body));
  assert.equal(series.body.event.matches.length, 0);
  assert.equal(await Match.countDocuments({ event: series.body.event._id }), 0);
});
