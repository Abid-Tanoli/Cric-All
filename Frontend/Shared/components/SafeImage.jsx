import React, { useState } from "react";
import { API_BASE_URL } from "../config/env.js";

const PLACEHOLDER =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'>` +
    `<rect width='400' height='400' fill='#e2e8f0'/>` +
    `<circle cx='200' cy='170' r='64' fill='#94a3b8'/>` +
    `<path d='M40 400 q60 -110 160 -110 q100 0 160 110' fill='#94a3b8'/>` +
    `</svg>`
  );

// Legacy uploads may have stored a bare relative path like "/uploads/x.jpg",
// which would 404 when the rendering frontend runs on a different origin than
// the backend. Rebase those onto the backend's public base URL.
const backendOrigin = (API_BASE_URL || "/api").replace(/\/api\/?$/, "");
const absolutizeUploadUrl = (src) =>
  typeof src === "string" && src.startsWith("/uploads/")
    ? `${backendOrigin}${src}`
    : src;

const SafeImage = ({ src, alt = "", className = "", ...imgProps }) => {
  const [failed, setFailed] = useState(false);

  const showPlaceholder = failed || !src || src === "null" || src === "undefined";
  const resolvedSrc = absolutizeUploadUrl(src);

  return showPlaceholder ? (
    <img src={PLACEHOLDER} alt={alt} className={className} {...imgProps} />
  ) : (
    <img
      src={resolvedSrc}
      alt={alt}
      className={className}
      {...imgProps}
      onError={() => setFailed(true)}
    />
  );
};

export default SafeImage;