import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../services/api";

export default function LeagueTeams() {
  const [leagues, setLeagues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchLeagues();
  }, []);

  const fetchLeagues = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/categories/leagues");
      setLeagues(res.data);
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to load leagues");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-cric-bg dark:bg-slate-900 text-cric-text dark:text-white font-sans">
      {/* Hero */}
      <div className="bg-gradient-to-r from-green-600 to-green-800 text-white py-12 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/10 rounded-full -mr-48 -mt-48 blur-3xl" />
        <div className="max-w-7xl mx-auto px-4 relative">
          <div className="flex items-center gap-4 mb-2">
            <Link to="/teams" className="text-green-200 hover:text-white text-sm font-bold">← Back to Categories</Link>
          </div>
          <h1 className="text-4xl font-black uppercase tracking-tighter italic">🏆 International Leagues</h1>
          <p className="text-green-200/60 font-black uppercase tracking-widest text-sm mt-2">Professional franchise leagues worldwide</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-12">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-12 h-12 border-4 border-green-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">⚠️</div>
            <p className="text-lg font-black text-red-500 mb-2">Failed to load leagues</p>
            <p className="text-cric-muted text-sm mb-4">{error}</p>
            <button onClick={fetchLeagues} className="px-6 py-3 bg-green-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-green-700 transition-all">
              Try Again
            </button>
          </div>
        ) : leagues.length === 0 ? (
          <div className="text-center py-20 text-cric-muted">
            <div className="text-5xl mb-4">🏆</div>
            <p className="font-black uppercase tracking-widest text-sm">No leagues registered yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {leagues.map((league) => (
              <div
                key={league._id}
                onClick={() => navigate(`/teams/leagues/${league._id}`)}
                className="group bg-cric-card dark:bg-slate-800 rounded-2xl shadow-sm hover:shadow-2xl border border-cric-border dark:border-slate-700 overflow-hidden transition-all duration-300 cursor-pointer transform hover:-translate-y-1"
              >
                <div className="p-6">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-16 h-16 bg-cric-bg dark:bg-slate-700 rounded-xl flex items-center justify-center p-2 group-hover:scale-110 transition-transform">
                      {league.logo ? (
                        <img src={league.logo} alt={league.name} className="w-full h-full object-contain" />
                      ) : (
                        <div className="w-full h-full bg-green-600 rounded-lg flex items-center justify-center font-black text-white text-lg">
                          {league.shortName || league.name?.substring(0, 2).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div>
                      <h3 className="text-lg font-black text-cric-text dark:text-white uppercase tracking-tighter">{league.name}</h3>
                      <span className="text-[9px] font-black text-green-600 bg-green-50 dark:bg-green-900/30 px-2 py-0.5 rounded-full uppercase">League</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm border-t pt-4">
                    <div>
                      <span className="text-cric-muted">Teams</span>
                      <p className="font-bold">{league.teams?.length || 0}</p>
                    </div>
                    <div>
                      <span className="text-cric-muted">Format</span>
                      <p className="font-bold">{league.format || "T20"}</p>
                    </div>
                  </div>

                  <div className="mt-4 py-3 bg-cric-bg dark:bg-slate-700 group-hover:bg-green-600 group-hover:text-white text-cric-text dark:text-white text-center rounded-xl font-black text-[10px] uppercase tracking-widest transition-all">
                    View League Details →
                  </div>
                </div>
              </div>
            ))}

          </div>
        )}
      </div>
    </div>
  );
}
