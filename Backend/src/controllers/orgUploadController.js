import { processImageUpload } from "../utils/imagePipeline.js";
import { storeProcessedImage, isUploadedFilename, deleteStoredFile } from "../utils/photoStore.js";
import { recordAudit } from "../utils/audit.js";
import OrgUpload from "../models/OrgUpload.js";
import {
  orgUploadQuotaBytes,
  orgUploadUsage,
  recordOrgUpload,
  releaseOrgUpload,
  withOrgUploadLock,
} from "../services/orgUploadService.js";

function quotaError(used, incoming, quota) {
  const error = new Error(
    `Organization image quota exceeded: ${used + incoming} bytes requested with ${used} bytes used of ${quota} allowed`
  );
  error.status = 413;
  error.code = "ORG_UPLOAD_QUOTA_EXCEEDED";
  error.usedBytes = used;
  error.incomingBytes = incoming;
  error.quotaBytes = quota;
  return error;
}

function absoluteUrl(req, url) {
  const base = (process.env.PUBLIC_BACKEND_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
  return `${base}${url}`;
}

/** POST /api/organizations/:id/uploads/image — tenant-scoped by req.org. */
export const uploadOrganizationImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No image file uploaded" });
    }
    const organization = req.org?._id;
    if (!organization) {
      return res.status(404).json({ message: "Organization not found" });
    }

    // Decode/validate before writing anything. The original bytes are dropped.
    const processed = await processImageUpload(req.file.buffer, req.file.mimetype, req.file.originalname);
    const stored = await storeProcessedImage(processed.main, processed.thumbnail);

    let chargedBytes = stored.bytes;
    try {
      await withOrgUploadLock(String(organization), async () => {
        const duplicate = await OrgUpload.exists({ filename: stored.filename });
        // A second reference to identical content reuses the bytes already on
        // disk, so it must not be charged twice (or deleted while in use).
        if (duplicate) chargedBytes = 0;
        const quota = orgUploadQuotaBytes();
        const { bytes: used } = await orgUploadUsage(organization);
        if (used + chargedBytes > quota) throw quotaError(used, chargedBytes, quota);
        await recordOrgUpload({
          organization,
          uploader: req.user?._id,
          filename: stored.filename,
          bytes: chargedBytes,
        });
      });
    } catch (error) {
      // Quota check or bookkeeping failed: remove the files we just wrote so a
      // rejected upload does not consume anonymous disk space. A duplicate
      // content hash must keep the existing shared file.
      if (chargedBytes > 0) await deleteStoredFile(stored.url).catch(() => {});
      throw error;
    }

    await recordAudit({
      req,
      action: "org.upload_image",
      organization,
      targetType: "image",
      // AuditLog.targetId is capped at 64 chars; a sha256 filename is 68.
      targetId: stored.filename.slice(0, 64),
      targetLabel: req.file.originalname || stored.filename,
      metadata: {
        bytes: chargedBytes,
        width: processed.width,
        height: processed.height,
        thumbnail: stored.thumbnailFilename,
      },
    });

    const { bytes: usedAfter } = await orgUploadUsage(organization);
    return res.status(201).json({
      url: absoluteUrl(req, stored.url),
      thumbnailUrl: absoluteUrl(req, stored.thumbnailUrl),
      filename: stored.filename,
      bytes: chargedBytes,
      usageBytes: usedAfter,
      quotaBytes: orgUploadQuotaBytes(),
      message: "Image uploaded successfully",
    });
  } catch (error) {
    return res.status(error.status || 400).json({
      message: error.message || "Image upload failed",
      code: error.code,
      error: error.message,
    });
  }
};

/** DELETE /api/organizations/:id/uploads/image/:filename — frees quota bytes. */
export const deleteOrganizationImage = async (req, res) => {
  try {
    const filename = String(req.params.filename || "");
    if (!isUploadedFilename(filename)) {
      return res.status(400).json({ message: "Invalid upload filename" });
    }
    const organization = req.org?._id;
    const url = `/uploads/${filename}`;
    const removed = await releaseOrgUpload(url, organization);
    await recordAudit({
      req,
      action: "org.delete_image",
      organization,
      targetType: "image",
      targetId: filename.slice(0, 64),
      targetLabel: filename,
      metadata: { removed },
    });
    return res.json({ message: removed ? "Image deleted" : "Image was not present", removed });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "Could not delete image" });
  }
};
