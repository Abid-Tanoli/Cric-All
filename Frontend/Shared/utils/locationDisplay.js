/**
 * Display line for the denormalized location labels, e.g. "Lahore, Punjab".
 * Falls back to a legacy free-text value when the record has no references yet.
 * Repeated names (a district and its capital city often share one) are shown
 * once, matching the backend's `formatLocationLabel`.
 */
export function locationLine(labels, fallback = "") {
  const parts = [labels?.town || labels?.city, labels?.district, labels?.province, labels?.country]
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index);
  return parts.length ? parts.join(", ") : fallback;
}
