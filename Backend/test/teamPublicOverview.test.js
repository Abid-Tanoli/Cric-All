// PR 7 — public team page overview blocks.
//
// What this suite pins down:
//   * `GET /teams/:id` now carries upcoming fixtures (dated first, TBD last, at
//     most five), the live fixture, and the ten most recent results;
//   * each card carries the result sentence and both innings scores, and nothing
//     from the scorer's working copy (commentary, playing XI, draft scorecards);
//   * a private team is unreadable by id and a fixture against a hidden team is
//     never leaked on a visible team's page;
//   * the top-performers block, with data and without any completed match;
//   * the new `privacy.media` flag, default on, blanking the gallery and videos.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";

import { startTestDb, stopTestDb } from "./helpers/testDb.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import Match from "../src/models/Match.js";
import { getTeamProfile, buildTopPerformers } from "../src/services/teamService.js";
import { sanitizeTeamPublic } from "../src/utils/publicProjection.js";

let mongod;

before(async () => {
  mongod = await startTestDb();
});

after(async () => {
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Promise.all([Team.deleteMany({}), Player.deleteMany({}), Match.deleteMany({})]);
});

let counter = 0;

async function makeTeam(overrides = {}) {
  counter += 1;
  return Team.create({ name: `Overview Team ${counter}`, ...overrides });
}

async function makePlayer(team, stats = {}, extra = {}) {
  counter += 1;
  const player = await Player.create({
    name: `Overview Player ${counter}`,
    team: team._id,
    stats,
    ...extra,
  });
  await Team.updateOne({ _id: team._id }, { $addToSet: { players: player._id } });
  return player;
}

async function makeMatch(home, away, overrides = {}) {
  return Match.create({
    title: `${home.name} vs ${away.name}`,
    teams: [home._id, away._id],
    status: "upcoming",
    startAt: new Date("2026-07-01T10:00:00.000Z"),
    venue: "Model Town Ground",
    ...overrides,
  });
}

const idOf = (value) => String(value?._id || value);

// ---------------------------------------------------------------------------
// Upcoming / live / recent
// ---------------------------------------------------------------------------

test("upcoming fixtures come back dated first in ascending order, undated ones last", async () => {
  const team = await makeTeam();
  const rival = await makeTeam();

  const later = await makeMatch(team, rival, { startAt: new Date("2026-06-03T10:00:00.000Z") });
  const sooner = await makeMatch(team, rival, { startAt: new Date("2026-06-01T10:00:00.000Z") });
  const tbd = await makeMatch(team, rival, { startAt: null });

  const profile = await getTeamProfile(String(team._id), null);
  const ids = profile.upcomingMatches.map((match) => String(match._id));

  assert.deepStrictEqual(ids, [String(sooner._id), String(later._id), String(tbd._id)]);
  assert.ok(profile.upcomingMatches.every((match) => match.status === "upcoming"));
});

test("the upcoming block is capped at five fixtures and the recent block at ten results", async () => {
  const team = await makeTeam();
  const rival = await makeTeam();

  for (let i = 0; i < 6; i += 1) {
    await makeMatch(team, rival, { startAt: new Date(Date.UTC(2026, 5, 1 + i, 10)) });
  }
  for (let i = 0; i < 12; i += 1) {
    await makeMatch(team, rival, {
      status: "completed",
      startAt: new Date(Date.UTC(2026, 0, 1 + i, 10)),
      innings: [
        { team: team._id, runs: 100 + i, wickets: 5, overs: 20 },
        { team: rival._id, runs: 90 + i, wickets: 7, overs: 20 },
      ],
      result: { winner: team._id, description: `Result ${i}` },
    });
  }

  const profile = await getTeamProfile(String(team._id), null);

  assert.equal(profile.upcomingMatches.length, 5);
  assert.equal(profile.recentMatches.length, 10);
  // Newest first: the 12th completed match (index 11) is the one on top.
  assert.equal(profile.recentMatches[0].result.description, "Result 11");
});

test("a live fixture is returned in the live block and a completed one is not", async () => {
  const team = await makeTeam();
  const rival = await makeTeam();

  const live = await makeMatch(team, rival, { status: "live" });
  await makeMatch(team, rival, {
    status: "completed",
    innings: [{ team: team._id, runs: 120, wickets: 4, overs: 18 }],
  });

  const profile = await getTeamProfile(String(team._id), null);

  assert.deepStrictEqual(
    profile.liveMatches.map((match) => String(match._id)),
    [String(live._id)],
  );
  assert.equal(profile.recentMatches.length, 1);
});

