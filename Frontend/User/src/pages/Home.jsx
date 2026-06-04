import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, Link } from "react-router-dom";
import Header from "../components/Header";
import Login from "../components/Login";
import Register from "../components/Register";
import { fetchMatches } from "../store/slices/matchesSlice";
import { initAuthFromStorage, logout as doLogout, getStoredUser } from "../pages/auth/auth";
import BlogGallery from "../components/BlogGallery";
import { api } from "../services/api";
import GlobalSearch from "../components/GlobalSearch";
import { initSocket } from "../services/socket";

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
  return <span className="px-2 py-0.5 rounded bg-blue-600 text-white font-bold text-[10px] uppercase">{s === "upcoming" ? "Today" : s.replace(/_/g, " ")}</span>;
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
  const [showLogin, setShowLogin] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [collapseCompleted, setCollapseCompleted] = useState(false);

  const matchesLoading = matchesStatus === "loading";

  const loadSeries = useCallback(async () => {
    try {
      setSeriesLoading(true);
      const res = await api.get("/events");
      let data = Array.isArray(res.data) ? res.data : (res.data?.events || []);
      if (data.length === 0) {
        const res2 = await api.get("/tournaments");
        data = Array.isArray(res2.data) ? res2.data : (res2.data?.tournaments || []);
      }
      setSeries(data);
    } catch {
      try {
        const res = await api.get("/tournaments");
        setSeries(Array.isArray(res.data) ? res.data : (res.data?.tournaments || []));
      } catch {}
    } finally {
      setSeriesLoading(false);
    }
  }, []);

  useEffect(() => {
    const user = getStoredUser();
    setAuthUser(user);
    dispatch(fetchMatches());
    loadSeries();
    const socket = initSocket();
    socket.on("match:updated", () => dispatch(fetchMatches()));
    socket.on("match:scoreUpdate", () => dispatch(fetchMatches()));
    socket.on("match:ballUpdate", () => dispatch(fetchMatches()));
    return () => {
      socket.off("match:updated");
      socket.off("match:scoreUpdate");
      socket.off("match:ballUpdate");
    };
  }, [dispatch, loadSeries]);

  const handleLoginSuccess = (user) => { setAuthUser(user); setShowLogin(false); dispatch(fetchMatches()); };
  const handleRegisterSuccess = (user) => { setAuthUser(user); setShowRegister(false); dispatch(fetchMatches()); };
  const handleLogout = () => { doLogout(); setAuthUser(null); dispatch(fetchMatches()); };

  const liveMatches = matches.filter(m => m.status === "live" || m.status === "in_progress" || m.status === "innings-break");
  const upcomingMatches = matches.filter(m => m.status === "upcoming" || m.status === "scheduled" || m.status === "pending");
  const completedMatches = matches.filter(m => m.status === "completed").slice(0, 10);
  const abandonedMatches = matches.filter(m => m.status === "abandoned");

  const groupBySeries = useCallback((matchList) => {
    const groups = {};
    matchList.forEach(m => {
      const key = m.tournament?._id || m.tournament?.name || m.series || "Other";
      if (!groups[key]) groups[key] = { name: m.tournament?.name || m.series || "Other", matches: [] };
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
      className={`cursor-pointer hover:bg-blue-50/50 transition-all ${isCompact ? "px-3 py-2" : "px-4 py-3"} ${!isCompact ? "border-b border-slate-100 last:border-0" : ""}`}
    >
      {!isCompact && (
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{m.tournament?.name || m.matchType}</span>
          {statusBadge(m)}
        </div>
      )}
      <div className="space-y-1">
        {(m.teams || []).map((team, idx) => {
          const inn = m.innings?.[idx];
          return (
            <div key={team?._id || idx} className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="w-5 h-5 rounded-full bg-slate-200 flex-shrink-0 flex items-center justify-center text-[9px] font-bold text-slate-600 overflow-hidden">
                  {team?.logo ? <img src={team.logo} alt="" className="w-full h-full object-cover" /> : (team?.shortName || team?.name || "T")?.charAt(0)}
                </div>
                <span className="text-sm font-bold text-slate-800 truncate">{team?.shortName || team?.name || "Team"}</span>
              </div>
              <span className="text-sm font-black tabular-nums text-slate-800 ml-2">
                {inn ? `${inn.runs || 0}/${inn.wickets ?? "-"}` : "-"}
              </span>
            </div>
          );
        })}
      </div>
      {!isCompact && m.result?.description && (
        <p className="text-[11px] font-bold text-blue-700 mt-1.5 italic leading-tight">{m.result.description}</p>
      )}
      {!isCompact && (m.status === "upcoming" || m.status === "scheduled") && m.startAt && (
        <p className="text-[11px] font-semibold text-slate-500 mt-1">
          {new Date(m.startAt).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
        </p>
      )}
    </div>
  );

  const renderSeriesGroup = (group, compact) => (
    <div key={group.name} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200">
        <Link to={`/series/${group.matches[0]?.tournament?.slug || group.matches[0]?.tournament?._id}`} className="text-xs font-black text-slate-700 hover:text-blue-700 uppercase tracking-wider">
          {group.name}
        </Link>
        <Link to={`/series/${group.matches[0]?.tournament?.slug || group.matches[0]?.tournament?._id}`} className="text-[10px] font-bold text-blue-600 hover:text-blue-800">
          {group.matches.length > 1 ? `See all (${group.matches.length})` : "View"}
        </Link>
      </div>
      <div className={compact ? "" : "divide-y divide-slate-50"}>
        {group.matches.map(m => renderMatchCard(m, compact))}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f0f2f5] text-slate-900 font-sans">
      <Header
        user={authUser}
        onShowLogin={() => { setShowLogin(true); setShowRegister(false); }}
        onShowRegister={() => { setShowRegister(true); setShowLogin(false); }}
        onLogout={handleLogout}
      />

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Series/Tournaments bar */}
        {seriesLoading || series.length > 0 ? (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-black text-slate-500 uppercase tracking-widest">Featured Series</h2>
              <Link to="/series" className="text-[10px] font-bold text-blue-600 hover:text-blue-800">All Series →</Link>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">
              {seriesLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="w-40 h-20 rounded-xl bg-slate-200 animate-pulse flex-shrink-0" />
                ))
              ) : (
                series.slice(0, 8).map(ev => (
                  <Link key={ev._id} to={`/series/${ev.slug || ev._id}`} className="flex-shrink-0 group">
                    <div className="w-40 bg-white rounded-xl border border-slate-200 p-3 hover:shadow-md hover:border-blue-300 transition-all">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                          {ev.logo ? <img src={ev.logo} alt="" className="w-full h-full object-cover" /> : <span className="text-lg font-black text-slate-600">{ev.name?.charAt(0)}</span>}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-black text-slate-800 uppercase truncate">{ev.shortName || ev.name}</p>
                          <p className="text-[8px] font-bold text-slate-400 uppercase">{ev.eventType?.replace(/-/g, " ") || ev.format}</p>
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

            {/* Live Matches */}
            {liveGroups.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2 h-2 bg-red-600 rounded-full animate-pulse" />
                  <h2 className="text-sm font-black text-slate-800 uppercase tracking-wider">Live</h2>
                </div>
                <div className="space-y-4">
                  {liveGroups.map(g => renderSeriesGroup(g, false))}
                </div>
              </section>
            )}

            {/* Today's / Upcoming Matches */}
            {upcomingGroups.length > 0 && (
              <section>
                <h2 className="text-sm font-black text-slate-800 uppercase tracking-wider mb-3">Upcoming</h2>
                <div className="space-y-4">
                  {upcomingGroups.map(g => renderSeriesGroup(g, false))}
                </div>
              </section>
            )}

            {/* Loading skeleton */}
            {matchesLoading && liveGroups.length === 0 && upcomingGroups.length === 0 && (
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 animate-pulse">
                    <div className="h-3 bg-slate-200 rounded w-1/3 mb-4" />
                    <div className="space-y-3">
                      <div className="flex justify-between"><div className="h-4 bg-slate-200 rounded w-32" /><div className="h-4 bg-slate-200 rounded w-16" /></div>
                      <div className="flex justify-between"><div className="h-4 bg-slate-200 rounded w-32" /><div className="h-4 bg-slate-200 rounded w-16" /></div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* No matches state */}
            {!matchesLoading && liveGroups.length === 0 && upcomingGroups.length === 0 && completedGroups.length === 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
                <p className="text-4xl mb-4">🏏</p>
                <p className="text-lg font-bold text-slate-400">No matches available</p>
                <p className="text-sm text-slate-400 mt-1">Check back later for upcoming matches and live scores</p>
              </div>
            )}

            {/* Completed Results */}
            {completedGroups.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-black text-slate-800 uppercase tracking-wider">Recent Results</h2>
                  <button onClick={() => setCollapseCompleted(!collapseCompleted)} className="text-[10px] font-bold text-blue-600 hover:text-blue-800">
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
                <h2 className="text-sm font-black text-slate-800 uppercase tracking-wider">Top Stories</h2>
                <Link to="/news" className="text-[10px] font-bold text-blue-600 hover:text-blue-800">More News →</Link>
              </div>
              <BlogGallery category="General" />
            </section>

          </div>

          {/* Right sidebar */}
          <div className="space-y-6">

            {/* Quick Links */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Quick Links</h3>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Live Scores", icon: "⚡", path: "/live" },
                  { label: "Rankings", icon: "🏆", path: "/rankings" },
                  { label: "Points Table", icon: "📊", path: "/points-table" },
                  { label: "International", icon: "INTL", path: "/international" },
                  { label: "Teams", icon: "👥", path: "/teams" },
                  { label: "Players", icon: "🏏", path: "/players" },
                  { label: "Series", icon: "📅", path: "/series" },
                ].map(link => (
                  <Link key={link.path} to={link.path} className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-100 transition-all">
                    <span className="text-lg">{link.icon}</span>
                    <span className="text-[11px] font-bold text-slate-700 uppercase tracking-tight">{link.label}</span>
                  </Link>
                ))}
              </div>
            </div>

            {/* Trending */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Trending</h3>
              <div className="space-y-2">
                {["#BCL2025", "#LiveScores", "#CricketUpdates", "#BQPlay"].map(tag => (
                  <div key={tag} className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-100 cursor-pointer transition-all">
                    <svg className="w-3.5 h-3.5 text-blue-500" fill="currentColor" viewBox="0 0 24 24"><path d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14"/></svg>
                    <span className="text-xs font-bold text-slate-700">{tag}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Series sidebar */}
            {series.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Series & Tournaments</h3>
                <div className="space-y-2">
                  {series.slice(0, 5).map(ev => (
                    <Link key={ev._id} to={`/series/${ev.slug || ev._id}`} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-100 transition-all">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                        {ev.logo ? <img src={ev.logo} alt="" className="w-full h-full object-cover" /> : <span className="text-sm font-black text-slate-600">{ev.name?.charAt(0)}</span>}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-800 truncate">{ev.shortName || ev.name}</p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase">{ev.eventType?.replace(/-/g, " ") || ev.format} • {ev.status}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Abandoned matches */}
            {abandonedMatches.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Abandoned / Postponed</h3>
                <div className="space-y-2">
                  {abandonedMatches.slice(0, 3).map(m => (
                    <div key={m._id} className="text-xs font-semibold text-slate-500 truncate">
                      {m.teams?.map(t => t.shortName || t.name).join(" vs ")}
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>

      {showLogin && <Login onSuccess={handleLoginSuccess} onCancel={() => setShowLogin(false)} />}
      {showRegister && <Register onSuccess={handleRegisterSuccess} onCancel={() => setShowRegister(false)} />}
    </div>
  );
}
