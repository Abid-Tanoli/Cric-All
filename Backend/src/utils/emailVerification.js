import crypto from "crypto";
import { sendMail } from "./mailer.js";

/**
 * Email verification with a 6-digit code.
 *
 * The raw code is only ever given to the mailer's console driver (dev/CI) or
 * the SMTP transport. The user document stores a SHA-256 hash, a 10-minute
 * expiry, and the number of wrong attempts. Nothing here logs the code or the
 * mail body: the console driver in mailer.js is the only place that does.
 */

const CODE_MINUTES = () => {
  const configured = Number.parseInt(String(process.env.EMAIL_CODE_MINUTES || ""), 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 10;
};

export const EMAIL_CODE_EXPIRY_MS = () => CODE_MINUTES() * 60 * 1000;
export const RESEND_COOLDOWN_MS = 60 * 1000;
export const MAX_EMAIL_CODE_ATTEMPTS = 5;

/** 6 digits, zero-padded: "004213", never "4213". */
export const generateEmailCode = () =>
  String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

export const hashEmailCode = (code) =>
  crypto.createHash("sha256").update(String(code)).digest("hex");

export const getEmailCodeExpiry = () => new Date(Date.now() + EMAIL_CODE_EXPIRY_MS());

// Missing/invalid expiry counts as expired (same rule as password reset tokens).
export const isEmailCodeExpired = (expires) => {
  const time = expires ? new Date(expires).getTime() : NaN;
  return !Number.isFinite(time) || time < Date.now();
};

export const isEmailCoolingDown = (sentAt, now = Date.now()) => {
  if (!sentAt) return false;
  const time = new Date(sentAt).getTime();
  return Number.isFinite(time) && now - time < RESEND_COOLDOWN_MS;
};

/** Invalidate every outstanding secret for this address (single-use / reset). */
export function invalidateEmailCode(user) {
  user.emailVerificationCode = undefined;
  user.emailVerificationExpires = undefined;
  user.emailVerificationAttempts = 0;
  // Legacy link-token field: never leave a valid old-style token behind when
  // a new code flow starts.
  user.emailVerificationToken = undefined;
}

/** Plain text + minimal HTML, English first then Urdu. No tracking pixels. */
export function buildVerificationMail({ code, name = "", minutes = CODE_MINUTES() } = {}) {
  const subject = "Your CricAll verification code / آپ کا CricAll تصدیقی کوڈ";
  const text =
    `Hello${name ? ` ${name}` : ""},\n\n` +
    `Enter this 6-digit code in CricAll to verify your email address:\n\n` +
    `${code}\n\n` +
    `The code expires in ${minutes} minutes. If you did not request this, you can ignore this message.\n\n` +
    `السلام علیکم${name ? ` ${name}` : ""}،\n\n` +
    `اپنا ای میل ایڈریس تصدیق کرنے کے لیے CricAll میں یہ 6 ہندسوں کا کوڈ درج کریں:\n\n` +
    `${code}\n\n` +
    `یہ کوڈ ${minutes} منٹ بعد ختم ہو جائے گا۔ اگر آپ نے یہ درخواست نہیں کی تو اس پیغام کو نظر انداز کر دیں۔\n`;

  const html =
    `<div style="font-family:Arial,sans-serif;line-height:1.6">` +
    `<p>Hello${name ? ` ${escapeHtml(name)}` : ""},</p>` +
    `<p>Enter this 6-digit code in CricAll to verify your email address:</p>` +
    `<p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p>` +
    `<p>The code expires in ${minutes} minutes. If you did not request this, you can ignore this message.</p>` +
    `<hr>` +
    `<p dir="rtl" lang="ur">السلام علیکم${name ? ` ${escapeHtml(name)}` : ""}،</p>` +
    `<p dir="rtl" lang="ur">اپنا ای میل ایڈریس تصدیق کرنے کے لیے CricAll میں یہ 6 ہندسوں کا کوڈ درج کریں:</p>` +
    `<p dir="rtl" lang="ur" style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p>` +
    `<p dir="rtl" lang="ur">یہ کوڈ ${minutes} منٹ بعد ختم ہو جائے گا۔ اگر آپ نے یہ درخواست نہیں کی تو اس پیغام کو نظر انداز کر دیں۔</p>` +
    `</div>`;

  return { subject, text, html };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Issue a fresh code on the user document and mail it.
 * Always resolves; mail failures are reported without throwing into the
 * request path (the console driver is the only logger of the message body).
 *
 * @returns {Promise<{sent: boolean, reason: string}>}
 */
export async function issueEmailCode(user, { force = false } = {}) {
  if (!user.email) return { sent: false, reason: "no_email" };
  if (!force && isEmailCoolingDown(user.verificationSentAt)) {
    return { sent: false, reason: "cooldown" };
  }

  const code = generateEmailCode();
  invalidateEmailCode(user);
  user.emailVerificationCode = hashEmailCode(code);
  user.emailVerificationExpires = getEmailCodeExpiry();
  user.verificationSentAt = new Date();
  await user.save();

  const mail = buildVerificationMail({ code, name: user.name });
  const result = await sendMail({
    to: user.email,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });

  return { sent: result.delivered, reason: result.delivered ? "sent" : "mail_failed" };
}
