import React from "react";

export default function ErrorState({ title = "Cricket API unavailable", message, onRetry }) {
  const friendlyMessage =
    message?.includes("provider is not configured") || message?.includes("key missing")
      ? "Live cricket data is not configured on the server yet. Set CRICKET_API_KEY (or RAPIDAPI_KEY) in the backend environment - it is fetched server-side, never from the browser."
      : message || "The free cricket API may be rate limited right now. Cached or local CricAll data will still be used where available.";

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
      <h3 className="text-base font-black uppercase tracking-tight text-amber-900">{title}</h3>
      <p className="mx-auto mt-2 max-w-2xl text-sm font-semibold text-amber-800">{friendlyMessage}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-xl bg-amber-600 px-5 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-amber-700"
        >
          Retry
        </button>
      )}
    </div>
  );
}
