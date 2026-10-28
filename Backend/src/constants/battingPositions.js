// Canonical batting-position enum.
//
// The values are stored exactly as written here on Player.battingPosition.
// They are deliberately lowercase snake_case (not display labels): the field is
// an optional classification, and a stored "Middle Order" would differ from
// "middle_order" for every consumer that compares it. Labels live next to the
// values so the API, the bulk importers and both frontends cannot drift.
//
// `""` means "not set". It is a valid stored value (the schema default), not an
// unknown one, so old players remain valid without a migration.

export const BATTING_POSITIONS = Object.freeze([
  "opener",
  "middle_order",
  "lower_order",
  "tailender",
]);

export const BATTING_POSITION_LABELS = Object.freeze({
  opener: "Opener",
  middle_order: "Middle Order",
  lower_order: "Lower Order",
  tailender: "Tailender",
});

/** Display label for a stored value; "" for unset or unknown. */
export function battingPositionLabel(value) {
  return BATTING_POSITION_LABELS[String(value ?? "").trim()] || "";
}

/**
 * Fold operator/CSV input to a stored value.
 *
 * Returns:
 *   * a canonical value for a known position ("Opener", "middle order", ...),
 *   * "" for an explicit blank (clear / not set),
 *   * null for an unknown value, so callers can refuse it instead of guessing.
 */
export function normalizeBattingPosition(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const key = raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return BATTING_POSITIONS.includes(key) ? key : null;
}

export default {
  BATTING_POSITIONS,
  BATTING_POSITION_LABELS,
  battingPositionLabel,
  normalizeBattingPosition,
};
