import mongoose from "mongoose";
import Location from "../models/Location.js";
import Team from "../models/Team.js";
import TeamOrganization from "../models/TeamOrganization.js";
import Player from "../models/Player.js";
import Tournament from "../models/Tournament.js";
import Match from "../models/Match.js";
import Event from "../models/Event.js";
import { recordAudit } from "../utils/audit.js";
import {
  bumpLocationCache,
  getLocationPath,
  listPublicLocations,
  suggestLocation,
} from "../services/locationService.js";

const pickPublic = (row) => ({
  _id: row._id,
  type: row.type,
  name: row.name,
  nameUr: row.nameUr || "",
  slug: row.slug,
  parent: row.parent || null,
  path: row.path || "",
  aliases: row.aliases || [],
  approved: row.approved !== false,
  active: row.active !== false,
});

export const getLocations = async (req, res) => {
  try {
    const rows = await listPublicLocations({
      type: req.query.type,
      parent: req.query.parent,
      q: req.query.q,
      ids: req.query.ids,
      limit: req.query.limit,
    });
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    res.status(200).json({ locations: rows.map(pickPublic), count: rows.length });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ message: error.message, code: error.code });
  }
};

export const getLocationPathById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid location id", code: "INVALID_LOCATION_ID" });
    }
    const path = await getLocationPath(req.params.id);
    if (!path || path.length === 0) {
      return res.status(404).json({ message: "Location not found", code: "LOCATION_NOT_FOUND" });
    }
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    res.status(200).json({ path: path.map(pickPublic) });
  } catch (error) {
    res.status(500).json({ message: "Failed to load the location path", error: error.message });
  }
};

export const postLocationSuggestion = async (req, res) => {
  try {
    // `protect` already blocks anonymous calls at the router; this keeps the
    // controller safe if it is ever mounted somewhere else.
    if (!req.user) {
      return res.status(401).json({ message: "Not authorized, no token" });
    }
    const { name, type, parentId, nameUr } = req.body || {};
    const { location, existing } = await suggestLocation({
      name,
      type,
      parentId,
      nameUr,
      user: req.user,
    });
    if (!existing) {
      await recordAudit({
        req,
        action: "location.suggested",
        targetType: "location",
        targetId: location._id,
        targetLabel: location.name,
        metadata: { type: location.type, parent: String(location.parent) },
      });
    }
    // Unapproved on purpose: the submitter may use it on their own record, but
    // it does not appear in any public dropdown until an admin approves it.
    res.status(existing ? 200 : 201).json({ location: pickPublic(location), existing });
  } catch (error) {
    res.status(error.status || 400).json({ message: error.message, code: error.code });
  }
};

// --- admin -------------------------------------------------------------------

