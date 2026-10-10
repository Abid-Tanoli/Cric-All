import Team from "../models/Team.js";
import TeamCategory from "../models/TeamCategory.js";
import * as teamService from "../services/teamService.js";
import * as playerService from "../services/playerService.js";
import { recordAudit } from "../utils/audit.js";
import {
  resolveViewerContext,
  sanitizeTeamPublic,
  sanitizeTeamsPublic,
  sanitizePlayersPublic,
  isHiddenTeamDoc,
  canViewTeamPrivate,
} from "../utils/publicProjection.js";

const isTransientDbError = (error) => (
  error?.name === "MongooseError" ||
  error?.name === "MongoServerSelectionError" ||
  error?.name === "MongoNetworkTimeoutError" ||
  /timed out|buffering|not connected/i.test(error?.message || "")
);

/**
 * Fix B — the shared "may this caller read this team by id" probe.
 *
 * A team the owner has hidden, or a fixture, is answered 404 to anyone who
 * could not have found it through a listing: members/managers of the owning
 * organization and platform admins stay entitled (the manage screen and the
 * admin app need the same id to resolve), everybody else — including an
 * authenticated stranger — gets the same body an unknown id would produce, so
 * the response does not confirm the team exists.
 */
async function teamIsReadableBy(viewer, teamId) {
  const team = await Team.findById(teamId)
    .select("name organizationRef isPublic")
    .lean();
  if (!team) return { found: false, team: null };
  if (isHiddenTeamDoc(team) && !canViewTeamPrivate(viewer, team)) {
    return { found: true, readable: false, team };
  }
  return { found: true, readable: true, team };
}

export const listTeams = async (req, res) => {
  try {
    const { category, categoryRef, organizationRef, city, search, type, page, limit, includePlayers, scope } = req.query;
    const viewer = await resolveViewerContext(req);

    // Round 5: `GET /api/teams` is unauthenticated and used to return every team
    // in the platform — organization-owned tenants included — because
    // organizationRef was applied only when the caller happened to pass it.
    // `teamService.listTeams` now defaults to the org-less public catalogue.
    // Organization-owned teams come back only on intent: `?scope=organization`,
    // an explicit `?organizationRef=`, or a platform admin (the Admin app's
    // supervisory Teams page, which is authenticated and passes no filter).
    const wantsOrgOwned =
      String(scope || "").toLowerCase() === "organization" ||
      Boolean(organizationRef) ||
      viewer.isPlatformAdmin;

    const teams = await teamService.listTeams({
      category,
      categoryRef,
      organizationRef,
      city,
      search,
      type,
      page,
      limit,
      includePlayers,
      scope: wantsOrgOwned ? (viewer.isPlatformAdmin ? "all" : "organization") : "",
      isPublic: req.query.isPublic,
      // Fix B: hidden teams and fixtures are withheld from anyone who is not a
      // platform admin. A manager who needs their own hidden team uses the org
      // manage route, which lists by organization and is not filtered.
      publicOnly: !viewer.isPlatformAdmin,
      excludeReservedTestNames: !viewer.isPlatformAdmin,
    });

    res.status(200).json(sanitizeTeamsPublic(teams, { viewer, canViewPrivate: viewer.isPlatformAdmin }));
  } catch (error) {
    if (isTransientDbError(error)) {
      return res.status(200).json([]);
    }
    res.status(500).json({ message: "Failed to fetch teams", error: error.message });
  }
};

