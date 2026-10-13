// ---------------------------------------------------------------------------
// Tournament hub screenshots
// ---------------------------------------------------------------------------
//
// Serves the built User app (Frontend/User/dist), intercepts every /api/...
// request with in-memory OPENCODE_TEST_ fixtures, and captures the five
// sidebar tabs (Home, Fixtures, Table, Stats, Teams) at 360x640 and 1280x800.
//
// No backend, no database: the hub only ever talks to these intercepted
// endpoints, so the screenshots exercise the real UI with deterministic data.
// Drives the system-installed Edge through playwright-core (no browser
// download).
//
//   node scripts/screenshot-tournament-hub.mjs
//
// Output: docs/screenshots/tournament-hub/<tab>-<width>x<height>.png

import http from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "../Frontend/User/dist");
const OUT = path.resolve(__dirname, "../docs/screenshots/tournament-hub");
const PORT = Number(process.env.SCREENSHOT_PORT || 4321);

// Reserved-name prefix so these fixtures are unmistakably test data.
const P = "OPENCODE_TEST_";
const TOURNAMENT_ID = "a".repeat(24);

const team = (id, name, shortName) => ({ _id: id, name: `${P}${name}`, shortName });
const t1 = team("t1".padEnd(24, "1"), "Alpha", "ALP");
const t2 = team("t2".padEnd(24, "2"), "Beta", "BET");
const t3 = team("t3".padEnd(24, "3"), "Gamma", "GAM");
const t4 = team("t4".padEnd(24, "4"), "Delta", "DEL");

const tournament = {
  _id: TOURNAMENT_ID,
  name: `${P}Cup`,
  shortName: "OTC",
  type: "league",
  format: "T20",
  status: "live",
  venue: "Test Oval",
  startDate: "2026-01-01T00:00:00.000Z",
  endDate: "2026-02-01T00:00:00.000Z",
  logo: "",
  teams: [t1, t2, t3, t4],
  matches: [
    { _id: "m1", status: "live", matchNumber: 1, venue: "Test Oval", group: "Group A", startAt: "2026-01-03T09:00:00.000Z", teams: [t1, t2], innings: [{ team: t1, runs: 142, wickets: 5, balls: 96 }, { team: t2, runs: 98, wickets: 3, balls: 72 }] },
    { _id: "m2", status: "completed", matchNumber: 2, venue: "Test Oval", group: "Group A", startAt: "2026-01-02T09:00:00.000Z", teams: [t3, t4], result: { description: `${P}Gamma won by 20 runs` } },
    { _id: "m3", status: "completed", matchNumber: 3, venue: "Test Oval", group: "Group B", startAt: "2026-01-01T09:00:00.000Z", teams: [t1, t3], result: { description: `${P}Alpha won by 5 wickets` } },
    { _id: "m4", status: "scheduled", matchNumber: 4, venue: "Test Oval", group: "Group B", startAt: "2026-01-05T09:00:00.000Z", teams: [t2, t4] },
  ],
};

const content = {
  tournamentId: TOURNAMENT_ID,
  overview: { bannerImage: "", shortDescription: `${P}short description for the hub`, city: "Testville", venue: "Test Oval", format: "T20", status: "live" },
  visibility: { photos: true, videos: true, articles: true, stats: true, table: true, teams: true },
  thresholds: { minBallsFaced: 30, minOvers: 5 },
  counts: { photos: 2, videos: 1, articles: 1 },
};

const standings = {
  tournamentId: TOURNAMENT_ID,
  hasStandings: true,
  rows: [t1, t2, t3, t4].map((t, i) => ({
    team: t,
    matchesPlayed: 3 - i,
    won: 3 - i,
    lost: i,
    tied: 0,
    noResult: 0,
    points: (3 - i) * 2,
    netRunRate: 1.2 - i * 0.4,
    form: ["W", "W", "L"].slice(0, 3 - (i % 2)),
    next: null,
  })),
};

const player = (id, name) => ({ playerId: id, name: `${P}${name}`, team: `${P}Alpha` });

const stats = {
  empty: false,
  boundaryMeter: { sixes: 14, fours: 32, mostSixes: [{ playerId: "p1", name: `${P}Ravi`, count: 4 }], mostFours: [{ playerId: "p2", name: `${P}Sam`, count: 7 }] },
  topRunScorers: [
    { ...player("p1", "Ravi"), innings: 3, notOuts: 1, runs: 210, highestText: "88*", average: 105, strikeRate: 148.2, fifties: 2, hundreds: 0, fours: 20, sixes: 9 },
    { ...player("p2", "Sam"), innings: 3, notOuts: 0, runs: 175, highestText: "70", average: 58.3, strikeRate: 130.1, fifties: 1, hundreds: 0, fours: 15, sixes: 6 },
  ],
  topWicketTakers: [
    { ...player("p3", "Kiran"), innings: 3, oversText: "12.0", wickets: 9, bestFigures: "4/18", average: 12.4, economy: 6.1, fourWickets: 1, fiveWickets: 0 },
    { ...player("p4", "Dev"), innings: 3, oversText: "11.3", wickets: 7, bestFigures: "3/22", average: 15.2, economy: 7.0, fourWickets: 0, fiveWickets: 0 },
  ],
  topFielders: [
    { ...player("p5", "Noor"), matches: 3, catches: 5, stumpings: 0, runOuts: 1, total: 6 },
  ],
  highestScores: [{ playerId: "p1", name: `${P}Ravi`, runs: 88, notOut: true, balls: 54, fours: 9, sixes: 4 }],
  bestBowling: [{ playerId: "p3", name: `${P}Kiran`, figures: "4/18", runs: 18, balls: 24 }],
  bestStrikeRates: [{ playerId: "p1", name: `${P}Ravi`, strikeRate: 148.2, runs: 210, balls: 142 }],
  bestEconomy: [{ playerId: "p3", name: `${P}Kiran`, economy: 6.1, oversText: "12.0", wickets: 9 }],
};

