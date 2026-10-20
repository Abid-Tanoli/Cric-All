// Unit tests for the pure matching/validation logic of
// src/scripts/attachTeamLogos.js. No database and no real images are involved:
// the plan is built from in-memory team fixtures, and file checks run against
// a temp folder of tiny fake files (a few random bytes with a .png name — the
// script derives the type from the extension, never from file content).
//
// What is pinned:
//   * the manifest parser (team,file) refuses a missing column or blank cells;
//   * team names match exactly after trim / whitespace-collapse / case-fold,
//     and nothing else matches;
//   * a manifest row only ever reaches an EXISTING team — unknown names are
//     errors and are never created;
//   * ambiguous names (two teams folding to the same value) are refused;
//   * reserved test-prefix teams are skipped;
//   * teams that already have a logo are skipped unless --force;
//   * duplicate manifest rows are skipped;
//   * unsafe paths, non-png/jpg/webp files and >5 MB files are refused;
//   * --clear only ever targets teams listed in the manifest;
//   * PUBLIC_BACKEND_URL is required and normalized (absolute URL base).

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  foldName,
  parseManifest,
  resolveLogoPath,
  inspectFiles,
  planRows,
  publicUploadBase,
} from "../src/scripts/attachTeamLogos.js";

let dir;

const TINY_PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

function writeFake(name, bytes = TINY_PNG_BYTES) {
  fs.writeFileSync(path.join(dir, name), bytes);
}

const record = (line, team, file) => ({ line, team, file });

// In-memory stand-ins for Team.find({}).select("name logo").lean().
const FIXTURE_TEAMS = [
  { _id: "id-young-star", name: "Young Star", logo: "" },
  { _id: "id-baldia-zalmi", name: "Baldia Zalmi", logo: "https://cdn.example.test/uploads/old.png" },
  { _id: "id-orangi-warriors", name: "Orangi Warriors", logo: "" },
  { _id: "id-family-stallions", name: "Family Stallions", logo: "" },
  { _id: "id-orangi-united", name: "Orangi United", logo: "" },
  { _id: "id-sky-sports", name: "Sky Sports", logo: "" },
  { _id: "id-rising-stars-a", name: "Rising Stars", logo: "" }, // ambiguous pair...
  { _id: "id-rising-stars-b", name: "rising  stars", logo: "" }, // ...folds to the same name
  { _id: "id-e2e-fixture", name: "E2E_Test_Team", logo: "" },
];

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "team-logos-"));
});

