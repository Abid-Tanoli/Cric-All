// Player.battingPosition: the optional classification added for XI pickers.
//
// This file pins the pieces that are pure enough to test without HTTP:
//   * the model default keeps every pre-existing player valid with no backfill;
//   * the create/update validators accept the four values, accept "" / null as
//     "not set", and reject an unknown value instead of guessing;
//   * the auth registration shape applies the same enum;
//   * both public projections carry the field (the whitelist must not drop it).
//
// The bulk importer and the backfill script have their own integration tests in
// importSquads.test.js and setBattingPositions.test.js.

import test from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-a-real-one";

import Player from "../src/models/Player.js";
import {
  BATTING_POSITIONS,
  normalizeBattingPosition,
} from "../src/constants/battingPositions.js";
import {
  createPlayerSchema,
  updatePlayerSchema,
  adminUpdatePlayerSchema,
} from "../src/validators/playerValidators.js";
import { registerSchema } from "../src/validators/authValidators.js";
import {
  sanitizePlayerPublic,
  sanitizeRosterPlayer,
  PLAYER_PUBLIC_FIELDS,
  PLAYER_ROSTER_FIELDS,
} from "../src/utils/publicProjection.js";

const VALUES = ["opener", "middle_order", "lower_order", "tailender"];

test("the enum is exactly the four lowercase values in one canonical place", () => {
  assert.deepStrictEqual([...BATTING_POSITIONS], VALUES);
});

test("an existing player without the field is valid and defaults to not set", () => {
  const player = new Player({ name: "Legacy Player" });
  assert.strictEqual(player.battingPosition, "");
  assert.strictEqual(player.validateSync(), undefined);
});

test("normalizeBattingPosition folds operator input but never guesses unknowns", () => {
  assert.strictEqual(normalizeBattingPosition("Opener"), "opener");
  assert.strictEqual(normalizeBattingPosition(" middle order "), "middle_order");
  assert.strictEqual(normalizeBattingPosition("LOWER-ORDER"), "lower_order");
  assert.strictEqual(normalizeBattingPosition("tailender"), "tailender");
  assert.strictEqual(normalizeBattingPosition(""), "");
  assert.strictEqual(normalizeBattingPosition(null), "");
  assert.strictEqual(normalizeBattingPosition("sweeper"), null);
});

test("the create schema accepts every position plus empty and null", () => {
  for (const value of VALUES) {
    const result = createPlayerSchema.safeParse({ name: "X", battingPosition: value });
    assert.strictEqual(result.success, true, value);
    assert.strictEqual(result.data.battingPosition, value);
  }

  const empty = createPlayerSchema.safeParse({ name: "X", battingPosition: "" });
  assert.strictEqual(empty.success, true);
  assert.strictEqual(empty.data.battingPosition, "");

  const cleared = createPlayerSchema.safeParse({ name: "X", battingPosition: null });
  assert.strictEqual(cleared.success, true);
  assert.strictEqual(cleared.data.battingPosition, "", "null is folded to the stored empty value");
});

test("the create schema accepts a missing field (old clients keep working)", () => {
  const result = createPlayerSchema.safeParse({ name: "No Position" });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.data.battingPosition, undefined);
});

test("an unknown batting position is rejected by every write schema", () => {
  for (const schema of [createPlayerSchema, updatePlayerSchema, adminUpdatePlayerSchema]) {
    const result = schema.safeParse({ name: "X", battingPosition: "sweeper" });
    assert.strictEqual(result.success, false);
    assert.ok(
      result.error.issues.some((issue) => issue.path.join(".") === "battingPosition"),
      "the error points at the field so the route returns a clear 400",
    );
  }
});

test("the update schema can clear with null or empty string", () => {
  assert.strictEqual(updatePlayerSchema.safeParse({ battingPosition: null }).data.battingPosition, "");
  assert.strictEqual(updatePlayerSchema.safeParse({ battingPosition: "" }).data.battingPosition, "");
});

test("registration applies the same enum to playerProfile.battingPosition", () => {
  const base = {
    name: "New Person",
    email: "new-person@openctest.dev",
    password: "password-123",
  };
  const valid = registerSchema.safeParse({
    ...base,
    playerProfile: { playingRole: "Batsman", battingPosition: "middle_order" },
  });
  assert.strictEqual(valid.success, true, JSON.stringify(valid.error?.issues));

  const invalid = registerSchema.safeParse({
    ...base,
    playerProfile: { playingRole: "Batsman", battingPosition: "sweeper" },
  });
  assert.strictEqual(invalid.success, false);
});

test("both public projections whitelist battingPosition", () => {
  assert.ok(PLAYER_PUBLIC_FIELDS.includes("battingPosition"));
  assert.ok(PLAYER_ROSTER_FIELDS.includes("battingPosition"));

  const doc = {
    _id: "64f000000000000000000001",
    name: "Projected Player",
    role: "Batsman",
    playingRole: "Batsman",
    battingPosition: "lower_order",
    imageUrl: "/uploads/p.png",
  };

  assert.strictEqual(sanitizePlayerPublic(doc).battingPosition, "lower_order");
  assert.strictEqual(sanitizeRosterPlayer(doc).battingPosition, "lower_order");
});

test("an unset position is exposed as empty rather than dropped by the projection", () => {
  const doc = { _id: "64f000000000000000000002", name: "No Position" };
  assert.strictEqual(sanitizePlayerPublic(doc).battingPosition, "");
  assert.strictEqual(sanitizeRosterPlayer(doc).battingPosition, "");
});
