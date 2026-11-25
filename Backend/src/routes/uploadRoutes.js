import express from "express";
import { uploadImage } from "../controllers/uploadController.js";
import { protect, requireAdmin, requireVerifiedEmail } from "../middleware/authMiddleware.js";
import { imageUploadSingle } from "../middleware/imageUpload.js";

const router = express.Router();
const adminOnly = [protect, requireAdmin, requireVerifiedEmail];

// Platform-admin route: it now runs the same shared decode/WebP pipeline as
// organization uploads (magic bytes, animated/pixel guard, resize, thumbnail).
router.post("/image", ...adminOnly, imageUploadSingle("image"), uploadImage);

export default router;
