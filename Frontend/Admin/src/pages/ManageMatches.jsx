import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useForm } from 'react-hook-form';
import {
    fetchMatches,
    createMatch,
    updateMatch,
    deleteMatch,
    setPlayingXI,
} from '../store/slices/matchesSlice';
import { fetchTeams } from '../store/slices/teamSlice';
import { initSocket } from '../store/socket';
import { useToast } from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';

const matchTypes = ['T6', 'T8', 'T10', 'T20', 'ODI', 'Test', 'Tape Ball'];

const ManageMatches = () => {
    const dispatch = useDispatch();
    const { matches, loading } = useSelector((state) => state.matches);
    const { teams } = useSelector((state) => state.teams);
    const { register, handleSubmit, reset, setValue, watch } = useForm();
    const [editMode, setEditMode] = useState(false);
    const [currentMatch, setCurrentMatch] = useState(null);
    const [showXIModal, setShowXIModal] = useState(false);
    const [xiTeam, setXiTeam] = useState(null);
    const [selectedXI, setSelectedXI] = useState([]);
    const [xiSearch, setXiSearch] = useState('');
    const { showToast } = useToast();
    const [confirmModal, setConfirmModal] = useState({ open: false, title: '', message: '', onConfirm: null, variant: 'danger' });

    const team1Id = watch('team1');
    const matchType = watch('matchType');

    useEffect(() => {
        dispatch(fetchMatches());
        dispatch(fetchTeams());
        const socket = initSocket();
        if (socket) {
            socket.on('match:created', () => dispatch(fetchMatches()));
            socket.on('match:updated', () => dispatch(fetchMatches()));
            socket.on('match:deleted', () => dispatch(fetchMatches()));
            socket.on('match:updateList', () => dispatch(fetchMatches()));
        }
        return () => {
            if (socket) socket.disconnect();
        };
    }, [dispatch]);

    const onSubmit = async (data) => {
        const payload = {
            ...data,
            team1: data.team1,
            team2: data.team2,
            matchType: data.matchType,
            venue: data.venue,
            startTime: data.startTime,
            powerplayOvers: data.powerplayOvers ? Number(data.powerplayOvers) : undefined,
            overs: data.overs ? Number(data.overs) : undefined,
        };
        if (editMode) {
            await dispatch(updateMatch({ id: currentMatch._id, data: payload }));
        } else {
            await dispatch(createMatch(payload));
        }
        reset();
        setEditMode(false);
        setCurrentMatch(null);
        dispatch(fetchMatches());
    };

    const handleEdit = (match) => {
        setEditMode(true);
        setCurrentMatch(match);
        setValue('team1', match.team1?._id || match.team1);
        setValue('team2', match.team2?._id || match.team2);
        setValue('matchType', match.matchType);
        setValue('venue', match.venue);
        setValue('startTime', match.startTime);
        setValue('powerplayOvers', match.powerplayOvers);
        setValue('overs', match.overs);
    };

    const handleDelete = (id) => {
        setConfirmModal({ open: true, title: 'Delete Match', message: 'Are you sure you want to delete this match?', confirmLabel: 'Delete', variant: 'danger', onConfirm: async () => { setConfirmModal({ open: false }); await dispatch(deleteMatch(id)); dispatch(fetchMatches()); } });
    };

    const openXIModal = (match, teamId) => {
        const team = teams.find((t) => t._id === teamId);
        setXiTeam(team);
        setSelectedXI(match.playingXI?.[teamId] || []);
        setShowXIModal(true);
        setXiSearch('');
    };

    const toggleXIPlayer = (playerId) => {
        setSelectedXI((prev) => {
            if (prev.includes(playerId)) {
                return prev.filter((id) => id !== playerId);
            }
            if (prev.length >= 11) return prev;
            return [...prev, playerId];
        });
    };

    const saveXI = async () => {
        if (selectedXI.length !== 11) {
            showToast('Please select exactly 11 players', 'warning');
            return;
        }
        await dispatch(
            setPlayingXI({
                matchId: currentMatch?._id || xiTeam?._id,
                teamId: xiTeam._id,
                playingXI: selectedXI,
            })
        );
        setShowXIModal(false);
        dispatch(fetchMatches());
    };

    const team1 = teams.find((t) => t._id === team1Id);

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-6 lg:p-10">
            <h1 className="text-4xl lg:text-5xl font-black text-[#031d44] mb-8">Manage Matches</h1>

            {/* Match Form */}
            <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6 mb-8">
                <h2 className="text-2xl font-bold text-[#031d44] mb-4">
                    {editMode ? 'Edit Match' : 'Create New Match'}
                </h2>
                <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <select
                        {...register('team1', { required: true })}
                        className="border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
                    >
                        <option value="">Select Team 1</option>
                        {teams.map((t) => (
                            <option key={t._id} value={t._id}>{t.name}</option>
                        ))}
                    </select>
                    <select
                        {...register('team2', { required: true })}
                        className="border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
                    >
                        <option value="">Select Team 2</option>
                        {teams.map((t) => (
                            <option key={t._id} value={t._id}>{t.name}</option>
                        ))}
                    </select>
                    <select
                        {...register('matchType', { required: true })}
                        className="border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
                    >
                        <option value="">Match Type</option>
                        {matchTypes.map((type) => (
                            <option key={type} value={type}>{type}</option>
                        ))}
                    </select>
                    <input
                        {...register('venue', { required: true })}
                        placeholder="Venue"
                        className="border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
                    />
                    <input
                        {...register('startTime', { required: true })}
                        type="datetime-local"
                        className="border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
                    />
                    <input
                        {...register('overs')}
                        type="number"
                        placeholder="Overs (optional)"
                        className="border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
                    />
                    <input
                        {...register('powerplayOvers')}
                        type="number"
                        placeholder="Powerplay Overs"
                        className="border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
                    />
                    <div className="flex gap-2 col-span-full">
                        <button
                            type="submit"
                            className="bg-[#031d44] hover:bg-slate-800 text-white font-black text-xs uppercase tracking-widest rounded-xl px-6 py-3"
                        >
                            {editMode ? 'Update Match' : 'Create Match'}
                        </button>
                        {editMode && (
                            <button
                                type="button"
                                onClick={() => {
                                    reset();
                                    setEditMode(false);
                                    setCurrentMatch(null);
                                }}
                                className="bg-slate-200 hover:bg-slate-300 text-[#031d44] font-black text-xs uppercase tracking-widest rounded-xl px-6 py-3"
                            >
                                Cancel
                            </button>
                        )}
                    </div>
                </form>
            </div>

            {/* Match List */}
            <div className="space-y-4">
                {matches.map((match) => (
                    <div
                        key={match._id}
                        className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6"
                    >
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="flex-1">
                                <div className="flex items-center gap-4 mb-2">
                                    <span className="bg-[#031d44] text-white text-xs font-black uppercase tracking-widest px-3 py-1 rounded-lg">
                                        {match.matchType}
                                    </span>
                                    <span className="text-slate-500 text-sm">{match.venue}</span>
                                </div>
                                <h3 className="text-xl font-bold text-[#031d44]">
                                    {match.team1?.name || 'TBD'} vs {match.team2?.name || 'TBD'}
                                </h3>
                                <p className="text-slate-500 text-sm">
                                    {new Date(match.startTime).toLocaleString()}
                                </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {match.team1 && (
                                    <button
                                        onClick={() => openXIModal(match, match.team1._id)}
                                        className="bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-widest rounded-xl px-4 py-2"
                                    >
                                        XI: {match.team1.name}
                                    </button>
                                )}
                                {match.team2 && (
                                    <button
                                        onClick={() => openXIModal(match, match.team2._id)}
                                        className="bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-widest rounded-xl px-4 py-2"
                                    >
                                        XI: {match.team2.name}
                                    </button>
                                )}
                                <button
                                    onClick={() => handleEdit(match)}
                                    className="bg-[#031d44] hover:bg-slate-800 text-white font-black text-xs uppercase tracking-widest rounded-xl px-4 py-2"
                                >
                                    Edit
                                </button>
                                <button
                                    onClick={() => handleDelete(match._id)}
                                    className="bg-red-600 hover:bg-red-700 text-white font-black text-xs uppercase tracking-widest rounded-xl px-4 py-2"
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Playing XI Modal */}
            {showXIModal && xiTeam && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
                        <div className="bg-[#031d44] text-white p-4 flex justify-between items-center">
                            <h2 className="text-xl font-bold">Select Playing XI - {xiTeam.name}</h2>
                            <button
                                onClick={() => setShowXIModal(false)}
                                className="text-2xl hover:text-slate-300"
                            >
                                &times;
                            </button>
                        </div>
                        <div className="p-4 border-b border-slate-200">
                            <input
                                type="text"
                                placeholder="Search players..."
                                value={xiSearch}
                                onChange={(e) => setXiSearch(e.target.value)}
                                className="w-full border border-slate-300 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
                            />
                            <p className="text-sm text-slate-500 mt-2">
                                Selected: {selectedXI.length}/11
                            </p>
                        </div>
                        <div className="overflow-y-auto max-h-[50vh] p-4">
                            {xiTeam.players
                                ?.filter((p) => p.name?.toLowerCase().includes(xiSearch.toLowerCase()))
                                .map((player) => (
                                    <div
                                        key={player._id || player}
                                        onClick={() => toggleXIPlayer(player._id || player)}
                                        className={`flex items-center justify-between p-3 mb-2 rounded-xl cursor-pointer border-2 transition-all ${selectedXI.includes(player._id || player)
                                                ? 'border-[#031d44] bg-blue-50'
                                                : 'border-slate-200 hover:border-slate-400'
                                            }`}
                                    >
                                        <div>
                                            <p className="font-bold text-[#031d44]">{player.name || 'Player'}</p>
                                            <p className="text-sm text-slate-500">{player.role}</p>
                                        </div>
                                        <div
                                            className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${selectedXI.includes(player._id || player)
                                                    ? 'bg-[#031d44] border-[#031d44]'
                                                    : 'border-slate-300'
                                                }`}
                                        >
                                            {selectedXI.includes(player._id || player) && (
                                                <span className="text-white text-xs">&#10003;</span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                        </div>
                        <div className="p-4 border-t border-slate-200">
                            <button
                                onClick={saveXI}
                                disabled={selectedXI.length !== 11}
                                className={`w-full font-black text-xs uppercase tracking-widest rounded-xl px-6 py-3 ${selectedXI.length === 11
                                        ? 'bg-[#031d44] hover:bg-slate-800 text-white'
                                        : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                                    }`}
                            >
                                Save Playing XI
                            </button>
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

export default ManageMatches;
