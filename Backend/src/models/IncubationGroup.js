import mongoose from "mongoose";

const incubationGroupSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true
    },
    slug: {
      type: String,
      unique: true,
      sparse: true
    },
    description: {
      type: String,
      default: ""
    },
    logo: {
      type: String,
      default: ""
    },
    // Parent organization (e.g., "AL-Khidmat BanoQabil")
    parentOrganization: {
      type: String,
      default: ""
    },
    // Teams belonging to this incubation group
    teams: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team"
    }],
    // Admin/manager of this group
    manager: {
      type: String,
      default: ""
    },
    contactEmail: {
      type: String,
      default: ""
    },
    // Status
    status: {
      type: String,
      enum: ["active", "inactive", "archived"],
      default: "active"
    },
    // Metadata
    tags: [{
      type: String
    }],
    images: [{
      url: String,
      caption: String,
      addedAt: Date
    }],
    videos: [{
      url: String,
      title: String,
      addedAt: Date
    }],
    // Blogs/articles related to this incubation group
    blogs: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Blog"
    }]
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Auto-generate slug
incubationGroupSchema.pre('save', async function () {
  if (this.isNew && !this.slug && this.name) {
    const randomStr = Math.random().toString(36).substring(2, 8);
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') + '-' + randomStr;
  }
});

incubationGroupSchema.index({ parentOrganization: 1 });

export default mongoose.model("IncubationGroup", incubationGroupSchema);
