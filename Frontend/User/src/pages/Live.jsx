import React, { useEffect, useState, useCallback } from "react";
import { api } from "../services/api";
import { Link } from "react-router-dom";
import LiveNavbar from "../components/LiveNavbar";
import { initSocket } from "../services/socket";
import LiveMatchesSection from "../components/cricapi/LiveMatchesSection";
import { teamShortName } from "../utils/teamDisplay";

export default function Live() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("all"); // all, results, live, upcoming

  const loadMatches = useCallback(async () => {
    try {
      const res = await api.get("/matches");
      // Handle different response formats
      const data = res.data?.matches || res.data || [];
      setMatches(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load matches", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    loadMatches();
    
    // Socket connection for real-time updates
    const socket = initSocket();
    socket.on("match:updated", () => {
      if (mounted) loadMatches();
    });
    socket.on("match:scoreUpdate", () => {
      if (mounted) loadMatches();
    });
    
    const id = setInterval(loadMatches, 15000); // refresh every 15s
    return () => {
      mounted = false;
      clearInterval(id);
      socket.off("match:updated");
      socket.off("match:scoreUpdate");
    };
  }, [loadMatches]);

  // Filter matches by date
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const todayMatches = matches.filter(m => {
    const matchDate = new Date(m.startAt);
    return matchDate >= today && matchDate < tomorrow;
  });

  const yesterdayMatches = matches.filter(m => {
    const matchDate = new Date(m.startAt);
    return matchDate >= yesterday && matchDate < today;
  });

  const tomorrowMatches = matches.filter(m => {
    const matchDate = new Date(m.startAt);
    return matchDate >= tomorrow && matchDate < new Date(tomorrow.getTime() + 86400000);
  });

  const formatTime = (date) => {
    const d = new Date(date);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const formatDate = (date) => {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-cric-bg">
        <LiveNavbar />
        <div className="flex items-center justify-center py-20">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-cric-accent border-t-transparent"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cric-bg">
      <LiveNavbar />

      {/* Tabs */}
      <div className="bg-cric-card border-b border-cric-border sticky top-[140px] z-40">
        <div className="max-w-7xl mx-auto px-4 flex gap-2 overflow-x-auto">
          {[
            { key: 'all', label: 'All Matches' },
            { key: 'results', label: 'Results' },
            { key: 'live', label: 'Live' },
            { key: 'upcoming', label: 'Upcoming' }
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-6 py-4 text-xs font-black uppercase tracking-widest transition-all relative whitespace-nowrap ${activeTab === tab.key ? 'text-cric-text' : 'text-cric-muted hover:text-cric-text'}`}
            >
              {tab.label}
              {activeTab === tab.key && <div className="absolute bottom-0 left-0 right-0 h-1 bg-cric-accent rounded-t" />}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        <LiveMatchesSection />

        {/* YESTERDAY - RESULTS */}
        {(activeTab === 'all' || activeTab === 'results') && yesterdayMatches.filter(m => m.status === 'completed').length > 0 && (
          <div className="mb-10">
            <h2 className="text-xl font-black text-cric-text uppercase tracking-tight mb-4 flex items-center gap-2">
              <span className="w-2 h-6 bg-green-600 rounded-full"></span>
              Results
            </h2>
            <div className="space-y-4">
              {yesterdayMatches.filter(m => m.status === 'completed').map(match => (
                <Link
                  key={match._id}
                  to={`/match/${match._id}`}
                  className="block bg-cric-card rounded-xl shadow-md overflow-hidden border border-cric-border hover:shadow-lg transition-all"
                >
                  <div className="p-5">
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-[10px] font-bold text-cric-muted uppercase tracking-wider">
                        {match.matchSubcategory || match.series} • {formatDate(match.startAt)}
                      </span>
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-[9px] font-bold uppercase">
                        Complete
                      </span>
                    </div>
                    <div className="space-y-3">
                      {match.innings?.map((inn, idx) => {
                        const team = match.teams?.[idx] || {};
                        return (
                          <div key={idx} className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              {team.logo && <img src={team.logo} alt={team.name} className="w-8 h-8 rounded-full object-cover" />}
                              <span className="font-bold text-base text-cric-text">{teamShortName(team)}</span>
                            </div>
                            <span className="font-black text-base text-cric-text">
                              {inn.runs || 0}/{inn.wickets || 0} <span className="text-xs text-cric-muted font-bold">({inn.overs || 0}.{(inn.balls || 0) % 6} ov)</span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {match.result?.description && (
                      <div className="mt-4 pt-4 border-t border-cric-border">
                        <p className="text-sm font-bold text-green-700">{match.result.description}</p>
                      </div>
                    )}
                    <div className="mt-3 flex gap-2 text-xs text-cric-muted">
                      <span>Report</span>
                      <span>•</span>
                      <span>Scorecard</span>
                      <span>•</span>
                      <span>Summary</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* TODAY - LIVE MATCHES */}
        {(activeTab === 'all' || activeTab === 'live') && todayMatches.filter(m => m.status === 'live' || m.status === 'in_progress').length > 0 && (
          <div className="mb-10">
            <h2 className="text-xl font-black text-cric-text uppercase tracking-tight mb-4 flex items-center gap-2">
              <span className="w-2 h-6 bg-red-600 rounded-full animate-pulse"></span>
              Live Now
            </h2>
            <div className="space-y-4">
              {todayMatches.filter(m => m.status === 'live' || m.status === 'in_progress').map(match => (
                <Link
                  key={match._id}
                  to={`/match/${match._id}`}
                  className="block bg-cric-card rounded-xl shadow-lg overflow-hidden border-2 border-red-500 hover:shadow-xl transition-all"
                >
                  <div className="p-5">
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-[10px] font-bold text-cric-muted uppercase tracking-wider">
                        {match.matchSubcategory || match.series}
                      </span>
                      <span className="px-3 py-1 bg-red-600 text-white rounded-full text-[9px] font-bold uppercase animate-pulse">
                        LIVE
                      </span>
                    </div>
                    <div className="space-y-3">
                      {match.innings?.map((inn, idx) => {
                        const team = match.teams?.[idx] || {};
                        const isBatting = match.innings?.[idx]?.batting?.filter(b => !b.isOut).length > 0;
                        return (
                          <div key={idx} className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              {team.logo && <img src={team.logo} alt={team.name} className="w-8 h-8 rounded-full object-cover" />}
                              <span className="font-bold text-base text-cric-text">{teamShortName(team)}</span>
                              {isBatting && <span className="text-green-600 text-sm">*</span>}
                            </div>
                            <span className="font-black text-base text-cric-text">
                              {inn.runs || 0}/{inn.wickets || 0} <span className="text-xs text-cric-muted font-bold">({inn.overs || 0}.{(inn.balls || 0) % 6} ov)</span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {match.tossWinner && (
                      <p className="mt-3 text-xs text-cric-muted font-bold">
                        Toss: {teamShortName(match.teams?.find(t => String(t._id) === String(match.tossWinner?._id || match.tossWinner)))} elected to {match.tossDecision}
                      </p>
                    )}
                    <div className="mt-3 flex gap-2 text-xs text-cric-accent font-bold">
                      <span>Live Commentary</span>
                      <span>•</span>
                      <span>Scorecard</span>
                      <span>•</span>
                      <span>Live Stats</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* TODAY - UPCOMING */}
        {(activeTab === 'all' || activeTab === 'upcoming') && todayMatches.filter(m => m.status === 'upcoming' || m.status === 'scheduled').length > 0 && (
          <div className="mb-10">
            <h2 className="text-xl font-black text-cric-text uppercase tracking-tight mb-4 flex items-center gap-2">
              <span className="w-2 h-6 bg-blue-600 rounded-full"></span>
              Today's Upcoming
            </h2>
            <div className="space-y-3">
              {todayMatches.filter(m => m.status === 'upcoming' || m.status === 'scheduled').map(match => (
                <Link
                  key={match._id}
                  to={`/match/${match._id}`}
                  className="block bg-cric-card rounded-xl shadow-md border border-cric-border hover:shadow-lg transition-all"
                >
                  <div className="p-5">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[10px] font-bold text-cric-muted uppercase tracking-wider">
                        {match.matchSubcategory || match.series}
                      </span>
                      <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-[9px] font-bold uppercase">
                        {formatTime(match.startAt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-center gap-8 py-4">
                      {match.teams?.map((team, idx) => (
                        <div key={idx} className="flex flex-col items-center flex-1">
                          {team.logo && <img src={team.logo} alt={team.name} className="w-14 h-14 rounded-full object-cover mb-2" />}
                          <span className="font-bold text-sm text-cric-text text-center">{teamShortName(team)}</span>
                        </div>
                      ))}
                      <span className="text-3xl font-black text-cric-muted">VS</span>
                    </div>
                    <p className="text-center text-xs text-cric-muted font-bold mt-2">
                      {match.venue || 'Venue TBA'}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* TOMORROW */}
        {(activeTab === 'all' || activeTab === 'upcoming') && tomorrowMatches.length > 0 && (
          <div className="mb-10">
            <h2 className="text-xl font-black text-cric-text uppercase tracking-tight mb-4 flex items-center gap-2">
              <span className="w-2 h-6 bg-cric-muted rounded-full"></span>
              Tomorrow
            </h2>
            <div className="space-y-3">
              {tomorrowMatches.map(match => (
                <div
                  key={match._id}
                  className="bg-cric-card rounded-xl shadow-md border border-cric-border p-5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      {match.teams?.map((team, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          {team.logo && <img src={team.logo} alt={team.name} className="w-10 h-10 rounded-full object-cover" />}
                          <span className="font-bold text-sm text-cric-text">{teamShortName(team)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-bold text-cric-muted">{formatTime(match.startAt)}</span>
                      <p className="text-[10px] text-cric-muted mt-1">{match.venue || 'Venue TBA'}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* NO MATCHES */}
        {matches.length === 0 && (
          <div className="text-center py-20 bg-cric-card rounded-2xl border border-cric-border">
            <p className="text-sm font-black text-cric-muted uppercase tracking-widest">No matches available</p>
            <p className="text-xs text-cric-muted mt-2">Check back later for upcoming matches</p>
          </div>
        )}
      </div>
    </div>
  );
}
