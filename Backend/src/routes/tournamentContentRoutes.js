import express from "express";
import multer from "multer";
import { protect, requireAdmin, requireVerifiedEmail } from "../middleware/authMiddleware.js";
import {
  getTournamentContent,
  getTournamentStats,
  getTournamentStandings,
  listTournamentMedia,
  listTournamentArticles,
  getTournamentArticle,
  adminGetContent,
  adminUpdateContent,
  adminAddPhoto,
  adminAddVideo,
  adminUpdateMedia,
  adminDeleteMedia,
  adminCreateArticle,
  adminUpdateArticle,
  adminDeleteArticle,
} from "../controllers/TournamentContentController.js";

// ---------------------------------------------------------------------------
// Tournament hub routes.
//
// Mounted at `/api/tournaments` AFTER the existing `tournamentRoutes.js`. The
// existing router owns the single-segment `/:id` reads and the legacy
// `/fixtures`, `/points-table`, `/squad` sub-paths; every route below is either
// a new multi-segment path (`/:id/content`, `/:id/stats`, ...) or lives under
// the `/admin` namespace, so nothing here can shadow or change an existing
// endpoint. Additive by construction.
//
// Public routes support a tournament id OR slug (see `resolveTournament`), so a
// shared `/series/<slug>` link keeps working.
// ---------------------------------------------------------------------------

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
  },
});

// multer raises a `MulterError` (e.g. LIMIT_FILE_SIZE) and the generic error
// handler would report it as a 500. Map it to a 400 here so an oversized or
// malformed upload is a client error, and a rejected file type keeps its 400.
function uploadPhoto(req, res, next) {
  upload.single("image")(req, res, (error) => {
    if (!error) return next();
    if (error.name === "MulterError") {
      return res.status(400).json({ message: `Upload rejected: ${error.message}` });
    }
    return res.status(400).json({ message: error.message || "Upload rejected" });
  });
}

// ---- Public reads ---------------------------------------------------------

router.get("/:id/content", getTournamentContent);
router.get("/:id/stats", getTournamentStats);
router.get("/:id/standings", getTournamentStandings);
router.get("/:id/photos", listTournamentMedia("photo"));
router.get("/:id/videos", listTournamentMedia("video"));
router.get("/:id/articles", listTournamentArticles);
router.get("/:id/articles/:slug", getTournamentArticle);

// ---- Admin reads / writes -------------------------------------------------

router.get("/admin/:id/content", ...adminOnly, adminGetContent);
router.put("/admin/:id/content", ...adminOnly, adminUpdateContent);

router.post("/admin/:id/photos", ...adminOnly, uploadPhoto, adminAddPhoto);
router.post("/admin/:id/videos", ...adminOnly, adminAddVideo);
router.put("/admin/:id/media/:mediaId", ...adminOnly, adminUpdateMedia);
router.delete("/admin/:id/media/:mediaId", ...adminOnly, adminDeleteMedia);

router.post("/admin/:id/articles", ...adminOnly, adminCreateArticle);
router.put("/admin/:id/articles/:articleId", ...adminOnly, adminUpdateArticle);
router.delete("/admin/:id/articles/:articleId", ...adminOnly, adminDeleteArticle);

export default router;
