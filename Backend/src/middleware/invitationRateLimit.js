const store = new Map();

const DEFAULT_WINDOW = 60 * 60 * 1000; // 1 hour
const DEFAULT_MAX_PER_ORG = 60;
const DEFAULT_MAX_PER_INVITER = 40;

function cleanup() {
  const now = Date.now();
  const cutoff = now - DEFAULT_WINDOW * 2;
  for (const [key, ts] of store) {
    const filtered = ts.filter((t) => t > cutoff);
    if (filtered.length === 0) store.delete(key);
    else store.set(key, filtered);
  }
}

const timer = setInterval(cleanup, 60_000);
if (timer.unref) timer.unref();

function key(type, id) {
  if (!id) return null;
  return `${type}:${String(id)}`;
}

export function invitationCreateRateLimit({ windowMs = DEFAULT_WINDOW, maxPerOrg = DEFAULT_MAX_PER_ORG, maxPerInviter = DEFAULT_MAX_PER_INVITER } = {}) {
  return (req, res, next) => {
    if (process.env.NODE_ENV === "test") return next();
    const now = Date.now();
    const windowStart = now - windowMs;
    const hits = [];

    const orgKey = key("org", req.params?.id || req.params?.orgId || req.org?._id);
    if (orgKey) {
      const list = store.get(orgKey) || [];
      const recent = list.filter((t) => t > windowStart);
      recent.push(now);
      store.set(orgKey, recent);
      if (recent.length > maxPerOrg) {
        res.set("Retry-After", String(Math.ceil(windowMs / 1000)));
        return res.status(429).json({
          message: "Too many invitations sent from this organization. Try again later.",
          code: "INVITATION_RATE_LIMITED",
        });
      }
    }

    const inviterKey = key("inviter", req.user?._id || req.user?.id);
    if (inviterKey) {
      const list = store.get(inviterKey) || [];
      const recent = list.filter((t) => t > windowStart);
      recent.push(now);
      store.set(inviterKey, recent);
      if (recent.length > maxPerInviter) {
        res.set("Retry-After", String(Math.ceil(windowMs / 1000)));
        return res.status(429).json({
          message: "Too many invitations sent by this account. Try again later.",
          code: "INVITATION_RATE_LIMITED",
        });
      }
    }

    next();
  };
}

export default { invitationCreateRateLimit };
