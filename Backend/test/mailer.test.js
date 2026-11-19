import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  sendMail,
  sendMailFireAndForget,
  sendIssueNotificationMail,
  __resetMailerForTests,
} from "../src/utils/mailer.js";

const MAIL_KEYS = [
  "MAIL_DRIVER", "MAIL_HOST", "MAIL_PORT", "MAIL_SECURE", "MAIL_USER",
  "MAIL_PASS", "MAIL_FROM", "MAIL_REPLY_TO", "MAIL_ISSUE_NOTIFY_MAX_PER_HOUR",
];
const savedEnv = Object.fromEntries(MAIL_KEYS.map((key) => [key, process.env[key]]));

let calls;
let captured;
let originalConsole;

beforeEach(() => {
  for (const key of MAIL_KEYS) delete process.env[key];
  calls = [];
  captured = { log: [], warn: [], error: [] };
  originalConsole = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...args) => captured.log.push(args.map(String).join(" "));
  console.warn = (...args) => captured.warn.push(args.map(String).join(" "));
  console.error = (...args) => captured.error.push(args.map(String).join(" "));
});

afterEach(() => {
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  for (const key of MAIL_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  __resetMailerForTests();
});

function setSmtpEnv(overrides = {}) {
  Object.assign(process.env, {
    MAIL_DRIVER: "smtp",
    MAIL_HOST: "smtp.example.com",
    MAIL_PORT: "587",
    MAIL_SECURE: "false",
    MAIL_USER: "mail-user",
    MAIL_PASS: "super-secret-pass",
    MAIL_FROM: "CricAll <no-reply@example.com>",
    MAIL_REPLY_TO: "reply@example.com",
    ...overrides,
  });
}

function useFakeTransport({ fail = false } = {}) {
  __resetMailerForTests(() => ({
    sendMail: async (message) => {
      calls.push(message);
      if (fail) throw new Error(`SMTP 535 failed for ${process.env.MAIL_PASS}`);
      return { messageId: "fake" };
    },
  }));
}

test("console driver does not throw and never creates a transport", async () => {
  let factoryCalls = 0;
  __resetMailerForTests(() => {
    factoryCalls += 1;
    throw new Error("console driver must not build a transport");
  });
  process.env.MAIL_DRIVER = "console";

  const result = await sendMail({ to: "dev@example.com", subject: "Hi", text: "body" });
  assert.deepEqual(result, { driver: "console", delivered: true });
  assert.equal(factoryCalls, 0);
});

test("smtp driver with missing vars falls back to console and names the variables", async () => {
  let factoryCalls = 0;
  __resetMailerForTests(() => {
    factoryCalls += 1;
    throw new Error("must not build a transport without config");
  });
  Object.assign(process.env, { MAIL_DRIVER: "smtp", MAIL_FROM: "" });

  const result = await sendMail({ to: "dev@example.com", subject: "Hi", text: "body" });
  assert.equal(result.driver, "console");
  assert.equal(result.delivered, true);
  assert.equal(factoryCalls, 0);
  const warning = captured.warn.join("\n");
  for (const name of ["MAIL_HOST", "MAIL_USER", "MAIL_PASS", "MAIL_FROM"]) {
    assert.match(warning, new RegExp(name));
  }
});

test("smtp mocked transport gets sanitized subject, escaped HTML and plain text", async () => {
  setSmtpEnv();
  useFakeTransport();

  const text = "Description <script>alert('x')</script>\nNext & more";
  const result = await sendMail({
    to: "reader@example.com",
    subject: "Issue\nBcc: evil@example.com\r\nX: y",
    text,
  });

  assert.equal(result.delivered, true);
  assert.equal(calls.length, 1);
  const message = calls[0];
  assert.equal(message.from, "CricAll <no-reply@example.com>");
  assert.equal(message.to, "reader@example.com");
  assert.equal(message.replyTo, "reply@example.com");
  assert.equal(message.subject, "Issue Bcc: evil@example.com X: y");
  assert.doesNotMatch(message.subject, /[\r\n]/);
  assert.equal(message.text, text);
  assert.match(message.html, /&lt;script&gt;/);
  assert.match(message.html, /&amp;/);
  assert.doesNotMatch(message.html, /<script>/);
});

test("a rejecting transporter never fails the caller and logs no secrets", async () => {
  setSmtpEnv();
  useFakeTransport({ fail: true });

  const result = await sendMail({ to: "reader@example.com", subject: "Hi", text: "body" });
  assert.equal(result.driver, "smtp");
  assert.equal(result.delivered, false);
  assert.doesNotThrow(() =>
    sendMailFireAndForget({ to: "reader@example.com", subject: "Hi", text: "body" }),
  );
  await new Promise((resolve) => setTimeout(resolve, 10));

  const errorLog = captured.error.join("\n");
  assert.doesNotMatch(errorLog, /super-secret-pass/);
  assert.doesNotMatch(errorLog, /reader@example\.com/);
  assert.match(errorLog, /domain":"example\.com/);
});

test("issue notifications throttle after the configured hourly limit", async () => {
  setSmtpEnv({ MAIL_ISSUE_NOTIFY_MAX_PER_HOUR: "1" });
  useFakeTransport();
  const message = { to: "admin@example.com", subject: "New issue", text: "Description" };

  const first = sendIssueNotificationMail(message);
  const second = sendIssueNotificationMail(message);
  assert.equal(first.throttled, false);
  assert.equal(second.throttled, true);
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(calls.length, 1);
  assert.match(captured.warn.join("\n"), /throttled/);
});
