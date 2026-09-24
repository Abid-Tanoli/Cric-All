import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, Link } from "react-router-dom";
import Register from "../components/Register";
import { fetchMatches } from "../store/slices/matchesSlice";
import { getStoredUser } from "../pages/auth/auth";
import BlogGallery from "../components/BlogGallery";
import { api } from "../services/api";
import GlobalSearch from "../components/GlobalSearch";
import { initSocket } from "../services/socket";
import CreatePlayerProfile from "../components/CreatePlayerProfile";

const statusBadge = (match) => {
  const s = match.status;
  if (s === "live" || s === "in_progress")
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-600 text-white font-bold text-[10px] uppercase tracking-wider"><span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />Live</span>;
  if (s === "innings-break")
    return <span className="px-2 py-0.5 rounded bg-amber-600 text-white font-bold text-[10px] uppercase">Innings Break</span>;
  if (s === "completed")
    return <span className="px-2 py-0.5 rounded bg-green-700 text-white font-bold text-[10px] uppercase">RESULT</span>;
  if (s === "abandoned")
    return <span className="px-2 py-0.5 rounded bg-slate-500 text-white font-bold text-[10px] uppercase">ABANDONED</span>;
  return <span className="px-2 py-0.5 rounded bg-cric-blue text-white font-bold text-[10px] uppercase">{s === "upcoming" ? "Today" : s.replace(/_/g, " ")}</span>;
};

const formatOvers = (balls = 0) => `${Math.floor(balls / 6)}.${balls % 6}`;

