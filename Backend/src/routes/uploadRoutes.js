import express from "express";
import multer from "multer";
import { uploadImage } from "../controllers/uploadController.js";
import { protect, requireAdmin, requireVerifiedEmail } from "../middleware/authMiddleware.js";

const router = express.Router();
const adminOnly = [protect, requireAdmin, requireVerifiedEmail];

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

// multer raises a `MulterError` (e.g. LIMIT_FILE_SIZE) and the generic error
// handler would report it as a 500. Map it to a 400 here so an oversized or
// malformed upload is a client error, and a rejected file type keeps its 400.
// Same mapping as tournamentContentRoutes.js.
function uploadImageSingle(req, res, next) {
  upload.single("image")(req, res, (error) => {
    if (!error) return next();
    if (error.name === "MulterError") {
      return res.status(400).json({ message: `Upload rejected: ${error.message}` });
    }
    return res.status(400).json({ message: error.message || "Upload rejected" });
  });
}

router.post("/image", ...adminOnly, uploadImageSingle, uploadImage);

export default router;