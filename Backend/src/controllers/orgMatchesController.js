import mongoose from "mongoose";
import Match from "../models/Match.js";
import Event from "../models/Event.js";
import Team from "../models/Team.js";
import { recordAudit } from "../utils/audit.js";
import { emitToAll } from "../socket/socket.js";
import { buildMatchInnings } from "../utils/matchInnings.js";

// Phase 6: fixtures and competitions an organization runs itself.
//
// The shape of this file is deliberately identical to orgTeamsController.js, and
// for the same reason. An organization's dashboard is a *tenant* surface, so:
//
//   1. every document is looked up WITH organizationRef in the query. A fixture
//      belonging to another organization is a 404, never a 403 — whether
//      somebody else's fixture exists is not this caller's business;
//   2. the tenant key comes from the authorized `req.org`, never the body, so a
//      member cannot file a fixture under an organization they do not belong to;
//   3. every cross-organization reference (the two teams, an event, the squad
//      players) is verified to belong to *this* organization, so the endpoints
//      cannot be used to pull another tenant's data into a visible document.
//
// Scoring is deliberately out of scope. `status` is restricted to "upcoming" and
// "abandoned" by the schema, nothing here writes `innings` or `result`, and the
// ball-by-ball routes stay platform-admin only. An organization can schedule a
// game and call it off; it cannot declare how it went.

const matchNotFound = (res, message = "Match not found") =>
  res.status(404).json({ message, code: "MATCH_NOT_FOUND" });
const eventNotFound = (res, message = "Event not found") =>
  res.status(404).json({ message, code: "EVENT_NOT_FOUND" });

/** All of `ids` must be teams this organization owns, or the call is rejected. */
async function assertTeamsInOrg(orgId, teamIds) {
  const found = await Team.find({ _id: { $in: teamIds }, organizationRef: orgId })
    .select("_id name")
    .lean();
  if (found.length !== teamIds.length) {
    const error = new Error("Both teams must belong to this organization");
    error.code = "MATCH_TEAM_NOT_IN_ORG";
    error.status = 422;
    throw error;
  }
  return found;
}

async function assertEventInOrg(orgId, eventId) {
  const event = await Event.findOne({ _id: eventId, organization: orgId }).lean();
  if (!event) {
    const error = new Error("That event does not belong to this organization");
    error.code = "EVENT_NOT_IN_ORG";
    error.status = 422;
    throw error;
  }
  return event;
}

function sendError(res, error, fallback) {
  if (error?.code && error?.status) {
    return res.status(error.status).json({ message: error.message, code: error.code });
  }
  if (error?.name === "ValidationError") {
    return res.status(400).json({ message: error.message, code: "MODEL_VALIDATION" });
  }
  if (error?.name === "CastError") {
    return res.status(400).json({ message: "Malformed id", code: "BAD_ID" });
  }
  return res.status(500).json({ message: fallback, code: "MATCH_SERVER_ERROR" });
}

const escapeRegex = (value) => String(value).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const MATCH_SUMMARY_FIELDS =
  "title venue matchType status startAt teams event organizationRef series resultText statusText";

const matchSummary = (match) => ({
  _id: match._id,
  title: match.title,
  venue: match.venue,
  matchType: match.matchType,
  status: match.status,
  startAt: match.startAt,
  teams: (match.teams || []).map((team) => ({
    _id: team._id || team,
    name: team.name,
    shortName: team.shortName,
    logo: team.logo,
  })),
  event: match.event ? { _id: match.event._id || match.event, name: match.event.name } : null,
  series: match.series || "",
  hasScore: (match.innings || []).some((innings) => (innings?.balls || 0) > 0),
});

/** Has anybody scored a ball in this fixture yet? */
const hasRecordedScore = (match) =>
  (match.innings || []).some((innings) => (innings?.balls || 0) > 0 || (innings?.runs || 0) > 0);

// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------
export const listOrgMatches = async (req, res) => {
  try {
    const { search, status, eventId, limit = 50 } = req.query || {};
    const query = { organizationRef: req.org._id };
    if (status) query.status = status;
    if (eventId && mongoose.Types.ObjectId.isValid(eventId)) query.event = eventId;
    if (search) {
      const term = escapeRegex(search);
      query.$or = [{ title: { $regex: term, $options: "i" } }, { venue: { $regex: term, $options: "i" } }];
    }

    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const matches = await Match.find(query)
      .select(MATCH_SUMMARY_FIELDS)
      .populate("teams", "name shortName logo")
      .populate("event", "name shortName")
      .sort({ startAt: -1, createdAt: -1 })
      .limit(safeLimit)
      .lean();

    res.status(200).json({ items: matches.map(matchSummary), total: matches.length });
  } catch (error) {
    res.status(500).json({ message: "Failed to load your fixtures" });
  }
};