export function Home() {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const matches = useSelector((state) => Array.isArray(state.matches.list) ? state.matches.list : []);
  const matchesStatus = useSelector((state) => state.matches.status);

  const [series, setSeries] = useState([]);
  const [seriesLoading, setSeriesLoading] = useState(true);
  const [authUser, setAuthUser] = useState(null);
  const [showRegister, setShowRegister] = useState(false);
  const [showCreatePlayer, setShowCreatePlayer] = useState(false);
  const [collapseCompleted, setCollapseCompleted] = useState(false);

  const matchesLoading = matchesStatus === "loading";

  const loadSeries = useCallback(async () => {
    try {
      setSeriesLoading(true);
      const res = await api.get("/events", { params: { limit: 20 }, timeout: 8000 });
      let data = Array.isArray(res.data) ? res.data : (res.data?.events || []);
      if (data.length === 0) {
        const res2 = await api.get("/tournaments", { params: { limit: 20 }, timeout: 8000 });
        data = Array.isArray(res2.data) ? res2.data : (res2.data?.tournaments || []);
      }
      setSeries(data);
    } catch {
      try {
        const res = await api.get("/tournaments", { params: { limit: 20 }, timeout: 8000 });
        setSeries(Array.isArray(res.data) ? res.data : (res.data?.tournaments || []));
      } catch {}
    } finally {
      setSeriesLoading(false);
    }
  }, []);

  useEffect(() => {
    const user = getStoredUser();
    setAuthUser(user);
    dispatch(fetchMatches({ limit: 250 }));
    loadSeries();
    const socket = initSocket();
    let refreshTimer;
    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => dispatch(fetchMatches({ limit: 250 })), 500);
    };
    socket.on("match:updated", scheduleRefresh);
    socket.on("match:scoreUpdate", scheduleRefresh);
    socket.on("match:ballUpdate", scheduleRefresh);
    return () => {
      window.clearTimeout(refreshTimer);
      socket.off("match:updated", scheduleRefresh);
      socket.off("match:scoreUpdate", scheduleRefresh);
      socket.off("match:ballUpdate", scheduleRefresh);
    };
  }, [dispatch, loadSeries]);

  const handleRegisterSuccess = (user) => { setAuthUser(user); setShowRegister(false); dispatch(fetchMatches({ limit: 250 })); };

  const liveMatches = matches.filter(m => m.status === "live" || m.status === "in_progress" || m.status === "innings-break");
  const upcomingMatches = matches.filter(m => m.status === "upcoming" || m.status === "scheduled" || m.status === "pending");
  const completedMatches = matches.filter(m => m.status === "completed").slice(0, 10);
  const abandonedMatches = matches.filter(m => m.status === "abandoned");
  const featuredMatches = matches.filter(m => m.isFeatured);
  const featuredSeries = series.filter(s => s.isFeatured);
  const topSeries = featuredSeries.length > 0 ? featuredSeries : series;

  const groupBySeries = useCallback((matchList) => {
    const groups = {};
    matchList.forEach(m => {
      const key = m.tournament?._id || m.tournament?.name || m.tournament || m.series || "Other";
      if (!groups[key]) groups[key] = { name: m.tournament?.name || m.series || "Other", key, matches: [] };
      groups[key].matches.push(m);
    });
    return Object.values(groups);
  }, []);

  const liveGroups = useMemo(() => groupBySeries(liveMatches), [liveMatches, groupBySeries]);
  const upcomingGroups = useMemo(() => groupBySeries(upcomingMatches), [upcomingMatches, groupBySeries]);
  const completedGroups = useMemo(() => groupBySeries(completedMatches), [completedMatches, groupBySeries]);

  const renderMatchCard = (m, isCompact) => (
    <div
      key={m._id}
      onClick={() => navigate(`/match/${m._id}`)}
      className={`cursor-pointer hover:bg-cric-accent/5 transition-all ${isCompact ? "px-3 py-2" : "px-4 py-3"} ${!isCompact ? "border-b border-cric-border/50 last:border-0" : ""}`}
    >
      {!isCompact && (
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-bold text-cric-muted uppercase tracking-wider">{m.tournament?.name || m.matchType}</span>
          {statusBadge(m)}
        </div>
      )}
      <div className="space-y-1">
        {(m.teams || []).map((team, idx) => {
          const inn = m.innings?.[idx];
          return (
            <div key={team?._id || idx} className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="w-5 h-5 rounded-full bg-cric-muted/20 flex-shrink-0 flex items-center justify-center text-[9px] font-bold text-cric-muted overflow-hidden">
                  {team?.logo ? <img src={team.logo} alt="" className="w-full h-full object-cover" /> : (team?.shortName || team?.name || "T")?.charAt(0)}
                </div>
                <span className="text-sm font-bold text-cric-text truncate">{team?.shortName || team?.name || "Team"}</span>
              </div>
              <span className="text-sm font-black tabular-nums text-cric-text ml-2">
                {inn ? `${inn.runs || 0}/${inn.wickets ?? "-"}` : "-"}
              </span>
            </div>
          );
        })}
      </div>
      {!isCompact && m.result?.description && (
        <p className="text-[11px] font-bold text-cric-accent mt-1.5 italic leading-tight">{m.result.description}</p>
      )}
      {!isCompact && (m.status === "upcoming" || m.status === "scheduled") && m.startAt && (
        <p className="text-[11px] font-semibold text-cric-muted mt-1">
          {new Date(m.startAt).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
        </p>
      )}
    </div>
  );

  const renderSeriesGroup = (group, compact) => (
    <div key={group.name} className="bg-cric-card rounded-xl shadow-sm border border-cric-border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-cric-bg/50 border-b border-cric-border">
        {group.key && group.key !== "Other" ? (
          <Link to={`/series/${group.key}`} className="text-xs font-black text-cric-text hover:text-cric-accent uppercase tracking-wider">{group.name}</Link>
        ) : (
          <span className="text-xs font-black text-cric-text uppercase tracking-wider">{group.name}</span>
        )}
        {group.key && group.key !== "Other" ? (
          <Link to={`/series/${group.key}`} className="text-[10px] font-bold text-cric-accent hover:text-orange-600">{group.matches.length > 1 ? `See all (${group.matches.length})` : "View"}</Link>
        ) : (
          <span className="text-[10px] font-bold text-cric-muted">{group.matches.length > 1 ? `See all (${group.matches.length})` : "View"}</span>
        )}
      </div>
      <div className={compact ? "" : "divide-y divide-cric-border/30"}>
        {group.matches.map(m => renderMatchCard(m, compact))}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-cric-bg text-cric-text font-sans">

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Series/Tournaments bar */}
        {seriesLoading || series.length > 0 ? (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-black text-cric-muted uppercase tracking-widest">Featured Series</h2>
              <Link to="/series" className="text-[10px] font-bold text-cric-accent hover:text-orange-600">All Series →</Link>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">
              {seriesLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="w-40 h-20 rounded-xl bg-cric-muted/20 animate-pulse flex-shrink-0" />
                ))
              ) : (
                series.slice(0, 8).map(ev => (
                  <Link key={ev._id} to={`/series/${ev.slug || ev._id}`} className="flex-shrink-0 group">
                    <div className={`w-40 rounded-xl border p-3 hover:shadow-md transition-all ${ev.isFeatured ? "bg-cric-card border-cric-accent/40" : "bg-cric-card border-cric-border hover:border-cric-accent/30"}`}>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-cric-bg flex items-center justify-center overflow-hidden flex-shrink-0">
                          {ev.logo ? <img src={ev.logo} alt="" className="w-full h-full object-cover" /> : <span className="text-lg font-black text-cric-muted">{ev.name?.charAt(0)}</span>}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-black text-cric-text uppercase truncate">{ev.shortName || ev.name}</p>
                          <p className="text-[8px] font-bold text-cric-muted uppercase">{ev.eventType?.replace(/-/g, " ") || ev.format}{ev.isFeatured ? " ★" : ""}</p>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        ) : null}

        {/* Search bar */}
        <div className="mb-6">
          <GlobalSearch />
        </div>

        {/* Main content: 2-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">

            {/* Left column: Live/Upcoming/Results */}
            <div className="space-y-6">

              {/* Featured Matches */}
              {featuredMatches.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-cric-accent text-sm">★</span>
                    <h2 className="text-sm font-black font-raj text-cric-text uppercase tracking-wider">Featured Matches</h2>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {featuredMatches.slice(0, 5).map(m => (
                      <div
                        key={m._id}
                        onClick={() => navigate(`/match/${m._id}`)}
                        className="cursor-pointer bg-cric-card rounded-xl border border-cric-accent/30 border-l-4 border-l-cric-accent p-4 hover:shadow-md transition-all"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-bold text-cric-muted uppercase tracking-wider truncate">{m.tournament?.name || m.matchType}</span>
                          {statusBadge(m)}
                        </div>
                        {(m.teams || []).slice(0, 2).map((team, idx) => {
                          const inn = m.innings?.[idx];
                          return (
                            <div key={team?._id || idx} className="flex items-center justify-between py-0.5">
                              <span className="text-sm font-bold text-cric-text truncate">{team?.shortName || team?.name || "Team"}</span>
                              <span className="text-sm font-black tabular-nums text-cric-text ml-2">{inn ? `${inn.runs || 0}/${inn.wickets ?? "-"}` : "-"}</span>
                            </div>
                          );
                        })}
                        {m.result?.description && <p className="text-[11px] font-bold text-cric-accent mt-1.5 italic leading-tight">{m.result.description}</p>}
                        {(m.status === "upcoming" || m.status === "scheduled") && m.startAt && (
                          <p className="text-[11px] font-semibold text-cric-muted mt-1">
                            {new Date(m.startAt).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Live Matches */}
              {liveGroups.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-2 h-2 bg-red-600 rounded-full animate-pulse" />
                    <h2 className="text-sm font-black font-raj text-cric-text uppercase tracking-wider">Live</h2>
                  </div>
                  <div className="space-y-4">
                    {liveGroups.map(g => renderSeriesGroup(g, false))}
                  </div>
                </section>
              )}

              {/* Today's / Upcoming Matches */}
              {upcomingGroups.length > 0 && (
                <section>
                  <h2 className="text-sm font-black font-raj text-cric-text uppercase tracking-wider mb-3">Upcoming</h2>
                  <div className="space-y-4">
                    {upcomingGroups.map(g => renderSeriesGroup(g, false))}
                  </div>
                </section>
              )}

              {/* Loading skeleton */}
              {matchesLoading && liveGroups.length === 0 && upcomingGroups.length === 0 && (
                <div className="space-y-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="bg-cric-card rounded-xl shadow-sm border border-cric-border p-4 animate-pulse">
                      <div className="h-3 bg-cric-muted/20 rounded w-1/3 mb-4" />
                      <div className="space-y-3">
                        <div className="flex justify-between"><div className="h-4 bg-cric-muted/20 rounded w-32" /><div className="h-4 bg-cric-muted/20 rounded w-16" /></div>
                        <div className="flex justify-between"><div className="h-4 bg-cric-muted/20 rounded w-32" /><div className="h-4 bg-cric-muted/20 rounded w-16" /></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* No matches state */}
              {!matchesLoading && liveGroups.length === 0 && upcomingGroups.length === 0 && completedGroups.length === 0 && (
                <div className="bg-cric-card rounded-xl shadow-sm border border-cric-border p-12 text-center">
                  <p className="text-4xl mb-4">🏏</p>
                  <p className="text-lg font-bold font-raj text-cric-muted">No matches available</p>
                  <p className="text-sm text-cric-muted mt-1">Check back later for upcoming matches and live scores</p>
                </div>
              )}

              {/* Completed Results */}
              {completedGroups.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-black font-raj text-cric-text uppercase tracking-wider">Recent Results</h2>
                    <button onClick={() => setCollapseCompleted(!collapseCompleted)} className="text-[10px] font-bold text-cric-accent hover:text-orange-600">
                      {collapseCompleted ? "Show" : "Hide"}
                    </button>
                  </div>
                  {!collapseCompleted && (
                    <div className="space-y-4">
                      {completedGroups.map(g => renderSeriesGroup(g, false))}
                    </div>
                  )}
                </section>
              )}

              {/* Top Stories */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-black font-raj text-cric-text uppercase tracking-wider">Top Stories</h2>
                  <Link to="/news" className="text-[10px] font-bold text-cric-accent hover:text-orange-600">More News →</Link>
                </div>
                <BlogGallery category="General" />
              </section>

            </div>

            {/* Right sidebar */}
            <div className="space-y-6">

            {/* Quick Links */}
            <div className="bg-cric-card rounded-xl border border-cric-border p-4">
              <h3 className="text-[10px] font-black text-cric-muted uppercase tracking-widest mb-3">Quick Links</h3>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Live Scores", accent: "bg-red-500", path: "/live" },
                  { label: "Rankings", accent: "bg-amber-500", path: "/rankings" },
                  { label: "Points Table", accent: "bg-blue-500", path: "/points-table" },
                  { label: "International", accent: "bg-indigo-500", path: "/international" },
                  { label: "Teams", accent: "bg-emerald-500", path: "/teams" },
                  { label: "Players", accent: "bg-orange-500", path: "/players" },
                  { label: "Series", accent: "bg-purple-500", path: "/series" },
                ].map(link => (
                  <Link key={link.path} to={link.path} className="flex items-center gap-2 p-2 rounded-lg hover:bg-cric-bg transition-all">
                    <span className={`h-7 w-7 rounded-lg ${link.accent} shadow-sm`} />
                    <span className="text-[11px] font-bold text-cric-text uppercase tracking-tight">{link.label}</span>
                  </Link>
                ))}
              </div>
            </div>

            <div className="bg-cric-card rounded-xl border border-cric-border p-4 text-cric-text">
              <h3 className="text-[10px] font-black text-cric-muted uppercase tracking-widest mb-3">Join CricAll</h3>
              <p className="text-sm font-bold leading-relaxed text-cric-text">
                Players can create profiles. Schools, colleges, universities, industries, clubs, leagues and organizations can join as handlers.
              </p>
              <p className="mt-2 text-xs font-semibold leading-relaxed text-cric-muted/80">
                You manage your own teams, squads, playing XI, matches and tournaments. CricAll provides the scoring and ranking platform.
              </p>
              {authUser ? (
                <button
                  onClick={() => setShowCreatePlayer(true)}
                  className="mt-4 w-full rounded-xl bg-cric-accent px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white hover:bg-orange-600"
                >
                  Create Player Profile
                </button>
              ) : (
                <button
                  onClick={() => { setShowRegister(true); }}
                  className="mt-4 w-full rounded-xl bg-cric-accent px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white hover:bg-orange-600"
                >
                  Join as Player or Handler
                </button>
              )}
            </div>

            {/* Trending */}
            <div className="bg-cric-card rounded-xl border border-cric-border p-4">
              <h3 className="text-[10px] font-black text-cric-muted uppercase tracking-widest mb-3">Trending</h3>
              <div className="space-y-2">
                {["#BCL2025", "#LiveScores", "#CricketUpdates", "#CricAll"].map(tag => (
                  <div key={tag} className="flex items-center gap-2 p-2 rounded-lg hover:bg-cric-bg cursor-pointer transition-all">
                    <svg className="w-3.5 h-3.5 text-cric-accent" fill="currentColor" viewBox="0 0 24 24"><path d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14"/></svg>
                    <span className="text-xs font-bold text-cric-text">{tag}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Series sidebar */}
            {series.length > 0 && (
              <div className="bg-cric-card rounded-xl border border-cric-border p-4">
                <h3 className="text-[10px] font-black text-cric-muted uppercase tracking-widest mb-3">Series & Tournaments</h3>
                <div className="space-y-2">
                  {series.slice(0, 5).map(ev => (
                    <Link key={ev._id} to={`/series/${ev.slug || ev._id}`} className="flex items-center gap-3 p-2 rounded-lg hover:bg-cric-bg transition-all">
                      <div className="w-8 h-8 rounded-lg bg-cric-bg flex items-center justify-center overflow-hidden flex-shrink-0">
                        {ev.logo ? <img src={ev.logo} alt="" className="w-full h-full object-cover" /> : <span className="text-sm font-black text-cric-muted">{ev.name?.charAt(0)}</span>}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-cric-text truncate">{ev.shortName || ev.name}</p>
                        <p className="text-[9px] font-bold text-cric-muted uppercase">{ev.eventType?.replace(/-/g, " ") || ev.format} • {ev.status}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Abandoned matches */}
            {abandonedMatches.length > 0 && (
              <div className="bg-cric-card rounded-xl border border-cric-border p-4">
                <h3 className="text-[10px] font-black text-cric-muted uppercase tracking-widest mb-3">Abandoned / Postponed</h3>
                <div className="space-y-2">
                  {abandonedMatches.slice(0, 3).map(m => (
                    <div key={m._id} className="text-xs font-semibold text-cric-muted truncate">
                      {m.teams?.map(t => t.shortName || t.name).join(" vs ")}
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>

        {showRegister && <Register onSuccess={handleRegisterSuccess} onCancel={() => setShowRegister(false)} />}
        {showCreatePlayer && <CreatePlayerProfile onSuccess={() => setShowCreatePlayer(false)} onCancel={() => setShowCreatePlayer(false)} />}
      </div>
    </div>
    );
  }

