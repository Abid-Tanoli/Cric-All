import React, { useRef, useState } from "react";
import { API_BASE_URL } from "../config/env.js";
import SafeImage from "./SafeImage.jsx";

const PhotoInput = ({ value, onChange, label = "Photo", disabled }) => {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Only JPEG, PNG and WebP images are allowed");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Image must be under 5MB");
      return;
    }

    const form = new FormData();
    form.append("image", file);

    setUploading(true);
    try {
      const token = localStorage.getItem("token") || localStorage.getItem("bq_token");
      const res = await fetch(`${API_BASE_URL}/upload/image`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Upload failed");
      onChange(data.url);
    } catch (err) {
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div>
      {label && <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">{label}</label>}
      <div className="flex items-center gap-4">
        {value ? (
          <SafeImage
            src={value}
            alt={`${label} preview`}
            className="w-20 h-20 rounded-xl object-cover border border-slate-200"
          />
        ) : (
          <div className="w-20 h-20 rounded-xl bg-slate-100 border border-dashed border-slate-300 flex items-center justify-center text-2xl text-slate-400">📷</div>
        )}
        <div className="flex-1">
          <label className="inline-block px-4 py-2 bg-white border border-slate-200 rounded-xl font-bold text-xs uppercase tracking-widest text-slate-600 cursor-pointer hover:bg-blue-50">
            {uploading ? "Uploading..." : value ? "Change Photo" : "Upload Photo"}
            <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={disabled || uploading} />
          </label>
          {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
        </div>
      </div>
    </div>
  );
};

export default PhotoInput;