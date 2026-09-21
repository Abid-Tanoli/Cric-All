import { storeImage, ensureUploadsDir } from "../utils/photoStore.js";

export const uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No image file uploaded" });
    }

    ensureUploadsDir();

    const { url, filename } = await storeImage(req.file.buffer, req.file.mimetype, req.file.originalname);

    res.status(201).json({
      url,
      filename,
      message: "Image uploaded successfully"
    });
  } catch (error) {
    res.status(error.status || 400).json({ message: error.message || "Image upload failed", error: error.message });
  }
};