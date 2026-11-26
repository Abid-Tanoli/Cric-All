import React, { useEffect, useState, useMemo, useCallback } from "react";
import { api } from "../services/api";
import { Link, useSearchParams } from "react-router-dom";
import LiveNavbar from "../components/LiveNavbar";
import LocationFilters, { locationQueryFromSearchParams } from "../components/LocationFilters";
import OrgTypeFilter, { orgTypeFromSearchParams } from "../components/OrgTypeFilter";
import { initSocket } from "../services/socket";
import LiveMatchesSection from "../components/cricapi/LiveMatchesSection";
import LoadingWithTimeout from "../components/LoadingWithTimeout";
import { getTeamById } from "../utils/matchHelpers";

// A match is live because of its status, never because of its date. Scoring can
// run past midnight, a match can be started on another day than it was scheduled
// for, and a break between innings is still a match in progress.
const LIVE_STATUSES = ["live", "in_progress", "innings-break", "innings_break", "super_over"];
const isLiveMatch = (match) => LIVE_STATUSES.includes(match.status);
const isInningsBreak = (match) => String(match.status || "").startsWith("innings");

const EMPTY_TEXT = {
  all: "No live matches, recent results or upcoming fixtures right now",
  results: "No results from yesterday",
  live: "No live matches right now",
  upcoming: "No matches scheduled for today or tomorrow",
};

export default function Live() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("all"); // all, results, live, upcoming
  const [searchParams] = useSearchParams();
  const locationQuery = locationQueryFromSearchParams(searchParams);
  const locationKey = JSON.stringify(locationQuery);
  const orgType = orgTypeFromSearchParams(searchParams);

  const loadMatches = useCallback(async () => {
    try {
      const res = await api.get("/matches", { params: { ...locationQuery, ...(orgType ? { orgType } : {}) }, timeout: 8000 });
      // Handle different response formats
      const data = res.data?.matches || res.data || [];
      setMatches(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      console.error("Failed to load matches", err.message);
      setError("Scores could not be loaded right now. Please try again soon.");
      setMatches([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationKey, orgType]);

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

  // Group matches by series/event
  const groupedMatches = useMemo(() => {
    const groups = {};
    matches.forEach(match => {
      const key = match.matchSubcategory || match.series || match.matchCategory || 'Other';
      if (!groups[key]) {
        groups[key] = { matches: [], type: match.eventType || 'match' };
      }
      groups[key].matches.push(match);
    });
    return groups;
  }, [matches]);

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
    return matchDate >= tomorrow && matchDate < new Date(tomorrow.getTime() + 86400000) && !isLiveMatch(m);
  });

  const liveMatches = matches.filter(isLiveMatch);
  const resultMatches = yesterdayMatches.filter(m => m.status === 'completed');
  const todayUpcomingMatches = todayMatches.filter(m => m.status === 'upcoming' || m.status === 'scheduled');

  const showResults = (activeTab === 'all' || activeTab === 'results') && resultMatches.length > 0;
  const showLive = (activeTab === 'all' || activeTab === 'live') && liveMatches.length > 0;
  const showTodayUpcoming = (activeTab === 'all' || activeTab === 'upcoming') && todayUpcomingMatches.length > 0;
  const showTomorrow = (activeTab === 'all' || activeTab === 'upcoming') && tomorrowMatches.length > 0;
  const nothingToShow = !showResults && !showLive && !showTodayUpcoming && !showTomorrow;

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
        <LoadingWithTimeout label="Loading live scores..." />
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
      <div className="max-w-7xl mx-auto px-4 pt-6">
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <OrgTypeFilter />
          <LocationFilters />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <LiveMatchesSection />
        {error && matches.length === 0 && (
          <p role="status" className="mb-8 rounded-xl bg-cric-card p-4 text-center text-sm font-bold text-cric-muted">
            {error}
          </p>
        )}

        {/* YESTERDAY - RESULTS */}
        {showResults && (
          <div className="mb-10">
            <h2 className="text-xl font-black text-cric-text uppercase tracking-tight mb-4 flex items-center gap-2">
              <span className="w-2 h-6 bg-green-600 rounded-full"></span>
              Results
            </h2>
            <div className="space-y-4">
              {resultMatches.map(match => (
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
                              <span className="font-bold text-base text-cric-text">{team.shortName || team.name}</span>
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

        {/* LIVE MATCHES */}
        {showLive && (
          <div className="mb-10">
            <h2 className="text-xl font-black text-cric-text uppercase tracking-tight mb-4 flex items-center gap-2">
              <span className="w-2 h-6 bg-red-600 rounded-full animate-pulse"></span>
              Live Now
            </h2>
            <div className="space-y-4">
              {liveMatches.map(match => (
                <Link
                  key={match._id}
                  to={`/match/${match._id}`}
                  className="block bg-cric-card rounded-xl shadow-lg overflow-hidden border-2 border-red-500 hover:shadow-xl transition-all"
                >
                  <div className="p-5">
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-[10px] font-bold text-cric-muted uppercase tracking-wider">
                        {[
                          match.matchSubcategory || match.series || match.tournament?.name || match.matchType,
                          match.startAt && formatDate(match.startAt),
                        ].filter(Boolean).join(' • ')}
                      </span>
                      <span className="px-3 py-1 bg-red-600 text-white rounded-full text-[9px] font-bold uppercase animate-pulse">
                        {isInningsBreak(match) ? 'Innings Break' : 'LIVE'}
                      </span>
                    </div>
                    <div className="space-y-3">
                      {match.innings?.map((inn, idx) => {
                        // The side batting first is not always teams[0].
                        const team = getTeamById(match, inn.team) || match.teams?.[idx] || {};
                        const isBatting = match.innings?.[idx]?.batting?.filter(b => !b.isOut).length > 0;
                        return (
                          <div key={idx} className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              {team.logo && <img src={team.logo} alt={team.name} className="w-8 h-8 rounded-full object-cover" />}
                              <span className="font-bold text-base text-cric-text">{team.shortName || team.name}</span>
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
                        Toss: {getTeamById(match, match.tossWinner)?.shortName || getTeamById(match, match.tossWinner)?.name || 'Team'} elected to {match.tossDecision}
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
        {showTodayUpcoming && (
          <div className="mb-10">
            <h2 className="text-xl font-black text-cric-text uppercase tracking-tight mb-4 flex items-center gap-2">
              <span className="w-2 h-6 bg-blue-600 rounded-full"></span>
              Today's Upcoming
            </h2>
            <div className="space-y-3">
              {todayUpcomingMatches.map(match => (
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
                          <span className="font-bold text-sm text-cric-text text-center">{team.shortName || team.name}</span>
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
        {showTomorrow && (
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
                          <span className="font-bold text-sm text-cric-text">{team.shortName || team.name}</span>
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

        {/* NO MATCHES (or none for this tab): never leave the page blank */}
        {nothingToShow && (
          <div className="text-center py-20 bg-cric-card rounded-2xl border border-cric-border">
            <p className="text-sm font-black text-cric-muted uppercase tracking-widest">
              {matches.length === 0 ? "No matches available" : EMPTY_TEXT[activeTab]}
            </p>
            {matches.length === 0 ? (
              <p className="text-xs text-cric-muted mt-2">Check back later for upcoming matches</p>
            ) : (
              <Link to="/" className="mt-3 inline-block text-xs font-bold text-cric-accent hover:underline">See all matches</Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
