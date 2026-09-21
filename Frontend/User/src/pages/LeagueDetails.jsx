import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../services/api";

export default function LeagueDetails() {
  const { leagueId } = useParams();
  const [league, setLeague] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("teams");

  useEffect(() => {
    fetchLeague();
  }, [leagueId]);

  const fetchLeague = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/categories/leagues/${leagueId}`);
      setLeague(res.data);
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to load league");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-cric-bg dark:bg-slate-900 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-green-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-cric-bg dark:bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4">⚠️</div>
          <h2 className="text-2xl font-black text-cric-text dark:text-white mb-2">Failed to Load League</h2>
          <p className="text-cric-muted text-sm mb-4">{error}</p>
          <div className="flex gap-3 justify-center">
            <button onClick={fetchLeague} className="px-6 py-3 bg-green-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-green-700 transition-all">
              Try Again
            </button>
            <Link to="/teams/leagues" className="px-6 py-3 bg-cric-card border border-cric-border rounded-xl font-black text-xs uppercase tracking-widest hover:bg-cric-border transition-all">
              ← Back to Leagues
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!league) {
    return (
      <div className="min-h-screen bg-cric-bg dark:bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-black text-cric-text dark:text-white">League Not Found</h2>
          <Link to="/teams/leagues" className="mt-4 inline-block text-green-600 hover:underline">← Back to Leagues</Link>
        </div>
      </div>
    );
  }

  const tabs = [
    { key: "teams", label: "Teams", count: league.totalTeams },
    { key: "players", label: "Players", count: league.totalPlayers },
    { key: "matches", label: "Matches", count: league.totalMatches },
    { key: "media", label: "Blogs & Media", count: league.blogs?.length || 0 }
  ];

  return (
    <div className="min-h-screen bg-cric-bg dark:bg-slate-900 text-cric-text dark:text-white font-sans">

      {/* Hero */}
      <div className="bg-gradient-to-r from-green-600 to-green-800 text-white py-12">
        <div className="max-w-7xl mx-auto px-4">
          <Link to="/teams/leagues" className="text-green-200 hover:text-white text-sm font-bold mb-4 inline-block">← Back to Leagues</Link>
          <div className="flex items-center gap-6">
            <div className="w-24 h-24 bg-white/20 rounded-2xl flex items-center justify-center p-3">
              {league.logo ? (
                <img src={league.logo} alt={league.name} className="w-full h-full object-contain" />
              ) : (
                <div className="w-full h-full bg-white/30 rounded-xl flex items-center justify-center font-black text-2xl">
                  {league.shortName || league.name?.substring(0, 2).toUpperCase()}
                </div>
              )}
            </div>
            <div>
              <h1 className="text-4xl font-black uppercase tracking-tighter italic">{league.name}</h1>
              <p className="text-green-200/60 text-sm mt-1">{league.description || "Professional cricket league"}</p>
              <div className="flex gap-4 mt-3">
                <span className="text-xs font-bold bg-white/20 px-3 py-1 rounded-full">{league.format}</span>
                <span className="text-xs font-bold bg-white/20 px-3 py-1 rounded-full">{league.status}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-cric-card dark:bg-slate-800 border-b border-cric-border dark:border-slate-700 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex overflow-x-auto">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-6 py-4 text-sm font-semibold whitespace-nowrap ${
                  activeTab === tab.key
                    ? "border-b-2 border-green-600 text-green-600 dark:text-green-400"
                    : "text-cric-muted dark:text-slate-400 hover:text-cric-text"
                }`}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        {activeTab === "teams" && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {league.teams?.map(team => (
              <div key={team._id} className="bg-cric-card dark:bg-slate-800 rounded-xl border border-cric-border dark:border-slate-700 p-6">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-14 h-14 bg-cric-bg dark:bg-slate-700 rounded-lg flex items-center justify-center p-2">
                    {team.logo ? (
                      <img src={team.logo} alt={team.name} className="w-full h-full object-contain" />
                    ) : (
                      <div className="w-full h-full bg-green-600 rounded-lg flex items-center justify-center font-black text-white">
                        {team.shortName || team.name?.substring(0, 2).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div>
                    <h3 className="font-black text-cric-text dark:text-white">{team.name}</h3>
                    <p className="text-xs text-cric-muted">{team.players?.length || 0} players</p>
                  </div>
                </div>
                <div className="flex -space-x-2 overflow-hidden">
                  {team.players?.slice(0, 6).map((p, i) => (
                    <div key={i} className="w-8 h-8 rounded-full border-2 border-white dark:border-slate-800 bg-cric-bg flex items-center justify-center text-[10px] font-black text-cric-muted">
                      {p.name?.charAt(0)}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {(!league.teams || league.teams.length === 0) && (
              <div className="col-span-full text-center py-12 text-cric-muted">No teams in this league yet</div>
            )}
          </div>
        )}

        {activeTab === "players" && (
          <div className="bg-cric-card dark:bg-slate-800 rounded-xl border border-cric-border dark:border-slate-700 p-6">
            <h3 className="font-black text-lg mb-4">All Players ({league.totalPlayers})</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {league.teams?.flatMap(team => 
                team.players?.map(player => ({
                  ...player,
                  teamName: team.name
                })) || []
              ).slice(0, 24).map((player, idx) => (
                <div key={idx} className="text-center p-3 bg-cric-bg dark:bg-slate-700 rounded-lg">
                  <div className="w-12 h-12 bg-green-600 rounded-full flex items-center justify-center font-black text-white mx-auto mb-2">
                    {player.name?.charAt(0)}
                  </div>
                  <p className="text-xs font-bold truncate">{player.name}</p>
                  <p className="text-[9px] text-cric-muted">{player.role}</p>
                  <p className="text-[8px] text-cric-muted truncate">{player.teamName}</p>
                </div>
              ))}
            </div>
            {(!league.totalPlayers || league.totalPlayers === 0) && (
              <div className="text-center py-12 text-cric-muted">No players in this league yet</div>
            )}
          </div>
        )}

        {activeTab === "matches" && (
          <div className="bg-cric-card dark:bg-slate-800 rounded-xl border border-cric-border dark:border-slate-700 p-6">
            <h3 className="font-black text-lg mb-4">Matches ({league.totalMatches})</h3>
            {league.matches?.length > 0 ? (
              <div className="space-y-3">
                {league.matches.slice(0, 10).map((match, idx) => (
                  <div key={idx} className="flex justify-between items-center p-4 bg-cric-bg dark:bg-slate-700 rounded-lg">
                    <div>
                      <p className="font-bold text-sm">Match {idx + 1}</p>
                      <p className="text-xs text-cric-muted">{match.status}</p>
                    </div>
                    <Link to={`/match/${match._id}`} className="text-green-600 hover:underline text-xs font-bold">View →</Link>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-cric-muted">No matches scheduled yet</div>
            )}
          </div>
        )}

        {activeTab === "media" && (
          <div className="space-y-6">
            {league.blogs?.length > 0 ? (
              league.blogs.map((blog, idx) => (
                <div key={idx} className="bg-cric-card dark:bg-slate-800 rounded-xl border border-cric-border dark:border-slate-700 p-6">
                  <h4 className="font-black text-lg mb-2">{blog.title}</h4>
                  <p className="text-sm text-cric-muted dark:text-slate-300">{blog.description || blog.content?.substring(0, 150)}...</p>
                  <div className="flex gap-2 mt-3">
                    {blog.tags?.map((tag, tIdx) => (
                      <span key={tIdx} className="text-[9px] font-bold bg-green-50 dark:bg-green-900/30 text-green-600 px-2 py-1 rounded-full uppercase">{tag}</span>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="bg-cric-card dark:bg-slate-800 rounded-xl border border-cric-border dark:border-slate-700 p-12 text-center">
                <p className="text-cric-muted">No blogs or media content yet</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
