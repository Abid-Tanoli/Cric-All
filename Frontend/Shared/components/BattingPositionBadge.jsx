import React from "react";
import { battingPositionLabel } from "../battingPositions.js";

/**
 * Small, non-interactive label for a player's batting position.
 *
 * Renders nothing when the value is unset (or unrecognised): an absent optional
 * field must not leave a placeholder such as "—" on a profile, squad row or XI
 * picker. The default styling is intentionally muted so the badge sits beside a
 * role label without competing with it; callers may override `className`.
 */
export default function BattingPositionBadge({ value, className = "" }) {
  const label = battingPositionLabel(value);
  if (!label) return null;

  return (
    <span
      data-testid="batting-position-badge"
      className={`inline-flex shrink-0 items-center rounded-full bg-cric-bg px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-cric-muted ring-1 ring-cric-border ${className}`}
    >
      {label}
    </span>
  );
}
