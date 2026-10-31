import test, { after, before } from "node:test";
import assert from "node:assert/strict";

process.env.MONGO_URL = "";
delete process.env.MONGODB_URI;
delete process.env.MONGO_URI;

import { startTestDb, stopTestDb } from "./helpers/testDb.js";
import Match from "../src/models/Match.js";
import Player from "../src/models/Player.js";
import Team from "../src/models/Team.js";
import { getPlayerStatsBundle } from "../src/services/playerStats.js";
import { computeTournamentStats } from "../src/services/tournamentStats.js";
import { aggregateSeriesStats } from "../src/controllers/seriesController.js";

let mongod;

before(async () => {
  mongod = await startTestDb();
});

after(async () => {
  await stopTestDb(mongod);
});

test("tournament and series batting, bowling, and fielding rows use each player's side", () => {
  const alpha = { _id: "team-a", name: "Alpha" };
  const beta = { _id: "team-b", name: "Beta" };
  const switchedPlayer = { _id: "switcher", name: "Switcher" };
  const bowlerA = { _id: "bowler-a", name: "Alpha Bowler" };
  const bowlerB = { _id: "bowler-b", name: "Beta Bowler" };
  const fielderA = { _id: "fielder-a", name: "Alpha Fielder" };
  const matches = [
    {
      _id: "manual",
      status: "completed",
      source: "manual",
      startAt: "2026-10-01T10:00:00.000Z",
      teams: [alpha, beta],
      innings: [
        {
          // Deliberately opposite fixture order.
          team: beta,
          batting: [{
            player: switchedPlayer,
            runs: 40,
            balls: 30,
            isOut: true,
            dismissalType: "caught",
            fielder: fielderA,
          }],
          bowling: [{ player: bowlerA, balls: 24, runs: 20, wickets: 1 }],
        },
        {
          team: alpha,
          batting: [{ player: { _id: "alpha-bat", name: "Alpha Batter" }, runs: 10, balls: 8 }],
          bowling: [
            { player: bowlerB, balls: 12, runs: 12, wickets: 0 },
            { player: switchedPlayer, balls: 6, runs: 8, wickets: 1 },
          ],
        },
      ],
    },
    {
      _id: "live",
      status: "completed",
      source: "live",
      startAt: "2026-10-02T10:00:00.000Z",
      teams: [alpha, beta],
      innings: [
        {
          // Live innings also intentionally differ from fixture order.
          team: beta,
          batting: [{ player: { _id: "beta-bat", name: "Beta Batter" }, runs: 12, balls: 10 }],
          bowling: [{ player: switchedPlayer, balls: 6, runs: 9, wickets: 1 }],
        },
        {
          team: alpha,
          batting: [{ player: switchedPlayer, runs: 15, balls: 10 }],
          bowling: [{ player: bowlerB, balls: 6, runs: 9, wickets: 1 }],
        },
      ],
    },
  ];

  const tournament = computeTournamentStats({ matches, minBallsFaced: 0, minOvers: 0 });
  const series = aggregateSeriesStats(matches);

  const assertLabels = ({ topRunScorers, topWicketTakers, topFielders }) => {
    assert.equal(topRunScorers.find((row) => row.playerId === "switcher").team, "Alpha");
    assert.equal(topRunScorers.find((row) => row.playerId === "switcher").teamId, "team-a");
    assert.equal(topWicketTakers.find((row) => row.playerId === "switcher").team, "Alpha");
    assert.equal(topWicketTakers.find((row) => row.playerId === "switcher").teamId, "team-a");
    assert.equal(topWicketTakers.find((row) => row.playerId === "bowler-a").team, "Alpha");
    assert.equal(topWicketTakers.find((row) => row.playerId === "bowler-b").team, "Beta");
    assert.equal(topFielders.find((row) => row.playerId === "fielder-a").team, "Alpha");
  };
  assertLabels(tournament);
  assertLabels(series);
  assert.deepEqual(tournament.teamStats.map((row) => row.name).sort(), ["Alpha", "Beta"]);
    assert.equal(tournament.teamStats.find((row) => row.teamId === "team-a").runsFor, 25);
    assert.equal(tournament.teamStats.find((row) => row.teamId === "team-b").runsFor, 52);
});

