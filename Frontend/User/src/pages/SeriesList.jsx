import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import SeriesCard from "../components/cricapi/SeriesCard";
import Loader from "../components/cricapi/Loader";
import ErrorState from "../components/cricapi/ErrorState";

const LOCAL_TYPES = ["single-match", "series", "tri-series", "tournament", "world-cup", "champions-trophy", "league"];

export default function SeriesList() {
  const [events, setEvents] = useState([]);
  const [providerSeries, setProviderSeries] = useState([]);
  const [providerLoading, setProviderLoading] = useState(true);
  const [localLoading, setLocalLoading] = useState(true);
  const [localError, setLocalError] = useState(null);
  const [providerError, setProviderError] = useState(null);
  const [apiStatus, setApiStatus] = useState(null);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");

  const loadData = useCallback(async () => {
    setProviderLoading(true);
    setLocalLoading(true);
    setLocalError(null);
    setProviderError(null);

    const loadProvider = async () => {
      try {
        const [rapidRes, statusRes] = await Promise.all([
          api.get("/international/series", { timeout: 8000 }),
          api.get("/international/status", { timeout: 5000 }).catch(() => ({ data: { data: null } })),
        ]);
        setProviderSeries(Array.isArray(rapidRes.data?.data) ? rapidRes.data.data : []);
        setApiStatus(statusRes.data.data || null);
      } catch (error) {
        setProviderError(error.response?.data?.message || error.message || "Live cricket provider is unavailable.");
        setProviderSeries([]);
      } finally {
        setProviderLoading(false);
      }
    };

    const loadLocal = async () => {
      try {
        const res = await api.get("/events", { params: { limit: 100 }, timeout: 8000 });
        const eventsData = Array.isArray(res.data) ? res.data : (res.data?.events || []);
        if (eventsData.length) {
          setEvents(eventsData);
        } else {
          const tournamentRes = await api.get("/tournaments", { params: { limit: 100 }, timeout: 8000 });
          setEvents(Array.isArray(tournamentRes.data) ? tournamentRes.data : (tournamentRes.data?.tournaments || []));
        }
      } catch (error) {
        try {
          const tournamentRes = await api.get("/tournaments", { params: { limit: 100 }, timeout: 8000 });
          setEvents(Array.isArray(tournamentRes.data) ? tournamentRes.data : (tournamentRes.data?.tournaments || []));
        } catch {
          setEvents([]);
          setLocalError(error.response?.data?.message || error.message || "Failed to load local events.");
        }
      } finally {
        setLocalLoading(false);
      }
    };

    await Promise.allSettled([loadProvider(), loadLocal()]);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const searchedCricSeries = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return providerSeries;
    return providerSeries.filter((series) => series.name.toLowerCase().includes(term));
  }, [providerSeries, search]);

  const localEvents = filter ? events.filter((event) => event.eventType === filter) : events;

  return (
    <div className="min-h-screen bg-cric-bg">
      <div className="bg-gradient-to-r from-cric-accent via-[#0a2d5e] to-cric-accent py-8 text-white">
        <div className="mx-auto max-w-7xl px-4">
          <h1 className="mb-2 text-3xl font-black uppercase tracking-tight">Series & Tournaments</h1>
          <p className="text-sm text-blue-200">Live cricket series, tournaments, fixtures, and your local CricAll events.</p>
        </div>
      </div>

      <main className="mx-auto max-w-7xl space-y-10 px-4 py-6">
        <section className="rounded-2xl bg-cric-card p-4 shadow-sm ring-1 ring-cric-border">
          <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-cric-muted">Search Live Series & Tournaments</label>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search Pakistan, Australia, PAK AUS..."
            className="w-full rounded-xl border border-cric-border bg-cric-bg px-4 py-3 text-sm font-bold text-cric-text outline-none focus:border-blue-500"
          />
        </section>

        <section>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-black uppercase tracking-tight text-cric-accent">Current Live Series & Tournaments</h2>
              <p className="text-xs font-semibold text-cric-muted">Uses CricAll backend live cricket provider data.</p>
            </div>
            <button onClick={loadData} className="rounded-xl bg-cric-accent px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white">
              Refresh
            </button>
          </div>

          {providerLoading && !providerSeries.length ? (
            <Loader label="Loading live series..." />
          ) : (providerError || apiStatus?.lastError) && !providerSeries.length ? (
            <ErrorState
              title="Live cricket data unavailable"
              message={apiStatus?.lastError || providerError}
              onRetry={loadData}
            />
          ) : searchedCricSeries.length ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {searchedCricSeries.map((series) => <SeriesCard key={series.id} series={series} />)}
            </div>
          ) : (
            <div className="rounded-2xl bg-cric-card p-8 text-center text-sm font-bold text-cric-muted ring-1 ring-cric-border">
              No live series or tournaments found for this search.
            </div>
          )}
        </section>

        <section>
          <div className="mb-4">
            <h2 className="text-xl font-black uppercase tracking-tight text-cric-accent">CricAll Local Events</h2>
            <p className="text-xs font-semibold text-cric-muted">Your own app events, tournaments, leagues and created matches.</p>
          </div>

          <div className="mb-6 flex gap-2 overflow-x-auto pb-3">
            <button onClick={() => setFilter("")} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold ${!filter ? "bg-cric-accent text-white" : "border border-cric-border bg-cric-card text-cric-muted hover:bg-cric-bg"}`}>
              All ({events.length})
            </button>
            {LOCAL_TYPES.map((type) => (
              <button key={type} onClick={() => setFilter(type)} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold capitalize ${filter === type ? "bg-cric-accent text-white" : "border border-cric-border bg-cric-card text-cric-muted hover:bg-cric-bg"}`}>
                {type.replace("-", " ")} ({events.filter((event) => event.eventType === type).length})
              </button>
            ))}
          </div>

          {localLoading ? (
            <Loader label="Loading local events..." />
          ) : localError ? (
            <ErrorState title="Local events unavailable" message={localError} onRetry={loadData} />
          ) : localEvents.length ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {localEvents.map((event) => (
                <Link key={event._id} to={`/series/${event.slug || event._id}`} className="group overflow-hidden rounded-2xl border border-cric-border bg-cric-card shadow-lg transition-all hover:shadow-xl">
                  <div className="relative flex aspect-[4/3] items-center justify-center bg-gradient-to-br from-cric-accent to-blue-700 p-6">
                    {event.logo ? <img src={event.logo} alt={event.name} className="h-full w-full object-contain" /> : <span className="text-6xl font-black text-white/80">{event.name?.charAt(0)}</span>}
                    <span className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${event.status === "live" ? "bg-red-600 text-white animate-pulse" : event.status === "completed" ? "bg-green-600 text-white" : "bg-blue-500/30 text-blue-200"}`}>
                      {event.status || "upcoming"}
                    </span>
                  </div>
                  <div className="p-4">
                  <p className="text-[10px] font-bold uppercase text-cric-muted">{event.eventType?.replace("-", " ") || "event"}</p>
                  <h3 className="truncate text-base font-black uppercase tracking-tight text-cric-accent transition-colors group-hover:text-cric-accent">{event.name}</h3>
                  <div className="mt-2 flex items-center gap-3 text-[10px] font-bold text-cric-muted">
                      <span>{event.teams?.length || 0} Teams</span>
                      <span>-</span>
                      <span>{event.matches?.length || 0} Matches</span>
                      {event.startDate && <><span>-</span><span>{new Date(event.startDate).toLocaleDateString()}</span></>}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-cric-border bg-cric-card p-16 text-center shadow-xl">
              <span className="mb-4 block text-5xl">🏏</span>
              <h4 className="text-xl font-black uppercase text-cric-accent">No Events Found</h4>
              <p className="mt-2 text-sm text-cric-muted">Check back later for upcoming series and tournaments.</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
