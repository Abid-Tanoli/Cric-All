import crypto from "crypto";
import { sendMail } from "./mailer.js";

const VERIFICATION_TOKEN_EXPIRY_MS =
  (Number(process.env.EMAIL_VERIFICATION_HOURS) || 24) * 60 * 60 * 1000;
// Minimum gap between two verification mails to the the same account.
const RESEND_COOLDOWN_MS = 60 * 1000;

export { VERIFICATION_TOKEN_EXPIRY_MS, RESEND_COOLDOWN_MS };

export const generateVerificationToken = () => crypto.randomBytes(32).toString("hex");

export const hashVerificationToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

export const getVerificationExpiry = () =>
  new Date(Date.now() + VERIFICATION_TOKEN_EXPIRY_MS);

// Missing/invalid expiry counts as expired (same rule as password reset).
export const isVerificationExpired = (expires) => {
  const time = expires ? new Date(expires).getTime() : NaN;
  return !Number.isFinite(time) || time < Date.now();
};

export const isVerificationCoolingDown = (sentAt, now = Date.now()) => {
  if (!sentAt) return false;
  const time = new Date(sentAt).getTime();
  return Number.isFinite(time) && now - time < RESEND_COOLDOWN_MS;
};

/**
 * Issue a fresh verification token on the user document and mail the link.
 * The token itself is never persisted — only its SHA-256 hash.
 */
export async function issueVerificationEmail(user, { frontendUrl, force = false } = {}) {
  if (!force && isVerificationCoolingDown(user.verificationSentAt)) {
    return { sent: false, reason: "cooldown" };
  }

  const token = generateVerificationToken();
  user.emailVerificationToken = hashVerificationToken(token);
  user.emailVerificationExpires = getVerificationExpiry();
  user.verificationSentAt = new Date();
  await user.save();

  const link = `${frontendUrl}/verify-email/${token}`;
  const result = await sendMail({
    to: user.email,
    subject: "Verify your CricAll email address",
    text:
      `Hello ${user.name},\n\n` +
      `Confirm your email address to finish setting up your CricAll account:\n\n` +
      `${link}\n\n` +
      `This link expires in ${Math.round(VERIFICATION_TOKEN_EXPIRY_MS / 3600000)} hour(s) and can be used once.\n` +
      `If you did not create this account, you can ignore this message.\n`,
  });

  return { sent: result.delivered, reason: result.delivered ? "sent" : "mail_failed" };
}