after(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Manifest parsing
// ---------------------------------------------------------------------------

test("parseManifest accepts a team,file manifest", () => {
  const records = parseManifest("team,file\nYoung Star,young-star.png\nBaldia Zalmi,baldia-zalmi.png\n");
  assert.strictEqual(records.length, 2);
  assert.deepStrictEqual(records[0], { line: 2, team: "Young Star", file: "young-star.png" });
});

test("parseManifest refuses a manifest without the file column", () => {
  assert.throws(() => parseManifest("team,player\nYoung Star,x\n"), /missing required column "file"/);
});

test("parseManifest refuses a row with a blank cell", () => {
  assert.throws(() => parseManifest("team,file\nYoung Star,\n"), /line 2: team and file are both required/);
});

// ---------------------------------------------------------------------------
// Name folding and path safety
// ---------------------------------------------------------------------------

test("foldName trims, collapses whitespace and case-folds", () => {
  assert.strictEqual(foldName("  Young \t Star "), "young star");
  assert.strictEqual(foldName("ORANGI   WARRIORS"), "orangi warriors");
  assert.notStrictEqual(foldName("Young Star"), foldName("Young Stars"));
});

test("resolveLogoPath refuses traversal, paths outside the dir and NUL", () => {
  assert.strictEqual(resolveLogoPath(dir, "ok.png"), path.resolve(dir, "ok.png"));
  assert.strictEqual(resolveLogoPath(dir, "../escape.png"), null);
  // An absolute path is only refused when it escapes the logos directory
  // (same rule as attachPlayerPhotos.js).
  assert.strictEqual(resolveLogoPath(dir, path.resolve(dir, "abs.png")), path.resolve(dir, "abs.png"));
  assert.strictEqual(resolveLogoPath(dir, path.resolve(dir, "..", "outside.png")), null);
  assert.strictEqual(resolveLogoPath(dir, "bad\0.png"), null);
});

// ---------------------------------------------------------------------------
// File validation (tiny fake files in the temp folder)
// ---------------------------------------------------------------------------

test("inspectFiles flags a missing file, a bad extension and an oversize file", () => {
  writeFake("good.png");
  writeFake("bad.gif");
  writeFake("huge.png", Buffer.alloc(5 * 1024 * 1024 + 1));

  const rows = inspectFiles(
    [
      record(2, "Young Star", "good.png"),
      record(3, "Young Star", "missing.png"),
      record(4, "Young Star", "bad.gif"),
      record(5, "Young Star", "huge.png"),
      record(6, "Young Star", "../escape.png"),
    ],
    dir,
  );

  assert.deepStrictEqual(
    rows.map((r) => [r.unsafe, r.badType, r.missing, r.oversize]),
    [
      [false, false, false, false], // good.png
      [false, false, true, false], // missing.png
      [false, true, false, false], // bad.gif
      [false, false, false, true], // huge.png (5 MB + 1 byte)
      [true, false, false, false], // ../escape.png
    ],
  );
});

test("inspectFiles in clear mode never touches the filesystem", () => {
  const rows = inspectFiles([record(2, "Young Star", "does-not-exist.png")], dir, { clear: true });
  assert.strictEqual(rows[0].missing, false);
  assert.strictEqual(rows[0].full, null);
});

// ---------------------------------------------------------------------------
// Matching and planning
// ---------------------------------------------------------------------------

test("a manifest row matches an existing team by folded name, exact otherwise", () => {
  const rows = inspectFiles(
    [record(2, "  young   STAR ", "good.png"), record(3, "Orangi Warriors", "good.png")],
    dir,
  );

  const plan = planRows(rows, FIXTURE_TEAMS);
  assert.strictEqual(plan.attach.length, 2);
  assert.strictEqual(plan.attach[0].teamId, "id-young-star");
  assert.strictEqual(plan.attach[1].teamId, "id-orangi-warriors");
  assert.deepStrictEqual(plan.errors, []);
});

test("an unknown team name is an error and is never created", () => {
  const rows = inspectFiles([record(2, "No Such FC", "good.png")], dir);
  const plan = planRows(rows, FIXTURE_TEAMS);
  assert.strictEqual(plan.attach.length, 0);
  assert.strictEqual(plan.errors.length, 1);
  assert.strictEqual(plan.errors[0].outcome, "unmatched");
  assert.match(plan.errors[0].reason, /no team named "No Such FC"/);
});

test("two teams folding to the same name are ambiguous, not guessed", () => {
  const rows = inspectFiles([record(2, "Rising  Stars", "good.png")], dir);
  const plan = planRows(rows, FIXTURE_TEAMS);
  assert.strictEqual(plan.errors.length, 1);
  assert.strictEqual(plan.errors[0].outcome, "ambiguous");
});

test("reserved test-prefix teams are skipped, not written", () => {
  const rows = inspectFiles([record(2, "E2E_Test_Team", "good.png"), record(3, "test_something", "good.png")], dir);
  const plan = planRows(rows, FIXTURE_TEAMS);
  assert.strictEqual(plan.reserved.length, 2);
  assert.strictEqual(plan.attach.length, 0);
  assert.strictEqual(plan.errors.length, 0, "reserved skips are not errors");
});

test("a team that already has a logo is skipped unless --force", () => {
  const rows = inspectFiles([record(2, "Baldia Zalmi", "good.png")], dir);

  const plan = planRows(rows, FIXTURE_TEAMS);
  assert.strictEqual(plan.hasLogo.length, 1);
  assert.strictEqual(plan.attach.length, 0);
  assert.match(plan.hasLogo[0].reason, /--force/);

  const forced = planRows(rows, FIXTURE_TEAMS, { force: true });
  assert.strictEqual(forced.attach.length, 1);
  assert.strictEqual(forced.attach[0].teamId, "id-baldia-zalmi");
});

test("duplicate manifest rows for one team are both reported and skipped", () => {
  const rows = inspectFiles(
    [record(2, "Young Star", "good.png"), record(3, "young star", "good.png")],
    dir,
  );
  const plan = planRows(rows, FIXTURE_TEAMS);
  assert.strictEqual(plan.attach.length, 0, "a duplicate pair is not silently written once");
  assert.strictEqual(plan.duplicate.length, 2);
});

test("file problems are per-row errors: missing, bad type, oversize, unsafe", () => {
  writeFake("bad.gif");
  writeFake("huge.png", Buffer.alloc(5 * 1024 * 1024 + 1));
  // One row per distinct team, so no row is swallowed as a duplicate.
  const rows = inspectFiles(
    [
      record(2, "Young Star", "missing.png"),
      record(3, "Family Stallions", "bad.gif"),
      record(4, "Orangi United", "huge.png"),
      record(5, "Sky Sports", path.resolve(dir, "..", "outside.png")),
    ],
    dir,
  );
  const plan = planRows(rows, FIXTURE_TEAMS);
  assert.deepStrictEqual(
    plan.errors.map((r) => r.outcome),
    ["missing-file", "bad-type", "oversize", "unsafe-path"],
  );
});

test("--clear only targets manifest teams that have a logo", () => {
  const rows = inspectFiles([record(2, "Young Star", "ignored.png"), record(3, "Baldia Zalmi", "ignored.png")], dir, {
    clear: true,
  });
  const plan = planRows(rows, FIXTURE_TEAMS, { clear: true });

  assert.strictEqual(plan.willClear.length, 1);
  assert.strictEqual(plan.willClear[0].teamId, "id-baldia-zalmi");
  assert.strictEqual(plan.nothingToClear.length, 1);
  assert.strictEqual(plan.nothingToClear[0].teamId, "id-young-star");
  assert.strictEqual(plan.attach.length, 0);
});

test("the plan only ever references teams from the manifest", () => {
  const rows = inspectFiles([record(2, "Orangi Warriors", "good.png")], dir);
  const plan = planRows(rows, FIXTURE_TEAMS);
  const plannedIds = plan.rows.filter((r) => r.teamId).map((r) => r.teamId);
  assert.deepStrictEqual(plannedIds, ["id-orangi-warriors"]);
});

// ---------------------------------------------------------------------------
// PUBLIC_BACKEND_URL
// ---------------------------------------------------------------------------

test("publicUploadBase requires the override and strips trailing slashes", () => {
  assert.throws(() => publicUploadBase({}), /PUBLIC_BACKEND_URL is not set/);
  assert.strictEqual(
    publicUploadBase({ PUBLIC_BACKEND_URL: "https://api.cricall.online/" }),
    "https://api.cricall.online",
  );
});
