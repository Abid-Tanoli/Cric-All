import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useToast } from './Toast';

const REASONS = [
  { value: 'injury',       label: 'Injury',        color: 'red',    icon: '🤕' },
  { value: 'illness',      label: 'Illness',       color: 'yellow', icon: '🤒' },
  { value: 'disciplinary', label: 'Disciplinary',  color: 'orange', icon: '🚫' },
  { value: 'personal',     label: 'Personal',      color: 'purple', icon: '🏠' },
  { value: 'other',        label: 'Other',         color: 'slate',  icon: '📝' },
];

const reasonBadge = (reason) => {
  const r = REASONS.find(x => x.value === reason) || REASONS[4];
  const colors = {
    red:    'bg-red-100 text-red-700',
    yellow: 'bg-yellow-100 text-yellow-700',
    orange: 'bg-orange-100 text-orange-700',
    purple: 'bg-purple-100 text-purple-700',
    slate:  'bg-slate-100 text-slate-600',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${colors[r.color]}`}>
      {r.icon} {r.label}
    </span>
  );
};

export default function EventSquadModal({ event, team, onClose, onSuccess }) {
  const [activeTab, setActiveTab] = useState('squad');

  // Squad tab state
  const [teamPlayers, setTeamPlayers] = useState([]);
  const [selectedPlayers, setSelectedPlayers] = useState([]);
  const [captain, setCaptain] = useState('');
  const [viceCaptain, setViceCaptain] = useState('');
  const [wicketKeepers, setWicketKeepers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [squadExists, setSquadExists] = useState(false);
  const [changeHistory, setChangeHistory] = useState([]);
  const { showToast } = useToast();

  // Change Player tab state
  const [outPlayer, setOutPlayer] = useState('');
  const [inPlayer, setInPlayer] = useState('');
  const [changeReason, setChangeReason] = useState('injury');
  const [changeNotes, setChangeNotes] = useState('');
  const [changeSaving, setChangeSaving] = useState(false);
  const [inPlayerSearch, setInPlayerSearch] = useState('');

  useEffect(() => {
    loadData();
  }, [team?._id, event?._id]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load full team roster
      const teamRes = await api.get(`/teams/${team._id}`);
      setTeamPlayers(teamRes.data.players || []);

      // Load existing event squad for this team
      const eventRes = await api.get(`/events/${event._id}`);
      const existingSquad = eventRes.data.eventSquads?.find(
        s => s.team?._id === team._id || s.team === team._id
      );
      if (existingSquad) {
        const playerIds = (existingSquad.players || []).map(p => p._id || p);
        setSelectedPlayers(playerIds);
        setCaptain(existingSquad.captain?._id || existingSquad.captain || '');
        setViceCaptain(existingSquad.viceCaptain?._id || existingSquad.viceCaptain || '');
        setWicketKeepers((existingSquad.wicketKeepers || []).map(w => w._id || w));
        setChangeHistory(existingSquad.playerChanges || []);
        setSquadExists(true);
      }
    } catch (err) {
      console.error('Failed to load event squad data:', err);
    } finally {
      setLoading(false);
    }
  };

  // ========== Squad Tab Handlers ==========
  const togglePlayer = (playerId) => {
    setSelectedPlayers(prev => {
      if (prev.includes(playerId)) return prev.filter(id => id !== playerId);
      if (prev.length >= 20) { showToast('Maximum 20 players allowed in a squad', 'warning'); return prev; }
      return [...prev, playerId];
    });
  };

  const toggleWicketKeeper = (playerId) => {
    setWicketKeepers(prev =>
      prev.includes(playerId) ? prev.filter(id => id !== playerId) : [...prev, playerId]
    );
  };

  const handleSaveSquad = async () => {
    if (selectedPlayers.length < 11) { showToast('Minimum 11 players required', 'warning'); return; }
    if (!captain) { showToast('Please select a captain', 'warning'); return; }
    if (!viceCaptain) { showToast('Please select a vice-captain', 'warning'); return; }
    if (wicketKeepers.length === 0) { showToast('Please select at least one wicket-keeper', 'warning'); return; }

    setSaving(true);
    try {
      await api.post(`/events/${event._id}/squad`, {
        teamId: team._id,
        players: selectedPlayers,
        captain,
        viceCaptain,
        wicketKeepers,
      });
      setSquadExists(true);
      onSuccess?.();
    } catch (err) {
      showToast('Failed to save squad: ' + (err.response?.data?.message || err.message), 'error');
    } finally {
      setSaving(false);
    }
  };

  // ========== Change Player Tab Handlers ==========
  const handleChangePlayer = async () => {
    if (!outPlayer) { showToast('Please select the player going OUT', 'warning'); return; }
    if (!inPlayer) { showToast('Please select the replacement player', 'warning'); return; }
    if (outPlayer === inPlayer) { showToast('In-player and out-player must be different', 'warning'); return; }

    setChangeSaving(true);
    try {
      await api.put(`/events/${event._id}/squad/change-player`, {
        teamId: team._id,
        outPlayerId: outPlayer,
        inPlayerId: inPlayer,
        reason: changeReason,
        notes: changeNotes,
      });
      // Reflect swap locally
      setSelectedPlayers(prev => prev.map(id => id === outPlayer ? inPlayer : id));
      setChangeHistory(prev => [{
        outPlayer: teamPlayers.find(p => p._id === outPlayer),
        inPlayer: teamPlayers.find(p => p._id === inPlayer),
        reason: changeReason,
        notes: changeNotes,
        changedAt: new Date().toISOString(),
      }, ...prev]);
      setOutPlayer('');
      setInPlayer('');
      setChangeNotes('');
      setInPlayerSearch('');
      onSuccess?.();
    } catch (err) {
      showToast('Failed to change player: ' + (err.response?.data?.message || err.message), 'error');
    } finally {
      setChangeSaving(false);
    }
  };

  const filteredSquad = teamPlayers.filter(p =>
    selectedPlayers.includes(p._id) &&
    p.name?.toLowerCase().includes(search.toLowerCase())
  );

  const filteredAll = teamPlayers.filter(p =>
    p.name?.toLowerCase().includes(inPlayerSearch.toLowerCase())
  );

  const squadPlayers = teamPlayers.filter(p => selectedPlayers.includes(p._id));
  const nonSquadPlayers = filteredAll.filter(p => !selectedPlayers.includes(p._id));

  const badgeCount = selectedPlayers.length;
  const badgeColor = badgeCount >= 11 && badgeCount <= 20 ? 'text-green-600' : 'text-red-600';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col">

        {/* Header */}
        <div className="bg-gradient-to-r from-[#031d44] to-[#0a2d5e] text-white p-5 flex-shrink-0">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-2xl font-black uppercase tracking-tight">Event Squad</h2>
              <p className="text-blue-200 text-sm mt-0.5">
                {team.name} · {event.name}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {squadExists && (
                <span className="flex items-center gap-1.5 bg-green-500/20 border border-green-400/40 text-green-300 text-xs font-black px-3 py-1.5 rounded-lg uppercase tracking-widest">
                  ✓ Squad Set
                </span>
              )}
              <button
                onClick={onClose}
                className="text-white hover:bg-white/20 rounded-lg p-2 transition-colors"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-4">
            {[
              { key: 'squad', label: '👥 Squad Selection' },
              { key: 'change', label: '🔄 Change Player' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${
                  activeTab === tab.key
                    ? 'bg-white text-[#031d44]'
                    : 'text-blue-200 hover:bg-white/10'
                }`}
              >
                {tab.label}
                {tab.key === 'change' && changeHistory.length > 0 && (
                  <span className="ml-1.5 bg-orange-500 text-white text-[9px] px-1.5 py-0.5 rounded-full">
                    {changeHistory.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ========== SQUAD TAB ========== */}
        {activeTab === 'squad' && (
          <>
            {/* Stats bar */}
            <div className="bg-blue-50 border-b border-blue-100 p-4 flex-shrink-0">
              <div className="grid grid-cols-4 gap-3 text-center">
                <div>
                  <p className="text-[10px] font-black text-slate-500 uppercase">Players</p>
                  <p className={`text-2xl font-black ${badgeColor}`}>{badgeCount}</p>
                  <p className="text-[9px] text-slate-400">11–20</p>
                </div>
                <div>
                  <p className="text-[10px] font-black text-slate-500 uppercase">Captain</p>
                  <p className={`text-xl font-black ${captain ? 'text-green-600' : 'text-red-500'}`}>
                    {captain ? '✓' : '✗'}
                  </p>
                  <p className="text-[9px] text-slate-400 truncate">
                    {captain ? (teamPlayers.find(p => p._id === captain)?.name || '—') : 'Not set'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-black text-slate-500 uppercase">V.Captain</p>
                  <p className={`text-xl font-black ${viceCaptain ? 'text-green-600' : 'text-red-500'}`}>
                    {viceCaptain ? '✓' : '✗'}
                  </p>
                  <p className="text-[9px] text-slate-400 truncate">
                    {viceCaptain ? (teamPlayers.find(p => p._id === viceCaptain)?.name || '—') : 'Not set'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-black text-slate-500 uppercase">Keepers</p>
                  <p className={`text-2xl font-black ${wicketKeepers.length > 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {wicketKeepers.length}
                  </p>
                  <p className="text-[9px] text-slate-400">Min 1</p>
                </div>
              </div>
            </div>

            {/* Search */}
            <div className="p-4 border-b border-slate-100 flex-shrink-0">
              <input
                type="text"
                placeholder="Search team players…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#031d44] text-sm"
              />
            </div>

            {/* Player list */}
            <div className="overflow-y-auto flex-1 p-4">
              {loading ? (
                <div className="text-center py-16">
                  <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-[#031d44] border-t-transparent" />
                  <p className="mt-3 text-sm text-slate-400 font-bold">Loading players…</p>
                </div>
              ) : teamPlayers.length === 0 ? (
                <div className="text-center py-16">
                  <p className="text-slate-400 font-bold">No players found in this team</p>
                  <p className="text-xs text-slate-300 mt-1">Add players to the team first</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {teamPlayers
                    .filter(p => p.name?.toLowerCase().includes(search.toLowerCase()))
                    .map(player => {
                      const isSelected = selectedPlayers.includes(player._id);
                      const isCap = captain === player._id;
                      const isVC = viceCaptain === player._id;
                      const isWK = wicketKeepers.includes(player._id);

                      return (
                        <div
                          key={player._id}
                          className={`p-4 rounded-xl border-2 transition-all ${
                            isSelected
                              ? 'border-green-400 bg-green-50'
                              : 'border-slate-200 hover:border-slate-300 bg-white'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => togglePlayer(player._id)}
                                className="w-5 h-5 rounded border-slate-300 text-green-600 focus:ring-green-500 flex-shrink-0 cursor-pointer"
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <h3 className="font-bold text-slate-800 text-sm">{player.name}</h3>
                                  {isCap && <span className="bg-blue-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded uppercase">C</span>}
                                  {isVC && <span className="bg-purple-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded uppercase">VC</span>}
                                  {isWK && <span className="bg-orange-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded uppercase">WK</span>}
                                </div>
                                <p className="text-[11px] text-slate-400 mt-0.5">{player.playingRole || player.role || 'Player'}</p>
                              </div>
                            </div>

                            {isSelected && (
                              <div className="flex gap-1 flex-shrink-0 ml-2">
                                <button
                                  onClick={() => setCaptain(isCap ? '' : player._id)}
                                  className={`px-2.5 py-1 rounded text-[10px] font-black uppercase transition-all ${
                                    isCap ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-blue-100'
                                  }`}
                                >
                                  C
                                </button>
                                <button
                                  onClick={() => setViceCaptain(isVC ? '' : player._id)}
                                  className={`px-2.5 py-1 rounded text-[10px] font-black uppercase transition-all ${
                                    isVC ? 'bg-purple-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-purple-100'
                                  }`}
                                >
                                  VC
                                </button>
                                <button
                                  onClick={() => toggleWicketKeeper(player._id)}
                                  className={`px-2.5 py-1 rounded text-[10px] font-black uppercase transition-all ${
                                    isWK ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-orange-100'
                                  }`}
                                >
                                  WK
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-slate-200 p-4 bg-slate-50 flex gap-3 flex-shrink-0">
              <button
                onClick={handleSaveSquad}
                disabled={saving}
                className="flex-1 bg-[#031d44] hover:bg-slate-800 text-white font-black text-sm uppercase tracking-widest rounded-xl py-3 transition-all disabled:opacity-50"
              >
                {saving ? 'Saving…' : squadExists ? '✓ Update Event Squad' : '💾 Save Event Squad'}
              </button>
              <button
                onClick={onClose}
                className="px-6 bg-slate-200 hover:bg-slate-300 text-[#031d44] font-black text-sm uppercase tracking-widest rounded-xl py-3 transition-all"
              >
                Close
              </button>
            </div>
          </>
        )}

        {/* ========== CHANGE PLAYER TAB ========== */}
        {activeTab === 'change' && (
          <>
            <div className="overflow-y-auto flex-1 p-5 space-y-6">

              {/* Change Player Form */}
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-4">
                  🔄 Replace a Player
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  {/* Player OUT */}
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-2">
                      Player Going OUT (from squad)
                    </label>
                    <select
                      value={outPlayer}
                      onChange={e => setOutPlayer(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-red-500 text-sm font-bold bg-red-50"
                    >
                      <option value="">— Select player going out —</option>
                      {squadPlayers.map(p => (
                        <option key={p._id} value={p._id}>
                          {p.name} ({p.playingRole || p.role || 'Player'})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Player IN */}
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-2">
                      Replacement Player (coming IN)
                    </label>
                    <input
                      type="text"
                      placeholder="Search replacement…"
                      value={inPlayerSearch}
                      onChange={e => setInPlayerSearch(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500 text-sm mb-2"
                    />
                    <select
                      value={inPlayer}
                      onChange={e => setInPlayer(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-green-500 text-sm font-bold bg-green-50"
                      size={Math.min(nonSquadPlayers.filter(p => p.name?.toLowerCase().includes(inPlayerSearch.toLowerCase())).length + 1, 5)}
                    >
                      <option value="">— Select replacement —</option>
                      {nonSquadPlayers
                        .filter(p => p.name?.toLowerCase().includes(inPlayerSearch.toLowerCase()))
                        .map(p => (
                          <option key={p._id} value={p._id}>
                            {p.name} ({p.playingRole || p.role || 'Player'})
                          </option>
                        ))}
                    </select>
                    {nonSquadPlayers.length === 0 && (
                      <p className="text-xs text-slate-400 mt-1">All team players are already in the squad.</p>
                    )}
                  </div>
                </div>

                {/* Reason */}
                <div className="mb-4">
                  <label className="block text-[10px] font-black text-slate-500 uppercase mb-2">
                    Reason for Change
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {REASONS.map(r => (
                      <button
                        key={r.value}
                        onClick={() => setChangeReason(r.value)}
                        className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest border-2 transition-all ${
                          changeReason === r.value
                            ? 'border-[#031d44] bg-[#031d44] text-white'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'
                        }`}
                      >
                        {r.icon} {r.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Notes */}
                <div className="mb-4">
                  <label className="block text-[10px] font-black text-slate-500 uppercase mb-2">
                    Additional Notes (optional)
                  </label>
                  <textarea
                    value={changeNotes}
                    onChange={e => setChangeNotes(e.target.value)}
                    placeholder="e.g. Hamstring injury during training session…"
                    rows={2}
                    className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#031d44] text-sm resize-none"
                  />
                </div>

                {/* Preview */}
                {outPlayer && inPlayer && (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl mb-4 flex items-center gap-3">
                    <span className="text-lg">⚠️</span>
                    <div className="text-sm">
                      <span className="font-black text-red-700">
                        {teamPlayers.find(p => p._id === outPlayer)?.name}
                      </span>
                      <span className="text-slate-600 mx-2">→ replaced by →</span>
                      <span className="font-black text-green-700">
                        {teamPlayers.find(p => p._id === inPlayer)?.name}
                      </span>
                      <span className="ml-2">{reasonBadge(changeReason)}</span>
                    </div>
                  </div>
                )}

                <button
                  onClick={handleChangePlayer}
                  disabled={changeSaving || !outPlayer || !inPlayer}
                  className="w-full bg-orange-600 hover:bg-orange-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-black text-sm uppercase tracking-widest rounded-xl py-3 transition-all"
                >
                  {changeSaving ? 'Processing…' : '🔄 Confirm Player Change'}
                </button>
              </div>

              {/* Change History */}
              {changeHistory.length > 0 && (
                <div>
                  <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest mb-3">
                    📋 Change History ({changeHistory.length})
                  </h3>
                  <div className="space-y-3">
                    {[...changeHistory].reverse().map((change, idx) => {
                      const outName = change.outPlayer?.name || 'Unknown';
                      const inName = change.inPlayer?.name || 'Unknown';
                      const dateStr = change.changedAt
                        ? new Date(change.changedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                        : '';
                      return (
                        <div key={idx} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-black text-red-700 text-sm">{outName}</span>
                              <span className="text-slate-400">→</span>
                              <span className="font-black text-green-700 text-sm">{inName}</span>
                              {reasonBadge(change.reason)}
                            </div>
                            <span className="text-[10px] text-slate-400 font-bold flex-shrink-0">{dateStr}</span>
                          </div>
                          {change.notes && (
                            <p className="text-xs text-slate-500 italic">"{change.notes}"</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {changeHistory.length === 0 && (
                <div className="text-center py-10">
                  <p className="text-4xl mb-2">🏏</p>
                  <p className="text-slate-400 font-bold text-sm">No player changes yet</p>
                  <p className="text-xs text-slate-300 mt-1">Changes made during the event will appear here</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-slate-200 p-4 bg-slate-50 flex-shrink-0">
              <button
                onClick={onClose}
                className="w-full bg-slate-200 hover:bg-slate-300 text-[#031d44] font-black text-sm uppercase tracking-widest rounded-xl py-3 transition-all"
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
