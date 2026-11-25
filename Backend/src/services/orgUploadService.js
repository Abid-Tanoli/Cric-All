import mongoose from "mongoose";
import OrgUpload from "../models/OrgUpload.js";
import { orgIdFromReq } from "../middleware/orgAccess.js";
import { deleteStoredFile, uploadFilenameFromUrl } from "../utils/photoStore.js";

export const DEFAULT_ORG_UPLOAD_QUOTA_MB = 200;

/** Quota in bytes. Invalid/zero/negative values fail closed to the default. */
export function orgUploadQuotaBytes() {
  const value = Number(process.env.ORG_UPLOAD_QUOTA_MB);
  const mb = Number.isFinite(value) && value > 0 ? value : DEFAULT_ORG_UPLOAD_QUOTA_MB;
  return Math.floor(mb * 1024 * 1024);
}

export async function orgUploadUsage(orgId) {
  const [row] = await OrgUpload.aggregate([
    { $match: { organization: new mongoose.Types.ObjectId(String(orgId)) } },
    { $group: { _id: null, bytes: { $sum: "$bytes" }, files: { $sum: 1 } } },
  ]);
  return { bytes: row?.bytes || 0, files: row?.files || 0 };
}

// Serialize quota decisions per organization inside this process. Two uploads
// arriving together must not both see the same "almost full" total. A multi-
// replica deployment still needs a shared store for a hard global guarantee,
// but this closes the common single-process race.
const locks = new Map();
export function withOrgUploadLock(orgId, task) {
  const key = String(orgId);
  const previous = locks.get(key) || Promise.resolve();
  let unblock;
  const gate = new Promise((resolve) => {
    unblock = resolve;
  });
  const chained = previous.then(() => gate);
  locks.set(key, chained);
  return previous
    .then(task)
    .finally(() => {
      unblock();
      if (locks.get(key) === chained) locks.delete(key);
    });
}

export async function recordOrgUpload({ organization, uploader, filename, bytes }) {
  return OrgUpload.create({
    organization: new mongoose.Types.ObjectId(String(organization)),
    uploader: new mongoose.Types.ObjectId(String(uploader)),
    filename,
    bytes,
  });
}

/**
 * Remove an organization-owned image: its quota row, the WebP and its
 * thumbnail. Tenant-scoped by the organization id; files are only ever
 * unlinked when their URL parses to a filename this server wrote.
 */
export async function releaseOrgUpload(url, organization = null) {
  const filename = uploadFilenameFromUrl(url);
  if (!filename) return false;

  // Bulk/deletion paths may not know the tenant, so fall back to the ledger
  // row for this exact server-written filename.
  let orgId = organization;
  if (!orgId || !mongoose.Types.ObjectId.isValid(orgId)) {
    const row = await OrgUpload.findOne({ filename }).select("organization").lean();
    orgId = row?.organization;
  }

  if (orgId && mongoose.Types.ObjectId.isValid(orgId)) {
    await OrgUpload.deleteMany({ organization: new mongoose.Types.ObjectId(String(orgId)), filename });
    // Content-derived names can be shared by several players/orgs. Only the
    // last reference may unlink the bytes on disk.
    const remaining = await OrgUpload.countDocuments({ filename });
    if (remaining > 0) return false;
  }
  return deleteStoredFile(url);
}

export async function releaseOrgUploads(urls, organization = null) {
  let released = 0;
  for (const url of urls || []) {
    if (await releaseOrgUpload(url, organization)) released += 1;
  }
  return released;
}

export function organizationIdFromRequest(req) {
  return orgIdFromReq(req);
}