test("each card carries the result sentence and both innings scores, and no scorer working data", async () => {
  const team = await makeTeam();
  const rival = await makeTeam();

  await makeMatch(team, rival, {
    status: "completed",
    innings: [
      { team: team._id, runs: 154, wickets: 6, overs: 20 },
      { team: rival._id, runs: 150, wickets: 8, overs: 20 },
    ],
    result: { winner: team._id, description: `${team.name} won by 4 runs`, resultType: "normal" },
    resultText: "Won by 4 runs",
    commentary: { secret: "internal" },
    playingXI: [{ team: team._id, players: [] }],
    assignedScorers: [],
  });

  const profile = await getTeamProfile(String(team._id), null);
  const card = profile.recentMatches[0].toObject();

  assert.equal(card.result.description, `${team.name} won by 4 runs`);
  assert.equal(String(card.result.winner), String(team._id));
  assert.equal(card.resultText, "Won by 4 runs");
  assert.equal(card.venue, "Model Town Ground");
  assert.equal(card.innings.length, 2);
  assert.equal(card.innings.find((inn) => idOf(inn.team) === String(team._id)).runs, 154);
  assert.equal(card.innings.find((inn) => idOf(inn.team) === String(rival._id)).runs, 150);

  // The scorer's working copy is not part of a public card.
  assert.ok(!("commentary" in card), "commentary must not reach a public card");
  assert.ok(!("playingXI" in card), "the playing XI is not part of a card");
  assert.ok(!("assignedScorers" in card), "assigned scorers are not public");
});

test("a draft scorecard never appears on the public team page", async () => {
  const team = await makeTeam();
  const rival = await makeTeam();

  await makeMatch(team, rival, { status: "completed", manualDraft: true });
  const published = await makeMatch(team, rival, { status: "completed" });

  const profile = await getTeamProfile(String(team._id), null);

  assert.deepStrictEqual(
    profile.recentMatches.map((match) => String(match._id)),
    [String(published._id)],
  );
});

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

test("a private team is not readable by id for a public caller", async () => {
  const hidden = await makeTeam({ isPublic: false });
  await makeMatch(hidden, await makeTeam(), { status: "completed" });

  const profile = await getTeamProfile(String(hidden._id), null);

  assert.equal(profile, null);
});

test("a fixture against a hidden team is not leaked on a visible team's page", async () => {
  const team = await makeTeam();
  const visibleRival = await makeTeam();
  const hiddenRival = await makeTeam({ isPublic: false });

  const clean = await makeMatch(team, visibleRival, { status: "completed" });
  await makeMatch(team, hiddenRival, { status: "completed" });
  await makeMatch(team, hiddenRival, { status: "upcoming" });

  const profile = await getTeamProfile(String(team._id), null);

  assert.deepStrictEqual(
    profile.recentMatches.map((match) => String(match._id)),
    [String(clean._id)],
  );
  assert.equal(profile.upcomingMatches.length, 0);
  assert.equal(profile.liveMatches.length, 0);
});

// ---------------------------------------------------------------------------
// Top performers
// ---------------------------------------------------------------------------

