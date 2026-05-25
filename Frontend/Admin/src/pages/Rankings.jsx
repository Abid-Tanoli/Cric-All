import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

const TABS = [
  { key: 'overall', label: 'Overall', endpoint: '/rankings-v2/overall' },
  { key: 'batting', label: 'Top Batsmen', endpoint: '/players/rankings/batting' },
  { key: 'bowling', label: 'Top Bowlers', endpoint: '/players/rankings/bowling' },
  { key: 'allrounder', label: 'All-Rounders', endpoint: '/players/rankings/all-rounder' },
];

export default function Rankings() {
  const [activeTab, setActiveTab] = useState('overall');
  const [rankings, setRankings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchRankings();
  }, [activeTab]);

  const fetchRankings = async () => {
    setLoading(true);
    setError(null);
    try {
      const tab = TABS.find(t => t.key === activeTab);
      const res = await api.get(tab.endpoint);
      setRankings(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      setError('Failed to fetch rankings');
      console.error(e);
    }
    setLoading(false);
  };

  const getRankBadge = (rank) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `#${rank}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-6 lg:p-10">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-4xl lg:text-5xl font-black text-[#031d44]">Rankings</h1>
          <p className="text-slate-500 font-bold text-sm mt-1">Team & Player Leaderboards</p>
        </div>
        <button
          onClick={fetchRankings}
          className="bg-[#031d44] hover:bg-slate-800 text-white font-black text-xs uppercase tracking-widest rounded-xl px-6 py-3"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-6 py-3 rounded-xl font-black text-xs uppercase tracking-wider transition-all ${
              activeTab === tab.key
                ? 'bg-[#031d44] text-white shadow-lg'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#031d44]" />
        </div>
      ) : error ? (
        <div className="text-center py-20">
          <p className="text-red-600 font-bold">{error}</p>
        </div>
      ) : rankings.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-slate-400 font-bold text-lg">No rankings data available</p>
          <p className="text-slate-400 text-sm mt-2">Complete matches to generate rankings.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
          {/* Header Row */}
          <div className="bg-[#031d44] px-6 py-4">
            <div className="grid grid-cols-12 gap-4 text-white text-[10px] font-black uppercase tracking-widest">
              <span className="col-span-1">Rank</span>
              <span className="col-span-4">Name</span>
              {activeTab === 'overall' && (
                <>
                  <span className="col-span-1 text-center">P</span>
                  <span className="col-span-1 text-center">W</span>
                  <span className="col-span-1 text-center">L</span>
                  <span className="col-span-1 text-center">Pts</span>
                  <span className="col-span-1 text-center">NRR</span>
                  <span className="col-span-2 text-center">Form</span>
                </>
              )}
              {(activeTab === 'batting' || activeTab === 'bowling' || activeTab === 'allrounder') && (
                <>
                  <span className="col-span-2 text-center">Team</span>
                  <span className="col-span-1 text-center">{activeTab === 'batting' ? 'Runs' : activeTab === 'bowling' ? 'Wkts' : 'Pts'}</span>
                  <span className="col-span-1 text-center">Mat</span>
                  <span className="col-span-2 text-center">Rating</span>
                </>
              )}
            </div>
          </div>

          {/* Data Rows */}
          <div className="divide-y divide-slate-100">
            {rankings.map((item, idx) => {
              const rank = item.overallRank || item.rank || item.categoryRank || idx + 1;
              const isTeam = activeTab === 'overall';
              return (
                <div
                  key={item._id || idx}
                  className="grid grid-cols-12 gap-4 px-6 py-4 hover:bg-slate-50 transition-all items-center"
                >
                  <div className="col-span-1">
                    <span className="text-xl font-black text-slate-300">{getRankBadge(rank)}</span>
                  </div>
                  <div className="col-span-4 flex items-center gap-3">
                    {isTeam && item.team?.logo && (
                      <img src={item.team.logo} alt="" className="w-8 h-8 rounded-lg object-cover" />
                    )}
                    <div>
                      <Link
                        to={isTeam ? `/admin/teams/${item.team?._id}` : `/admin/players/${item._id}`}
                        className="font-bold text-[#031d44] hover:underline"
                      >
                        {isTeam ? item.team?.name : item.name}
                      </Link>
                      {isTeam && item.team?.branchName && (
                        <p className="text-[10px] text-slate-400">{item.team.branchName}</p>
                      )}
                    </div>
                  </div>

                  {isTeam && (
                    <>
                      <span className="col-span-1 text-center font-bold">{item.matchesPlayed || 0}</span>
                      <span className="col-span-1 text-center font-bold text-green-600">{item.matchesWon || 0}</span>
                      <span className="col-span-1 text-center font-bold text-red-600">{item.matchesLost || 0}</span>
                      <span className="col-span-1 text-center font-bold text-amber-600">{item.points || 0}</span>
                      <span className="col-span-1 text-center font-bold text-purple-600">{item.netRunRate?.toFixed(2) || '0.00'}</span>
                      <div className="col-span-2 text-center flex gap-1 justify-center">
                        {(item.form || '').split('').map((ch, i) => (
                          <span
                            key={i}
                            className={`w-5 h-5 rounded-full text-[8px] font-bold flex items-center justify-center ${
                              ch === 'W' ? 'bg-green-100 text-green-800' :
                              ch === 'L' ? 'bg-red-100 text-red-800' :
                              ch === 'D' ? 'bg-blue-100 text-blue-800' :
                              'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {ch}
                          </span>
                        ))}
                      </div>
                    </>
                  )}

                  {(activeTab === 'batting' || activeTab === 'bowling' || activeTab === 'allrounder') && (
                    <>
                      <div className="col-span-2 text-center">
                        <span className="text-xs font-bold text-slate-500">{item.team?.name || '-'}</span>
                      </div>
                      <span className="col-span-1 text-center font-bold text-slate-800">
                        {activeTab === 'batting' ? item.runs || 0 :
                         activeTab === 'bowling' ? item.wickets || 0 :
                         item.rankingPoints?.toFixed(0) || 0}
                      </span>
                      <span className="col-span-1 text-center text-slate-500">{item.matches || item.stats?.matches || 0}</span>
                      <span className="col-span-2 text-center font-bold text-purple-600">
                        {item.rating?.toFixed(2) || item.rankingPoints?.toFixed(1) || '-'}
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
