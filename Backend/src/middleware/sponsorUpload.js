import multer from "multer";
import { SPONSOR_LOGO_MIMES, SPONSOR_LOGO_MAX_BYTES } from "../utils/sponsorImage.js";

// Same memory-storage approach as /api/upload/image, with the sponsor logo
// mime set (safe SVG included). Byte-level validation happens in the
// controller through assertSafeSponsorLogo before anything touches the disk.
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: SPONSOR_LOGO_MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (SPONSOR_LOGO_MIMES.includes(file.mimetype)) return cb(null, true);
    cb(new Error("Only PNG, JPEG, WebP and safe SVG logos are allowed"));
  },
});

export function sponsorLogoUpload(req, res, next) {
  upload.single("logo")(req, res, (error) => {
    if (!error) return next();
    if (error.name === "MulterError") {
      return res.status(400).json({ message: `Upload rejected: ${error.message}` });
    }
    return res.status(400).json({ message: error.message || "Upload rejected" });
  });
}

export default sponsorLogoUpload;
