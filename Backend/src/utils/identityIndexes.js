import logger from "./logger.js";
import User from "../models/User.js";

const log = logger.child({ service: "identityIndexes" });

const EMAIL_INDEX = "email_1";
const PHONE_INDEX = "phone_1";

const EMAIL_INDEX_SPEC = { email: 1 };
const EMAIL_INDEX_OPTIONS = { unique: true, sparse: true, name: EMAIL_INDEX };
const PHONE_INDEX_SPEC = { phone: 1 };
const PHONE_INDEX_OPTIONS = {
  unique: true,
  partialFilterExpression: { phone: { $type: "string", $gt: "" } },
  name: PHONE_INDEX,
};

function sameSpec(index, spec, options) {
  if (JSON.stringify(index.key) !== JSON.stringify(spec)) return false;
  if (Boolean(index.unique) !== Boolean(options.unique)) return false;
  if (Boolean(index.sparse) !== Boolean(options.sparse)) return false;
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
 * Make sure the identity indexes match what the User schema declares.
 *
 * Why this exists: phone-only accounts need the `email` index to be unique
 * BUT sparse (a plain unique index collides on two documents that both omit
 * the field). Deployments created before phone signup ran with the old
 * non-sparse `email_1`, and MongoDB refuses to change an index's options in
 * place — Mongoose's automatic index build fails on the conflict. This
 * function performs the swap the schema upgrade needs, idempotently:
 *
 *   - rebuilds `email_1` as unique+sparse when it exists in the old form;
 *   - creates the partial unique `phone_1` index when it is missing;
 *   - leaves everything else alone.
 *
 * Safe to run in any interleaving with Mongoose's own autoIndex: every
 * createIndex here uses the exact spec autoIndex wants, so whichever wins the
 * race the final state is the same.
 *
 * Best-effort by design: failures are logged, never thrown, because an index
 * hiccup must not take the API down. Duplicated legacy phone numbers (the
 * thing that can block phone_1) are reported by the migrateUserPhoneIdentity
 * script instead of being fixed here — deleting a user is a business decision.
 */
export async function ensureUserIdentityIndexes() {
  try {
    const collection = User.collection;
    const byName = new Map((await collection.indexes()).map((i) => [i.name, i]));

    const emailIndex = byName.get(EMAIL_INDEX);
    if (emailIndex && !sameSpec(emailIndex, EMAIL_INDEX_SPEC, EMAIL_INDEX_OPTIONS)) {
      await dropIndexIfExists(collection, EMAIL_INDEX);
      await createIndexBestEffort(collection, EMAIL_INDEX_SPEC, EMAIL_INDEX_OPTIONS);
      log.info(
        { event: "index.email_rebuilt" },
        `rebuilt ${EMAIL_INDEX} as unique+sparse (phone-only accounts omit email)`,
      );
    }

    const phoneIndex = byName.get(PHONE_INDEX);
    if (phoneIndex && !sameSpec(phoneIndex, PHONE_INDEX_SPEC, PHONE_INDEX_OPTIONS)) {
      await dropIndexIfExists(collection, PHONE_INDEX);
    }
    if (!phoneIndex || !sameSpec(phoneIndex, PHONE_INDEX_SPEC, PHONE_INDEX_OPTIONS)) {
      const created = await createIndexBestEffort(collection, PHONE_INDEX_SPEC, PHONE_INDEX_OPTIONS);
      if (created) {
        log.info({ event: "index.phone_created" }, `created ${PHONE_INDEX} (unique phone numbers)`);
      }
    }
  } catch (err) {
    log.warn(
      { event: "index.identity_check_failed", err: err.message },
      "identity index self-check failed (duplicate legacy phone numbers?); " +
        "run node src/scripts/migrateUserPhoneIdentity.js to inspect",
    );
  }
}

export default { ensureUserIdentityIndexes };
