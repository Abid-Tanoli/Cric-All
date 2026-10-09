// Navigation feature flags (Task 3).
//
// Several nav entries are backed by third-party integrations that are not being
// worked on right now (the RapidAPI/Cricbuzz international feed, the YouTube
// Data API highlights feed and the RSS cricket-news feed). They are removed from
// the visible nav by default but the routes stay in place, so bringing one back
// is a one-line environment change rather than a code change:
//
//   VITE_SHOW_INTERNATIONAL=true
//   VITE_SHOW_HIGHLIGHTS=true
//   VITE_SHOW_CRICKET_NEWS=true
//
// Anything absent or any value other than the literal string "true" reads as
// disabled, so the default (no env set) hides every external-only section while
// the platform-owned pages (Videos, News) stay visible.

function readFlag(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).trim().toLowerCase() === "true";
}

export function featureFlags() {
  return {
    international: readFlag(import.meta.env.VITE_SHOW_INTERNATIONAL),
    highlights: readFlag(import.meta.env.VITE_SHOW_HIGHLIGHTS),
    cricketNews: readFlag(import.meta.env.VITE_SHOW_CRICKET_NEWS),
  };
}

export function isFeatureEnabled(name) {
  return Boolean(featureFlags()[name]);
}

export default { featureFlags, isFeatureEnabled };
