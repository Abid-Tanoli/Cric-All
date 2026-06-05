import React, { useEffect, useState, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchMatches } from '../store/slices/matchesSlice';
import { initSocket } from '../store/socket';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import EnhancedScoringPanel from '../components/EnhancedScoringPanel';
import api from '../services/api';
import { useToast } from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export default function LiveScores() {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { matches, loading: matchesLoading } = useSelector((state) => state.matches);
    const { token } = useSelector((state) => state.auth);

    const [view, setView] = useState('all');
    const [loading, setLoading] = useState(false);

    // Group matches by series/event
    const groupedMatches = useMemo(() => {
        const groups = {};
        matches.forEach(match => {
            const key = match.matchSubcategory || match.series || 'Other Matches';
            if (!groups[key]) {
                groups[key] = [];
            }
            groups[key].push(match);
        });
        return groups;
    }, [matches]);

    // Filter matches by date
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const todayMatches = matches.filter(m => {
        const matchDate = new Date(m.startAt);
        return matchDate >= today && matchDate < tomorrow;
    });

    const yesterdayMatches = matches.filter(m => {
        const matchDate = new Date(m.startAt);
        return matchDate >= yesterday && matchDate < today;
    });

    const tomorrowMatches = matches.filter(m => {
        const matchDate = new Date(m.startAt);
        return matchDate >= tomorrow && matchDate < new Date(tomorrow.getTime() + 86400000);
    });

    useEffect(() => {
        dispatch(fetchMatches());
        const socket = initSocket();
        socket.on('match:scoreUpdate', () => dispatch(fetchMatches()));
        socket.on('match:updated', () => dispatch(fetchMatches()));
        return () => {
            socket.off('match:scoreUpdate');
            socket.off('match:updated');
        };
    }, [dispatch]);

    const handleSelectMatch = (match) => {
        navigate('/admin/score/' + match._id);
    };

    const formatDate = (date) => {
        const d = new Date(date);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    const formatTime = (date) => {
        const d = new Date(date);
        return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    };

    // MAIN LIVE SCORES DASHBOARD (professional match-center layout)
    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50">
            {/* Header */}
            <div className="bg-gradient-to-r from-[#031d44] via-[#0a2d5e] to-[#031d44] text-white p-6 lg:p-10">
                <h1 className="text-4xl lg:text-5xl font-black tracking-tight">LIVE CRICKET SCORES</h1>
                <p className="text-blue-200 mt-2 font-medium">Real-time match updates and scoring</p>
            </div>

            {/* Tabs */}
            <div className="bg-white border-b border-slate-200 sticky top-0 z-40">
                <div className="max-w-7xl mx-auto px-6 flex gap-2 overflow-x-auto">
                    {[
                        { key: 'all', label: 'All Matches' },
                        { key: 'result', label: 'Results' },
                        { key: 'live', label: 'Live' },
                        { key: 'upcoming', label: 'Upcoming' }
                    ].map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setView(tab.key)}
                            className={`px-6 py-4 text-xs font-black uppercase tracking-widest transition-all relative whitespace-nowrap ${view === tab.key ? 'text-[#031d44]' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            {tab.label}
                            {view === tab.key && <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#031d44] rounded-t" />}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content */}
            <div className="max-w-7xl mx-auto px-6 py-8">
                {matchesLoading || loading ? (
                    <div className="text-center py-20">
                        <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#031d44] border-t-transparent"></div>
                        <p className="mt-4 text-xs font-black text-slate-400 uppercase tracking-widest">Loading matches...</p>
                    </div>
                ) : (
                    <>
                        {/* YESTERDAY - RESULTS */}
                        {(view === 'all' || view === 'result') && yesterdayMatches.filter(m => m.status === 'completed').length > 0 && (
                            <div className="mb-10">
                                <h2 className="text-xl font-black text-[#031d44] uppercase tracking-tight mb-4 flex items-center gap-2">
                                    <span className="w-2 h-6 bg-green-600 rounded-full"></span>
                                    Yesterday's Results
                                </h2>
                                <div className="space-y-3">
                                    {yesterdayMatches.filter(m => m.status === 'completed').map(match => (
                                        <div
                                            key={match._id}
                                            className="bg-white rounded-xl shadow-md border border-slate-200 hover:shadow-lg transition-all cursor-pointer"
                                            onClick={() => handleSelectMatch(match)}
                                        >
                                            <div className="p-4">
                                                <div className="flex items-center justify-between mb-3">
                                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                                        {match.matchSubcategory || match.series} • {formatDate(match.startAt)}
                                                    </span>
                                                    <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-[9px] font-bold uppercase">
                                                        Complete
                                                    </span>
                                                </div>
                                                <div className="space-y-2">
                                                    {match.innings?.map((inn, idx) => {
                                                        const team = match.teams?.[idx] || {};
                                                        return (
                                                            <div key={idx} className="flex items-center justify-between">
                                                                <div className="flex items-center gap-3">
                                                                    {team.logo && <img src={team.logo} alt={team.name} className="w-6 h-6 rounded-full object-cover" />}
                                                                    <span className="font-bold text-sm text-slate-800 uppercase">{team.shortName || team.name}</span>
                                                                </div>
                                                                <span className="font-black text-sm text-slate-800">
                                                                    {inn.runs || 0}/{inn.wickets || 0} <span className="text-xs text-slate-500 font-bold">({inn.overs || 0}.{(inn.balls || 0) % 6})</span>
                                                                </span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                                {match.result?.description && (
                                                    <div className="mt-3 pt-3 border-t border-slate-100">
                                                        <p className="text-sm font-bold text-green-700">{match.result.description}</p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* TODAY - LIVE MATCHES */}
                        {(view === 'all' || view === 'live') && todayMatches.filter(m => m.status === 'live').length > 0 && (
                            <div className="mb-10">
                                <h2 className="text-xl font-black text-[#031d44] uppercase tracking-tight mb-4 flex items-center gap-2">
                                    <span className="w-2 h-6 bg-red-600 rounded-full animate-pulse"></span>
                                    Live Now
                                </h2>
                                <div className="space-y-3">
                                    {todayMatches.filter(m => m.status === 'live').map(match => (
                                        <div
                                            key={match._id}
                                            className="bg-white rounded-xl shadow-md border-2 border-red-500 hover:shadow-lg transition-all cursor-pointer"
                                            onClick={() => handleSelectMatch(match)}
                                        >
                                            <div className="p-4">
                                                <div className="flex items-center justify-between mb-3">
                                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                                        {match.matchSubcategory || match.series}
                                                    </span>
                                                    <span className="px-2 py-0.5 bg-red-600 text-white rounded-full text-[9px] font-bold uppercase animate-pulse">
                                                        LIVE
                                                    </span>
                                                </div>
                                                <div className="space-y-2">
                                                    {match.innings?.map((inn, idx) => {
                                                        const team = match.teams?.[idx] || {};
                                                        return (
                                                            <div key={idx} className="flex items-center justify-between">
                                                                <div className="flex items-center gap-3">
                                                                    {team.logo && <img src={team.logo} alt={team.name} className="w-6 h-6 rounded-full object-cover" />}
                                                                    <span className="font-bold text-sm text-slate-800 uppercase">{team.shortName || team.name}</span>
                                                                    {match.innings?.[idx]?.batting?.filter(b => !b.isOut).length > 0 && (
                                                                        <span className="text-[10px] text-blue-600 font-bold">*</span>
                                                                    )}
                                                                </div>
                                                                <span className="font-black text-sm text-slate-800">
                                                                    {inn.runs || 0}/{inn.wickets || 0} <span className="text-xs text-slate-500 font-bold">({inn.overs || 0}.{(inn.balls || 0) % 6})</span>
                                                                </span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                                {match.tossWinner && (
                                                    <p className="mt-2 text-xs text-slate-500 font-bold">
                                                        Toss: {match.teams?.find(t => t._id === match.tossWinner)?.shortName || match.tossWinner} elected to {match.tossDecision}
                                                    </p>
                                                )}
                                                <div className="mt-3 flex gap-2">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            navigate('/admin/score/' + match._id);
                                                        }}
                                                        className="flex-1 bg-[#031d44] hover:bg-slate-800 text-white py-2 rounded-lg font-black text-xs uppercase tracking-widest"
                                                    >
                                                        🏏 Score Match
                                                    </button>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            navigate(`/admin/live/${match._id}`);
                                                        }}
                                                        className="px-4 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg font-black text-xs uppercase tracking-widest"
                                                    >
                                                        👁️ View
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* TODAY - UPCOMING */}
                        {(view === 'all' || view === 'upcoming') && todayMatches.filter(m => m.status === 'upcoming' || m.status === 'scheduled').length > 0 && (
                            <div className="mb-10">
                                <h2 className="text-xl font-black text-[#031d44] uppercase tracking-tight mb-4 flex items-center gap-2">
                                    <span className="w-2 h-6 bg-blue-600 rounded-full"></span>
                                    Today's Upcoming
                                </h2>
                                <div className="space-y-3">
                                    {todayMatches.filter(m => m.status === 'upcoming' || m.status === 'scheduled').map(match => (
                                        <div
                                            key={match._id}
                                            className="bg-white rounded-xl shadow-md border border-slate-200 hover:shadow-lg transition-all"
                                        >
                                            <div className="p-4">
                                                <div className="flex items-center justify-between mb-3">
                                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                                        {match.matchSubcategory || match.series}
                                                    </span>
                                                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-[9px] font-bold uppercase">
                                                        {formatTime(match.startAt)}
                                                    </span>
                                                </div>
                                                <div className="flex items-center justify-center gap-6 py-3">
                                                    {match.teams?.map((team, idx) => (
                                                        <div key={idx} className="flex flex-col items-center flex-1">
                                                            {team.logo && <img src={team.logo} alt={team.name} className="w-12 h-12 rounded-full object-cover mb-2" />}
                                                            <span className="font-bold text-sm text-slate-800 uppercase text-center">{team.shortName || team.name}</span>
                                                        </div>
                                                    ))}
                                                    <span className="text-2xl font-black text-slate-300">VS</span>
                                                </div>
                                                <p className="text-center text-[10px] text-slate-500 font-bold mt-1">
                                                    {match.venue || 'Venue TBA'} &bull; {match.matchType}
                                                </p>
                                                <div className="mt-3 flex gap-2">
                                                    <button
                                                        onClick={() => navigate('/admin/score')}
                                                        className="flex-1 bg-[#031d44] hover:bg-slate-800 text-white py-2 rounded-lg font-black text-xs uppercase tracking-widest"
                                                    >
                                                        ⚙️ Manage Match
                                                    </button>
                                                    <button
                                                        onClick={() => navigate('/admin/events')}
                                                        className="px-4 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg font-black text-xs uppercase tracking-widest"
                                                    >
                                                        📋 Setup
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* TOMORROW */}
                        {(view === 'all' || view === 'upcoming') && tomorrowMatches.length > 0 && (
                            <div className="mb-10">
                                <h2 className="text-xl font-black text-[#031d44] uppercase tracking-tight mb-4 flex items-center gap-2">
                                    <span className="w-2 h-6 bg-slate-400 rounded-full"></span>
                                    Tomorrow
                                </h2>
                                <div className="space-y-3">
                                    {tomorrowMatches.map(match => (
                                        <div
                                            key={match._id}
                                            className="bg-white rounded-xl shadow-md border border-slate-200 p-4"
                                        >
                                            <div className="flex items-center justify-between mb-3">
                                                <div>
                                                    <p className="font-bold text-sm text-slate-800">
                                                        {match.teams?.[0]?.shortName || 'Team A'} vs {match.teams?.[1]?.shortName || 'Team B'}
                                                    </p>
                                                    <p className="text-xs text-slate-500">{match.matchSubcategory || match.series}</p>
                                                </div>
                                                <span className="text-xs font-bold text-slate-400">{formatTime(match.startAt)}</span>
                                            </div>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => navigate('/admin/score')}
                                                    className="flex-1 bg-[#031d44] hover:bg-slate-800 text-white py-2 rounded-lg font-black text-xs uppercase tracking-widest"
                                                >
                                                    ⚙️ Manage Match
                                                </button>
                                                <button
                                                    onClick={() => navigate('/admin/events')}
                                                    className="px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 py-2 rounded-lg font-black text-xs uppercase tracking-widest"
                                                >
                                                    📋 Setup
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* NO MATCHES */}
                        {matches.length === 0 && (
                            <div className="text-center py-20 bg-white rounded-2xl border border-slate-100">
                                <p className="text-sm font-black text-slate-300 uppercase tracking-widest">No matches available</p>
                                <Link to="/admin/events" className="mt-4 inline-block px-6 py-3 bg-[#031d44] hover:bg-slate-800 text-white rounded-xl font-black text-xs uppercase tracking-widest">
                                    Create Match
                                </Link>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>

    );
}
