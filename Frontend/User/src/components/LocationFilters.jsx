import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import LocationSelect from "../../../Shared/components/LocationSelect.jsx";

export const LOCATION_FILTER_LEVELS = ["country", "province", "district", "city", "town"];

/**
 * Reads the shareable location filters from the URL. Empty values are omitted,
 * so an unfiltered page sends exactly the same request it used to.
 */
export function locationQueryFromSearchParams(searchParams) {
  const query = {};
  for (const level of LOCATION_FILTER_LEVELS) {
    const value = searchParams.get(level);
    if (value) query[level] = value;
  }
  return query;
}

/** True when the URL carries at least one location filter. */
export function hasLocationFilter(searchParams) {
  return LOCATION_FILTER_LEVELS.some((level) => Boolean(searchParams.get(level)));
}

export default function LocationFilters({ label = "Location" }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(() => hasLocationFilter(searchParams));
  const [resetKey, setResetKey] = useState(0);

  const refs = {};
  for (const level of LOCATION_FILTER_LEVELS) refs[`${level}Id`] = searchParams.get(level);

  const apply = (nextRefs) => {
    const params = new URLSearchParams(searchParams);
    for (const level of LOCATION_FILTER_LEVELS) {
      const id = nextRefs[`${level}Id`];
      if (id) params.set(level, id);
      else params.delete(level);
    }
    setSearchParams(params, { replace: true });
  };

  const clear = () => {
    const params = new URLSearchParams(searchParams);
    for (const level of LOCATION_FILTER_LEVELS) params.delete(level);
    setSearchParams(params, { replace: true });
    // Remount so the control's internal search text is empty too. Filters never
    // force a default country: "all countries" is the unfiltered state.
    setResetKey((key) => key + 1);
  };

  const active = hasLocationFilter(searchParams);

  return (
    <div className="rounded-2xl border border-cric-border bg-cric-card p-3">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="text-[10px] font-black uppercase tracking-widest text-cric-text"
          aria-expanded={open}
        >
          {label} {active ? "• filtered" : ""} {open ? "▴" : "▾"}
        </button>
        {active && (
          <button
            type="button"
            onClick={clear}
            className="text-[10px] font-black uppercase tracking-widest text-cric-accent hover:underline"
          >
            Clear
          </button>
        )}
      </div>
      {open && (
        <div className="mt-3">
          <LocationSelect
            key={resetKey}
            compact
            showLabels={false}
            defaultCountry=""
            value={refs}
            onChange={(next) => apply(next)}
            levels={LOCATION_FILTER_LEVELS}
          />
        </div>
      )}
    </div>
  );
}
