import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import Header from "../components/Header";
import SeriesCard from "../components/cricapi/SeriesCard";
import Loader from "../components/cricapi/Loader";
import ErrorState from "../components/cricapi/ErrorState";

const LOCAL_TYPES = ["single-match", "series", "tri-series", "tournament", "world-cup", "champions-trophy", "league"];

export default function SeriesList() {
  const [events, setEvents] = useState([]);
  const [providerSeries, setProviderSeries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [localError, setLocalError] = useState(null);
  const [providerError, setProviderError] = useState(null);
  const [apiStatus, setApiStatus] = useState(null);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setLocalError(null);
    setProviderError(null);

    try {
      const [rapidRes, statusRes] = await Promise.all([
        api.get("/international/series"),
        api.get("/international/status").catch(() => ({ data: { data: null } })),
      ]);
      setProviderSeries(Array.isArray(rapidRes.data?.data) ? rapidRes.data.data : []);
      setApiStatus(statusRes.data.data || null);
    } catch (error) {
      setProviderError(error.response?.data?.message || error.message || "Failed to load external series.");
      setProviderSeries([]);
    }

    try {
      const res = await api.get("/events");
      const eventsData = Array.isArray(res.data) ? res.data : (res.data?.events || []);
      if (eventsData.length) {
        setEvents(eventsData);
      } else {
        const tournamentRes = await api.get("/tournaments");
        setEvents(Array.isArray(tournamentRes.data) ? tournamentRes.data : (tournamentRes.data?.tournaments || []));
      }
    } catch (error) {
      try {
        const tournamentRes = await api.get("/tournaments");
        setEvents(Array.isArray(tournamentRes.data) ? tournamentRes.data : (tournamentRes.data?.tournaments || []));
      } catch {
        setLocalError(error.message || "Failed to load local events");
      }
    } finally {
      setLoading(false);
    }
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
    <div className="min-h-screen bg-[#f0f2f5]">
      <Header />
      <div className="bg-gradient-to-r from-[#031d44] via-[#0a2d5e] to-[#031d44] py-8 text-white">
        <div className="mx-auto max-w-7xl px-4">
          <h1 className="mb-2 text-3xl font-black uppercase tracking-tight">Series & Tournaments</h1>
          <p className="text-sm text-blue-200">Live cricket series, tournaments, fixtures, and your local BQ-PLAY events.</p>
        </div>
      </div>

      <main className="mx-auto max-w-7xl space-y-10 px-4 py-6">
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-400">Search Live Series & Tournaments</label>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search Pakistan, Australia, PAK AUS..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:border-blue-500"
          />
        </section>

        <section>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-black uppercase tracking-tight text-[#031d44]">Current Live Series & Tournaments</h2>
              <p className="text-xs font-semibold text-slate-500">Uses BQ-PLAY backend live cricket provider data.</p>
            </div>
            <button onClick={loadData} className="rounded-xl bg-[#031d44] px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white">
              Refresh
            </button>
          </div>

          {loading && !providerSeries.length ? (
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
            <div className="rounded-2xl bg-white p-8 text-center text-sm font-bold text-slate-500 ring-1 ring-slate-200">
              No live series or tournaments found for this search.
            </div>
          )}
        </section>

        <section>
          <div className="mb-4">
            <h2 className="text-xl font-black uppercase tracking-tight text-[#031d44]">BQ-PLAY Local Events</h2>
            <p className="text-xs font-semibold text-slate-500">Your own app events, tournaments, leagues and created matches.</p>
          </div>

          <div className="mb-6 flex gap-2 overflow-x-auto pb-3">
            <button onClick={() => setFilter("")} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold ${!filter ? "bg-[#031d44] text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
              All ({events.length})
            </button>
            {LOCAL_TYPES.map((type) => (
              <button key={type} onClick={() => setFilter(type)} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold capitalize ${filter === type ? "bg-[#031d44] text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
                {type.replace("-", " ")} ({events.filter((event) => event.eventType === type).length})
              </button>
            ))}
          </div>

          {loading ? (
            <Loader label="Loading local events..." />
          ) : localError ? (
            <ErrorState title="Local events unavailable" message={localError} onRetry={loadData} />
          ) : localEvents.length ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {localEvents.map((event) => (
                <Link key={event._id} to={`/series/${event.slug || event._id}`} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg transition-all hover:shadow-xl">
                  <div className="relative flex aspect-[4/3] items-center justify-center bg-gradient-to-br from-[#031d44] to-blue-700 p-6">
                    {event.logo ? <img src={event.logo} alt={event.name} className="h-full w-full object-contain" /> : <span className="text-6xl font-black text-white/80">{event.name?.charAt(0)}</span>}
                    <span className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${event.status === "live" ? "bg-red-600 text-white animate-pulse" : event.status === "completed" ? "bg-green-600 text-white" : "bg-blue-500/30 text-blue-200"}`}>
                      {event.status || "upcoming"}
                    </span>
                  </div>
                  <div className="p-4">
                    <p className="text-[10px] font-bold uppercase text-slate-500">{event.eventType?.replace("-", " ") || "event"}</p>
                    <h3 className="truncate text-base font-black uppercase tracking-tight text-[#031d44] transition-colors group-hover:text-blue-600">{event.name}</h3>
                    <div className="mt-2 flex items-center gap-3 text-[10px] font-bold text-slate-500">
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
            <div className="rounded-2xl border border-slate-200 bg-white p-16 text-center shadow-xl">
              <span className="mb-4 block text-5xl">🏏</span>
              <h4 className="text-xl font-black uppercase text-[#031d44]">No Events Found</h4>
              <p className="mt-2 text-sm text-slate-500">Check back later for upcoming series and tournaments.</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
