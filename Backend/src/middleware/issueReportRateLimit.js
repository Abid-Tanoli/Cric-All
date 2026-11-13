const requestsByUser = new Map();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_USER = 10;

const cleanupTimer = setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [userId, timestamps] of requestsByUser) {
    const recent = timestamps.filter((timestamp) => timestamp > cutoff);
    if (recent.length) requestsByUser.set(userId, recent);
    else requestsByUser.delete(userId);
  }
}, 60_000);
cleanupTimer.unref?.();

export default function issueReportRateLimit(req, res, next) {
  if (process.env.NODE_ENV === "test") return next();

  const userId = String(req.user?._id || req.user?.id || "");
  if (!userId) return res.status(401).json({ message: "Not authorized" });

  const now = Date.now();
  const recent = (requestsByUser.get(userId) || []).filter(
    (timestamp) => timestamp > now - WINDOW_MS,
  );
  if (recent.length >= MAX_PER_USER) {
    res.set("Retry-After", String(Math.ceil(WINDOW_MS / 1000)));
    return res.status(429).json({
      message: "You have sent too many reports. Try again in an hour.",
      code: "ISSUE_REPORT_RATE_LIMITED",
    });
  }

  recent.push(now);
  requestsByUser.set(userId, recent);
  return next();
}
