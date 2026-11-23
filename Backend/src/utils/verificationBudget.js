import { checkRateLimit, peekRateLimit } from "../middleware/rateLimiter.js";

/**
 * Rolling-hour send budget for verification codes, per account AND per IP.
 * Uses the same in-memory sliding window as the app's rateLimiter middleware.
 * A send consumes one slot in both buckets; a check consumes nothing.
 */

export const VERIFICATION_SEND_WINDOW_MS = 60 * 60 * 1000;

export function verificationSendLimit() {
  const configured = Number.parseInt(String(process.env.EMAIL_VERIFICATION_MAX_PER_HOUR || ""), 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 10;
}

export const ipBucketKey = (req) =>
  `email-verification:ip:${req?.ip || req?.connection?.remoteAddress || "unknown"}`;

export const userBucketKey = (userOrEmail) => {
  const id = typeof userOrEmail === "string"
    ? userOrEmail.trim().toLowerCase()
    : String(userOrEmail?._id || userOrEmail?.id || "");
  return `email-verification:user:${id || "unknown"}`;
};

const budgetOptions = () => ({
  windowMs: VERIFICATION_SEND_WINDOW_MS,
  max: verificationSendLimit(),
});

/** Read-only decision: does neither bucket have a full rolling hour yet? */
export function canSendVerification(user, req) {
  const options = budgetOptions();
  const userCheck = peekRateLimit(userBucketKey(user), options);
  const ipCheck = peekRateLimit(ipBucketKey(req), options);
  if (!userCheck.allowed || !ipCheck.allowed) {
    return {
      allowed: false,
      retryAfterMs: Math.max(userCheck.retryAfterMs, ipCheck.retryAfterMs),
    };
  }
  return { allowed: true, retryAfterMs: 0 };
}

/** Consume one slot in both buckets. Call only immediately before a real send. */
export function recordVerificationSend(user, req) {
  const options = budgetOptions();
  const userResult = checkRateLimit(userBucketKey(user), options);
  const ipResult = checkRateLimit(ipBucketKey(req), options);
  return userResult.allowed && ipResult.allowed;
}
