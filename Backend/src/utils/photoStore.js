import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Root for locally stored uploads. Defaults to <Backend>/uploads, which
// docker-compose mounts as the persistent named volume `uploads_data` (so the
// files survive a rebuild). UPLOADS_DIR points it somewhere else — the tests
// use a throwaway temp directory so a run never writes into the repo tree.
export const uploadsDir = path.resolve(
  process.env.UPLOADS_DIR || path.resolve(__dirname, "../../uploads"),
);

const ALLOWED_EXTENSIONS = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  // Only reached after sponsorImage.js has validated the SVG markup. The
  // general /api/upload/image route keeps its narrower jpeg/png/webp filter.
  "image/svg+xml": ".svg"
};

// Cloud storage is preferred when configured. With no SDK installed and no
// CLOUDINARY_URL / S3_* vars present, we transparently fall back to local disk
// and serve the file via the /uploads static mount.
function hasCloudStorage() {
  return !!(process.env.CLOUDINARY_URL || process.env.S3_BUCKET);
}

export function ensureUploadsDir() {
  if (hasCloudStorage()) return;
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
}

export async function storeImage(buffer, mimetype, originalName = "") {
  const ext = ALLOWED_EXTENSIONS[mimetype];
  if (!ext) {
    const error = new Error("Only JPEG, PNG and WebP images are allowed");
    error.status = 400;
    throw error;
  }

  if (hasCloudStorage()) {
    throw new Error(
      "Cloud storage is configured but the upload adapter is not installed. " +
      "Install the required SDK (e.g. cloudinary) or remove CLOUDINARY_URL/S3_BUCKET to use local storage."
    );
  }

  ensureUploadsDir();
  const safeBase = (originalName || "image")
    .replace(/[^a-zA-Z0-9-_]/g, "")
    .slice(0, 40) || "image";
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${safeBase}${ext}`;
  await fs.promises.writeFile(path.join(uploadsDir, filename), buffer);
  return { url: `/uploads/${filename}`, filename };
}

/**
 * Writes the output of the shared image pipeline. The name is derived from the
 * encoded bytes, so a given image always has one immutable URL and a re-upload
 * of the same content is a no-op on disk. The original upload is never stored.
 */
export async function storeProcessedImage(main, thumbnail) {
  if (!Buffer.isBuffer(main) || !Buffer.isBuffer(thumbnail) || !main.length || !thumbnail.length) {
    const error = new Error("Processed image is empty");
    error.status = 400;
    throw error;
  }
  if (hasCloudStorage()) {
    throw new Error(
      "Cloud storage is configured but the upload adapter is not installed. " +
      "Install the required SDK (e.g. cloudinary) or remove CLOUDINARY_URL/S3_BUCKET to use local storage."
    );
  }

  const hash = crypto.createHash("sha256").update(main).digest("hex");
  const filename = `${hash}.webp`;
  const thumbnailFilename = `${hash}-thumb.webp`;
  ensureUploadsDir();
  await Promise.all([
    fs.promises.writeFile(path.join(uploadsDir, filename), main),
    fs.promises.writeFile(path.join(uploadsDir, thumbnailFilename), thumbnail),
  ]);
  return {
    url: `/uploads/${filename}`,
    filename,
    thumbnailUrl: `/uploads/${thumbnailFilename}`,
    thumbnailFilename,
    bytes: main.length + thumbnail.length,
  };
}

// Matches both schemes this server writes:
//   - legacy storeImage: `<13-digit epoch>-<12 hex>-<base>.<ext>`
//   - processed uploads: `<sha256-of-output-bytes>.webp` (+ `-thumb`)
// Only files this server wrote are ever eligible for deletion.
const LEGACY_UPLOAD_FILE_NAME = /^\d{13}-[0-9a-f]{12}-[a-zA-Z0-9_-]{0,40}\.(jpg|png|webp|svg)$/;
const CONTENT_HASH_FILE_NAME = /^[0-9a-f]{64}(?:-thumb)?\.webp$/;

export function isUploadedFilename(name = "") {
  return LEGACY_UPLOAD_FILE_NAME.test(name) || CONTENT_HASH_FILE_NAME.test(name);
}

/** Cache policy for stored filenames; null for files we did not write. */
export function cacheControlForUpload(filename = "") {
  return isUploadedFilename(filename) ? "public, max-age=31536000, immutable" : null;
}

/** Companion 400px thumbnail name for a processed upload (if it has one). */
export function thumbnailNameFor(filename = "") {
  return CONTENT_HASH_FILE_NAME.test(filename) && !filename.includes("-thumb")
    ? filename.replace(/\.webp$/, "-thumb.webp")
    : null;
}

// Extracts the bare filename from a stored URL (absolute or /uploads-relative)
// but only if it points at our own /uploads path with a storeImage-style name.
// Returns null for external/cloud URLs so unrelated files can never be removed.
export function uploadFilenameFromUrl(url = "") {
  if (typeof url !== "string" || !url) return null;
  const idx = url.indexOf("/uploads/");
  if (idx === -1) return null;
  const rest = url.slice(idx + "/uploads/".length);
  if (!rest || rest.includes("/") || rest.includes("..")) return null;
  let filename;
  try {
    filename = decodeURIComponent(rest);
  } catch {
    return null;
  }
  return isUploadedFilename(filename) ? filename : null;
}

export async function deleteStoredFile(url) {
  const filename = uploadFilenameFromUrl(url);
  if (!filename) return false;
  const target = path.normalize(path.join(uploadsDir, filename));
  if (!target.startsWith(uploadsDir + path.sep)) return false;
  try {
    await fs.promises.unlink(target);
    // Processed images have a companion thumbnail; remove it with the main file
    // so a deleted photo also frees its quota bytes.
    const thumbName = thumbnailNameFor(filename);
    if (thumbName) {
      await fs.promises
        .unlink(path.normalize(path.join(uploadsDir, thumbName)))
        .catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
    }
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function deleteStoredFiles(urls) {
  let removed = 0;
  for (const url of urls || []) {
    if (await deleteStoredFile(url)) removed++;
  }
  return removed;
}

export async function listUploadedFilenames() {
  if (hasCloudStorage()) return [];
  try {
    const entries = await fs.promises.readdir(uploadsDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}