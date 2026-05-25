import TeamOrganization from "../models/TeamOrganization.js";
import Team from "../models/Team.js";
import * as teamService from "../services/teamService.js";

export const listOrganizations = async (req, res) => {
  try {
    const { category } = req.query;
    const query = { isActive: true };
    if (category) query.category = category;

    const orgs = await TeamOrganization.find(query)
      .populate("category", "name slug icon")
      .sort({ name: 1 });

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
          ...org.toObject(),
          branchCount,
          totalPlayers: totalPlayers[0]?.total || 0,
        };
      })
    );

    res.status(200).json(orgsWithCounts);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch organizations", error: error.message });
  }
};

export const getOrganization = async (req, res) => {
  try {
    const org = await TeamOrganization.findById(req.params.id)
      .populate("category", "name slug icon");
    if (!org) return res.status(404).json({ message: "Organization not found" });

    const branches = await Team.find({ organizationRef: org._id, isActive: true })
      .populate("players")
      .populate("categoryRef", "name slug icon");

    res.status(200).json({ organization: org, branches });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch organization", error: error.message });
  }
};

export const createOrganization = async (req, res) => {
  try {
    const org = await TeamOrganization.create(req.body);
    res.status(201).json({ organization: org, message: "Organization created successfully" });
  } catch (error) {
    res.status(400).json({ message: "Failed to create organization", error: error.message });
  }
};

export const updateOrganization = async (req, res) => {
  try {
    const org = await TeamOrganization.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!org) return res.status(404).json({ message: "Organization not found" });
    res.status(200).json({ organization: org, message: "Organization updated successfully" });
  } catch (error) {
    res.status(400).json({ message: "Failed to update organization", error: error.message });
  }
};

export const deleteOrganization = async (req, res) => {
  try {
    const branchesExist = await Team.exists({ organizationRef: req.params.id });
    if (branchesExist) {
      return res.status(400).json({ message: "Cannot delete organization with existing branches. Remove branches first." });
    }
    await TeamOrganization.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "Organization deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete organization", error: error.message });
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
      const { default: TeamCategory } = await import("../models/TeamCategory.js");
      const catDoc = await TeamCategory.findOne({
        $or: [{ _id: category }, { slug: category.toLowerCase() }, { name: category }]
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
    const ids = [];
    let current = await TeamOrganization.findById(req.params.id).populate("category", "name slug");
    while (current) {
      chain.unshift(current);
      ids.push(current._id.toString());
      if (current.parent) {
        current = await TeamOrganization.findById(current.parent);
      } else {
        current = null;
      }
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
