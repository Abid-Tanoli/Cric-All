import mongoose from "mongoose";
import Location from "../models/Location.js";

const LEVELS = ["country", "province", "district", "city", "town"];

/**
 * Resolves a selection of ids ({countryId, provinceId, …}) into the canonical
 * triple stored on every filterable entity:
 *
 *   locationRefs   — one id per level (ancestors are filled in)
 *   locationLabels — denormalized names for display
 *   locationIds    — the whole branch, used by the descendant filter
 *
 * The deepest selected node is authoritative. Passing only `cityId` therefore
 * also fills country/province/district; passing an inconsistent mix cannot
 * produce a branch that does not exist, because the parents come from the
 * chosen node's stored `ancestors` rather than from the request.
 */
export async function resolveLocationSelection(refs = {}) {
  const cleaned = {};
  for (const level of LEVELS) {
    const value = refs?.[`${level}Id`] ?? refs?.[level] ?? null;
    cleaned[`${level}Id`] = value && mongoose.Types.ObjectId.isValid(String(value)) ? String(value) : null;
  }

  const deepest = [...LEVELS].reverse().find((level) => cleaned[`${level}Id`]);
  if (!deepest) {
    return {
      locationRefs: {
        countryId: null,
        provinceId: null,
        districtId: null,
        cityId: null,
        townId: null,
      },
      locationLabels: { country: "", province: "", district: "", city: "", town: "" },
      locationIds: [],
    };
  }

  const node = await Location.findById(cleaned[`${deepest}Id`]).lean();
  if (!node) {
    const error = new Error("Selected location was not found");
    error.status = 400;
    error.code = "LOCATION_NOT_FOUND";
    throw error;
  }

  const branchIds = [...(node.ancestors || []), node._id];
  const nodes = await Location.find({ _id: { $in: branchIds } })
    .select("_id type name")
    .lean();
  const byId = new Map(nodes.map((entry) => [String(entry._id), entry]));

  const locationRefs = {};
  const locationLabels = {};
  for (const level of LEVELS) {
    locationRefs[`${level}Id`] = null;
    locationLabels[level] = "";
  }
  for (const branchId of branchIds) {
    const entry = byId.get(String(branchId));
    if (!entry) continue;
    locationRefs[`${entry.type}Id`] = entry._id;
    locationLabels[entry.type] = entry.name;
  }

  return { locationRefs, locationLabels, locationIds: branchIds };
}

/** Plain display label, e.g. "Lahore, Punjab" — used by API responses. */
export function formatLocationLabel(labels = {}) {
  return [labels.town || labels.city, labels.district, labels.province, labels.country]
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
    .join(", ");
}
