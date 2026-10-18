import mongoose from "mongoose";

const communityPostSchema = new mongoose.Schema(
  {
    authorUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    subject: {
      type: {
        type: String,
        enum: ["team", "player", "user"],
        required: true,
      },
      ref: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
      },
    },
    kind: {
      type: String,
      enum: ["photo", "video", "article", "story"],
      required: true,
    },
    title: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    body: {
      type: String,
      maxlength: 10000,
      default: "",
    },
    media: [
      {
        url: { type: String, required: true },
        alt: { type: String, default: "" },
      },
    ],
    videoUrl: {
      type: String,
      default: "",
    },
    videoProvider: {
      type: String,
      enum: ["youtube", "facebook", "instagram"],
      default: null,
    },
    videoId: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["published", "pending", "hidden", "removed"],
      default: "published",
      index: true,
    },
    likeCount: { type: Number, default: 0, min: 0 },
    commentCount: { type: Number, default: 0, min: 0 },
    shareCount: { type: Number, default: 0, min: 0 },
    reportCount: { type: Number, default: 0, min: 0 },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
  }
);

// Indexes for feed queries
communityPostSchema.index({ status: 1, createdAt: -1 });
communityPostSchema.index({ "subject.type": 1, "subject.ref": 1, status: 1, createdAt: -1 });
communityPostSchema.index({ authorUser: 1, status: 1, createdAt: -1 });

export default mongoose.model("CommunityPost", communityPostSchema);
