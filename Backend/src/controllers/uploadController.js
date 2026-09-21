import { storeImage, ensureUploadsDir } from "../utils/photoStore.js";

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

    ensureUploadsDir();

    const { url, filename } = await storeImage(req.file.buffer, req.file.mimetype, req.file.originalname);

    res.status(201).json({
      url: `${getPublicUploadUrl(req)}${url}`,
      filename,
      message: "Image uploaded successfully"
    });
  } catch (error) {
    res.status(error.status || 400).json({ message: error.message || "Image upload failed", error: error.message });
  }
};