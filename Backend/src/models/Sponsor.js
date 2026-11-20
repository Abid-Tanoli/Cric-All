import mongoose from "mongoose";

// Local sponsors are first-class documents rather than the legacy
// Tournament.sponsors [{name, logo}] array. That keeps one shared catalog for
// the public tournament/match strips, the owner screen and the Admin app, and
// makes the per-tournament limits enforceable in one place.
//
// `scope` decides where a sponsor is shown:
//   - "tournament": only on `tournamentRef`
//   - "platform": on every tournament (platform-wide, Admin app only)
// `organizationRef` is denormalized from the tournament so org writes can be
// scoped with the same tenant guards used for competitions.
const sponsorSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    logoUrl: {
      type: String,
      required: true,
      trim: true,
      maxlength: 600,
    },
    linkUrl: {
      type: String,
      default: "",
      trim: true,
      maxlength: 600,
    },
    tier: {
      type: String,
      enum: ["title", "supporting"],
      required: true,
      default: "supporting",
    },
    order: {
      type: Number,
      default: 0,
      min: 0,
      max: 999,
    },
    active: {
      type: Boolean,
      default: true,
    },
    scope: {
      type: String,
      enum: ["tournament", "platform"],
      default: "tournament",
    },
    tournamentRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      default: null,
    },
    organizationRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TeamOrganization",
      default: null,
    },
    // Both Admin and User principals can create sponsors. `createdByModel`
    // makes the id unambiguous without a populated cross-collection lookup.
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    createdByModel: {
      type: String,
      enum: ["Admin", "User"],
      default: null,
    },
  },
  { timestamps: true }
);

sponsorSchema.index({ scope: 1, tournamentRef: 1, active: 1, order: 1 });
sponsorSchema.index({ organizationRef: 1, active: 1, order: 1 });
sponsorSchema.index({ scope: 1, active: 1, tier: 1 });

export default mongoose.models.Sponsor || mongoose.model("Sponsor", sponsorSchema);
