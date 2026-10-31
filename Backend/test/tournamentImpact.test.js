import test, { after, before } from "node:test";
import assert from "node:assert/strict";

process.env.MONGO_URL = "";
delete process.env.MONGODB_URI;
delete process.env.MONGO_URI;

import { startTestDb, stopTestDb } from "./helpers/testDb.js";
import Match from "../src/models/Match.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import { computeTournamentStats, gatherTournamentStats } from "../src/services/tournamentStats.js";
import {
  IMPACT_WEIGHTS,
  computeTournamentImpact,
  economyAdjustment,
  haulPoints,
  impactExplanation,
  milestonePoints,
  strikeRatePoints,
} from "../src/services/tournamentImpact.js";

let mongod;

before(async () => {
  mongod = await startTestDb();
});

after(async () => {
  await stopTestDb(mongod);
});

const team = (id, name) => ({ _id: id, name });
const player = (id, name) => ({ _id: id, name });

// A minimal weights object for exact-arithmetic tests: no milestones, no
// strike-rate nudge and no economy so only the knob under test moves.
const plainWeights = (overrides = {}) => ({
  ...IMPACT_WEIGHTS,
  batting: {
    ...IMPACT_WEIGHTS.batting,
    milestones: [],
    strikeRate: { minBalls: 10_000, tiers: [], slowMax: 0, slowPoints: 0 },
  },
  bowling: { ...IMPACT_WEIGHTS.bowling, economyWeight: 0, hauls: [] },
  fielding: { catch: 0, runOut: 0, stumping: 0 },
  team: { winMultiplier: 1 },
  manOfMatch: 0,
  ...overrides,
});

test("weights helpers convert runs, balls and wickets exactly", () => {
  assert.equal(milestonePoints(29), 0);
  assert.equal(milestonePoints(30), 8);
  assert.equal(milestonePoints(49), 8);
  assert.equal(milestonePoints(50), 16);
  assert.equal(milestonePoints(99), 16);
  assert.equal(milestonePoints(100), 32);
  assert.equal(milestonePoints(140), 32, "highest milestone only, never stacked");

  assert.equal(strikeRatePoints(19, 10), 2, "SR 190 only reaches the 150 tier");
  assert.equal(strikeRatePoints(17, 10), 2, "SR 170");
  assert.equal(strikeRatePoints(20, 10), 4, "SR 200");
  assert.equal(strikeRatePoints(15, 10), 2, "SR 150");
  assert.equal(strikeRatePoints(9, 10), -2, "SR below 100");
  assert.equal(strikeRatePoints(20, 9), 0, "under 10 balls faced is ignored");

  assert.equal(haulPoints(2), 0);
  assert.equal(haulPoints(3), 10);
  assert.equal(haulPoints(4), 10);
  assert.equal(haulPoints(5), 25);
  assert.equal(haulPoints(6), 25, "highest haul tier only");

  // 24 runs in 4 overs = 6 an over against a 7.5 tournament average.
  assert.equal(economyAdjustment(24, 24, 7.5), 6);
  assert.equal(economyAdjustment(36, 24, 7.5), -6);
  assert.equal(economyAdjustment(0, 3, 7.5), 0, "a part over never swings the score");
  assert.equal(economyAdjustment(24, 24, null), 0, "no tournament economy, no adjustment");
});

test("a winning innings beats a heavier-scoring innings on the losing side", () => {
  const alpha = team("t-alpha", "Alpha");
  const beta = team("t-beta", "Beta");
  const winner = player("p-winner", "Winning Batter");
  const loser = player("p-loser", "Losing Batter");

  const impact = computeTournamentImpact({
    matches: [
      {
        _id: "final",
        status: "completed",
        startAt: "2026-10-30T10:00:00.000Z",
        teams: [alpha, beta],
        result: { resultType: "normal", winner: alpha },
        manOfMatch: winner,
        innings: [
          {
            team: alpha,
            batting: [{ player: winner, runs: 75, balls: 30, fours: 8, sixes: 3, isOut: false }],
            bowling: [],
          },
          {
            team: beta,
            batting: [{ player: loser, runs: 100, balls: 65, fours: 6, sixes: 2, isOut: true }],
            bowling: [],
          },
        ],
      },
    ],
  });

  const winningRow = impact.rows.find((row) => row.playerId === "p-winner");
  const losingRow = impact.rows.find((row) => row.playerId === "p-loser");

  // 75 runs + 8 fours + 6 for sixes + 16 for the fifty + 4 for SR 250 = 109.
  // Winning side: x1.2 = 130.8, plus the 20-point man-of-the-match award.
  assert.equal(winningRow.breakdown.batting, 109);
  assert.equal(winningRow.breakdown.winBonus, 21.8);
  assert.equal(winningRow.breakdown.manOfMatchBonus, 20);
  assert.equal(winningRow.impact, 150.8);

  // 100 + 6 + 4 + 32 + 2 for SR 153.85 = 144, with no win or award bonus.
  assert.equal(losingRow.impact, 144);
  assert.equal(losingRow.breakdown.winBonus, 0);
  assert.equal(losingRow.breakdown.manOfMatchBonus, 0);

  assert.equal(impact.leader.playerId, "p-winner", "the match-winner tops the ranking");
  assert.ok(winningRow.impact > losingRow.impact);
  assert.equal(impact.rows[0].rank, 1);
  assert.equal(impact.rows[1].rank, 2);
});

