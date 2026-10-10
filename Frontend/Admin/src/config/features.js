// Admin navigation feature flags.
//
// Two admin nav entries are backed by integrations that are not shipping right
// now (the RapidAPI/Cricbuzz International feed and the handler-request queue).
// They are HIDDEN by default, but their routes stay mounted, so turning one
// back on is an environment change, not a code change:
//
//   VITE_SHOW_ADMIN_INTERNATIONAL=true
//   VITE_SHOW_ADMIN_HANDLER_REQUESTS=true
//
// Anything absent - or any value other than the literal string "true" - reads as
// disabled, so the default (no env set) hides both entries.
function readFlag(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).trim().toLowerCase() === "true";
}

export function adminFeatureFlags() {
  return {
    international: readFlag(import.meta.env.VITE_SHOW_ADMIN_INTERNATIONAL),
    handlerRequests: readFlag(import.meta.env.VITE_SHOW_ADMIN_HANDLER_REQUESTS),
  };
}

export default { adminFeatureFlags };