export const createOrgMatch = async (req, res) => {
  try {
    const { title, venue, matchType, startAt, teams, eventId, series, seriesMatchNumber } = req.body;
    const ownedTeams = await assertTeamsInOrg(req.org._id, teams);
    if (eventId) await assertEventInOrg(req.org._id, eventId);

    // Keep the order the caller chose: "A vs B" is not the same fixture as
    // "B vs A", and a $in lookup returns them in whatever order Mongo feels like.
    const nameOf = new Map(ownedTeams.map((team) => [String(team._id), team.name]));

    const match = await Match.create({
      title: title || `${nameOf.get(teams[0]) || "Team 1"} vs ${nameOf.get(teams[1]) || "Team 2"}`,
      venue: venue || "",
      matchType: matchType || "T20",
      startAt,
      teams,
      event: eventId || null,
      series: series || "",
      seriesMatchNumber: seriesMatchNumber ?? null,
      // The tenant key is stamped here, from the authorized organization.
      organizationRef: req.org._id,
      organization: req.org.name || "",
      status: "upcoming",
      innings: buildMatchInnings(teams),
    });

    if (eventId) {
      await Event.updateOne({ _id: eventId, organization: req.org._id }, { $addToSet: { matches: match._id } });
    }

    await recordAudit({
      req,
      organization: req.org._id,
      action: "match.created",
      targetType: "match",
      targetId: match._id,
      targetLabel: match.title,
      metadata: { teams: teams.map(String), eventId: eventId || null },
    });

    emitToAll("match:created", { _id: match._id, title: match.title });
    emitToAll("match:updateList");

    const populated = await Match.findById(match._id)
      .select(MATCH_SUMMARY_FIELDS)
      .populate("teams", "name shortName logo")
      .populate("event", "name shortName")
      .lean();

    res.status(201).json({ match: matchSummary(populated) });
  } catch (error) {
    sendError(res, error, "Failed to create the fixture");
  }
};

export const updateOrgMatch = async (req, res) => {
  try {
    const match = await Match.findOne({ _id: req.params.matchId, organizationRef: req.org._id });
    if (!match) return matchNotFound(res);

    const { teams, status, ...rest } = req.body;

    // Changing the sides of a fixture is only sane before anybody has scored in
    // it: `innings` is seeded with the two team ids, so re-pointing the fixture
    // afterwards would leave the scorecard attributing runs to a team that is no
    // longer playing.
    if (teams) {
      if (hasRecordedScore(match)) {
        return res.status(409).json({
          message: "The teams cannot be changed once the match has a score",
          code: "MATCH_ALREADY_SCORED",
        });
      }
      await assertTeamsInOrg(req.org._id, teams);
      match.teams = teams;
      match.innings = [
        { team: teams[0], status: "upcoming" },
        { team: teams[1], status: "upcoming" },
      ];
    }

    if (status && status !== match.status) {
      // "abandoned" is allowed even with a partial score on the board — calling
      // off a rained-out match is exactly when it is needed.
      match.status = status;
    }

    for (const [key, value] of Object.entries(rest)) {
      if (value === undefined) continue;
      match[key] = value;
    }

    await match.save();
    await recordAudit({
      req,
      organization: req.org._id,
      action: "match.updated",
      targetType: "match",
      targetId: match._id,
      targetLabel: match.title,
      metadata: { fields: Object.keys(req.body) },
    });
    emitToAll("match:updateList");

    res.status(200).json({ match: matchSummary(match) });
  } catch (error) {
    sendError(res, error, "Failed to update the fixture");
  }
};

export const deleteOrgMatch = async (req, res) => {
  try {
    const match = await Match.findOne({ _id: req.params.matchId, organizationRef: req.org._id });
    if (!match) return matchNotFound(res);

    if (hasRecordedScore(match)) {
      return res.status(409).json({
        message: "A match with a recorded score cannot be deleted; abandon it instead",
        code: "MATCH_ALREADY_SCORED",
      });
    }

    await Match.deleteOne({ _id: match._id });
    if (match.event) {
      await Event.updateOne({ _id: match.event }, { $pull: { matches: match._id } });
    }

    await recordAudit({
      req,
      organization: req.org._id,
      action: "match.deleted",
      targetType: "match",
      targetId: match._id,
      targetLabel: match.title,
    });
    emitToAll("match:updateList");

    res.status(200).json({ message: "Fixture deleted" });
  } catch (error) {
    sendError(res, error, "Failed to delete the fixture");
  }
};

