import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEmptyOptionalIds } from "../src/controllers/playerController.js";

test("normalizeEmptyOptionalIds removes empty-string team (admin free-agent form)", () => {
  const body = {
    name: "Free Agent",
    team: "",
    imageUrl: "http://x/uploads/a.png",
    playingRole: "Batsman",
  };
  normalizeEmptyOptionalIds(body);
  assert.ok(!("team" in body), "team must be removed when it is an empty string");
});

test("normalizeEmptyOptionalIds removes null team", () => {
  const body = { name: "X", team: null };
  normalizeEmptyOptionalIds(body);
  assert.ok(!("team" in body));
});

test("normalizeEmptyOptionalIds keeps a valid team ObjectId", () => {
  const body = { name: "X", team: "507f1f77bcf86cd799439011" };
  normalizeEmptyOptionalIds(body);
  assert.strictEqual(body.team, "507f1f77bcf86cd799439011");
});

test("normalizeEmptyOptionalIds tolerates undefined/null bodies", () => {
  assert.strictEqual(normalizeEmptyOptionalIds(undefined), undefined);
  assert.strictEqual(normalizeEmptyOptionalIds(null), null);
});