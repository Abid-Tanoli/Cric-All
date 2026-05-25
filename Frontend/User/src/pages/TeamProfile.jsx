import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import Header from '../components/Header';
import { api } from '../services/api';
import { getStoredUser, logout as doLogout } from './auth/auth';

const idOf = (v) => v?._id || v?.id || v;

export default function TeamProfile() {
  const { id } = useParams();
  const [profile, setProfile] = useState(null);
  const [orgChain, setOrgChain] = useState([]);
  const [loading, setLoading] = useState(true);
  const [authUser, setAuthUser] = useState(null);
  const [activeTab, setActiveTab] = useState('about');

  useEffect(() => {
    setAuthUser(getStoredUser());
    fetchTeam();
  }, [id]);

  const fetchTeam = async () => {
    try {
      const res = await api.get(`/teams/${id}`);
      const data = res.data.data || res.data;
      setProfile(data);
      const team = data.team || data;
      const orgId = idOf(team.organizationRef);
      if (orgId) {
        try {
          const chainRes = await api.get(`/organizations/${orgId}/chain`);
          setOrgChain(chainRes.data?.data || chainRes.data?.chain || []);
        } catch {}
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const handleLogout = () => { doLogout(); setAuthUser(null); };

  const tabs = [
    { key: 'about', label: 'About' },
    { key: 'squad', label: 'Squad' },
    { key: 'stats', label: 'Stats' },
    { key: 'matches', label: 'Matches' },
    { key: 'branches', label: 'Branches' },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400 font-black uppercase tracking-widest text-xs">Loading Team...</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center">
        <p className="text-red-600 font-bold text-xl">Team not found</p>
      </div>
    );
  }

  const { team, ranking, recentMatches, branches } = profile;
  const players = team.players || [];
  const getRoleColor = (role) => {
    const colors = {
      Batsman: 'bg-orange-100 text-orange-800 border-orange-200',
      Bowler: 'bg-green-100 text-green-800 border-green-200',
      'All-Rounder': 'bg-purple-100 text-purple-800 border-purple-200',
      'Wicket-Keeper': 'bg-blue-100 text-blue-800 border-blue-200',
    };
    return colors[role] || 'bg-slate-100 text-slate-800 border-slate-200';
  };

  const renderFormGuide = (form) => {
    if (!form) return null;
    return (
      <div className="flex gap-1">
        {form.split('').map((ch, i) => (
          <span
            key={i}
            className={`w-8 h-8 rounded-full text-xs font-bold flex items-center justify-center ${
              ch === 'W' ? 'bg-green-500 text-white' :
              ch === 'L' ? 'bg-red-500 text-white' :
              ch === 'D' ? 'bg-blue-500 text-white' :
              'bg-slate-300 text-white'
            }`}
          >
            {ch}
          </span>
        ))}
      </div>
    );
  };

  const primaryColor = team.primaryColor || '#031d44';
  const secondaryColor = team.secondaryColor || '#1e3a5f';

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans">
      <Header user={authUser} onShowLogin={() => {}} onShowRegister={() => {}} onLogout={handleLogout} />

      <div className="bg-[#031d44] text-white py-12 relative overflow-hidden" style={{backgroundColor: primaryColor}}>
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full -mr-48 -mt-48 blur-3xl" />
        <div className="max-w-7xl mx-auto px-4 relative">
          <Link to="/teams" className="text-blue-300 hover:text-white text-sm font-bold mb-4 inline-block">
            ← Back to Teams
          </Link>

          {/* Organization Chain */}
          {orgChain.length > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-blue-200/70 uppercase tracking-wider mb-3 flex-wrap">
              {orgChain.map((org, idx) => (
                <React.Fragment key={org._id}>
                  {idx > 0 && <span className="text-blue-300/40">→</span>}
                  <span>{org.name}</span>
                </React.Fragment>
              ))}
              <span className="text-blue-300/40">→</span>
              <span className="text-white">{team.shortName || team.name}</span>
            </div>
          )}

          <div className="flex items-center gap-6 mt-4">
            {team.logo ? (
              <img src={team.logo} alt={team.name} className="w-24 h-24 rounded-2xl border-4 border-white/20 object-cover bg-white" />
            ) : (
              <div className="w-24 h-24 rounded-2xl border-4 border-white/20 bg-blue-800 flex items-center justify-center text-4xl font-black">
                {team.shortName?.charAt(0) || team.name?.charAt(0)}
              </div>
            )}
            <div>
              <h1 className="text-4xl font-black uppercase tracking-tighter italic">{team.name}</h1>
              <div className="flex flex-wrap gap-2 mt-2">
                {team.category && (
                  <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-bold">{team.category}</span>
                )}
                {team.organization && (
                  <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-bold">{team.organization}</span>
                )}
                {team.branchName && (
                  <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-bold">{team.branchName}</span>
                )}
                {team.incubationGroup && (
                  <span className="px-3 py-1 bg-amber-400/20 text-amber-300 rounded-full text-xs font-bold">Incubation</span>
                )}
              </div>
              <p className="text-blue-200/60 text-sm mt-1">
                {team.address?.city}{team.address?.country ? `, ${team.address.country}` : ''}
                {team.homeGround ? ` • ${team.homeGround}` : ''}
                {team.establishedYear ? ` • Est. ${team.establishedYear}` : ''}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="max-w-7xl mx-auto px-4 -mt-6 relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 text-center">
            <p className="text-2xl font-black text-[#031d44]">{players.length}</p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Players</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 text-center">
            <p className="text-2xl font-black text-green-600">{ranking?.matchesPlayed || 0}</p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Played</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 text-center">
            <p className="text-2xl font-black text-blue-600">{ranking?.matchesWon || 0}</p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Won</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 text-center">
            <p className="text-2xl font-black text-amber-600">{ranking?.points || 0}</p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Points</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 text-center">
            <p className="text-2xl font-black text-purple-600">{ranking?.netRunRate?.toFixed(2) || '0.00'}</p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">NRR</p>
          </div>
        </div>
      </div>

      {/* Form Guide */}
      {ranking?.form && (
        <div className="max-w-7xl mx-auto px-4 mt-6">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 flex items-center gap-4">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Form Guide:</span>
            {renderFormGuide(ranking.form)}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-4 mt-8">
        <div className="flex border-b border-slate-200 gap-1 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-6 py-3 font-bold text-xs uppercase tracking-wider whitespace-nowrap transition-all ${
                activeTab === tab.key
                  ? 'bg-[#031d44] text-white rounded-t-xl'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">

        {/* ──── About Tab ──── */}
        {activeTab === 'about' && (
          <div className="space-y-6">

            {/* Organization Chain Card */}
            {orgChain.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Organization Hierarchy</h3>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {orgChain.map((org, idx) => (
                    <React.Fragment key={org._id}>
                      <div className="bg-slate-100 rounded-lg px-3 py-1.5 font-bold text-slate-700 text-xs">
                        {org.name}
                        {org.level && <span className="text-slate-400 ml-1">({org.level})</span>}
                      </div>
                      {idx < orgChain.length - 1 && <span className="text-slate-300 text-lg">→</span>}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}

            {/* Team Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Contact Info */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Contact</h3>
                <div className="space-y-3 text-sm">
                  {team.contactPhone && (
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">📞</span>
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Phone</p>
                        <p className="font-semibold text-slate-700">{team.contactPhone}</p>
                      </div>
                    </div>
                  )}
                  {team.contactEmail && (
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">✉️</span>
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Email</p>
                        <p className="font-semibold text-slate-700">{team.contactEmail}</p>
                      </div>
                    </div>
                  )}
                  {team.website && (
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">🌐</span>
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Website</p>
                        <a href={team.website} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-600 hover:underline">{team.website}</a>
                      </div>
                    </div>
                  )}
                  {!team.contactPhone && !team.contactEmail && !team.website && (
                    <p className="text-slate-400 text-center py-4">No contact information available</p>
                  )}
                </div>
              </div>

              {/* Social & Colors */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Social & Branding</h3>
                <div className="space-y-3">
                  {team.primaryColor && (
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{backgroundColor: primaryColor}}>
                        <span className="text-white text-xs font-black">C</span>
                      </span>
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Primary Color</p>
                        <p className="font-semibold text-slate-700 text-xs font-mono">{primaryColor}</p>
                      </div>
                    </div>
                  )}
                  {socialButtons(team)}
                </div>
              </div>
            </div>

            {/* Roles: Admin, Scorer, Commentator */}
            {(team.adminRef || team.scorerRef || team.commentatorRef) && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Team Personnel</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {team.adminRef && (
                    <div className="bg-purple-50 rounded-xl p-4 border border-purple-200">
                      <p className="text-[10px] font-black text-purple-500 uppercase tracking-wider mb-1">🛡️ Admin</p>
                      <p className="font-bold text-slate-800">{typeof team.adminRef === 'object' ? team.adminRef.name || team.adminRef.email : team.adminRef}</p>
                    </div>
                  )}
                  {team.scorerRef && (
                    <div className="bg-green-50 rounded-xl p-4 border border-green-200">
                      <p className="text-[10px] font-black text-green-500 uppercase tracking-wider mb-1">📊 Scorer</p>
                      <p className="font-bold text-slate-800">{typeof team.scorerRef === 'object' ? team.scorerRef.name || team.scorerRef.email : team.scorerRef}</p>
                    </div>
                  )}
                  {team.commentatorRef && (
                    <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
                      <p className="text-[10px] font-black text-amber-500 uppercase tracking-wider mb-1">🎙️ Commentator</p>
                      <p className="font-bold text-slate-800">{typeof team.commentatorRef === 'object' ? team.commentatorRef.name || team.commentatorRef.email : team.commentatorRef}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Description */}
            {team.description && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">About</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{team.description}</p>
              </div>
            )}

            {/* Home Ground / Venue */}
            {team.fullAddress && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">🏟️ Home Ground</h3>
                <p className="font-bold text-slate-700">{team.fullAddress}</p>
                {team.latitude && team.longitude && (
                  <div className="mt-3 h-48 rounded-xl overflow-hidden">
                    <iframe width="100%" height="100%" loading="lazy" referrerPolicy="no-referrer-when-downgrade"
                      src={`https://www.google.com/maps?q=${team.latitude},${team.longitude}&z=15&output=embed`} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ──── Squad Tab ──── */}
        {activeTab === 'squad' && (
          <div>
            <h2 className="text-2xl font-black text-[#031d44] mb-6">Squad ({players.length})</h2>
            {players.length === 0 ? (
              <p className="text-slate-400 text-center py-12">No players in this team yet.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {players.map((player, idx) => (
                  <Link
                    key={player._id}
                    to={`/players/${player._id}`}
                    className="bg-white rounded-2xl border border-slate-100 p-5 hover:shadow-lg transition-all group"
                  >
                    <div className="flex items-center gap-4 mb-3">
                      <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[#031d44] to-blue-900 flex items-center justify-center text-white font-black text-lg group-hover:scale-110 transition-transform">
                        {player.imageUrl ? (
                          <img src={player.imageUrl} alt="" className="w-full h-full object-cover rounded-xl" />
                        ) : (
                          player.name?.charAt(0)
                        )}
                      </div>
                      <div>
                        <h3 className="font-bold text-[#031d44] group-hover:text-blue-600 transition-colors">{player.name}</h3>
                        <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${getRoleColor(player.playingRole)}`}>
                          {player.playingRole || player.role || 'Player'}
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <p className="text-lg font-black text-slate-800">{player.stats?.runs || 0}</p>
                        <p className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">Runs</p>
                      </div>
                      <div>
                        <p className="text-lg font-black text-slate-800">{player.stats?.wickets || 0}</p>
                        <p className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">Wkts</p>
                      </div>
                      <div>
                        <p className="text-lg font-black text-slate-800">{player.stats?.matches || 0}</p>
                        <p className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">Mat</p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ──── Stats Tab ──── */}
        {activeTab === 'stats' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8">
            <h2 className="text-2xl font-black text-[#031d44] mb-6">Team Statistics</h2>
            {ranking ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
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
                    <p className="text-3xl font-black text-purple-600">{ranking.overallRank ? `#${ranking.overallRank}` : '-'}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Overall Rank</p>
                  </div>
                  <div className="bg-indigo-50 rounded-xl p-4 text-center">
                    <p className="text-3xl font-black text-indigo-600">{ranking.categoryRank ? `#${ranking.categoryRank}` : '-'}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Category Rank</p>
                  </div>
                </div>
                {ranking.form && (
                  <div className="mt-6 flex items-center gap-4">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Form Guide:</span>
                    {renderFormGuide(ranking.form)}
                  </div>
                )}
              </>
            ) : (
              <p className="text-slate-400 text-center py-8">No statistics available yet.</p>
            )}
          </div>
        )}

        {/* ──── Matches Tab ──── */}
        {activeTab === 'matches' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8">
            <h2 className="text-2xl font-black text-[#031d44] mb-6">Recent Matches</h2>
            {(!recentMatches || recentMatches.length === 0) ? (
              <p className="text-slate-400 text-center py-8">No matches recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {recentMatches.map(match => (
                  <Link
                    key={match._id}
                    to={`/match/${match._id}`}
                    className="flex items-center justify-between bg-slate-50 rounded-xl px-6 py-4 border border-slate-200 hover:border-blue-300 transition-all"
                  >
                    <div>
                      <p className="font-bold text-slate-800">{match.title}</p>
                      <p className="text-xs text-slate-500">
                        {match.teams?.map(t => t.name).join(' vs ')} • {new Date(match.startAt).toLocaleDateString()}
                      </p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                      match.result?.winner?.toString() === id ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {match.result?.winner?.toString() === id ? 'Won' : 'Lost'}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ──── Branches Tab ──── */}
        {activeTab === 'branches' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8">
            <h2 className="text-2xl font-black text-[#031d44] mb-6">
              🌿 {team.organization || 'Organization'} Branches
            </h2>
            {branches && branches.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {branches.map(branch => (
                  <Link
                    key={branch._id}
                    to={`/teams/${branch._id}`}
                    className="bg-slate-50 hover:bg-blue-50 border border-slate-200 rounded-xl p-5 transition-all"
                  >
                    <p className="font-bold text-[#031d44] text-lg">{branch.name}</p>
                    <p className="text-sm text-slate-500">{branch.branchName}{branch.city ? `, ${branch.city}` : ''}</p>
                    <p className="text-xs text-slate-400 mt-2">{branch.players?.length || 0} players</p>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-slate-400 text-center py-8">No other branches for this organization.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const socialButtons = (team) => (
  <div className="flex flex-wrap gap-2 mt-2">
    {team.facebookUrl && <SocialBtn url={team.facebookUrl} label="Facebook" color="#1877F2" icon="f" />}
    {team.instagramUrl && <SocialBtn url={team.instagramUrl} label="Instagram" color="#E4405F" icon="ig" />}
    {team.twitterUrl && <SocialBtn url={team.twitterUrl} label="Twitter" color="#000000" icon="X" />}
    {team.youtubeUrl && <SocialBtn url={team.youtubeUrl} label="YouTube" color="#FF0000" icon="▶" />}
    {!team.facebookUrl && !team.instagramUrl && !team.twitterUrl && !team.youtubeUrl && (
      <p className="text-slate-400 text-xs">No social links available</p>
    )}
  </div>
);

const SocialBtn = ({ url, label, color, icon }) => (
  <a
    href={url}
    target="_blank"
    rel="noopener noreferrer"
    title={label}
    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-[11px] font-black uppercase tracking-wider transition-all hover:scale-105"
    style={{ backgroundColor: color }}
  >
    {icon} {label}
  </a>
);
