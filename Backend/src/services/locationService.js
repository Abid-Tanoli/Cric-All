import mongoose from "mongoose";
import Location, {
  LOCATION_TYPES,
  PARENT_TYPE,
  locationSlug,
  normalizeLocationName,
} from "../models/Location.js";

const PUBLIC_FIELDS = "_id type name nameUr slug parent path aliases approved active source createdAt";

// A tiny process-local cache. Public location reads are extremely hot (every
// cascading dropdown opens with the same five requests), and the tree changes
// only through admin actions, which bump the version. No external cache or
// service is involved.
const CACHE_TTL_MS = 60_000;
let cacheVersion = 0;
const cache = new Map();

export function bumpLocationCache() {
  cacheVersion += 1;
  cache.clear();
}

function cached(key, loader) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.version === cacheVersion && hit.expires > now) return hit.value;
  const promise = Promise.resolve().then(loader);
  cache.set(key, { version: cacheVersion, expires: now + CACHE_TTL_MS, value: promise });
  promise.catch(() => cache.delete(key));
  return promise;
}

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function isValidLocationType(type) {
  return LOCATION_TYPES.includes(type);
}

/** Resolves a query value that may be an ObjectId or a slug to one node. */
export async function findLocationNode(value, { type } = {}) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const clauses = [];
  if (mongoose.Types.ObjectId.isValid(raw) && String(new mongoose.Types.ObjectId(raw)) === raw) {
    clauses.push({ _id: raw });
  }
  clauses.push({ slug: raw.toLowerCase() });
  const query = { $or: clauses, active: true, approved: true };
  if (type && isValidLocationType(type)) query.type = type;
  return Location.findOne(query).sort({ createdAt: 1 }).lean();
}

/**
 * Turns `?country=&province=&district=&city=&town=` (ids or slugs) into Mongo
 * clauses. Each resolved node matches an entity whose `locationIds` chain
 * contains it, which is exactly "this node or any descendant".
 *
 * An unknown value yields a clause that matches nothing rather than silently
 * dropping the filter (a dropped filter would widen results unexpectedly).
 */
export async function buildLocationFilterClauses(params = {}) {
  const clauses = [];
  for (const level of ["country", "province", "district", "city", "town"]) {
    const value = params[level];
    if (value === undefined || value === null || String(value).trim() === "") continue;
    const node = await findLocationNode(value, { type: level });
    clauses.push({ locationIds: node ? node._id : null });
  }
  return clauses;
}

export function buildPublicLocationQuery({ type, parent, q, ids } = {}) {
  const query = { active: true, approved: true, mergedInto: null };

  if (type !== undefined && type !== "" && type !== null) {
    if (!isValidLocationType(type)) {
      const error = new Error(`type must be one of: ${LOCATION_TYPES.join(", ")}`);
      error.status = 400;
      error.code = "INVALID_LOCATION_TYPE";
      throw error;
    }
    query.type = type;
  }

  if (ids) {
    const list = String(ids)
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (list.length === 0 || list.length > 50 || list.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
      const error = new Error("ids must be a comma-separated list of at most 50 location ids");
      error.status = 400;
      error.code = "INVALID_LOCATION_IDS";
      throw error;
    }
    query._id = { $in: list };
    return query;
  }

  if (parent !== undefined) {
    const raw = String(parent || "").trim();
    if (raw === "" || raw === "root" || raw === "null") {
      query.parent = null;
    } else {
      if (!mongoose.Types.ObjectId.isValid(raw)) {
        const error = new Error("parent must be a location id, or 'root'");
        error.status = 400;
        error.code = "INVALID_LOCATION_PARENT";
        throw error;
      }
      query.parent = raw;
    }
  }

  if (q !== undefined && q !== null && String(q).trim() !== "") {
    const term = String(q).trim();
    if (term.length > 80) {
      const error = new Error("q must be 80 characters or fewer");
      error.status = 400;
      error.code = "INVALID_LOCATION_QUERY";
      throw error;
    }
    const pattern = new RegExp(escapeRegex(term), "i");
    query.$or = [{ name: pattern }, { aliases: pattern }];
  }

  return query;
}

export async function listPublicLocations({ type, parent, q, ids, limit } = {}) {
  const query = buildPublicLocationQuery({ type, parent, q, ids });
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const key = JSON.stringify({ type, parent, q, ids, limit: safeLimit });
  return cached(key, () =>
    Location.find(query).select(PUBLIC_FIELDS).sort({ name: 1 }).limit(safeLimit).maxTimeMS(4000).lean()
  );
}

export async function getLocationPath(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const node = await Location.findById(id).select(PUBLIC_FIELDS).lean();
  if (!node) return null;
  const ancestorIds = node.ancestors || [];
  if (ancestorIds.length === 0) return [node];
  const ancestors = await Location.find({ _id: { $in: ancestorIds } })
    .select(PUBLIC_FIELDS)
    .lean();
  const byId = new Map(ancestors.map((entry) => [String(entry._id), entry]));
  const ordered = ancestorIds.map((ancestorId) => byId.get(String(ancestorId))).filter(Boolean);
  return [...ordered, node];
}

export function sanitizeSuggestedName(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/**
 * Creates (or returns) an unapproved sibling under `parentId`. Unapproved
 * nodes are invisible to everyone except their creator and platform admins,
 * so a suggestion can be attached to the submitter's record immediately.
 */
export async function suggestLocation({ name, type, parentId, nameUr = "", user }) {
  const cleanName = sanitizeSuggestedName(name);
  if (cleanName.length < 2) {
    const error = new Error("Enter a place name of at least two characters");
    error.status = 400;
    error.code = "INVALID_LOCATION_NAME";
    throw error;
  }
  if (!isValidLocationType(type) || type === "country") {
    const error = new Error("Suggest a province, district, city or town");
    error.status = 400;
    error.code = "INVALID_LOCATION_TYPE";
    throw error;
  }
  const expectedParentType = PARENT_TYPE[type];
  if (!expectedParentType) {
    const error = new Error("This location type cannot be suggested");
    error.status = 400;
    error.code = "INVALID_LOCATION_TYPE";
    throw error;
  }
  if (!mongoose.Types.ObjectId.isValid(String(parentId || ""))) {
    const error = new Error("A valid parent location is required");
    error.status = 400;
    error.code = "INVALID_LOCATION_PARENT";
    throw error;
  }

  const parent = await Location.findOne({ _id: parentId, active: true, approved: true }).lean();
  if (!parent) {
    const error = new Error("Parent location not found");
    error.status = 404;
    error.code = "LOCATION_PARENT_NOT_FOUND";
    throw error;
  }
  if (parent.type !== expectedParentType) {
    const error = new Error(`A ${type} must sit under a ${expectedParentType}`);
    error.status = 400;
    error.code = "INVALID_LOCATION_PARENT";
    throw error;
  }

  const nameKey = normalizeLocationName(cleanName);
  const existing = await Location.findOne({ parent: parent._id, nameKey }).lean();
  if (existing) {
    return { location: existing, existing: true };
  }

  const location = await Location.create({
    type,
    name: cleanName,
    nameKey,
    nameUr: String(nameUr || "").trim().slice(0, 160),
    slug: locationSlug(cleanName),
    parent: parent._id,
    active: true,
    approved: false,
    source: "User suggestion",
    createdBy: user?._id || null,
  });

  bumpLocationCache();
  return { location: location.toObject(), existing: false };
}
