import logger from "./logger.js";
import Invitation from "../models/Invitation.js";

const log = logger.child({ service: "invitationIndexes" });

// Same auto-generated names Mongoose gives the schema's index declarations,
// so this check and autoIndex always talk about the same index.
const EMAIL_INDEX = "organization_1_email_1";
const PHONE_INDEX = "organization_1_phone_1";

const EMAIL_INDEX_SPEC = { organization: 1, email: 1 };
const EMAIL_INDEX_OPTIONS = {
  unique: true,
  partialFilterExpression: { status: "pending", email: { $type: "string", $gt: "" } },
  name: EMAIL_INDEX,
};
const PHONE_INDEX_SPEC = { organization: 1, phone: 1 };
const PHONE_INDEX_OPTIONS = {
  unique: true,
  partialFilterExpression: { status: "pending", phone: { $type: "string", $gt: "" } },
  name: PHONE_INDEX,
};

function sameSpec(index, spec, options) {
  if (JSON.stringify(index.key) !== JSON.stringify(spec)) return false;
  if (Boolean(index.unique) !== Boolean(options.unique)) return false;
  const want = options.partialFilterExpression
    ? JSON.stringify(options.partialFilterExpression)
    : undefined;
  const have = index.partialFilterExpression ? JSON.stringify(index.partialFilterExpression) : undefined;
  return want === have;
}

const isIndexMissing = (err) => err?.code === 27 || /index .* not found/i.test(err?.message || "");
const isIndexConflict = (err) => err?.code === 85 || err?.code === 86;

async function dropIndexIfExists(collection, name) {
  try {
    await collection.dropIndex(name);
    return true;
  } catch (err) {
    if (isIndexMissing(err)) return false;
    throw err;
  }
}

async function createIndexBestEffort(collection, spec, options) {
  try {
    await collection.createIndex(spec, options);
    return true;
  } catch (err) {
    // Another process built the identical index a moment ago.
    if (isIndexConflict(err) || err?.code === 11000) return false;
    throw err;
  }
}

/**
 * Make sure the invitation uniqueness indexes match what the schema declares.
 *
 * Why this exists: phone-only invitations store an empty email, and the
 * pre-phone unique index on {organization, email} (partial on status alone)
 * counts two empty emails as a collision — the second phone invite to the same
 * organization would fail with a duplicate-key error. MongoDB cannot change an
 * index's partial filter in place, and Mongoose's automatic index build fails
 * on the spec conflict, so the swap has to be done explicitly. This function
 * performs it idempotently:
 *
 *   - rebuilds organization_1_email_1 with the $gt:"" filter when it exists
 *     in the old form;
 *   - creates the partial unique organization_1_phone_1 index when missing;
 *   - leaves everything else alone.
 *
 * Safe to interleave with Mongoose's own autoIndex: every createIndex here
 * uses the exact spec autoIndex wants, so whichever wins the race the final
 * state is the same. Best-effort by design — failures are logged, never
 * thrown, because an index hiccup must not take the API down.
 */
export async function ensureInvitationAddressIndexes() {
  try {
    const collection = Invitation.collection;
    const byName = new Map((await collection.indexes()).map((i) => [i.name, i]));

    const emailIndex = byName.get(EMAIL_INDEX);
    if (emailIndex && !sameSpec(emailIndex, EMAIL_INDEX_SPEC, EMAIL_INDEX_OPTIONS)) {
      await dropIndexIfExists(collection, EMAIL_INDEX);
      await createIndexBestEffort(collection, EMAIL_INDEX_SPEC, EMAIL_INDEX_OPTIONS);
      log.info(
        { event: "index.invitation_email_rebuilt" },
        `rebuilt ${EMAIL_INDEX} (one pending invitation per email address)`,
      );
    }

    const phoneIndex = byName.get(PHONE_INDEX);
    if (phoneIndex && !sameSpec(phoneIndex, PHONE_INDEX_SPEC, PHONE_INDEX_OPTIONS)) {
      await dropIndexIfExists(collection, PHONE_INDEX);
    }
    if (!phoneIndex || !sameSpec(phoneIndex, PHONE_INDEX_SPEC, PHONE_INDEX_OPTIONS)) {
      const created = await createIndexBestEffort(collection, PHONE_INDEX_SPEC, PHONE_INDEX_OPTIONS);
      if (created) {
        log.info(
          { event: "index.invitation_phone_created" },
          `created ${PHONE_INDEX} (one pending invitation per phone number)`,
        );
      }
    }
  } catch (err) {
    log.warn(
      { event: "index.invitation_check_failed", err: err.message },
      "invitation index self-check failed; a pending invitation may be blocking the rebuild — list duplicates in the invitations collection and revoke one",
    );
  }
}

export default { ensureInvitationAddressIndexes };
