import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useToast } from './Toast';

const SquadSelectionModal = ({ match, team, onClose, onSuccess }) => {
    const [teamPlayers, setTeamPlayers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedPlayers, setSelectedPlayers] = useState([]);
    const [captain, setCaptain] = useState('');
    const [viceCaptain, setViceCaptain] = useState('');
    const [wicketKeepers, setWicketKeepers] = useState([]);
    const [search, setSearch] = useState('');
    const [saving, setSaving] = useState(false);
    const { showToast } = useToast();

    useEffect(() => {
        fetchTeamPlayers();
        loadExistingSquad();
    }, [team?._id]);

    const fetchTeamPlayers = async () => {
        try {
            const res = await api.get(`/teams/${team._id}`);
            setTeamPlayers(res.data.players || []);
        } catch (err) {
            console.error('Failed to fetch team players:', err);
        } finally {
            setLoading(false);
        }
    };

    const loadExistingSquad = () => {
        if (match?.squad15) {
            const existingSquad = match.squad15.find(s => s.team === team._id);
            if (existingSquad) {
                setSelectedPlayers(existingSquad.players || []);
                setCaptain(existingSquad.captain || '');
                setViceCaptain(existingSquad.viceCaptain || '');
                setWicketKeepers(existingSquad.wicketKeepers || []);
            }
        }
    };

    const togglePlayer = (playerId) => {
        setSelectedPlayers(prev => {
            if (prev.includes(playerId)) {
                return prev.filter(id => id !== playerId);
            }
            if (prev.length >= 20) {
                showToast('Maximum 20 players allowed', 'warning');
                return prev;
            }
            return [...prev, playerId];
        });
    };

    const handleCaptainChange = (playerId) => {
        setCaptain(playerId);
        if (!selectedPlayers.includes(playerId)) {
            setSelectedPlayers(prev => [...prev, playerId]);
        }
    };

    const handleViceCaptainChange = (playerId) => {
        setViceCaptain(playerId);
        if (!selectedPlayers.includes(playerId)) {
            setSelectedPlayers(prev => [...prev, playerId]);
        }
    };

    const toggleWicketKeeper = (playerId) => {
        setWicketKeepers(prev => {
            if (prev.includes(playerId)) {
                return prev.filter(id => id !== playerId);
            }
            return [...prev, playerId];
        });
    };

    const handleSave = async () => {
        if (selectedPlayers.length < 11) {
            showToast('Minimum 11 players required', 'warning');
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
        if (wicketKeepers.length === 0) {
            showToast('Please select at least one wicket-keeper', 'warning');
            return;
        }

        setSaving(true);
        try {
            await api.put(`/matches/${match._id}/squad15`, {
                teamId: team._id,
                players: selectedPlayers,
                captain,
                viceCaptain,
                wicketKeepers
            });
            onSuccess();
            onClose();
        } catch (err) {
            console.error('Failed to save squad:', err);
            showToast('Failed to save squad: ' + (err.response?.data?.message || err.message), 'error');
        } finally {
            setSaving(false);
        }
    };

    const filteredPlayers = teamPlayers.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
                {/* Header */}
                <div className="bg-gradient-to-r from-[#031d44] to-[#0a2d5e] text-white p-6">
                    <div className="flex justify-between items-center">
                        <div>
                            <h2 className="text-2xl font-black uppercase tracking-tight">Squad Selection</h2>
                            <p className="text-blue-200 text-sm mt-1">{team.name} - {match.title}</p>
                        </div>
                        <button
                            onClick={onClose}
                            className="text-white hover:bg-white/20 rounded-lg p-2 transition-colors"
                        >
                            ✕
                        </button>
                    </div>
                </div>

                {/* Squad Info */}
                <div className="bg-blue-50 border-b border-blue-100 p-4">
                    <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                            <p className="text-xs font-bold text-slate-500 uppercase">Selected</p>
                            <p className={`text-2xl font-black ${selectedPlayers.length >= 11 && selectedPlayers.length <= 20 ? 'text-green-600' : 'text-red-600'}`}>
                                {selectedPlayers.length}
                            </p>
                            <p className="text-[10px] text-slate-400">Min: 11, Max: 20</p>
                        </div>
                        <div>
                            <p className="text-xs font-bold text-slate-500 uppercase">Captain</p>
                            <p className={`text-lg font-bold ${captain ? 'text-green-600' : 'text-red-600'}`}>
                                {captain ? '✓' : '✗'}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs font-bold text-slate-500 uppercase">Wicket-Keepers</p>
                            <p className={`text-2xl font-black ${wicketKeepers.length > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {wicketKeepers.length}
                            </p>
                            <p className="text-[10px] text-slate-400">Min: 1</p>
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
                            <p className="mt-3 text-sm text-slate-500">Loading players...</p>
                        </div>
                    ) : filteredPlayers.length === 0 ? (
                        <div className="text-center py-10">
                            <p className="text-slate-500">No players found in this team</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {filteredPlayers.map(player => {
                                const isSelected = selectedPlayers.includes(player._id);
                                const isCaptain = captain === player._id;
                                const isViceCaptain = viceCaptain === player._id;
                                const isKeeper = wicketKeepers.includes(player._id);

                                return (
                                    <div
                                        key={player._id}
                                        className={`p-4 rounded-xl border-2 transition-all cursor-pointer ${isSelected ? 'border-green-500 bg-green-50' : 'border-slate-200 hover:border-slate-300'}`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-4 flex-1">
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => togglePlayer(player._id)}
                                                    className="w-5 h-5 rounded border-slate-300 text-green-600 focus:ring-green-500"
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
                                                        {isKeeper && (
                                                            <span className="bg-orange-100 text-orange-700 text-[10px] font-black px-2 py-0.5 rounded uppercase">WK</span>
                                                        )}
                                                    </div>
                                                    <p className="text-xs text-slate-500">{player.playingRole || player.role}</p>
                                                </div>
                                            </div>

                                            <div className="flex gap-2">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleCaptainChange(player._id);
                                                    }}
                                                    className={`px-3 py-1 rounded text-xs font-black uppercase transition-all ${isCaptain ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-blue-100'
                                                        }`}
                                                >
                                                    Captain
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleViceCaptainChange(player._id);
                                                    }}
                                                    className={`px-3 py-1 rounded text-xs font-black uppercase transition-all ${isViceCaptain ? 'bg-purple-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-purple-100'
                                                        }`}
                                                >
                                                    V.Captain
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        toggleWicketKeeper(player._id);
                                                    }}
                                                    className={`px-3 py-1 rounded text-xs font-black uppercase transition-all ${isKeeper ? 'bg-orange-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-orange-100'
                                                        }`}
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
                        {saving ? 'Saving...' : 'Save Squad'}
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

export default SquadSelectionModal;
