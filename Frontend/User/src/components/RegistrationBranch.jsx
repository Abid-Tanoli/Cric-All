import React from "react";
import { REGISTRATION_BRANCHES } from "../../../Shared/orgTypes.js";

/**
 * The single first-choice screen for every create/register entry point. Cards
 * are large and tap-friendly on a phone; the Urdu line is secondary but always
 * present, so a bilingual user can choose without switching language.
 */
export default function RegistrationBranch({ onSelect, selectedKey = "", compact = false }) {
  return (
    <section aria-label="Choose what you are registering" className={compact ? "" : "rounded-2xl border border-cric-border bg-cric-card p-4"}>
      <p className="text-[10px] font-black uppercase tracking-widest text-cric-muted">
        Choose what you are registering
      </p>
      <p className="mt-1 text-xs font-semibold text-cric-muted" lang="ur" dir="rtl">
        آپ کیا رجسٹر کر رہے ہیں؟
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {REGISTRATION_BRANCHES.map((branch) => {
          const selected = selectedKey === branch.key;
          return (
            <button
              key={branch.key}
              type="button"
              onClick={() => onSelect(branch)}
              aria-pressed={selected}
              aria-label={`${branch.label} / ${branch.labelUr}`}
              className={`flex min-h-[112px] flex-col items-start justify-between gap-2 rounded-2xl border p-4 text-left transition-all sm:min-h-[132px] ${
                selected
                  ? "border-cric-accent bg-cric-accent/10 text-cric-text shadow-sm"
                  : "border-cric-border bg-cric-bg text-cric-text hover:border-cric-accent/50 hover:shadow-sm"
              }`}
            >
              <span className="text-2xl" aria-hidden="true">{branch.icon}</span>
              <span className="min-w-0">
                <span className="block text-xs font-black uppercase leading-tight tracking-wide">{branch.label}</span>
                <span className="mt-1 block text-[11px] font-bold text-cric-muted" lang="ur" dir="rtl">
                  {branch.labelUr}
                </span>
                <span className="mt-1 hidden text-[10px] font-semibold leading-snug text-cric-muted sm:block">
                  {branch.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
