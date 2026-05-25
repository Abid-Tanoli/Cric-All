import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../../../services/api';

export default function TeamDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('players');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [freeAgents, setFreeAgents] = useState([]);
  const [assignPlayerId, setAssignPlayerId] = useState('');

  useEffect(() => {
    fetchTeam();
    fetchFreeAgents();
  }, [id]);

  const fetchTeam = async () => {
    try {
      const res = await api.get(`/teams/${id}`);
      setProfile(res.data.data || res.data);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const fetchFreeAgents = async () => {
    try {
      const res = await api.get('/players/free-agents');
      setFreeAgents(Array.isArray(res.data) ? res.data : []);
    } catch (e) { console.error(e); }
  };

  const handleDelete = async () => {
    try {
      await api.delete(`/teams/${id}`);
      navigate('/admin/teams');
    } catch (e) { console.error(e); }
  };

  const assignPlayer = async () => {
    if (!assignPlayerId) return;
    try {
      await api.post(`/teams/${id}/players`, { playerIds: [assignPlayerId] });
      setAssignPlayerId('');
      fetchTeam();
      fetchFreeAgents();
    } catch (e) { console.error(e); }
  };

  const removePlayer = async (playerId) => {
    try {
      await api.delete(`/teams/${id}/players`, { data: { playerIds: [playerId] } });
      fetchTeam();
      fetchFreeAgents();
    } catch (e) { console.error(e); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#031d44]" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="text-center py-20">
        <p className="text-red-600 font-bold text-xl">Team not found</p>
        <button onClick={() => navigate('/admin/teams')} className="mt-4 bg-[#031d44] text-white px-6 py-3 rounded-xl font-black text-xs uppercase tracking-widest">
          Go Back
        </button>
      </div>
    );
  }

  const { team, ranking, recentMatches, branches, playerRankings } = profile;
  const players = team.players || [];
  const getRoleBadge = (role) => {
    const colors = {
      Batsman: 'bg-orange-100 text-orange-800',
      Bowler: 'bg-green-100 text-green-800',
      'All-Rounder': 'bg-purple-100 text-purple-800',
      'Wicket-Keeper': 'bg-blue-100 text-blue-800',
    };
    return colors[role] || 'bg-slate-100 text-slate-800';
  };

  const tabs = [
    { key: 'players', label: 'Players', icon: '👥' },
    { key: 'matches', label: 'Matches', icon: '🏏' },
    { key: 'rankings', label: 'Rankings', icon: '📊' },
    { key: 'location', label: 'Location', icon: '📍' },
    { key: 'branches', label: 'Branches', icon: '🌿' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-6 lg:p-10">
      {/* Header Card */}
      <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden mb-8">
        <div className="h-32 bg-gradient-to-r from-[#031d44] to-blue-900 relative">
          <button
            onClick={() => navigate('/admin/teams')}
            className="absolute top-4 left-4 text-white/80 hover:text-white font-bold text-sm"
          >
            ← Back to Teams
          </button>
        </div>
        <div className="px-6 pb-6 -mt-16">
          <div className="flex flex-col md:flex-row md:items-end gap-6">
            {team.logo ? (
              <img src={team.logo} alt={team.name} className="w-32 h-32 rounded-2xl border-4 border-white shadow-lg object-cover bg-white" />
            ) : (
              <div className="w-32 h-32 rounded-2xl border-4 border-white shadow-lg bg-[#031d44] flex items-center justify-center text-white text-4xl font-black">
                {team.shortName?.toUpperCase() || team.name?.charAt(0)}
              </div>
            )}
            <div className="flex-1">
              <h1 className="text-3xl lg:text-4xl font-black text-[#031d44]">{team.name}</h1>
              <div className="flex flex-wrap gap-2 mt-2">
                <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-bold">
                  {team.category || 'Uncategorized'}
                </span>
                {team.organization && (
                  <span className="px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-xs font-bold">
                    {team.organization}
                  </span>
                )}
                {team.branchName && (
                  <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-bold">
                    {team.branchName}
                  </span>
                )}
              </div>
              {team.address?.city && (
                <p className="text-slate-500 text-sm mt-1">{team.address.city}{team.address.country ? `, ${team.address.country}` : ''}</p>
              )}
            </div>
            <div className="flex gap-2">
              <Link
                to={`/admin/teams/${id}/edit`}
                className="bg-[#031d44] hover:bg-slate-800 text-white font-black text-xs uppercase tracking-widest rounded-xl px-6 py-3"
              >
                Edit
              </Link>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="bg-red-600 hover:bg-red-700 text-white font-black text-xs uppercase tracking-widest rounded-xl px-6 py-3"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-8">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 text-center">
          <p className="text-2xl font-black text-[#031d44]">{players.length}</p>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Players</p>
        </div>
        {ranking && (
          <>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 text-center">
              <p className="text-2xl font-black text-green-600">{ranking.matchesPlayed || 0}</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Played</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 text-center">
              <p className="text-2xl font-black text-blue-600">{ranking.matchesWon || 0}</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Won</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 text-center">
              <p className="text-2xl font-black text-amber-600">{ranking.points || 0}</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Points</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 text-center">
              <p className="text-2xl font-black text-purple-600">{ranking.overallRank ? `#${ranking.overallRank}` : '-'}</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Overall Rank</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 text-center">
              <p className="text-2xl font-black text-indigo-600">{ranking.categoryRank ? `#${ranking.categoryRank}` : '-'}</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Category Rank</p>
            </div>
          </>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 mb-6 gap-1 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-6 py-3 font-bold text-xs uppercase tracking-wider whitespace-nowrap transition-all ${
              activeTab === tab.key
                ? 'bg-[#031d44] text-white rounded-t-xl'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>{tab.icon}</span> {tab.label}
          </button>
        ))}
      </div>

      {/* Tab: Players */}
      {activeTab === 'players' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-[#031d44]">Squad ({players.length})</h2>
              <div className="flex gap-2">
                <select
                  value={assignPlayerId}
                  onChange={(e) => setAssignPlayerId(e.target.value)}
                  className="border border-slate-300 rounded-xl px-4 py-2 text-sm"
                >
                  <option value="">Select player...</option>
                  {freeAgents.map(p => (
                    <option key={p._id} value={p._id}>{p.name}</option>
                  ))}
                </select>
                <button
                  onClick={assignPlayer}
                  className="bg-green-600 hover:bg-green-700 text-white font-black text-xs uppercase tracking-widest rounded-xl px-4 py-2"
                >
                  + Add
                </button>
              </div>
            </div>

            {players.length === 0 ? (
              <p className="text-slate-400 text-center py-8">No players in squad yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#031d44] text-white">
                      <th className="px-4 py-3 text-left">#</th>
                      <th className="px-4 py-3 text-left">Player</th>
                      <th className="px-4 py-3 text-left">Role</th>
                      <th className="px-4 py-3 text-center">Runs</th>
                      <th className="px-4 py-3 text-center">Wkts</th>
                      <th className="px-4 py-3 text-center">Mat</th>
                      <th className="px-4 py-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {players.map((player, idx) => {
                      const pr = playerRankings?.find(r => r.player?._id === player._id);
                      return (
                        <tr key={player._id} className="border-b border-slate-200 hover:bg-slate-50">
                          <td className="px-4 py-4 font-bold text-slate-500">{idx + 1}</td>
                          <td className="px-4 py-4">
                            <Link to={`/admin/players/${player._id}`} className="font-bold text-[#031d44] hover:underline">
                              {player.name}
                            </Link>
                            {pr?.teamBattingRank && (
                              <span className="ml-2 text-[10px] font-bold text-purple-600">Rank #{pr.teamBattingRank}</span>
                            )}
                          </td>
                          <td className="px-4 py-4">
                            <span className={`px-2 py-1 rounded-full text-xs font-bold ${getRoleBadge(player.playingRole)}`}>
                              {player.playingRole || player.role || 'Player'}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-center font-bold">{player.stats?.runs || 0}</td>
                          <td className="px-4 py-4 text-center font-bold">{player.stats?.wickets || 0}</td>
                          <td className="px-4 py-4 text-center">{player.stats?.matches || 0}</td>
                          <td className="px-4 py-4 text-center">
                            <button
                              onClick={() => removePlayer(player._id)}
                              className="text-red-600 hover:text-red-800 font-bold text-xs uppercase tracking-wider"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Free Agents Section */}
          {freeAgents.length > 0 && (
            <div className="bg-amber-50 rounded-2xl border border-amber-200 p-6">
              <h3 className="font-black text-xs uppercase tracking-widest text-amber-800 mb-3">
                🔓 Free Agents Available ({freeAgents.length})
              </h3>
              <div className="flex flex-wrap gap-2">
                {freeAgents.slice(0, 10).map(p => (
                  <button
                    key={p._id}
                    onClick={() => {
                      setAssignPlayerId(p._id);
                      setTimeout(assignPlayer, 100);
                    }}
                    className="bg-white hover:bg-amber-100 border border-amber-300 rounded-xl px-4 py-2 text-sm font-bold text-slate-700 transition-all"
                  >
                    + {p.name}
                  </button>
                ))}
                {freeAgents.length > 10 && (
                  <span className="text-xs text-slate-400 self-center">+{freeAgents.length - 10} more</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Matches */}
      {activeTab === 'matches' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <h2 className="text-xl font-bold text-[#031d44] mb-4">Recent Matches</h2>
          {(!recentMatches || recentMatches.length === 0) ? (
            <p className="text-slate-400 text-center py-8">No matches recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {recentMatches.map(match => (
                <div key={match._id} className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3 border border-slate-200">
                  <div>
                    <p className="font-bold text-slate-800">{match.title}</p>
                    <p className="text-xs text-slate-500">{new Date(match.startAt).toLocaleDateString()}</p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                    match.result?.winner?.toString() === id ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {match.result?.winner?.toString() === id ? 'Won' : 'Lost'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Rankings */}
      {activeTab === 'rankings' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <h2 className="text-xl font-bold text-[#031d44] mb-4">Team Rankings & Stats</h2>
          {ranking ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <div className="bg-slate-50 rounded-xl p-4 text-center">
                <p className="text-3xl font-black text-[#031d44]">{ranking.matchesPlayed || 0}</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Played</p>
              </div>
              <div className="bg-green-50 rounded-xl p-4 text-center">
                <p className="text-3xl font-black text-green-600">{ranking.matchesWon || 0}</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Won</p>
              </div>
              <div className="bg-red-50 rounded-xl p-4 text-center">
                <p className="text-3xl font-black text-red-600">{ranking.matchesLost || 0}</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Lost</p>
              </div>
              <div className="bg-amber-50 rounded-xl p-4 text-center">
                <p className="text-3xl font-black text-amber-600">{ranking.points || 0}</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Points</p>
              </div>
              <div className="bg-purple-50 rounded-xl p-4 text-center">
                <p className="text-3xl font-black text-purple-600">{ranking.rating ? ranking.rating.toFixed(2) : '0'}</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Rating</p>
              </div>
            </div>
          ) : (
            <p className="text-slate-400 text-center py-8">Rankings not computed yet.</p>
          )}
        </div>
      )}

      {/* Tab: Location */}
      {activeTab === 'location' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <h2 className="text-xl font-bold text-[#031d44] mb-4">📍 Location</h2>
          {team.latitude && team.longitude ? (
            <div>
              <div className="h-64 rounded-xl overflow-hidden mb-4">
                <iframe
                  width="100%"
                  height="100%"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  src={`https://www.google.com/maps?q=${team.latitude},${team.longitude}&z=15&output=embed`}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Full Address</p>
                  <p className="font-bold text-slate-800">{team.fullAddress || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Coordinates</p>
                  <p className="font-bold text-slate-800">{team.latitude}, {team.longitude}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">City</p>
                  <p className="font-bold text-slate-800">{team.address?.city || team.city || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Area</p>
                  <p className="font-bold text-slate-800">{team.area || 'N/A'}</p>
                </div>
              </div>
              {team.googleMapsUrl && (
                <a
                  href={team.googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block mt-4 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-widest rounded-xl px-6 py-3"
                >
                  Open in Google Maps ↗
                </a>
              )}
            </div>
          ) : (
            <p className="text-slate-400 text-center py-8">No location data available. Edit the team to add location.</p>
          )}
        </div>
      )}

      {/* Tab: Branches */}
      {activeTab === 'branches' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <h2 className="text-xl font-bold text-[#031d44] mb-4">
            🌿 {team.organization || 'Organization'} Branches
          </h2>
          {branches && branches.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {branches.map(branch => (
                <Link
                  key={branch._id}
                  to={`/admin/teams/${branch._id}`}
                  className="bg-slate-50 hover:bg-blue-50 border border-slate-200 rounded-xl p-4 transition-all"
                >
                  <p className="font-bold text-[#031d44]">{branch.name}</p>
                  <p className="text-xs text-slate-500">{branch.branchName}{branch.city ? `, ${branch.city}` : ''}</p>
                  <p className="text-xs text-slate-400 mt-1">{branch.players?.length || 0} players</p>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-slate-400 text-center py-8">No other branches found.</p>
          )}
        </div>
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 text-center">
            <h2 className="text-2xl font-black text-[#031d44] mb-4">Delete Team?</h2>
            <p className="text-slate-500 mb-6">
              Are you sure you want to delete <strong>{team.name}</strong>? All player assignments will be removed.
            </p>
            <div className="flex gap-3">
              <button onClick={handleDelete} className="bg-red-600 hover:bg-red-700 text-white font-black text-xs uppercase tracking-widest rounded-xl px-6 py-3 flex-1">
                Delete
              </button>
              <button onClick={() => setShowDeleteConfirm(false)} className="bg-slate-200 hover:bg-slate-300 text-[#031d44] font-black text-xs uppercase tracking-widest rounded-xl px-6 py-3 flex-1">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
