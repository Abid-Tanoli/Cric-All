import crypto from "crypto";

const RESET_TOKEN_EXPIRY_MS = 30 * 60 * 1000;

export const generateResetToken = () => crypto.randomBytes(32).toString("hex");

export const hashResetToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

export const getResetTokenExpiry = () => new Date(Date.now() + RESET_TOKEN_EXPIRY_MS);

// A missing/invalid expiry must count as expired — otherwise a document that
// has a token but no expiry would be accepted forever.
export const isResetTokenExpired = (expires) => {
  const time = expires ? new Date(expires).getTime() : NaN;
  return !Number.isFinite(time) || time < Date.now();
};
