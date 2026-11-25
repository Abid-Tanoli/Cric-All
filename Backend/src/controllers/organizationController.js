import TeamOrganization from "../models/TeamOrganization.js";
import TeamCategory from "../models/TeamCategory.js";
import Team from "../models/Team.js";
import Match from "../models/Match.js";
import Membership from "../models/Membership.js";
import Invitation from "../models/Invitation.js";
import { getPlatformSettings } from "../models/SystemSettings.js";
import * as teamService from "../services/teamService.js";
import { isPlatformAdmin, resolveOrgAccess } from "../middleware/orgAccess.js";
import { generateOrgSlug, upsertMembership } from "../services/membershipService.js";
import { permissionsForRoles } from "../permissions/orgPermissions.js";
import { recordAudit } from "../utils/audit.js";
import { buildLocationFilterClauses } from "../services/locationService.js";
import { getTeamPlayerRankings } from "../services/rankingService.js";
import {
  RECENT_MATCH_LIMIT,
  UPCOMING_MATCH_LIMIT,
  UPCOMING_MATCH_STATUSES,
  buildTopPerformers,
} from "../services/teamService.js";
import { invalidFilterResponse, parseFilter } from "../services/orgTypeFilterService.js";
import {
  OrgTypeValidationError,
  canRequestVerification,
  effectiveOrgType,
  isSensitiveVerificationChange,
  mapLegacyTypeToOrgType,
  normalizeLegacyType,
  orgTypeQuery,
  orgTypesQuery,
  resolveCreateFields,
  resolveUpdateFields,
} from "../services/organizationService.js";
import {
  MATCH_CARD_SELECT,
  PLAYER_ROSTER_SELECT,
  PUBLIC_MATCH_FILTER,
  TEAM_PUBLIC_SELECT,
  hiddenTeamIds,
  resolveViewerContext,
  sanitizeOrganizationPublic,
  sanitizeOrganizationsPublic,
  sanitizeTeamPublic,
  sanitizeTeamsPublic,
  reservedNamesMongoClause,
  publicTeamClause,
} from "../utils/publicProjection.js";

// Fields a self-service org owner/admin may change. isActive, parent, category
// and verificationStatus are supervisory — only the platform Admin app may set
// them (an org may re-parent itself under an org it already manages, which is
// handled separately in the controller).
const SELF_SERVICE_FIELDS = [
  "name", "shortName", "logoUrl", "coverUrl", "description", "website",
  "type", "orgType", "typeDetails", "foundedYear", "location", "contact", "socialLinks", "privacy",
  "locationRefs", "locationLabels", "isPublic",
];
const SUPERVISORY_FIELDS = [
  "isActive", "parent", "category", "verificationStatus",
  "verificationNote", "verifiedBy", "verifiedAt",
];

const toPlain = (doc) => (typeof doc?.toObject === "function" ? doc.toObject() : { ...doc });

// The deprecated inline array still has to serialize for the Admin app, but the
// authoritative count comes from Membership.
function withMembershipSummary(org, membershipCount) {
  const plain = toPlain(org);
  const count = membershipCount ?? (plain.members || []).length + (plain.owner ? 1 : 0);
  return { ...plain, memberCount: count };
}

