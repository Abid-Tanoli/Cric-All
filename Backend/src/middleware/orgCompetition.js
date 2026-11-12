import mongoose from "mongoose";
import Tournament from "../models/Tournament.js";
import Series from "../models/Series.js";

// Phase 2 (org-owned competitions): tenant scoping for tournaments and series.
//
// These guards run *after* requireOrgPermission/requireOrgMembership, so
// `req.org` is the organization the caller has already been authorised for.
// Every lookup therefore carries `organizationRef: req.org._id`: another
// tenant's competition is a 404, never a 403, because whether it exists at all
// is not this caller's business.
//
// The controller wrappers reuse the existing Admin tournament/series handlers,
// which read the id from `req.params.id` / `req.params.tournamentId`. The guard
// re-points those parameters at the document it just proved belongs to the org,
// so a route can never be tricked into acting on an unscoped id.

const notFound = (res, label) => res.status(404).json({ message: `${label} not found` });

/**
 * Resolve a tournament owned by `req.org` and expose it to the controller.
 * `param` is the route parameter holding the id (defaults to `tournamentId`,
 * falling back to `id`).
 */
export function requireOrgTournament(param = "tournamentId") {
  return async (req, res, next) => {
    try {
      const id = req.params?.[param] || req.params?.id;
      if (!id || !mongoose.Types.ObjectId.isValid(id)) return notFound(res, "Tournament");

      const tournament = await Tournament.findOne({ _id: id, organizationRef: req.org._id });
      if (!tournament) return notFound(res, "Tournament");

      req.tournament = tournament;
      // Keep the reused Admin handlers pointed at the scoped document.
      req.params.tournamentId = String(tournament._id);
      req.params.id = String(tournament._id);
      return next();
    } catch (err) {
      return res.status(500).json({ message: "Failed to load the tournament" });
    }
  };
}

/** Resolve a series owned by `req.org` and expose it to the controller. */
export function requireOrgSeries(param = "seriesId") {
  return async (req, res, next) => {
    try {
      const id = req.params?.[param] || req.params?.id;
      if (!id || !mongoose.Types.ObjectId.isValid(id)) return notFound(res, "Series");

      const series = await Series.findOne({ _id: id, organizationRef: req.org._id });
      if (!series) return notFound(res, "Series");

      req.series = series;
      req.params.seriesId = String(series._id);
      req.params.id = String(series._id);
      return next();
    } catch (err) {
      return res.status(500).json({ message: "Failed to load the series" });
    }
  };
}

export default { requireOrgTournament, requireOrgSeries };
