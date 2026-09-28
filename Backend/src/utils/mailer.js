import logger from "./logger.js";

const log = logger.child({ service: "mailer" });

// Mail-sender abstraction. Two drivers:
//   console (default) — writes the message (and therefore the link) to the
//                       server log. This is the development driver and the
//                       only thing available until the owner supplies SMTP
//                       credentials.
//   smtp              — real delivery via Nodemailer, configured entirely by
//                       SMTP_* / MAIL_FROM env vars.
//
// Never log SMTP credentials; only the variable names appear in docs.
const DEFAULT_DRIVER = process.env.MAIL_DRIVER || "console";

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.MAIL_FROM);
}

function buildSmtpTransport() {
  // Lazy import so the console driver (and tests) never load Nodemailer.
  return import("nodemailer").then(({ default: nodemailer }) =>
    nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    })
  );
}

/**
 * Send a mail. Always resolves — mail failures are logged, never thrown into
 * the request path, so a broken mail provider cannot break registration.
 *
 * @param {{to: string, subject: string, text: string, html?: string}} message
 * @returns {Promise<{driver: string, delivered: boolean}>}
 */
export async function sendMail({ to, subject, text, html }) {
  if (!to) {
    log.warn({ event: "mail.skipped" }, "sendMail called without a recipient");
    return { driver: "none", delivered: false };
  }

  const requested = DEFAULT_DRIVER;
  const driver = requested === "smtp" && smtpConfigured() ? "smtp" : "console";

  if (requested === "smtp" && driver === "console") {
    log.warn(
      { event: "mail.fallback" },
      "MAIL_DRIVER=smtp but SMTP_HOST/MAIL_FROM are not configured; falling back to the console driver",
    );
  }

  if (driver === "console") {
    // Development driver: the link lands in the server log.
    log.info(
      { event: "mail.console", to, subject },
      `--- ${subject} ---\n${text}`,
    );
    return { driver: "console", delivered: true };
  }

  try {
    const transport = await buildSmtpTransport();
    await transport.sendMail({
      from: process.env.MAIL_FROM,
      to,
      subject,
      text,
      html: html || `<pre>${text}</pre>`,
    });
    log.info({ event: "mail.sent", to, subject }, "mail delivered");
    return { driver: "smtp", delivered: true };
  } catch (error) {
    log.error(
      { event: "mail.error", to, subject, err: error.message },
      "mail delivery failed",
    );
    return { driver: "smtp", delivered: false };
  }
}

export default { sendMail };
