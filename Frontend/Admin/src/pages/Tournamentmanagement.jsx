import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import api from '../services/api';
import { useToast } from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';

const TournamentManagement = () => {
    const { register, handleSubmit, reset, setValue } = useForm();
    const [tournaments, setTournaments] = useState([]);
    const [loading, setLoading] = useState(false);
    const { showToast } = useToast();
    const [confirmModal, setConfirmModal] = useState({ open: false, title: '', message: '', onConfirm: null, variant: 'danger' });
    const [editMode, setEditMode] = useState(false);
    const [currentTournament, setCurrentTournament] = useState(null);
    const [showDetailsModal, setShowDetailsModal] = useState(false);
    const [detailsTab, setDetailsTab] = useState('fixtures');
    const [showCreateMatch, setShowCreateMatch] = useState(false);
    const [matchForm, setMatchForm] = useState({ team1: '', team2: '', venue: '', startTime: '' });

    const fetchTournaments = async () => {
        setLoading(true);
        try {
            const res = await api.get('/tournaments');
            setTournaments(res.data.data || res.data);
        } catch (err) {
            console.error('Failed to fetch tournaments:', err);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchTournaments();
    }, []);

    const onSubmit = async (data) => {
        try {
            if (editMode) {
                await api.put(`/tournaments/${currentTournament._id}`, data);
            } else {
                await api.post('/tournaments', data);
            }
            reset();
            setEditMode(false);
            setCurrentTournament(null);
            fetchTournaments();
        } catch (err) {
            console.error('Failed to save tournament:', err);
            showToast('Failed to save tournament', 'error');
        }
    };

    const handleEdit = (tournament) => {
        setEditMode(true);
        setCurrentTournament(tournament);
        setValue('name', tournament.name);
        setValue('shortName', tournament.shortName);
        setValue('type', tournament.type);
        setValue('format', tournament.format);
        setValue('startDate', tournament.startDate);
        setValue('endDate', tournament.endDate);
        setValue('venue', tournament.venue);
    };

    const handleDelete = (id) => {
        setConfirmModal({ open: true, title: 'Delete Tournament', message: 'Are you sure you want to delete this tournament?', confirmLabel: 'Delete', variant: 'danger', onConfirm: async () => { setConfirmModal({ open: false }); try { await api.delete(`/tournaments/${id}`); fetchTournaments(); } catch (err) { console.error('Failed to delete tournament:', err); } } });
    };

    const viewDetails = (tournament) => {
        setCurrentTournament(tournament);
        setShowDetailsModal(true);
        setDetailsTab('fixtures');
    };

    const createMatchInTournament = async () => {
        try {
            await api.post(`/tournaments/${currentTournament._id}/matches`, matchForm);
            setShowCreateMatch(false);
            setMatchForm({ team1: '', team2: '', venue: '', startTime: '' });
            fetchTournaments();
        } catch (err) {
            console.error('Failed to create match:', err);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-6 lg:p-10">
            <h1 className="text-4xl lg:text-5xl font-black text-[#031d44] mb-8">Tournament Management</h1>

            {/* Tournament Form */}
            <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6 mb-8">
                <h2 className="text-2xl font-bold text-[#031d44] mb-4">
                    {editMode ? 'Edit Tournament' : 'Create New Tournament'}
                </h2>
                <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <input
                        {...register('name', { required: true })}
                        placeholder="Tournament Name"
                        className="border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
                    />
                    <input
                        {...register('shortName', { required: true })}
                        placeholder="Short Name"
                        className="border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
                    />
                    <select
                        {...register('type')}
                        className="border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
                    >
                        <option value="">Tournament Type</option>
                        <option value="League">League</option>
                        <option value="Knockout">Knockout</option>
                        <option value="Round Robin">Round Robin</option>
                    </select>
                    <select
                        {...register('format')}
                        className="border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
                    >
                        <option value="">Format</option>
                        <option value="T6">T6</option>
                        <option value="T8">T8</option>
                        <option value="T10">T10</option>
                        <option value="T20">T20</option>
                        <option value="ODI">ODI</option>
                        <option value="Test">Test</option>
                    </select>
                    <input
                        {...register('startDate')}
                        type="date"
                        className="border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
                    />
                    <input
                        {...register('endDate')}
                        type="date"
                        className="border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
                    />
                    <input
                        {...register('venue')}
                        placeholder="Venue"
                        className="border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
                    />
                    <div className="flex gap-2">
                        <button
                            type="submit"
                            className="bg-[#031d44] hover:bg-slate-800 text-white font-black text-xs uppercase tracking-widest rounded-xl px-6 py-3"
                        >
                            {editMode ? 'Update' : 'Create'}
                        </button>
                        {editMode && (
                            <button
                                type="button"
                                onClick={() => {
                                    reset();
                                    setEditMode(false);
                                    setCurrentTournament(null);
                                }}
                                className="bg-slate-200 hover:bg-slate-300 text-[#031d44] font-black text-xs uppercase tracking-widest rounded-xl px-6 py-3"
                            >
                                Cancel
                            </button>
                        )}
                    </div>
                </form>
            </div>

            {/* Tournament List */}
            <div className="space-y-4">
                {loading ? (
                    <div className="text-center py-10 text-slate-500">Loading tournaments...</div>
                ) : (
                    tournaments.map((tournament) => (
                        <div
                            key={tournament._id}
                            className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6"
                        >
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <div className="flex-1">
                                    <div className="flex items-center gap-3 mb-2">
                                        <span className="bg-[#031d44] text-white text-xs font-black uppercase tracking-widest px-3 py-1 rounded-lg">
                                            {tournament.type}
                                        </span>
                                        <span className="bg-blue-100 text-[#031d44] text-xs font-bold px-3 py-1 rounded-lg">
                                            {tournament.format}
                                        </span>
                                    </div>
                                    <h3 className="text-xl font-bold text-[#031d44]">{tournament.name}</h3>
                                    <p className="text-slate-500 text-sm">
                                        {tournament.venue} | {tournament.startDate} - {tournament.endDate}
                                    </p>
                                    <p className="text-slate-500 text-sm">
                                        Teams: {tournament.teams?.length || 0} | Matches: {tournament.matches?.length || 0}
                                    </p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        onClick={() => viewDetails(tournament)}
                                        className="bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-widest rounded-xl px-4 py-2"
                                    >
                                        View Details
                                    </button>
                                    <button
                                        onClick={() => handleEdit(tournament)}
                                        className="bg-[#031d44] hover:bg-slate-800 text-white font-black text-xs uppercase tracking-widest rounded-xl px-4 py-2"
                                    >
                                        Edit
                                    </button>
                                    <button
                                        onClick={() => handleDelete(tournament._id)}
                                        className="bg-red-600 hover:bg-red-700 text-white font-black text-xs uppercase tracking-widest rounded-xl px-4 py-2"
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Tournament Details Modal */}
            {showDetailsModal && currentTournament && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
                        <div className="bg-[#031d44] text-white p-4 flex justify-between items-center">
                            <h2 className="text-xl font-bold">{currentTournament.name}</h2>
                            <button
                                onClick={() => setShowDetailsModal(false)}
                                className="text-2xl hover:text-slate-300"
                            >
                                &times;
                            </button>
                        </div>

                        {/* Tabs */}
                        <div className="flex border-b border-slate-200">
                            {['fixtures', 'points', 'rankings'].map((tab) => (
                                <button
                                    key={tab}
                                    onClick={() => setDetailsTab(tab)}
                                    className={`flex-1 py-3 font-bold text-sm uppercase tracking-wider ${detailsTab === tab
                                            ? 'bg-[#031d44] text-white'
                                            : 'text-slate-600 hover:bg-slate-100'
                                        }`}
                                >
                                    {tab === 'fixtures' ? 'Fixtures' : tab === 'points' ? 'Points Table' : 'Rankings'}
                                </button>
                            ))}
                        </div>

                        <div className="overflow-y-auto max-h-[60vh] p-6">
                            {detailsTab === 'fixtures' && (
                                <div>
                                    <button
                                        onClick={() => setShowCreateMatch(true)}
                                        className="bg-[#031d44] hover:bg-slate-800 text-white font-black text-xs uppercase tracking-widest rounded-xl px-6 py-3 mb-4"
                                    >
                                        Create Match
                                    </button>
                                    {currentTournament.matches?.length === 0 ? (
                                        <p className="text-slate-500">No matches scheduled yet.</p>
                                    ) : (
                                        <div className="space-y-3">
                                            {currentTournament.matches?.map((match, idx) => (
                                                <div key={idx} className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                                                    <p className="font-bold text-[#031d44]">
                                                        {match.team1?.name || 'TBD'} vs {match.team2?.name || 'TBD'}
                                                    </p>
                                                    <p className="text-sm text-slate-500">{match.venue} | {match.startTime}</p>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {detailsTab === 'points' && (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-[#031d44] text-white">
                                                <th className="px-4 py-3 text-left">Pos</th>
                                                <th className="px-4 py-3 text-left">Team</th>
                                                <th className="px-4 py-3 text-center">M</th>
                                                <th className="px-4 py-3 text-center">W</th>
                                                <th className="px-4 py-3 text-center">L</th>
                                                <th className="px-4 py-3 text-center">NRR</th>
                                                <th className="px-4 py-3 text-center">PTS</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {currentTournament.pointsTable?.map((row, idx) => (
                                                <tr key={idx} className="border-b border-slate-200 hover:bg-slate-50">
                                                    <td className="px-4 py-3 font-bold">{idx + 1}</td>
                                                    <td className="px-4 py-3 font-bold text-[#031d44]">{row.team}</td>
                                                    <td className="px-4 py-3 text-center">{row.matched}</td>
                                                    <td className="px-4 py-3 text-center">{row.won}</td>
                                                    <td className="px-4 py-3 text-center">{row.lost}</td>
                                                    <td className="px-4 py-3 text-center">{row.nrr}</td>
                                                    <td className="px-4 py-3 text-center font-black">{row.points}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {detailsTab === 'rankings' && (
                                <div>
                                    <h3 className="font-bold text-[#031d44] mb-4">Player Rankings</h3>
                                    <p className="text-slate-500">Rankings will be displayed here based on match performance.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Create Match Modal */}
            {showCreateMatch && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
                        <h2 className="text-xl font-bold text-[#031d44] mb-4">Create Match</h2>
                        <div className="space-y-4">
                            <input
                                value={matchForm.team1}
                                onChange={(e) => setMatchForm({ ...matchForm, team1: e.target.value })}
                                placeholder="Team 1 ID"
                                className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
                            />
                            <input
                                value={matchForm.team2}
                                onChange={(e) => setMatchForm({ ...matchForm, team2: e.target.value })}
                                placeholder="Team 2 ID"
                                className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
                            />
                            <input
                                value={matchForm.venue}
                                onChange={(e) => setMatchForm({ ...matchForm, venue: e.target.value })}
                                placeholder="Venue"
                                className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
                            />
                            <input
                                value={matchForm.startTime}
                                onChange={(e) => setMatchForm({ ...matchForm, startTime: e.target.value })}
                                type="datetime-local"
                                className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
                            />
                            <div className="flex gap-2">
                                <button
                                    onClick={createMatchInTournament}
                                    className="bg-[#031d44] hover:bg-slate-800 text-white font-black text-xs uppercase tracking-widest rounded-xl px-6 py-3"
                                >
                                    Create
                                </button>
                                <button
                                    onClick={() => setShowCreateMatch(false)}
                                    className="bg-slate-200 hover:bg-slate-300 text-[#031d44] font-black text-xs uppercase tracking-widest rounded-xl px-6 py-3"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            <ConfirmModal
                open={confirmModal.open}
                title={confirmModal.title}
                message={confirmModal.message}
                confirmLabel={confirmModal.confirmLabel}
                variant={confirmModal.variant}
                onConfirm={confirmModal.onConfirm}
                onCancel={() => setConfirmModal({ open: false })}
            />
        </div>
    );
};

export default TournamentManagement;
