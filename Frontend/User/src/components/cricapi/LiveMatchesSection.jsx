import React, { useCallback, useEffect, useState } from "react";
import LiveScoreCard from "./LiveScoreCard";
import Loader from "./Loader";
import ErrorState from "./ErrorState";
import { getCurrentMatches, isCricApiConfigured } from "../../services/cricApi";

export default function LiveMatchesSection() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadLiveMatches = useCallback(async () => {
    if (!isCricApiConfigured()) {
      setError("Live cricket API key missing. Set VITE_CRICAPI_KEY to enable external live scores.");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await getCurrentMatches(0);
      setMatches(data.filter((match) => match.matchStarted && !match.matchEnded));
    } catch (err) {
      setError(err.message || "Failed to load external live matches");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLiveMatches();
  }, [loadLiveMatches]);

  return (
    <section className="mb-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-tight text-[#031d44]">
            <span className="h-6 w-2 rounded-full bg-red-600" />
            BQ-PLAY Live Matches
          </h2>
          <p className="text-xs font-semibold text-slate-500">Live scores are cached briefly to protect API quota.</p>
        </div>
        <button onClick={loadLiveMatches} className="rounded-xl bg-[#031d44] px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white">
          Refresh
        </button>
      </div>

      {loading ? (
        <Loader label="Loading external live scores..." />
      ) : error ? (
        <ErrorState message={error} onRetry={loadLiveMatches} />
      ) : matches.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {matches.map((match) => <LiveScoreCard key={match.id} match={match} />)}
        </div>
      ) : (
        <div className="rounded-2xl bg-white p-8 text-center text-sm font-bold text-slate-500 ring-1 ring-slate-200">
          No external live matches right now.
        </div>
      )}
    </section>
  );
}
