import { useRef, useState } from "react";
import SafeImage from "../../../Shared/components/SafeImage.jsx";
import { API_BASE_URL } from "../../../Shared/config/env.js";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGES, MAX_IMAGE_BYTES, toAbsoluteMediaUrl } from "./communityConfig";

// Multi-image picker for the create/edit post form.
//
// The images are uploaded to the platform's EXISTING endpoint,
// POST /api/upload/image, with the user's own bearer token. That endpoint is
// admin-only on the backend today (`protect → requireAdmin → requireVerifiedEmail`),
// which we do NOT loosen here; if the server answers 401/403 we surface a clear
// message ("image uploads are currently limited to admins — try again later or
// ask an admin") and the user can still publish a text-only post. Validation of
// type/size happens client-side first so the common mistakes never hit the wire.
//
// On success the server's `/uploads/...` path is stored in `value` — the only
// format the community API accepts.

const ACCEPT = "image/jpeg,image/png,image/webp";

export default function ImagePicker({ value = [], onChange, max = MAX_IMAGES, disabled }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const uploadOne = async (file) => {
    const form = new FormData();
    form.append("image", file);
    const token = localStorage.getItem("bq_token") || localStorage.getItem("token");
    const res = await fetch(`${API_BASE_URL}/upload/image`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* non-JSON error body */
    }
    if (!res.ok) {
      if (res.status === 401) throw new Error("Please sign in again to attach photos.");
      if (res.status === 403)
        throw new Error(
          "Photo uploads are currently limited to admin accounts. You can still publish a text post, or attach a video link instead."
        );
      throw new Error(data.message || "Upload failed. Please try a smaller JPG, PNG or WebP image.");
    }
    return data.url;
  };

  const handleFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    if (inputRef.current) inputRef.current.value = "";
    if (files.length === 0) return;
    setError("");

    const remaining = max - value.length;
    if (remaining <= 0) {
      setError(`You can attach at most ${max} images.`);
      return;
    }

    const accepted = [];
    for (const file of files.slice(0, remaining)) {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        setError("Only JPG, PNG and WebP images are allowed.");
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setError("Each image must be under 5 MB.");
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length === 0) return;

    setUploading(true);
    const uploaded = [];
    try {
      for (const file of accepted) {
        // Sequential on purpose: keeps within any per-minute upload limit and
        // preserves the order the user picked.
        uploaded.push({ url: await uploadOne(file), alt: "" });
      }
      onChange([...value, ...uploaded]);
    } catch (err) {
      setError(err.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const removeAt = (index) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const canAdd = value.length < max;

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        {value.map((item, index) => (
          <div key={`${item?.url}-${index}`} className="relative">
            <SafeImage
              src={toAbsoluteMediaUrl(item?.url)}
              alt={item?.alt || "Attached image"}
              className="h-20 w-20 rounded-xl border border-cric-border object-cover"
            />
            <button
              type="button"
              onClick={() => removeAt(index)}
              disabled={disabled}
              aria-label="Remove image"
              className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs font-black text-white shadow disabled:opacity-60"
            >
              ×
            </button>
          </div>
        ))}

        {canAdd ? (
          <label
            className={`flex h-20 w-20 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-cric-border bg-cric-bg text-center text-[10px] font-black uppercase tracking-widest text-cric-muted ${
              disabled || uploading ? "opacity-60" : "hover:border-cric-accent"
            }`}
          >
            <span className="text-xl" aria-hidden="true">
              {uploading ? "…" : "＋"}
            </span>
            {uploading ? "Uploading" : "Add photo"}
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              multiple
              className="hidden"
              onChange={handleFiles}
              disabled={disabled || uploading}
            />
          </label>
        ) : null}
      </div>

      <p className="mt-2 text-[10px] font-semibold text-cric-muted">
        {value.length}/{max} images · JPG, PNG or WebP · up to 5 MB each
      </p>
      {error ? (
        <p role="alert" className="mt-1 text-xs font-bold text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