export const adminListLocations = async (req, res) => {
  try {
    const query = {};
    if (req.query.type) {
      if (!["country", "province", "district", "city", "town"].includes(req.query.type)) {
        return res.status(400).json({ message: "Invalid location type", code: "INVALID_LOCATION_TYPE" });
      }
      query.type = req.query.type;
    }
    if (req.query.approved !== undefined) query.approved = req.query.approved === "true";
    if (req.query.active !== undefined) query.active = req.query.active === "true";
    if (req.query.parent !== undefined) {
      const raw = String(req.query.parent || "");
      if (raw === "" || raw === "root") query.parent = null;
      else if (mongoose.Types.ObjectId.isValid(raw)) query.parent = raw;
      else return res.status(400).json({ message: "Invalid parent", code: "INVALID_LOCATION_PARENT" });
    }
    if (req.query.q) {
      const term = String(req.query.q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = [{ name: new RegExp(term, "i") }, { aliases: new RegExp(term, "i") }];
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    const rows = await Location.find(query).sort({ type: 1, name: 1 }).limit(limit).lean();
    res.status(200).json({ locations: rows.map((row) => ({ ...pickPublic(row), source: row.source, mergedInto: row.mergedInto || null, createdBy: row.createdBy || null })), count: rows.length });
  } catch (error) {
    res.status(500).json({ message: "Failed to list locations", error: error.message });
  }
};

export const adminListSuggestions = async (req, res) => {
  try {
    const rows = await Location.find({ approved: false, mergedInto: null })
      .sort({ createdAt: 1 })
      .limit(500)
      .populate("createdBy", "name email")
      .lean();
    res.status(200).json({
      locations: rows.map((row) => ({
        ...pickPublic(row),
        source: row.source,
        createdAt: row.createdAt,
        createdBy: row.createdBy ? { _id: row.createdBy._id, name: row.createdBy.name, email: row.createdBy.email } : null,
      })),
      count: rows.length,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to list suggestions", error: error.message });
  }
};

export const adminCreateLocation = async (req, res) => {
  try {
    const { type, name, nameUr, parent, aliases, source } = req.body || {};
    const location = await Location.create({
      type,
      name,
      nameUr,
      parent: parent || null,
      aliases: Array.isArray(aliases) ? aliases : [],
      source: source || "Created by admin",
      approved: true,
      active: true,
      createdBy: req.user?._id || null,
    });
    bumpLocationCache();
    await recordAudit({
      req,
      action: "location.created",
      targetType: "location",
      targetId: location._id,
      targetLabel: location.name,
      metadata: { type: location.type, parent: location.parent ? String(location.parent) : null },
    });
    res.status(201).json({ location: pickPublic(location.toObject()) });
  } catch (error) {
    const duplicate = error.code === 11000;
    res.status(duplicate ? 409 : 400).json({
      message: duplicate ? "A location with that name already exists under this parent." : error.message,
      code: duplicate ? "LOCATION_NAME_TAKEN" : "LOCATION_INVALID",
    });
  }
};

export const adminUpdateLocation = async (req, res) => {
  try {
    const location = await Location.findById(req.params.id);
    if (!location) return res.status(404).json({ message: "Location not found" });

    const before = { name: location.name, active: location.active, approved: location.approved };
    if (req.body.name !== undefined) location.name = req.body.name;
    if (req.body.nameUr !== undefined) location.nameUr = req.body.nameUr;
    if (req.body.aliases !== undefined) location.aliases = Array.isArray(req.body.aliases) ? req.body.aliases : [];
    if (req.body.active !== undefined) location.active = Boolean(req.body.active);
    if (req.body.approved !== undefined) location.approved = Boolean(req.body.approved);
    if (req.body.source !== undefined) location.source = String(req.body.source).slice(0, 300);
    await location.save();

    bumpLocationCache();
    await recordAudit({
      req,
      action: "location.updated",
      targetType: "location",
      targetId: location._id,
      targetLabel: location.name,
      metadata: {
        before,
        after: { name: location.name, active: location.active, approved: location.approved },
      },
    });
    res.status(200).json({ location: pickPublic(location.toObject()) });
  } catch (error) {
    const duplicate = error.code === 11000;
    res.status(duplicate ? 409 : 400).json({
      message: duplicate ? "A location with that name already exists under this parent." : error.message,
      code: duplicate ? "LOCATION_NAME_TAKEN" : "LOCATION_INVALID",
    });
  }
};

export const adminApproveLocation = async (req, res) => {
  try {
    const location = await Location.findById(req.params.id);
    if (!location) return res.status(404).json({ message: "Location not found" });
    location.approved = true;
    location.active = true;
    await location.save();
    bumpLocationCache();
    await recordAudit({
      req,
      action: "location.approved",
      targetType: "location",
      targetId: location._id,
      targetLabel: location.name,
      metadata: { type: location.type },
    });
    res.status(200).json({ location: pickPublic(location.toObject()) });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const adminRejectLocation = async (req, res) => {
  try {
    const location = await Location.findById(req.params.id);
    if (!location) return res.status(404).json({ message: "Location not found" });
    if (location.approved) {
      return res.status(409).json({
        message: "An approved location cannot be rejected; deactivate it instead.",
        code: "LOCATION_ALREADY_APPROVED",
      });
    }
    const snapshot = { name: location.name, type: location.type, parent: location.parent };
    await Location.deleteOne({ _id: location._id });
    bumpLocationCache();
    await recordAudit({
      req,
      action: "location.rejected",
      targetType: "location",
      targetId: location._id,
      targetLabel: snapshot.name,
      metadata: { ...snapshot, parent: snapshot.parent ? String(snapshot.parent) : null },
    });
    res.status(200).json({ message: "Suggestion rejected", _id: location._id });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Merge rewrites every stored reference to the source node, then removes it.
// The source may be a suggestion or an approved duplicate. Nothing else about
// the records is touched.
export const adminMergeLocation = async (req, res) => {
  try {
    const source = await Location.findById(req.params.id);
    const targetId = req.body?.intoId;
    if (!source) return res.status(404).json({ message: "Source location not found" });
    if (!mongoose.Types.ObjectId.isValid(String(targetId || ""))) {
      return res.status(400).json({ message: "intoId must be a location id", code: "INVALID_LOCATION_TARGET" });
    }
    if (String(source._id) === String(targetId)) {
      return res.status(400).json({ message: "Cannot merge a location into itself" });
    }
    const target = await Location.findOne({ _id: targetId, active: true, approved: true }).lean();
    if (!target) return res.status(404).json({ message: "Target location not found" });
    if (target.type !== source.type) {
      return res.status(400).json({ message: "Both locations must be the same type to merge" });
    }

    const models = [Team, TeamOrganization, Player, Tournament, Match, Event];
    const rewritten = {};
    for (const Model of models) {
      const sourceRefField = `locationRefs.${source.type}Id`;
      const namesField = `locationLabels.${source.type}`;
      const update = {
        $set: {
          [sourceRefField]: target._id,
          [namesField]: target.name,
        },
        $addToSet: { locationIds: target._id },
      };
      const filter = { locationIds: source._id };
      const result = await Model.updateMany(filter, update);
      // Replace the id inside the chain without touching any other ancestor.
      await Model.updateMany(filter, { $pull: { locationIds: source._id } });
      rewritten[Model.modelName] = result.modifiedCount;
    }

    await Location.deleteOne({ _id: source._id });
    bumpLocationCache();
    await recordAudit({
      req,
      action: "location.merged",
      targetType: "location",
      targetId: target._id,
      targetLabel: target.name,
      metadata: { sourceId: String(source._id), sourceName: source.name, rewritten },
    });
    res.status(200).json({ message: "Locations merged", into: pickPublic(target), rewritten });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};