test("economy is scored against the tournament's own average, not a fixed number", () => {
  const alpha = team("t-alpha", "Alpha");
  const beta = team("t-beta", "Beta");
  const tight = player("p-tight", "Tight Bowler");
  const loose = player("p-loose", "Loose Bowler");

  const impact = computeTournamentImpact({
    matches: [
      {
        _id: "m1",
        status: "completed",
        teams: [alpha, beta],
        innings: [
          { team: alpha, batting: [{ player: { _id: "p-bat", name: "Bat" }, runs: 60, balls: 40 }], bowling: [] },
          {
            team: beta,
            batting: [{ player: { _id: "p-bat2", name: "Bat 2" }, runs: 30, balls: 20 }],
            bowling: [
              { player: tight, balls: 24, runs: 24, wickets: 0 },
              { player: loose, balls: 24, runs: 36, wickets: 0 },
            ],
          },
        ],
      },
    ],
  });

  // 60 runs from 48 balls = 7.5 an over.
  assert.equal(impact.tournamentEconomy, 7.5);
  const tightRow = impact.rows.find((row) => row.playerId === "p-tight");
  const looseRow = impact.rows.find((row) => row.playerId === "p-loose");
  assert.equal(tightRow.breakdown.bowling, 6, "(7.5 - 6) x 4 overs");
  assert.equal(looseRow.breakdown.bowling, -6, "(7.5 - 9) x 4 overs");
  assert.ok(tightRow.rank < looseRow.rank);
});

test("manual scorecards earn no fielding points and lose none for missing fielders", () => {
  const alpha = team("t-alpha", "Alpha");
  const beta = team("t-beta", "Beta");
  const bowler = player("p-bowler", "Manual Bowler");

  const impact = computeTournamentImpact({
    matches: [
      {
        _id: "manual",
        status: "completed",
        source: "manual",
        teams: [alpha, beta],
        innings: [
          {
            team: alpha,
            // A dismissal type but no fielder: manual cards do not record one.
            batting: [{ player: { _id: "p-out", name: "Out" }, runs: 10, balls: 10, isOut: true, dismissalType: "caught" }],
            bowling: [],
          },
          {
            team: beta,
            batting: [{ player: { _id: "p-out2", name: "Out 2" }, runs: 5, balls: 8, isOut: true }],
            bowling: [{ player: bowler, balls: 24, runs: 20, wickets: 2 }],
          },
        ],
      },
      {
        _id: "live",
        status: "completed",
        source: "live",
        teams: [alpha, beta],
        innings: [
          {
            team: alpha,
            batting: [
              {
                player: { _id: "p-out", name: "Out" },
                runs: 0,
                balls: 1,
                isOut: true,
                dismissalType: "caught",
                fielder: { _id: "p-fielder", name: "Fielder" },
              },
            ],
            bowling: [],
          },
          { team: beta, batting: [], bowling: [] },
        ],
      },
    ],
  });

  const manualRow = impact.rows.find((row) => row.playerId === "p-bowler");
  assert.equal(manualRow.breakdown.fielding, 0);
  assert.equal(manualRow.impact, 50, "two wickets, no invisible catches");
  assert.ok(manualRow.impact > 0);

  const fielderRow = impact.rows.find((row) => row.playerId === "p-fielder");
  assert.equal(fielderRow.breakdown.fielding, 8, "a recorded catch is credited");
  assert.equal(impact.fieldingRecorded, true);
});

