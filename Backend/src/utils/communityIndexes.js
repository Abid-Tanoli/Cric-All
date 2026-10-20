import logger from "./logger.js";
import CommunityReport from "../models/CommunityReport.js";
import CommunityLike from "../models/CommunityLike.js";

const log = logger.child({ service: "communityIndexes" });

// The specs below mirror the schema declarations in CommunityReport.js and
// CommunityLike.js. They are duplicated here (like utils/invitationIndexes.js
// duplicates its specs) because `Model.init()` is not reliable this early in
// boot: on a fresh database the model's collection does not exist yet, and the
// in-server init() call fails before it can create it. `collection.createIndex`
// creates both the collection and the index, so whichever of the two paths
// builds first, an identical spec means the final state is the same.
const REPORT_POST_SPEC = { reporter: 1, post: 1 };
const REPORT_POST_OPTIONS = {
  unique: true,
  name: "reporter_1_post_1",
  partialFilterExpression: { post: { $type: "objectId" } },
};
const REPORT_COMMENT_SPEC = { reporter: 1, comment: 1 };
const REPORT_COMMENT_OPTIONS = {
  unique: true,
  name: "reporter_1_comment_1",
  partialFilterExpression: { comment: { $type: "objectId" } },
};
const LIKE_SPEC = { user: 1, post: 1 };
const LIKE_OPTIONS = { unique: true, name: "user_1_post_1" };

const isIndexConflict = (err) => err?.code === 85 || err?.code === 86;

async function createIndexBestEffort(collection, spec, options, label) {
  try {
    await collection.createIndex(spec, options);
    log.info({ event: "index.community_ready", index: options.name }, `ensured ${label}`);
    return true;
  } catch (err) {
    // Another process built the identical index a moment ago.
    if (isIndexConflict(err) || err?.code === 11000) return false;
    log.warn(
      { event: "index.community_failed", index: options.name, err: err.message },
      `community index build failed for ${options.name}; duplicate likes/reports stay app-enforced only`,
    );
    return false;
  }
}

/**
 * Build the community content unique indexes at startup.
 *
 * Why this exists: "one report per user per post" and "one like per user per
 * post" are promises of the write path. Until the unique indexes exist, only
 * the app's own guards enforce them — the report handler answers ordinary
 * duplicates with an explicit read first, but two racing identical requests
 * can both pass that read. The index is the concurrency backstop, and on a
 * fresh database nothing else in this boot path would ever build it.
 *
 * Best-effort by design, matching utils/identityIndexes.js and
 * utils/invitationIndexes.js: failures are logged, never thrown — an index
 * hiccup must not take the API down.
 */
export async function ensureCommunityIndexes() {
  await createIndexBestEffort(
    CommunityReport.collection,
    REPORT_POST_SPEC,
    REPORT_POST_OPTIONS,
    "one report per user per post",
  );
  await createIndexBestEffort(
    CommunityReport.collection,
    REPORT_COMMENT_SPEC,
    REPORT_COMMENT_OPTIONS,
    "one report per user per comment",
  );
  await createIndexBestEffort(
    CommunityLike.collection,
    LIKE_SPEC,
    LIKE_OPTIONS,
    "one like per user per post",
  );
}

export default { ensureCommunityIndexes };
