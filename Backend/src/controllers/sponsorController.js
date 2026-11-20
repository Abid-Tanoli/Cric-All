import mongoose from "mongoose";
import Sponsor from "../models/Sponsor.js";
import Tournament from "../models/Tournament.js";
import { recordAudit } from "../utils/audit.js";
import { assertSafeSponsorLogo } from "../utils/sponsorImage.js";
import { getPublicUploadUrl } from "./uploadController.js";
import { storeImage } from "../utils/photoStore.js";

// Title sponsors are unique per tournament view; supporting sponsors are
// capped so a strip never turns into a wall of logos. Platform-wide sponsors
// occupy the same slots on every tournament, so they count towards these caps.
export const SPONSOR_LIMITS = Object.freeze({ title: 1, supporting: 6 });
const PUBLIC_FIELDS = "_id name logoUrl linkUrl tier order";

const idOf = (value) => String(value?._id || value || "");
const badRequest = (res, message) => res.status(400).json({ message });
const notFound = (res, message = "Sponsor not found") => res.status(404).json({ message });

const byDisplayOrder = (a, b) =>
  (a.tier === "title" ? 0 : 1) - (b.tier === "title" ? 0 : 1) ||
  (a.order || 0) - (b.order || 0) ||
  idOf(a._id).localeCompare(idOf(b._id));

async function loadTournament(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  return Tournament.findById(id).select("_id name organizationRef").lean();
}

/**
 * Validate the active-sponsor caps for the tournament view a sponsor affects.
 * `exclude` is the id being updated, so an edit that only changes the name is
 * never counted twice against itself.
 */
async function assertWithinLimits(candidate, exclude = null) {
  if (!candidate.active) return;
  const limit = SPONSOR_LIMITS[candidate.tier];

  if (candidate.scope === "tournament") {
    const tournamentId = idOf(candidate.tournamentRef);
    const filter = (query) => ({ active: true, _id: { $ne: exclude }, ...query });
    const [localCount, platformCount] = await Promise.all([
      Sponsor.countDocuments(filter({ scope: "tournament", tournamentRef: tournamentId, tier: candidate.tier })),
      Sponsor.countDocuments(filter({ scope: "platform", tier: candidate.tier })),
    ]);
    if (localCount + platformCount + 1 > limit) {
      throw new Error(
        candidate.tier === "title"
          ? "Only one active title sponsor is allowed per tournament"
          : "Only six active supporting sponsors are allowed per tournament"
      );
    }
    return;
  }

  // A platform-wide sponsor touches every tournament, so the cap has to hold
  // for the busiest tournament after this sponsor is added.
  const [others, tournaments] = await Promise.all([
    Sponsor.find({ active: true, _id: { $ne: exclude } }).select("scope tournamentRef tier").lean(),
    Tournament.find().select("_id").lean(),
  ]);
  for (const tournament of tournaments) {
    const count = others.filter((sponsor) =>
      sponsor.tier === candidate.tier &&
      (sponsor.scope === "platform" || idOf(sponsor.tournamentRef) === idOf(tournament._id))
    ).length;
    if (count + 1 > limit) {
      throw new Error(
        candidate.tier === "title"
          ? "Only one active title sponsor is allowed per tournament"
          : "Only six active supporting sponsors are allowed per tournament"
      );
    }
  }
}

function sponsorPayload(body, req, { scope, tournamentRef, organizationRef }) {
  const isAdmin = req.principalType === "admin";
  return {
    ...body,
    scope,
    tournamentRef: tournamentRef || null,
    organizationRef: organizationRef || null,
    createdBy: isAdmin ? req.user?._id : req.user?._id || null,
    createdByModel: isAdmin ? "Admin" : req.user ? "User" : null,
  };
}

/** Public, cache-friendly read: active sponsors only, no owner/admin fields. */
export const listPublicSponsors = async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const tournament = await loadTournament(tournamentId);
    if (!tournament) return notFound(res, "Tournament not found");

    const sponsors = await Sponsor.find({
      active: true,
      $or: [
        { scope: "platform" },
        { scope: "tournament", tournamentRef: tournament._id },
      ],
    })
      .select(PUBLIC_FIELDS)
      .lean();

    // Title first, then supporting; a string sort on `tier` would put
    // "supporting" ahead of "title" alphabetically.
    sponsors.sort(byDisplayOrder);
    return res.json(sponsors);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load sponsors" });
  }
};

/** Admin-app list. `?tournamentId=` includes that tournament's sponsors plus
 * platform-wide ones; omitting it lists the whole catalog. */
export const listAdminSponsors = async (req, res) => {
  try {
    const tournamentId = req.query?.tournamentId;
    const filter = {};
    if (tournamentId) {
      if (!mongoose.isValidObjectId(tournamentId)) return badRequest(res, "Invalid tournament id");
      filter.$or = [{ scope: "platform" }, { scope: "tournament", tournamentRef: tournamentId }];
    }
    const sponsors = await Sponsor.find(filter).lean();
    sponsors.sort(byDisplayOrder);
    return res.json(sponsors);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load sponsors" });
  }
};

/** Organization-scoped list, used by the owner's tournament detail screen. */
export const listOrgSponsors = async (req, res) => {
  try {
    const sponsors = await Sponsor.find({
      scope: "tournament",
      tournamentRef: req.tournament._id,
      organizationRef: req.org._id,
    })
      .lean();
    sponsors.sort(byDisplayOrder);
    return res.json(sponsors);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load sponsors" });
  }
};

