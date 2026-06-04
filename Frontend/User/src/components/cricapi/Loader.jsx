import React from "react";

export default function Loader({ label = "Loading cricket data..." }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl bg-white p-10 text-center shadow-sm ring-1 ring-slate-200">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      <p className="mt-4 text-xs font-black uppercase tracking-widest text-slate-500">{label}</p>
    </div>
  );
}
