import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const uploadsDir = path.resolve(__dirname, "../../uploads");

const ALLOWED_EXTENSIONS = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp"
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