test("a match without a man of the match adds no bonus and does not fail", () => {
  const alpha = team("t-alpha", "Alpha");
  const beta = team("t-beta", "Beta");
  const impact = computeTournamentImpact({
    matches: [
      {
        _id: "no-mom",
        status: "completed",
        teams: [alpha, beta],
        innings: [
          { team: alpha, batting: [{ player: { _id: "p1", name: "Batter" }, runs: 20, balls: 20 }], bowling: [] },
          { team: beta, batting: [], bowling: [] },
        ],
      },
    ],
  });

  const row = impact.rows.find((entry) => entry.playerId === "p1");
  assert.equal(row.breakdown.manOfMatchBonus, 0);
  assert.equal(row.manOfMatchAwards, 0);
});

test("ties break on runs + wickets x 20, then on fewer matches played", () => {
  const alpha = team("t-alpha", "Alpha");
  const beta = team("t-beta", "Beta");
  const runsBatter = player("p-runs", "Runs");
  const wicketBowler = player("p-wickets", "Wickets");

  const weights = { ...plainWeights(), batting: { ...plainWeights().batting, run: 1 } };
  const tied = computeTournamentImpact({
    weights: { ...weights, bowling: { ...weights.bowling, wicket: 15 } },
    matches: [
      {
        _id: "tie",
        status: "completed",
        teams: [alpha, beta],
        innings: [
          { team: alpha, batting: [{ player: runsBatter, runs: 30, balls: 20 }], bowling: [] },
          {
            team: beta,
            batting: [],
            bowling: [{ player: wicketBowler, balls: 12, runs: 20, wickets: 2 }],
          },
        ],
      },
    ],
  });
  assert.equal(tied.rows[0].impact, tied.rows[1].impact, "both scored 30");
  assert.equal(tied.rows[0].playerId, "p-wickets", "runs + wickets x 20 favours the bowler (40 vs 30)");

  const oneMatch = player("p-one", "One Match");
  const twoMatches = player("p-two", "Two Matches");
  const fewer = computeTournamentImpact({
    weights: plainWeights(),
    matches: [
      {
        _id: "a",
        status: "completed",
        teams: [alpha, beta],
        innings: [
          { team: alpha, batting: [{ player: oneMatch, runs: 30, balls: 20 }], bowling: [] },
          { team: beta, batting: [{ player: twoMatches, runs: 15, balls: 10 }], bowling: [] },
        ],
      },
      {
        _id: "b",
        status: "completed",
        teams: [alpha, beta],
        innings: [
          { team: alpha, batting: [{ player: twoMatches, runs: 15, balls: 10 }], bowling: [] },
          { team: beta, batting: [], bowling: [] },
        ],
      },
    ],
  });
  assert.equal(fewer.rows[0].impact, 30);
  assert.equal(fewer.rows[1].impact, 30);
  assert.equal(fewer.rows[0].impact, fewer.rows[1].impact);
  assert.equal(fewer.rows[0].playerId, "p-one", "same score, same runs: fewer matches comes first");
});

