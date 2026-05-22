import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import { useSelector } from 'react-redux';

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

export default function SeriesDetail() {
  const { id } = useParams();
  const { token } = useSelector((state) => state.auth);
  const [activeTab, setActiveTab] = useState('points');
  const [seriesData, setSeriesData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchSeries = async () => {
      try {
        const res = await axios.get(`${API_URL}/series/${id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setSeriesData(res.data);
      } catch (err) {
        setError('Failed to load series data');
      } finally {
        setLoading(false);
      }
    };
    fetchSeries();
  }, [id, token]);

  if (loading && !seriesData) {
    return <div className="min-h-screen bg-[#0f172a] flex items-center justify-center text-white"><div className="animate-spin rounded-full h-16 w-16 border-t-4 border-[#22c55e]"></div></div>;
  }
  if (error || !seriesData) return <div className="min-h-screen bg-[#0f172a] flex items-center justify-center text-red-500">{error || 'Series not found'}</div>;

  const matches = seriesData.matches || [];
  const teams = seriesData.teams || [];

  const calculatePoints = () => {
    const points = {};
    teams.forEach(team => {
      points[team._id] = { played: 0, won: 0, lost: 0, tied: 0, noResult: 0, points: 0, netRR: 0 };
    });

    matches.forEach(match => {
      if (match.status !== 'completed') return;
      const team1Id = match.teams?.[0]?._id;
      const team2Id = match.teams?.[1]?._id;
      if (!team1Id || !team2Id) return;

      if (points[team1Id]) points[team1Id].played++;
      if (points[team2Id]) points[team2Id].played++;

      if (match.result?.winner) {
        const winnerId = match.result.winner._id || match.result.winner;
        if (points[winnerId]) {
          points[winnerId].won++;
          points[winnerId].points += 2;
        }
        const loserId = winnerId === team1Id ? team2Id : team1Id;
        if (points[loserId]) points[loserId].lost++;
      } else if (match.result?.isTie) {
        if (points[team1Id]) { points[team1Id].tied++; points[team1Id].points += 1; }
        if (points[team2Id]) { points[team2Id].tied++; points[team2Id].points += 1; }
      } else {
        if (points[team1Id]) points[team1Id].noResult++;
        if (points[team2Id]) points[team2Id].noResult++;
      }
    });

    return Object.entries(points).map(([teamId, stats]) => ({
      team: teams.find(t => t._id === teamId),
      ...stats
    })).sort((a, b) => b.points - a.points);
  };

  const standings = calculatePoints();

  const getMatchStatus = (match) => {
    if (match.status === 'completed') return 'Completed';
    if (match.status === 'live') return 'Live';
    if (match.status === 'scheduled') return 'Scheduled';
    return 'Upcoming';
  };

  const getMatchResult = (match) => {
    if (match.result?.winner) return `${match.result.winner.name} won`;
    if (match.result?.isTie) return 'Match Tied';
    if (match.result?.noResult) return 'No Result';
    return '';
  };

  const formatDate = (date) => {
    if (!date) return 'TBD';
    return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Rajdhani:wght@500;600;700&display=swap');
        .font-rajdhani { font-family: 'Rajdhani', sans-serif; }
        .font-inter { font-family: 'Inter', sans-serif; }
        .custom-scrollbar::-webkit-scrollbar { height: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #0f172a; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
      `}</style>

      <div className="min-h-screen bg-[#0f172a] text-[#f1f5f9] font-inter">
        <div className="sticky top-0 z-50 bg-[#0f172a] border-b border-[#334155] shadow-md">
          <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-6">
              <Link to="/admin/events" className="text-2xl font-bold font-rajdhani text-white flex items-center gap-2 hover:opacity-80">
                <span className="text-[#22c55e]">🏏</span> AdminLive
              </Link>
              <div className="hidden md:block text-sm text-[#94a3b8] font-medium border-l border-[#334155] pl-6">
                {seriesData.name} • {seriesData.matchType}
              </div>
            </div>
          </div>

          <div className="max-w-7xl mx-auto px-4">
            <div className="flex overflow-x-auto custom-scrollbar">
              {['Points', 'Schedule', 'Stats', 'Teams'].map(tab => (
                <button 
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-3 whitespace-nowrap text-sm font-bold transition flex flex-col relative ${activeTab === tab ? 'text-[#22c55e]' : 'text-[#94a3b8] hover:text-white'}`}
                >
                  {tab}
                  {activeTab === tab && <div className="absolute bottom-0 left-0 w-full h-[3px] bg-[#22c55e] rounded-t-md"></div>}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="bg-[#1e293b] rounded-xl border border-[#334155] p-6 mb-8">
            <h1 className="text-2xl font-bold font-rajdhani text-white mb-2">{seriesData.name}</h1>
            <div className="flex gap-4 text-sm text-[#94a3b8]">
              <span>{seriesData.matchType}</span>
              <span>•</span>
              <span>{matches.length} Matches</span>
              <span>•</span>
              <span>{teams.length} Teams</span>
            </div>
          </div>

          {activeTab === 'points' && (
            <div className="bg-[#1e293b] rounded-xl border border-[#334155] shadow-lg overflow-hidden">
              <div className="bg-[#0f172a] px-6 py-4 border-b border-[#334155]">
                <h3 className="font-bold text-lg text-white">Points Table</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-[#1e293b] text-[#94a3b8] text-xs uppercase border-b border-[#334155]">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-center w-12">#</th>
                      <th className="px-4 py-3 font-semibold">Team</th>
                      <th className="px-4 py-3 font-semibold text-center">P</th>
                      <th className="px-4 py-3 font-semibold text-center">W</th>
                      <th className="px-4 py-3 font-semibold text-center">L</th>
                      <th className="px-4 py-3 font-semibold text-center">T</th>
                      <th className="px-4 py-3 font-semibold text-center">NR</th>
                      <th className="px-4 py-3 font-semibold text-center">Pts</th>
                      <th className="px-4 py-3 font-semibold text-center">NRR</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#334155]">
                    {standings.map((s, idx) => (
                      <tr key={s.team?._id || idx} className="hover:bg-[#0f172a]/50 transition">
                        <td className="px-4 py-4 text-center font-bold text-[#94a3b8]">{idx + 1}</td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-3">
                            {s.team?.logo ? (
                              <img src={s.team.logo} alt="" className="w-8 h-8 rounded-full" />
                            ) : (
                              <div className="w-8 h-8 bg-gray-700 rounded-full flex items-center justify-center font-bold text-sm">
                                {s.team?.name?.charAt(0) || 'T'}
                              </div>
                            )}
                            <span className="font-bold text-white">{s.team?.name || 'Team'}</span>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-center text-[#94a3b8]">{s.played}</td>
                        <td className="px-4 py-4 text-center text-[#22c55e] font-bold">{s.won}</td>
                        <td className="px-4 py-4 text-center text-[#ef4444]">{s.lost}</td>
                        <td className="px-4 py-4 text-center text-[#f59e0b]">{s.tied}</td>
                        <td className="px-4 py-4 text-center text-[#94a3b8]">{s.noResult}</td>
                        <td className="px-4 py-4 text-center font-bold text-white">{s.points}</td>
                        <td className="px-4 py-4 text-center text-[#94a3b8]">{s.netRR.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-4 bg-[#0f172a] border-t border-[#334155] text-xs text-[#94a3b8]">
                P: Played, W: Won, L: Lost, T: Tied, NR: No Result, Pts: Points, NRR: Net Run Rate
              </div>
            </div>
          )}

          {activeTab === 'schedule' && (
            <div className="space-y-4">
              {matches.length === 0 ? (
                <div className="bg-[#1e293b] p-10 text-center rounded-xl border border-[#334155]">
                  <p className="text-[#94a3b8]">No matches scheduled yet</p>
                </div>
              ) : (
                matches.map((match, idx) => (
                  <div key={match._id || idx} className="bg-[#1e293b] rounded-xl border border-[#334155] p-4 hover:border-[#22c55e]/50 transition">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                      <div className="flex-1">
                        <div className="flex items-center justify-between md:justify-start gap-4 mb-2">
                          <div className="flex items-center gap-2">
                            {match.teams?.[0]?.logo ? (
                              <img src={match.teams[0].logo} alt="" className="w-6 h-6 rounded-full" />
                            ) : (
                              <div className="w-6 h-6 bg-gray-700 rounded-full flex items-center justify-center text-xs font-bold">
                                {match.teams?.[0]?.name?.charAt(0) || 'T'}
                              </div>
                            )}
                            <span className="font-bold text-white">{match.teams?.[0]?.name || 'Team 1'}</span>
                          </div>
                          <span className="text-[#94a3b8] text-sm">vs</span>
                          <div className="flex items-center gap-2">
                            {match.teams?.[1]?.logo ? (
                              <img src={match.teams[1].logo} alt="" className="w-6 h-6 rounded-full" />
                            ) : (
                              <div className="w-6 h-6 bg-gray-700 rounded-full flex items-center justify-center text-xs font-bold">
                                {match.teams?.[1]?.name?.charAt(0) || 'T'}
                              </div>
                            )}
                            <span className="font-bold text-white">{match.teams?.[1]?.name || 'Team 2'}</span>
                          </div>
                        </div>
                        <div className="text-sm text-[#94a3b8]">
                          {match.venue} • {formatDate(match.startAt)}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <span className={`px-2 py-1 rounded text-xs font-bold ${
                            match.status === 'completed' ? 'bg-[#22c55e]/10 text-[#22c55e]' :
                            match.status === 'live' ? 'bg-[#ef4444]/10 text-[#ef4444]' :
                            'bg-[#94a3b8]/10 text-[#94a3b8]'
                          }`}>
                            {getMatchStatus(match)}
                          </span>
                          {match.result && (
                            <div className="text-xs text-[#94a3b8] mt-1">{getMatchResult(match)}</div>
                          )}
                        </div>
                        {match.status !== 'completed' && (
                          <Link to={`/admin/live/${match._id}`} className="text-sm font-bold bg-[#3b82f6] text-white px-3 py-1.5 rounded hover:bg-[#2563eb] transition">
                            {match.status === 'live' ? 'Watch Live' : 'Manage'}
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'stats' && (
            <div className="bg-[#1e293b] p-10 text-center rounded-xl border border-[#334155]">
              <h2 className="text-xl font-bold font-rajdhani text-white mb-2">Series Statistics</h2>
              <p className="text-[#94a3b8]">Detailed series statistics will appear here.</p>
            </div>
          )}

          {activeTab === 'teams' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {teams.map((team, idx) => (
                <Link key={team._id || idx} to={`/admin/teams/${team._id}`} className="bg-[#1e293b] rounded-xl border border-[#334155] p-6 hover:border-[#22c55e]/50 transition">
                  <div className="flex items-center gap-4">
                    {team.logo ? (
                      <img src={team.logo} alt="" className="w-12 h-12 rounded-full" />
                    ) : (
                      <div className="w-12 h-12 bg-gray-700 rounded-full flex items-center justify-center font-bold text-xl">
                        {team.name?.charAt(0) || 'T'}
                      </div>
                    )}
                    <div>
                      <h3 className="font-bold text-white text-lg">{team.name}</h3>
                      <p className="text-sm text-[#94a3b8]">{team.shortName || 'T20'}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}