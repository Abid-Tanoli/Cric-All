import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useToast } from './Toast';

const TossManager = ({ match, onClose, onSuccess }) => {
    const [tossWinner, setTossWinner] = useState('');
    const [tossDecision, setTossDecision] = useState('');
    const [tossTime, setTossTime] = useState(null);
    const [tossCompleted, setTossCompleted] = useState(false);
    const [tossInterrupted, setTossInterrupted] = useState(false);
    const [interruptReason, setInterruptReason] = useState('');
    const [saving, setSaving] = useState(false);
    const { showToast } = useToast();

    useEffect(() => {
        if (match?.tossWinner) {
            setTossWinner(match.tossWinner);
            setTossDecision(match.tossDecision || '');
            setTossCompleted(true);
        }

        // Calculate toss window (30 minutes before match)
        if (match?.startAt) {
            const matchTime = new Date(match.startAt);
            const tossWindowStart = new Date(matchTime.getTime() - 30 * 60000);
            const tossWindowEnd = matchTime;
            setTossTime({ start: tossWindowStart, end: tossWindowEnd });
        }
    }, [match]);

    const handleToss = async () => {
        if (!tossWinner) {
            showToast('Please select toss winner', 'warning');
            return;
        }
        if (!tossDecision) {
            showToast('Please select toss decision', 'warning');
            return;
        }

        setSaving(true);
        try {
            await api.put(`/matches/${match._id}/toss`, {
                tossWinnerId: tossWinner,
                decision: tossDecision
            });
            setTossCompleted(true);
            onSuccess();
        } catch (err) {
            console.error('Failed to record toss:', err);
            showToast('Failed to record toss: ' + (err.response?.data?.message || err.message), 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleInterrupt = async () => {
        if (!interruptReason) {
            showToast('Please select interrupt reason', 'warning');
            return;
        }

        setSaving(true);
        try {
            // Update match status to interrupted
            await api.put(`/matches/${match._id}`, {
                status: 'interrupted',
                interruptReason
            });
            setTossInterrupted(true);
            showToast(`Toss interrupted: ${interruptReason}. You can retry when conditions improve.`, 'info');
        } catch (err) {
            console.error('Failed to record interrupt:', err);
            showToast('Failed to record interrupt: ' + (err.response?.data?.message || err.message), 'error');
        } finally {
            setSaving(false);
        }
    };

    const isWithinTossWindow = () => {
        if (!tossTime) return true; // Allow if toss time not set
        const now = new Date();
        return now >= tossTime.start && now <= tossTime.end;
    };

    const timeUntilToss = () => {
        if (!tossTime) return '';
        const now = new Date();
        if (now < tossTime.start) {
            const diff = tossTime.start - now;
            const minutes = Math.floor(diff / 60000);
            return `Toss window opens in ${minutes} minutes`;
        }
        if (now > tossTime.end) {
            return 'Toss window has closed';
        }
        const diff = tossTime.end - now;
        const minutes = Math.floor(diff / 60000);
        return `Toss window closes in ${minutes} minutes`;
    };

    const withinWindow = isWithinTossWindow();

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
                {/* Header */}
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h2 className="text-2xl font-black text-[#031d44]">Toss Manager</h2>
                        <p className="text-sm text-slate-500 mt-1">
                            {match.teams?.[0]?.name || 'Team A'} vs {match.teams?.[1]?.name || 'Team B'}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 text-2xl font-bold"
                    >
                        ✕
                    </button>
                </div>

                {/* Toss Window Info */}
                {tossTime && (
                    <div className={`p-4 rounded-xl mb-6 ${withinWindow ? 'bg-green-50 border border-green-200' : 'bg-orange-50 border border-orange-200'}`}>
                        <div className="flex items-center gap-3">
                            <span className="text-2xl">{withinWindow ? '✅' : '⏰'}</span>
                            <div>
                                <p className={`font-bold text-sm ${withinWindow ? 'text-green-700' : 'text-orange-700'}`}>
                                    {withinWindow ? 'Toss Window is OPEN' : 'Toss Window Status'}
                                </p>
                                <p className="text-xs text-slate-600 mt-1">{timeUntilToss()}</p>
                                <p className="text-xs text-slate-500 mt-1">
                                    Opens: {tossTime.start.toLocaleTimeString()} | Closes: {tossTime.end.toLocaleTimeString()}
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {tossCompleted && (
                    <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6">
                        <p className="font-bold text-green-700">✓ Toss Completed</p>
                        <p className="text-sm text-green-600 mt-1">
                            {(() => {
                                const winnerId = typeof tossWinner === 'object' ? tossWinner?._id : tossWinner;
                                return match.teams?.find(t => (t._id || t) === winnerId)?.name || match.tossWinner?.name || "Team";
                            })()} won the toss and elected to {tossDecision}
                        </p>
                    </div>
                )}

                {/* Interrupt Status */}
                {tossInterrupted && (
                    <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-6">
                        <p className="font-bold text-orange-700">⚠ Toss Interrupted</p>
                        <p className="text-sm text-orange-600 mt-1">Reason: {interruptReason}</p>
                        <p className="text-xs text-orange-500 mt-2">You can retry the toss when conditions improve</p>
                    </div>
                )}

                {/* Toss Winner */}
                <div className="mb-4">
                    <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Toss Winner</label>
                    <div className="grid grid-cols-2 gap-3">
                        {match.teams?.map(team => (
                            <button
                                key={team._id}
                                onClick={() => setTossWinner(team._id)}
                                className={`py-3 rounded-xl font-bold text-sm transition-all ${tossWinner === team._id ? 'bg-[#031d44] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                            >
                                {team.name}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Toss Decision */}
                <div className="mb-6">
                    <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Decision</label>
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            onClick={() => setTossDecision('bat')}
                            className={`py-3 rounded-xl font-bold text-sm transition-all ${tossDecision === 'bat' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-blue-100'}`}
                        >
                            🏏 Bat
                        </button>
                        <button
                            onClick={() => setTossDecision('bowl')}
                            className={`py-3 rounded-xl font-bold text-sm transition-all ${tossDecision === 'bowl' ? 'bg-green-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-green-100'}`}
                        >
                            ⚾ Bowl
                        </button>
                    </div>
                </div>

                {/* Interrupt Section */}
                {!tossCompleted && (
                    <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
                        <p className="text-xs font-bold text-red-600 uppercase mb-3">⚠ Toss Interrupt (Bad Light/Rain)</p>
                        <div className="grid grid-cols-2 gap-2 mb-3">
                            {['Bad Light', 'Rain', 'Wet Outfield', 'Other'].map(reason => (
                                <button
                                    key={reason}
                                    onClick={() => setInterruptReason(reason)}
                                    className={`py-2 rounded-lg text-xs font-bold transition-all ${interruptReason === reason ? 'bg-red-600 text-white' : 'bg-white text-slate-600 hover:bg-red-100 border border-red-200'}`}
                                >
                                    {reason}
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={handleInterrupt}
                            disabled={!interruptReason || saving}
                            className="w-full bg-red-600 hover:bg-red-700 text-white py-2 rounded-xl font-black text-xs uppercase tracking-widest disabled:opacity-50"
                        >
                            Record Interrupt
                        </button>
                    </div>
                )}

                {/* Actions */}
                <div className="flex gap-3">
                    {!tossCompleted && (
                        <button
                            onClick={handleToss}
                            disabled={saving || !tossWinner || !tossDecision}
                            className="flex-1 bg-[#031d44] hover:bg-slate-800 text-white py-3 rounded-xl font-black text-sm uppercase tracking-widest disabled:opacity-50"
                        >
                            {saving ? 'Recording...' : 'Record Toss'}
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="px-6 bg-slate-200 hover:bg-slate-300 text-[#031d44] font-black text-sm uppercase tracking-widest rounded-xl py-3"
                    >
                        {tossCompleted ? 'Close' : 'Cancel'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TossManager;
