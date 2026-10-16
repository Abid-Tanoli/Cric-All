import mongoose from "mongoose";

// Tournament hub articles (news / previews / reports written by a platform
// admin). Additive model. The body is stored as plain text / Markdown and is
// sanitized again on render; nothing here is executed as HTML by the API.
const tournamentArticleSchema = new mongoose.Schema(
  {
    tournament: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    // Unique per tournament (case-insensitive at write time). Generated from the
    // title when the admin does not supply one.
    slug: { type: String, required: true, trim: true },
    coverImage: { type: String, default: "" },
    // Markdown / plain text. Rendered after a client-side sanitize pass.
    body: { type: String, default: "" },
    excerpt: { type: String, default: "" },
    published: { type: Boolean, default: false },
    publishedAt: { type: Date, default: null },
    createdByAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    // Soft delete; a partial index lets a slug be reused after deletion.
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

tournamentArticleSchema.index(
  { tournament: 1, slug: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);

const TournamentArticle =
  mongoose.models.TournamentArticle || mongoose.model("TournamentArticle", tournamentArticleSchema);

export default TournamentArticle;
