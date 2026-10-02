import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReport } from "./lib/report.js";
import { SCENARIOS as ROSTER } from "./lib/scenarios.js";

/**
 * Guards the defect this file exists for: a run that never executed some
 * scenarios produced a report that read as a clean pass, because the writer
 * recorded nothing about the scenarios that had been filtered out.
 *
 * The arithmetic that exposed it, kept here as the regression case:
 *   full suite                       = 78 checks across scenarios 1-7
 *   scenario 1 (T20 innings + chase) = 16 checks
 *   scenario 2 (free hit)            =  4 checks
 *   78 - 16 - 4                      = 58  <- the "mystery" partial report
 *
 * These tests touch the filesystem, so every one of them writes to a path it
 * then removes. The canonical report is restored by `git checkout` if a test
 * ever fails between the write and the cleanup.
 */

const CANONICAL = join("docs", "e2e-results.md");

/** Mirrors the runner: open a scenario and record `n` passing checks in it. */
function build({ selected, perScenario }) {
  const report = createReport({
    scenarios: ROSTER,
    selected: new Set(selected),
    canonicalPath: CANONICAL,
  });
  for (const { n, checks } of perScenario) {
    const s = ROSTER.find((x) => x.n === n);
    report.section(s.title);
    for (let i = 1; i <= checks; i += 1) report.check(s.title, `assertion ${i}`, true, "");
  }
  return report;
}

const FULL = [
  { n: 1, checks: 16 },
  { n: 2, checks: 4 },
  { n: 3, checks: 6 },
  { n: 4, checks: 13 },
  { n: 5, checks: 7 },
  { n: 6, checks: 3 },
  { n: 7, checks: 29 },
];

const META = { apiBase: "http://127.0.0.1:5001/api", runId: "testrun", durationMs: 1000 };

test("a full run is PASS and writes all 78 checks", () => {
  const report = build({ selected: [1, 2, 3, 4, 5, 6, 7], perScenario: FULL });
  assert.equal(report.counts().PASS, 78);
  assert.equal(report.overall(), "PASS");
  assert.equal(report.isPartial(), false);
  assert.deepEqual(report.coverage(), { ran: 7, skipped: 0, total: 7 });
  assert.doesNotMatch(report.toMarkdown(META), /SKIPPED/);
  assert.doesNotMatch(report.toMarkdown(META), /PARTIAL RUN/);
});

test("dropping scenarios 1 and 2 is exactly the 58-check report", () => {
  const report = build({ selected: [3, 4, 5, 6, 7], perScenario: FULL.slice(2) });
  assert.equal(report.counts().PASS, 58, "58 = 78 minus scenario 1 (16) and scenario 2 (4)");
  assert.equal(report.overall(), "PARTIAL", "a partial run must never report as a pass");
  assert.deepEqual(report.coverage(), { ran: 5, skipped: 2, total: 7 });
});

test("a skipped scenario is rendered as SKIPPED, not omitted", () => {
  const report = build({ selected: [3, 4, 5, 6, 7], perScenario: FULL.slice(2) });
  const md = report.toMarkdown(META);

  for (const n of [1, 2]) {
    const title = ROSTER.find((x) => x.n === n).title;
    assert.ok(md.includes(`| ${title} | **SKIPPED** - not selected by E2E_ONLY | 0 |`), `scenario ${n} must appear as SKIPPED`);
  }
  assert.match(md, /PARTIAL RUN/);
  assert.match(md, /\*\*absent from this report\*\*/);
  assert.match(md, /- Scenarios: 5 of 7 ran, \*\*2 skipped\*\*/);
  assert.match(md, /\| \*\*Total\*\* \| 5 ran, 2 skipped \| \*\*58\*\* \|/);
});

test("a selected scenario that produced nothing is reported as a harness bug", () => {
  // Scenario 2 was selected, so its absence cannot be blamed on E2E_ONLY.
  const report = build({ selected: [1, 2, 3, 4, 5, 6, 7], perScenario: FULL.filter((s) => s.n !== 2) });
  assert.equal(report.overall(), "PARTIAL");
  assert.match(report.toMarkdown(META), /the scenario body did not execute/);
});

test("a partial run refuses to overwrite the canonical report", () => {
  const before = readFileSync(CANONICAL, "utf8");
  const report = build({ selected: [7], perScenario: [{ n: 7, checks: 29 }] });

  // The canonical path is the committed full-suite report. A filtered run must
  // leave it byte-for-byte intact, not truncate it to whatever it managed to run.
  assert.throws(() => report.write(CANONICAL, META), /Refusing to write a PARTIAL report/);
  assert.equal(readFileSync(CANONICAL, "utf8"), before, "the refused write must not touch the file");
});

test("a partial run may be written elsewhere, or on purpose", () => {
  const saved = readFileSync(CANONICAL, "utf8");
  const report = build({ selected: [7], perScenario: [{ n: 7, checks: 29 }] });

  // A filtered run can always be sent to a scratch path of its own, so
  // iterating on one scenario is not blocked by the canonical-path guard.
  const scratch = join(tmpdir(), "cricall-e2e-partial.md");
  assert.equal(report.write(scratch, META), scratch);
  assert.match(readFileSync(scratch, "utf8"), /PARTIAL RUN/);
  rmSync(scratch, { force: true });

  // ...or it may replace the canonical report, but only when asked for.
  assert.throws(() => report.write(CANONICAL, META), /Refusing to write a PARTIAL report/);
  assert.equal(report.write(CANONICAL, { ...META, allowPartial: true }), CANONICAL);
  assert.match(readFileSync(CANONICAL, "utf8"), /PARTIAL RUN/);

  // Put the committed full-suite report back exactly as it was.
  writeFileSync(CANONICAL, saved, "utf8");
  assert.equal(readFileSync(CANONICAL, "utf8"), saved);
});

test("a full run may write the canonical report", () => {
  const report = build({ selected: [1, 2, 3, 4, 5, 6, 7], perScenario: FULL });
  const scratch = join(tmpdir(), "cricall-e2e-full.md");
  assert.doesNotThrow(() => report.write(scratch, META));
  const md = readFileSync(scratch, "utf8");
  assert.match(md, /- Overall: \*\*PASS\*\* \(78 pass, 0 fail, 0 divergence\)/);
  assert.match(md, /- Scenarios: 7 of 7 ran/);
  rmSync(scratch, { force: true });
});

test("a check for a section that was never opened throws instead of being mis-filed", () => {
  const report = build({ selected: [1, 2, 3, 4, 5, 6, 7], perScenario: FULL.slice(2) });
  // The old writer silently appended to the last section, which would move
  // scenario 3's assertion into scenario 7 and make the report lie.
  const title = ROSTER[0].title;
  assert.throws(() => report.check(title, "an assertion from a scenario that never ran", true), /no open section/);
});

test("an undeclared scenario title throws", () => {
  const report = createReport({ scenarios: ROSTER, selected: new Set([1, 2, 3, 4, 5, 6, 7]) });
  assert.throws(() => report.section("Scenario 8 - invented"), /unknown scenario title/);
});

test("a failure outranks everything", () => {
  const report = createReport({ scenarios: ROSTER, selected: new Set([1, 2, 3, 4, 5, 6, 7]) });
  for (const s of ROSTER) report.section(s.title);
  report.check(ROSTER[0].title, "one good assertion", true);
  report.check(ROSTER[0].title, "one bad assertion", false);
  assert.equal(report.overall(), "FAIL");
});
