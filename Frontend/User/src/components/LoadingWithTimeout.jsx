import React, { useEffect, useState } from "react";

/**
 * Visible loading state with a safety message after 8 seconds, so a slow
 * public page never shows an endless spinner to a visitor or crawler.
 */
export default function LoadingWithTimeout({ label = "Loading...", className = "" }) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div role="status" className={`flex flex-col items-center justify-center py-20 ${className}`}>
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-cric-accent border-t-transparent" aria-hidden="true" />
      <p className="mt-4 text-xs font-black uppercase tracking-widest text-cric-muted">{label}</p>
      {slow && (
        <p className="mt-2 max-w-sm text-center text-xs font-semibold text-cric-muted">
          This is taking longer than expected. Please try again soon.
        </p>
      )}
    </div>
  );
}
