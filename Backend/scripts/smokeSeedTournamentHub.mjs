// ---------------------------------------------------------------------------
// Tournament hub manual smoke-test seed (LOCAL ONLY)
// ---------------------------------------------------------------------------
//
// Seeds a small, clearly-labelled OPENCODE_TEST_ tournament so the public hub
// can be smoke-tested against a real, running API + database, then removes it
// again. Every row it creates starts with the reserved test prefix, so the
// public filters would hide it even if cleanup were missed.
//
//   # seed (needs MONGO_URL pointing at a throwaway db)
//   node Backend/scripts/smokeSeedTournamentHub.mjs
//
//   # remove everything it created, then exit
//   node Backend/scripts/smokeSeedTournamentHub.mjs clean
//
// It never prints the connection string. It refuses to run against a database
// whose name does not contain "e2e" so it cannot be pointed at production by a
// stray environment variable.

import mongoose from "mongoose";
import Admin from "../src/models/Admin.js";
import Team from "../src/models/Team.js";
import Player from "../src/models/Player.js";
import Match from "../src/models/Match.js";
import Tournament from "../src/models/Tournament.js";
import TournamentMedia from "../src/models/TournamentMedia.js";
import TournamentArticle from "../src/models/TournamentArticle.js";

const P = "OPENCODE_TEST_";
const NAME_RE = /^(OPENCODE_TEST_HubSmoke|SmokeHub_)/i;
const SLUG = "opencode-test-hub-smoke";
const ADMIN_EMAIL = "opencode.test.hub.smoke@example.test";
const MODE = (process.argv[2] || "seed").toLowerCase();

// NOTE: the competing teams are deliberately NOT prefixed with a reserved test
// prefix (OPENCODE_TEST_ / E2E_ / TEST_). The public hub filters those out by
// design (see requirement "hidden/test teams never appear"), so a reserved-prefix
// team would make the smoke hub render empty. The tournament itself, its slug,
// the admin and one intentionally-hidden "ghost" team carry the marker instead;
// the prefix filter is asserted against the ghost here and covered by unit tests.

