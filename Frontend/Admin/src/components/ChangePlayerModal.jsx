import React, { useState } from 'react';
import api from '../services/api';
import { useToast } from './Toast';

const ChangePlayerModal = ({ event, team, currentSquad, onClose, onSuccess }) => {
    const [changeType, setChangeType] = useState('');
    const [playerOut, setPlayerOut] = useState('');
    const [playerIn, setPlayerIn] = useState('');
    const [reason, setReason] = useState('');
    const [customReason, setCustomReason] = useState('');
    const [saving, setSaving] = useState(false);
    const { showToast } = useToast();

    const changeReasons = [
        'Injury',
        'Illness',
        'Personal Reasons',
        'Poor Form',
        'Rest/Rotation',
        'Suspension',
        'Family Emergency',
        'Other'
    ];

    // Handle both populated players and ObjectId arrays
    const squadPlayerIds = (currentSquad?.players || []).map(p => p._id || p);

    const availablePlayers = (team.players || []).filter(p => {
        const playerId = p._id || p;
        return !squadPlayerIds.includes(playerId);
    });

    // Get player data for preview (if players are populated)
    const playerOutData = currentSquad?.players?.find(p => {
        const pid = p._id || p;
        return pid === playerOut;
    });
    const playerInData = availablePlayers.find(p => (p._id || p) === playerIn);

    const handleSave = async () => {
        if (!changeType) {
            showToast('Please select change type', 'warning');
            return;
        }
        if (changeType === 'replace') {
            if (!playerOut) {
                showToast('Please select player to remove', 'warning');
                return;
            }
            if (!playerIn) {
                showToast('Please select player to add', 'warning');
                return;
            }
        }
        if (!reason) {
            showToast('Please select reason for change', 'warning');
            return;
        }
        if (reason === 'Other' && !customReason.trim()) {
            showToast('Please specify reason', 'warning');
            return;
        }

        setSaving(true);
        try {
            const finalReason = reason === 'Other' ? customReason : reason;

            await api.put(`/events/${event._id}/squad/change-player`, {
                teamId: team._id,
                outPlayerId: playerOut,
                inPlayerId: changeType === 'replace' ? playerIn : playerOut,
                reason: finalReason.toLowerCase().replace(/\s+/g, ''),
                notes: finalReason
            });

            showToast('Player change recorded successfully', 'success');
            onSuccess();
            onClose();
        } catch (err) {
            console.error('Failed to record player change:', err);
            showToast('Failed: ' + (err.response?.data?.message || err.message), 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
                {/* Header */}
                <div className="bg-gradient-to-r from-orange-600 to-red-600 text-white p-6">
                    <div className="flex justify-between items-center">
                        <div>
                            <h2 className="text-2xl font-black uppercase tracking-tight">Change Player</h2>
                            <p className="text-orange-100 text-sm mt-1">{team.name} - {event.name}</p>
                        </div>
                        <button
                            onClick={onClose}
                            className="text-white hover:bg-white/20 rounded-lg p-2 transition-colors"
                        >
                            ✕
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6 overflow-y-auto max-h-[600px]">
                    {/* Change Type */}
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase mb-3 block">Change Type</label>
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={() => setChangeType('replace')}
                                className={`p-4 rounded-xl border-2 transition-all text-left ${changeType === 'replace' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}
                            >
                                <p className="font-bold text-slate-800">🔄 Replace Player</p>
                                <p className="text-xs text-slate-500 mt-1">Swap one player with another</p>
                            </button>
                            <button
                                onClick={() => setChangeType('injury')}
                                className={`p-4 rounded-xl border-2 transition-all text-left ${changeType === 'injury' ? 'border-red-500 bg-red-50' : 'border-slate-200 hover:border-slate-300'}`}
                            >
                                <p className="font-bold text-slate-800">🏥 Injury Report</p>
                                <p className="text-xs text-slate-500 mt-1">Player injured, may return</p>
                            </button>
                        </div>
                    </div>

                    {/* Player Out */}
                    {changeType && (
                        <>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase mb-3 block">
                                    Player Leaving Squad
                                </label>
                                <select
                                    value={playerOut}
                                    onChange={(e) => setPlayerOut(e.target.value)}
                                    className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-orange-500"
                                >
                                    <option value="">Select Player</option>
                                    {(currentSquad?.players || []).map(player => {
                                        const pid = player._id || player;
                                        const pname = player.name || 'Player';
                                        const prole = player.playingRole || player.role || '';
                                        const isC = currentSquad.captain === pid;
                                        const isVC = currentSquad.viceCaptain === pid;
                                        const isWK = currentSquad.wicketKeepers?.includes(pid);
                                        return (
                                            <option key={pid} value={pid}>
                                                {pname} {prole ? `- ${prole}` : ''}{isC ? ' (C)' : ''}{isVC ? ' (VC)' : ''}{isWK ? ' (WK)' : ''}
                                            </option>
                                        );
                                    })}
                                </select>
                            </div>

                            {/* Player In (for replace type) */}
                            {changeType === 'replace' && (
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase mb-3 block">
                                        Replacement Player
                                    </label>
                                    <select
                                        value={playerIn}
                                        onChange={(e) => setPlayerIn(e.target.value)}
                                        className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500"
                                    >
                                        <option value="">Select Replacement</option>
                                        {availablePlayers.map(player => {
                                            const pid = player._id || player;
                                            const pname = player.name || 'Player';
                                            const prole = player.playingRole || player.role || '';
                                            return (
                                                <option key={pid} value={pid}>
                                                    {pname} {prole ? `- ${prole}` : ''}
                                                </option>
                                            );
                                        })}
                                    </select>
                                    {availablePlayers.length === 0 && (
                                        <p className="text-xs text-red-500 mt-2">No available players outside squad</p>
                                    )}
                                </div>
                            )}

                            {/* Preview */}
                            {playerOutData && playerOutData.name && (
                                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                                    <p className="text-xs font-bold text-red-600 mb-2">PLAYER LEAVING</p>
                                    <div className="flex items-center gap-3">
                                        <div className="w-12 h-12 rounded-full bg-red-200 flex items-center justify-center text-xl font-black text-red-700">
                                            {playerOutData.name.charAt(0)}
                                        </div>
                                        <div>
                                            <p className="font-bold text-slate-800">{playerOutData.name}</p>
                                            <p className="text-xs text-slate-500">{playerOutData.playingRole || playerOutData.role || 'Player'}</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {playerInData && playerInData.name && (
                                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                                    <p className="text-xs font-bold text-green-600 mb-2">PLAYER JOINING</p>
                                    <div className="flex items-center gap-3">
                                        <div className="w-12 h-12 rounded-full bg-green-200 flex items-center justify-center text-xl font-black text-green-700">
                                            {playerInData.name.charAt(0)}
                                        </div>
                                        <div>
                                            <p className="font-bold text-slate-800">{playerInData.name}</p>
                                            <p className="text-xs text-slate-500">{playerInData.playingRole || playerInData.role || 'Player'}</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Reason */}
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase mb-3 block">
                                    Reason for Change
                                </label>
                                <div className="grid grid-cols-2 gap-2 mb-3">
                                    {changeReasons.map(r => (
                                        <button
                                            key={r}
                                            onClick={() => setReason(r)}
                                            className={`py-2 px-3 rounded-lg text-xs font-bold transition-all text-left ${reason === r ? 'bg-orange-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-orange-100'}`}
                                        >
                                            {r === 'Injury' && '🏥 '}
                                            {r === 'Illness' && '🤒 '}
                                            {r === 'Rest/Rotation' && '😴 '}
                                            {r}
                                        </button>
                                    ))}
                                </div>
                                {reason === 'Other' && (
                                    <textarea
                                        value={customReason}
                                        onChange={(e) => setCustomReason(e.target.value)}
                                        placeholder="Please specify the reason..."
                                        className="w-full border border-slate-300 rounded-xl px-4 py-3 h-20 resize-none focus:outline-none focus:ring-2 focus:ring-orange-500"
                                    />
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="border-t border-slate-200 p-4 bg-slate-50 flex gap-3">
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-black text-sm uppercase tracking-widest rounded-xl py-3 transition-all disabled:opacity-50"
                    >
                        {saving ? 'Saving...' : 'Confirm Change'}
                    </button>
                    <button
                        onClick={onClose}
                        className="px-6 bg-slate-200 hover:bg-slate-300 text-slate-700 font-black text-sm uppercase tracking-widest rounded-xl py-3 transition-all"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ChangePlayerModal;
