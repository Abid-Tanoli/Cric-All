import test from "node:test";
import assert from "node:assert/strict";
import { computeRemovedMediaUrls } from "../src/services/teamService.js";

test("removed media URLs are detected when the new list drops them", () => {
  const oldUrls = [
    "http://x/uploads/1700000000000-abcdefabcdef-1.jpg",
    "http://x/uploads/1700000000000-abcdefabcdef-2.jpg",
  ];
  const removed = computeRemovedMediaUrls(oldUrls, [
    { url: oldUrls[0], caption: "kept" },
  ]);
  assert.deepEqual(removed, [oldUrls[1]]);
});

test("empty media array on update removes every previous upload", () => {
  const removed = computeRemovedMediaUrls(
    ["http://x/uploads/1700000000000-abcdefabcdef-1.jpg"],
    []
  );
  assert.equal(removed.length, 1);
});

test("undefined newMedia means untouched (no removals)", () => {
  assert.deepEqual(computeRemovedMediaUrls(["http://x/uploads/1.jpg"], undefined), []);
});

test("handles entries without a url and duplicate keeps", () => {
  const kept = "http://x/uploads/1700000000000-abcdefabcdef-1.jpg";
  const removed = computeRemovedMediaUrls([kept, "http://x/uploads/gone.jpg"], [
    { caption: "no url" },
    { url: kept },
    { url: kept },
  ]);
  assert.deepEqual(removed, ["http://x/uploads/gone.jpg"]);
});

test("non-array oldMediaUrls is tolerated", () => {
  assert.deepEqual(computeRemovedMediaUrls(undefined, [{ url: "a" }]), []);
});