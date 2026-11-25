// Shared raster-image pipeline for user-supplied photos.
//
// The sponsor-logo validator in sponsorImage.js checks bytes but stores them
// verbatim (SVG must stay SVG). Player photos and other general uploads do not
// need the original bytes: they are decoded once here, normalized, shrunk and
// re-encoded as WebP, so nothing executable or oversized ever reaches disk.

import sharp from "sharp";

export const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_IMAGE_INPUT_BYTES = 5 * 1024 * 1024;
// 40 megapixels is generous for a photo but small enough to stop a tiny PNG
// that claims to be 30k x 30k from consuming gigabytes of RAM on decode.
export const MAX_IMAGE_INPUT_PIXELS = 40_000_000;
export const MAX_IMAGE_EDGE = 1600;
export const THUMBNAIL_EDGE = 400;
const TARGET_BYTES = 300 * 1024;

function clientError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

const hasPrefix = (buffer, bytes) => bytes.every((byte, index) => buffer[index] === byte);
const isJpeg = (buffer) => hasPrefix(buffer, [0xff, 0xd8, 0xff]);
const isPng = (buffer) => hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isWebp = (buffer) =>
  buffer.length >= 12 &&
  buffer.toString("ascii", 0, 4) === "RIFF" &&
  buffer.toString("ascii", 8, 12) === "WEBP";

/** Magic-byte check shared by every raster upload route. */
export function assertImageMagic(buffer, mimetype) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw clientError("No image file uploaded");
  }
  if (buffer.length > MAX_IMAGE_INPUT_BYTES) {
    throw clientError("Image must be 5 MB or smaller");
  }
  if (!IMAGE_MIMES.includes(mimetype)) {
    throw clientError("Only JPEG, PNG and WebP images are allowed");
  }
  const looksLikeImage =
    (mimetype === "image/jpeg" && isJpeg(buffer)) ||
    (mimetype === "image/png" && isPng(buffer)) ||
    (mimetype === "image/webp" && isWebp(buffer));
  if (!looksLikeImage) {
    throw clientError("Uploaded file does not match its image type");
  }
  // A valid signature can still wrap markup that some browsers sniff as HTML.
  const head = buffer.subarray(0, 1024).toString("utf8");
  if (/<script\b|<\?php|<svg\b|<!doctype/i.test(head)) {
    throw clientError("Uploaded file contains executable content");
  }
  // APNG and animated WebP are valid signatures with multiple frames. Reject
  // them from bytes alone so a crafted animated file never reaches the decoder.
  if (hasChunkNearStart(buffer, "acTL") || hasChunkNearStart(buffer, "ANIM", 128)) {
    throw clientError("Animated images are not allowed");
  }
  return buffer;
}

function hasChunkNearStart(buffer, chunk, window = 512) {
  return buffer.subarray(0, Math.min(buffer.length, window)).includes(Buffer.from(chunk));
}

function assertNotAnimated(metadata) {
  // The decoder also reports multi-page inputs (e.g. an animated format whose
  // chunk name sits further into the file).
  if ((metadata.pages || 1) > 1) {
    throw clientError("Animated images are not allowed");
  }
}

/**
 * Decode, validate and normalize an uploaded image. The original buffer is
 * never written to disk; only the WebP main image and its thumbnail are
 * returned. Sharp errors are mapped to 400 so a malformed file is a client
 * error, never a 500.
 */
export async function processImageUpload(buffer, mimetype, originalName = "image") {
  assertImageMagic(buffer, mimetype);

  let metadata;
  try {
    metadata = await sharp(buffer, {
      animated: false,
      limitInputPixels: MAX_IMAGE_INPUT_PIXELS,
    }).metadata();
  } catch {
    throw clientError("Image is too large or cannot be decoded");
  }

  if (!metadata.width || !metadata.height) throw clientError("Image has no dimensions");
  if (metadata.width * metadata.height > MAX_IMAGE_INPUT_PIXELS) {
    throw clientError(`Image must be at most ${MAX_IMAGE_INPUT_PIXELS} pixels`);
  }
  assertNotAnimated(metadata);

  const expectedFormat = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" }[mimetype];
  if (metadata.format !== expectedFormat) {
    throw clientError("Uploaded file does not match its image type");
  }

  try {
    const normalized = sharp(buffer, {
      animated: false,
      limitInputPixels: MAX_IMAGE_INPUT_PIXELS,
    }).rotate(); // honours EXIF orientation before any resize

    const resizeFor = (edge) =>
      normalized
        .clone()
        .resize(edge, edge, { fit: "inside", withoutEnlargement: true });

    let main;
    // Quality first, then dimensions: most photos fit well under the target
    // after q78 alone; only outliers need the extra passes.
    for (const quality of [78, 70, 62, 54]) {
      main = await resizeFor(MAX_IMAGE_EDGE).webp({ quality, effort: 4 }).toBuffer();
      if (main.length <= TARGET_BYTES) break;
    }
    if (main.length > TARGET_BYTES) {
      for (const edge of [1300, 1000, 800]) {
        main = await resizeFor(edge).webp({ quality: 60, effort: 4 }).toBuffer();
        if (main.length <= TARGET_BYTES) break;
      }
    }

    const thumbnail = await sharp(main)
      .resize(THUMBNAIL_EDGE, THUMBNAIL_EDGE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78, effort: 4 })
      .toBuffer();

    const { width, height } = await sharp(main).metadata();
    return {
      main,
      thumbnail,
      format: "webp",
      width: width || metadata.width,
      height: height || metadata.height,
      originalName: String(originalName || "image"),
    };
  } catch (error) {
    if (error?.status === 400) throw error;
    throw clientError("Image could not be processed");
  }
}
