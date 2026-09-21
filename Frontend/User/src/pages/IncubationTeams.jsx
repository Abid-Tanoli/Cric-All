import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";

export default function IncubationTeams() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/categories/incubation");
      setGroups(res.data);
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to load incubation teams");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-cric-bg dark:bg-slate-900 text-cric-text dark:text-white font-sans">
      {/* Hero */}
      <div className="bg-gradient-to-r from-purple-600 to-purple-800 text-white py-12 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/10 rounded-full -mr-48 -mt-48 blur-3xl" />
        <div className="max-w-7xl mx-auto px-4 relative">
          <div className="flex items-center gap-4 mb-2">
            <Link to="/teams" className="text-purple-200 hover:text-white text-sm font-bold">← Back to Categories</Link>
          </div>
          <h1 className="text-4xl font-black uppercase tracking-tighter italic">🚀 Incubation Teams</h1>
          <p className="text-purple-200/60 font-black uppercase tracking-widest text-sm mt-2">Internal training and development teams</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-12">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-12 h-12 border-4 border-purple-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">⚠️</div>
            <p className="text-lg font-black text-red-500 mb-2">Failed to load incubation teams</p>
            <p className="text-cric-muted text-sm mb-4">{error}</p>
            <button onClick={fetchGroups} className="px-6 py-3 bg-purple-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-purple-700 transition-all">
              Try Again
            </button>
          </div>
        ) : groups.length === 0 ? (
          <div className="text-center py-20 bg-cric-card dark:bg-slate-800 rounded-2xl border border-cric-border dark:border-slate-700">
            <div className="text-6xl mb-4">🚀</div>
            <h3 className="text-xl font-black text-cric-text dark:text-white uppercase tracking-tighter">No Incubation Groups</h3>
            <p className="text-cric-muted text-sm mt-2">Internal training teams will appear here once added</p>
          </div>
        ) : (
          <div className="space-y-8">
            {groups.map((group) => (
              <div key={group._id} className="bg-cric-card dark:bg-slate-800 rounded-2xl shadow-lg border border-purple-100 dark:border-purple-900 overflow-hidden">
                {/* Group Header */}
                <div className="bg-gradient-to-r from-purple-50 to-purple-100 dark:from-purple-900/30 dark:to-purple-800/30 p-6 border-b border-purple-200 dark:border-purple-700">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 bg-purple-600 rounded-xl flex items-center justify-center text-white text-2xl">
                      {group.logo ? (
                        <img src={group.logo} alt={group.name} className="w-full h-full object-contain" />
                      ) : (
                        "🚀"
                      )}
                    </div>
                    <div>
                      <h2 className="text-2xl font-black text-purple-800 dark:text-purple-200 uppercase tracking-tighter">{group.name}</h2>
                      {group.parentOrganization && (
                        <p className="text-sm text-purple-600 dark:text-purple-400">{group.parentOrganization}</p>
                      )}
                      <div className="flex gap-2 mt-2">
                        <span className="text-[9px] font-black text-purple-600 bg-purple-200 dark:bg-purple-900/50 dark:text-purple-300 px-3 py-0.5 rounded-full uppercase">Incubation Team</span>
                        <span className="text-[9px] font-black text-blue-600 bg-blue-200 dark:bg-blue-900/50 dark:text-blue-300 px-3 py-0.5 rounded-full uppercase">Internal / Training</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Teams Grid */}
                <div className="p-6">
                  <h3 className="font-bold text-sm text-cric-muted dark:text-slate-400 mb-4 uppercase tracking-widest">Teams ({group.teams?.length || 0})</h3>
                  
                  {group.teams?.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {group.teams.map((team) => (
                        <div key={team._id} className="group bg-purple-50 dark:bg-purple-900/20 rounded-xl border-2 border-purple-200 dark:border-purple-700 hover:border-purple-400 dark:hover:border-purple-500 transition-all p-4">
                          <div className="flex items-center gap-3 mb-3">
                            <div className="w-12 h-12 bg-cric-card dark:bg-slate-700 rounded-lg flex items-center justify-center p-2 group-hover:scale-110 transition-transform">
                              {team.logo ? (
                                <img src={team.logo} alt={team.name} className="w-full h-full object-contain" />
                              ) : (
                                <div className="w-full h-full bg-purple-600 rounded-lg flex items-center justify-center font-black text-white text-xs">
                                  {team.shortName || team.name?.substring(0, 2).toUpperCase()}
                                </div>
                              )}
                            </div>
                            <div>
                              <h4 className="font-black text-sm text-purple-800 dark:text-purple-200">{team.name}</h4>
                              <p className="text-[9px] text-purple-600 dark:text-purple-400">{team.players?.length || 0} players</p>
                            </div>
                          </div>

                          {/* Player Avatars */}
                          <div className="flex -space-x-1 mb-3 overflow-hidden">
                            {team.players?.slice(0, 5).map((p, i) => (
                              <div key={i} className="w-7 h-7 rounded-full border border-white dark:border-slate-700 bg-purple-200 dark:bg-purple-800 flex items-center justify-center text-[8px] font-black text-purple-600 dark:text-purple-300">
                                {p.name?.charAt(0)}
                              </div>
                            ))}
                          </div>

                          <Link to={`/players?team=${team._id}`} className="block py-2 bg-purple-200 dark:bg-purple-800 group-hover:bg-purple-600 group-hover:text-white text-purple-700 dark:text-purple-300 text-center rounded-lg font-black text-[9px] uppercase tracking-widest transition-all">
                            View Squad →
                          </Link>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-cric-muted">
                      <p className="font-black uppercase tracking-widest text-xs">No teams in this incubation group yet</p>
                    </div>
                  )}
                </div>

                {/* Group Description */}
                {group.description && (
                  <div className="px-6 pb-6">
                    <div className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-4 border border-purple-100 dark:border-purple-800">
                      <p className="text-sm text-purple-700 dark:text-purple-300">{group.description}</p>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
