import logger from "./logger.js";

const log = logger.child({ service: "mailer" });

// Two drivers:
//   console (default) — development/CI only. Writes the message (including any
//                       verification/reset link) to the server log.
//   smtp              — real delivery via a single pooled Nodemailer transport.
//
// Never log SMTP credentials, full recipient addresses in the SMTP path, or
// message bodies outside of the explicit console driver.
const DEFAULT_DRIVER = "console";
const REQUIRED_SMTP_VARS = ["MAIL_HOST", "MAIL_USER", "MAIL_PASS", "MAIL_FROM"];
const SMTP_TIMEOUT_MS = 10_000;
const THROTTLE_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_ISSUE_NOTIFY_LIMIT = 10;

let fallbackWarned = false;
let transportFactory = createNodemailerTransport;
let cachedTransport = null;
let cachedTransportKey = "";
const issueSendTimes = new Map();

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

export function resolveMailConfig(env = process.env) {
  const requestedDriver = clean(env.MAIL_DRIVER).toLowerCase() || DEFAULT_DRIVER;
  const missing = requestedDriver === "smtp"
    ? REQUIRED_SMTP_VARS.filter((name) => !clean(env[name]))
    : [];
  const port = Number.parseInt(clean(env.MAIL_PORT) || "587", 10);

  return {
    requestedDriver,
    driver: requestedDriver === "smtp" && missing.length === 0 ? "smtp" : "console",
    missing,
    host: clean(env.MAIL_HOST),
    port: Number.isFinite(port) && port > 0 ? port : 587,
    secure: clean(env.MAIL_SECURE).toLowerCase() === "true",
    user: clean(env.MAIL_USER),
    pass: clean(env.MAIL_PASS),
    from: clean(env.MAIL_FROM),
    replyTo: clean(env.MAIL_REPLY_TO),
  };
}

// Called at module load (i.e. at server startup, since controllers import this
// module) and before every send. Warns once; never throws.
export function validateMailConfig(env = process.env) {
  const config = resolveMailConfig(env);
  if (config.requestedDriver === "smtp" && config.driver === "console" && !fallbackWarned) {
    fallbackWarned = true;
    log.warn(
      { event: "mail.config_fallback", missing: config.missing },
      `MAIL_DRIVER=smtp but ${config.missing.join(", ")} missing; falling back to the console driver`,
    );
  }
  return config;
}

validateMailConfig();

function createNodemailerTransport(config) {
  // Lazy import keeps the console driver (and tests) free of Nodemailer.
  return import("nodemailer").then(({ default: nodemailer }) =>
    nodemailer.createTransport({
      pool: true,
      maxConnections: 1,
      maxMessages: 100,
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
    }),
  );
}

function getTransport(config) {
  const key = JSON.stringify([config.host, config.port, config.secure, config.user, config.pass]);
  if (cachedTransport && cachedTransportKey === key) return cachedTransport;
  cachedTransportKey = key;
  cachedTransport = Promise.resolve()
    .then(() => transportFactory(config))
    .catch((error) => {
      cachedTransport = null;
      throw error;
    });
  return cachedTransport;
}

function sanitizeHeaderValue(value) {
  return clean(value).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").slice(0, 320);
}

export function sanitizeSubject(value) {
  return sanitizeHeaderValue(value).slice(0, 200);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildHtml(text) {
  return `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(text)}</pre>`;
}

function recipientDomain(to) {
  const value = String(to ?? "");
  const at = value.lastIndexOf("@");
  if (at < 0) return "invalid";
  return value.slice(at + 1).replace(/[^a-z0-9.-]/gi, "").toLowerCase() || "invalid";
}

function safeError(error, config) {
  let message = String(error?.message || error || "unknown error")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 300);
  for (const secret of [config.pass, config.user, config.from, config.replyTo]) {
    if (secret) message = message.split(secret).join("[redacted]");
  }
  return message.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, "[email]");
}

/**
 * Send a mail. Always resolves — a mail failure is logged with the recipient
 * domain only and never thrown into the request path.
 *
 * @param {{to: string, subject: string, text: string, replyTo?: string}} message
 * @returns {Promise<{driver: string, delivered: boolean, error?: string}>}
 */
export async function sendMail({ to, subject, text, replyTo } = {}) {
  if (!to) {
    log.warn({ event: "mail.skipped" }, "sendMail called without a recipient");
    return { driver: "none", delivered: false };
  }

  const config = validateMailConfig();
  const safeTo = sanitizeHeaderValue(to);
  const safeSubject = sanitizeSubject(subject);
  const safeText = String(text ?? "");

  if (config.driver === "console") {
    log.info(
      { event: "mail.console", to: safeTo, subject: safeSubject },
      `--- ${safeSubject} ---\n${safeText}`,
    );
    return { driver: "console", delivered: true };
  }

  try {
    const transport = await getTransport(config);
    await transport.sendMail({
      from: config.from,
      to: safeTo,
      subject: safeSubject,
      text: safeText,
      html: buildHtml(safeText),
      ...(replyTo || config.replyTo
        ? { replyTo: sanitizeHeaderValue(replyTo || config.replyTo) }
        : {}),
    });
    log.info(
      { event: "mail.sent", domain: recipientDomain(safeTo), subject: safeSubject },
      "mail delivered",
    );
    return { driver: "smtp", delivered: true };
  } catch (error) {
    const message = safeError(error, config);
    log.error(
      { event: "mail.error", domain: recipientDomain(safeTo), error: message },
      "mail delivery failed",
    );
    return { driver: "smtp", delivered: false, error: message };
  }
}

/** Never awaits delivery and never rejects; used for non-critical notices. */
export function sendMailFireAndForget(message) {
  Promise.resolve()
    .then(() => sendMail(message))
    .catch((error) => {
      log.error(
        { event: "mail.background_error", domain: recipientDomain(message?.to), error: safeError(error, resolveMailConfig()) },
        "background mail failed",
      );
    });
}

/**
 * Issue-report notifications: per-recipient rolling-hour limit so the public
 * report form cannot be used to spam one mailbox. Configured by
 * MAIL_ISSUE_NOTIFY_MAX_PER_HOUR (default 10).
 */
export function sendIssueNotificationMail(message) {
  const configured = Number.parseInt(clean(process.env.MAIL_ISSUE_NOTIFY_MAX_PER_HOUR) || "", 10);
  const limit = Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_ISSUE_NOTIFY_LIMIT;
  const key = clean(message?.to).toLowerCase();
  const now = Date.now();
  const recent = (issueSendTimes.get(key) || []).filter((at) => now - at < THROTTLE_WINDOW_MS);

  if (recent.length >= limit) {
    log.warn({ event: "mail.throttled", domain: recipientDomain(key) }, "issue notification throttled");
    return { driver: "none", delivered: false, throttled: true };
  }

  recent.push(now);
  issueSendTimes.set(key, recent);
  if (issueSendTimes.size > 1000) {
    for (const [address, times] of issueSendTimes) {
      if (!times.some((at) => now - at < THROTTLE_WINDOW_MS)) issueSendTimes.delete(address);
    }
  }

  sendMailFireAndForget(message);
  return { driver: "pending", delivered: true, throttled: false };
}

/** Test seam: swap in a fake transport factory and clear throttle state. */
export function __resetMailerForTests(factory = createNodemailerTransport) {
  transportFactory = factory;
  cachedTransport = null;
  cachedTransportKey = "";
  issueSendTimes.clear();
  fallbackWarned = false;
}

export default { sendMail, sendMailFireAndForget, sendIssueNotificationMail };
