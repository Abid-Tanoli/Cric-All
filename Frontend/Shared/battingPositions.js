// Batting-position options shared by the User and Admin frontends.
//
// Mirror of Backend/src/constants/battingPositions.js. The values are the
// stored enum; the labels are what a person reads. Keeping both here (and
// importing this module from every form/badge) is what stops one screen from
// offering "Middle order" while another stores "middle_order".
//
// `""` is not an option in this list: forms add their own "Not set" entry so
// the wording can match the surrounding UI.

export const BATTING_POSITION_OPTIONS = Object.freeze([
  { value: "opener", label: "Opener" },
  { value: "middle_order", label: "Middle Order" },
  { value: "lower_order", label: "Lower Order" },
  { value: "tailender", label: "Tailender" },
]);

export const BATTING_POSITION_VALUES = Object.freeze(
  BATTING_POSITION_OPTIONS.map((option) => option.value),
);

export const BATTING_POSITION_LABELS = Object.freeze(
  Object.fromEntries(BATTING_POSITION_OPTIONS.map((option) => [option.value, option.label])),
);

/** Display label for a stored value; "" for unset or unknown. */
export function battingPositionLabel(value) {
  return BATTING_POSITION_LABELS[String(value ?? "").trim()] || "";
}

export default {
  BATTING_POSITION_OPTIONS,
  BATTING_POSITION_VALUES,
  BATTING_POSITION_LABELS,
  battingPositionLabel,
};
