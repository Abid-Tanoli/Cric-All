import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useToast } from './Toast';

const PlayingXISelection = ({ match, team, eventSquad, onClose, onSuccess }) => {
    const [squadPlayers, setSquadPlayers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedXI, setSelectedXI] = useState([]);
    const [captain, setCaptain] = useState('');
    const [viceCaptain, setViceCaptain] = useState('');
    const [wicketKeeper, setWicketKeeper] = useState('');
    const [search, setSearch] = useState('');
    const [saving, setSaving] = useState(false);
    const [sourceLabel, setSourceLabel] = useState('');
    const { showToast } = useToast();

    useEffect(() => {
        loadSquadAndXI();
    }, [team?._id]);

    const loadSquadAndXI = async () => {
        console.log('=== PLAYING XI SELECTION ===');
        console.log('Team:', team);
        console.log('Event Squad Prop:', eventSquad);
        console.log('Match:', match);

        try {
            // Priority 1: Use event squad if provided
            if (eventSquad) {
                console.log('Event Squad detected:', eventSquad);
                console.log('Event Squad players:', eventSquad.players);
                console.log('Event Squad players count:', eventSquad.players?.length);

                let players = eventSquad.players || [];

                // If players are not populated (just ObjectIds), fetch them
                if (players.length > 0 && typeof players[0] === 'string') {
                    console.log('Players are ObjectIds, fetching details...');
                    // Fetch player details for all IDs
                    const playerPromises = players.map(async (id) => {
                        try {
                            const res = await api.get(`/players/${id}`);
                            return res.data;
                        } catch (err) {
                            console.error(`Failed to fetch player ${id}:`, err);
                            return { _id: id, name: 'Unknown Player' };
                        }
                    });
                    players = await Promise.all(playerPromises);
                    console.log('Fetched players:', players);
                }

                if (players.length > 0) {
                    console.log('Using EVENT SQUAD with', players.length, 'players');
                    setSquadPlayers(players);
                    setCaptain(eventSquad.captain?._id || eventSquad.captain || '');
                    setViceCaptain(eventSquad.viceCaptain?._id || eventSquad.viceCaptain || '');
                    const wk = eventSquad.wicketKeepers?.[0];
                    setWicketKeeper(wk?._id || wk || '');
                    setSourceLabel('Event Squad');

                    // Still load existing Playing XI if any
                    const matchRes = await api.get(`/matches/${match._id}`);
                    const teamIdStr = team?._id?.toString() || team?.toString();
                    const existingXI = matchRes.data.playingXI?.find(
                        x => (x.team?._id?.toString() || x.team?.toString()) === teamIdStr
                    );
                    if (existingXI) setSelectedXI((existingXI.players || []).map(p => p._id?.toString() || p?.toString()));

                    setLoading(false);
                    return;
                } else {
                    console.log('Event Squad has no players, falling back to match squad15');
                }
            }

            // Priority 2: Load from match squad15
            const matchRes = await api.get(`/matches/${match._id}`);
            const matchData = matchRes.data;
            const teamIdStr = team?._id?.toString() || team?.toString();

            const squad = matchData.squad15?.find(
                s => (s.team?._id?.toString() || s.team?.toString()) === teamIdStr
            );
            if (squad) {
                let players = squad.players || [];

                // If players are not populated, fetch them
                if (players.length > 0 && typeof players[0] === 'string') {
                    const playerPromises = players.map(async (id) => {
                        try {
                            const res = await api.get(`/players/${id}`);
                            return res.data;
                        } catch {
                            return { _id: id, name: 'Unknown Player' };
                        }
                    });
                    players = await Promise.all(playerPromises);
                }

                setSquadPlayers(players);
                setCaptain(squad.captain?._id || squad.captain || '');
                setViceCaptain(squad.viceCaptain?._id || squad.viceCaptain || '');
                const wk = squad.wicketKeepers?.[0];
                setWicketKeeper(wk?._id || wk || '');
                setSourceLabel('Match Squad');
            }

            // Load existing playing XI
            const existingXI = matchData.playingXI?.find(
                x => (x.team?._id?.toString() || x.team?.toString()) === teamIdStr
            );
            if (existingXI) setSelectedXI((existingXI.players || []).map(p => p._id?.toString() || p?.toString()));

            // Load team roles
            const teamRoles = matchData.teamRoles?.find(
                r => (r.team?._id?.toString() || r.team?.toString()) === teamIdStr
            );
            if (teamRoles) {
                if (teamRoles.captain) setCaptain(teamRoles.captain?._id?.toString() || teamRoles.captain?.toString());
                if (teamRoles.viceCaptain) setViceCaptain(teamRoles.viceCaptain?._id?.toString() || teamRoles.viceCaptain?.toString());
                if (teamRoles.wicketKeepers?.[0]) setWicketKeeper(teamRoles.wicketKeepers[0]?._id?.toString() || teamRoles.wicketKeepers[0]?.toString());
            }
        } catch (err) {
            console.error('Failed to load squad data:', err);
        } finally {
            setLoading(false);
        }
    };

    const togglePlayer = (playerId) => {
        setSelectedXI(prev => {
            if (prev.includes(playerId)) {
                return prev.filter(id => id !== playerId);
            }
            if (prev.length >= 11) {
                showToast('Maximum 11 players allowed', 'warning');
                return prev;
            }
            return [...prev, playerId];
        });
    };

    const handleSave = async () => {
        if (selectedXI.length !== 11) {
            showToast('Please select exactly 11 players for Playing XI', 'warning');
            return;
        }
        if (!captain) {
            showToast('Please select a captain', 'warning');
            return;
        }
        if (!viceCaptain) {
            showToast('Please select a vice-captain', 'warning');
            return;
        }
        if (!wicketKeeper) {
            showToast('Please select a wicket-keeper', 'warning');
            return;
        }

        setSaving(true);
        try {
            // Save Playing XI
            await api.put(`/matches/${match._id}/playing-xi`, {
                teamId: team._id,
                players: selectedXI
            });

            // Save team roles (captain, VC, WK)
            await api.put(`/matches/${match._id}/team-roles`, {
                teamId: team._id,
                captain,
                viceCaptain,
                wicketKeepers: [wicketKeeper]
            });

            onSuccess();
            onClose();
        } catch (err) {
            console.error('Failed to save Playing XI:', err);
            showToast('Failed to save: ' + (err.response?.data?.message || err.message), 'error');
        } finally {
            setSaving(false);
        }
    };

    const filteredPlayers = squadPlayers.filter(p => {
        const playerName = p.name || '';
        return playerName.toLowerCase().includes(search.toLowerCase());
    });

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
                {/* Header */}
                <div className="bg-gradient-to-r from-[#031d44] to-[#0a2d5e] text-white p-6">
                    <div className="flex justify-between items-center">
                        <div>
                            <h2 className="text-2xl font-black uppercase tracking-tight">Playing XI Selection</h2>
                            <p className="text-blue-200 text-sm mt-1">{team.name}</p>
                        </div>
                        <button
                            onClick={onClose}
                            className="text-white hover:bg-white/20 rounded-lg p-2 transition-colors"
                        >
                            ✕
                        </button>
                    </div>
                </div>

                {/* Selection Info */}
                <div className="bg-blue-50 border-b border-blue-100 p-4">
                    <div className="grid grid-cols-4 gap-4 text-center">
                        <div>
                            <p className="text-xs font-bold text-slate-500 uppercase">Selected</p>
                            <p className={`text-2xl font-black ${selectedXI.length === 11 ? 'text-green-600' : 'text-red-600'}`}>
                                {selectedXI.length}/11
                            </p>
                        </div>
                        <div>
                            <p className="text-xs font-bold text-slate-500 uppercase">Captain</p>
                            <p className={`text-lg font-bold ${captain ? 'text-green-600' : 'text-red-600'}`}>
                                {captain ? '✓' : '✗'}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs font-bold text-slate-500 uppercase">V.Captain</p>
                            <p className={`text-lg font-bold ${viceCaptain ? 'text-green-600' : 'text-red-600'}`}>
                                {viceCaptain ? '✓' : '✗'}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs font-bold text-slate-500 uppercase">WK</p>
                            <p className={`text-lg font-bold ${wicketKeeper ? 'text-green-600' : 'text-red-600'}`}>
                                {wicketKeeper ? '✓' : '✗'}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Search */}
                <div className="p-4 border-b border-slate-200">
                    <input
                        type="text"
                        placeholder="Search players..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
                    />
                </div>

                {/* Player List */}
                <div className="overflow-y-auto max-h-[400px] p-4">
                    {loading ? (
                        <div className="text-center py-10">
                            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-600 border-t-transparent"></div>
                            <p className="mt-3 text-sm text-slate-500">Loading squad players...</p>
                            {sourceLabel && <p className="mt-1 text-xs text-blue-600 font-bold">Source: {sourceLabel}</p>}
                        </div>
                    ) : filteredPlayers.length === 0 && squadPlayers.length === 0 ? (
                        <div className="text-center py-10">
                            <p className="text-lg font-bold text-slate-500 mb-2">No Squad Found</p>
                            <p className="text-sm text-slate-400 mb-3">
                                Please set up the event squad first at the series level.
                            </p>
                            <p className="text-xs text-slate-500">
                                Go to Admin → Manage Events → Click "{team?.name} Squad" button
                            </p>
                        </div>
                    ) : filteredPlayers.length === 0 ? (
                        <div className="text-center py-10">
                            <p className="text-sm text-slate-500">No players match your search</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {filteredPlayers.map(player => {
                                const isSelected = selectedXI.includes(player._id);
                                const isCaptain = captain === player._id;
                                const isViceCaptain = viceCaptain === player._id;
                                const isWK = wicketKeeper === player._id;

                                return (
                                    <div
                                        key={player._id}
                                        className={`p-4 rounded-xl border-2 transition-all ${isSelected ? 'border-green-500 bg-green-50' : 'border-slate-200 hover:border-slate-300'}`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-4 flex-1">
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => togglePlayer(player._id)}
                                                    className="w-5 h-5 rounded border-slate-300 text-green-600 focus:ring-green-500"
                                                    disabled={!isSelected && selectedXI.length >= 11}
                                                />
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <h3 className="font-bold text-slate-800">{player.name}</h3>
                                                        {isCaptain && (
                                                            <span className="bg-blue-100 text-blue-700 text-[10px] font-black px-2 py-0.5 rounded uppercase">C</span>
                                                        )}
                                                        {isViceCaptain && (
                                                            <span className="bg-purple-100 text-purple-700 text-[10px] font-black px-2 py-0.5 rounded uppercase">VC</span>
                                                        )}
                                                        {isWK && (
                                                            <span className="bg-orange-100 text-orange-700 text-[10px] font-black px-2 py-0.5 rounded uppercase">WK</span>
                                                        )}
                                                    </div>
                                                    <p className="text-xs text-slate-500">{player.playingRole || player.role}</p>
                                                </div>
                                            </div>

                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => setCaptain(player._id)}
                                                    className={`px-3 py-1 rounded text-xs font-black uppercase transition-all ${isCaptain ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-blue-100'}`}
                                                >
                                                    C
                                                </button>
                                                <button
                                                    onClick={() => setViceCaptain(player._id)}
                                                    className={`px-3 py-1 rounded text-xs font-black uppercase transition-all ${isViceCaptain ? 'bg-purple-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-purple-100'}`}
                                                >
                                                    VC
                                                </button>
                                                <button
                                                    onClick={() => setWicketKeeper(player._id)}
                                                    className={`px-3 py-1 rounded text-xs font-black uppercase transition-all ${isWK ? 'bg-orange-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-orange-100'}`}
                                                >
                                                    WK
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="border-t border-slate-200 p-4 bg-slate-50 flex gap-3">
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex-1 bg-[#031d44] hover:bg-slate-800 text-white font-black text-sm uppercase tracking-widest rounded-xl py-3 transition-all disabled:opacity-50"
                    >
                        {saving ? 'Saving...' : 'Save Playing XI'}
                    </button>
                    <button
                        onClick={onClose}
                        className="px-6 bg-slate-200 hover:bg-slate-300 text-[#031d44] font-black text-sm uppercase tracking-widest rounded-xl py-3 transition-all"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PlayingXISelection;
