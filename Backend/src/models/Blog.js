import mongoose from "mongoose";

const blogSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true
    },
    content: {
      type: String,
      required: true
    },
    author: {
      type: String,
      default: "Admin"
    },
    imageUrl: {
      type: String,
      default: ""
    },
    videoUrl: {
      type: String,
      default: ""
    },
    isLive: {
      type: Boolean,
      default: false
    },
    relatedType: {
      type: String,
      enum: ["General", "Match", "Player", "Tournament", "Venue", "Team"],
      default: "General"
    },
    relatedId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'relatedType'
    },
    tags: [String]
  },
  {
    timestamps: true
  }
);

export default mongoose.model("Blog", blogSchema);