export const setOrgMatchSquads = async (req, res) => {
  try {
    const match = await Match.findOne({ _id: req.params.matchId, organizationRef: req.org._id });
    if (!match) return matchNotFound(res);

    const { squads } = req.body;
    const fixtureTeams = (match.teams || []).map((team) => String(team._id || team));

    for (const squad of squads) {
      if (!fixtureTeams.includes(squad.team)) {
        return res.status(422).json({
          message: "A squad can only be set for one of the two teams in this fixture",
          code: "SQUAD_TEAM_NOT_IN_MATCH",
        });
      }
    }

    // Every named player must be on that team's roster. Without this, the
    // self-service endpoint would be a way to nominate a player who has never
    // played for the side — and to make a name appear on a scorecard.
    const teamIds = squads.map((squad) => squad.team);
    const playerIds = [...new Set(squads.flatMap((squad) => squad.players))];
    const teams = await Team.find({ _id: { $in: teamIds }, organizationRef: req.org._id })
      .select("players")
      .lean();
    const rosterById = new Map(teams.map((team) => [String(team._id), new Set((team.players || []).map(String))]));

    const outsiders = [];
    for (const squad of squads) {
      const roster = rosterById.get(squad.team);
      for (const playerId of squad.players) {
        if (!roster || !roster.has(playerId)) outsiders.push(playerId);
      }
    }
    if (outsiders.length) {
      return res.status(422).json({
        message: "Some players are not on the team roster; add them to the team first",
        code: "SQUAD_PLAYER_NOT_IN_TEAM",
        playerIds: outsiders,
      });
    }

    // `squad15` is the field the existing scoring and Admin screens already read,
    // so self-service squads show up everywhere without a migration. The entry
    // for a team is replaced wholesale rather than merged, so a removed player
    // actually leaves the squad.
    match.squad15 = squads.map((squad) => ({
      team: squad.team,
      players: squad.players,
      captain: squad.captain || null,
      viceCaptain: squad.viceCaptain || null,
      wicketKeepers: squad.wicketKeepers || [],
    }));
    await match.save();

    await recordAudit({
      req,
      organization: req.org._id,
      action: "match.squads_updated",
      targetType: "match",
      targetId: match._id,
      targetLabel: match.title,
      metadata: { teams: teamIds.map(String), playerCount: playerIds.length },
    });

    res.status(200).json({ squads: match.squad15 });
  } catch (error) {
    sendError(res, error, "Failed to save the squads");
  }
};

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
const eventSummary = (event) => ({
  _id: event._id,
  name: event.name,
  shortName: event.shortName,
  eventType: event.eventType,
  format: event.format,
  venue: event.venue,
  status: event.status,
  startDate: event.startDate,
  endDate: event.endDate,
  totalTeams: event.totalTeams,
  matchCount: (event.matches || []).length,
});

export const listOrgEvents = async (req, res) => {
  try {
    const events = await Event.find({ organization: req.org._id })
      .select(
        "name shortName eventType format venue status startDate endDate totalTeams matches createdBy createdAt updatedAt"
      )
      .sort({ startDate: -1, createdAt: -1 })
      .lean();
    res.status(200).json({ items: events.map(eventSummary), total: events.length });
  } catch (error) {
    res.status(500).json({ message: "Failed to load your events" });
  }
};

export const createOrgEvent = async (req, res) => {
  try {
    const { name, shortName, description, eventType, format, venue, startDate, endDate, totalTeams, address } =
      req.body;

    const event = await Event.create({
      name,
      shortName: shortName || "",
      description: description || "",
      eventType,
      format: format || "T20",
      venue: venue || "",
      startDate,
      endDate,
      totalTeams: eventType === "single-match" ? 2 : totalTeams || 0,
      address: address || { town: "", district: "", city: "", province: "" },
      // Both keys come from the authorized organization, never the body.
      organization: req.org._id,
      createdBy: req.user?._id || null,
      status: "upcoming",
    });

    await recordAudit({
      req,
      organization: req.org._id,
      action: "event.created",
      targetType: "event",
      targetId: event._id,
      targetLabel: event.name,
      metadata: { eventType, totalTeams: event.totalTeams },
    });

    res.status(201).json({ event: eventSummary(event) });
  } catch (error) {
    sendError(res, error, "Failed to create the event");
  }
};

export const updateOrgEvent = async (req, res) => {
  try {
    const event = await Event.findOne({ _id: req.params.eventId, organization: req.org._id });
    if (!event) return eventNotFound(res);

    for (const [key, value] of Object.entries(req.body)) {
      if (value === undefined) continue;
      event[key] = value;
    }
    await event.save();

    await recordAudit({
      req,
      organization: req.org._id,
      action: "event.updated",
      targetType: "event",
      targetId: event._id,
      targetLabel: event.name,
      metadata: { fields: Object.keys(req.body) },
    });

    res.status(200).json({ event: eventSummary(event) });
  } catch (error) {
    sendError(res, error, "Failed to update the event");
  }
};

export const deleteOrgEvent = async (req, res) => {
  try {
    const event = await Event.findOne({ _id: req.params.eventId, organization: req.org._id });
    if (!event) return eventNotFound(res);

    // An event that already has fixtures is history; deleting it would orphan
    // matches that the organization still lists under Matches.
    if ((event.matches || []).length > 0) {
      return res.status(409).json({
        message: "This event still has fixtures; delete them first",
        code: "EVENT_HAS_MATCHES",
      });
    }

    await Event.deleteOne({ _id: event._id });
    await recordAudit({
      req,
      organization: req.org._id,
      action: "event.deleted",
      targetType: "event",
      targetId: event._id,
      targetLabel: event.name,
    });

    res.status(200).json({ message: "Event deleted" });
  } catch (error) {
    sendError(res, error, "Failed to delete the event");
  }
};

export default {
  listOrgMatches,
  createOrgMatch,
  updateOrgMatch,
  deleteOrgMatch,
  setOrgMatchSquads,
  listOrgEvents,
  createOrgEvent,
  updateOrgEvent,
  deleteOrgEvent,
};
