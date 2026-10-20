import mongoose from "mongoose";

const communityLikeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CommunityPost",
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Unique per user+post
communityLikeSchema.index({ user: 1, post: 1 }, { unique: true });

export default mongoose.model("CommunityLike", communityLikeSchema);
