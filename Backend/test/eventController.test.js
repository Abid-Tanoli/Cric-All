import test from "node:test";
import assert from "node:assert/strict";
import { validateEventTeamCount } from "../src/controllers/eventController.js";

test("single-match events require exactly 2 teams", () => {
  assert.ok(validateEventTeamCount("single-match", [], 0));
  assert.ok(validateEventTeamCount("single-match", ["a"], 0));
  assert.ok(validateEventTeamCount("single-match", ["a", "b", "c"], 0));
  assert.equal(validateEventTeamCount("single-match", ["a", "b"], 0), null);
});

test("multi-team events require the exact declared total team count", () => {
  assert.equal(validateEventTeamCount("tournament", ["a", "b", "c", "d"], 4), null);
  assert.ok(validateEventTeamCount("tournament", ["a", "b", "c"], "4"));
  assert.ok(validateEventTeamCount("tournament", ["a", "b"], 3), "fewer teams than declared must fail");
});

test("multi-team events reject NaN/too-small declared totals", () => {
  assert.ok(validateEventTeamCount("league", ["a", "b"], 1));
  assert.ok(validateEventTeamCount("series", ["a", "b"], "abc"));
});

test("tri-series/world-cup/champions-trophy enforce their declared counts", () => {
  assert.equal(validateEventTeamCount("tri-series", ["a", "b", "c"], 3), null);
  assert.ok(validateEventTeamCount("tri-series", ["a", "b", "c"], 4));
  assert.equal(validateEventTeamCount("world-cup", ["a", "b", "c", "d"], 4), null);
});

test("even unrecognized event types can never be created with fewer than 2 teams", () => {
  assert.ok(validateEventTeamCount("future-format", ["a"], 5));
  assert.equal(validateEventTeamCount("future-format", ["a", "b"], 2), null);
});

test("missing teams array counts as zero teams", () => {
  assert.ok(validateEventTeamCount("single-match", undefined, 0));
  assert.ok(validateEventTeamCount("tournament", null, 4));
});