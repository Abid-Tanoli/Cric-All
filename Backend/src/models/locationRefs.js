import mongoose from "mongoose";

// Additive location reference block shared by every entity that can be
// filtered by place. The legacy free-text fields (`address`, `location.city`,
// `content.city`) are untouched and remain the fallback display value.
//
//   locationRefs   — the id of the node chosen at each level (prefill + display)
//   locationLabels — denormalized names, so a list never needs five lookups
//   locationIds    — every node on the chosen branch (root … chosen node); one
//                    indexed equality match answers "this node or any descendant"
export function locationRefFields() {
  return {
    locationRefs: {
      countryId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", default: null },
      provinceId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", default: null },
      districtId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", default: null },
      cityId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", default: null },
      townId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", default: null },
    },
    locationLabels: {
      country: { type: String, default: "" },
      province: { type: String, default: "" },
      district: { type: String, default: "" },
      city: { type: String, default: "" },
      town: { type: String, default: "" },
    },
    locationIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Location" }],
  };
}

export function locationRefIndexes(schema) {
  schema.index({ locationIds: 1 });
  schema.index({ "locationRefs.countryId": 1 });
  schema.index({ "locationRefs.provinceId": 1 });
  schema.index({ "locationRefs.districtId": 1 });
  schema.index({ "locationRefs.cityId": 1 });
  schema.index({ "locationRefs.townId": 1 });
  locationRefPlugin(schema);
}

// Installed by every model that stores locationRefs. Resolution happens on the
// server so the denormalized labels and the ancestor chain can never disagree
// with the tree, whatever the client sends.
async function applyResolvedLocation(target) {
  const { resolveLocationSelection } = await import("../utils/locationTree.js");
  const resolved = await resolveLocationSelection(target.locationRefs || {});
  target.locationRefs = resolved.locationRefs;
  target.locationLabels = resolved.locationLabels;
  target.locationIds = resolved.locationIds;
}

export function locationRefPlugin(schema) {
  schema.pre("save", async function resolveLocationOnSave() {
    if (!this.isNew && !this.isModified("locationRefs")) return;
    await applyResolvedLocation(this);
  });

  schema.pre(["findOneAndUpdate", "updateOne", "updateMany"], async function resolveLocationOnUpdate() {
    const update = this.getUpdate();
    if (!update) return;
    const refs = update.$set?.locationRefs || update.locationRefs;
    if (!refs) return;

    const { resolveLocationSelection } = await import("../utils/locationTree.js");
    const resolved = await resolveLocationSelection(refs);
    const next = {
      ...update,
      $set: {
        ...(update.$set || {}),
        locationRefs: resolved.locationRefs,
        locationLabels: resolved.locationLabels,
        locationIds: resolved.locationIds,
      },
    };
    delete next.locationRefs;
    this.setUpdate(next);
  });
}

export default locationRefFields;
