import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "../services/api";
import Header from "../components/Header";
import FormTracker from "../components/FormTracker";
import ShareButton from "../components/ShareButton";
import { getStoredUser, logout as doLogout } from "../pages/auth/auth";
import SafeImage from "../../../Shared/components/SafeImage.jsx";

export default function PlayerProfile() {
  const { playerId } = useParams();
  const [player, setPlayer] = useState(null);
  const [recentMatches, setRecentMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [authUser, setAuthUser] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const navigate = useNavigate();

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
      <div className="min-h-screen bg-cric-bg flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-cric-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-cric-muted font-black uppercase tracking-widest text-xs">Loading Profile...</p>
        </div>
      </div>
    );
  }

  if (!player) {
    return (
      <div className="min-h-screen bg-cric-bg flex items-center justify-center">
        <div className="text-center">
          <p className="text-cric-muted font-black uppercase tracking-widest text-sm">Player not found</p>
          <Link to="/players" className="text-cric-accent hover:text-orange-600 text-sm mt-2 block">Back to Players</Link>
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
    <div className="min-h-screen bg-cric-bg text-cric-text font-sans">
      <Header
        user={authUser}
        onLogout={handleLogout}
      />

      {/* Player Header */}
      <div className="bg-gradient-to-r from-cric-text to-slate-800 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-cric-accent/10 rounded-full -mr-48 -mt-48 blur-3xl" />

        <div className="max-w-7xl mx-auto px-4 py-8 relative">
          <Link to="/players" className="inline-flex items-center gap-2 text-white/60 hover:text-white mb-6 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="text-sm font-bold">Back to Players</span>
          </Link>

          <div className="flex flex-col md:flex-row items-start gap-8">
            <div className="w-48 h-48 md:w-64 md:h-64 rounded-3xl bg-white/10 border-2 border-white/20 overflow-hidden flex-shrink-0">
              {player.imageUrl ? (
                <SafeImage src={player.imageUrl} alt={player.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-cric-accent to-orange-700 flex items-center justify-center">
                  <span className="text-6xl font-black text-white/30">{player.name?.charAt(0)}</span>
                </div>
              )}
            </div>

            <div className="flex-1">
              <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tighter italic mb-2">
                {player.name}
              </h1>

              <div className="flex flex-wrap items-center gap-4 mb-6">
                <span className="px-4 py-1.5 bg-cric-accent text-white rounded-full text-xs font-black uppercase tracking-widest">
                  {playingRole}
                </span>
                {player.team && (
                  <Link to={`/teams/${player.team._id}`} className="px-4 py-1.5 bg-white/10 backdrop-blur-sm border border-white/20 text-white rounded-full text-xs font-bold uppercase tracking-widest hover:bg-white/20 transition-all">
                    {player.team.name || player.team.shortName}
                  </Link>
                )}
                <Link
                  to={`/compare?p1=${playerId}`}
                  className="px-4 py-1.5 bg-white/10 backdrop-blur-sm border border-white/20 text-white rounded-full text-xs font-bold uppercase tracking-widest hover:bg-white/20 transition-all flex items-center gap-1.5"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                  Compare
                </Link>
                <ShareButton title={player.name} />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/10">
                  <p className="text-[10px] font-black uppercase text-white/60 tracking-widest mb-1">Batting</p>
                  <p className="text-sm font-bold">{battingStyle}</p>
                </div>
                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/10">
                  <p className="text-[10px] font-black uppercase text-white/60 tracking-widest mb-1">Bowling</p>
                  <p className="text-sm font-bold">{bowlingStyle}</p>
                </div>
                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/10">
                  <p className="text-[10px] font-black uppercase text-white/60 tracking-widest mb-1">Age</p>
                  <p className="text-sm font-bold">{player.age ? `${player.age}y` : player.dateOfBirth ? new Date().getFullYear() - new Date(player.dateOfBirth).getFullYear() + 'y' : 'N/A'}</p>
                </div>
                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/10">
                  <p className="text-[10px] font-black uppercase text-white/60 tracking-widest mb-1">DOB</p>
                  <p className="text-sm font-bold">{player.dateOfBirth ? new Date(player.dateOfBirth).toLocaleDateString('en-GB') : 'N/A'}</p>
                </div>
                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/10">
                  <p className="text-[10px] font-black uppercase text-white/60 tracking-widest mb-1">Nationality</p>
                  <p className="text-sm font-bold">{player.nationality || player.country || 'N/A'}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Stats Summary */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-8">
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10 text-center">
              <p className="text-4xl font-black text-white mb-1">{stats.runs || 0}</p>
              <p className="text-[10px] font-black uppercase text-white/60 tracking-widest">Runs</p>
            </div>
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10 text-center">
              <p className="text-4xl font-black text-white mb-1">{stats.wickets || 0}</p>
              <p className="text-[10px] font-black uppercase text-white/60 tracking-widest">Wickets</p>
            </div>
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10 text-center">
              <p className="text-4xl font-black text-white mb-1">{stats.catches || 0}</p>
              <p className="text-[10px] font-black uppercase text-white/60 tracking-widest">Catches</p>
            </div>
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10 text-center">
              <p className="text-4xl font-black text-white mb-1">{stats.strikeRate || '0.00'}</p>
              <p className="text-[10px] font-black uppercase text-white/60 tracking-widest">Strike Rate</p>
            </div>
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10 text-center">
              <p className="text-4xl font-black text-white mb-1">{stats.economy || '0.00'}</p>
              <p className="text-[10px] font-black uppercase text-white/60 tracking-widest">Economy</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-cric-card border-b border-cric-border sticky top-0 z-10 shadow-sm">
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
                    ? 'border-cric-accent text-cric-text'
                    : 'border-transparent text-cric-muted hover:text-cric-text'
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
              <div className="bg-cric-card rounded-xl shadow-sm border border-cric-border p-6">
                <h3 className="text-xs font-black text-cric-muted uppercase tracking-widest mb-3">About</h3>
                <p className="text-sm text-cric-text leading-relaxed">{player.bio}</p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Batting Career */}
              <div className="bg-cric-card rounded-xl shadow-sm border border-cric-border overflow-hidden">
                <div className="bg-cric-accent px-6 py-4">
                  <h3 className="text-lg font-black text-white uppercase tracking-tight">Batting Career</h3>
                </div>
                <div className="p-6">
                  <div className="space-y-4">
                    <div className="flex justify-between items-center py-3 border-b border-cric-border">
                      <span className="text-sm font-bold text-cric-muted">Matches</span>
                      <span className="text-lg font-black text-cric-text">{stats.matches || 0}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-cric-border">
                      <span className="text-sm font-bold text-cric-muted">Innings</span>
                      <span className="text-lg font-black text-cric-text">{stats.innings || 0}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-cric-border">
                      <span className="text-sm font-bold text-cric-muted">Not Outs</span>
                      <span className="text-lg font-black text-cric-text">{stats.notOuts || 0}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-cric-border">
                      <span className="text-sm font-bold text-cric-muted">Runs</span>
                      <span className="text-lg font-black text-cric-text">{stats.runs || 0}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-cric-border">
                      <span className="text-sm font-bold text-cric-muted">Average</span>
                      <span className="text-lg font-black text-cric-text">{battingAverage}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-cric-border">
                      <span className="text-sm font-bold text-cric-muted">Strike Rate</span>
                      <span className="text-lg font-black text-cric-text">{stats.strikeRate || '0.00'}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-cric-border">
                      <span className="text-sm font-bold text-cric-muted">High Score</span>
                      <span className="text-lg font-black text-cric-text">{stats.highScore || '0'}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-cric-border">
                      <span className="text-sm font-bold text-cric-muted">100s / 50s</span>
                      <span className="text-lg font-black text-cric-text">{stats.hundreds || 0} / {stats.fifties || 0}</span>
                    </div>
                    <div className="flex justify-between items-center py-3">
                      <span className="text-sm font-bold text-cric-muted">4s / 6s</span>
                      <span className="text-lg font-black text-cric-text">{stats.fours || 0} / {stats.sixes || 0}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bowling Career */}
              <div className="bg-cric-card rounded-xl shadow-sm border border-cric-border overflow-hidden">
                <div className="bg-cric-accent px-6 py-4">
                  <h3 className="text-lg font-black text-white uppercase tracking-tight">Bowling Career</h3>
                </div>
                <div className="p-6">
                  <div className="space-y-4">
                    <div className="flex justify-between items-center py-3 border-b border-cric-border">
                      <span className="text-sm font-bold text-cric-muted">Innings</span>
                      <span className="text-lg font-black text-cric-text">{stats.bowlingInnings || stats.innings || 0}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-cric-border">
                      <span className="text-sm font-bold text-cric-muted">Balls Bowled</span>
                      <span className="text-lg font-black text-cric-text">{formatBalls(stats.balls)}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-cric-border">
                      <span className="text-sm font-bold text-cric-muted">Runs Conceded</span>
                      <span className="text-lg font-black text-cric-text">{stats.runsConceded || 0}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-cric-border">
                      <span className="text-sm font-bold text-cric-muted">Wickets</span>
                      <span className="text-lg font-black text-cric-text">{stats.wickets || 0}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-cric-border">
                      <span className="text-sm font-bold text-cric-muted">Average</span>
                      <span className="text-lg font-black text-cric-text">{bowlingAverage}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-cric-border">
                      <span className="text-sm font-bold text-cric-muted">Economy</span>
                      <span className="text-lg font-black text-cric-text">{stats.economy || '0.00'}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-cric-border">
                      <span className="text-sm font-bold text-cric-muted">Best Bowling</span>
                      <span className="text-lg font-black text-cric-text">{stats.bestBowling || '0/0'}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-cric-border">
                      <span className="text-sm font-bold text-cric-muted">4 Wicket Hauls</span>
                      <span className="text-lg font-black text-cric-text">{stats.fourWickets || 0}</span>
                    </div>
                    <div className="flex justify-between items-center py-3">
                      <span className="text-sm font-bold text-cric-muted">5 Wicket Hauls</span>
                      <span className="text-lg font-black text-cric-text">{stats.fiveWickets || 0}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Form Tracker */}
            <FormTracker recentMatches={recentMatches} playerId={playerId} />

            {/* Recent Performances */}
            {recentMatches.length > 0 && (
              <div className="bg-cric-card rounded-xl shadow-sm border border-cric-border overflow-hidden">
                <div className="bg-cric-accent px-6 py-4 flex items-center justify-between">
                  <h3 className="text-lg font-black text-white uppercase tracking-tight">Recent Performances</h3>
                  <span className="text-xs text-white/60 font-bold">Last {recentMatches.length} matches</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[10px] font-black uppercase tracking-widest text-cric-muted bg-cric-bg">
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
                    <tbody className="divide-y divide-cric-border/50">
                      {recentMatches.slice(0, 10).map(m => {
                        const myBat = (m.batting || []).find(b => b.player?._id === playerId || b.player === playerId);
                        const myBowl = (m.bowling || []).find(b => b.player?._id === playerId || b.player === playerId);
                        return (
                          <tr key={m._id} className="hover:bg-cric-bg">
                            <td className="py-3 px-4">
                              <Link to={`/match/${m._id}`} className="font-bold text-cric-text hover:text-cric-accent text-xs truncate block max-w-[180px]">
                                {m.teams?.map(t => t.shortName || t.name).join(' vs ') || m.title}
                              </Link>
                            </td>
                            <td className="py-3 px-2 text-center font-black text-cric-text">{myBat?.runs || '-'}</td>
                            <td className="py-3 px-2 text-center font-bold text-cric-muted">{myBat?.ballsFaced || '-'}</td>
                            <td className="py-3 px-2 text-center font-bold text-cric-muted">{myBat?.ballsFaced ? ((myBat.runs / myBat.ballsFaced) * 100).toFixed(1) : '-'}</td>
                            <td className="py-3 px-2 text-center font-black text-cric-text">{myBowl?.wickets || '-'}</td>
                            <td className="py-3 px-2 text-center font-bold text-cric-muted">{myBowl?.balls ? ((myBowl.runs || 0) / (myBowl.balls / 6)).toFixed(1) : '-'}</td>
                            <td className="py-3 px-2 text-center font-bold text-cric-muted">{myBat?.catches || myBowl?.catches || '-'}</td>
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
          <div className="bg-cric-card rounded-xl shadow-sm border border-cric-border overflow-hidden">
            <div className="bg-cric-accent px-6 py-4">
              <h3 className="text-lg font-black text-white uppercase tracking-tight">Detailed Batting Stats</h3>
            </div>
            <div className="p-6">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] font-black uppercase tracking-widest text-cric-muted border-b border-cric-border">
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
                  <tbody className="divide-y divide-cric-border/50">
                    <tr className="hover:bg-cric-bg">
                      <td className="py-4 font-bold text-cric-text">Overall</td>
                      <td className="py-4 text-center font-bold text-cric-muted">{stats.matches || 0}</td>
                      <td className="py-4 text-center font-bold text-cric-muted">{stats.innings || 0}</td>
                      <td className="py-4 text-center font-bold text-cric-muted">{stats.notOuts || 0}</td>
                      <td className="py-4 text-center font-black text-cric-text">{stats.runs || 0}</td>
                      <td className="py-4 text-center font-bold text-cric-muted">{stats.highScore || '0'}</td>
                      <td className="py-4 text-center font-bold text-cric-muted">{battingAverage}</td>
                      <td className="py-4 text-center font-bold text-cric-muted">{stats.strikeRate || '0.00'}</td>
                      <td className="py-4 text-center font-bold text-cric-muted">{stats.hundreds || 0}</td>
                      <td className="py-4 text-center font-bold text-cric-muted">{stats.fifties || 0}</td>
                      <td className="py-4 text-center font-bold text-cric-muted">{stats.fours || 0}</td>
                      <td className="py-4 text-center font-bold text-cric-muted">{stats.sixes || 0}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ──── Bowling Tab ──── */}
        {activeTab === 'bowling' && (
          <div className="bg-cric-card rounded-xl shadow-sm border border-cric-border overflow-hidden">
            <div className="bg-cric-accent px-6 py-4">
              <h3 className="text-lg font-black text-white uppercase tracking-tight">Detailed Bowling Stats</h3>
            </div>
            <div className="p-6">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] font-black uppercase tracking-widest text-cric-muted border-b border-cric-border">
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
                  <tbody className="divide-y divide-cric-border/50">
                    <tr className="hover:bg-cric-bg">
                      <td className="py-4 font-bold text-cric-text">Overall</td>
                      <td className="py-4 text-center font-bold text-cric-muted">{stats.matches || 0}</td>
                      <td className="py-4 text-center font-bold text-cric-muted">{stats.bowlingInnings || stats.innings || 0}</td>
                      <td className="py-4 text-center font-bold text-cric-muted">{formatBalls(stats.balls)}</td>
                      <td className="py-4 text-center font-bold text-cric-muted">{stats.runsConceded || 0}</td>
                      <td className="py-4 text-center font-black text-cric-text">{stats.wickets || 0}</td>
                      <td className="py-4 text-center font-bold text-cric-muted">{stats.bestBowling || '0/0'}</td>
                      <td className="py-4 text-center font-bold text-cric-muted">{bowlingAverage}</td>
                      <td className="py-4 text-center font-bold text-cric-muted">{stats.economy || '0.00'}</td>
                      <td className="py-4 text-center font-bold text-cric-muted">{stats.balls && stats.wickets ? ((stats.balls / stats.wickets) || 0).toFixed(1) : '-'}</td>
                      <td className="py-4 text-center font-bold text-cric-muted">{stats.fourWickets || 0}</td>
                      <td className="py-4 text-center font-bold text-cric-muted">{stats.fiveWickets || 0}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ──── Fielding Tab ──── */}
        {activeTab === 'fielding' && (
          <div className="bg-cric-card rounded-xl shadow-sm border border-cric-border overflow-hidden">
            <div className="bg-cric-accent px-6 py-4">
              <h3 className="text-lg font-black text-white uppercase tracking-tight">Fielding & Keeping Stats</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] font-black uppercase tracking-widest text-cric-muted bg-cric-bg">
                    <th className="py-3 px-4">#</th>
                    <th className="py-3 px-4">Player</th>
                    <th className="py-3 px-2 text-center">Mat</th>
                    <th className="py-3 px-2 text-center">Catches</th>
                    <th className="py-3 px-2 text-center">Stumpings</th>
                    <th className="py-3 px-2 text-center">Run Outs</th>
                    <th className="py-3 px-2 text-center">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cric-border/50">
                  {stats.catches || stats.stumpings || stats.runOuts ? (
                    <tr className="hover:bg-cric-bg">
                      <td className="py-4 px-4 font-bold text-cric-muted">1</td>
                      <td className="py-4 px-4">
                        <div className="font-bold text-cric-text">{player.name}</div>
                        <div className="text-[10px] text-cric-muted">{player.team?.name || "Free Agent"}</div>
                      </td>
                      <td className="py-4 px-2 text-center font-bold text-cric-muted">{stats.matches || 0}</td>
                      <td className="py-4 px-2 text-center font-black text-cric-accent text-lg">{stats.catches || 0}</td>
                      <td className="py-4 px-2 text-center font-bold text-cric-muted">{stats.stumpings || 0}</td>
                      <td className="py-4 px-2 text-center font-bold text-cric-muted">{stats.runOuts || 0}</td>
                      <td className="py-4 px-2 text-center font-black text-cric-text">
                        {(stats.catches || 0) + (stats.stumpings || 0) + (stats.runOuts || 0)}
                      </td>
                    </tr>
                  ) : (
                    <tr>
                      <td colSpan="7" className="px-4 py-8 text-center text-cric-muted">Stats will be available after matches are played.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ──── Match Log Tab ──── */}
        {activeTab === 'matches' && (
          <div className="bg-cric-card rounded-xl shadow-sm border border-cric-border overflow-hidden">
            <div className="bg-cric-accent px-6 py-4">
              <h3 className="text-lg font-black text-white uppercase tracking-tight">Match Log</h3>
            </div>
            {recentMatches.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] font-black uppercase tracking-widest text-cric-muted bg-cric-bg">
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
                  <tbody className="divide-y divide-cric-border/50">
                    {recentMatches.map(m => {
                      const myTeamIndex = (m.teams || []).findIndex(t => t._id === player.team?._id || t === player.team);
                      const opposition = m.teams?.[myTeamIndex === 0 ? 1 : 0];
                      const myBat = (m.batting || []).find(b => b.player?._id === playerId || b.player === playerId);
                      const myBowl = (m.bowling || []).find(b => b.player?._id === playerId || b.player === playerId);
                      return (
                        <tr key={m._id} className="hover:bg-cric-bg">
                          <td className="py-3 px-4 text-[11px] font-bold text-cric-muted whitespace-nowrap">
                            {m.startAt ? new Date(m.startAt).toLocaleDateString('en-GB') : '-'}
                          </td>
                          <td className="py-3 px-3">
                            <Link to={`/match/${m._id}`} className="font-bold text-cric-text hover:text-cric-accent text-xs">
                              {opposition?.shortName || opposition?.name || 'TBD'}
                            </Link>
                          </td>
                          <td className="py-3 px-3 text-[10px] font-bold text-cric-muted uppercase">{m.tournament?.shortName || m.tournament?.name || m.matchType || '-'}</td>
                          <td className="py-3 px-2 text-center font-black text-cric-text">{myBat?.runs ?? '-'}</td>
                          <td className="py-3 px-2 text-center font-bold text-cric-muted">{myBat?.ballsFaced ?? '-'}</td>
                          <td className="py-3 px-2 text-center font-bold text-cric-muted">{myBat?.fours ?? '-'}</td>
                          <td className="py-3 px-2 text-center font-bold text-cric-muted">{myBat?.sixes ?? '-'}</td>
                          <td className="py-3 px-2 text-center font-bold text-cric-muted">{myBat?.ballsFaced ? ((myBat.runs / myBat.ballsFaced) * 100).toFixed(1) : '-'}</td>
                          <td className="py-3 px-2 text-center font-bold text-cric-muted">{myBowl?.balls ? formatBalls(myBowl.balls) : '-'}</td>
                          <td className="py-3 px-2 text-center font-black text-cric-text">{myBowl?.wickets ?? '-'}</td>
                          <td className="py-3 px-2 text-center font-bold text-cric-muted">{myBowl?.balls ? ((myBowl.runs || 0) / (myBowl.balls / 6)).toFixed(1) : '-'}</td>
                          <td className="py-3 px-2 text-center font-bold text-cric-muted">{myBat?.catches || myBowl?.catches || '-'}</td>
                          <td className="py-3 px-3 text-center">
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded ${
                              m.result?.winner === player.team?._id || m.result?.winner === player.team
                                ? 'bg-green-100 text-green-700'
                                : m.status === 'completed' ? 'bg-red-100 text-red-700' : 'bg-cric-bg text-cric-muted'
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
                <p className="text-cric-muted text-sm text-center py-8">Match history will appear here after matches are played</p>
              </div>
            )}
          </div>
        )}

        {/* ──── Info Tab ──── */}
        {activeTab === 'info' && (
          <div className="bg-cric-card rounded-xl shadow-sm border border-cric-border overflow-hidden">
            <div className="bg-cric-accent px-6 py-4">
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
  <div className="flex items-center justify-between py-2 border-b border-cric-border">
    <span className="text-[10px] font-black text-cric-muted uppercase tracking-wider">{label}</span>
    {link ? (
      <Link to={link} className="text-sm font-bold text-cric-accent hover:text-orange-600">{value}</Link>
    ) : (
      <span className="text-sm font-bold text-cric-text">{value}</span>
    )}
  </div>
);
