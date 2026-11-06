import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import {
  formatOvers,
  normalizeOvers,
  validateManualScorecard,
} from "../src/services/manualScorecard.js";
import { planFowOvers, inningsTotalBalls, overFigureFromBalls } from "../src/scripts/fixFowOvers.js";
import { planOversRepair, readSetFile, runOversRepair } from "../src/scripts/fixOversFormat.js";
import { scanOversFormat } from "../src/scripts/scanOversFormat.js";

// Fall-of-wicket `overs` is stored as ONE printed over figure ("2.1" = two overs
// and one ball), the same unit the live scoring engine writes. The manual
// validator used to store a ball count (13), which the public scorecard then
// printed as "13.0 ov" instead of "2.1 ov".

const draft = (fallOfWickets, overrides = {}) => {
  const teamA = new mongoose.Types.ObjectId();
  const teamB = new mongoose.Types.ObjectId();
  return {
    teamA: String(teamA),
    teamB: String(teamB),
    totalOvers: 20,
    innings: [
      {
        team: String(teamA),
        overs: "15.0",
        batting: [{ player: String(new mongoose.Types.ObjectId()), runs: 10, balls: 5, isOut: true, dismissalType: "bowled" }],
        fallOfWickets,
        ...overrides,
      },
      { team: String(teamB), batting: [] },
    ],
  };
};

const validate = (payload) =>
  validateManualScorecard(payload, {
    teamIds: [payload.teamA, payload.teamB],
    totalOvers: payload.totalOvers,
    requireComplete: false,
  });

test("manual validator: stores fall-of-wicket overs as a printed over figure", () => {
  for (const [input, expected] of [["7.2", 7.2], ["2.1", 2.1], ["19.5", 19.5], ["12", 12], ["", 0]]) {
    const res = validate(draft([{ runs: 10, wickets: 1, overs: input }]));
    assert.equal(res.ok, true, `${JSON.stringify(input)}: ${JSON.stringify(res.errors)}`);
    assert.equal(res.data.innings[0].fallOfWickets[0].overs, expected, `overs "${input}"`);
  }
});

test("manual validator: rejects a malformed fall-of-wicket over", () => {
  const res = validate(draft([{ runs: 10, wickets: 1, overs: "19.6" }]));
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((error) => error.path === "innings[0].fallOfWickets[0].overs"));
});

test("backfill: converts proven ball counts to over figures", () => {
  const match = {
    source: "manual",
    innings: [{ balls: 90, fallOfWickets: [{ overs: 13 }, { overs: 30 }, { overs: 38 }, { overs: 51 }] }],
  };
  const plan = planFowOvers(match);
  assert.deepEqual(plan.changes.map((change) => change.to), [2.1, 5, 6.2, 8.3]);
  assert.equal(plan.ambiguous.length, 0);
});

test("backfill: leaves a lone integer that fits both units alone", () => {
  const plan = planFowOvers({ source: "manual", innings: [{ balls: 90, fallOfWickets: [{ overs: 13 }] }] });
  assert.equal(plan.changes.length, 0);
  assert.equal(plan.ambiguous.length, 1);
});

test("backfill: never touches a live-scored match", () => {
  const plan = planFowOvers({ source: "live", innings: [{ balls: 90, fallOfWickets: [{ overs: 30 }] }] });
  assert.equal(plan.changes.length, 0);
  assert.equal(plan.ambiguous.length, 0);
});

test("backfill: an already converted innings is idempotent", () => {
  const match = { source: "manual", innings: [{ balls: 90, fallOfWickets: [{ overs: 2.1 }, { overs: 5 }, { overs: 6.2 }, { overs: 8.3 }] }] };
  const second = planFowOvers(match);
  assert.equal(second.changes.length, 0);
});

test("backfill: helpers round-trip the over figure", () => {
  assert.equal(inningsTotalBalls({ balls: 90 }), 90);
  assert.equal(inningsTotalBalls({ overs: 15.3 }), 93);
  assert.equal(overFigureFromBalls(13), 2.1);
  assert.equal(overFigureFromBalls(30), 5);
  assert.equal(overFigureFromBalls(51), 8.3);
});

