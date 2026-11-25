import mongoose from "mongoose";

// One row per organization-owned image. `bytes` is the total charged to the
// quota: the processed WebP plus its 400px thumbnail (the original is never
// written). Deleting the photo removes the row, which returns those bytes.
const orgUploadSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TeamOrganization",
      required: true,
      index: true,
    },
    uploader: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    filename: {
      type: String,
      required: true,
      trim: true,
    },
    bytes: {
      type: Number,
      required: true,
      min: 0,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { versionKey: false }
);

orgUploadSchema.index({ organization: 1, createdAt: -1 });
orgUploadSchema.index({ organization: 1, filename: 1 });

export default mongoose.model("OrgUpload", orgUploadSchema);
