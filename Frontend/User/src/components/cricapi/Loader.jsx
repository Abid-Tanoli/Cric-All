import React, { useEffect, useState } from "react";

export default function Loader({ label = "Loading cricket data..." }) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div role="status" className="flex flex-col items-center justify-center rounded-2xl bg-white p-10 text-center shadow-sm ring-1 ring-slate-200">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      <p className="mt-4 text-xs font-black uppercase tracking-widest text-slate-500">{label}</p>
      {slow && (
        <p className="mt-2 max-w-sm text-xs font-semibold text-slate-500">
          This is taking longer than expected. Please try again soon.
        </p>
      )}
    </div>
  );
}
