import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Header from "../components/Header";
import MatchCard from "../components/cricapi/MatchCard";
import LiveScoreCard from "../components/cricapi/LiveScoreCard";
import Loader from "../components/cricapi/Loader";
import ErrorState from "../components/cricapi/ErrorState";
import { getSeriesInfo } from "../services/cricApi";

const formatDate = (value) => value ? new Date(value).toLocaleDateString() : "TBC";

export default function CricSeriesDetails() {
  const { seriesId } = useParams();
  const [series, setSeries] = useState(null);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadSeries = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getSeriesInfo(seriesId, 0);
      setSeries(data.info);
      setMatches(data.matches);
    } catch (err) {
      setError(err.message || "Failed to load series information");
    } finally {
      setLoading(false);
    }
  }, [seriesId]);

  useEffect(() => {
    loadSeries();
  }, [loadSeries]);

  const liveMatches = matches.filter((match) => match.matchStarted && !match.matchEnded);
  const completedMatches = matches.filter((match) => match.matchEnded || match.status === "completed");
  const upcomingMatches = matches.filter((match) => !match.matchStarted && !match.matchEnded);

  return (
    <div className="min-h-screen bg-[#f0f2f5]">
      <Header />

      <section className="bg-gradient-to-r from-[#031d44] via-[#0a2d5e] to-[#031d44] py-8 text-white">
        <div className="mx-auto max-w-7xl px-4">
          <Link to="/series" className="text-xs font-black uppercase tracking-widest text-blue-200 hover:text-white">Back to series</Link>
          <h1 className="mt-4 text-3xl font-black uppercase tracking-tight">{series?.name || "Series Details"}</h1>
          {series && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-blue-100">
              <span className="rounded-full bg-white/10 px-3 py-1">{formatDate(series.startDate)} - {formatDate(series.endDate)}</span>
              <span className="rounded-full bg-white/10 px-3 py-1">ODI {series.odi}</span>
              <span className="rounded-full bg-white/10 px-3 py-1">T20 {series.t20}</span>
              <span className="rounded-full bg-white/10 px-3 py-1">Test {series.test}</span>
            </div>
          )}
        </div>
      </section>

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8">
        {loading ? (
          <Loader label="Loading series matches..." />
        ) : error ? (
          <ErrorState message={error} onRetry={loadSeries} />
        ) : matches.length === 0 ? (
          <div className="rounded-2xl bg-white p-12 text-center shadow-sm ring-1 ring-slate-200">
            <h2 className="text-xl font-black uppercase text-[#031d44]">No matches found</h2>
            <p className="mt-2 text-sm font-semibold text-slate-500">The live data provider did not return fixtures for this series yet.</p>
          </div>
        ) : (
          <>
            {liveMatches.length > 0 && (
              <section>
                <h2 className="mb-4 flex items-center gap-2 text-xl font-black uppercase tracking-tight text-[#031d44]">
                  <span className="h-6 w-2 rounded-full bg-red-600" />
                  Live Matches
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {liveMatches.map((match) => <LiveScoreCard key={match.id} match={match} />)}
                </div>
              </section>
            )}

            <section>
              <h2 className="mb-4 text-xl font-black uppercase tracking-tight text-[#031d44]">All Series Matches</h2>
              <div className="grid gap-4 md:grid-cols-2">
                {matches.map((match) => <MatchCard key={match.id} match={match} />)}
              </div>
            </section>

            {completedMatches.length > 0 && (
              <section>
                <h2 className="mb-4 text-xl font-black uppercase tracking-tight text-[#031d44]">Results</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {completedMatches.map((match) => <MatchCard key={`result-${match.id}`} match={match} />)}
                </div>
              </section>
            )}

            {upcomingMatches.length > 0 && (
              <section>
                <h2 className="mb-4 text-xl font-black uppercase tracking-tight text-[#031d44]">Upcoming Fixtures</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {upcomingMatches.map((match) => <MatchCard key={`upcoming-${match.id}`} match={match} />)}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