test("career stats derive from published manual and live matches, exclude drafts and DNB rows", async () => {
  const [alpha, beta] = await Team.create([
    { name: "Career Alpha", shortName: "CA" },
    { name: "Career Beta", shortName: "CB" },
  ]);
  const player = await Player.create({
    name: "Career Player",
    team: beta._id,
    stats: { runs: 999, wickets: 88, catches: 12 },
  });
  const dnb = await Player.create({ name: "Did Not Bat" });
  const opponent = await Player.create({ name: "Opponent" });
  const manual = await Match.create({
    title: "Published manual scorecard",
    teams: [alpha._id, beta._id],
    source: "manual",
    status: "completed",
    manualDraft: false,
    startAt: new Date("2026-10-01T10:00:00.000Z"),
    innings: [{
      team: beta._id,
      batting: [
        { player: player._id, runs: 42, balls: 30, fours: 4, sixes: 1, isOut: false },
        { player: dnb._id, runs: 0, balls: 0, isOut: false },
        { player: opponent._id, runs: 5, balls: 6, isOut: true, dismissalType: "caught" },
      ],
      bowling: [],
    }, {
      team: alpha._id,
      batting: [{ player: opponent._id, runs: 10, balls: 8, isOut: true }],
      bowling: [{ player: player._id, balls: 6, runs: 10, wickets: 1 }],
    }],
  });
  await Match.create({
    title: "Completed ball-by-ball match",
    teams: [alpha._id, beta._id],
    source: "live",
    status: "completed",
    startAt: new Date("2026-10-02T10:00:00.000Z"),
    innings: [
      {
        team: beta._id,
        batting: [{ player: opponent._id, runs: 10, balls: 8, isOut: true }],
        bowling: [{ player: player._id, balls: 12, runs: 18, wickets: 2 }],
      },
      {
        team: alpha._id,
        batting: [{ player: player._id, runs: 15, balls: 10, isOut: true }],
        bowling: [],
      },
    ],
  });
  await Match.create({
    title: "Completed but unpublished draft",
    teams: [alpha._id, beta._id],
    source: "manual",
    status: "completed",
    manualDraft: true,
    startAt: new Date("2026-10-03T10:00:00.000Z"),
    innings: [{
      team: alpha._id,
      batting: [{ player: player._id, runs: 100, balls: 50, isOut: true }],
      bowling: [],
    }],
  });
  const initialStats = await getPlayerStatsBundle(player._id);
  assert.equal(initialStats.totalMatches, 2);
  assert.equal(initialStats.stats.matches, 2);
  assert.equal(initialStats.stats.innings, 2);
  assert.equal(initialStats.stats.runs, 57);
  assert.equal(initialStats.stats.wickets, 3);
  assert.equal(initialStats.stats.balls, 18);
  assert.equal(initialStats.stats.catches, 0, "missing manual fielder data must not fabricate catches");
  assert.equal(initialStats.stats.team, "Career Alpha", "most recent match determines current team label");
  assert.equal(initialStats.stats.teamsPlayedFor.length, 2);

  const completedMatches = await Match.find({
    status: "completed",
    manualDraft: { $ne: true },
  }).populate("teams", "name shortName logo")
    .populate("innings.team", "name shortName logo")
    .lean();
  const tournamentStats = computeTournamentStats({
    matches: completedMatches,
    minBallsFaced: 0,
    minOvers: 0,
  });
  assert.equal(
    initialStats.stats.runs,
    tournamentStats.topRunScorers.find((row) => row.playerId === String(player._id)).runs,
  );
  assert.equal(
    initialStats.stats.wickets,
    tournamentStats.topWicketTakers.find((row) => row.playerId === String(player._id)).wickets,
  );

  const dnbBundle = await getPlayerStatsBundle(dnb._id);
  assert.equal(dnbBundle.totalMatches, 0);
  assert.equal(dnbBundle.stats.innings, 0);
  assert.equal(dnbBundle.stats.runs, 0);

  assert.equal((await Player.findById(player._id).lean()).stats.runs, 999, "derived reads must not mutate stored seed stats");
});

test("match live stats label a bowler with the fielding side, not the batting side", async () => {
  const [alpha, beta] = await Team.create([
    { name: "Live Alpha", shortName: "LA" },
    { name: "Live Beta", shortName: "LB" },
  ]);
  const bowler = await Player.create({ name: "Live Bowler", team: beta._id });
  // Fixture order is alpha first, but beta batted first: the innings says so.
  const match = await Match.create({
    title: "Live stats fixture",
    teams: [alpha._id, beta._id],
    source: "live",
    status: "completed",
    innings: [
      {
        team: beta._id,
        runs: 120,
        wickets: 2,
        balls: 90,
        batting: [{ player: bowler._id, runs: 30, balls: 20, isOut: true }],
        bowling: [{ player: bowler._id, balls: 30, runs: 25, wickets: 1 }],
      },
      { team: alpha._id, runs: 100, wickets: 5, balls: 90, batting: [], bowling: [] },
    ],
  });

  const { getMatchLiveStats } = await import("../src/controllers/matchController.js");
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await getMatchLiveStats({ params: { id: String(match._id) }, user: null }, res);

  assert.equal(res.statusCode, 200);
  // Beta batted, so Beta bowled the other innings. The bowling team is Alpha:
  // here the bowler is on Beta's card but the label comes from the innings'
  // opposite side, never the fixture order.
  assert.equal(res.body.topBowlers[0].team, "Live Alpha");
  assert.equal(res.body.topScorers[0].team, "Live Beta");
});
