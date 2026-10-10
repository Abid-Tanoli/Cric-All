import Tournament from "../models/Tournament.js";
import mongoose from "mongoose";
import { recordAudit } from "../utils/audit.js";

const idOf = (value) => String(value?._id || value || "");

/**
 * Owner/admin/superadmin gate for tournament mutation routes (edit, delete,
 * squad, match and fixture generation, group assignment, points update).
 *
 * The creator stored on `Tournament.createdByAdmin` is the "owner"; a
 * superadmin always passes. A non-superadmin admin is allowed for the same
 * operations (the prompt's rule is owner/admin/superadmin), and every decision
 * is audit-logged so the rule can be tightened later without a code change
 * anywhere else.
 *
 * Enforced here in middleware — not in the UI — so no client can bypass it.
 */
export const requireTournamentOwnerOrAdmin = async (req, res, next) => {
  try {
    const candidate =
      req.params.id ||
      req.params.tournamentId ||
      req.body?.tournamentId ||
      req.body?.id;

    if (!candidate || !mongoose.isValidObjectId(candidate)) {
      return res.status(400).json({ message: "Invalid tournament id" });
    }

    const tournament = await Tournament.findById(candidate).select("createdByAdmin name").lean();
    if (!tournament) {
      return res.status(404).json({ message: "Tournament not found" });
    }

    const role = req.user?.role;
    const isSuperAdmin = role === "superadmin";
    const isOwner = req.user && idOf(tournament.createdByAdmin) === idOf(req.user._id);
    const allowed = isSuperAdmin || isOwner || role === "admin";

    recordAudit({
      req,
      action: allowed ? "tournament.mutation_authorized" : "tournament.mutation_denied",
      targetType: "tournament",
      targetId: tournament._id,
      targetLabel: tournament.name,
      metadata: {
        role,
        isOwner,
        allowed,
        route: `${req.method} ${req.originalUrl || req.baseUrl}`,
      },
    });

    if (!allowed) {
      return res.status(403).json({
        message: "Only the tournament creator, an admin or a superadmin can perform this action",
      });
    }

    req.tournamentForAuth = tournament;
    next();
  } catch (error) {
    console.error("Error in tournament owner gate:", error);
    res.status(500).json({ message: "Failed to authorize tournament action" });
  }
};

export default { requireTournamentOwnerOrAdmin };