import React from "react";
import { ORG_TYPES, fieldsForOrgType } from "../../../../Shared/orgTypes.js";
import { Field, cardSubtle, input } from "./orgStyles";

const optionClass = (selected, disabled) =>
  [
    "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition",
    selected
      ? "border-cric-accent bg-cric-accent/5 ring-2 ring-cric-accent/20"
      : "border-cric-border bg-cric-bg hover:border-cric-accent/50",
    disabled ? "opacity-60" : "",
  ].join(" ");

/** Card-style type picker — one tap on mobile, no long dropdown. */
export function OrgTypePicker({ value, onChange, disabled = false }) {
  return (
    <Field label="Type" hint="Pick the option that best describes your organization.">
      <div role="radiogroup" aria-label="Organization type" className="grid gap-3 sm:grid-cols-2">
        {ORG_TYPES.map((type) => {
          const selected = value === type.value;
          return (
            <button
              key={type.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(type.value)}
              className={optionClass(selected, disabled)}
            >
              <span aria-hidden="true" className="text-xl leading-none">{type.icon}</span>
              <span className="min-w-0">
                <span className="block text-sm font-black text-cric-text">{type.label}</span>
                <span className="mt-1 block text-[11px] font-semibold leading-snug text-cric-muted">
                  {type.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </Field>
  );
}

/** Only the fields belonging to the selected type are rendered. */
export function OrgTypeDetails({ orgType, value = {}, onChange, disabled = false }) {
  const fields = fieldsForOrgType(orgType);
  if (fields.length === 0) return null;

  return (
    <div className={cardSubtle}>
      <p className="text-[10px] font-black uppercase tracking-widest text-cric-muted">
        {ORG_TYPES.find((type) => type.value === orgType)?.label} details
      </p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {fields.map((field) => (
          <Field key={field.key} label={field.label} hint={field.hint}>
            {field.type === "select" ? (
              <select
                value={value[field.key] || ""}
                onChange={(event) => onChange(field.key, event.target.value)}
                disabled={disabled}
                className={input}
              >
                <option value="">— Select —</option>
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option.charAt(0).toUpperCase() + option.slice(1)}
                  </option>
                ))}
              </select>
            ) : field.type === "textarea" ? (
              <textarea
                value={value[field.key] || ""}
                onChange={(event) => onChange(field.key, event.target.value)}
                disabled={disabled}
                rows={3}
                className={input}
                maxLength={500}
              />
            ) : (
              <input
                type={field.type === "number" ? "number" : "text"}
                min={field.min}
                value={value[field.key] || ""}
                onChange={(event) => onChange(field.key, event.target.value)}
                disabled={disabled}
                className={input}
              />
            )}
          </Field>
        ))}
      </div>
    </div>
  );
}

export default OrgTypePicker;
