import { OAuth2Client } from "google-auth-library";

// Server-side Google ID-token verification.
//
// Hard rules:
//   * never trust email/name/picture sent by the client — only what Google
//     signed;
//   * fail CLOSED when GOOGLE_CLIENT_ID is missing (the google-auth-library
//     audience check is skipped when no audience is passed, which would let
//     any Google-signed token through);
//   * the token must be for OUR client, unexpired, issued by Google, and the
//     email must be marked verified by Google.

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export class GoogleVerificationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GoogleVerificationError";
    this.code = code;
  }
}

let client = null;
function getClient() {
  if (!client) client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  return client;
}

// Test seam: lets the test suite exercise every branch with a mocked
// verifier instead of live Google calls.
let verifyImpl = null;
export function __setGoogleVerifyImpl(fn) {
  verifyImpl = fn;
}

async function defaultVerify(idToken) {
  const audience = process.env.GOOGLE_CLIENT_ID;
  if (!audience) {
    throw new GoogleVerificationError(
      "GOOGLE_CLIENT_ID_MISSING",
      "GOOGLE_CLIENT_ID is not configured on the server",
    );
  }
  const ticket = await getClient().verifyIdToken({ idToken, audience });
  return ticket.getPayload();
}

/**
 * Verify a Google ID token and return a normalized, trusted identity.
 *
 * @param {string} idToken
 * @returns {Promise<{googleId: string, email: string, name: string|null, picture: string|null}>}
 * @throws {GoogleVerificationError}
 */
export async function verifyGoogleIdToken(idToken) {
  if (!idToken || typeof idToken !== "string") {
    throw new GoogleVerificationError("CREDENTIAL_INVALID", "Google credential is missing");
  }

  let payload;
  try {
    payload = verifyImpl ? await verifyImpl(idToken) : await defaultVerify(idToken);
  } catch (error) {
    if (error instanceof GoogleVerificationError) throw error;
    throw new GoogleVerificationError("TOKEN_INVALID", error?.message || "invalid Google token");
  }

  if (!payload || typeof payload !== "object") {
    throw new GoogleVerificationError("TOKEN_INVALID", "Google token payload missing");
  }

  const audience = process.env.GOOGLE_CLIENT_ID;
  if (!audience) {
    throw new GoogleVerificationError(
      "GOOGLE_CLIENT_ID_MISSING",
      "GOOGLE_CLIENT_ID is not configured on the server",
    );
  }

  const { aud, iss, exp } = payload;

  const auds = Array.isArray(aud) ? aud : [aud];
  if (!auds.includes(audience)) {
    throw new GoogleVerificationError("AUDIENCE_MISMATCH", "Google token audience mismatch");
  }

  if (!iss || !GOOGLE_ISSUERS.includes(iss)) {
    throw new GoogleVerificationError("ISSUER_INVALID", "Google token issuer mismatch");
  }

  if (exp && Number(exp) * 1000 < Date.now()) {
    throw new GoogleVerificationError("TOKEN_EXPIRED", "Google token expired");
  }

  if (!payload.email) {
    throw new GoogleVerificationError("EMAIL_MISSING", "Google token has no email");
  }

  // An unverified Google email must never be used to identify (or take over)
  // an account.
  if (payload.email_verified !== true && payload.email_verified !== "true") {
    throw new GoogleVerificationError("EMAIL_UNVERIFIED", "Google email is not verified");
  }

  return {
    googleId: String(payload.sub),
    email: String(payload.email).trim().toLowerCase(),
    name: typeof payload.name === "string" && payload.name.trim() ? payload.name : null,
    picture: typeof payload.picture === "string" ? payload.picture : null,
  };
}

export default { verifyGoogleIdToken, GoogleVerificationError };