export const getTeam = async (req, res) => {
  try {
    const viewer = await resolveViewerContext(req);
    const profile = await teamService.getTeamProfile(req.params.id, viewer);
    if (!profile) {
      return res.status(404).json({ success: false, message: "Team not found" });
    }
    // Round 5: `profile.team` used to be the raw document with a fully populated
    // `players` array — a dozen Player documents, each with date of birth,
    // address, gallery, videos and createdBy.
    res.status(200).json({
      success: true,
      data: {
        ...profile,
        team: sanitizeTeamPublic(profile.team, { viewer }),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch team", error: error.message });
  }
};

export const createTeam = async (req, res) => {
  try {
    const team = await teamService.createTeam(req.body);
    res.status(201).json({ team, message: "Team created successfully" });
  } catch (error) {
    // Terminal A: a duplicate team is a 409 that names the existing record, not
    // a generic 400.
    if (error?.code === "TEAM_NAME_TAKEN") {
      return res.status(409).json({
        message: error.message,
        code: "TEAM_NAME_TAKEN",
        existing: error.existing || null,
      });
    }
    res.status(400).json({ message: "Failed to create team", error: error.message });
  }
};

export const updateTeam = async (req, res) => {
  try {
    // Round 5: re-parenting a team moves its roster, its fixture history and
    // every organization permission that reaches those players. `PUT /api/teams/:id`
    // had no rule at all, so any platform admin could silently move a tenant's
    // team to another organization or orphan it into an org-less team. The move
    // now has to be asked for by name (`allowOrganizationChange: true`), and when
    // it is, it is written to the audit log with both organizations named.
    const current = await Team.findById(req.params.id).select("_id name organizationRef").lean();
    if (!current) return res.status(404).json({ message: "Team not found" });

    const violation = teamService.checkOrganizationChangeRequest(current, req.body);
    if (violation) {
      return res.status(409).json({
        message: violation.message,
        code: violation.code,
        from: violation.from,
        to: violation.to,
      });
    }

    const payload = teamService.stripOrganizationChangeFlag(req.body);
    const team = await teamService.updateTeam(req.params.id, payload);

    // `updateTeam` returns a document whose `organizationRef` is *populated*, so
    // String(team.organizationRef) is the whole organization object rather than
    // its id. Comparing that against `current` makes both sides look unequal
    // even when they match, and the audit write then fails to cast its
    // `organization` to an ObjectId - which `recordAudit` swallows, leaving an
    // organization move with no audit trail at all. Unwrap the id first.
    const refIdOf = (value) =>
      value && typeof value === "object" ? value._id ?? null : value ?? null;
    const fromOrg = current.organizationRef ? String(current.organizationRef) : null;
    const toOrg = refIdOf(team.organizationRef) ? String(refIdOf(team.organizationRef)) : null;

    if (fromOrg !== toOrg) {
      const audit = await recordAudit({
        req,
        organization: toOrg,
        action: "team.organization_changed",
        targetType: "team",
        targetId: team._id,
        targetLabel: team.name,
        metadata: { fromOrganization: fromOrg, toOrganization: toOrg },
      });
      // A supervisory re-parenting that cannot be recorded must not pass
      // silently. recordAudit logs and returns null rather than throwing, so the
      // outcome is surfaced in the response instead of vanishing.
      if (!audit) {
        return res.status(500).json({
          message:
            "Team organization was changed, but the audit entry could not be written. Treat this as an incident.",
          code: "TEAM_ORG_CHANGE_AUDIT_FAILED",
          team,
        });
      }
    }

    res.status(200).json({ team, message: "Team updated successfully" });
  } catch (error) {
    if (error?.code === "TEAM_NAME_TAKEN") {
      return res.status(409).json({ message: error.message, code: "TEAM_NAME_TAKEN" });
    }
    res.status(400).json({ message: "Failed to update team", error: error.message });
  }
};

export const updateTeamLocation = async (req, res) => {
  try {
    const { latitude, longitude, googleMapsUrl, placeId, fullAddress, city, area } = req.body;
    const team = await Team.findById(req.params.id);
    if (!team) return res.status(404).json({ message: "Team not found" });

    if (latitude !== undefined) team.latitude = latitude;
    if (longitude !== undefined) team.longitude = longitude;
    if (googleMapsUrl !== undefined) team.googleMapsUrl = googleMapsUrl;
    if (placeId !== undefined) team.placeId = placeId;
    if (fullAddress !== undefined) team.fullAddress = fullAddress;
    if (area !== undefined) team.area = area;
    // Round 5: `team.city = city` wrote a field Team.js does not declare, so
    // Mongoose's strict mode discarded it and the location update silently did
    // nothing for city. City is `address.city`; write it there. The response
    // echoes the saved values so a caller can see what actually stuck.
    if (city !== undefined) {
      team.address = { ...(team.address || {}), city: city || "" };
    }

    await team.save();
    res.status(200).json({
      team,
      message: "Location updated successfully",
      applied: {
        latitude: team.latitude,
        longitude: team.longitude,
        googleMapsUrl: team.googleMapsUrl,
        placeId: team.placeId,
        fullAddress: team.fullAddress,
        area: team.area,
        city: team.address?.city ?? "",
      },
    });
  } catch (error) {
    res.status(400).json({ message: "Failed to update location", error: error.message });
  }
};

export const deleteTeam = async (req, res) => {
  try {
    const result = await teamService.deleteTeam(req.params.id);
    res.status(200).json({ message: "Team deleted successfully", ...result });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete team", error: error.message });
  }
};

export const addPlayersToTeam = async (req, res) => {
  try {
    const { playerIds } = req.body;
    if (!playerIds || !Array.isArray(playerIds)) {
      return res.status(400).json({ message: "Player IDs array is required" });
    }

    const results = [];
    for (const playerId of playerIds) {
      const player = await teamService.assignPlayerToTeam(req.params.id, playerId, "player");
      results.push(player);
    }

    const team = await Team.findById(req.params.id).populate("players");
    res.status(200).json({ team, players: results, message: "Players added successfully" });
  } catch (error) {
    res.status(400).json({ message: "Failed to add players", error: error.message });
  }
};

export const removePlayersFromTeam = async (req, res) => {
  try {
    const { playerIds } = req.body;
    if (!playerIds || !Array.isArray(playerIds)) {
      return res.status(400).json({ message: "Player IDs array is required" });
    }

    for (const playerId of playerIds) {
      await teamService.removePlayerFromTeam(req.params.id, playerId);
    }

    const team = await Team.findById(req.params.id).populate("players");
    res.status(200).json({ team, message: "Players removed successfully" });
  } catch (error) {
    res.status(400).json({ message: "Failed to remove players", error: error.message });
  }
};

export const updatePlayerRoleInTeam = async (req, res) => {
  try {
    const player = await teamService.updatePlayerRole(req.params.id, req.params.playerId, req.body);
    res.status(200).json({ player, message: "Player role updated successfully" });
  } catch (error) {
    res.status(400).json({ message: "Failed to update player role", error: error.message });
  }
};

export const getTeamPlayers = async (req, res) => {
  try {
    const viewer = await resolveViewerContext(req);
    const { role, search } = req.query;
    const players = await playerService.getTeamPlayers(req.params.id, { role, search }, viewer);
    // The owning organization also comes off the populated team for an
    // identified caller; it is read separately so the anonymous path - whose
    // populate carries only `name shortName` - still resolves correctly.
    const team = await Team.findById(req.params.id).select("organizationRef").lean();
    const playerOrgId = team?.organizationRef ? String(team.organizationRef) : null;
    res.status(200).json(sanitizePlayersPublic(players, { viewer, playerOrgId }));
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch team players", error: error.message });
  }
};

export const getTeamRanking = async (req, res) => {
  try {
    const viewer = await resolveViewerContext(req);
    const gate = await teamIsReadableBy(viewer, req.params.id);
    if (gate.found && gate.readable === false) {
      return res.status(404).json({ message: "Team not found" });
    }
    const { default: TeamRanking } = await import("../models/TeamRanking.js");
    const ranking = await TeamRanking.findOne({ team: req.params.id })
      .populate("team", "name shortName logo");
    if (!ranking) {
      return res.status(200).json({ message: "Ranking not yet computed" });
    }
    res.status(200).json(ranking);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch ranking", error: error.message });
  }
};

export const getTeamMatches = async (req, res) => {
  try {
    const viewer = await resolveViewerContext(req);
    const gate = await teamIsReadableBy(viewer, req.params.id);
    if (gate.found && gate.readable === false) {
      return res.status(404).json({ message: "Team not found" });
    }
    const { default: Match } = await import("../models/Match.js");
    const matches = await Match.find({ teams: req.params.id })
      .populate("teams", "name shortName logo")
      .sort({ startAt: -1 })
      .limit(20);
    res.status(200).json(matches);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch matches", error: error.message });
  }
};

export const toggleTeamVisibility = async (req, res) => {
  try {
    const viewer = await resolveViewerContext(req);
    const team = await Team.findById(req.params.id).select("_id name organizationRef isPublic");
    if (!team) {
      return res.status(404).json({ success: false, message: "Team not found" });
    }

    // Only org owners/managers with manage_teams for this org OR platform admins
    let canToggle = viewer.isPlatformAdmin;
    if (!canToggle && team.organizationRef) {
      canToggle = viewer.managedOrgIds.has(String(team.organizationRef));
    }
    if (!canToggle) {
      return res.status(403).json({ success: false, message: "Not authorized to change visibility" });
    }

    team.isPublic = !team.isPublic;
    await team.save();
    await recordAudit({
      req,
      organization: team.organizationRef ? String(team.organizationRef) : null,
      action: "team.visibility_changed",
      targetType: "team",
      targetId: team._id,
      targetLabel: team.name,
      metadata: { isPublic: team.isPublic },
    });
    res.status(200).json({ success: true, isPublic: team.isPublic, team: { _id: team._id, name: team.name } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to toggle visibility", error: error.message });
  }
};
