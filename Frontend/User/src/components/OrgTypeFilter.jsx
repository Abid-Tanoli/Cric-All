import React from "react";
import { useSearchParams } from "react-router-dom";
import { ORG_TYPES, ORG_TYPE_VALUES } from "../../../Shared/orgTypes.js";

const ALL = "all";

/** Read a validated orgType (single value or comma list) from the URL. */
export function orgTypeFromSearchParams(searchParams) {
  const raw = String(searchParams?.get?.("orgType") || "").trim();
  if (!raw || raw.toLowerCase() === ALL) return "";
  const values = raw.split(",").map((value) => value.trim()).filter((value) => ORG_TYPE_VALUES.includes(value));
  return [...new Set(values)].join(",");
}

/**
 * The shared organization-type control. It is URL-persisted so a filtered view
 * survives refresh and can be shared; the default is the unfiltered "All types".
 */
export default function OrgTypeFilter({
  label = "Organization type",
  ariaLabel = "Organization type",
  options = ORG_TYPES.map((type) => ({ value: type.value, label: type.label, icon: type.icon })),
  className = "",
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const value = orgTypeFromSearchParams(searchParams) || ALL;

  const change = (event) => {
    const params = new URLSearchParams(searchParams);
    if (event.target.value === ALL) params.delete("orgType");
    else params.set("orgType", event.target.value);
    setSearchParams(params, { replace: true });
  };

  return (
    <label className={`flex flex-col gap-1 text-[10px] font-black uppercase tracking-widest text-cric-muted ${className}`}>
      {label}
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={change}
        className="w-full rounded-xl border border-cric-border bg-cric-bg px-4 py-3 text-sm font-bold text-cric-text outline-none focus:border-cric-accent"
      >
        <option value={ALL}>All types</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.icon ? `${option.icon} ` : ""}{option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