const photos = [
  { _id: "ph1", kind: "photo", url: "https://placehold.co/600x600/031d44/ffffff?text=OPENCODE_TEST_Photo", caption: `${P}Trophy lift`, sortOrder: 1 },
  { _id: "ph2", kind: "photo", url: "https://placehold.co/600x600/0f766e/ffffff?text=OPENCODE_TEST_Photo", caption: `${P}Final over`, sortOrder: 2 },
];
const videos = [{ _id: "v1", kind: "video", provider: "youtube", videoId: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", caption: `${P}Highlights`, sortOrder: 1 }];
const articles = [{ _id: "ar1", slug: "opencode-test-preview", title: `${P}Season Preview`, excerpt: `${P}excerpt`, coverImage: "", publishedAt: "2026-01-02T00:00:00.000Z" }];

function json(route, body) {
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

function apiResponse(pathname) {
  if (pathname.includes("/articles/")) return { article: { _id: "ar1", slug: "opencode-test-preview", title: `${P}Season Preview`, body: `${P}article body`, publishedAt: "2026-01-02T00:00:00.000Z" } };
  if (pathname.endsWith("/articles")) return { items: articles, total: articles.length, page: 1, pages: 1 };
  if (pathname.endsWith("/photos")) return { items: photos, total: photos.length, page: 1, pages: 1 };
  if (pathname.endsWith("/videos")) return { items: videos, total: videos.length, page: 1, pages: 1 };
  if (pathname.endsWith("/content")) return content;
  if (pathname.endsWith("/standings")) return standings;
  if (pathname.endsWith("/stats")) return stats;
  if (pathname.endsWith("/squad")) return [];
  if (pathname.endsWith("/fixtures")) return tournament.matches;
  if (/\/tournaments\/[a-f0-9]{24}$/i.test(pathname)) return tournament;
  return {};
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const file = path.join(DIST, rel);
      if (file.startsWith(DIST)) {
        try {
          const data = await readFile(file);
          res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
          res.end(data);
          return;
        } catch {
          // fall through to SPA index
        }
      }
      const html = await readFile(path.join(DIST, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

const TABS = [
  { key: "home", path: "" },
  { key: "fixtures", path: "/fixtures" },
  { key: "table", path: "/table" },
  { key: "stats", path: "/stats" },
  { key: "teams", path: "/teams" },
];
const VIEWPORTS = [
  { width: 360, height: 640 },
  { width: 1280, height: 800 },
];

async function main() {
  const server = await startServer();
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({ channel: "msedge" });
  const written = [];

  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ viewport, serviceWorkers: "block" });
      const page = await context.newPage();
      await page.route("**/api/**", (route) => json(route, apiResponse(new URL(route.request().url()).pathname)));
      await page.route("**/socket.io/**", (route) =>
        route.fulfill({ status: 200, contentType: "text/plain", body: "" }),
      );

      for (const tab of TABS) {
        await page.goto(`http://localhost:${PORT}/series/${TOURNAMENT_ID}${tab.path}`, { waitUntil: "domcontentloaded" });
        try {
          await page.waitForSelector("h1", { timeout: 15000 });
        } catch (error) {
          console.error(`h1 wait failed for ${tab.key}; body text follows:`);
          console.error((await page.locator("body").innerText()).slice(0, 1000));
          throw error;
        }
        // Wait for tab-specific content so the screenshot is never mid-load.
        const ready = {
          home: "text=Total Matches",
          fixtures: 'input[aria-label="Search fixtures"]',
          table: "text=NRR",
          stats: "text=Most Runs",
          teams: "text=Team Squads",
        }[tab.key];
        await page.waitForSelector(ready, { timeout: 15000 });
        await page.waitForTimeout(600);
        const file = path.join(OUT, `${tab.key}-${viewport.width}x${viewport.height}.png`);
        await page.screenshot({ path: file, fullPage: true });
        written.push(path.relative(path.resolve(__dirname, ".."), file));
        console.log(`shot ${tab.key} @ ${viewport.width}x${viewport.height}`);
      }

      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${written.length} screenshot(s) written to docs/screenshots/tournament-hub/`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
