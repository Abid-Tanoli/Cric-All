import crypto from "crypto";
import { sendSms } from "./smsSender.js";
import { sendMail } from "./mailer.js";

// Phone verification, mirroring the email-verification design in
// utils/emailVerification.js: a short-lived, single-use secret stored only as
// its SHA-256 hash, a per-account resend cool-down, and one shared expiry
// check. The secret is a 6-digit numeric OTP instead of a link token, because
// the phone channel has nowhere to click.
//
// Brute force: a 6-digit code is guessable, so on top of the route rate limit
// each account gets MAX_OTP_ATTEMPTS wrong guesses before the code is
// invalidated (the caller must request a new one).

const OTP_EXPIRY_MS = (Number(process.env.PHONE_OTP_MINUTES) || 10) * 60 * 1000;
// Minimum gap between two OTPs to the same account (mirrors RESEND_COOLDOWN_MS).
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

export { OTP_EXPIRY_MS, RESEND_COOLDOWN_MS, MAX_OTP_ATTEMPTS };

/** 6 digits, zero-padded — "004213", never "4213". */
export const generateOtp = () =>
  String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

export const hashOtp = (otp) =>
  crypto.createHash("sha256").update(String(otp)).digest("hex");

export const getOtpExpiry = () => new Date(Date.now() + OTP_EXPIRY_MS);

// Missing/invalid expiry counts as expired (same rule as email verification).
export const isOtpExpired = (expires) => {
  const time = expires ? new Date(expires).getTime() : NaN;
  return !Number.isFinite(time) || time < Date.now();
};

export const isOtpCoolingDown = (sentAt, now = Date.now()) => {
  if (!sentAt) return false;
  const time = new Date(sentAt).getTime();
  return Number.isFinite(time) && now - time < RESEND_COOLDOWN_MS;
};

/**
 * Issue a fresh OTP on the user document and deliver it.
 *
 * Delivery, in priority order:
 *   1. SMS — via the provider-agnostic sender. The console driver (no provider
 *      configured yet) writes the code to the server log for development.
 *   2. Email — fallback when no SMS provider could deliver and the account has
 *      an address on file.
 *   3. If neither channel is available the result says so explicitly
 *      (`sent: false, reason: "no_delivery_channel"`) — never a silent failure.
 *
 * Always resolves; the caller decides what the API response looks like.
 *
 * @returns {Promise<{sent: boolean, channel: "sms"|"email"|"console"|"none", reason: string, message: string}>}
 */
export async function issuePhoneOtp(user, { force = false } = {}) {
  if (!user.phone) {
    return { sent: false, channel: "none", reason: "no_phone", message: "This account has no phone number on file." };
  }
  if (!force && isOtpCoolingDown(user.phoneVerificationSentAt)) {
    return { sent: false, channel: "none", reason: "cooldown", message: "A code was sent recently. Please wait a minute before requesting another." };
  }

  const otp = generateOtp();
  user.phoneVerificationOtp = hashOtp(otp);
  user.phoneVerificationExpires = getOtpExpiry();
  user.phoneVerificationSentAt = new Date();
  user.phoneVerificationAttempts = 0;
  await user.save();

  const text =
    `Your CricAll verification code is ${otp}. ` +
    `It expires in ${Math.max(1, Math.round(OTP_EXPIRY_MS / 60000))} minute(s) and can be used once. ` +
    `If you did not request this, you can ignore this message.`;

  // 1. SMS first.
  const sms = await sendSms({ to: user.phone, text });
  if (sms.driver === "http" && sms.delivered) {
    return {
      sent: true,
      channel: "sms",
      reason: "sms_sent",
      message: "Verification code sent by SMS.",
    };
  }

  // 2. Fallback: email the code when the account also has an address on file.
  if (user.email) {
    const mail = await sendMail({
      to: user.email,
      subject: "Your CricAll phone verification code",
      text:
        `Hello ${user.name},\n\n` +
        `Use this code to verify your phone number:\n\n${text}\n`,
    });
    if (mail.delivered) {
      return {
        sent: true,
        channel: "email",
        reason: sms.providerConfigured ? "sms_failed_email_fallback" : "no_sms_provider_email_fallback",
        message: sms.providerConfigured
          ? "SMS delivery failed; the code was emailed to your address instead."
          : "No SMS provider is configured yet; the code was emailed to your address instead.",
      };
    }
  }

  // 3. Console driver: the code is in the server log (development).
  if (sms.driver === "console" && sms.delivered) {
    return {
      sent: true,
      channel: "console",
      reason: "no_sms_provider_console",
      message:
        "No SMS provider is configured and this account has no email address, " +
        "so the code was written to the backend server log instead.",
    };
  }

  return {
    sent: false,
    channel: "none",
    reason: "no_delivery_channel",
    message:
      "We could not deliver a verification code: no SMS provider is configured " +
      "and this account has no email address on file.",
  };
}