test("top performers name a run scorer, a wicket taker, a strike-rate leader and five best players", async () => {
  const team = await makeTeam();
  const outsiderTeam = await makeTeam();

  const batter = await makePlayer(team, {
    runs: 320,
    wickets: 1,
    matches: 6,
    strikeRate: 118,
  });
  const bowler = await makePlayer(team, { runs: 90, wickets: 14, matches: 6, strikeRate: 80 });
  // One big innings: real, but not eligible for the strike-rate card.
  const cameo = await makePlayer(team, { runs: 40, wickets: 0, matches: 1, strikeRate: 220 });
  const filler = [];
  for (let i = 0; i < 4; i += 1) {
    filler.push(await makePlayer(team, { runs: 10 + i, wickets: 0, matches: 4 }));
  }
  // Another team's player must never appear, whatever their numbers.
  await makePlayer(outsiderTeam, { runs: 999, wickets: 40, matches: 10, strikeRate: 200 });

  const profile = await getTeamProfile(String(team._id), null);
  const block = profile.topPerformers;

  assert.equal(String(block.topRunScorer._id), String(batter._id));
  assert.equal(block.topRunScorer.runs, 320);
  assert.equal(String(block.topWicketTaker._id), String(bowler._id));
  assert.equal(block.topWicketTaker.wickets, 14);
  assert.equal(String(block.bestStrikeRate._id), String(batter._id));
  assert.notEqual(String(block.bestStrikeRate._id), String(cameo._id));
  assert.equal(block.bestStrikeRateMinMatches, 3);

  assert.equal(block.bestPlayers.length, 5);
  const ids = block.bestPlayers.map((player) => String(player._id));
  assert.ok(ids.includes(String(batter._id)));
  assert.ok(ids.includes(String(bowler._id)));
  const ratings = block.bestPlayers.map((player) => player.rating);
  assert.deepStrictEqual(ratings, [...ratings].sort((a, b) => b - a));
  // Compact performer rows: enough to render a card and a link, not a profile.
  assert.deepStrictEqual(
    Object.keys(block.bestPlayers[0]).sort(),
    [
      "_id",
      "average",
      "imageUrl",
      "jerseyNumber",
      "matches",
      "name",
      "playingRole",
      "rating",
      "runs",
      "strikeRate",
      "wickets",
    ],
  );
});

test("a team with no completed match returns an empty top-performers block, not an error", async () => {
  const team = await makeTeam();
  await makePlayer(team, { runs: 0, wickets: 0, matches: 0 });
  await makePlayer(team, { runs: 0, wickets: 0, matches: 0 });

  const profile = await getTeamProfile(String(team._id), null);
  const block = profile.topPerformers;

  assert.equal(block.topRunScorer, null);
  assert.equal(block.topWicketTaker, null);
  assert.equal(block.bestStrikeRate, null);
  assert.deepStrictEqual(block.bestPlayers, []);
  assert.deepStrictEqual(profile.recentMatches, []);
});

test("buildTopPerformers is pure: empty input, and a min-matches rule a short season can meet", () => {
  assert.deepStrictEqual(buildTopPerformers([]), {
    topRunScorer: null,
    topWicketTaker: null,
    bestStrikeRate: null,
    bestStrikeRateMinMatches: 3,
    bestPlayers: [],
  });
  assert.deepStrictEqual(buildTopPerformers(undefined).bestPlayers, []);

  // Only two matches played: the threshold follows the team down to two, so the
  // player who played both can still lead on strike rate.
  const block = buildTopPerformers([
    { player: { _id: "p1", name: "Two Matches" }, teamMatches: 2, teamRuns: 50, teamBattingSr: 140 },
    { player: { _id: "p2", name: "One Match" }, teamMatches: 1, teamRuns: 40, teamBattingSr: 200 },
  ]);
  assert.equal(block.bestStrikeRateMinMatches, 2);
  assert.equal(block.bestStrikeRate._id, "p1");
});

// ---------------------------------------------------------------------------
// Media privacy flag
// ---------------------------------------------------------------------------

test("team media privacy: hidden blanks gallery and videos, the default keeps them", async () => {
  const hidden = await Team.create({
    name: `Media Hidden ${(counter += 1)}`,
    media: [{ url: "http://x/g1.jpg", caption: "photo" }],
    videos: [{ url: "http://x/v1.mp4", title: "clip" }],
    privacy: { media: "hidden" },
  });
  const hiddenBody = sanitizeTeamPublic(hidden.toObject(), {});

  assert.deepStrictEqual(hiddenBody.media, []);
  assert.deepStrictEqual(hiddenBody.videos, []);
  assert.ok("media" in hiddenBody && "videos" in hiddenBody, "the keys stay, blanked");

  const shown = await Team.create({
    name: `Media Shown ${(counter += 1)}`,
    media: [{ url: "http://x/g2.jpg", caption: "photo" }],
    videos: [{ url: "http://x/v2.mp4", title: "clip" }],
  });
  const shownBody = sanitizeTeamPublic(shown.toObject(), {});

  assert.equal(shownBody.privacy.media, "public", "the flag defaults to visible");
  assert.equal(shownBody.media.length, 1);
  assert.equal(shownBody.videos.length, 1);
});