async function assertTypeIsConfigured(type) {
  if (!type) return;
  const normalized = normalizeLegacyType(type);
  // The new enum has values that are deliberately not TeamCategories
  // (local_club, company, foundation). Their mapped legacy slugs are in this
  // table, so they are valid even when an older database has no such category.
  if (mapLegacyTypeToOrgType(normalized).mapped) return;
  const found = await TeamCategory.findOne({
    $or: [{ slug: normalized }, { name: { $regex: `^${String(type).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } }],
  }).lean();
  if (!found) {
    const error = new Error("Unknown organization type");
    error.status = 422;
    error.code = "ORG_TYPE_UNKNOWN";
    throw error;
  }
}

/** Shared error translation for the per-type validation service. */
function orgTypeError(res, error, action) {
  if (error instanceof OrgTypeValidationError || error.code === "ORG_TYPE_UNKNOWN") {
    return res.status(error.status || 422).json({ message: error.message, code: error.code });
  }
  if (error.code === 11000) {
    return res.status(409).json({ message: "That organization slug is taken.", code: "ORG_SLUG_TAKEN" });
  }
  return res.status(400).json({ message: `Failed to ${action} organization`, error: error.message });
}

export const listOrganizations = async (req, res) => {
  try {
    const { category, type, orgType, verificationStatus, search, page, limit } = req.query;
    let orgTypeValues;
    try {
      orgTypeValues = parseFilter(orgType);
    } catch (error) {
      return invalidFilterResponse(res, error);
    }
    const locationClauses = await buildLocationFilterClauses(req.query);
    const viewer = await resolveViewerContext(req);
    // The public directory lists active organizations only. The Admin app is
    // supervisory and must also see deactivated ones, otherwise an operator
    // cannot reactivate them — or hand one over — once it has been switched off.
    const query = viewer.isPlatformAdmin ? {} : { isActive: true };
    // Fix B: the public directory does not list fixtures. The Admin app (which
    // is where an operator looks for them) authenticates and is exempt.
    if (!viewer.isPlatformAdmin) Object.assign(query, reservedNamesMongoClause("name"));
    if (category) query.category = category;
    // The review queue is supervisory: only a platform admin may filter by it.
    if (viewer.isPlatformAdmin && verificationStatus) {
      query.verificationStatus = String(verificationStatus).trim();
    }
    const clauses = [];
    const typeClause = orgTypeValues.length ? orgTypesQuery(orgTypeValues) : orgTypeQuery(type);
    if (typeClause) clauses.push(typeClause);
    if (search) {
      // Escape the term so a user searching "cric." cannot inject an operator.
      const term = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (term) clauses.push({ $or: [{ name: new RegExp(term, "i") }, { shortName: new RegExp(term, "i") }] });
    }
    clauses.push(...locationClauses);
    if (clauses.length) query.$and = clauses;

    const safePage = Math.max(Number(page) || 1, 1);
    const safeLimit = Math.min(Math.max(Number(limit) || 120, 1), 500);

    const [orgs, total] = await Promise.all([
      TeamOrganization.find(query)
        .populate("category", "name slug icon")
        .populate("owner", "name")
        .sort({ name: 1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean(),
      TeamOrganization.countDocuments(query),
    ]);

    // The summary counts follow the same rule as the list: a guest is not told
    // how many hidden branches an organization keeps, only how many it shows.
    const branchQuery = (orgId) => {
      const q = { organizationRef: orgId, isActive: true };
      if (!viewer.isPlatformAdmin) Object.assign(q, publicTeamClause());
      return q;
    };

    const counts = await membershipCounts(orgs.map((o) => o._id));
    const orgsWithCounts = await Promise.all(
      orgs.map(async (org) => {
        const branchCount = await Team.countDocuments(branchQuery(org._id));
        const totalPlayers = await Team.aggregate([
          { $match: branchQuery(org._id) },
          { $project: { playerCount: { $size: { $ifNull: ["$players", []] } } } },
          { $group: { _id: null, total: { $sum: "$playerCount" } } },
        ]);
        return {
          ...org,
          memberCount: counts.get(String(org._id)) || 0,
          branchCount,
          totalPlayers: totalPlayers[0]?.total || 0,
        };
      })
    );

    res.status(200).json({
      items: viewer.isPlatformAdmin
        ? orgsWithCounts
        : sanitizeOrganizationsPublic(orgsWithCounts, { canViewPrivate: false }),
      total,
      page: safePage,
      limit: safeLimit,
      pages: Math.max(Math.ceil(total / safeLimit), 1),
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch organizations", error: error.message });
  }
};

/** One query for the member counts of a page of organizations. */
async function membershipCounts(orgIds) {
  if (orgIds.length === 0) return new Map();
  const rows = await Membership.aggregate([
    { $match: { organization: { $in: orgIds }, status: "active" } },
    { $group: { _id: "$organization", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

export const getOrganization = async (req, res) => {
  try {
    const org = await TeamOrganization.findById(req.params.id)
      .populate("category", "name slug icon")
      .populate("owner", "name email")
      .lean();
    if (!org) return res.status(404).json({ message: "Organization not found" });

    const viewer = await resolveViewerContext(req);
    const canSeePrivate =
      viewer.isPlatformAdmin || viewer.managedOrgIds.has(String(org._id));

    // Fix B: the public organization page shows the branches the owner chose to
    // publish — hidden teams and fixtures included only for someone who could
    // manage them. The roster is a named projection (it used to load whole
    // Player documents here) and the branches go through the shared sanitizer,
    // so this path cannot become the one place privacy flags are ignored.
    const branchQuery = { organizationRef: org._id, isActive: true };
    if (!canSeePrivate) Object.assign(branchQuery, publicTeamClause());
    const branches = await Team.find(branchQuery)
      .select(canSeePrivate ? undefined : TEAM_PUBLIC_SELECT)
      .populate("players", PLAYER_ROSTER_SELECT)
      .populate("categoryRef", "name slug icon");

    const members = await Membership.find({ organization: org._id, status: "active" })
      .populate("user", "name email accountType")
      .sort({ createdAt: 1 })
      .lean();

    res.status(200).json({
      organization: canSeePrivate
        ? { ...org, orgType: org.orgType || mapLegacyTypeToOrgType(org.type).orgType, memberCount: members.length }
        : sanitizeOrganizationPublic({ ...org, memberCount: members.length }, { canViewPrivate: false }),
      branches: canSeePrivate ? branches : sanitizeTeamsPublic(branches, { viewer }),
      members: members.map((m) => ({
        _id: m._id,
        roles: m.roles,
        user: m.user
          ? { _id: m.user._id, name: m.user.name, accountType: m.user.accountType }
          : null,
      })),
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch organization", error: error.message });
  }
};

export const createOrganization = async (req, res) => {
  try {
    const payload = { ...req.body };
    const createDefaultTeam = payload.createDefaultTeam !== false;
    delete payload.createDefaultTeam;
    const platform = isPlatformAdmin(req);
    const settings = await getPlatformSettings();

    // One place resolves the new enum, its legacy twin and the per-type details.
    const resolved = resolveCreateFields(payload);
    if (!payload.orgType && payload.type) await assertTypeIsConfigured(payload.type);
    Object.assign(payload, resolved);

    if (!platform) {
      // Self-service: the caller owns what they create. Supervisory fields
      // cannot be set from this path.
      delete payload.isActive;
      delete payload.verificationStatus;
      delete payload.verificationNote;
      delete payload.verifiedBy;
      delete payload.verifiedAt;
      delete payload.members;
      payload.owner = req.user._id;
      payload.createdBy = req.user._id;

      if (payload.parent) {
        const parent = await TeamOrganization.findById(payload.parent);
        if (!parent) return res.status(404).json({ message: "Parent organization not found" });
        const parentAccess = await resolveOrgAccess(parent, req.user);
        const allowed = parentAccess.roles.includes("owner") || parentAccess.roles.includes("admin");
        if (!allowed) {
          return res.status(403).json({
            message: "You can only create sub-organizations under organizations you manage.",
            code: "ORG_PARENT_FORBIDDEN",
          });
        }
      }
    } else {
      payload.createdBy = payload.createdBy || req.user?._id || null;
    }

    // `requireOrgApproval` is the platform switch that puts admin approval back
    // on the path. It is off by default, which is the whole point of Phase 2.
    if (!platform) {
      payload.verificationStatus = settings.requireOrgApproval ? "pending" : "unverified";
    }
    payload.slug = await generateOrgSlug(payload.slug || payload.name);

    const org = await TeamOrganization.create(payload);

    // The creator is the founding owner. Written as a Membership row so the
    // permission layer, the members list and the audit log all agree.
    await upsertMembership({
      organization: org._id,
      user: req.user._id,
      roles: ["owner"],
      source: platform ? "admin" : "signup",
      req,
    });

    await recordAudit({
      req,
      organization: org._id,
      action: "org.created",
      targetType: "organization",
      targetId: org._id,
      targetLabel: org.name,
      metadata: { verificationStatus: org.verificationStatus, orgType: org.orgType, platform },
    });

    let defaultTeam = null;
    let defaultTeamCreated = false;
    let defaultTeamError = "";
    if (createDefaultTeam) {
      try {
        const result = await teamService.ensureDefaultTeam(org, req.user._id);
        defaultTeam = sanitizeTeamPublic(result.team, { canViewPrivate: true });
        defaultTeamCreated = result.created;
        await recordAudit({
          req,
          organization: org._id,
          action: "team.created",
          targetType: "team",
          targetId: result.team._id,
          targetLabel: result.team.name,
          metadata: { defaultTeam: true, created: result.created },
        });
      } catch (error) {
        // A failure of the convenience step must never undo the organization.
        defaultTeamError = "Default team was not created";
        console.error("Default team creation failed:", error.message);
      }
    }

    const fresh = await TeamOrganization.findById(org._id)
      .populate("owner", "name email")
      .populate("category", "name slug icon");
    res.status(201).json({
      organization: withMembershipSummary(fresh, 1),
      defaultTeam,
      defaultTeamCreated,
      defaultTeamError,
      message: defaultTeamError
        ? "Organization created successfully; default team was not created"
        : "Organization created successfully",
    });
  } catch (error) {
    return orgTypeError(res, error, "create");
  }
};

export const updateOrganization = async (req, res) => {
  try {
    const org = req.org; // loaded + authorized by requireOrgPermission('manage_org')
    const platform = isPlatformAdmin(req);

    if (!platform) {
      const attempted = SUPERVISORY_FIELDS.filter((field) => req.body[field] !== undefined);
      if (attempted.length > 0) {
        return res.status(403).json({
          message: `${attempted.join(", ")} can only be changed by the platform admin.`,
          code: "ORG_SUPERVISORY_FIELDS",
        });
      }
    }

    const resolved = resolveUpdateFields(req.body, org);
    if (req.body.type && !req.body.orgType) await assertTypeIsConfigured(req.body.type);

    // Changing the type or a registration number invalidates a granted Verified
    // badge. The reset is deliberately unconditional so it cannot be skipped by
    // an owner editing their own details.
    const resetVerification =
      isSensitiveVerificationChange(resolved) && org.verificationStatus === "verified";

    if (!platform) {
      const patch = {};
      for (const field of SELF_SERVICE_FIELDS) {
        // The slug is handled below: copying it here would let a rename rewrite
        // the public URL even though the caller never asked for it.
        if (field === "slug") continue;
        if (req.body[field] !== undefined) patch[field] = req.body[field];
      }
      Object.assign(patch, {
        type: resolved.type,
        orgType: resolved.orgType,
      });
      if (resolved.typeDetails !== undefined) patch.typeDetails = resolved.typeDetails;
      // A slug is a public address: renaming the club must not silently break
      // every shared /club/<slug> link. It changes only when the caller sends a
      // new one explicitly, and this route already requires manage_org.
      const requestedSlug =
        req.body.slug === undefined ? "" : String(req.body.slug).trim().toLowerCase();
      if (requestedSlug && requestedSlug !== org.slug) {
        patch.slug = await generateOrgSlug(requestedSlug, org._id);
      } else if (!org.slug && patch.name) {
        patch.slug = await generateOrgSlug(patch.name, org._id);
      }
      if (resetVerification) {
        patch.verificationStatus = "unverified";
        patch.verifiedBy = null;
        patch.verifiedAt = null;
        patch.verificationNote = "";
      }

      const update = { ...patch };
      if (resolved.typeChanged && !resolved.detailsChanged) update.$unset = { typeDetails: 1 };
      const updated = await TeamOrganization.findByIdAndUpdate(org._id, update, {
        new: true,
        runValidators: true,
      }).populate("owner", "name email");
      if (patch.isPublic !== undefined && Boolean(patch.isPublic) !== Boolean(org.isPublic)) {
        await recordAudit({
          req,
          organization: org._id,
          action: "org.visibility_changed",
          targetType: "organization",
          targetId: org._id,
          targetLabel: updated.name,
          metadata: { publicPage: Boolean(patch.isPublic) },
        });
      }
      await recordAudit({
        req,
        organization: org._id,
        action: "org.updated",
        targetType: "organization",
        targetId: org._id,
        targetLabel: updated.name,
        metadata: {
          fields: Object.keys(patch),
          orgType: resolved.orgType,
          verificationReset: resetVerification,
        },
      });
      const count = await Membership.countDocuments({ organization: org._id, status: "active" });
      return res.status(200).json({ organization: withMembershipSummary(updated, count), message: "Organization updated successfully" });
    }

    const patch = { ...req.body, type: resolved.type, orgType: resolved.orgType };
    if (resolved.typeDetails !== undefined) patch.typeDetails = resolved.typeDetails;
    // Same rule as the self-service branch: a rename keeps the existing public
    // address unless a new slug was explicitly sent.
    const requestedSlug =
      req.body.slug === undefined ? "" : String(req.body.slug).trim().toLowerCase();
    if (requestedSlug && requestedSlug !== org.slug) {
      patch.slug = await generateOrgSlug(requestedSlug, req.params.id);
    } else if (!org.slug && patch.name) {
      patch.slug = await generateOrgSlug(patch.name, req.params.id);
    } else if (req.body.slug === undefined) {
      delete patch.slug;
    }
    const statusChanged = patch.verificationStatus && patch.verificationStatus !== org.verificationStatus;
    if (statusChanged) {
      patch.verifiedBy = req.user?._id || null;
      patch.verifiedAt = new Date();
    }
    if (resetVerification && !statusChanged) {
      patch.verificationStatus = "unverified";
      patch.verifiedBy = null;
      patch.verifiedAt = null;
      patch.verificationNote = "";
    }

    const update = { ...patch };
    if (resolved.typeChanged && !resolved.detailsChanged) update.$unset = { typeDetails: 1 };
    const updated = await TeamOrganization.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true })
      .populate("owner", "name email")
      .populate("category", "name slug icon");
    if (!updated) return res.status(404).json({ message: "Organization not found" });
    if (patch.isPublic !== undefined && Boolean(patch.isPublic) !== Boolean(org.isPublic)) {
      await recordAudit({
        req,
        organization: updated._id,
        action: "org.visibility_changed",
        targetType: "organization",
        targetId: updated._id,
        targetLabel: updated.name,
        metadata: { publicPage: Boolean(patch.isPublic) },
      });
    }
    await recordAudit({
      req,
      organization: updated._id,
      action: patch.verificationStatus ? "org.verification_changed" : "org.updated_by_platform",
      targetType: "organization",
      targetId: updated._id,
      targetLabel: updated.name,
      metadata: {
        fields: Object.keys(patch),
        orgType: resolved.orgType,
        verificationReset: resetVerification,
        note: patch.verificationNote || "",
      },
    });
    const count = await Membership.countDocuments({ organization: updated._id, status: "active" });
    res.status(200).json({ organization: withMembershipSummary(updated, count), message: "Organization updated successfully" });
  } catch (error) {
    return orgTypeError(res, error, "update");
  }
};

/**
 * Owner-initiated verification request. The registration number is the only
 * thing an Admin actually checks for a registered club, so a request without it
 * is rejected here rather than creating busywork in the review queue.
 */
export const requestOrganizationVerification = async (req, res) => {
  try {
    const org = req.org; // loaded + authorized by requireOrgPermission
    const plain = typeof org.toObject === "function" ? org.toObject() : { ...org };
    if (plain.verificationStatus === "pending") {
      return res.status(409).json({
        message: "A verification request is already pending.",
        code: "ORG_VERIFICATION_PENDING",
      });
    }
    if (plain.verificationStatus === "verified") {
      return res.status(409).json({
        message: "This organization is already verified.",
        code: "ORG_ALREADY_VERIFIED",
      });
    }
    if (effectiveOrgType(plain) === "registered_club" && !canRequestVerification(plain)) {
      return res.status(422).json({
        message: "Add a registration number before requesting verification.",
        code: "ORG_REGISTRATION_REQUIRED",
      });
    }

    const updated = await TeamOrganization.findByIdAndUpdate(
      plain._id,
      {
        verificationStatus: "pending",
        verifiedBy: null,
        verifiedAt: null,
        verificationNote: "",
      },
      { new: true, runValidators: true }
    );
    await recordAudit({
      req,
      organization: plain._id,
      action: "org.verification_requested",
      targetType: "organization",
      targetId: plain._id,
      targetLabel: plain.name,
      metadata: { orgType: updated.orgType },
    });
    res.status(200).json({
      organization: withMembershipSummary(updated, 1),
      message: "Verification request sent",
    });
  } catch (error) {
    return orgTypeError(res, error, "request verification for");
  }
};

/** Platform-admin decision on a pending request. */
export const reviewOrganizationVerification = async (req, res) => {
  try {
    const decision = req.params.decision; // "approve" | "reject"
    const org = await TeamOrganization.findById(req.params.id);
    if (!org) return res.status(404).json({ message: "Organization not found" });

    const note = String(req.body?.note || "").trim();
    const verified = decision === "approve";
    const updated = await TeamOrganization.findByIdAndUpdate(
      org._id,
      {
        verificationStatus: verified ? "verified" : "rejected",
        verifiedBy: req.user?._id || null,
        verifiedAt: new Date(),
        verificationNote: note,
      },
      { new: true, runValidators: true }
    );
    await recordAudit({
      req,
      organization: org._id,
      action: "org.verification_changed",
      targetType: "organization",
      targetId: org._id,
      targetLabel: org.name,
      metadata: { decision, note, orgType: updated.orgType },
    });
    res.status(200).json({
      organization: withMembershipSummary(updated, 1),
      message: verified ? "Organization verified" : "Verification request rejected",
    });
  } catch (error) {
    return orgTypeError(res, error, "review verification for");
  }
};

/** Platform-admin reset — returns a verified org to unverified. */
export const resetOrganizationVerification = async (req, res) => {
  try {
    const org = await TeamOrganization.findById(req.params.id);
    if (!org) return res.status(404).json({ message: "Organization not found" });
    const note = String(req.body?.note || "").trim();
    const updated = await TeamOrganization.findByIdAndUpdate(
      org._id,
      {
        verificationStatus: "unverified",
        verifiedBy: null,
        verifiedAt: null,
        verificationNote: note,
      },
      { new: true, runValidators: true }
    );
    await recordAudit({
      req,
      organization: org._id,
      action: "org.verification_reset",
      targetType: "organization",
      targetId: org._id,
      targetLabel: org.name,
      metadata: { note, orgType: updated.orgType },
    });
    res.status(200).json({
      organization: withMembershipSummary(updated, 1),
      message: "Verification reset",
    });
  } catch (error) {
    return orgTypeError(res, error, "reset verification for");
  }
};

export const deleteOrganization = async (req, res) => {
  try {
    const branchesExist = await Team.exists({ organizationRef: req.params.id });
    if (branchesExist) {
      return res.status(400).json({ message: "Cannot delete organization with existing branches. Remove branches first." });
    }
    const childrenExist = await TeamOrganization.exists({ parent: req.params.id });
    if (childrenExist) {
      return res.status(400).json({ message: "Cannot delete organization with sub-organizations. Remove or re-parent them first." });
    }
    const membershipCount = await Membership.countDocuments({ organization: req.params.id, status: "active" });
    if (membershipCount > 1) {
      return res.status(400).json({
        message: "Remove the other members before deleting this organization.",
        code: "ORG_HAS_MEMBERS",
      });
    }

    await Membership.deleteMany({ organization: req.params.id });
    const deleted = await TeamOrganization.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Organization not found" });

    await Invitation.deleteMany({ organization: deleted._id });

    await recordAudit({
      req,
      action: "org.deleted",
      targetType: "organization",
      targetId: req.params.id,
      targetLabel: deleted.name,
    });
    res.status(200).json({ message: "Organization deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete organization", error: error.message });
  }
};

/**
 * Organizations the caller owns or belongs to — the entry point for the
 * self-management dashboard. Reads Membership, not the deprecated array.
 */
export const getMyOrganizations = async (req, res) => {
  try {
    const memberships = await Membership.find({ user: req.user._id, status: "active" })
      .sort({ createdAt: -1 })
      .lean();

    if (memberships.length === 0) {
      // Platform supervisors with no membership of their own still need the
      // list, otherwise the Admin user cannot switch context.
      if (isPlatformAdmin(req)) {
        const supervised = await TeamOrganization.find({ isActive: true })
          .populate("category", "name slug icon")
          .sort({ name: 1 })
          .limit(200)
          .lean();
        const counts = await membershipCounts(supervised.map((o) => o._id));
        return res.status(200).json(
          supervised.map((org) => ({
            ...org,
            memberCount: counts.get(String(org._id)) || 0,
            myRole: "platform_admin",
            permissions: permissionsForRoles(["owner"]),
          }))
        );
      }
      return res.status(200).json([]);
    }

    const orgs = await TeamOrganization.find({
      _id: { $in: memberships.map((m) => m.organization) },
    })
      .populate("category", "name slug icon")
      .populate("owner", "name email")
      .sort({ name: 1 })
      .lean();

    const byId = new Map(memberships.map((m) => [String(m.organization), m]));
    // Counted from Membership, never from the deprecated
    // TeamOrganization.members[] array, which can be stale. Note this has to be
    // a count of *all* active members of each org, not of the caller's own rows:
    // deriving it from `memberships` would report 1 for every organization.
    const memberCountByOrg = await membershipCounts(orgs.map((o) => o._id));

    res.status(200).json(
      orgs.map((org) => {
        const membership = byId.get(String(org._id));
        const roles = membership?.roles || [];
        return {
          ...org,
          memberCount: memberCountByOrg.get(String(org._id)) || 0,
          myRole: roles.includes("owner") ? "owner" : roles.includes("admin") ? "admin" : "member",
          myRoles: roles,
          permissions: permissionsForRoles(roles),
        };
      })
    );
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch your organizations", error: error.message });
  }
};

// Round 5: `GET /api/organizations/:id/teams` is deliberately public (the
// organization profile page reads it), and it used to run
// `.populate("players")` with no argument — returning a whole Player document
// per roster entry, with date of birth, address, gallery, videos and the
// creating account, to an unauthenticated caller. The roster is now a named
// projection and each team goes through the shared sanitizer, so the team's own
// privacy flags are honoured on this path too.
export const getOrganizationTeams = async (req, res) => {
  try {
    const viewer = await resolveViewerContext(req);
    const canSeePrivate =
      viewer.isPlatformAdmin || viewer.managedOrgIds.has(String(req.params.id));

    // Fix B: this is the organization profile's Teams tab, so it lists what the
    // public may see — published, non-fixture branches. A manager who needs the
    // hidden ones uses `GET /organizations/:id/teams/manage` instead, which is
    // what the management screen reads.
    const query = { organizationRef: req.params.id, isActive: true };
    if (!canSeePrivate) Object.assign(query, publicTeamClause());

    const teams = await Team.find(query)
      .select(viewer?.userId ? `${TEAM_PUBLIC_SELECT} managedBy` : TEAM_PUBLIC_SELECT)
      .populate("players", PLAYER_ROSTER_SELECT)
      .populate("categoryRef", "name slug icon");

    res.status(200).json(sanitizeTeamsPublic(teams, { viewer }));
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch organization teams", error: error.message });
  }
};

const PUBLIC_CLUB_TEAM_LIMIT = 60;

/** One match card query for the club page, scoped to a set of public teams. */
function clubMatchQuery(teamIds, hidden, extra = {}) {
  const teams = { $in: teamIds };
  if (hidden.length) teams.$nin = hidden;
  return { ...PUBLIC_MATCH_FILTER, ...extra, teams };
}

/**
 * Aggregate the club's players from each public team's ranking rows.
 *
 * `getTeamPlayerRankings` reads `Player.stats`, which is global per player, so
 * a player who appears in two of the club's teams carries identical figures.
 * Taking the maximum (rather than summing) avoids counting the same career
 * twice. `buildTopPerformers` is the same pure function the team page uses, so
 * the club page cannot invent a different definition of "top performer".
 */
async function buildClubTopPerformers(teamIds) {
  const byPlayer = new Map();
  for (const teamId of teamIds) {
    const rows = await getTeamPlayerRankings(teamId, null);
    for (const row of rows || []) {
      const id = row?.player?._id ? String(row.player._id) : null;
      if (!id) continue;
      const current = byPlayer.get(id);
      if (!current) {
        byPlayer.set(id, { ...row });
        continue;
      }
      current.teamMatches = Math.max(current.teamMatches || 0, row.teamMatches || 0);
      current.teamRuns = Math.max(current.teamRuns || 0, row.teamRuns || 0);
      current.teamWickets = Math.max(current.teamWickets || 0, row.teamWickets || 0);
      current.teamBattingSr = Math.max(current.teamBattingSr || 0, row.teamBattingSr || 0);
      current.teamBattingAvg = Math.max(current.teamBattingAvg || 0, row.teamBattingAvg || 0);
      current.teamPlayerRating = Math.max(
        current.teamPlayerRating || 0,
        row.teamPlayerRating || 0,
      );
    }
  }
  return buildTopPerformers([...byPlayer.values()]);
}

/**
 * Public club page read — `GET /organizations/public/:slug`.
 *
 * This is deliberately not `GET /organizations/:id`: a slug is the only handle
 * a visitor has, and the answer has to be one strict public projection. A
 * private club, an inactive one and an unknown slug all answer 404, so the
 * endpoint never confirms that a club the owner hid exists.
 *
 * Excluded by construction: registration number/authority, verification
 * internals (who verified it, when, notes), members and their emails/phones,
 * owner/createdBy, audit data. `typeDetails` is reduced to the public display
 * name by `sanitizeOrganizationPublic`.
 */
export const getPublicOrganizationBySlug = async (req, res) => {
  try {
    const slug = String(req.params.slug || "").trim().toLowerCase();
    if (!slug) return res.status(404).json({ message: "Club not found" });

    const org = await TeamOrganization.findOne({
      slug,
      isActive: true,
      isPublic: { $ne: false },
      ...reservedNamesMongoClause("name"),
    })
      .select(
        "name shortName slug logoUrl coverUrl description website foundedYear location locationRefs locationLabels locationIds category type orgType typeDetails verificationStatus isActive isPublic socialLinks privacy createdAt updatedAt"
      )
      .populate("category", "name slug icon")
      .lean();
    if (!org) return res.status(404).json({ message: "Club not found" });

    const teamQuery = {
      organizationRef: org._id,
      isActive: true,
      ...publicTeamClause(),
    };
    const teams = await Team.find(teamQuery)
      .select(TEAM_PUBLIC_SELECT)
      .populate("players", PLAYER_ROSTER_SELECT)
      .populate("categoryRef", "name slug icon")
      .sort({ teamRole: 1, name: 1 })
      .limit(PUBLIC_CLUB_TEAM_LIMIT)
      .lean();

    const teamIds = teams.map((team) => team._id);
    let upcomingMatches = [];
    let recentResults = [];
    let topPerformers = buildTopPerformers([]);

    if (teamIds.length) {
      const hidden = await hiddenTeamIds();
      const findCards = (extra, sort, limit) =>
        Match.find(clubMatchQuery(teamIds, hidden, extra))
          .select(MATCH_CARD_SELECT)
          .populate("teams", "name shortName logo")
          .sort(sort)
          .limit(limit)
          .lean();

      const upcomingStatus = { status: { $in: UPCOMING_MATCH_STATUSES } };
      const [recent, datedUpcoming, undatedUpcoming, performers] = await Promise.all([
        findCards({ status: "completed" }, { startAt: -1 }, RECENT_MATCH_LIMIT),
        findCards(
          { ...upcomingStatus, startAt: { $ne: null } },
          { startAt: 1 },
          UPCOMING_MATCH_LIMIT
        ),
        findCards({ ...upcomingStatus, startAt: null }, { startAt: 1 }, UPCOMING_MATCH_LIMIT),
        buildClubTopPerformers(teamIds),
      ]);

      recentResults = recent;
      upcomingMatches = [...datedUpcoming, ...undatedUpcoming].slice(0, UPCOMING_MATCH_LIMIT);
      topPerformers = performers;
    }

    res.status(200).json({
      organization: sanitizeOrganizationPublic(
        { ...org, branchCount: teams.length },
        { canViewPrivate: false }
      ),
      teams: sanitizeTeamsPublic(teams, { canViewPrivate: false }),
      upcomingMatches,
      recentResults,
      topPerformers,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch club", error: error.message });
  }
};

export const getRootOrganizations = async (req, res) => {
  try {
    const { category } = req.query;
    const viewer = await resolveViewerContext(req);
    const query = { parent: null, isActive: true };
    if (!viewer.isPlatformAdmin) Object.assign(query, reservedNamesMongoClause("name"));
    if (category) {
      const catDoc = await TeamCategory.findOne({
        $or: [{ _id: category }, { slug: String(category).toLowerCase() }, { name: category }]
      });
      if (catDoc) query.category = catDoc._id;
    }

    const orgs = await TeamOrganization.find(query).sort({ name: 1 });
    res.status(200).json(orgs);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch root organizations", error: error.message });
  }
};

export const getOrganizationChain = async (req, res) => {
  try {
    const chain = [];
    let current = await TeamOrganization.findById(req.params.id).populate("category", "name slug");
    const seen = new Set();
    while (current && !seen.has(String(current._id))) {
      seen.add(String(current._id));
      chain.unshift(current);
      current = current.parent ? await TeamOrganization.findById(current.parent) : null;
    }
    res.status(200).json(chain);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch organization chain", error: error.message });
  }
};

export const getOrganizationChildren = async (req, res) => {
  try {
    const viewer = await resolveViewerContext(req);
    const query = { parent: req.params.id, isActive: true };
    if (!viewer.isPlatformAdmin) Object.assign(query, reservedNamesMongoClause("name"));
    const children = await TeamOrganization.find(query).sort({ name: 1 });
    res.status(200).json(children);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch children", error: error.message });
  }
};

export const getOrganizationTree = async (req, res) => {
  try {
    const viewer = await resolveViewerContext(req);
    const tree = await teamService.getOrganizationTree(viewer);
    res.status(200).json(tree);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch organization tree", error: error.message });
  }
};
