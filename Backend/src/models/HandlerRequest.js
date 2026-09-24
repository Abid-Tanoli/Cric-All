import mongoose from "mongoose";

// A request from a Cricket Handler / Organization Admin user asking for a new
// team or tournament. Admins review pending requests and approve (which
// creates the actual Team/Event and sets `managedBy` to the user) or reject.
const handlerRequestSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    type: {
      type: String,
      enum: ["team", "tournament"],
      required: true
    },
    details: {
      name: { type: String, trim: true, default: "" },
      shortName: { type: String, trim: true, default: "" },
      category: { type: String, default: "Other" },
      organization: { type: String, trim: true, default: "" },
      eventType: { type: String, default: "" },
      format: { type: String, default: "T20" },
      description: { type: String, trim: true, default: "" }
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true
    },
    adminNote: { type: String, trim: true, default: "" },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    decidedAt: { type: Date, default: null },
    resourceType: { type: String, enum: ["Team", "Event", ""], default: "" },
    resourceId: { type: mongoose.Schema.Types.ObjectId, default: null }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

handlerRequestSchema.index({ user: 1, status: 1 });

export default mongoose.model("HandlerRequest", handlerRequestSchema);