import React, { useCallback, useEffect, useState } from "react";
import LiveScoreCard from "./LiveScoreCard";
import Loader from "./Loader";
import ErrorState from "./ErrorState";
import { getCurrentMatches } from "../../services/cricApi";
import { useCricketProviderStatus, isProviderConfigured } from "../../hooks/useCricketProviderStatus";

export default function LiveMatchesSection() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Without a configured provider there is nothing to show, so the whole
  // section is hidden instead of advertising a broken feed.
  const providerStatus = useCricketProviderStatus();
  const providerConfigured = isProviderConfigured(providerStatus);

  const loadLiveMatches = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      if (!providerConfigured) {
        setMatches([]);
        setLoading(false);
        return;
      }

      const data = await getCurrentMatches();
      setMatches(data.filter((match) => match.matchStarted && !match.matchEnded));
    } catch (err) {
      setError(err.message || "Failed to load external live matches");
    } finally {
      setLoading(false);
    }
  }, [providerConfigured]);

  useEffect(() => {
    if (providerStatus !== null) loadLiveMatches();
  }, [loadLiveMatches, providerStatus]);

  if (providerStatus !== null && !providerConfigured) return null;

  return (
    <section className="mb-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-tight text-cric-accent">
            <span className="h-6 w-2 rounded-full bg-red-600" />
            CricAll Live Matches
          </h2>
          <p className="text-xs font-semibold text-cric-muted">Live scores are cached briefly to protect API quota.</p>
        </div>
        <button onClick={loadLiveMatches} className="rounded-xl bg-cric-accent px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white">
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
        <div className="rounded-2xl bg-cric-card p-8 text-center text-sm font-bold text-cric-muted ring-1 ring-cric-border">
          No external live matches right now.
        </div>
      )}
    </section>
  );
}