test("normalizeOvers accepts legal notation and only repairs nearby float noise", () => {
  for (const [input, expected] of [
    ["12", 12],
    ["19.4", 19.4],
    [3.3999999999999986, 3.4],
    ["2.4000000000000004", 2.4],
    [3.1999999999999993, 3.2],
  ]) {
    const result = normalizeOvers(input);
    assert.equal(result.valid, true);
    assert.equal(result.value, expected);
  }
  assert.equal(normalizeOvers("3.45").valid, false);
  assert.equal(normalizeOvers("19.6").valid, false);
  assert.equal(normalizeOvers("0.1.4").valid, false);
  assert.equal(normalizeOvers("3.0.3999999999999986").valid, false);
});

test("formatOvers uses integer ball counts without decimal arithmetic", () => {
  assert.equal(formatOvers("", 13), "2.1");
  assert.equal(formatOvers("", 120), "20.0");
  assert.equal(formatOvers("3.3999999999999986"), "3.4");
  assert.equal(formatOvers("0.1.4"), "0.1.4");
});

test("overs-format repair plans dry-run and applied fixture updates", async () => {
  const fixture = {
    _id: "match-fixture",
    stageLabel: "SF1",
    innings: [{
      overs: "10",
      bowling: [{ overs: 1.399999999 }],
      fallOfWickets: [{ overs: "0.1.4" }],
      partnerships: [{ overs: 2.4000000000000004 }],
    }],
  };
  const setValues = new Map([["innings[0].fallOfWickets[0].overs", 1.4]]);
  const planned = planOversRepair(fixture);
  assert.deepEqual(planned.changes.map((change) => [change.path, change.to]), [
    ["innings[0].bowling[0].overs", 1.4],
    ["innings[0].partnerships[0].overs", 2.4],
  ]);
  assert.deepEqual(planned.unresolved, [{ path: "innings[0].fallOfWickets[0].overs", value: "0.1.4" }]);
  assert.equal(scanOversFormat([fixture]).find((row) => row.path.includes("fallOfWickets")).suggestion, "UNRESOLVED");

  let writeCount = 0;
  let auditCount = 0;
  const writeMatch = async (match, updates) => {
    writeCount += 1;
    for (const [path, value] of Object.entries(updates)) {
      const tokens = path.split(".");
      const key = tokens.pop();
      const target = tokens.reduce((current, token) => current[token], match);
      target[key] = value;
    }
  };
  const writeAudit = async () => { auditCount += 1; };

  await runOversRepair({ matches: [fixture], writeMatch, writeAudit });
  assert.equal(writeCount, 0);
  assert.equal(auditCount, 0);
  assert.equal(fixture.innings[0].bowling[0].overs, 1.399999999);

  const applied = await runOversRepair({
    matches: [fixture],
    apply: true,
    setValues,
    writeMatch,
    writeAudit,
  });
  assert.equal(applied[0].outcome, "FIXED");
  assert.equal(writeCount, 1);
  assert.equal(auditCount, 1);
  assert.equal(fixture.innings[0].bowling[0].overs, 1.4);
  assert.equal(fixture.innings[0].fallOfWickets[0].overs, 1.4);
  assert.equal(fixture.innings[0].partnerships[0].overs, 2.4);
});

test("--set accepts only paths and values that normalize to valid overs", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "overs-format-test-"));
  const file = path.join(directory, "set.json");
  try {
    await fs.writeFile(file, JSON.stringify({
      "innings[0].fallOfWickets[0].overs": "1.399999999",
    }));
    const values = await readSetFile(file);
    assert.equal(values.get("innings[0].fallOfWickets[0].overs"), 1.4);

    await fs.writeFile(file, JSON.stringify({
      "innings[0].fallOfWickets[0].overs": "0.1.4",
    }));
    await assert.rejects(readSetFile(file), /Invalid --set value/);

    await fs.writeFile(file, JSON.stringify({ "innings[0].unknown[0].overs": 1.4 }));
    await assert.rejects(readSetFile(file), /Unsupported overs JSON path/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
