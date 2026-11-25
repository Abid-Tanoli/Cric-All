import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../services/api';
import SafeImage from '../../../Shared/components/SafeImage.jsx';
import ShareMenu from '../community/ShareMenu';
import { useCommunityConfig } from '../community/CommunityConfigContext';
import PostsTab from '../community/PostsTab';
import BattingPositionBadge from '@shared/components/BattingPositionBadge';
import { locationLine } from '../../../Shared/utils/locationDisplay.js';
import { orgTypeIcon, orgTypeLabel, teamRoleLabel, verificationBadge } from '../../../Shared/orgTypes.js';
import SquadManager from '../components/SquadManager';
import { getMyOrgAccess, removeOrgTeamPlayers } from '../services/organizationApi';
import { PERMISSIONS, can } from '../lib/orgUi';
import { useStoredUser } from './auth/auth';
import {
  EMPTY_PERFORMERS,
  PerformerCard,
  TeamMatchRow,
  formatDecimal,
} from '../components/TeamOverviewCards';

const idOf = (v) => v?._id || v?.id || v;

export default function TeamProfile() {
  const { id } = useParams();
  const [profile, setProfile] = useState(null);
  const [orgChain, setOrgChain] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('about');
  // The squad actions are shown only when the organization's own access
  // endpoint says this account may manage players. The server re-checks every
  // write, so this is a display decision, not the authorization.
  const [orgAccess, setOrgAccess] = useState(null);
  const [removingId, setRemovingId] = useState(null);
  const [squadError, setSquadError] = useState('');
  // Bumped after a removal so the "Add existing" picker re-reads its list — the
  // player just removed is attachable again, and one added twice must not be.
  const [squadRefresh, setSquadRefresh] = useState(0);
  const storedUser = useStoredUser();
  const { enabled: communityEnabled } = useCommunityConfig();

  useEffect(() => {
    fetchTeam();
  }, [id]);

  // Optional share polish: the tab title and description use the team name once
  // it has loaded, so a shared link reads "Crescent XI" rather than the generic
  // directory title the router set on the way in.
  useEffect(() => {
    const loadedTeam = profile?.team;
    if (!loadedTeam?.name) return;
    document.title = `${loadedTeam.name} | CricAll`;
    const description = document.querySelector('meta[name="description"]');
    if (description) {
      description.setAttribute(
        'content',
        `Fixtures, results, squad and top performers for ${loadedTeam.name}, a cricket team on CricAll.`,
      );
    }
  }, [profile]);

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
        } catch {
          // The org chain is decorative: the team page still renders without it.
        }
        if (storedUser) {
          try {
            setOrgAccess(await getMyOrgAccess(orgId));
          } catch {
            // Not a member, signed out, or a plain visitor: no squad actions.
            setOrgAccess(null);
          }
        }
      } else {
        setOrgAccess(null);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  

  const tabs = [
    { key: 'about', label: 'About' },
    { key: 'squad', label: 'Squad' },
    { key: 'stats', label: 'Stats' },
    { key: 'matches', label: 'Matches' },
    { key: 'branches', label: 'Branches' },
    ...(communityEnabled ? [{ key: 'posts', label: 'Posts' }] : []),
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-cric-bg flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-cric-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-cric-muted font-black uppercase tracking-widest text-xs">Loading Team...</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-cric-bg flex items-center justify-center">
        <p className="text-red-600 font-bold text-xl">Team not found</p>
      </div>
    );
  }

  // PR 7: the page now reads the overview blocks the backend returns alongside
  // the squad. Defaulted so an older cached response still renders.
  const { team, ranking, branches } = profile;
  const recentMatches = profile.recentMatches || [];
  const upcomingMatches = profile.upcomingMatches || [];
  const liveMatches = profile.liveMatches || [];
  const topPerformers = profile.topPerformers || EMPTY_PERFORMERS;
  const players = team.players || [];
  const teamOrgId = idOf(team.organizationRef);
  const canManageSquad = Boolean(teamOrgId) && can(orgAccess?.permissions || [], PERMISSIONS.MANAGE_PLAYERS);

  const handleRemoveFromSquad = async (player) => {
    if (!teamOrgId) return;
    setRemovingId(player._id);
    setSquadError('');
    try {
      await removeOrgTeamPlayers(teamOrgId, id, [player._id]);
      setSquadRefresh((value) => value + 1);
      await fetchTeam();
    } catch (error) {
      setSquadError(error.message || 'Could not remove that player from the squad');
    } finally {
      setRemovingId(null);
    }
  };
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

  return (
    <div className="min-h-screen bg-cric-bg text-cric-text font-sans">

      <div className="bg-cric-accent text-white py-12 relative overflow-hidden" style={{backgroundColor: primaryColor}}>
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full -mr-48 -mt-48 blur-3xl" />
        <div className="max-w-7xl mx-auto px-4 relative">
          <div className="flex items-center justify-between mb-4">
            <Link to="/teams" className="text-blue-300 hover:text-white text-sm font-bold inline-block">
              ← Back to Teams
            </Link>
            <ShareMenu kind="team" id={id} title={`${team.name} on CricAll`} />
          </div>

          {/* Organization Chain */}
          {orgChain.length > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-blue-200/70 uppercase tracking-wider mb-3 flex-wrap">
              {orgChain.map((org, idx) => (
                <React.Fragment key={org._id}>
                  {idx > 0 && <span className="text-blue-300/40">→</span>}
                  {org.slug ? (
                    <Link
                      to={`/club/${org.slug}`}
                      className="text-blue-200/80 hover:text-white hover:underline"
                    >
                      {org.name}
                    </Link>
                  ) : (
                    <span>{org.name}</span>
                  )}
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
                <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-bold">
                  {teamRoleLabel(team.teamRole)}
                </span>
                {team.category && (
                  <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-bold">{team.category}</span>
                )}
                {team.organization && (
                  <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-bold">{team.organization}</span>
                )}
                {team.organizationRef ? (
                  <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-bold">
                    {orgTypeIcon(team.organizationRef)} {orgTypeLabel(team.organizationRef)}
                  </span>
                ) : null}
                {team.organizationRef?.verificationStatus === 'verified' ? (
                  <span className={`px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider ${verificationBadge('verified').className}`}>
                    ✓ Verified
                  </span>
                ) : null}
                {team.branchName && (
                  <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-bold">{team.branchName}</span>
                )}
                {team.incubationGroup && (
                  <span className="px-3 py-1 bg-amber-400/20 text-amber-300 rounded-full text-xs font-bold">Incubation</span>
                )}
              </div>
              <p className="text-blue-200/60 text-sm mt-1">
                {team.privacy?.location !== 'hidden' && (
                  <>
                    {locationLine(team.locationLabels, [team.address?.city, team.address?.country].filter(Boolean).join(', '))}
                    {team.homeGround ? ` • ${team.homeGround}` : ''}
                  </>
                )}
                {team.establishedYear ? ` • Est. ${team.establishedYear}` : ''}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="max-w-7xl mx-auto px-4 -mt-6 relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-cric-card rounded-2xl shadow-sm border border-slate-100 p-4 text-center">
            <p className="text-2xl font-black text-cric-accent">{players.length}</p>
            <p className="text-[10px] font-bold text-cric-muted uppercase tracking-wider">Players</p>
          </div>
          <div className="bg-cric-card rounded-2xl shadow-sm border border-slate-100 p-4 text-center">
            <p className="text-2xl font-black text-green-600">{ranking?.matchesPlayed || 0}</p>
            <p className="text-[10px] font-bold text-cric-muted uppercase tracking-wider">Played</p>
          </div>
          <div className="bg-cric-card rounded-2xl shadow-sm border border-slate-100 p-4 text-center">
            <p className="text-2xl font-black text-cric-accent">{ranking?.matchesWon || 0}</p>
            <p className="text-[10px] font-bold text-cric-muted uppercase tracking-wider">Won</p>
          </div>
          <div className="bg-cric-card rounded-2xl shadow-sm border border-slate-100 p-4 text-center">
            <p className="text-2xl font-black text-amber-600">{ranking?.points || 0}</p>
            <p className="text-[10px] font-bold text-cric-muted uppercase tracking-wider">Points</p>
          </div>
          <div className="bg-cric-card rounded-2xl shadow-sm border border-slate-100 p-4 text-center">
            <p className="text-2xl font-black text-purple-600">{ranking?.netRunRate?.toFixed(2) || '0.00'}</p>
            <p className="text-[10px] font-bold text-cric-muted uppercase tracking-wider">NRR</p>
          </div>
        </div>
      </div>

      {/* Form Guide */}
      {ranking?.form && (
        <div className="max-w-7xl mx-auto px-4 mt-6">
          <div className="bg-cric-card rounded-2xl shadow-sm border border-slate-100 p-4 flex items-center gap-4">
            <span className="text-[10px] font-black text-cric-muted uppercase tracking-widest">Form Guide:</span>
            {renderFormGuide(ranking.form)}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-4 mt-8">
        <div className="flex border-b border-cric-border gap-1 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-6 py-3 font-bold text-xs uppercase tracking-wider whitespace-nowrap transition-all ${
                activeTab === tab.key
                  ? 'bg-cric-accent text-white rounded-t-xl'
                  : 'text-cric-muted hover:text-cric-text'
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

            {/* ── Overview (PR 7): live, upcoming, recent results, performers ── */}
            <div className="space-y-6">
              {liveMatches.length > 0 && (
                <section
                  aria-labelledby="team-live-heading"
                  className="rounded-2xl border border-red-200 bg-red-50 p-5"
                >
                  <h3 id="team-live-heading" className="mb-4 text-xs font-black uppercase tracking-widest text-red-700">
                    Live now
                  </h3>
                  <div className="space-y-3">
                    {liveMatches.map((match) => (
                      <TeamMatchRow key={match._id} match={match} teamId={id} live />
                    ))}
                  </div>
                </section>
              )}

              <section className="bg-cric-card rounded-2xl shadow-sm border border-slate-100 p-5">
                <h3 className="mb-4 text-xs font-black text-cric-muted uppercase tracking-widest">Upcoming matches</h3>
                {upcomingMatches.length === 0 ? (
                  <p className="py-2 text-sm font-semibold text-cric-muted">No upcoming matches yet.</p>
                ) : (
                  <div className="space-y-3">
                    {upcomingMatches.map((match) => (
                      <TeamMatchRow key={match._id} match={match} teamId={id} />
                    ))}
                  </div>
                )}
              </section>

              <section className="bg-cric-card rounded-2xl shadow-sm border border-slate-100 p-5">
                <h3 className="mb-4 text-xs font-black text-cric-muted uppercase tracking-widest">Recent results</h3>
                {recentMatches.length === 0 ? (
                  <p className="py-2 text-sm font-semibold text-cric-muted">No completed matches yet.</p>
                ) : (
                  <div className="space-y-3">
                    {recentMatches.map((match) => (
                      <TeamMatchRow key={match._id} match={match} teamId={id} result />
                    ))}
                  </div>
                )}
              </section>

              <section className="bg-cric-card rounded-2xl shadow-sm border border-slate-100 p-5">
                <h3 className="mb-4 text-xs font-black text-cric-muted uppercase tracking-widest">Top performers</h3>
                {!topPerformers.topRunScorer && !topPerformers.topWicketTaker && !topPerformers.bestStrikeRate ? (
                  <p className="py-2 text-sm font-semibold text-cric-muted">
                    No individual performances recorded yet.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <PerformerCard
                      label="Top run scorer"
                      performer={topPerformers.topRunScorer}
                      detail={(player) => `${player.runs} runs in ${player.matches} matches`}
                    />
                    <PerformerCard
                      label="Top wicket taker"
                      performer={topPerformers.topWicketTaker}
                      detail={(player) => `${player.wickets} wickets in ${player.matches} matches`}
                    />
                    <PerformerCard
                      label="Best strike rate"
                      performer={topPerformers.bestStrikeRate}
                      detail={(player) =>
                        `${formatDecimal(player.strikeRate)} SR over ${player.matches} matches`
                      }
                    />
                  </div>
                )}
              </section>

              <section className="bg-cric-card rounded-2xl shadow-sm border border-slate-100 p-5">
                <h3 className="mb-4 text-xs font-black text-cric-muted uppercase tracking-widest">Best players</h3>
                {topPerformers.bestPlayers.length === 0 ? (
                  <p className="py-2 text-sm font-semibold text-cric-muted">No ranked players yet.</p>
                ) : (
                  <ol className="space-y-2">
                    {topPerformers.bestPlayers.map((performer, index) => (
                      <li
                        key={performer._id || index}
                        className="flex items-center gap-3 rounded-xl border border-cric-border bg-cric-bg px-4 py-3"
                      >
                        <span className="w-5 shrink-0 text-center text-sm font-black text-cric-muted">
                          {index + 1}
                        </span>
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-cric-accent font-black text-white">
                          {performer.imageUrl ? (
                            <SafeImage src={performer.imageUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            (performer.name || '?').charAt(0).toUpperCase()
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <Link
                            to={`/players/${performer._id}`}
                            className="block truncate font-bold text-cric-accent"
                          >
                            {performer.name || 'Player'}
                          </Link>
                          <p className="text-[11px] font-semibold text-cric-muted">
                            {performer.runs} runs • {performer.wickets} wkts • {performer.matches} mat
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>

            {/* Organization Chain Card */}
            {orgChain.length > 0 && (
              <div className="bg-cric-card rounded-2xl shadow-sm border border-slate-100 p-6">
                <h3 className="text-xs font-black text-cric-muted uppercase tracking-widest mb-4">Organization Hierarchy</h3>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {orgChain.map((org, idx) => (
                    <React.Fragment key={org._id}>
                      <div className="bg-cric-bg rounded-lg px-3 py-1.5 font-bold text-cric-text text-xs">
                        {org.slug ? (
                          <Link to={`/club/${org.slug}`} className="hover:text-cric-accent hover:underline">
                            {org.name}
                          </Link>
                        ) : (
                          org.name
                        )}
                        {org.level && <span className="text-cric-muted ml-1">({org.level})</span>}
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
              {team.privacy?.contactInfo !== 'hidden' && (
              <div className="bg-cric-card rounded-2xl shadow-sm border border-slate-100 p-6">
                <h3 className="text-xs font-black text-cric-muted uppercase tracking-widest mb-4">Contact</h3>
                <div className="space-y-3 text-sm">
                  {(team.contactPhone || team.phone) && (
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-lg bg-cric-card flex items-center justify-center text-cric-accent">📞</span>
                      <div>
                        <p className="text-[10px] font-bold text-cric-muted uppercase">Phone</p>
                        <p className="font-semibold text-cric-text">{team.contactPhone || team.phone}</p>
                      </div>
                    </div>
                  )}
                  {(team.contactEmail || team.email) && (
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-lg bg-cric-card flex items-center justify-center text-cric-accent">✉️</span>
                      <div>
                        <p className="text-[10px] font-bold text-cric-muted uppercase">Email</p>
                        <p className="font-semibold text-cric-text">{team.contactEmail || team.email}</p>
                      </div>
                    </div>
                  )}
                  {team.website && (
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-lg bg-cric-card flex items-center justify-center text-cric-accent">🌐</span>
                      <div>
                        <p className="text-[10px] font-bold text-cric-muted uppercase">Website</p>
                        <a href={team.website} target="_blank" rel="noopener noreferrer" className="font-semibold text-cric-accent hover:underline">{team.website}</a>
                      </div>
                    </div>
                  )}
                  {!team.contactPhone && !team.phone && !team.contactEmail && !team.email && !team.website && (
                    <p className="text-cric-muted text-center py-4">No contact information available</p>
                  )}
                </div>
              </div>
              )}

              {/* Social & Colors */}
              <div className="bg-cric-card rounded-2xl shadow-sm border border-slate-100 p-6">
                <h3 className="text-xs font-black text-cric-muted uppercase tracking-widest mb-4">Social & Branding</h3>
                <div className="space-y-3">
                  {team.primaryColor && (
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{backgroundColor: primaryColor}}>
                        <span className="text-white text-xs font-black">C</span>
                      </span>
                      <div>
                        <p className="text-[10px] font-bold text-cric-muted uppercase">Primary Color</p>
                        <p className="font-semibold text-cric-text text-xs font-mono">{primaryColor}</p>
                      </div>
                    </div>
                  )}
                  {team.privacy?.socialLinks !== 'hidden' && socialButtons(team)}
                </div>
              </div>
            </div>

            {/* Roles: Admin, Scorer, Commentator */}
            {(team.adminRef || team.scorerRef || team.commentatorRef) && (
              <div className="bg-cric-card rounded-2xl shadow-sm border border-slate-100 p-6">
                <h3 className="text-xs font-black text-cric-muted uppercase tracking-widest mb-4">Team Personnel</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {team.adminRef && (
                    <div className="bg-purple-50 rounded-xl p-4 border border-purple-200">
                      <p className="text-[10px] font-black text-purple-500 uppercase tracking-wider mb-1">🛡️ Admin</p>
                      <p className="font-bold text-cric-text">{typeof team.adminRef === 'object' ? team.adminRef.name || team.adminRef.email : team.adminRef}</p>
                    </div>
                  )}
                  {team.scorerRef && (
                    <div className="bg-green-50 rounded-xl p-4 border border-green-200">
                      <p className="text-[10px] font-black text-green-500 uppercase tracking-wider mb-1">📊 Scorer</p>
                      <p className="font-bold text-cric-text">{typeof team.scorerRef === 'object' ? team.scorerRef.name || team.scorerRef.email : team.scorerRef}</p>
                    </div>
                  )}
                  {team.commentatorRef && (
                    <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
                      <p className="text-[10px] font-black text-amber-500 uppercase tracking-wider mb-1">🎙️ Commentator</p>
                      <p className="font-bold text-cric-text">{typeof team.commentatorRef === 'object' ? team.commentatorRef.name || team.commentatorRef.email : team.commentatorRef}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Description */}
            {team.description && (
              <div className="bg-cric-card rounded-2xl shadow-sm border border-slate-100 p-6">
                <h3 className="text-xs font-black text-cric-muted uppercase tracking-widest mb-3">About</h3>
                <p className="text-sm text-cric-muted leading-relaxed">{team.description}</p>
              </div>
            )}

            {/* Home Ground / Venue */}
            {team.fullAddress && team.privacy?.location !== 'hidden' && (
              <div className="bg-cric-card rounded-2xl shadow-sm border border-slate-100 p-6">
                <h3 className="text-xs font-black text-cric-muted uppercase tracking-widest mb-3">🏟️ Home Ground</h3>
                <p className="font-bold text-cric-text">{team.fullAddress}</p>
                {team.latitude && team.longitude && (
                  <div className="mt-3 h-48 rounded-xl overflow-hidden">
                    <iframe width="100%" height="100%" loading="lazy" referrerPolicy="no-referrer-when-downgrade"
                      src={`https://www.google.com/maps?q=${team.latitude},${team.longitude}&z=15&output=embed`} />
                  </div>
                )}
              </div>
            )}

            {/* Gallery */}
            {team.privacy?.media !== 'hidden' && team.media && team.media.some(m => m.url) && (
              <div className="bg-cric-card rounded-2xl shadow-sm border border-slate-100 p-6">
                <h3 className="text-xs font-black text-cric-muted uppercase tracking-widest mb-4">Gallery</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {team.media.map((m, i) => m.url ? (
                    <a key={i} href={m.url} target="_blank" rel="noopener noreferrer" className="group relative rounded-lg overflow-hidden border border-cric-border">
                      <img src={m.url} alt={m.caption || 'photo'} className="w-full h-32 object-cover group-hover:scale-105 transition-transform" />
                      {m.caption && <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[10px] font-bold px-2 py-1 truncate">{m.caption}</span>}
                    </a>
                  ) : null)}
                </div>
              </div>
            )}

            {/* Videos */}
            {team.privacy?.media !== 'hidden' && team.videos && team.videos.some(v => v.url) && (
              <div className="bg-cric-card rounded-2xl shadow-sm border border-slate-100 p-6">
                <h3 className="text-xs font-black text-cric-muted uppercase tracking-widest mb-4">Videos</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {team.videos.map((v, i) => v.url ? (
                    <a key={i} href={v.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 bg-cric-bg rounded-lg border border-cric-border px-4 py-3 hover:border-cric-accent transition-all">
                      <span className="w-10 h-10 rounded-full bg-cric-accent text-white flex items-center justify-center text-sm flex-shrink-0">▶</span>
                      <div className="min-w-0">
                        <p className="font-bold text-cric-text text-sm truncate">{v.title || 'Watch Video'}</p>
                        <p className="text-xs text-cric-muted truncate">{v.url}</p>
                      </div>
                    </a>
                  ) : null)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ──── Squad Tab ──── */}
        {activeTab === 'squad' && (
          <div>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-2xl font-black text-cric-accent">Squad ({players.length})</h2>
              {canManageSquad && players.length > 0 ? (
                <SquadManager orgId={teamOrgId} teamId={id} onChanged={fetchTeam} refreshSignal={squadRefresh} />
              ) : null}
            </div>

            {squadError ? (
              <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                {squadError}
              </p>
            ) : null}

            {players.length === 0 ? (
              canManageSquad ? (
                <div className="rounded-2xl border border-dashed border-cric-border bg-cric-card px-4 py-10 text-center">
                  <p className="text-lg font-black text-cric-text">Add your first players</p>
                  <p className="mt-1 text-sm font-semibold text-cric-muted">
                    Type a name, pick somebody who is already on CricAll, or paste a list. No account is needed.
                  </p>
                  <div className="mt-5 flex justify-center">
                    <SquadManager orgId={teamOrgId} teamId={id} onChanged={fetchTeam} refreshSignal={squadRefresh} />
                  </div>
                </div>
              ) : (
                <p className="text-cric-muted text-center py-12">No players in this team yet.</p>
              )
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {players.map((player) => (
                  <div
                    key={player._id}
                    className="bg-cric-card rounded-2xl border border-slate-100 p-5 hover:shadow-lg transition-all group"
                  >
                    <Link to={`/players/${player._id}`} className="block min-w-0">
                      <div className="flex items-center gap-4 mb-3">
                        <div className="w-14 h-14 shrink-0 rounded-xl bg-gradient-to-br from-cric-accent to-blue-900 flex items-center justify-center text-white font-black text-lg group-hover:scale-110 transition-transform">
                          {player.imageUrl ? (
                            <SafeImage src={player.imageUrl} alt="" className="w-full h-full object-cover rounded-xl" />
                          ) : (
                            player.name?.charAt(0)
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <h3 className="font-bold text-cric-accent group-hover:text-cric-accent transition-colors truncate">{player.name}</h3>
                            {player.jerseyNumber != null && (
                              <span
                                className="shrink-0 rounded-md bg-cric-accent/10 px-1.5 py-0.5 text-[10px] font-black text-cric-accent"
                                title="Jersey number"
                              >
                                #{player.jerseyNumber}
                              </span>
                            )}
                          </div>
                          <span className={`mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${getRoleColor(player.playingRole)}`}>
                            <span>{player.playingRole || player.role || 'Player'}</span>
                            <BattingPositionBadge value={player.battingPosition} />
                          </span>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div>
                          <p className="text-lg font-black text-cric-text">{player.stats?.runs || 0}</p>
                          <p className="text-[8px] font-bold text-cric-muted uppercase tracking-wider">Runs</p>
                        </div>
                        <div>
                          <p className="text-lg font-black text-cric-text">{player.stats?.wickets || 0}</p>
                          <p className="text-[8px] font-bold text-cric-muted uppercase tracking-wider">Wkts</p>
                        </div>
                        <div>
                          <p className="text-lg font-black text-cric-text">{player.stats?.matches || 0}</p>
                          <p className="text-[8px] font-bold text-cric-muted uppercase tracking-wider">Mat</p>
                        </div>
                      </div>
                    </Link>
                    {canManageSquad ? (
                      <button
                        type="button"
                        onClick={() => handleRemoveFromSquad(player)}
                        disabled={removingId === player._id}
                        aria-label={`Remove ${player.name} from the squad`}
                        className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-cric-border bg-cric-bg px-3 py-2 text-[10px] font-black uppercase tracking-widest text-red-600 disabled:opacity-60"
                      >
                        {removingId === player._id ? 'Removing…' : 'Remove from squad'}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ──── Stats Tab ──── */}
        {activeTab === 'stats' && (
          <div className="bg-cric-card rounded-2xl shadow-sm border border-slate-100 p-8">
            <h2 className="text-2xl font-black text-cric-accent mb-6">Team Statistics</h2>
            {ranking ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                  <div className="bg-cric-bg rounded-xl p-4 text-center">
                    <p className="text-3xl font-black text-cric-accent">{ranking.matchesPlayed || 0}</p>
                    <p className="text-[10px] font-bold text-cric-muted uppercase tracking-wider">Played</p>
                  </div>
                  <div className="bg-green-50 rounded-xl p-4 text-center">
                    <p className="text-3xl font-black text-green-600">{ranking.matchesWon || 0}</p>
                    <p className="text-[10px] font-bold text-cric-muted uppercase tracking-wider">Won</p>
                  </div>
                  <div className="bg-red-50 rounded-xl p-4 text-center">
                    <p className="text-3xl font-black text-red-600">{ranking.matchesLost || 0}</p>
                    <p className="text-[10px] font-bold text-cric-muted uppercase tracking-wider">Lost</p>
                  </div>
                  <div className="bg-amber-50 rounded-xl p-4 text-center">
                    <p className="text-3xl font-black text-amber-600">{ranking.points || 0}</p>
                    <p className="text-[10px] font-bold text-cric-muted uppercase tracking-wider">Points</p>
                  </div>
                  <div className="bg-purple-50 rounded-xl p-4 text-center">
                    <p className="text-3xl font-black text-purple-600">{ranking.overallRank ? `#${ranking.overallRank}` : '-'}</p>
                    <p className="text-[10px] font-bold text-cric-muted uppercase tracking-wider">Overall Rank</p>
                  </div>
                  <div className="bg-indigo-50 rounded-xl p-4 text-center">
                    <p className="text-3xl font-black text-indigo-600">{ranking.categoryRank ? `#${ranking.categoryRank}` : '-'}</p>
                    <p className="text-[10px] font-bold text-cric-muted uppercase tracking-wider">Category Rank</p>
                  </div>
                </div>
                {ranking.form && (
                  <div className="mt-6 flex items-center gap-4">
                    <span className="text-[10px] font-black text-cric-muted uppercase tracking-widest">Form Guide:</span>
                    {renderFormGuide(ranking.form)}
                  </div>
                )}
              </>
            ) : (
              <p className="text-cric-muted text-center py-8">No statistics available yet.</p>
            )}
          </div>
        )}

        {/* ──── Matches Tab ──── */}
        {activeTab === 'matches' && (
          <div className="bg-cric-card rounded-2xl shadow-sm border border-slate-100 p-8">
            <h2 className="text-2xl font-black text-cric-accent mb-6">Recent Matches</h2>
            {recentMatches.length === 0 ? (
              <p className="text-cric-muted text-center py-8">No completed matches yet.</p>
            ) : (
              <div className="space-y-3">
                {recentMatches.map(match => (
                  <TeamMatchRow key={match._id} match={match} teamId={id} result />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ──── Branches Tab ──── */}
        {activeTab === 'branches' && (
          <div className="bg-cric-card rounded-2xl shadow-sm border border-slate-100 p-8">
            <h2 className="text-2xl font-black text-cric-accent mb-6">
              🌿 {team.organization || 'Organization'} Branches
            </h2>
            {branches && branches.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {branches.map(branch => (
                  <Link
                    key={branch._id}
                    to={`/teams/${branch._id}`}
                    className="bg-cric-bg hover:bg-cric-card border border-cric-border rounded-xl p-5 transition-all"
                  >
                    <p className="font-bold text-cric-accent text-lg">{branch.name}</p>
                    <p className="text-sm text-cric-muted">{branch.branchName}{branch.city ? `, ${branch.city}` : ''}</p>
                    <p className="text-xs text-cric-muted mt-2">{branch.players?.length || 0} players</p>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-cric-muted text-center py-8">No other branches for this organization.</p>
            )}
          </div>
        )}

        {activeTab === 'posts' && (
          <div className="bg-cric-card rounded-2xl shadow-sm border border-cric-border p-6">
            <PostsTab kind="team" subjectId={id} subjectName={team.name} />
          </div>
        )}
      </div>
    </div>
  );
}

const socialButtons = (team) => {
  const sl = (key, legacy) => team.socialLinks?.[key] || team[legacy];
  const links = [
    ['facebook', 'Facebook', '#1877F2', 'f', sl('facebook', 'facebookUrl')],
    ['instagram', 'Instagram', '#E4405F', 'ig', sl('instagram', 'instagramUrl')],
    ['twitter', 'X', '#000000', 'X', sl('twitter', 'twitterUrl')],
    ['youtube', 'YouTube', '#FF0000', '▶', sl('youtube', 'youtubeUrl')],
    ['whatsapp', 'WhatsApp', '#25D366', 'wa', sl('whatsapp', '')],
  ].filter(([,,, , url]) => url);
  if (links.length === 0) {
    return <p className="text-cric-muted text-xs">No social links available</p>;
  }
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {links.map(([key, label, color, icon, url]) => (
        <SocialBtn key={key} url={url} label={label} color={color} icon={icon} />
      ))}
    </div>
  );
};

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
