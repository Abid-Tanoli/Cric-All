import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import {
  storeImage,
  uploadFilenameFromUrl,
  deleteStoredFile,
  isUploadedFilename,
  uploadsDir,
} from "../src/utils/photoStore.js";

const ownFile = (name) => `${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${name}.jpg`;

test("uploadFilenameFromUrl extracts our own /uploads filename", () => {
  const name = ownFile("player");
  for (const url of [
    `/uploads/${name}`,
    `http://localhost:5000/uploads/${name}`,
    `https://187.127.96.220:5000/uploads/${name}`,
  ]) {
    assert.equal(uploadFilenameFromUrl(url), name);
  }
});

test("uploadFilenameFromUrl refuses external and unsafe URLs", () => {
  assert.equal(uploadFilenameFromUrl("https://youtube.com/watch?v=x"), null);
  assert.equal(uploadFilenameFromUrl("https://res.cloudinary.com/cricall/image/x.jpg"), null);
  assert.equal(uploadFilenameFromUrl("/uploads/../secrets/passwords.txt"), null);
  assert.equal(uploadFilenameFromUrl("/uploads/a/b/c.jpg"), null);
  assert.equal(uploadFilenameFromUrl("http://localhost:5000/uploads/not-a-real-name.png"), null);
  assert.equal(uploadFilenameFromUrl(""), null);
  assert.equal(uploadFilenameFromUrl(null), null);
});

test("isUploadedFilename only accepts storeImage's naming scheme", () => {
  assert.ok(isUploadedFilename(ownFile("a")));
  assert.ok(!isUploadedFilename("random-name.jpg"));
  assert.ok(!isUploadedFilename("1700000000000-zzzzzzzzzzzz-1.jpg"));
  assert.ok(!isUploadedFilename("1700000000000-abcdefabcdef-1.txt"));
});

test("storeImage rejects non-whitelisted mimetypes before touching disk", async () => {
  await assert.rejects(
    storeImage(Buffer.from("not an image"), "text/plain", "evil.txt"),
    /Only JPEG, PNG and WebP images are allowed/
  );
});

test("deleteStoredFile removes an existing own-style upload and ignores others", async () => {
  const name = ownFile("cleanup");
  const target = path.join(uploadsDir, name);
  await fs.promises.writeFile(target, "x");
  try {
    assert.equal(await deleteStoredFile(`http://x/uploads/${name}`), true);
    assert.ok(!fs.existsSync(target), "file must be gone from disk");
    assert.equal(await deleteStoredFile(`http://x/uploads/${name}`), false, "second delete is a no-op");
  } finally {
    await fs.promises.unlink(target).catch(() => {});
  }
});

test("deleteStoredFile refuses external/cloud URLs entirely", async () => {
  assert.equal(await deleteStoredFile("https://youtube.com/video"), false);
  assert.equal(await deleteStoredFile("https://res.cloudinary.com/x/y.jpg"), false);
});