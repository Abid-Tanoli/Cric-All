import { promises as dns } from "dns";

/**
 * Email policy for signup and "change verification email".
 *
 * - syntax/disposable checks are purely local and always run;
 * - the MX check uses Node's built-in `dns` resolver (no external API) and
 *   FAILS OPEN: it only rejects an address when DNS proves the domain cannot
 *   receive mail. SERVFAIL, timeouts and other resolver errors are allowed so
 *   a temporary DNS outage never blocks registration.
 *
 * Tests replace the resolver with `setMxLookupForTests`; CI may set
 * EMAIL_MX_CHECK=false so the suite never touches the network.
 */

// Small, deliberately explicit list. Add new domains here (lowercase, no @).
export const DISPOSABLE_EMAIL_DOMAINS = Object.freeze([
  "10minutemail.com",
  "dispose.it",
  "fakeinbox.com",
  "getairmail.com",
  "guerrillamail.com",
  "mailinator.com",
  "mailtmp.com",
  "mailsac.com",
  "sharklasers.com",
  "tempmail.com",
  "temp-mail.org",
  "throwawaymail.com",
  "trashmail.com",
  "yopmail.com",
]);

const EMAIL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

export const normalizeEmail = (value) => String(value ?? "").trim().toLowerCase();

export const isValidEmailSyntax = (value) => {
  const email = normalizeEmail(value);
  return email.length >= 3 && email.length <= 254 && EMAIL_RE.test(email);
};

export const emailDomain = (value) => {
  const email = normalizeEmail(value);
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1);
};

export const isDisposableEmail = (value) =>
  DISPOSABLE_EMAIL_DOMAINS.includes(emailDomain(value));

const MX_TIMEOUT_MS = () => {
  const configured = Number.parseInt(String(process.env.EMAIL_MX_TIMEOUT_MS || ""), 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 2500;
};

const NO_MAIL_CODES = new Set(["ENOTFOUND", "ENODATA", "ENODOMAINNOTFOUND", "EAI_NONAME"]);

/** True only when DNS says the domain has no A/AAAA records either. */
async function hasNoAddressRecord(domain) {
  for (const resolver of [dns.resolve4, dns.resolve6]) {
    try {
      const records = await resolver(domain);
      if (records?.length) return false;
    } catch (error) {
      if (!NO_MAIL_CODES.has(error?.code)) return false; // fail open
    }
  }
  return true;
}

async function defaultMxLookup(domain) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve("unknown"), MX_TIMEOUT_MS());
  });
  timer.unref?.();

  try {
    const result = await Promise.race([
      (async () => {
        try {
          const records = await dns.resolveMx(domain);
          return records?.length ? true : (await hasNoAddressRecord(domain) ? false : true);
        } catch (error) {
          if (!NO_MAIL_CODES.has(error?.code)) return "unknown"; // SERVFAIL etc.
          return await hasNoAddressRecord(domain) ? false : true;
        }
      })(),
      timeout,
    ]);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

let mxLookup = defaultMxLookup;

/** Test seam: replace the DNS lookup (never used by production code). */
export function setMxLookupForTests(lookup) {
  mxLookup = typeof lookup === "function" ? lookup : defaultMxLookup;
}

export function resetMxLookupForTests() {
  mxLookup = defaultMxLookup;
}

const mxCheckEnabled = () =>
  String(process.env.EMAIL_MX_CHECK ?? "true").trim().toLowerCase() !== "false";

/**
 * @returns {Promise<{ok: boolean, reason?: string}>} reason is one of
 *   INVALID_EMAIL, DISPOSABLE_EMAIL, NO_MX_RECORD.
 */
export async function checkEmailPolicy(value) {
  const email = normalizeEmail(value);
  if (!isValidEmailSyntax(email)) return { ok: false, reason: "INVALID_EMAIL" };
  if (isDisposableEmail(email)) return { ok: false, reason: "DISPOSABLE_EMAIL" };
  if (!mxCheckEnabled()) return { ok: true };

  let verdict;
  try {
    verdict = await mxLookup(emailDomain(email));
  } catch {
    verdict = "unknown";
  }
  // Only an explicit false (no MX and no address records) blocks signup.
  return verdict === false
    ? { ok: false, reason: "NO_MX_RECORD" }
    : { ok: true };
}

export default {
  DISPOSABLE_EMAIL_DOMAINS,
  normalizeEmail,
  isValidEmailSyntax,
  isDisposableEmail,
  checkEmailPolicy,
  setMxLookupForTests,
  resetMxLookupForTests,
};
