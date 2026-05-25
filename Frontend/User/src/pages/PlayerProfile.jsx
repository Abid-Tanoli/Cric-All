import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../services/api";
import Header from "../components/Header";
import { getStoredUser, logout as doLogout } from "../pages/auth/auth";

export default function PlayerProfile() {
  const { playerId } = useParams();
  const [player, setPlayer] = useState(null);
  const [recentMatches, setRecentMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [authUser, setAuthUser] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    const user = getStoredUser();
    setAuthUser(user);
    loadPlayer();
  }, [playerId]);

  const loadPlayer = async () => {
    try {
      const res = await api.get(`/players/${playerId}`);
      setPlayer(res.data);
      try {
        const matchRes = await api.get(`/players/${playerId}/matches`);
        setRecentMatches(Array.isArray(matchRes.data) ? matchRes.data : (matchRes.data?.matches || []));
      } catch {}
    } catch (e) {
      console.error("Failed to fetch player:", e);
    }
    setLoading(false);
  };

  const handleLogout = () => { doLogout(); setAuthUser(null); };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400 font-black uppercase tracking-widest text-xs">Loading Profile...</p>
        </div>
      </div>
    );
  }

  if (!player) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-500 font-black uppercase tracking-widest text-sm">Player not found</p>
          <Link to="/players" className="text-blue-600 hover:underline text-sm mt-2 block">Back to Players</Link>
        </div>
      </div>
    );
  }

  const stats = player.stats || {};
  const playingRole = player.playingRole || player.role || 'Player';
  const battingStyle = player.battingStyle || player.battingHand || 'Right-hand bat';
  const bowlingStyle = player.bowlingStyle || player.bowlingArm || 'Right-arm medium';

  const battingAverage = stats.innings > 0 && (stats.innings - (stats.notOuts || 0)) > 0
    ? (stats.runs / (stats.innings - (stats.notOuts || 0))).toFixed(2)
    : '0.00';

  const bowlingAverage = stats.wickets > 0
    ? ((stats.runsConceded || 0) / stats.wickets).toFixed(2)
    : '0.00';

  const formatBalls = (balls) => `${Math.floor((balls || 0) / 6)}.${(balls || 0) % 6}`;

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans">
      <Header
        user={authUser}
        onShowLogin={() => {}}
        onShowRegister={() => {}}
        onLogout={handleLogout}
      />

      {/* Player Header */}
      <div className="bg-[#031d44] text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-600/10 rounded-full -mr-48 -mt-48 blur-3xl" />

        <div className="max-w-7xl mx-auto px-4 py-8 relative">
          <Link to="/players" className="inline-flex items-center gap-2 text-blue-200 hover:text-white mb-6 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="text-sm font-bold">Back to Players</span>
          </Link>

          <div className="flex flex-col md:flex-row items-start gap-8">
            <div className="w-48 h-48 md:w-64 md:h-64 rounded-3xl bg-white/10 border-2 border-white/20 overflow-hidden flex-shrink-0">
              {player.imageUrl ? (
                <img src={player.imageUrl} alt={player.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center">
                  <span className="text-6xl font-black text-white/30">{player.name?.charAt(0)}</span>
                </div>
              )}
            </div>

            <div className="flex-1">
              <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tighter italic mb-2">
                {player.name}
              </h1>

              <div className="flex flex-wrap items-center gap-4 mb-6">
                <span className="px-4 py-1.5 bg-red-600 text-white rounded-full text-xs font-black uppercase tracking-widest">
                  {playingRole}
                </span>
                {player.team && (
                  <Link to={`/teams/${player.team._id}`} className="px-4 py-1.5 bg-white/10 backdrop-blur-sm border border-white/20 text-white rounded-full text-xs font-bold uppercase tracking-widest hover:bg-white/20 transition-all">
                    {player.team.name || player.team.shortName}
                  </Link>
                )}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/10">
                  <p className="text-[10px] font-black uppercase text-blue-200 tracking-widest mb-1">Batting</p>
                  <p className="text-sm font-bold">{battingStyle}</p>
                </div>
                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/10">
                  <p className="text-[10px] font-black uppercase text-blue-200 tracking-widest mb-1">Bowling</p>
                  <p className="text-sm font-bold">{bowlingStyle}</p>
                </div>
                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/10">
                  <p className="text-[10px] font-black uppercase text-blue-200 tracking-widest mb-1">Age</p>
                  <p className="text-sm font-bold">{player.age ? `${player.age}y` : player.dateOfBirth ? new Date().getFullYear() - new Date(player.dateOfBirth).getFullYear() + 'y' : 'N/A'}</p>
                </div>
                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/10">
                  <p className="text-[10px] font-black uppercase text-blue-200 tracking-widest mb-1">DOB</p>
                  <p className="text-sm font-bold">{player.dateOfBirth ? new Date(player.dateOfBirth).toLocaleDateString('en-GB') : 'N/A'}</p>
                </div>
                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/10">
                  <p className="text-[10px] font-black uppercase text-blue-200 tracking-widest mb-1">Nationality</p>
                  <p className="text-sm font-bold">{player.nationality || player.country || 'N/A'}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Stats Summary */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-8">
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10 text-center">
              <p className="text-4xl font-black text-white mb-1">{stats.runs || 0}</p>
              <p className="text-[10px] font-black uppercase text-blue-200 tracking-widest">Runs</p>
            </div>
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10 text-center">
              <p className="text-4xl font-black text-white mb-1">{stats.wickets || 0}</p>
              <p className="text-[10px] font-black uppercase text-blue-200 tracking-widest">Wickets</p>
            </div>
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10 text-center">
              <p className="text-4xl font-black text-white mb-1">{stats.catches || 0}</p>
              <p className="text-[10px] font-black uppercase text-blue-200 tracking-widest">Catches</p>
            </div>
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10 text-center">
              <p className="text-4xl font-black text-white mb-1">{stats.strikeRate || '0.00'}</p>
              <p className="text-[10px] font-black uppercase text-blue-200 tracking-widest">Strike Rate</p>
            </div>
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10 text-center">
              <p className="text-4xl font-black text-white mb-1">{stats.economy || '0.00'}</p>
              <p className="text-[10px] font-black uppercase text-blue-200 tracking-widest">Economy</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-8 overflow-x-auto">
            {[
              { key: 'overview', label: 'Overview' },
              { key: 'batting', label: 'Batting' },
              { key: 'bowling', label: 'Bowling' },
              { key: 'fielding', label: 'Fielding' },
              { key: 'matches', label: 'Match Log' },
              { key: 'info', label: 'Info' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`py-4 text-sm font-black uppercase tracking-widest border-b-2 transition-colors whitespace-nowrap ${activeTab === tab.key
                    ? 'border-red-600 text-[#031d44]'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-8">

        {/* ──── Overview Tab ──── */}
        {activeTab === 'overview' && (
          <div className="space-y-8">
            {/* Bio */}
            {player.bio && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">About</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{player.bio}</p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Batting Career */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="bg-[#031d44] px-6 py-4">
                  <h3 className="text-lg font-black text-white uppercase tracking-tight">Batting Career</h3>
                </div>
                <div className="p-6">
                  <div className="space-y-4">
                    <div className="flex justify-between items-center py-3 border-b border-slate-100">
                      <span className="text-sm font-bold text-slate-600">Matches</span>
                      <span className="text-lg font-black text-[#031d44]">{stats.matches || 0}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-slate-100">
                      <span className="text-sm font-bold text-slate-600">Innings</span>
                      <span className="text-lg font-black text-[#031d44]">{stats.innings || 0}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-slate-100">
                      <span className="text-sm font-bold text-slate-600">Not Outs</span>
                      <span className="text-lg font-black text-[#031d44]">{stats.notOuts || 0}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-slate-100">
                      <span className="text-sm font-bold text-slate-600">Runs</span>
                      <span className="text-lg font-black text-[#031d44]">{stats.runs || 0}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-slate-100">
                      <span className="text-sm font-bold text-slate-600">Average</span>
                      <span className="text-lg font-black text-[#031d44]">{battingAverage}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-slate-100">
                      <span className="text-sm font-bold text-slate-600">Strike Rate</span>
                      <span className="text-lg font-black text-[#031d44]">{stats.strikeRate || '0.00'}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-slate-100">
                      <span className="text-sm font-bold text-slate-600">High Score</span>
                      <span className="text-lg font-black text-[#031d44]">{stats.highScore || '0'}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-slate-100">
                      <span className="text-sm font-bold text-slate-600">100s / 50s</span>
                      <span className="text-lg font-black text-[#031d44]">{stats.hundreds || 0} / {stats.fifties || 0}</span>
                    </div>
                    <div className="flex justify-between items-center py-3">
                      <span className="text-sm font-bold text-slate-600">4s / 6s</span>
                      <span className="text-lg font-black text-[#031d44]">{stats.fours || 0} / {stats.sixes || 0}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bowling Career */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="bg-[#031d44] px-6 py-4">
                  <h3 className="text-lg font-black text-white uppercase tracking-tight">Bowling Career</h3>
                </div>
                <div className="p-6">
                  <div className="space-y-4">
                    <div className="flex justify-between items-center py-3 border-b border-slate-100">
                      <span className="text-sm font-bold text-slate-600">Innings</span>
                      <span className="text-lg font-black text-[#031d44]">{stats.bowlingInnings || stats.innings || 0}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-slate-100">
                      <span className="text-sm font-bold text-slate-600">Balls Bowled</span>
                      <span className="text-lg font-black text-[#031d44]">{formatBalls(stats.balls)}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-slate-100">
                      <span className="text-sm font-bold text-slate-600">Runs Conceded</span>
                      <span className="text-lg font-black text-[#031d44]">{stats.runsConceded || 0}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-slate-100">
                      <span className="text-sm font-bold text-slate-600">Wickets</span>
                      <span className="text-lg font-black text-[#031d44]">{stats.wickets || 0}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-slate-100">
                      <span className="text-sm font-bold text-slate-600">Average</span>
                      <span className="text-lg font-black text-[#031d44]">{bowlingAverage}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-slate-100">
                      <span className="text-sm font-bold text-slate-600">Economy</span>
                      <span className="text-lg font-black text-[#031d44]">{stats.economy || '0.00'}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-slate-100">
                      <span className="text-sm font-bold text-slate-600">Best Bowling</span>
                      <span className="text-lg font-black text-[#031d44]">{stats.bestBowling || '0/0'}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-slate-100">
                      <span className="text-sm font-bold text-slate-600">4 Wicket Hauls</span>
                      <span className="text-lg font-black text-[#031d44]">{stats.fourWickets || 0}</span>
                    </div>
                    <div className="flex justify-between items-center py-3">
                      <span className="text-sm font-bold text-slate-600">5 Wicket Hauls</span>
                      <span className="text-lg font-black text-[#031d44]">{stats.fiveWickets || 0}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Recent Performances */}
            {recentMatches.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="bg-[#031d44] px-6 py-4 flex items-center justify-between">
                  <h3 className="text-lg font-black text-white uppercase tracking-tight">Recent Performances</h3>
                  <span className="text-xs text-blue-200 font-bold">Last {recentMatches.length} matches</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[10px] font-black uppercase tracking-widest text-slate-400 bg-slate-50">
                        <th className="py-3 px-4">Match</th>
                        <th className="py-3 px-2 text-center">Runs</th>
                        <th className="py-3 px-2 text-center">BF</th>
                        <th className="py-3 px-2 text-center">SR</th>
                        <th className="py-3 px-2 text-center">Wkts</th>
                        <th className="py-3 px-2 text-center">Econ</th>
                        <th className="py-3 px-2 text-center">Ct</th>
                        <th className="py-3 px-2 text-center">Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {recentMatches.slice(0, 10).map(m => {
                        const myBat = (m.batting || []).find(b => b.player?._id === playerId || b.player === playerId);
                        const myBowl = (m.bowling || []).find(b => b.player?._id === playerId || b.player === playerId);
                        return (
                          <tr key={m._id} className="hover:bg-slate-50">
                            <td className="py-3 px-4">
                              <Link to={`/match/${m._id}`} className="font-bold text-[#031d44] hover:text-blue-600 text-xs truncate block max-w-[180px]">
                                {m.teams?.map(t => t.shortName || t.name).join(' vs ') || m.title}
                              </Link>
                            </td>
                            <td className="py-3 px-2 text-center font-black text-slate-700">{myBat?.runs || '-'}</td>
                            <td className="py-3 px-2 text-center font-bold text-slate-500">{myBat?.ballsFaced || '-'}</td>
                            <td className="py-3 px-2 text-center font-bold text-slate-500">{myBat?.ballsFaced ? ((myBat.runs / myBat.ballsFaced) * 100).toFixed(1) : '-'}</td>
                            <td className="py-3 px-2 text-center font-black text-slate-700">{myBowl?.wickets || '-'}</td>
                            <td className="py-3 px-2 text-center font-bold text-slate-500">{myBowl?.balls ? ((myBowl.runs || 0) / (myBowl.balls / 6)).toFixed(1) : '-'}</td>
                            <td className="py-3 px-2 text-center font-bold text-slate-500">{myBat?.catches || myBowl?.catches || '-'}</td>
                            <td className="py-3 px-2 text-center">
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded ${m.result?.winner === player.team?._id || m.result?.winner === player.team ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                {m.result?.winner === player.team?._id || m.result?.winner === player.team ? 'W' : (m.status === 'completed' ? 'L' : '-')}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ──── Batting Tab ──── */}
        {activeTab === 'batting' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="bg-[#031d44] px-6 py-4">
              <h3 className="text-lg font-black text-white uppercase tracking-tight">Detailed Batting Stats</h3>
            </div>
            <div className="p-6">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
                      <th className="py-3">Format</th>
                      <th className="py-3 text-center">Mat</th>
                      <th className="py-3 text-center">Inns</th>
                      <th className="py-3 text-center">NO</th>
                      <th className="py-3 text-center">Runs</th>
                      <th className="py-3 text-center">HS</th>
                      <th className="py-3 text-center">Ave</th>
                      <th className="py-3 text-center">SR</th>
                      <th className="py-3 text-center">100s</th>
                      <th className="py-3 text-center">50s</th>
                      <th className="py-3 text-center">4s</th>
                      <th className="py-3 text-center">6s</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    <tr className="hover:bg-slate-50">
                      <td className="py-4 font-bold text-[#031d44]">Overall</td>
                      <td className="py-4 text-center font-bold text-slate-600">{stats.matches || 0}</td>
                      <td className="py-4 text-center font-bold text-slate-600">{stats.innings || 0}</td>
                      <td className="py-4 text-center font-bold text-slate-600">{stats.notOuts || 0}</td>
                      <td className="py-4 text-center font-black text-[#031d44]">{stats.runs || 0}</td>
                      <td className="py-4 text-center font-bold text-slate-600">{stats.highScore || '0'}</td>
                      <td className="py-4 text-center font-bold text-slate-600">{battingAverage}</td>
                      <td className="py-4 text-center font-bold text-slate-600">{stats.strikeRate || '0.00'}</td>
                      <td className="py-4 text-center font-bold text-slate-600">{stats.hundreds || 0}</td>
                      <td className="py-4 text-center font-bold text-slate-600">{stats.fifties || 0}</td>
                      <td className="py-4 text-center font-bold text-slate-600">{stats.fours || 0}</td>
                      <td className="py-4 text-center font-bold text-slate-600">{stats.sixes || 0}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ──── Bowling Tab ──── */}
        {activeTab === 'bowling' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="bg-[#031d44] px-6 py-4">
              <h3 className="text-lg font-black text-white uppercase tracking-tight">Detailed Bowling Stats</h3>
            </div>
            <div className="p-6">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
                      <th className="py-3">Format</th>
                      <th className="py-3 text-center">Mat</th>
                      <th className="py-3 text-center">Inns</th>
                      <th className="py-3 text-center">Overs</th>
                      <th className="py-3 text-center">Runs</th>
                      <th className="py-3 text-center">Wkts</th>
                      <th className="py-3 text-center">BBI</th>
                      <th className="py-3 text-center">Ave</th>
                      <th className="py-3 text-center">Econ</th>
                      <th className="py-3 text-center">SR</th>
                      <th className="py-3 text-center">4w</th>
                      <th className="py-3 text-center">5w</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    <tr className="hover:bg-slate-50">
                      <td className="py-4 font-bold text-[#031d44]">Overall</td>
                      <td className="py-4 text-center font-bold text-slate-600">{stats.matches || 0}</td>
                      <td className="py-4 text-center font-bold text-slate-600">{stats.bowlingInnings || stats.innings || 0}</td>
                      <td className="py-4 text-center font-bold text-slate-600">{formatBalls(stats.balls)}</td>
                      <td className="py-4 text-center font-bold text-slate-600">{stats.runsConceded || 0}</td>
                      <td className="py-4 text-center font-black text-[#031d44]">{stats.wickets || 0}</td>
                      <td className="py-4 text-center font-bold text-slate-600">{stats.bestBowling || '0/0'}</td>
                      <td className="py-4 text-center font-bold text-slate-600">{bowlingAverage}</td>
                      <td className="py-4 text-center font-bold text-slate-600">{stats.economy || '0.00'}</td>
                      <td className="py-4 text-center font-bold text-slate-600">{stats.balls && stats.wickets ? ((stats.balls / stats.wickets) || 0).toFixed(1) : '-'}</td>
                      <td className="py-4 text-center font-bold text-slate-600">{stats.fourWickets || 0}</td>
                      <td className="py-4 text-center font-bold text-slate-600">{stats.fiveWickets || 0}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ──── Fielding Tab ──── */}
        {activeTab === 'fielding' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="bg-[#031d44] px-6 py-4">
              <h3 className="text-lg font-black text-white uppercase tracking-tight">Fielding Stats</h3>
            </div>
            <div className="p-6">
              {stats.catches || stats.stumpings || stats.runOuts ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                  <div className="bg-slate-50 rounded-xl p-6 text-center">
                    <p className="text-4xl font-black text-[#031d44]">{stats.catches || 0}</p>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2">Catches</p>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-6 text-center">
                    <p className="text-4xl font-black text-[#031d44]">{stats.stumpings || 0}</p>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2">Stumpings</p>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-6 text-center">
                    <p className="text-4xl font-black text-[#031d44]">{stats.runOuts || 0}</p>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2">Run Outs</p>
                  </div>
                </div>
              ) : (
                <p className="text-slate-400 text-center py-8">No fielding data available</p>
              )}
            </div>
          </div>
        )}

        {/* ──── Match Log Tab ──── */}
        {activeTab === 'matches' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="bg-[#031d44] px-6 py-4">
              <h3 className="text-lg font-black text-white uppercase tracking-tight">Match Log</h3>
            </div>
            {recentMatches.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] font-black uppercase tracking-widest text-slate-400 bg-slate-50">
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-3">Opposition</th>
                      <th className="py-3 px-3">Tournament</th>
                      <th className="py-3 px-2 text-center">Runs</th>
                      <th className="py-3 px-2 text-center">BF</th>
                      <th className="py-3 px-2 text-center">4s</th>
                      <th className="py-3 px-2 text-center">6s</th>
                      <th className="py-3 px-2 text-center">SR</th>
                      <th className="py-3 px-2 text-center">Overs</th>
                      <th className="py-3 px-2 text-center">Wkts</th>
                      <th className="py-3 px-2 text-center">Econ</th>
                      <th className="py-3 px-2 text-center">Ct</th>
                      <th className="py-3 px-3 text-center">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {recentMatches.map(m => {
                      const myTeamIndex = (m.teams || []).findIndex(t => t._id === player.team?._id || t === player.team);
                      const opposition = m.teams?.[myTeamIndex === 0 ? 1 : 0];
                      const myBat = (m.batting || []).find(b => b.player?._id === playerId || b.player === playerId);
                      const myBowl = (m.bowling || []).find(b => b.player?._id === playerId || b.player === playerId);
                      return (
                        <tr key={m._id} className="hover:bg-slate-50">
                          <td className="py-3 px-4 text-[11px] font-bold text-slate-500 whitespace-nowrap">
                            {m.startAt ? new Date(m.startAt).toLocaleDateString('en-GB') : '-'}
                          </td>
                          <td className="py-3 px-3">
                            <Link to={`/match/${m._id}`} className="font-bold text-[#031d44] hover:text-blue-600 text-xs">
                              {opposition?.shortName || opposition?.name || 'TBD'}
                            </Link>
                          </td>
                          <td className="py-3 px-3 text-[10px] font-bold text-slate-400 uppercase">{m.tournament?.shortName || m.tournament?.name || m.matchType || '-'}</td>
                          <td className="py-3 px-2 text-center font-black text-slate-700">{myBat?.runs ?? '-'}</td>
                          <td className="py-3 px-2 text-center font-bold text-slate-500">{myBat?.ballsFaced ?? '-'}</td>
                          <td className="py-3 px-2 text-center font-bold text-slate-500">{myBat?.fours ?? '-'}</td>
                          <td className="py-3 px-2 text-center font-bold text-slate-500">{myBat?.sixes ?? '-'}</td>
                          <td className="py-3 px-2 text-center font-bold text-slate-500">{myBat?.ballsFaced ? ((myBat.runs / myBat.ballsFaced) * 100).toFixed(1) : '-'}</td>
                          <td className="py-3 px-2 text-center font-bold text-slate-500">{myBowl?.balls ? formatBalls(myBowl.balls) : '-'}</td>
                          <td className="py-3 px-2 text-center font-black text-slate-700">{myBowl?.wickets ?? '-'}</td>
                          <td className="py-3 px-2 text-center font-bold text-slate-500">{myBowl?.balls ? ((myBowl.runs || 0) / (myBowl.balls / 6)).toFixed(1) : '-'}</td>
                          <td className="py-3 px-2 text-center font-bold text-slate-500">{myBat?.catches || myBowl?.catches || '-'}</td>
                          <td className="py-3 px-3 text-center">
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded ${
                              m.result?.winner === player.team?._id || m.result?.winner === player.team
                                ? 'bg-green-100 text-green-700'
                                : m.status === 'completed' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'
                            }`}>
                              {m.result?.winner === player.team?._id || m.result?.winner === player.team ? 'W' : (m.status === 'completed' ? 'L' : '-')}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-6">
                <p className="text-slate-500 text-sm text-center py-8">Match history will appear here after matches are played</p>
              </div>
            )}
          </div>
        )}

        {/* ──── Info Tab ──── */}
        {activeTab === 'info' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="bg-[#031d44] px-6 py-4">
              <h3 className="text-lg font-black text-white uppercase tracking-tight">Player Info</h3>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <InfoRow label="Full Name" value={player.fullName || player.name} />
                  <InfoRow label="Date of Birth" value={player.dateOfBirth ? new Date(player.dateOfBirth).toLocaleDateString('en-GB') : 'N/A'} />
                  <InfoRow label="Age" value={player.age ? `${player.age} years` : player.dateOfBirth ? `${new Date().getFullYear() - new Date(player.dateOfBirth).getFullYear()} years` : 'N/A'} />
                  <InfoRow label="Nationality" value={player.nationality || player.country || 'N/A'} />
                  <InfoRow label="Playing Role" value={playingRole} />
                  <InfoRow label="Batting Style" value={battingStyle} />
                  <InfoRow label="Bowling Style" value={bowlingStyle} />
                </div>
                <div className="space-y-4">
                  <InfoRow label="Current Team" value={player.team?.name || 'Free Agent'} link={player.team?._id ? `/teams/${player.team._id}` : null} />
                  <InfoRow label="Jersey Number" value={player.jerseyNumber || 'N/A'} />
                  <InfoRow label="Height" value={player.height ? `${player.height} cm` : 'N/A'} />
                  <InfoRow label="Nickname" value={player.nickname || 'N/A'} />
                  <InfoRow label="Status" value={player.status || 'Active'} />
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

const InfoRow = ({ label, value, link }) => (
  <div className="flex items-center justify-between py-2 border-b border-slate-50">
    <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{label}</span>
    {link ? (
      <Link to={link} className="text-sm font-bold text-blue-600 hover:underline">{value}</Link>
    ) : (
      <span className="text-sm font-bold text-slate-700">{value}</span>
    )}
  </div>
);
