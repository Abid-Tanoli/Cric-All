import logger from "./logger.js";

const log = logger.child({ service: "sms" });

// SMS-sender abstraction, same shape as the mailer (utils/mailer.js). Two
// drivers:
//   console (default) — writes the message (and therefore the OTP) to the
//                       server log. Development driver; the only one available
//                       until the owner supplies an SMS provider account.
//   http              — real delivery via a provider-agnostic HTTP webhook,
//                       configured entirely by SMS_* env vars. The account
//                       behind SMS_API_URL is an OWNER ACTION: creating it is
//                       out of scope for development, exactly like the Google
//                       OAuth client and the SMTP credentials.
//
// Never log the API key; only the variable names appear in docs.
const DEFAULT_DRIVER = process.env.SMS_DRIVER || "console";

function httpConfigured() {
  return Boolean(process.env.SMS_API_URL);
}

/**
 * Send one SMS. Always resolves — delivery failures are logged and reported
 * as `delivered: false`, never thrown into the request path, so a broken SMS
 * provider cannot break registration.
 *
 * @param {{to: string, text: string}} message `to` is the normalized
 *   digits-only number (utils/phone.js).
 * @returns {Promise<{driver: "http"|"console"|"none", delivered: boolean, providerConfigured: boolean}>}
 */
export async function sendSms({ to, text }) {
  if (!to) {
    log.warn({ event: "sms.skipped" }, "sendSms called without a recipient");
    return { driver: "none", delivered: false, providerConfigured: false };
  }

  const requested = DEFAULT_DRIVER;
  const configured = requested === "http" && httpConfigured();
  const providerConfigured = configured;

  if (requested === "http" && !configured) {
    log.warn(
      { event: "sms.fallback" },
      "SMS_DRIVER=http but SMS_API_URL is not configured; falling back to the console driver",
    );
  }

  if (!configured) {
    // Development driver: the OTP lands in the server log.
    log.info(
      { event: "sms.console", to },
      `--- SMS to ${to} ---\n${text}`,
    );
    return { driver: "console", delivered: true, providerConfigured };
  }

  try {
    const headers = { "Content-Type": "application/json" };
    if (process.env.SMS_API_KEY) {
      headers.Authorization = `Bearer ${process.env.SMS_API_KEY}`;
    }
    const response = await fetch(process.env.SMS_API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        to,
        text,
        message: text,
        from: process.env.SMS_SENDER_ID || undefined,
      }),
    });
    if (!response.ok) {
      throw new Error(`SMS API responded with ${response.status}`);
    }
    log.info({ event: "sms.sent", to }, "sms delivered");
    return { driver: "http", delivered: true, providerConfigured };
  } catch (error) {
    log.error(
      { event: "sms.error", to, err: error.message },
      "sms delivery failed",
    );
    return { driver: "http", delivered: false, providerConfigured };
  }
}

/** True when a real SMS provider account is configured (owner action). */
export const smsProviderConfigured = () =>
  process.env.SMS_DRIVER === "http" && httpConfigured();

export default { sendSms, smsProviderConfigured };
