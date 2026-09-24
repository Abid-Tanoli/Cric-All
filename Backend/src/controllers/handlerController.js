import Team from "../models/Team.js";
import Event from "../models/Event.js";
import HandlerRequest from "../models/HandlerRequest.js";
import { createTeam } from "../services/teamService.js";
import { getIO } from "../socket/socket.js";

const HANDLER_TYPES = ["handler", "organization_admin"];

// Restricts a route to signed-in Cricket Handler / Organization Admin users.
export const handlerOnly = (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Not authorized" });
  const type = req.user.accountType;
  if (!HANDLER_TYPES.includes(type)) {
    return res.status(403).json({ message: "Handler or organization admin access required" });
  }
  next();
};

// Teams & events currently associated with the requesting user's account.
export const getMyManagedResources = async (req, res) => {
  try {
    const userId = req.user._id;
    const [teams, events] = await Promise.all([
      Team.find({ managedBy: userId })
        .select("name shortName logo type category organization isActive players")
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
      Event.find({ managedBy: userId })
        .select("name shortName eventType format status startDate teams")
        .sort({ createdAt: -1 })
        .limit(100)
        .lean()
    ]);

    res.json({ teams, events });
  } catch (error) {
    res.status(500).json({ message: "Failed to load your teams and events", error: error.message });
  }
};

export const getMyRequests = async (req, res) => {
  try {
    const requests = await HandlerRequest.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json({ requests });
  } catch (error) {
    res.status(500).json({ message: "Failed to load your requests", error: error.message });
  }
};

export const createHandlerRequest = async (req, res) => {
  try {
    const { type, details } = req.body || {};
    const requestType = ["team", "tournament"].includes(type) ? type : null;
    if (!requestType) {
      return res.status(400).json({ message: "Request type must be 'team' or 'tournament'" });
    }

    const name = String(details?.name || "").trim();
    if (!name) {
      return res.status(400).json({ message: "A name for the requested team/tournament is required" });
    }

    const request = await HandlerRequest.create({
      user: req.user._id,
      type: requestType,
      details: {
        name,
        shortName: String(details?.shortName || "").trim(),
        category: String(details?.category || "Other").trim() || "Other",
        organization: String(details?.organization || "").trim(),
        eventType: String(details?.eventType || "").trim(),
        format: String(details?.format || "T20").trim() || "T20",
        description: String(details?.description || "").trim()
      }
    });

    res.status(201).json({ request });
  } catch (error) {
    res.status(400).json({ message: "Failed to submit request", error: error.message });
  }
};

// ---- Admin review endpoints -------------------------------------------------

export const listHandlerRequests = async (req, res) => {
  try {
    const { status } = req.query;
    const query = {};
    if (["pending", "approved", "rejected"].includes(status)) query.status = status;

    const requests = await HandlerRequest.find(query)
      .populate("user", "name email accountType organizationName")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json({ requests });
  } catch (error) {
    res.status(500).json({ message: "Failed to load handler requests", error: error.message });
  }
};

const VALID_EVENT_TYPES = ["single-match", "series", "tri-series", "tournament", "world-cup", "champions-trophy", "league"];

export const approveHandlerRequest = async (req, res) => {
  try {
    const request = await HandlerRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.status !== "pending") {
      return res.status(400).json({ message: "This request has already been resolved" });
    }

    const d = request.details || {};
    let created = null;

    if (request.type === "team") {
      const team = await createTeam({
        name: d.name,
        shortName: d.shortName || undefined,
        category: d.category || "Other",
        organization: d.organization || ""
      });
      team.managedBy = request.user;
      await team.save();
      created = team;
    } else {
      const eventType = VALID_EVENT_TYPES.includes(d.eventType) ? d.eventType : "tournament";
      const event = new Event({
        name: d.name,
        shortName: d.shortName || undefined,
        eventType,
        teams: [],
        totalTeams: 0,
        format: d.format || "T20",
        oversPerInnings: d.format === "Tape Ball" ? 8 : 20,
        status: "upcoming",
        category: d.category || "Other",
        description: d.description || "",
        managedBy: request.user
      });
      await event.save();
      created = event;
    }

    request.status = "approved";
    request.decidedBy = req.user?._id || req.user?.id || null;
    request.decidedAt = new Date();
    request.resourceType = request.type === "team" ? "Team" : "Event";
    request.resourceId = created._id;
    await request.save();

    try {
      getIO()?.emit(request.type === "team" ? "team:created" : "event:created", created);
    } catch (e) {}

    res.json({
      request,
      created: {
        _id: created._id,
        name: created.name,
        type: request.type === "team" ? "Team" : "Event"
      }
    });
  } catch (error) {
    res.status(400).json({ message: "Failed to approve request", error: error.message });
  }
};

export const rejectHandlerRequest = async (req, res) => {
  try {
    const request = await HandlerRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.status !== "pending") {
      return res.status(400).json({ message: "This request has already been resolved" });
    }

    request.status = "rejected";
    request.decidedBy = req.user?._id || req.user?.id || null;
    request.decidedAt = new Date();
    request.adminNote = String(req.body?.note || "").trim().slice(0, 500);
    await request.save();

    res.json({ request });
  } catch (error) {
    res.status(500).json({ message: "Failed to reject request", error: error.message });
  }
};