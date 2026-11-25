import { processImageUpload } from "../utils/imagePipeline.js";
import { storeProcessedImage } from "../utils/photoStore.js";

// Builds a fully resolvable absolute URL for stored uploads. Prefers the
// configured PUBLIC_BACKEND_URL override (the pattern used by
// ADMIN_URL/FRONTEND_URL) so that an absolute URL is returned even when the
// frontend and backend live on different origins/ports in production.
export const getPublicUploadUrl = (req) => {
  const base = (process.env.PUBLIC_BACKEND_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
  return base;
};

export const uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No image file uploaded" });
    }

    const processed = await processImageUpload(req.file.buffer, req.file.mimetype, req.file.originalname);
    const stored = await storeProcessedImage(processed.main, processed.thumbnail);
    const base = getPublicUploadUrl(req);

    res.status(201).json({
      url: `${base}${stored.url}`,
      thumbnailUrl: `${base}${stored.thumbnailUrl}`,
      filename: stored.filename,
      bytes: stored.bytes,
      message: "Image uploaded successfully",
    });
  } catch (error) {
    res.status(error.status || 400).json({ message: error.message || "Image upload failed", error: error.message });
  }
};