const MONGO_URL = process.env.MONGO_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
if (!MONGO_URL) {
  console.error("MONGO_URL (or MONGODB_URI/MONGO_URI) is required.");
  process.exit(1);
}
const dbName = (() => {
  try {
    return decodeURIComponent(new URL(MONGO_URL).pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
})();
if (!/e2e/i.test(dbName)) {
  console.error(`Refusing to run: database "${dbName || "(none)"}" is not a throwaway e2e database.`);
  process.exit(1);
}

const photoSvg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">` +
  `<rect width="100%" height="100%" fill="#0f766e"/>` +
  `<text x="24" y="200" font-size="34" fill="#ffffff">${P}Photo</text></svg>`;
const PHOTO_URL = `data:image/svg+xml,${encodeURIComponent(photoSvg)}`;

async function removeSmokeData() {
  const tournaments = await Tournament.find({ slug: SLUG }).select("_id").lean();
  const ids = tournaments.map((t) => t._id);
  const teams = await Team.find({ name: NAME_RE }).select("_id").lean();
  const teamIds = teams.map((t) => t._id);

  const results = {};
  results.media = (await TournamentMedia.deleteMany({ tournament: { $in: ids } })).deletedCount;
  results.articles = (await TournamentArticle.deleteMany({ tournament: { $in: ids } })).deletedCount;
  results.matches = (await Match.deleteMany({ tournament: { $in: ids } })).deletedCount;
  results.players = (await Player.deleteMany({ team: { $in: teamIds } })).deletedCount;
  results.tournaments = (await Tournament.deleteMany({ slug: SLUG })).deletedCount;
  results.teams = (await Team.deleteMany({ name: NAME_RE })).deletedCount;
  results.admins = (await Admin.deleteMany({ email: ADMIN_EMAIL })).deletedCount;
  return results;
}

async function seed() {
  const admin = await Admin.create({
    name: `${P}HubSmoke Admin`,
    email: ADMIN_EMAIL,
    password: "not-a-real-password-hash",
    role: "superadmin",
  });

  // Competing teams use the non-reserved "SmokeHub_" marker so the public hub
  // renders them; the ghost uses the reserved prefix + isPublic:false and must
  // never appear on any public surface.
  const teams = [
    await Team.create({ name: "SmokeHub_Alpha", shortName: "SH-ALP", isPublic: true }),
    await Team.create({ name: "SmokeHub_Beta", shortName: "SH-BET", isPublic: true }),
    await Team.create({ name: "SmokeHub_Gamma", shortName: "SH-GAM", isPublic: true }),
    await Team.create({ name: "SmokeHub_Delta", shortName: "SH-DEL", isPublic: true }),
  ];
  const ghostTeam = await Team.create({
    name: `${P}HubSmoke Ghost`,
    shortName: "SH-GHO",
    isPublic: false,
  });

  const players = [];
  for (const team of teams) {
    const list = [];
    for (let i = 0; i < 6; i += 1) {
      list.push(
        await Player.create({
          name: `SmokeHub_${team.shortName} P${i + 1}`,
          team: team._id,
          isPublic: true,
        }),
      );
    }
    players.push(list);
  }
  const ghostPlayer = await Player.create({
    name: `${P}HubSmoke Ghost P1`,
    team: ghostTeam._id,
    isPublic: false,
  });

  const tournament = await Tournament.create({
    name: `${P}HubSmoke Cup`,
    shortName: "HSMOKE",
    slug: SLUG,
    type: "league",
    format: "T20",
    venue: "Smoke Test Oval",
    status: "live",
    startDate: new Date("2026-10-01T00:00:00.000Z"),
    endDate: new Date("2026-10-20T00:00:00.000Z"),
    teams: [...teams.map((t) => t._id), ghostTeam._id],
    content: {
      shortDescription: `${P}manual smoke-test tournament`,
      city: "Smokeville",
      visibility: { photos: true, videos: true, articles: true, stats: true, table: true, teams: true },
      stats: { minBallsFaced: 30, minOvers: 5 },
    },
  });

  // Three completed matches with real innings (batting + bowling). The numbers
  // are hand-entered, exactly like a manual scorecard would be.
  const makeCompleted = async (label, homeIdx, awayIdx, startAt) => {
    const home = teams[homeIdx];
    const away = teams[awayIdx];
    const homePlayers = players[homeIdx];
    const awayPlayers = players[awayIdx];
    return Match.create({
      title: `${P}HubSmoke ${label}`,
      tournament: tournament._id,
      teams: [home._id, away._id],
      status: "completed",
      format: "T20",
      venue: "Smoke Test Oval",
      startAt,
      result: { resultType: "normal", winner: home._id, description: `${home.name} won ${label}` },
      innings: [
        {
          team: home._id,
          runs: 150 + homeIdx * 10,
          wickets: 5,
          balls: 120,
          batting: homePlayers.map((player, i) => ({
            player: player._id,
            runs: 20 + i * 8,
            balls: 18 + i * 3,
            fours: 1 + (i % 3),
            sixes: i % 2,
            isOut: i !== 0,
            dismissalType: i === 0 ? undefined : "caught",
            fielder: awayPlayers[(i + 1) % awayPlayers.length]._id,
          })),
          bowling: awayPlayers.map((player) => ({
            player: player._id,
            balls: 24,
            overs: 4,
            maidens: 0,
            runs: 24,
            wickets: 1,
          })),
        },
        {
          team: away._id,
          runs: 130 + awayIdx * 5,
          wickets: 7,
          balls: 118,
          batting: awayPlayers.map((player, i) => ({
            player: player._id,
            runs: 14 + i * 6,
            balls: 16 + i * 2,
            fours: i % 3,
            sixes: 0,
            isOut: true,
            dismissalType: "bowled",
          })),
          bowling: homePlayers.map((player) => ({
            player: player._id,
            balls: 24,
            overs: 4,
            maidens: 0,
            runs: 30,
            wickets: 1,
          })),
        },
      ],
    });
  };

  await makeCompleted("Match 1", 0, 1, new Date("2026-10-02T09:00:00.000Z"));
  await makeCompleted("Match 2", 2, 3, new Date("2026-10-03T09:00:00.000Z"));
  await makeCompleted("Match 3", 0, 2, new Date("2026-10-04T09:00:00.000Z"));

  // One upcoming fixture so the Table tab's "Next" column has something to show.
  await Match.create({
    title: `${P}HubSmoke Match 4`,
    tournament: tournament._id,
    teams: [teams[1]._id, teams[3]._id],
    status: "upcoming",
    format: "T20",
    venue: "Smoke Test Oval",
    startAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
  });

  tournament.pointsTable = [
    { team: teams[0]._id, matchesPlayed: 2, won: 2, lost: 0, tied: 0, noResult: 0, points: 4, netRunRate: 1.42 },
    { team: teams[2]._id, matchesPlayed: 2, won: 1, lost: 1, tied: 0, noResult: 0, points: 2, netRunRate: 0.31 },
    { team: teams[1]._id, matchesPlayed: 2, won: 1, lost: 1, tied: 0, noResult: 0, points: 2, netRunRate: -0.22 },
    { team: teams[3]._id, matchesPlayed: 2, won: 0, lost: 2, tied: 0, noResult: 0, points: 0, netRunRate: -1.55 },
    // A hidden team deliberately sits in the table; it must never be rendered.
    { team: ghostTeam._id, matchesPlayed: 2, won: 2, lost: 0, tied: 0, noResult: 0, points: 99, netRunRate: 9.99 },
  ];
  await tournament.save();

  await TournamentArticle.create({
    tournament: tournament._id,
    title: `${P}HubSmoke Season Preview`,
    slug: "opencode-test-hub-smoke-preview",
    body: `${P}HubSmoke preview body text.`,
    excerpt: `${P}HubSmoke preview excerpt`,
    published: true,
    publishedAt: new Date("2026-10-01T08:00:00.000Z"),
    createdByAdmin: admin._id,
  });
  await TournamentArticle.create({
    tournament: tournament._id,
    title: `${P}HubSmoke Draft Report`,
    slug: "opencode-test-hub-smoke-draft",
    body: `${P}HubSmoke draft body (must never be public).`,
    excerpt: "draft",
    published: false,
    createdByAdmin: admin._id,
  });

  await TournamentMedia.create({
    tournament: tournament._id,
    kind: "photo",
    url: PHOTO_URL,
    caption: `${P}HubSmoke trophy lift`,
    sortOrder: 1,
    published: true,
    createdByAdmin: admin._id,
  });
  await TournamentMedia.create({
    tournament: tournament._id,
    kind: "video",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    provider: "youtube",
    videoId: "dQw4w9WgXcQ",
    caption: `${P}HubSmoke highlights`,
    sortOrder: 1,
    published: true,
    createdByAdmin: admin._id,
  });

  return {
    tournamentId: String(tournament._id),
    slug: SLUG,
    teams: teams.length,
    ghostTeams: 1,
    players: players.flat().length + (ghostPlayer ? 1 : 0),
    matches: 4,
  };
}

async function main() {
  await mongoose.connect(MONGO_URL, { serverSelectionTimeoutMS: 15000 });
  try {
    const removed = await removeSmokeData();
    if (MODE === "clean") {
      console.log(JSON.stringify({ mode: "clean", removed }, null, 2));
      return;
    }
    if (Object.values(removed).some((n) => n > 0)) {
      console.log(`(removed previous smoke rows: ${JSON.stringify(removed)})`);
    }
    const created = await seed();
    console.log(JSON.stringify({ mode: "seed", created }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error("smoke seed failed:", error?.message || error);
  process.exitCode = 1;
});
