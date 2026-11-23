const store = new Map();

function requestKey(req) {
  const actor = req.user?._id || req.user?.id || req.ip || req.connection?.remoteAddress || "unknown";
  const matchId = req.params?.matchId || req.params?.id || "global";
  // Include the mount path: `req.route.path` is router-relative, so
  // /api/auth/login and /api/admin/login both read "/login" — without the
  // baseUrl they share one bucket despite configuring separate budgets
  // (25/5min user vs 20/5min admin), letting ordinary user traffic exhaust
  // the admin login allowance.
  const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path || req.originalUrl || "unknown";
  return `${actor}:${matchId}:${req.method}:${route}`;
}

/** Read-only view of a bucket (used before consuming a verification slot). */
export function peekRateLimit(key, { windowMs = 1000, max = 5 } = {}, now = Date.now()) {
  const timestamps = (store.get(key) || []).filter((t) => t > now - windowMs);
  if (timestamps.length < max) return { allowed: true, retryAfterMs: 0 };
  return {
    allowed: false,
    retryAfterMs: Math.max(0, timestamps[0] + windowMs - now),
  };
}

/**
 * Sliding-window check shared by the Express middleware and the one-off
 * checks used when a code is issued from inside a controller (signup).
 */
export function checkRateLimit(key, { windowMs = 1000, max = 5 } = {}, now = Date.now()) {
  const windowStart = now - windowMs;
  const timestamps = (store.get(key) || []).filter((t) => t > windowStart);
  timestamps.push(now);
  store.set(key, timestamps);

  if (timestamps.length > max) {
    const retryAfterMs = Math.max(0, timestamps[0] + windowMs - now);
    return { allowed: false, retryAfterMs };
  }
  return { allowed: true, retryAfterMs: 0 };
}

export default function rateLimiter({ windowMs = 1000, max = 5, keyBuilder = requestKey } = {}) {
  return (req, res, next) => {
    const result = checkRateLimit(keyBuilder(req), { windowMs, max });
    if (!result.allowed) {
      res.set("Retry-After", String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
      return res.status(429).json({
        message: `Too many requests. Max ${max} per ${windowMs / 1000}s. Try again shortly.`,
      });
    }
    next();
  };
}

/** Test seam: bucket state is process-local, so wipe it between suites. */
export function resetRateLimiterForTests() {
  store.clear();
}

// Cleanup stale entries every 60s
const cleanupTimer = setInterval(() => {
  const cutoff = Date.now() - 60000;
  for (const [key, timestamps] of store) {
    const filtered = timestamps.filter((t) => t > cutoff);
    if (filtered.length === 0) store.delete(key);
    else store.set(key, filtered);
  }
}, 60000);
cleanupTimer.unref?.();
