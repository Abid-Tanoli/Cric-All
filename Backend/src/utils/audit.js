import AuditLog from "../models/AuditLog.js";
import logger from "./logger.js";

const log = logger.child({ service: "audit" });

/** Human label for the principal behind a request, without leaking secrets. */
export function actorLabelFromReq(req) {
  if (!req) return { actorType: "system", actor: null, actorLabel: "system" };
  if (req.principalType === "admin" && req.user) {
    return {
      actorType: "admin",
      actor: req.user._id,
      actorLabel: req.user.username || req.user.email || String(req.user._id),
    };
  }
  if (req.user) {
    return {
      actorType: "user",
      actor: req.user._id,
      actorLabel: req.user.name || req.user.email || String(req.user._id),
    };
  }
  return { actorType: "system", actor: null, actorLabel: "anonymous" };
}

/**
 * Write one audit entry.
 *
 * Never throws: an audit write must not turn a successful membership change
 * into a 500. Failures are logged through the structured logger instead.
 */
export async function recordAudit({
  req,
  action,
  organization = null,
  targetType = "",
  targetId = "",
  targetLabel = "",
  metadata = {},
  actor: actorOverride = undefined,
} = {}) {
  try {
    const base = actorOverride
      ? { actorType: actorOverride.actorType, actor: actorOverride.actor, actorLabel: actorOverride.actorLabel }
      : actorLabelFromReq(req);

    return await AuditLog.create({
      organization: organization || null,
      ...base,
      action,
      targetType,
      targetId: targetId ? String(targetId) : "",
      targetLabel: targetLabel ? String(targetLabel).slice(0, 200) : "",
      metadata,
      ip: req?.ip || "",
    });
  } catch (error) {
    log.error({ event: "audit.write_failed", action, err: error.message }, "failed to write audit entry");
    return null;
  }
}

export const SYSTEM_ACTOR = { actorType: "system", actor: null, actorLabel: "system" };

export default { recordAudit, actorLabelFromReq, SYSTEM_ACTOR };
