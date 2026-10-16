// ---------------------------------------------------------------------------
// Tournament hub MANUAL SMOKE TEST (real API + real database)
// ---------------------------------------------------------------------------
//
// Unlike scripts/screenshot-tournament-hub.mjs (which intercepts the API with
// in-memory fixtures), this drives the built User app against a LIVE local API
// and shows REAL rows seeded by
// Backend/scripts/smokeSeedTournamentHub.mjs.
//
// It serves Frontend/User/dist on :4321 and reverse-proxies /api, /socket.io
// and /uploads to the local API on :5000, so the app talks same-origin and no
// CORS setup is needed. PWA service workers are blocked so they cannot cache a
// stale shell over the proxy.
//
// It walks every hub tab plus the legacy /series/<id> URL, asserts the expected
// content (and that the draft article and the hidden ghost team are absent),
// then writes four 360x640 screenshots (Home, Fixtures, Table, Stats).
//
//   node scripts/smoke-tournament-hub.mjs <tournamentId> [slug]
//
// Env:
//   SMOKE_API   backend origin (default http://127.0.0.1:5000)
//   SMOKE_PORT  static/proxy port (default 4321)

import http from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "../Frontend/User/dist");
const OUT = path.resolve(__dirname, "../docs/screenshots/tournament-hub-smoke");
const PORT = Number(process.env.SMOKE_PORT || 4321);
const API = process.env.SMOKE_API || "http://127.0.0.1:5000";
const TOURNAMENT_ID = process.argv[2];
const SLUG = process.argv[3] || "opencode-test-hub-smoke";

if (!TOURNAMENT_ID) {
  console.error("usage: node scripts/smoke-tournament-hub.mjs <tournamentId> [slug]");
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

function proxy(req, res) {
  const target = new URL(req.url, API);
  const proxied = http.request(
    target,
    { method: req.method, headers: { ...req.headers, host: target.host } },
    (upstream) => {
      res.writeHead(upstream.statusCode || 502, upstream.headers);
      upstream.pipe(res);
    },
  );
  proxied.on("error", (error) => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: `proxy error: ${error.message}` }));
  });
  req.pipe(proxied);
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);

    if (pathname.startsWith("/api") || pathname.startsWith("/socket.io") || pathname.startsWith("/uploads")) {
      return proxy(req, res);
    }

    try {
      const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const file = path.join(DIST, rel);
      if (file.startsWith(DIST)) {
        try {
          const data = await readFile(file);
          res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
          res.end(data);
          return;
        } catch {
          // fall through to the SPA shell
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

const checks = [
  { name: "home", url: `/series/${TOURNAMENT_ID}`, ready: "text=Total Matches", expect: ["SmokeHub_Alpha", "SmokeHub_Beta"] },
  { name: "fixtures", url: `/series/${TOURNAMENT_ID}/fixtures`, ready: 'input[aria-label="Search fixtures"]', expect: ["SmokeHub_Alpha", "SmokeHub_Gamma"] },
  { name: "table", url: `/series/${TOURNAMENT_ID}/table`, ready: "text=NRR", expect: ["SmokeHub_Alpha", "SmokeHub_Delta"] },
  { name: "stats", url: `/series/${TOURNAMENT_ID}/stats`, ready: "text=Most Runs", expect: ["SmokeHub_SH-ALP"] },
  { name: "teams", url: `/series/${TOURNAMENT_ID}/teams`, ready: "text=Team Squads", expect: ["SmokeHub_Alpha", "SmokeHub_Delta"] },
  { name: "photos", url: `/series/${TOURNAMENT_ID}/photos`, ready: "text=HubSmoke trophy lift", expect: [] },
  {
    name: "videos",
    url: `/series/${TOURNAMENT_ID}/videos`,
    ready: 'iframe[title*="HubSmoke highlights"]',
    expect: [],
  },
  { name: "articles", url: `/series/${TOURNAMENT_ID}/articles`, ready: "text=Season Preview", expect: [] },
  {
    name: "article-detail",
    url: `/series/${TOURNAMENT_ID}/articles/opencode-test-hub-smoke-preview`,
    ready: "text=preview body text",
    expect: [],
  },
  // Legacy string-id URL (no sub-tab) must resolve through the same hub.
  { name: "legacy-series", url: `/series/${TOURNAMENT_ID}`, ready: "text=Total Matches", expect: ["SmokeHub_Alpha"] },
  // Slug form must resolve too.
  { name: "slug", url: `/series/${SLUG}`, ready: "text=Total Matches", expect: ["SmokeHub_Alpha"] },
];

async function main() {
  const server = await startServer();
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({ channel: "msedge" });
  const failures = [];
  const written = [];

  try {
    const context = await browser.newContext({ viewport: { width: 360, height: 640 }, serviceWorkers: "block" });
    const page = await context.newPage();

    for (const check of checks) {
      await page.goto(`http://localhost:${PORT}${check.url}`, { waitUntil: "domcontentloaded" });
      try {
        await page.waitForSelector("h1", { timeout: 20000 });
        await page.waitForSelector(check.ready, { timeout: 20000 });
        const text = await page.locator("body").innerText();
        const leaked = [];
        if (text.includes("Draft Report")) leaked.push("draft article");
        if (text.includes("Ghost")) leaked.push("hidden ghost team");
        const missing = (check.expect || []).filter((needle) => !text.includes(needle));
        if (leaked.length) {
          failures.push(`${check.name}: leaked ${leaked.join(", ")} onto a public page`);
        } else if (missing.length) {
          failures.push(`${check.name}: expected real data missing: ${missing.join(", ")}`);
        } else {
          console.log(`ok   ${check.name}`);
        }
      } catch (error) {
        failures.push(`${check.name}: ${error.message}`);
        console.error(`FAIL ${check.name}`);
        console.error((await page.locator("body").innerText().catch(() => "")).slice(0, 600));
      }
    }

    // Four fresh 360x640 screenshots against the real data.
    for (const shot of [
      { key: "home", url: `/series/${TOURNAMENT_ID}`, ready: "text=Total Matches" },
      { key: "fixtures", url: `/series/${TOURNAMENT_ID}/fixtures`, ready: 'input[aria-label="Search fixtures"]' },
      { key: "table", url: `/series/${TOURNAMENT_ID}/table`, ready: "text=NRR" },
      { key: "stats", url: `/series/${TOURNAMENT_ID}/stats`, ready: "text=Most Runs" },
    ]) {
      await page.goto(`http://localhost:${PORT}${shot.url}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("h1", { timeout: 20000 });
      await page.waitForSelector(shot.ready, { timeout: 20000 });
      await page.waitForTimeout(600);
      const file = path.join(OUT, `${shot.key}-360x640.png`);
      await page.screenshot({ path: file, fullPage: true });
      written.push(path.relative(path.resolve(__dirname, ".."), file));
      console.log(`shot ${shot.key} @ 360x640`);
    }

    await context.close();
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${written.length} screenshot(s) written to docs/screenshots/tournament-hub-smoke/`);
  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed:`);
    for (const failure of failures) console.error(` - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`${checks.length}/${checks.length} tab checks passed`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
