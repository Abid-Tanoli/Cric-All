import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Header from "../components/Header";
import { getStoredUser, logout as doLogout } from "../pages/auth/auth";
import { api } from "../services/api";

const TABS = [
  { key: "team-overall", label: "🏆 Team Overall" },
  { key: "batting", label: "🏏 Top Batsmen" },
  { key: "bowling", label: "⚾ Top Bowlers" },
  { key: "all-rounder", label: "💪 All-Rounders" },
];

export default function Rankings() {
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("team-overall");
  const [authUser, setAuthUser] = useState(null);

  useEffect(() => {
    setAuthUser(getStoredUser());
    fetchData();
  }, [activeTab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      let res;
      if (activeTab === "team-overall") {
        res = await api.get("/rankings-v2/overall");
      } else if (activeTab === "batting") {
        res = await api.get("/players/rankings/batting");
      } else if (activeTab === "bowling") {
        res = await api.get("/players/rankings/bowling");
      } else if (activeTab === "all-rounder") {
        res = await api.get("/players/rankings/all-rounder");
      }
      setData(Array.isArray(res?.data) ? res.data : []);
    } catch (e) {
      console.error(e);
      setData([]);
    }
    setLoading(false);
  };

  const handleLogout = () => { doLogout(); setAuthUser(null); };

  const isTeamView = activeTab === "team-overall";
  const items = Array.isArray(data) ? data : [];

  const getMedal = (rank) => {
    if (rank === 1) return "🥇";
    if (rank === 2) return "🥈";
    if (rank === 3) return "🥉";
    return `#${rank}`;
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans">
      <Header user={authUser} onShowLogin={() => {}} onShowRegister={() => {}} onLogout={handleLogout} />

      <div className="bg-[#031d44] text-white py-16 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-600/10 rounded-full -mr-48 -mt-48 blur-3xl" />
        <div className="max-w-7xl mx-auto px-4 relative">
          <h1 className="text-5xl font-black uppercase tracking-tighter italic mb-4">Elite Leaderboard</h1>
          <p className="text-blue-200/60 font-black uppercase tracking-widest text-sm">
            {isTeamView ? "Team Rankings based on Match Performance" : "Player Rankings based on Career Performance"}
          </p>
          <div className="flex flex-wrap gap-3 mt-8">
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-6 py-3 rounded-xl font-black uppercase tracking-widest text-xs transition-all ${
                  activeTab === tab.key
                    ? "bg-white text-[#031d44]"
                    : "bg-white/10 text-white/80 hover:bg-white/20"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-12">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-slate-400 font-black uppercase tracking-widest text-xs">Loading Rankings...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-24">
            <p className="text-4xl mb-4">📊</p>
            <p className="text-xl font-black text-slate-400">No rankings data yet</p>
            <p className="text-slate-400 text-sm mt-2">Complete matches to generate rankings.</p>
          </div>
        ) : (
          <div className="bg-white rounded-[2.5rem] shadow-xl border border-slate-100 overflow-hidden">
            {/* Header */}
            <div className="bg-[#031d44] px-8 py-6">
              <div className={`grid ${isTeamView ? 'grid-cols-7' : 'grid-cols-5'} gap-4 text-white text-[10px] font-black uppercase tracking-widest`}>
                <span>Rank</span>
                <span className={isTeamView ? 'col-span-2' : 'col-span-2'}>{isTeamView ? 'Team' : 'Player'}</span>
                {isTeamView && <span className="text-center">P</span>}
                {isTeamView && <span className="text-center">W</span>}
                {isTeamView && <span className="text-center">Pts</span>}
                {!isTeamView && <span className="text-center">{activeTab === 'batting' ? 'Runs' : activeTab === 'bowling' ? 'Wkts' : 'Pts'}</span>}
                <span className="text-center">{isTeamView ? 'NRR' : 'Mat'}</span>
                <span className="text-center">Rating</span>
              </div>
            </div>

            {/* Rows */}
            <div className="divide-y divide-slate-100">
              {items.map((item, idx) => {
                const rank = item.overallRank || item.rank || item.categoryRank || idx + 1;
                const name = isTeamView ? (item.team?.name || '-') : item.name;
                const linkTo = isTeamView ? `/teams/${item.team?._id}` : `/players/${item._id}`;
                return (
                  <Link
                    key={item._id || idx}
                    to={linkTo}
                    className={`grid ${isTeamView ? 'grid-cols-7' : 'grid-cols-5'} gap-4 px-8 py-5 hover:bg-slate-50 transition-all items-center`}
                  >
                    <span className="text-xl font-black text-slate-300">{getMedal(rank)}</span>
                    <div className={`${isTeamView ? 'col-span-2' : 'col-span-2'} flex items-center gap-3`}>
                      {isTeamView && item.team?.logo && (
                        <img src={item.team.logo} alt="" className="w-8 h-8 rounded-lg object-cover" />
                      )}
                      <div>
                        <span className="font-bold text-slate-800">{name}</span>
                        {isTeamView && item.team?.branchName && (
                          <p className="text-[10px] text-slate-400">{item.team.branchName}</p>
                        )}
                      </div>
                    </div>
                    {isTeamView && (
                      <>
                        <span className="text-center font-bold text-slate-700">{item.matchesPlayed || 0}</span>
                        <span className="text-center font-bold text-green-600">{item.matchesWon || 0}</span>
                        <span className="text-center font-bold text-amber-600">{item.points || 0}</span>
                      </>
                    )}
                    {!isTeamView && (
                      <span className="text-center font-bold text-slate-700">
                        {activeTab === 'batting' ? item.runs || 0 :
                         activeTab === 'bowling' ? item.wickets || 0 :
                         item.rankingPoints?.toFixed(0) || 0}
                      </span>
                    )}
                    <span className="text-center text-slate-500">
                      {isTeamView ? item.netRunRate?.toFixed(2) || '0.00' : item.matches || item.stats?.matches || 0}
                    </span>
                    <span className="text-center font-bold text-purple-600">
                      {item.rating?.toFixed(2) || item.rankingPoints?.toFixed(1) || '-'}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
