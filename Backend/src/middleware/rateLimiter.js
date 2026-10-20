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

export default function rateLimiter({ windowMs = 1000, max = 5 } = {}) {
  return (req, res, next) => {
    const key = requestKey(req);
    const now = Date.now();
    const windowStart = now - windowMs;

    if (!store.has(key)) {
      store.set(key, []);
    }

    const timestamps = store.get(key).filter((t) => t > windowStart);
    timestamps.push(now);
    store.set(key, timestamps);

    if (timestamps.length > max) {
      const retryAfterMs = Math.max(0, timestamps[0] + windowMs - now);
      res.set("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
      return res.status(429).json({
        message: `Too many requests. Max ${max} per ${windowMs / 1000}s. Try again shortly.`,
      });
    }

    next();
  };
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
