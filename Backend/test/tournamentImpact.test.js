import test, { after, before } from "node:test";
import assert from "node:assert/strict";

process.env.MONGO_URL = "";
delete process.env.MONGODB_URI;
delete process.env.MONGO_URI;

import { startTestDb, stopTestDb } from "./helpers/testDb.js";
import Match from "../src/models/Match.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import Tournament from "../src/models/Tournament.js";
import { computeTournamentStats, gatherTournamentStats } from "../src/services/tournamentStats.js";
import {
  IMPACT_WEIGHTS,
  computeTournamentImpact,
  economyAdjustment,
  haulPoints,
  impactExplanation,
  milestonePoints,
  strikeRatePoints,
  teamRunSharePoints,
  teamWicketSharePoints,
  wonByWickets,
  stageWeightFor,
  isDominantWin,
  resultMultiplierFor,
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
// Multipliers are products of decimal constants, so compare with a tiny margin.
const closeTo = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, message || `${actual} ~= ${expected}`);

// A minimal weights object for exact-arithmetic tests: no milestones, no
// strike-rate nudge and no economy so only the knob under test moves.
const plainWeights = (overrides = {}) => ({
  ...IMPACT_WEIGHTS,
  batting: {
    ...IMPACT_WEIGHTS.batting,
    milestones: [],
    strikeRate: { minBalls: 10_000, tiers: [], slowMax: 0, slowPoints: 0 },
    teamRunShare: 0,
    notOut: 0,
    chaseFinish: 0,
  },
  bowling: { ...IMPACT_WEIGHTS.bowling, economyWeight: 0, hauls: [], teamWicketShare: 0 },
  fielding: { catch: 0, runOut: 0, stumping: 0 },
  // Neutral result multipliers, so exact-arithmetic tests only move the knob
  // under test.
  result: {
    ...IMPACT_WEIGHTS.result,
    winMultiplier: 1,
    competitiveLossMultiplier: 1,
    dominantLossMultiplier: 1,
    stageWeights: { group: 1, league: 1, quarterFinal: 1, semiFinal: 1, final: 1 },
  },
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

test("team-share and chase helpers are bounded and read the result margin", () => {
  // (runs / team runs) x 20, capped at one full share.
  assert.equal(teamRunSharePoints(40, 200), 4);
  assert.equal(teamRunSharePoints(0, 200), 0);
  assert.equal(teamRunSharePoints(40, 0), 0, "no team total, no invented points");
  assert.equal(teamRunSharePoints(250, 200), 20, "a malformed total cannot exceed one share");

  // (wickets / team wickets) x 20, capped at one full share.
  assert.equal(teamWicketSharePoints(2, 8), 5);
  assert.equal(teamWicketSharePoints(0, 8), 0);
  assert.equal(teamWicketSharePoints(2, 0), 0);
  assert.equal(teamWicketSharePoints(12, 8), 20);

  // Stored innings carry target 0, so the result text is the chase signal.
  assert.equal(wonByWickets({ result: { description: "Sky Sports won by 4 wickets" } }), true);
  assert.equal(wonByWickets({ result: { margin: "won by 6 wickets" } }), true);
  assert.equal(wonByWickets({ result: { description: "Young Star won by 122 runs" } }), false);
  assert.equal(wonByWickets({ result: {} }), false, "no margin means no guess");
});

test("result multipliers reward wins, discount losses, and only winners get the stage weight", () => {
  const alpha = team("t-alpha", "Alpha");
  const beta = team("t-beta", "Beta");
  const match = (overrides = {}) => ({
    teams: [alpha, beta],
    result: { resultType: "normal", winner: alpha, ...(overrides.result || {}) },
    totalOvers: 20,
    ...overrides,
  });

  // Same group win: 1.35 for the winner, 0.85 for a competitive loser.
  assert.equal(resultMultiplierFor(match({ stage: "group" }), alpha), 1.35);
  assert.equal(resultMultiplierFor(match({ stage: "group" }), beta), 0.85);
  // The stage weight applies to the winner only.
  closeTo(resultMultiplierFor(match({ stage: "final" }), alpha), 2.025);
  assert.equal(resultMultiplierFor(match({ stage: "final" }), beta), 0.85);
  closeTo(resultMultiplierFor(match({ stage: "quarter_final" }), alpha), 1.485);
  closeTo(resultMultiplierFor(match({ stage: "semi_final" }), alpha), 1.6875);
  closeTo(resultMultiplierFor(match({ stageLabel: "Final" }), alpha), 2.025);
  // Unknown/empty stage stays neutral for the win multiplier.
  assert.equal(resultMultiplierFor(match({ stage: "" }), alpha), 1.35);
  assert.equal(stageWeightFor(match({ stage: "third_place" })), 1);

  // Dominant margins: 8+ wickets, or 40+ runs in a 20-over match.
  assert.equal(isDominantWin(match({ result: { winner: alpha, margin: "9 wickets" } })), true);
  assert.equal(isDominantWin(match({ result: { winner: alpha, margin: "7 wickets" } })), false);
  assert.equal(isDominantWin(match({ result: { winner: alpha, margin: "40 runs" } })), true);
  assert.equal(isDominantWin(match({ result: { winner: alpha, margin: "39 runs" } })), false);
  assert.equal(resultMultiplierFor(match({ stage: "final", result: { winner: alpha, margin: "9 wickets" } }), beta), 0.6);
  assert.equal(resultMultiplierFor(match({ result: { winner: alpha, margin: "60 runs" } }), beta), 0.6);

  // The run threshold scales with the format: 60 runs is not dominant in 50
  // overs, but 100 is.
  assert.equal(
    isDominantWin({ totalOvers: 50, result: { winner: alpha, margin: "60 runs" } }),
    false,
  );
  assert.equal(
    isDominantWin({ totalOvers: 50, result: { winner: alpha, margin: "100 runs" } }),
    true,
  );

  // Ties, draws, no-results and abandoned matches are neutral for both sides.
  for (const resultType of ["tie", "draw", "no result", "abandoned"]) {
    assert.equal(resultMultiplierFor(match({ result: { resultType } }), alpha), 1);
    assert.equal(resultMultiplierFor(match({ result: { resultType } }), beta), 1);
  }
  // A team that was not in the match is not penalised.
  assert.equal(resultMultiplierFor(match({ stage: "final" }), team("t-gamma", "Gamma")), 1);
});

test("the same 50 runs score more in a win than a loss, and most in a final", () => {
  const alpha = team("t-alpha", "Alpha");
  const beta = team("t-beta", "Beta");
  const groupWinner = player("p-group-winner", "Group Winner");
  const groupLoser = player("p-group-loser", "Group Loser");
  const finalWinner = player("p-final-winner", "Final Winner");
  const finalLoser = player("p-final-loser", "Final Loser");
  const heavyLoser = player("p-heavy-loser", "Heavy Loser");
  const filler = player("p-filler", "Filler");

  const innings = (teamRef, batter, runs = 50) => ({
    team: teamRef,
    runs,
    wickets: 1,
    batting: [{ player: batter, runs, balls: 40, isOut: true }],
    bowling: [],
  });

  const impact = computeTournamentImpact({
    weights: plainWeights({
      result: IMPACT_WEIGHTS.result,
    }),
    matches: [
      {
        _id: "group-close",
        status: "completed",
        stage: "group",
        teams: [alpha, beta],
        result: { resultType: "normal", winner: alpha, margin: "5 runs" },
        innings: [
          innings(alpha, groupWinner),
          innings(beta, groupLoser),
        ],
      },
      {
        _id: "final-close",
        status: "completed",
        stage: "final",
        teams: [alpha, beta],
        result: { resultType: "normal", winner: alpha, margin: "5 runs" },
        innings: [
          innings(alpha, finalWinner),
          innings(beta, finalLoser),
        ],
      },
      {
        _id: "group-heavy",
        status: "completed",
        stage: "group",
        teams: [alpha, beta],
        result: { resultType: "normal", winner: alpha, margin: "80 runs" },
        innings: [
          innings(alpha, filler),
          innings(beta, heavyLoser),
        ],
      },
    ],
  });

  const impactOf = (id) => impact.rows.find((row) => row.playerId === id).impact;
  assert.equal(impactOf("p-group-winner"), 67.5, "50 x 1.35");
  assert.equal(impactOf("p-group-loser"), 42.5, "50 x 0.85");
  assert.equal(impactOf("p-final-winner"), 101.25, "50 x 1.35 x 1.50");
  assert.equal(impactOf("p-final-loser"), 42.5, "the final stage never boosts a loser");
  assert.equal(impactOf("p-heavy-loser"), 30, "50 x 0.60 after an 80-run defeat");
});

test("an unbeaten chase finish is worth more than the same runs when out", () => {
  const alpha = team("t-alpha", "Alpha");
  const beta = team("t-beta", "Beta");
  const finisher = player("p-finisher", "Finisher");
  const dismissed = player("p-dismissed", "Dismissed");

  const impact = computeTournamentImpact({
    weights: plainWeights({
      batting: {
        ...plainWeights().batting,
        teamRunShare: 20,
        notOut: 2,
        chaseFinish: 12,
      },
    }),
    matches: [
      {
        _id: "chase",
        status: "completed",
        teams: [alpha, beta],
        result: { resultType: "normal", winner: beta, description: "Beta won by 5 wickets" },
        innings: [
          {
            team: alpha,
            runs: 50,
            wickets: 5,
            batting: [
              { player: { _id: "p-alpha", name: "Alpha Batter" }, runs: 50, balls: 30, isOut: true },
            ],
            bowling: [],
          },
          {
            team: beta,
            runs: 50,
            wickets: 5,
            batting: [
              { player: finisher, runs: 30, balls: 20, isOut: false },
              { player: dismissed, runs: 10, balls: 10, isOut: true },
            ],
            bowling: [],
          },
        ],
      },
    ],
  });

  const finisherRow = impact.rows.find((row) => row.playerId === "p-finisher");
  const dismissedRow = impact.rows.find((row) => row.playerId === "p-dismissed");

  // 30 runs, no other weights: 12 team share + 2 not out + 12 chase finish.
  assert.equal(finisherRow.breakdown.teamShare, 12);
  assert.equal(finisherRow.breakdown.finishing, 14);
  assert.equal(finisherRow.impact, 56);
  // 10 runs from a 50 total: 4 team share, no finishing credit.
  assert.equal(dismissedRow.breakdown.teamShare, 4);
  assert.equal(dismissedRow.breakdown.finishing, 0);
  assert.equal(dismissedRow.impact, 14);
  assert.ok(finisherRow.rank < dismissedRow.rank);
});

test("an equal-run not-out innings is never scored below the dismissed innings", () => {
  const alpha = team("t-alpha", "Alpha");
  const beta = team("t-beta", "Beta");
  const notOut = player("p-not-out", "Not Out");
  const out = player("p-out", "Out");

  const impact = computeTournamentImpact({
    weights: plainWeights({
      batting: { ...plainWeights().batting, notOut: 2, chaseFinish: 12 },
    }),
    matches: [
      {
        _id: "same-runs",
        status: "completed",
        teams: [alpha, beta],
        innings: [
          {
            team: alpha,
            runs: 40,
            wickets: 1,
            batting: [
              { player: notOut, runs: 20, balls: 15, isOut: false },
              { player: out, runs: 20, balls: 15, isOut: true },
            ],
            bowling: [],
          },
          { team: beta, batting: [], bowling: [] },
        ],
      },
    ],
  });

  const notOutRow = impact.rows.find((row) => row.playerId === "p-not-out");
  const outRow = impact.rows.find((row) => row.playerId === "p-out");
  assert.equal(notOutRow.breakdown.finishing, 2);
  assert.equal(outRow.breakdown.finishing, 0);
  assert.ok(notOutRow.impact > outRow.impact);
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
  // Team share (75 of 75) +20, unbeaten finish +2 = 131. Winning side: x1.35 =
  // 176.85, plus the 20-point man-of-the-match award. An unknown stage is
  // neutral (x1.00).
  assert.equal(winningRow.breakdown.batting, 109);
  assert.equal(winningRow.breakdown.teamShare, 20);
  assert.equal(winningRow.breakdown.finishing, 2);
  assert.equal(winningRow.breakdown.winBonus, 45.85);
  assert.equal(winningRow.breakdown.manOfMatchBonus, 20);
  assert.equal(winningRow.impact, 196.85);

  // 100 + 6 + 4 + 32 + 2 for SR 153.85 = 144, plus a 20 team-share bonus = 164.
  // The losing side is discounted by the competitive-loss multiplier (x0.85),
  // so the win adjustment is negative, and there is no award bonus.
  assert.equal(losingRow.breakdown.teamShare, 20);
  assert.equal(losingRow.impact, 139.4);
  assert.equal(losingRow.breakdown.winBonus, -24.6);
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
  assert.equal(manualRow.breakdown.teamShare, 20, "two of the one recorded opposition wicket is capped at a full share");
  assert.equal(manualRow.impact, 70, "two wickets plus team share, no invisible catches");
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
  for (const needle of ["1 point per run", "25 points per wicket", "8 per catch", "1.35", "20 extra points", "16 for 50+", "Team share", "Finishing"]) {
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

  await Tournament.create({
    _id: tournamentId,
    name: "Impact Official Awards Cup",
    shortName: "IOAC",
    type: "knockout",
    startDate: new Date("2026-10-20"),
    endDate: new Date("2026-10-21"),
    teams: [alpha._id, beta._id],
    // The committee's pick deliberately differs from the computed leader below.
    officialAwards: {
      playerOfTournament: bowler._id,
      bestBatsman: star._id,
      bestBowler: bowler._id,
      note: "Chosen on presentation night",
    },
  });

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

  // Official awards ride along for presentation only. The computed leader is
  // still the impact leader; the organiser's pick never overwrites it.
  assert.equal(stats.officialAwards.playerOfTournament.name, "Impact Bowler");
  assert.equal(stats.officialAwards.bestBatsman.name, "Impact Star");
  assert.equal(stats.officialAwards.bestBowler.name, "Impact Bowler");
  assert.equal(stats.officialAwards.note, "Chosen on presentation night");
  assert.equal(stats.playerOfTournament.officialAward.name, "Impact Bowler");
  assert.equal(stats.playerOfTournament.leader.name, "Impact Star");
  assert.equal(stats.playerOfTournament.rows[0].name, "Impact Star");
});
