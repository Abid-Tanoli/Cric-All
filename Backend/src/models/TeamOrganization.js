import mongoose from "mongoose";

const teamOrganizationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "TeamCategory",
  },
  shortName: {
    type: String,
    default: "",
  },
  logoUrl: {
    type: String,
    default: "",
  },
  description: {
    type: String,
    default: "",
  },
  website: {
    type: String,
    default: "",
  },
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "TeamOrganization",
    default: null,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, { timestamps: true });

teamOrganizationSchema.virtual('children', {
  ref: 'TeamOrganization',
  localField: '_id',
  foreignField: 'parent',
});

teamOrganizationSchema.index({ name: 1 });
teamOrganizationSchema.index({ category: 1 });
teamOrganizationSchema.index({ parent: 1 });

export default mongoose.model("TeamOrganization", teamOrganizationSchema);