test("matches played counts each completed match once and ignores drafts and DNB rows", () => {
  const alpha = team("t-alpha", "Alpha");
  const beta = team("t-beta", "Beta");
  const allRounder = { _id: "p-all", name: "All Rounder" };
  const dnb = { _id: "p-dnb", name: "Did Not Bat" };
  const bowler = { _id: "p-bowl", name: "Bowler" };
  const bench = { _id: "p-bench", name: "Bench" };
  const draftOnly = { _id: "p-draft", name: "Draft Only" };

  const matches = [
    {
      _id: "manual",
      status: "completed",
      source: "manual",
      teams: [alpha, beta],
      innings: [
        {
          team: alpha,
          batting: [
            { player: allRounder, runs: 40, balls: 30 },
            { player: dnb, runs: 0, balls: 0, isOut: false },
          ],
          bowling: [],
        },
        { team: beta, batting: [{ player: { _id: "p-opp", name: "Opp" }, runs: 20, balls: 20 }], bowling: [{ player: bowler, balls: 24, runs: 20, wickets: 2 }] },
      ],
    },
    {
      _id: "live",
      status: "completed",
      source: "live",
      teams: [alpha, beta],
      playingXI: [{ team: alpha, players: [allRounder, bench] }],
      innings: [
        { team: alpha, batting: [{ player: allRounder, runs: 10, balls: 8 }], bowling: [] },
        { team: beta, batting: [], bowling: [{ player: allRounder, balls: 6, runs: 8, wickets: 1 }] },
      ],
    },
    {
      _id: "draft",
      status: "completed",
      manualDraft: true,
      teams: [alpha, beta],
      innings: [{ team: alpha, batting: [{ player: draftOnly, runs: 90, balls: 40 }], bowling: [] }],
    },
  ];

  const stats = computeTournamentStats({ matches, minBallsFaced: 0, minOvers: 0 });
  const row = (list, id) => list.find((entry) => entry.playerId === id);

  assert.equal(row(stats.topRunScorers, "p-all").matches, 2, "batted and bowled in one match still counts once per match");
  assert.equal(row(stats.topRunScorers, "p-all").innings, 2);
  assert.equal(row(stats.topWicketTakers, "p-all").matches, 2);
  assert.equal(row(stats.topWicketTakers, "p-bowl").matches, 1);
  assert.equal(row(stats.topRunScorers, "p-dnb"), undefined, "a DNB row is not an innings");
  assert.equal(row(stats.topRunScorers, "p-draft"), undefined, "a draft is excluded");
  assert.equal(
    stats.topRunScorers.some((entry) => entry.playerId === "p-bench"),
    false,
    "a playing-XI player who neither batted nor bowled has no batting row",
  );

  // The same counting rule drives the impact ranking.
  const impact = computeTournamentImpact({ matches });
  assert.equal(impact.rows.find((entry) => entry.playerId === "p-all").matches, 2);
  assert.equal(impact.rows.find((entry) => entry.playerId === "p-bowl").matches, 1);
  assert.equal(impact.rows.find((entry) => entry.playerId === "p-draft"), undefined);
  assert.equal(impact.rows.find((entry) => entry.playerId === "p-dnb"), undefined);
});

test("the public explanation is generated from the weights", () => {
  const lines = impactExplanation();
  assert.ok(lines.length >= 8);
  const text = lines.join(" ");
  for (const needle of ["1 point per run", "25 points per wicket", "8 per catch", "1.2", "20 extra points", "16 for 50+"]) {
    assert.ok(text.includes(needle), `explanation should mention "${needle}"`);
  }
  assert.ok(Object.isFrozen(IMPACT_WEIGHTS));
  assert.ok(Object.isFrozen(IMPACT_WEIGHTS.batting));
});

test("gatherTournamentStats exposes matches played and the Player of the Tournament", async () => {
  const [alpha, beta] = await Team.create([
    { name: "Impact Alpha", shortName: "IA" },
    { name: "Impact Beta", shortName: "IB" },
  ]);
  const star = await Player.create({ name: "Impact Star", team: alpha._id });
  const bowler = await Player.create({ name: "Impact Bowler", team: beta._id });
  const tournamentId = "6adf4baed38e4ffcae94e000";

  await Match.create({
    title: "Impact fixture",
    tournament: tournamentId,
    teams: [beta._id, alpha._id],
    source: "manual",
    status: "completed",
    startAt: new Date("2026-10-20T10:00:00.000Z"),
    manOfMatch: star._id,
    result: { resultType: "normal", winner: alpha._id, description: "Alpha won" },
    innings: [
      {
        // Alpha batted first even though the fixture lists Beta first.
        team: alpha._id,
        runs: 180,
        wickets: 4,
        balls: 120,
        batting: [{ player: star._id, runs: 70, balls: 40, fours: 6, sixes: 3, isOut: false }],
        bowling: [{ player: bowler._id, balls: 24, runs: 30, wickets: 2 }],
      },
      {
        team: beta._id,
        runs: 150,
        wickets: 8,
        balls: 120,
        batting: [{ player: bowler._id, runs: 20, balls: 18, isOut: true }],
        bowling: [],
      },
    ],
  });

  const stats = await gatherTournamentStats(tournamentId);
  assert.equal(stats.playerOfTournament.hasData, true);
  assert.equal(stats.playerOfTournament.leader.name, "Impact Star");
  assert.equal(stats.playerOfTournament.leader.rank, 1);
  assert.equal(stats.playerOfTournament.leader.manOfMatchAwards, 1);
  assert.equal(stats.playerOfTournament.leader.team, "Impact Alpha");
  assert.ok(stats.playerOfTournament.explanation.length > 0);
  assert.equal(
    stats.topRunScorers.find((row) => row.name === "Impact Star").matches,
    1,
    "the leaderboard column uses the same counting rule",
  );
  assert.deepEqual(
    stats.playerOfTournament.rows.map((row) => row.rank),
    [1, 2],
  );
});
