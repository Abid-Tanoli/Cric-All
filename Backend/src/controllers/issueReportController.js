import mongoose from "mongoose";
import IssueReport from "../models/IssueReport.js";
import TeamOrganization from "../models/TeamOrganization.js";
import Match from "../models/Match.js";
import Event from "../models/Event.js";
import Tournament from "../models/Tournament.js";
import Series from "../models/Series.js";
import Team from "../models/Team.js";
import Invitation from "../models/Invitation.js";
import Membership from "../models/Membership.js";
import { deleteMatch } from "./matchController.js";
import { deleteEvent } from "./eventController.js";
import { deleteTournament } from "./TournamentController.js";
import { deleteSeries } from "./seriesController.js";
import { sendMail } from "../utils/mailer.js";
import logger from "../utils/logger.js";
import { recordAudit } from "../utils/audit.js";
import { syncLegacyMembersArray } from "../services/membershipService.js";

const log = logger.child({ service: "issue-reports" });
const MAX_SUBJECT_LENGTH = 150;
const MAX_TEXT_LENGTH = 5000;
const statusValues = new Set(["open", "in_review", "resolved", "rejected"]);
const typeValues = new Set(["issue", "deletion_request"]);
const targetTypes = new Set(["match", "event", "tournament", "series", "team", "other"]);

const badRequest = (res, message, code = "ISSUE_REPORT_INVALID") =>
  res.status(400).json({ message, code });

function isAdmin(req) {
  return req.principalType === "admin" || ["admin", "superadmin"].includes(req.user?.role);
}

function actorType(req) {
  return isAdmin(req) ? "admin" : "user";
}

export const requireIssueReportMember = (req, res, next) => {
  if (req.principalType !== "user" || req.orgAccess?.via !== "membership") {
    return res.status(403).json({
      message: "Only active organization members may use this report inbox.",
      code: "ORG_MEMBERSHIP_REQUIRED",
    });
  }
  return next();
};
function addStatusHistory(report, req, status, note = "") {
  report.statusHistory.push({
    status,
    actor: req.user._id,
    actorType: actorType(req),
    note: String(note || "").trim().slice(0, 500),
  });
}

async function targetExistsInOrganization(organizationId, targetType, targetId) {
  if (!mongoose.Types.ObjectId.isValid(targetId)) return false;
  const query = { _id: targetId };
  if (targetType === "match") return Boolean(await Match.exists({ ...query, organizationRef: organizationId }));
  if (targetType === "event") return Boolean(await Event.exists({ ...query, organization: organizationId }));
  if (targetType === "tournament") return Boolean(await Tournament.exists({ ...query, organizationRef: organizationId }));
  if (targetType === "series") return Boolean(await Series.exists({ ...query, organizationRef: organizationId }));
  if (targetType === "team") return Boolean(await Team.exists({ ...query, organizationRef: organizationId }));
  if (targetType === "other") {
    return String(targetId) === String(organizationId)
      && Boolean(await TeamOrganization.exists({ _id: targetId }));
  }
  return false;
}

function sendAdminNotification(report, organizationName) {
  if ((process.env.MAIL_DRIVER || "console").toLowerCase() !== "smtp") return;
  const to = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!to) return;

  void sendMail({
    to,
    subject: `New organization ${report.type.replace("_", " ")}: ${report.subject}`,
    text: [
      `Organization: ${organizationName}`,
      `Type: ${report.type}`,
      `Subject: ${report.subject}`,
      `Description: ${report.description}`,
    ].join("\n"),
  }).catch((error) => {
    log.warn({ event: "issue_report.mail_failed", reportId: String(report._id), err: error.message });
  });
}

export const createOrganizationIssue = async (req, res) => {
  const { type, subject, description, targetType, targetId } = req.body || {};
  const cleanSubject = typeof subject === "string" ? subject.trim() : "";
  const cleanDescription = typeof description === "string" ? description.trim() : "";

  if (!typeValues.has(type)) return badRequest(res, "Choose issue or deletion_request.");
  if (targetType && !targetTypes.has(targetType)) return badRequest(res, "Choose a valid target type.");
  if (!cleanSubject || cleanSubject.length > MAX_SUBJECT_LENGTH) {
    return badRequest(res, "Subject is required and must be 150 characters or fewer.");
  }
  if (!cleanDescription || cleanDescription.length > MAX_TEXT_LENGTH) {
    return badRequest(res, "Description is required and must be 5000 characters or fewer.");
  }
  if (targetId && !targetType) return badRequest(res, "A target type is required with a target id.");

  if (targetId && !(await targetExistsInOrganization(req.org._id, targetType, targetId))) {
    return res.status(404).json({ message: "Target not found", code: "ISSUE_TARGET_NOT_FOUND" });
  }

  const report = await IssueReport.create({
    organization: req.org._id,
    reporter: req.user._id,
    type,
    subject: cleanSubject,
    description: cleanDescription,
    targetType: targetType || null,
    targetId: targetId || null,
    statusHistory: [{
      status: "open",
      actor: req.user._id,
      actorType: actorType(req),
      note: "Report created",
    }],
  });

  sendAdminNotification(report, req.org.name);
  return res.status(201).json({ report });
};

export const listOrganizationIssues = async (req, res) => {
  const reports = await IssueReport.find({ organization: req.org._id })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return res.status(200).json({ items: reports });
};

export const getOrganizationIssue = async (req, res) => {
  const report = await IssueReport.findOne({
    _id: req.params.issueId,
    organization: req.org._id,
  }).lean();
  if (!report) return res.status(404).json({ message: "Report not found" });
  return res.status(200).json({ report });
};