export const createSponsor = async (req, res) => {
  try {
    // Org routes pin the tenant from the verified tournament; only the Admin
    // app may choose a scope or point a sponsor at another tournament.
    const fromOrgRoute = !!req.tournament && !!req.org;
    const scope = fromOrgRoute ? "tournament" : req.body.scope || "tournament";
    const tournamentRef = fromOrgRoute ? req.tournament._id : req.body.tournamentRef || null;
    const organizationRef = fromOrgRoute ? req.org._id : null;
    let tournament = null;

    if (scope === "tournament") {
      tournament = await loadTournament(tournamentRef);
      if (!tournament) return notFound(res, "Tournament not found");
    }

    const candidate = sponsorPayload(req.body, req, {
      scope,
      tournamentRef,
      organizationRef: organizationRef || tournament?.organizationRef || null,
    });
    await assertWithinLimits(candidate);

    const sponsor = await Sponsor.create(candidate);
    return res.status(201).json(sponsor);
  } catch (error) {
    if (/active (title|supporting) sponsor/.test(error.message || "")) return badRequest(res, error.message);
    return res.status(400).json({ message: error.message || "Failed to create sponsor" });
  }
};

export const updateSponsor = async (req, res) => {
  try {
    const sponsor = await Sponsor.findById(req.params.sponsorId);
    if (!sponsor) return notFound(res);

    // Tenant guard also runs on by-id routes; even if it did not, this check
    // makes a cross-org id impossible to mutate through the org router.
    if (req.org && idOf(sponsor.organizationRef) !== idOf(req.org._id)) return notFound(res);
    if (req.tournament && idOf(sponsor.tournamentRef) !== idOf(req.tournament._id)) return notFound(res);

    const next = {
      scope: req.body.scope ?? sponsor.scope,
      tournamentRef: req.body.tournamentRef !== undefined ? req.body.tournamentRef : sponsor.tournamentRef,
      organizationRef: sponsor.organizationRef,
      active: req.body.active ?? sponsor.active,
      tier: req.body.tier ?? sponsor.tier,
    };

    if (req.org) {
      next.scope = "tournament";
      next.tournamentRef = req.tournament._id;
      next.organizationRef = req.org._id;
    } else if (next.scope === "tournament") {
      const tournament = await loadTournament(next.tournamentRef);
      if (!tournament) return notFound(res, "Tournament not found");
      next.organizationRef = tournament.organizationRef || null;
    } else {
      next.tournamentRef = null;
      next.organizationRef = null;
    }

    await assertWithinLimits(next, sponsor._id);
    Object.assign(sponsor, req.body, next);
    await sponsor.save();
    return res.json(sponsor);
  } catch (error) {
    if (/active (title|supporting) sponsor/.test(error.message || "")) return badRequest(res, error.message);
    return res.status(400).json({ message: error.message || "Failed to update sponsor" });
  }
};

/** Deleting a sponsor IS allowed for an org owner/admin (unlike a competition
 * or match deletion) but is always written to the append-only audit log. */
export const deleteSponsor = async (req, res) => {
  try {
    const sponsor = await Sponsor.findById(req.params.sponsorId);
    if (!sponsor) return notFound(res);
    if (req.org && idOf(sponsor.organizationRef) !== idOf(req.org._id)) return notFound(res);
    if (req.tournament && idOf(sponsor.tournamentRef) !== idOf(req.tournament._id)) return notFound(res);

    await sponsor.deleteOne();
    await recordAudit({
      req,
      action: "sponsor.deleted",
      organization: sponsor.organizationRef || null,
      targetType: "sponsor",
      targetId: sponsor._id,
      targetLabel: sponsor.name,
      metadata: {
        scope: sponsor.scope,
        tier: sponsor.tier,
        tournamentRef: idOf(sponsor.tournamentRef) || null,
        via: req.org ? "organization" : "admin",
      },
    });
    return res.json({ message: "Sponsor deleted" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete sponsor" });
  }
};

export const reorderSponsors = async (req, res) => {
  try {
    const ids = req.body.ids.map((id) => new mongoose.Types.ObjectId(id));
    const filter = { _id: { $in: ids } };
    if (req.org) {
      filter.scope = "tournament";
      filter.tournamentRef = req.tournament._id;
      filter.organizationRef = req.org._id;
    }
    const found = await Sponsor.find(filter).select("_id").lean();
    if (found.length !== ids.length) return notFound(res, "One or more sponsors were not found");

    await Promise.all(ids.map((id, index) => Sponsor.updateOne({ _id: id }, { $set: { order: index } })));
    const sponsors = await Sponsor.find(filter).lean();
    sponsors.sort(byDisplayOrder);
    return res.json(sponsors);
  } catch (error) {
    return res.status(400).json({ message: error.message || "Failed to reorder sponsors" });
  }
};

/** Logo upload reuses storeImage (local /uploads + optional cloud adapter),
 * with sponsor-specific byte checks so no executable content is persisted. */
export const uploadSponsorLogo = async (req, res) => {
  try {
    if (!req.file) return badRequest(res, "No image file uploaded");
    const safeBuffer = assertSafeSponsorLogo(req.file.buffer, req.file.mimetype);
    const { url, filename } = await storeImage(safeBuffer, req.file.mimetype, req.file.originalname);
    return res.status(201).json({
      url: `${getPublicUploadUrl(req)}${url}`,
      filename,
      message: "Sponsor logo uploaded successfully",
    });
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message || "Sponsor logo upload failed" });
  }
};

export default {
  SPONSOR_LIMITS,
  listPublicSponsors,
  listAdminSponsors,
  listOrgSponsors,
  createSponsor,
  updateSponsor,
  deleteSponsor,
  reorderSponsors,
  uploadSponsorLogo,
};
