import React, { useState } from "react";

const PLACEHOLDER =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'>` +
    `<rect width='400' height='400' fill='#e2e8f0'/>` +
    `<circle cx='200' cy='170' r='64' fill='#94a3b8'/>` +
    `<path d='M40 400 q60 -110 160 -110 q100 0 160 110' fill='#94a3b8'/>` +
    `</svg>`
  );

const SafeImage = ({ src, alt = "", className = "", ...imgProps }) => {
  const [failed, setFailed] = useState(false);

  const showPlaceholder = !src || failed || src === "null" || src === "undefined";

  return showPlaceholder ? (
    <img src={PLACEHOLDER} alt={alt} className={className} {...imgProps} />
  ) : (
    <img
      src={src}
      alt={alt}
      className={className}
      {...imgProps}
      onError={() => setFailed(true)}
    />
  );
};

export default SafeImage;