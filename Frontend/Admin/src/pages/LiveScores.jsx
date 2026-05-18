import React, { useEffect, useState, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchMatches } from '../store/slices/matchesSlice';
import { initSocket } from '../store/socket';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import EnhancedScoringPanel from '../components/EnhancedScoringPanel';
import api from '../services/api';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export default function LiveScores() {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { matches, loading: matchesLoading } = useSelector((state) => state.matches);
    const { token } = useSelector((state) => state.auth);

    const [view, setView] = useState('all'); // all, result, live, upcoming, score
    const [selectedMatch, setSelectedMatch] = useState(null);
    const [scoreMode, setScoreMode] = useState(false);
    const [loading, setLoading] = useState(false);

    // Scoring state
    const [currentInnings, setCurrentInnings] = useState(0);
    const [runs, setRuns] = useState(null);
    const [extra, setExtra] = useState(null);
    const [isWicket, setIsWicket] = useState(false);
    const [dismissalType, setDismissalType] = useState('');
    const [dismissedPlayer, setDismissedPlayer] = useState('');
    const [bowler, setBowler] = useState('');
    const [commentary, setCommentary] = useState('');

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

    const handleSelectMatch = async (match) => {
        setSelectedMatch(match);
        setScoreMode(true);
        setLoading(true);
        try {
            const res = await api.get(`/matches/${match._id}`);
            setSelectedMatch(res.data);
            setCurrentInnings(res.data.currentInnings || 0);
        } catch (err) {
            console.error('Failed to fetch match:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmitBall = async () => {
        if (!selectedMatch) return;
        if (runs === null && !extra && !isWicket) {
            alert('Select runs, extra, or wicket');
            return;
        }

        try {
            const ballData = {
                runs: runs || 0,
                extra,
                isWicket,
                dismissalType: isWicket ? dismissalType : null,
                dismissedPlayer: isWicket ? dismissedPlayer : null,
                bowler,
                commentary: commentary || generateAutoCommentary()
            };

            const res = await axios.post(
                `${API_URL}/matches/${selectedMatch._id}/score`,
                ballData,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setSelectedMatch(res.data.match || res.data);
            resetBallForm();
        } catch (err) {
            alert('Error submitting ball: ' + (err.response?.data?.message || err.message));
        }
    };

    const generateAutoCommentary = () => {
        if (isWicket) return `WICKET! ${dismissalType || 'Wicket falls'}`;
        if (extra === 'wide') return 'Wide ball!';
        if (extra === 'noball') return 'No ball!';
        if (runs === 4) return 'FOUR! Cracking shot!';
        if (runs === 6) return 'SIX! Massive hit!';
        if (runs === 0) return 'Dot ball, good delivery';
        return `${runs} run${runs > 1 ? 's' : ''}`;
    };

    const resetBallForm = () => {
        setRuns(null);
        setExtra(null);
        setIsWicket(false);
        setDismissalType('');
        setDismissedPlayer('');
        setBowler('');
        setCommentary('');
    };

    const handleEndInnings = async () => {
        if (!selectedMatch) return;
        if (!window.confirm('End current innings?')) return;

        try {
            const res = await axios.post(
                `${API_URL}/matches/${selectedMatch._id}/end-innings`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setSelectedMatch(res.data.match || res.data);
        } catch (err) {
            alert('Error ending innings: ' + (err.response?.data?.message || err.message));
        }
    };

    const getCurrentScore = () => {
        if (!selectedMatch?.innings?.[currentInnings]) return { runs: 0, wickets: 0, overs: '0.0' };
        const inn = selectedMatch.innings[currentInnings];
        const balls = inn.balls || 0;
        const overs = Math.floor(balls / 6);
        const ballInOver = balls % 6;
        return {
            runs: inn.runs || 0,
            wickets: inn.wickets || 0,
            overs: `${overs}.${ballInOver}`
        };
    };

    const getBattingTeam = () => {
        if (!selectedMatch?.innings?.[currentInnings]) return null;
        return selectedMatch.innings[currentInnings].team;
    };

    const getBowlingTeam = () => {
        if (!selectedMatch?.innings?.[currentInnings]) return null;
        const battingTeamId = selectedMatch.innings[currentInnings].team?._id || selectedMatch.innings[currentInnings].team;
        const otherTeam = selectedMatch.teams?.find(t => t._id !== battingTeamId);
        return otherTeam;
    };

    const getCurrentBatsmen = () => {
        if (!selectedMatch?.innings?.[currentInnings]) return [];
        const batting = selectedMatch.innings[currentInnings].batting || [];
        return batting.filter(b => !b.isOut).slice(0, 2);
    };

    const getCurrentBowler = () => {
        if (!selectedMatch?.innings?.[currentInnings]) return null;
        const bowling = selectedMatch.innings[currentInnings].bowling || [];
        return bowling.length > 0 ? bowling[bowling.length - 1] : null;
    };

    const formatDate = (date) => {
        const d = new Date(date);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    const formatTime = (date) => {
        const d = new Date(date);
        return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    };

    if (selectedMatch && scoreMode) {
        // SCORING INTERFACE
        return (
            <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-6 lg:p-10">
                {/* Match Header */}
                <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6 mb-6">
                    <div className="flex justify-between items-start mb-4">
                        <div>
                            <button
                                onClick={() => { setSelectedMatch(null); setScoreMode(false); }}
                                className="mb-3 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold rounded-lg transition-colors"
                            >
                                ← Back to Live Scores
                            </button>
                            <h1 className="text-2xl font-black text-[#031d44]">
                                {selectedMatch.teams?.[0]?.name || 'Team A'} vs {selectedMatch.teams?.[1]?.name || 'Team B'}
                            </h1>
                            <p className="text-sm text-slate-500 mt-1">{selectedMatch.title}</p>
                            <p className="text-xs text-slate-400 mt-1">{selectedMatch.venue} • {formatDate(selectedMatch.startAt)}</p>
                        </div>
                        <span className="px-3 py-1 rounded-lg text-xs font-black uppercase tracking-widest bg-green-100 text-green-700 animate-pulse">
                            LIVE
                        </span>
                    </div>

                    {/* Score Display */}
                    <div className="bg-gradient-to-r from-[#031d44] to-[#0a2d5e] text-white rounded-xl p-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-blue-200 mb-1">
                                    {getBattingTeam()?.name || 'Batting Team'} Innings
                                </p>
                                <p className="text-5xl font-black">
                                    {getCurrentScore().runs}/{getCurrentScore().wickets}
                                </p>
                                <p className="text-sm text-blue-200 mt-2">
                                    Overs: {getCurrentScore().overs} | CRR: {selectedMatch.innings?.[currentInnings]?.runRate?.toFixed(2) || '0.00'}
                                </p>
                            </div>
                            {selectedMatch.innings?.[currentInnings]?.target && (
                                <div className="text-right">
                                    <p className="text-xs text-blue-200 mb-1">Target</p>
                                    <p className="text-3xl font-black">{selectedMatch.innings[currentInnings].target}</p>
                                    <p className="text-xs text-blue-200 mt-1">
                                        Need {selectedMatch.innings[currentInnings].target - getCurrentScore().runs} from {(selectedMatch.totalOvers * 6 - (selectedMatch.innings[currentInnings].balls || 0)) / 6} overs
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Scoring Controls */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Ball Entry */}
                    <div className="lg:col-span-2 bg-white rounded-2xl shadow-xl border border-slate-100 p-6">
                        <h2 className="text-lg font-black text-slate-800 uppercase tracking-widest mb-4">Ball Entry</h2>

                        {/* Runs */}
                        <div className="mb-4">
                            <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Runs</label>
                            <div className="flex gap-2">
                                {[0, 1, 2, 3, 4, 6].map(r => (
                                    <button
                                        key={r}
                                        onClick={() => { setRuns(r); setIsWicket(false); setExtra(null); }}
                                        className={`flex-1 py-3 rounded-xl font-black text-lg transition-all ${runs === r ? 'bg-[#031d44] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                    >
                                        {r}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Extras */}
                        <div className="mb-4">
                            <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Extras</label>
                            <div className="flex gap-2">
                                {['wide', 'noball', 'bye', 'legbye'].map(e => (
                                    <button
                                        key={e}
                                        onClick={() => { setExtra(e); setRuns(0); setIsWicket(false); }}
                                        className={`flex-1 py-2 rounded-xl font-bold text-xs uppercase transition-all ${extra === e ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                    >
                                        {e}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Wicket */}
                        <div className="mb-4">
                            <button
                                onClick={() => setIsWicket(!isWicket)}
                                className={`w-full py-3 rounded-xl font-black text-sm uppercase transition-all ${isWicket ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                            >
                                Wicket
                            </button>
                            {isWicket && (
                                <div className="mt-3 space-y-3">
                                    <select
                                        value={dismissalType}
                                        onChange={(e) => setDismissalType(e.target.value)}
                                        className="w-full border border-slate-300 rounded-xl px-4 py-3"
                                    >
                                        <option value="">Dismissal Type</option>
                                        <option value="bowled">Bowled</option>
                                        <option value="caught">Caught</option>
                                        <option value="lbw">LBW</option>
                                        <option value="run out">Run Out</option>
                                        <option value="stumped">Stumped</option>
                                        <option value="hit wicket">Hit Wicket</option>
                                    </select>
                                    <select
                                        value={dismissedPlayer}
                                        onChange={(e) => setDismissedPlayer(e.target.value)}
                                        className="w-full border border-slate-300 rounded-xl px-4 py-3"
                                    >
                                        <option value="">Batsman Out</option>
                                        {getCurrentBatsmen().map(b => (
                                            <option key={b.player?._id} value={b.player?._id}>{b.player?.name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>

                        {/* Commentary */}
                        <div className="mb-4">
                            <textarea
                                value={commentary}
                                onChange={(e) => setCommentary(e.target.value)}
                                placeholder="Add commentary (optional)..."
                                className="w-full border border-slate-300 rounded-xl px-4 py-3 h-20 resize-none"
                            />
                        </div>

                        {/* Submit Button */}
                        <button
                            onClick={handleSubmitBall}
                            className="w-full bg-[#031d44] hover:bg-slate-800 text-white py-4 rounded-xl font-black text-sm uppercase tracking-widest transition-all"
                        >
                            Submit Ball
                        </button>

                        {/* End Innings */}
                        <button
                            onClick={handleEndInnings}
                            className="w-full mt-3 bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all"
                        >
                            End Innings
                        </button>
                    </div>

                    {/* Current Players */}
                    <div className="space-y-6">
                        {/* Batsmen */}
                        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6">
                            <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-3">Batsmen</h3>
                            <div className="space-y-2">
                                {getCurrentBatsmen().map((b, i) => (
                                    <div key={i} className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                                        <span className="font-bold text-sm">{b.player?.name || 'Batsman'}</span>
                                        <span className="font-black">{b.runs || 0} ({b.balls || 0})</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Bowler */}
                        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6">
                            <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-3">Bowler</h3>
                            {getCurrentBowler() ? (
                                <div className="p-3 bg-slate-50 rounded-lg">
                                    <p className="font-bold text-sm">{getCurrentBowler().player?.name}</p>
                                    <p className="text-xs text-slate-500">{getCurrentBowler().overs || 0}-{getCurrentBowler().wickets || 0}/{getCurrentBowler().runs || 0}</p>
                                </div>
                            ) : (
                                <p className="text-sm text-slate-400">No bowler selected</p>
                            )}
                        </div>

                        {/* Recent Balls */}
                        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6">
                            <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-3">Recent Balls</h3>
                            <div className="flex flex-wrap gap-2">
                                {selectedMatch?.innings?.[currentInnings]?.oversHistory?.slice(-1).flatMap(over => over.balls || []).slice(-12).map((ball, i) => (
                                    <div
                                        key={i}
                                        className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-sm ${ball.isWicket ? 'bg-red-500 text-white' : ball.runs === 4 || ball.runs === 6 ? 'bg-green-500 text-white' : 'bg-slate-200 text-slate-700'}`}
                                    >
                                        {ball.isWicket ? 'W' : ball.runs}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // MAIN LIVE SCORES DASHBOARD (ESPN Style)
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
                                                            setSelectedMatch(match);
                                                            setScoreMode(true);
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
