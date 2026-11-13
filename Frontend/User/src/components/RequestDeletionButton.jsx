import React, { useState } from "react";

/**
 * Placeholder for the owner-requested deletion workflow.
 *
 * Hard deletes of a match, event, tournament or series are platform-admin only
 * (the API answers 403 ADMIN_ONLY_DELETE). Until the issue-reporting phase
 * wires a real request, this button explains that clearly instead of offering
 * a control that can only fail.
 */
export default function RequestDeletionButton({
  label = "Request deletion",
  className = "rounded-lg border border-red-300 bg-white px-5 py-2 text-[10px] font-black uppercase tracking-widest text-red-600 transition hover:bg-red-50",
}) {
  const [open, setOpen] = useState(false);

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={className}
        aria-expanded={open}
      >
        {label}
      </button>
      {open ? (
        <span
          role="status"
          className="max-w-xs rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[10px] font-bold leading-relaxed text-amber-900"
        >
          Deletion requests will open soon; contact the admin.
        </span>
      ) : null}
    </span>
  );
}