export const listAdminIssues = async (req, res) => {
  const query = {};
  const { status, type, organization } = req.query || {};
  if (status) {
    if (!statusValues.has(String(status))) return badRequest(res, "Invalid status filter.");
    query.status = status;
  }
  if (type) {
    if (!typeValues.has(String(type))) return badRequest(res, "Invalid type filter.");
    query.type = type;
  }
  if (organization) {
    if (!mongoose.Types.ObjectId.isValid(organization)) return badRequest(res, "Invalid organization filter.");
    query.organization = organization;
  }
  const reports = await IssueReport.find(query)
    .populate("organization", "name shortName")
    .populate("reporter", "name email")
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  return res.status(200).json({ items: reports });
};

export const getAdminIssue = async (req, res) => {
  const report = await IssueReport.findById(req.params.issueId)
    .populate("organization", "name shortName")
    .populate("reporter", "name email")
    .populate("resolvedBy", "name email")
    .lean();
  if (!report) return res.status(404).json({ message: "Report not found" });
  return res.status(200).json({ report });
};

export const getOpenIssueCount = async (req, res) => {
  const count = await IssueReport.countDocuments({ status: "open" });
  return res.status(200).json({ count });
};

export const replyToAdminIssue = async (req, res) => {
  const reply = typeof req.body?.adminReply === "string" ? req.body.adminReply.trim() : "";
  if (!reply || reply.length > MAX_TEXT_LENGTH) {
    return badRequest(res, "A reply is required and must be 5000 characters or fewer.");
  }
  const report = await IssueReport.findById(req.params.issueId);
  if (!report) return res.status(404).json({ message: "Report not found" });

  report.adminReply = reply;
  await report.save();
  return res.status(200).json({ report });
};

export const updateAdminIssueStatus = async (req, res) => {
  const { status } = req.body || {};
  if (!statusValues.has(status)) return badRequest(res, "Choose a valid report status.");
  const report = await IssueReport.findById(req.params.issueId);
  if (!report) return res.status(404).json({ message: "Report not found" });

  const reply = typeof req.body?.adminReply === "string" ? req.body.adminReply.trim() : "";
  if (reply.length > MAX_TEXT_LENGTH) return badRequest(res, "Reply must be 5000 characters or fewer.");
  if (reply) report.adminReply = reply;
  if (status === "rejected" && !report.adminReply.trim()) {
    return badRequest(res, "A reply is required before rejecting a report.");
  }
  if (report.status !== status) {
    report.status = status;
    addStatusHistory(report, req, status);
  }
  report.resolvedBy = ["resolved", "rejected"].includes(status) ? req.user._id : null;
  await report.save();
  return res.status(200).json({ report });
};

const deletionHandlers = {
  match: deleteMatch,
  event: deleteEvent,
  tournament: deleteTournament,
  series: deleteSeries,
};

function captureResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

export const approveAndDeleteAdminIssue = async (req, res) => {
  const report = await IssueReport.findById(req.params.issueId);
  if (!report) return res.status(404).json({ message: "Report not found" });
  if (report.type !== "deletion_request" || !deletionHandlers[report.targetType] || !report.targetId) {
    return badRequest(res, "This deletion request cannot be approved from the inbox.", "ISSUE_DELETE_UNSUPPORTED");
  }
  if (["resolved", "rejected"].includes(report.status)) {
    return res.status(409).json({ message: "This report is already closed.", code: "ISSUE_REPORT_CLOSED" });
  }
  if (!(await targetExistsInOrganization(report.organization, report.targetType, report.targetId))) {
    return res.status(404).json({ message: "Target not found", code: "ISSUE_TARGET_NOT_FOUND" });
  }

  const deleteRes = captureResponse();
  await deletionHandlers[report.targetType](
    {
      ...req,
      params: { ...req.params, id: String(report.targetId) },
      principalType: "admin",
    },
    deleteRes,
  );
  if (deleteRes.statusCode < 200 || deleteRes.statusCode >= 300) {
    return res.status(deleteRes.statusCode).json(deleteRes.body || { message: "Could not delete the target." });
  }

  report.status = "resolved";
  report.resolvedBy = req.user._id;
  addStatusHistory(report, req, "resolved", `Approved and deleted ${report.targetType}`);
  await report.save();
  return res.status(200).json({ report, deletion: deleteRes.body });
};

export const deleteOrgInvitation = async (req, res) => {
  const invitation = await Invitation.findOneAndDelete({
    _id: req.params.invitationId,
    organization: req.org._id,
  });
  if (!invitation) return res.status(404).json({ message: "Invitation not found" });
  await recordAudit({
    req,
    organization: req.org._id,
    action: "invitation.deleted",
    targetType: "invitation",
    targetId: invitation._id,
    targetLabel: invitation.email || invitation.phone || "invitation",
  });
  return res.status(200).json({ message: "Invitation permanently deleted." });
};

export const deleteOrgMembership = async (req, res) => {
  const membership = await Membership.findOne({
    organization: req.org._id,
    user: req.params.userId,
  });
  if (!membership) return res.status(404).json({ message: "Membership not found" });
  if ((membership.roles || []).includes("owner")) {
    return res.status(409).json({
      message: "Transfer ownership before permanently deleting the owner's membership.",
      code: "OWNER_CANNOT_BE_REMOVED",
    });
  }
  await Membership.deleteOne({ _id: membership._id });
  await syncLegacyMembersArray(req.org._id);
  await recordAudit({
    req,
    organization: req.org._id,
    action: "membership.deleted",
    targetType: "membership",
    targetId: membership._id,
    targetLabel: String(membership.user),
  });
  return res.status(200).json({ message: "Membership permanently deleted." });
};
