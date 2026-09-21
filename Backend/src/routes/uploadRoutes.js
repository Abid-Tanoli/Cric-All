import express from "express";
import multer from "multer";
import { uploadImage } from "../controllers/uploadController.js";
import { protect, requireAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();
const adminOnly = [protect, requireAdmin];

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG and WebP images are allowed"));
    }
  }
});

router.post("/image", ...adminOnly, upload.single("image"), uploadImage);

export default router;