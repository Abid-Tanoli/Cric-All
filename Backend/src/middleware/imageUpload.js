import multer from "multer";
import { IMAGE_MIMES, MAX_IMAGE_INPUT_BYTES } from "../utils/imagePipeline.js";

// Shared memory upload for raster photos. Bytes stay in memory until the
// controller has run the magic-byte / decode checks and the WebP pipeline;
// nothing is written to disk before that. Sponsor logos keep their own multer
// middleware because they additionally accept a strictly validated SVG.
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: MAX_IMAGE_INPUT_BYTES },
  fileFilter: (req, file, cb) => {
    if (IMAGE_MIMES.includes(file.mimetype)) return cb(null, true);
    cb(new Error("Only JPEG, PNG and WebP images are allowed"));
  },
});

/** Multer wrapper that maps client-side upload errors to 400s, not 500s. */
export function imageUploadSingle(field = "image") {
  return (req, res, next) => {
    upload.single(field)(req, res, (error) => {
      if (!error) return next();
      if (error.name === "MulterError") {
        return res.status(400).json({ message: `Upload rejected: ${error.message}` });
      }
      return res.status(400).json({ message: error.message || "Upload rejected" });
    });
  };
}

export default imageUploadSingle;
