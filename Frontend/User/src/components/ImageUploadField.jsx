import { useRef, useState } from "react";
import SafeImage from "../../../Shared/components/SafeImage.jsx";
import { API_BASE_URL } from "../../../Shared/config/env.js";
import { deleteOrgImage, uploadOrgImage } from "../services/organizationApi";

// Small reusable photo field for organization forms. The server does the real
// validation (magic bytes, animated/pixel guards, resize and WebP encoding);
// this component only narrows the picker and shows progress. It always hands
// the caller a local `/uploads/...` path, never an absolute or off-site URL.

const ACCEPT = "image/jpeg,image/png,image/webp";
const MEDIA_ORIGIN = API_BASE_URL.replace(/\/api$/, "");

export function imageUploadPath(data) {
  const raw = String(data?.url || "");
  if (raw.startsWith("/uploads/")) return raw;
  try {
    const parsed = new URL(raw);
    if (parsed.pathname.startsWith("/uploads/")) return parsed.pathname;
  } catch {
    /* not a URL */
  }
  return "";
}

export default function ImageUploadField({
  orgId,
  value = "",
  onChange,
  label = "Photo",
  id = "image-upload",
  disabled = false,
}) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const upload = async (event) => {
    const file = event.target.files?.[0];
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;
    setError("");
    if (!ACCEPT.split(",").includes(file.type)) {
      setError("Choose a JPG, PNG or WebP image.");
      return;
    }
    setUploading(true);
    try {
      const data = await uploadOrgImage(orgId, file);
      const path = imageUploadPath(data);
      if (!path) throw new Error("The server did not return an upload URL.");
      onChange?.(path);
    } catch (err) {
      setError(err.message || "Upload failed. Please try a smaller image.");
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    setError("");
    onChange?.("");
    // A photo removed before the form is saved has no player to release it,
    // so release the org's quota row immediately. The backend keeps shared
    // content until its last reference is gone.
    const path = imageUploadPath({ url: value });
    if (!orgId || !path) return;
    try {
      await deleteOrgImage(orgId, path.slice("/uploads/".length));
    } catch (err) {
      setError(err.message || "Could not remove the uploaded image.");
    }
  };

  return (
    <div>
      <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-cric-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-3">
        {value ? (
          <div className="relative">
            <SafeImage
              src={/^https?:\/\//i.test(value) ? value : `${MEDIA_ORIGIN}${value}`}
              alt={`${label} preview`}
              className="h-20 w-20 rounded-xl border border-cric-border object-cover"
            />
            <button
              type="button"
              onClick={remove}
              disabled={disabled || uploading}
              aria-label={`Remove ${label.toLowerCase()}`}
              className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs font-black text-white shadow disabled:opacity-60"
            >
              ×
            </button>
          </div>
        ) : null}
        <label
          className={`flex min-h-16 cursor-pointer items-center rounded-xl border border-dashed border-cric-border bg-cric-bg px-3 text-[10px] font-black uppercase tracking-widest text-cric-muted ${
            disabled || uploading ? "opacity-60" : "hover:border-cric-accent"
          }`}
        >
          {uploading ? "Uploading…" : value ? "Change photo" : "Add photo"}
          <input
            ref={inputRef}
            id={id}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={upload}
            disabled={disabled || uploading}
          />
        </label>
      </div>
      <p className="mt-1 text-[10px] font-semibold text-cric-muted">
        JPG, PNG or WebP · resized and stored as WebP with a thumbnail
      </p>
      {error ? (
        <p role="alert" className="mt-1 text-xs font-bold text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
