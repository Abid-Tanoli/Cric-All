import TeamOrganization from "../models/TeamOrganization.js";
import TeamCategory from "../models/TeamCategory.js";
import Team from "../models/Team.js";
import Membership from "../models/Membership.js";
import Invitation from "../models/Invitation.js";
import { getPlatformSettings } from "../models/SystemSettings.js";
import * as teamService from "../services/teamService.js";
import { isPlatformAdmin, resolveOrgAccess } from "../middleware/orgAccess.js";
import { generateOrgSlug, upsertMembership } from "../services/membershipService.js";
import { permissionsForRoles } from "../permissions/orgPermissions.js";
import { recordAudit } from "../utils/audit.js";

// Fields a self-service org owner/admin may change. isActive, parent, category
// and verificationStatus are supervisory — only the platform Admin app may set
// them (an org may re-parent itself under an org it already manages, which is
// handled separately in the controller).
const SELF_SERVICE_FIELDS = [
  "name", "shortName", "logoUrl", "coverUrl", "description", "website",
  "type", "foundedYear", "location", "contact", "socialLinks", "privacy",
];
const SUPERVISORY_FIELDS = ["isActive", "parent", "category", "verificationStatus"];

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
  const found = await TeamCategory.findOne({
    $or: [{ slug: String(type).toLowerCase() }, { name: { $regex: `^${String(type).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } }],
  }).lean();
  if (!found) {
    const error = new Error("Unknown organization type");
    error.status = 422;
    error.code = "ORG_TYPE_UNKNOWN";
    throw error;
  }
}

export const listOrganizations = async (req, res) => {
  try {
    const { category, type, search, page, limit } = req.query;
    const query = { isActive: true };
    if (category) query.category = category;
    if (type) query.type = String(type).toLowerCase();
    if (search) {
      // Escape the term so a user searching "cric." cannot inject an operator.
      const term = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (term) query.$or = [{ name: new RegExp(term, "i") }, { shortName: new RegExp(term, "i") }];
    }

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

    const counts = await membershipCounts(orgs.map((o) => o._id));
    const orgsWithCounts = await Promise.all(
      orgs.map(async (org) => {
        const branchCount = await Team.countDocuments({
          organizationRef: org._id,
          isActive: true,
        });
        const totalPlayers = await Team.aggregate([
          { $match: { organizationRef: org._id, isActive: true } },
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
      items: orgsWithCounts,
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

    const branches = await Team.find({ organizationRef: org._id, isActive: true })
      .populate("players")
      .populate("categoryRef", "name slug icon");

    const members = await Membership.find({ organization: org._id, status: "active" })
      .populate("user", "name email accountType")
      .sort({ createdAt: 1 })
      .lean();

    res.status(200).json({
      organization: { ...org, memberCount: members.length },
      branches,
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
    const platform = isPlatformAdmin(req);
    const settings = await getPlatformSettings();

    if (payload.type) await assertTypeIsConfigured(payload.type);

    if (!platform) {
      // Self-service: the caller owns what they create. Supervisory fields
      // cannot be set from this path.
      delete payload.isActive;
      delete payload.verificationStatus;
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
      metadata: { verificationStatus: org.verificationStatus, platform },
    });

    const fresh = await TeamOrganization.findById(org._id)
      .populate("owner", "name email")
      .populate("category", "name slug icon");
    res.status(201).json({
      organization: withMembershipSummary(fresh, 1),
      message: "Organization created successfully",
    });
  } catch (error) {
    if (error.code === "ORG_TYPE_UNKNOWN") {
      return res.status(422).json({ message: error.message, code: error.code });
    }
    if (error.code === 11000) {
      return res.status(409).json({ message: "That organization slug is taken.", code: "ORG_SLUG_TAKEN" });
    }
    res.status(400).json({ message: "Failed to create organization", error: error.message });
  }
};

export const updateOrganization = async (req, res) => {
  try {
    const org = req.org; // loaded + authorized by requireOrgPermission('manage_org')
    const platform = isPlatformAdmin(req);

    if (req.body.type) await assertTypeIsConfigured(req.body.type);

    if (!platform) {
      const attempted = SUPERVISORY_FIELDS.filter((field) => req.body[field] !== undefined);
      if (attempted.length > 0) {
        return res.status(403).json({
          message: `${attempted.join(", ")} can only be changed by the platform admin.`,
          code: "ORG_SUPERVISORY_FIELDS",
        });
      }
      const patch = {};
      for (const field of SELF_SERVICE_FIELDS) {
        if (req.body[field] !== undefined) patch[field] = req.body[field];
      }
      if (patch.name) patch.slug = await generateOrgSlug(patch.slug || patch.name, org._id);

      const updated = await TeamOrganization.findByIdAndUpdate(org._id, patch, {
        new: true,
        runValidators: true,
      }).populate("owner", "name email");
      await recordAudit({
        req,
        organization: org._id,
        action: "org.updated",
        targetType: "organization",
        targetId: org._id,
        targetLabel: updated.name,
        metadata: { fields: Object.keys(patch) },
      });
      const count = await Membership.countDocuments({ organization: org._id, status: "active" });
      return res.status(200).json({ organization: withMembershipSummary(updated, count), message: "Organization updated successfully" });
    }

    const patch = { ...req.body };
    if (patch.name || patch.slug) patch.slug = await generateOrgSlug(patch.slug || patch.name, req.params.id);
    if (patch.verificationStatus && patch.verificationStatus !== org.verificationStatus) {
      patch.verifiedBy = req.user?._id || null;
      patch.verifiedAt = new Date();
    }

    const updated = await TeamOrganization.findByIdAndUpdate(req.params.id, patch, { new: true, runValidators: true })
      .populate("owner", "name email")
      .populate("category", "name slug icon");
    if (!updated) return res.status(404).json({ message: "Organization not found" });
    await recordAudit({
      req,
      organization: updated._id,
      action: patch.verificationStatus ? "org.verification_changed" : "org.updated_by_platform",
      targetType: "organization",
      targetId: updated._id,
      targetLabel: updated.name,
      metadata: { fields: Object.keys(patch) },
    });
    const count = await Membership.countDocuments({ organization: updated._id, status: "active" });
    res.status(200).json({ organization: withMembershipSummary(updated, count), message: "Organization updated successfully" });
  } catch (error) {
    if (error.code === "ORG_TYPE_UNKNOWN") {
      return res.status(422).json({ message: error.message, code: error.code });
    }
    if (error.code === 11000) {
      return res.status(409).json({ message: "That organization slug is taken.", code: "ORG_SLUG_TAKEN" });
    }
    res.status(400).json({ message: "Failed to update organization", error: error.message });
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

export const getOrganizationTeams = async (req, res) => {
  try {
    const teams = await Team.find({ organizationRef: req.params.id, isActive: true })
      .populate("players")
      .populate("categoryRef", "name slug icon");
    res.status(200).json(teams);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch organization teams", error: error.message });
  }
};

export const getRootOrganizations = async (req, res) => {
  try {
    const { category } = req.query;
    const query = { parent: null, isActive: true };
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
    const children = await TeamOrganization.find({ parent: req.params.id, isActive: true }).sort({ name: 1 });
    res.status(200).json(children);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch children", error: error.message });
  }
};

export const getOrganizationTree = async (req, res) => {
  try {
    const tree = await teamService.getOrganizationTree();
    res.status(200).json(tree);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch organization tree", error: error.message });
  }
};
