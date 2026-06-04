import React, { useState } from 'react';
import axios from 'axios';
import api from '../services/api';
import { useToast } from './Toast';
import ConfirmModal from './ConfirmModal';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const MatchSettings = ({ match, onClose, onUpdate }) => {
    const [activeTab, setActiveTab] = useState('overs');
    const [newOvers, setNewOvers] = useState(match.totalOvers || 20);
    const [drsEnabled, setDrsEnabled] = useState(true);
    const [drsRemaining, setDrsRemaining] = useState({ team1: 2, team2: 2 });
    const [superOverEnabled, setSuperOverEnabled] = useState(false);
    const [loading, setLoading] = useState(false);
    const { showToast } = useToast();
    const [confirmModal, setConfirmModal] = useState({ open: false, title: '', message: '', onConfirm: null, variant: 'danger' });

    const handleReduceOvers = async () => {
        if (newOvers < 1 || newOvers > match.totalOvers) {
            showToast(`Overs must be between 1 and ${match.totalOvers}`, 'warning');
            return;
        }

        setLoading(true);
        try {
            await axios.post(
                `${API_URL}/matches/${match._id}/reduce-overs`,
                { overs: newOvers },
                { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }
            );
            showToast(`Overs reduced to ${newOvers}`, 'success');
            onUpdate();
        } catch (err) {
            console.error('Failed to reduce overs:', err);
            showToast('Failed to reduce overs: ' + (err.response?.data?.message || err.message), 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleIncreaseOvers = async () => {
        if (newOvers <= match.totalOvers) {
            showToast(`New overs must be greater than current overs (${match.totalOvers})`, 'warning');
            return;
        }

        setLoading(true);
        try {
            // Update match with new overs
            await api.put(`/matches/${match._id}`, {
                totalOvers: newOvers
            });
            showToast(`Overs increased to ${newOvers}`, 'success');
            onUpdate();
        } catch (err) {
            console.error('Failed to increase overs:', err);
            showToast('Failed to increase overs: ' + (err.response?.data?.message || err.message), 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleDRSReview = async (teamId) => {
        if (drsRemaining[`team${teamId === match.teams?.[0]?._id ? '1' : '2'}`] <= 0) {
            showToast('No DRS reviews remaining for this team', 'warning');
            return;
        }

        // In a real implementation, this would trigger a review process
        showToast(`DRS review requested by ${match.teams?.find(t => t._id === teamId)?.name}. Umpire to review.`, 'info');
        setDrsRemaining(prev => ({
            ...prev,
            [`team${teamId === match.teams?.[0]?._id ? '1' : '2'}`]: prev[`team${teamId === match.teams?.[0]?._id ? '1' : '2'}`] - 1
        }));
    };

    const handleSuperOver = () => {
        setConfirmModal({ open: true, title: 'Start Super Over', message: 'Start Super Over? This will reset the match for a single over decider.', confirmLabel: 'Start', variant: 'danger', onConfirm: async () => { setConfirmModal({ open: false }); doSuperOver(); } });
    };

    const doSuperOver = async () => {
        setLoading(true);
        try {
            await axios.post(
                `${API_URL}/matches/${match._id}/start-super-over`,
                {},
                { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }
            );
            showToast('Super Over started!', 'success');
            onUpdate();
            onClose();
        } catch (err) {
            console.error('Failed to start super over:', err);
            showToast('Failed to start super over: ' + (err.response?.data?.message || err.message), 'error');
        } finally {
            setLoading(false);
        }
    };

    return (<>
        <ConfirmModal
            open={confirmModal.open}
            title={confirmModal.title}
            message={confirmModal.message}
            confirmLabel={confirmModal.confirmLabel}
            variant={confirmModal.variant}
            onConfirm={confirmModal.onConfirm}
            onCancel={() => setConfirmModal({ open: false })}
        />
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
                {/* Header */}
                <div className="bg-gradient-to-r from-[#031d44] to-[#0a2d5e] text-white p-6">
                    <div className="flex justify-between items-center">
                        <div>
                            <h2 className="text-2xl font-black uppercase tracking-tight">Match Settings</h2>
                            <p className="text-blue-200 text-sm mt-1">
                                {match.teams?.[0]?.name || 'Team A'} vs {match.teams?.[1]?.name || 'Team B'}
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            className="text-white hover:bg-white/20 rounded-lg p-2 transition-colors"
                        >
                            ✕
                        </button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-slate-200">
                    {[
                        { key: 'overs', label: '🔄 Overs' },
                        { key: 'drs', label: '🎯 DRS' },
                        { key: 'superover', label: '⚡ Super Over' }
                    ].map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            className={`flex-1 py-3 text-xs font-black uppercase tracking-widest transition-all ${activeTab === tab.key ? 'bg-[#031d44] text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto max-h-[400px]">
                    {/* Overs Tab */}
                    {activeTab === 'overs' && (
                        <div className="space-y-6">
                            <div>
                                <h3 className="text-sm font-black text-[#031d44] uppercase mb-3">Adjust Overs</h3>
                                <div className="bg-slate-50 rounded-xl p-4 mb-4">
                                    <p className="text-xs text-slate-500 mb-1">Current Overs</p>
                                    <p className="text-3xl font-black text-[#031d44]">{match.totalOvers || 20}</p>
                                </div>
                                <div className="mb-4">
                                    <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">New Overs</label>
                                    <input
                                        type="number"
                                        value={newOvers}
                                        onChange={(e) => setNewOvers(Number(e.target.value))}
                                        min="1"
                                        max="90"
                                        className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <button
                                        onClick={handleReduceOvers}
                                        disabled={loading || newOvers >= match.totalOvers}
                                        className="bg-orange-600 hover:bg-orange-700 text-white py-3 rounded-xl font-black text-xs uppercase tracking-widest disabled:opacity-50"
                                    >
                                        Reduce Overs
                                    </button>
                                    <button
                                        onClick={handleIncreaseOvers}
                                        disabled={loading || newOvers <= match.totalOvers}
                                        className="bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl font-black text-xs uppercase tracking-widest disabled:opacity-50"
                                    >
                                        Increase Overs
                                    </button>
                                </div>
                            </div>

                            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                                <p className="text-xs font-bold text-blue-700 mb-2">ℹ️ Note</p>
                                <ul className="text-xs text-blue-600 space-y-1">
                                    <li>• Reducing overs affects the target score</li>
                                    <li>• Increasing overs is common in tape ball matches</li>
                                    <li>• DLS method may apply for rain interruptions</li>
                                </ul>
                            </div>
                        </div>
                    )}

                    {/* DRS Tab */}
                    {activeTab === 'drs' && (
                        <div className="space-y-6">
                            <div>
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-sm font-black text-[#031d44] uppercase">Decision Review System</h3>
                                    <label className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={drsEnabled}
                                            onChange={(e) => setDrsEnabled(e.target.checked)}
                                            className="w-4 h-4"
                                        />
                                        <span className="text-xs font-bold text-slate-600">Enable DRS</span>
                                    </label>
                                </div>

                                {drsEnabled && (
                                    <div className="space-y-4">
                                        {match.teams?.map((team, idx) => (
                                            <div key={team._id} className="bg-slate-50 rounded-xl p-4">
                                                <div className="flex items-center justify-between mb-3">
                                                    <h4 className="font-bold text-sm text-slate-800">{team.name}</h4>
                                                    <span className="text-lg font-black text-blue-600">
                                                        {drsRemaining[`team${idx + 1}`]} reviews left
                                                    </span>
                                                </div>
                                                <button
                                                    onClick={() => handleDRSReview(team._id)}
                                                    disabled={drsRemaining[`team${idx + 1}`] <= 0}
                                                    className="w-full bg-red-600 hover:bg-red-700 text-white py-2 rounded-xl font-bold text-xs uppercase disabled:opacity-50"
                                                >
                                                    Request Review
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                                <p className="text-xs font-bold text-blue-700 mb-2">ℹ️ DRS Rules</p>
                                <ul className="text-xs text-blue-600 space-y-1">
                                    <li>• Each team gets 2 reviews per innings</li>
                                    <li>• Unsuccessful reviews are lost</li>
                                    <li>• Third umpire reviews using technology</li>
                                    <li>• Decision can be overturned or upheld</li>
                                </ul>
                            </div>
                        </div>
                    )}

                    {/* Super Over Tab */}
                    {activeTab === 'superover' && (
                        <div className="space-y-6">
                            <div>
                                <h3 className="text-sm font-black text-[#031d44] uppercase mb-3">Super Over</h3>
                                <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-4">
                                    <p className="text-xs font-bold text-orange-700 mb-2">⚠️ When to Use Super Over</p>
                                    <ul className="text-xs text-orange-600 space-y-1">
                                        <li>• Match is tied after regular overs</li>
                                        <li>• Knockout/elimination matches only</li>
                                        <li>• Both teams bat for 1 over each</li>
                                        <li>• Highest score wins</li>
                                    </ul>
                                </div>

                                <label className="flex items-center gap-2 mb-4">
                                    <input
                                        type="checkbox"
                                        checked={superOverEnabled}
                                        onChange={(e) => setSuperOverEnabled(e.target.checked)}
                                        className="w-4 h-4"
                                    />
                                    <span className="text-xs font-bold text-slate-600">Enable Super Option</span>
                                </label>

                                {superOverEnabled && (
                                    <button
                                        onClick={handleSuperOver}
                                        disabled={loading}
                                        className="w-full bg-[#031d44] hover:bg-slate-800 text-white py-4 rounded-xl font-black text-sm uppercase tracking-widest disabled:opacity-50"
                                    >
                                        Start Super Over
                                    </button>
                                )}
                            </div>

                            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                                <p className="text-xs font-bold text-blue-700 mb-2">ℹ️ Super Over Rules</p>
                                <ul className="text-xs text-blue-600 space-y-1">
                                    <li>• Each team selects 3 batsmen</li>
                                    <li>• Different bowler must bowl (not from last over)</li>
                                    <li>• If still tied, continue with more super overs</li>
                                    <li>• Boundary count doesn't decide winner</li>
                                </ul>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="border-t border-slate-200 p-4 bg-slate-50">
                    <button
                        onClick={onClose}
                        className="w-full bg-slate-200 hover:bg-slate-300 text-[#031d44] font-black text-sm uppercase tracking-widest rounded-xl py-3"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
        </>
    );
};

export default MatchSettings;
