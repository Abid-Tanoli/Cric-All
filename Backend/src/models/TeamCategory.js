import mongoose from "mongoose";

const teamCategorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    enum: ["School", "College", "University", "Organization", "Business", "Industry", "Club", "Corporate", "Academy", "International", "Other"],
  },
  slug: {
    type: String,
    unique: true,
    required: true,
    lowercase: true,
  },
  icon: {
    type: String,
    default: "",
  },
  description: {
    type: String,
    default: "",
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, { timestamps: true });

teamCategorySchema.statics.getDefaultCategories = function () {
  return [
    { name: "School", slug: "school", icon: "🏫", description: "School teams" },
    { name: "College", slug: "college", icon: "🎓", description: "College teams" },
    { name: "University", slug: "university", icon: "🏛️", description: "University teams" },
    { name: "Organization", slug: "organization", icon: "🏢", description: "Organizations & institutions" },
    { name: "Business", slug: "business", icon: "💼", description: "Business teams" },
    { name: "Industry", slug: "industry", icon: "🏭", description: "Industry teams" },
    { name: "Club", slug: "club", icon: "🏏", description: "Cricket clubs" },
    { name: "Corporate", slug: "corporate", icon: "🏢", description: "Corporate teams" },
    { name: "Academy", slug: "academy", icon: "⭐", description: "Cricket academies" },
    { name: "International", slug: "international", icon: "🌍", description: "International/national teams" },
    { name: "Other", slug: "other", icon: "📋", description: "Other teams" },
  ];
};

teamCategorySchema.statics.seedDefaults = async function () {
  const defaults = this.getDefaultCategories();
  for (const cat of defaults) {
    await this.findOneAndUpdate(
      { slug: cat.slug },
      { $setOnInsert: cat },
      { upsert: true, new: true }
    );
  }
};

export default mongoose.model("TeamCategory", teamCategorySchema);
