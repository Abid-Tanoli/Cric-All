// Sponsor logos share the local upload storage with every other image, but
// they are public-facing and may be supplied by an organization owner, so the
// bytes are checked before storeImage writes them. A accepted SVG is stored
// verbatim only after passing a strict no-script/no-external-fetch allowlist.

export const SPONSOR_LOGO_MAX_BYTES = 5 * 1024 * 1024;

export const SPONSOR_LOGO_MIMES = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];

const hasPrefix = (buffer, bytes) => bytes.every((byte, index) => buffer[index] === byte);
const isJpeg = (buffer) => hasPrefix(buffer, [0xff, 0xd8, 0xff]);
const isPng = (buffer) => hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isWebp = (buffer) =>
  buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";

const UNSAFE_SVG = [
  /<!doctype/i,
  /<!entity/i,
  /<script\b/i,
  /<\/script\b/i,
  /on[a-z]+\s*=/i,
  /javascript:/i,
  /data:/i,
  /<foreignobject\b/i,
  /<iframe\b/i,
  /<embed\b/i,
  /<object\b/i,
  /<link\b/i,
  /<style\b/i,
  /@import\b/i,
  /url\s*\(/i,
];

/**
 * @returns {Buffer} the buffer to store (unchanged for valid images).
 * @throws {Error} with `status = 400` for a rejected upload.
 */
export function assertSafeSponsorLogo(buffer, mimetype) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const error = new Error("No image file uploaded");
    error.status = 400;
    throw error;
  }
  if (buffer.length > SPONSOR_LOGO_MAX_BYTES) {
    const error = new Error("Logo must be 5 MB or smaller");
    error.status = 400;
    throw error;
  }
  if (!SPONSOR_LOGO_MIMES.includes(mimetype)) {
    const error = new Error("Only PNG, JPEG, WebP and safe SVG logos are allowed");
    error.status = 400;
    throw error;
  }

  if (mimetype === "image/svg+xml") {
    const xml = buffer.toString("utf8");
    if (!/<svg\b/i.test(xml) || xml.includes("\u0000") || UNSAFE_SVG.some((pattern) => pattern.test(xml))) {
      const error = new Error("SVG logo contains unsafe content");
      error.status = 400;
      throw error;
    }
    return buffer;
  }

  const looksLikeImage =
    (mimetype === "image/png" && isPng(buffer)) ||
    (mimetype === "image/jpeg" && isJpeg(buffer)) ||
    (mimetype === "image/webp" && isWebp(buffer));
  if (!looksLikeImage) {
    const error = new Error("Uploaded file does not match its image type");
    error.status = 400;
    throw error;
  }

  // Even a valid-looking raster must not smuggle executable markup behind the
  // image signature (some browsers sniff content when the type is ambiguous).
  const head = buffer.subarray(0, 1024).toString("utf8");
  if (/<script\b|<\?php|<svg\b|<!doctype/i.test(head)) {
    const error = new Error("Uploaded file contains executable content");
    error.status = 400;
    throw error;
  }
  return buffer;
}
