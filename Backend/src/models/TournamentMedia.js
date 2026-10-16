import mongoose from "mongoose";

// Tournament hub media (photos + videos). Additive model: it references a
// Tournament and never touches existing collections, so it is safe for the
// production database and for the oct12-knockout branch (which adds scorecard
// features, not media).
//
// Photos store the URL produced by the existing upload pipeline
// (utils/photoStore.storeImage -> /uploads/<file>); videos store only a URL
// that is validated against an allow-list of hosts (YouTube / Facebook) and
// parsed into a videoId. Remote media is never fetched or mirrored.
const tournamentMediaSchema = new mongoose.Schema(
  {
    tournament: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
      index: true,
    },
    // "photo" | "video"
    kind: {
      type: String,
      enum: ["photo", "video"],
      required: true,
    },
    // Absolute or /uploads-relative URL. For videos this is the source URL.
    url: { type: String, default: "" },
    // "youtube" | "facebook" | "" (photos)
    provider: {
      type: String,
      enum: ["youtube", "facebook", ""],
      default: "",
    },
    // Extracted provider id, e.g. the YouTube video id. Never a fetched asset.
    videoId: { type: String, default: "" },
    // Photo caption, or video title.
    caption: { type: String, default: "" },
    // Manual ordering field (photos/videos can be reordered by the admin).
    sortOrder: { type: Number, default: 0 },
    published: { type: Boolean, default: true },
    createdByAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    // Soft delete: rows stay for audit but are excluded from every public read.
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

tournamentMediaSchema.index({ tournament: 1, kind: 1, published: 1, sortOrder: 1, createdAt: 1 });

const TournamentMedia =
  mongoose.models.TournamentMedia || mongoose.model("TournamentMedia", tournamentMediaSchema);

export default TournamentMedia;
