import mongoose from "mongoose";

// Curated location tree used by every cascading country/province/district/
// city/town dropdown. Nodes are deliberately small and cross-referenced by id;
// the free-text `address` fields on the existing models stay untouched so no
// historical value is ever lost (see docs/LOCATIONS.md).
export const LOCATION_TYPES = ["country", "province", "district", "city", "town"];

// Which type a node's parent must have. Enforced in the schema hook *and* by
// the write endpoints, so a bad tree can be rejected before it reaches Mongo.
export const PARENT_TYPE = {
  country: null,
  province: "country",
  district: "province",
  city: "district",
  town: "city",
};

export function normalizeLocationName(value = "") {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

export function locationSlug(value = "") {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const locationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: LOCATION_TYPES,
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    // Lowercased/collapsed name used for the per-parent uniqueness index.
    nameKey: { type: String, required: true, trim: true, maxlength: 120 },
    nameUr: { type: String, default: "", trim: true, maxlength: 160 },
    slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 80 },
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Location",
      default: null,
    },
    // Every ancestor id, root first, parent last. `locationIds` on entities
    // stores the same chain plus the node itself, so one indexed equality
    // match answers "this node or anything below it".
    ancestors: [{ type: mongoose.Schema.Types.ObjectId, ref: "Location" }],
    // Human-readable slug path, e.g. pakistan/punjab/lahore.
    path: { type: String, default: "", index: true },
    aliases: [{ type: String, trim: true, maxlength: 120 }],
    aliasKeys: [{ type: String, trim: true, maxlength: 120 }],
    active: { type: Boolean, default: true },
    // Suggestions enter the tree unapproved and are only visible to their
    // creator (and admins) until approved. Seeded nodes are approved.
    approved: { type: Boolean, default: true },
    source: { type: String, default: "", maxlength: 300 },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    // Set when an admin merges this node into an existing one. The row is kept
    // for audit/history; it is deactivated and never offered again.
    mergedInto: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Location",
      default: null,
    },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

locationSchema.index({ type: 1, parent: 1 });
locationSchema.index({ slug: 1 });
locationSchema.index({ ancestors: 1 });
locationSchema.index({ parent: 1, nameKey: 1 }, { unique: true });
locationSchema.index({ approved: 1, active: 1, type: 1 });

locationSchema.pre("validate", async function normalizeAndValidate() {
  this.name = String(this.name || "").trim();
  this.nameKey = normalizeLocationName(this.name);
  if (!this.slug) this.slug = locationSlug(this.name);
  this.aliases = [...new Set((this.aliases || []).map((alias) => String(alias).trim()).filter(Boolean))];
  this.aliasKeys = [...new Set(this.aliases.map(normalizeLocationName))];

  if (!this.name) throw new Error("Location name is required");
  if (!this.slug) throw new Error("Location slug could not be derived from its name");

  const expectedParentType = PARENT_TYPE[this.type];
  if (!expectedParentType) {
    if (this.parent) throw new Error("A country cannot have a parent");
    this.ancestors = [];
    this.path = this.slug;
    return;
  }

  if (!this.parent) throw new Error(`${this.type} requires a parent ${expectedParentType}`);
  if (this.parent.equals?.(this._id)) throw new Error("A location cannot be its own parent");

  const parent = await mongoose.model("Location").findById(this.parent).select("type ancestors path slug");
  if (!parent) throw new Error("Parent location not found");
  if (parent.type !== expectedParentType) {
    throw new Error(`A ${this.type} must have a ${expectedParentType} parent, got ${parent.type}`);
  }
  if (parent.ancestors.some((id) => id.equals(this._id))) {
    throw new Error("A location cannot be moved below one of its descendants");
  }
  this.ancestors = [...parent.ancestors, parent._id];
  this.path = `${parent.path}/${this.slug}`;
});

export default mongoose.model("Location", locationSchema);
