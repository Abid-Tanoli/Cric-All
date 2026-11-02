import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../services/api';
import { formatMatchDate, formatMatchTime, teamShortName } from '../utils/teamDisplay';

export default function EventDetail() {
    const { eventId } = useParams();
    const [event, setEvent] = useState(null);
    const [matches, setMatches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('fixtures'); // fixtures, results, points, stats
    const [boundaryStats, setBoundaryStats] = useState({ sixes: 0, fours: 0, mostSixes: [], mostFours: [] });
    const [topRunScorers, setTopRunScorers] = useState([]);
    const [topWicketTakers, setTopWicketTakers] = useState([]);

    useEffect(() => {
        loadEventData();
    }, [eventId]);

    const loadEventData = async () => {
        try {
            const eventRes = await api.get(`/events/${eventId}`);
            const eventData = eventRes.data;
            setEvent(eventData);

            // Load all matches with details
            const matchPromises = (eventData.matches || []).map(async m => {
                try {
                    const res = await api.get(`/matches/${m._id || m}`);
                    return res.data;
                } catch {
                    return null;
                }
            });
            const matchData = (await Promise.all(matchPromises)).filter(Boolean);
            setMatches(matchData);

            // Calculate boundary stats
            calculateBoundaries(matchData);
            calculateTopPerformers(matchData);
        } catch (err) {
            console.error('Failed to load event:', err);
        } finally {
            setLoading(false);
        }
    };

    const calculateBoundaries = (matchData) => {
        let totalSixes = 0;
        let totalFours = 0;
        const sixesByPlayer = {};
        const foursByPlayer = {};

        matchData.forEach(match => {
            if (!match.innings) return;
            match.innings.forEach(inn => {
                (inn.batting || []).forEach(b => {
                    const sixes = b.sixes || 0;
                    const fours = b.fours || 0;
                    totalSixes += sixes;
                    totalFours += fours;

                    const playerId = b.player?._id || b.player;
                    if (sixes > 0) {
                        if (!sixesByPlayer[playerId]) {
                            sixesByPlayer[playerId] = {
                                playerId,
                                name: b.player?.name || 'Unknown',
                                team: inn.team?.name || 'Unknown',
                                count: 0
                            };
                        }
                        sixesByPlayer[playerId].count += sixes;
                    }

                    if (fours > 0) {
                        if (!foursByPlayer[playerId]) {
                            foursByPlayer[playerId] = {
                                playerId,
                                name: b.player?.name || 'Unknown',
                                team: inn.team?.name || 'Unknown',
                                count: 0
                            };
                        }
                        foursByPlayer[playerId].count += fours;
                    }
                });
            });
        });

        const mostSixes = Object.values(sixesByPlayer).sort((a, b) => b.count - a.count).slice(0, 5);
        const mostFours = Object.values(foursByPlayer).sort((a, b) => b.count - a.count).slice(0, 5);

        setBoundaryStats({ sixes: totalSixes, fours: totalFours, mostSixes, mostFours });
    };

    const calculateTopPerformers = (matchData) => {
        const runStats = {};
        const wicketStats = {};

        matchData.forEach(match => {
            if (!match.innings) return;
            match.innings.forEach(inn => {
                (inn.batting || []).forEach(b => {
                    const playerId = b.player?._id || b.player;
                    if (!runStats[playerId]) {
                        runStats[playerId] = {
                            playerId,
                            name: b.player?.name || 'Unknown',
                            team: inn.team?.name || 'Unknown',
                            runs: 0,
                            balls: 0,
                            fours: 0,
                            sixes: 0,
                            matches: 0
                        };
                    }
                    runStats[playerId].runs += b.runs || 0;
                    runStats[playerId].balls += b.balls || 0;
                    runStats[playerId].fours += b.fours || 0;
                    runStats[playerId].sixes += b.sixes || 0;
                });

                (inn.bowling || []).forEach(b => {
                    const playerId = b.player?._id || b.player;
                    if (!wicketStats[playerId]) {
                        wicketStats[playerId] = {
                            playerId,
                            name: b.player?.name || 'Unknown',
                            team: inn.team?.name || 'Unknown',
                            wickets: 0,
                            runs: 0,
                            overs: 0,
                            maidens: 0
                        };
                    }
                    wicketStats[playerId].wickets += b.wickets || 0;
                    wicketStats[playerId].runs += b.runs || 0;
                    wicketStats[playerId].overs += b.overs || 0;
                });
            });
        });

        const sortedRuns = Object.values(runStats).sort((a, b) => b.runs - a.runs).slice(0, 10);
        const sortedWickets = Object.values(wicketStats).sort((a, b) => b.wickets - a.wickets).slice(0, 10);

        setTopRunScorers(sortedRuns);
        setTopWicketTakers(sortedWickets);
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
            </div>
        );
    }

    if (!event) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <p className="text-xl font-bold text-slate-500">Event not found</p>
            </div>
        );
    }

    const completedMatches = matches.filter(m => m.status === 'completed');
    const upcomingMatches = matches.filter(m => m.status === 'upcoming' || m.status === 'scheduled');
    const liveMatches = matches.filter(m => m.status === 'live');

    const formatDate = (date) => formatMatchDate(date, { year: 'numeric' });
    const formatTime = (date) => formatMatchTime(date);

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header Banner */}
            <div className="relative bg-gradient-to-r from-[#031d44] via-[#0a2d5e] to-[#031d44] text-white">
                {/* Banner Image */}
                <div className="absolute inset-0 opacity-10">
                    {event.images?.[0]?.url ? (
                        <img src={event.images[0].url} alt={event.name} className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full bg-gradient-to-br from-blue-900 to-purple-900"></div>
                    )}
                </div>

                <div className="relative max-w-7xl mx-auto px-4 py-12">
                    <div className="flex items-center gap-2 text-sm text-blue-300 mb-6">
                        <Link to="/admin/events" className="hover:text-white transition-colors">Events</Link>
                        <span>•</span>
                        <span>{event.name}</span>
                    </div>

                    <div className="flex items-center gap-8">
                        {event.logo ? (
                            <img src={event.logo} alt={event.name} className="w-32 h-32 rounded-2xl object-cover border-4 border-white/20 shadow-2xl" />
                        ) : (
                            <div className="w-32 h-32 rounded-2xl bg-white/10 flex items-center justify-center border-4 border-white/20 text-6xl font-black">
                                {event.name?.charAt(0)}
                            </div>
                        )}
                        <div>
                            <h1 className="text-4xl font-black uppercase tracking-tight mb-2">{event.name}</h1>
                            <div className="flex items-center gap-4 flex-wrap">
                                <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-bold uppercase">{event.eventType}</span>
                                <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-bold uppercase">{event.format}</span>
                                <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${event.status === 'live' ? 'bg-red-600 text-white animate-pulse' : event.status === 'completed' ? 'bg-green-600 text-white' : 'bg-blue-500 text-white'}`}>
                                    {event.status}
                                </span>
                            </div>
                            <p className="text-sm text-blue-200 mt-3">
                                {event.startDate ? formatDate(event.startDate) : 'TBD'} - {event.endDate ? formatDate(event.endDate) : 'TBD'}
                                {event.venue && ` • ${event.venue}`}
                            </p>
                            {event.description && (
                                <p className="text-sm text-blue-300 mt-2 max-w-2xl">{event.description}</p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Navigation Tabs */}
                <div className="bg-white/5 backdrop-blur-md border-t border-white/10">
                    <div className="max-w-7xl mx-auto px-4 flex gap-1 overflow-x-auto">
                        {[
                            { key: 'fixtures', label: 'Fixtures & Results', icon: '📅' },
                            { key: 'points', label: 'Points Table', icon: '📊' },
                            { key: 'stats', label: 'Stats & Records', icon: '📈' },
                            { key: 'squads', label: 'Squads', icon: '👥' },
                        ].map(tab => (
                            <button
                                key={tab.key}
                                onClick={() => setActiveTab(tab.key)}
                                className={`px-6 py-4 text-xs font-black uppercase tracking-widest transition-all relative whitespace-nowrap flex items-center gap-2 ${activeTab === tab.key ? 'text-white' : 'text-blue-200/60 hover:text-white'}`}
                            >
                                <span>{tab.icon}</span>
                                <span>{tab.label}</span>
                                {activeTab === tab.key && <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-red-500 rounded-t"></div>}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="max-w-7xl mx-auto px-4 py-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Left Column - Main Content */}
                    <div className="lg:col-span-2 space-y-8">
                        {/* Fixtures & Results Tab */}
                        {activeTab === 'fixtures' && (
                            <>
                                {/* Live Matches */}
                                {liveMatches.length > 0 && (
                                    <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">
                                        <div className="bg-gradient-to-r from-red-600 to-red-700 text-white px-6 py-4">
                                            <h3 className="text-lg font-black uppercase tracking-tight">🔴 Live Now</h3>
                                        </div>
                                        <div className="divide-y divide-slate-100">
                                            {liveMatches.map(match => (
                                                <Link key={match._id} to={`/admin/live/${match._id}`} className="block p-6 hover:bg-slate-50 transition-colors">
                                                    <div className="flex items-center justify-between mb-3">
                                                        <span className="text-xs font-bold text-slate-500 uppercase">{match.matchSubcategory || 'Match'}</span>
                                                        <span className="px-2 py-0.5 bg-red-600 text-white rounded-full text-[9px] font-bold uppercase animate-pulse">LIVE</span>
                                                    </div>
                                                    <div className="space-y-2">
                                                        {match.innings?.map((inn, idx) => {
                                                            const team = match.teams?.[idx] || {};
                                                            return (
                                                                <div key={idx} className="flex items-center justify-between">
                                                                    <div className="flex items-center gap-3">
                                                                        {team.logo && <img src={team.logo} alt={team.name} className="w-6 h-6 rounded-full object-cover" />}
                                                                        <span className="font-bold text-sm text-slate-800">{teamShortName(team)}</span>
                                                                    </div>
                                                                    <span className="font-black text-sm">{inn.runs || 0}/{inn.wickets || 0} <span className="text-xs text-slate-500 font-bold">({inn.overs || 0}.{(inn.balls || 0) % 6} ov)</span></span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                    {match.result?.description && (
                                                        <p className="text-sm font-bold text-green-700 mt-3">{match.result.description}</p>
                                                    )}
                                                </Link>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Completed Matches / Results */}
                                {completedMatches.length > 0 && (
                                    <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">
                                        <div className="bg-gradient-to-r from-green-600 to-green-700 text-white px-6 py-4">
                                            <h3 className="text-lg font-black uppercase tracking-tight">✓ Results</h3>
                                        </div>
                                        <div className="divide-y divide-slate-100">
                                            {completedMatches.map(match => (
                                                <Link key={match._id} to={`/match/${match._id}`} className="block p-6 hover:bg-slate-50 transition-colors">
                                                    <div className="flex items-center justify-between mb-3">
                                                        <span className="text-xs font-bold text-slate-500 uppercase">{match.matchSubcategory || 'Match'} • {match.startAt ? formatDate(match.startAt) : ''}</span>
                                                        <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-[9px] font-bold uppercase">Complete</span>
                                                    </div>
                                                    <div className="space-y-2">
                                                        {match.innings?.map((inn, idx) => {
                                                            const team = match.teams?.[idx] || {};
                                                            return (
                                                                <div key={idx} className="flex items-center justify-between">
                                                                    <div className="flex items-center gap-3">
                                                                        {team.logo && <img src={team.logo} alt={team.name} className="w-6 h-6 rounded-full object-cover" />}
                                                                        <span className="font-bold text-sm text-slate-800">{teamShortName(team)}</span>
                                                                    </div>
                                                                    <span className="font-black text-sm">{inn.runs || 0}/{inn.wickets || 0} <span className="text-xs text-slate-500 font-bold">({inn.overs || 0}.{(inn.balls || 0) % 6} ov)</span></span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                    {match.result?.description && (
                                                        <p className="text-sm font-bold text-green-700 mt-3">{match.result.description}</p>
                                                    )}
                                                </Link>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Upcoming Fixtures */}
                                {upcomingMatches.length > 0 && (
                                    <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">
                                        <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-6 py-4">
                                            <h3 className="text-lg font-black uppercase tracking-tight">📅 Upcoming Fixtures</h3>
                                        </div>
                                        <div className="divide-y divide-slate-100">
                                            {upcomingMatches.map(match => (
                                                <div key={match._id} className="p-6">
                                                    <div className="flex items-center justify-between mb-3">
                                                        <span className="text-xs font-bold text-slate-500 uppercase">{match.matchSubcategory || 'Match'}</span>
                                                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-[9px] font-bold uppercase">
                                                            {match.startAt ? `${formatDate(match.startAt)} • ${formatTime(match.startAt)}` : 'TBD'}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center justify-center gap-8 py-4">
                                                        {match.teams?.map((team, idx) => (
                                                            <div key={idx} className="flex flex-col items-center flex-1">
                                                                {team.logo && <img src={team.logo} alt={team.name} className="w-14 h-14 rounded-full object-cover mb-2" />}
                                                                <span className="font-bold text-sm text-slate-800 text-center">{teamShortName(team)}</span>
                                                            </div>
                                                        ))}
                                                        <span className="text-3xl font-black text-slate-300">VS</span>
                                                    </div>
                                                    <p className="text-center text-xs text-slate-500 font-bold mt-2">{match.venue || 'Venue TBA'}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}

                        {/* Points Table Tab */}
                        {activeTab === 'points' && (event.pointsTable || event.points || []).length > 0 && (
                            <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">
                                <div className="bg-gradient-to-r from-[#031d44] to-[#0a2d5e] text-white px-6 py-4 flex items-center justify-between">
                                    <h3 className="text-lg font-black uppercase tracking-tight">📊 Points Table</h3>
                                    <Link to="/admin/points-table" className="text-xs font-bold text-blue-200 hover:text-white">Full Table →</Link>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-slate-50 text-slate-600 uppercase text-[11px] font-bold">
                                                <th className="px-4 py-3 text-left">Pos</th>
                                                <th className="px-4 py-3 text-left">Team</th>
                                                <th className="px-4 py-3 text-center">M</th>
                                                <th className="px-4 py-3 text-center">W</th>
                                                <th className="px-4 py-3 text-center">L</th>
                                                <th className="px-4 py-3 text-center">NRR</th>
                                                <th className="px-4 py-3 text-center font-black text-blue-800">PTS</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {(event.pointsTable || event.points || [])
                                                .sort((a, b) => (b.points || 0) - (a.points || 0) || (b.netRunRate || 0) - (a.netRunRate || 0))
                                                .map((row, idx) => (
                                                    <tr key={idx} className={`${idx < 4 ? 'bg-green-50/30' : 'hover:bg-slate-50'} transition-colors`}>
                                                        <td className="px-4 py-4 font-bold text-slate-400">{idx + 1}</td>
                                                        <td className="px-4 py-4">
                                                            <div className="flex items-center gap-3">
                                                                <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center font-bold text-xs">{teamShortName(row.team)}</div>
                                                                <span className="font-bold text-slate-800">{row.team?.name || row.team}</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-4 text-center font-bold">{row.matchesPlayed || row.matched || 0}</td>
                                                        <td className="px-4 py-4 text-center text-green-600 font-bold">{row.won || 0}</td>
                                                        <td className="px-4 py-4 text-center text-red-600 font-bold">{row.lost || 0}</td>
                                                        <td className="px-4 py-4 text-center font-bold text-blue-600">{(row.netRunRate || row.nrr || 0).toFixed(3)}</td>
                                                        <td className="px-4 py-4 text-center font-black text-blue-800 text-lg">{row.points || 0}</td>
                                                    </tr>
                                                ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* Stats Tab */}
                        {activeTab === 'stats' && (
                            <div className="space-y-6">
                                {/* Boundary Meter */}
                                <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">
                                    <div className="bg-gradient-to-r from-purple-600 to-pink-600 text-white px-6 py-4">
                                        <h3 className="text-lg font-black uppercase tracking-tight">Boundary Meter</h3>
                                    </div>
                                    <div className="grid grid-cols-2 border-b border-slate-200">
                                        <div className="p-6 text-center border-r border-slate-200">
                                            <div className="flex items-center justify-center gap-2 mb-2">
                                                <span className="text-2xl">💥</span>
                                                <span className="text-xs font-bold text-slate-500 uppercase">6s</span>
                                            </div>
                                            <p className="text-5xl font-black text-purple-600">{boundaryStats.sixes}</p>
                                            {boundaryStats.mostSixes.length > 0 && (
                                                <div className="mt-3 text-left">
                                                    {boundaryStats.mostSixes.slice(0, 3).map((p, idx) => (
                                                        <p key={idx} className="text-xs font-bold text-slate-700">
                                                            {p.name} - <span className="text-purple-600">{p.count}</span>
                                                        </p>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <div className="p-6 text-center">
                                            <div className="flex items-center justify-center gap-2 mb-2">
                                                <span className="text-2xl">🏏</span>
                                                <span className="text-xs font-bold text-slate-500 uppercase">4s</span>
                                            </div>
                                            <p className="text-5xl font-black text-pink-600">{boundaryStats.fours}</p>
                                            {boundaryStats.mostFours.length > 0 && (
                                                <div className="mt-3 text-left">
                                                    {boundaryStats.mostFours.slice(0, 3).map((p, idx) => (
                                                        <p key={idx} className="text-xs font-bold text-slate-700">
                                                            {p.name} - <span className="text-pink-600">{p.count}</span>
                                                        </p>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Top Run Scorers */}
                                {topRunScorers.length > 0 && (
                                    <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">
                                        <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-6 py-4 flex items-center justify-between">
                                            <h3 className="text-lg font-black uppercase tracking-tight">🏏 Top Run Scorers</h3>
                                            <span className="text-xs font-bold text-blue-200">View full list →</span>
                                        </div>
                                        <div className="divide-y divide-slate-100">
                                            {topRunScorers.slice(0, 5).map((player, idx) => (
                                                <div key={idx} className="p-4 flex items-center justify-between">
                                                    <div className="flex items-center gap-4">
                                                        <span className="text-lg font-black text-slate-300 w-8">{idx + 1}</span>
                                                        <div>
                                                            <p className="font-bold text-sm text-slate-800">{player.name}</p>
                                                            <p className="text-xs text-slate-500">{player.team}</p>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-xl font-black text-blue-600">{player.runs}</p>
                                                        <p className="text-[10px] text-slate-500">{player.balls} balls • SR: {player.balls > 0 ? ((player.runs / player.balls) * 100).toFixed(1) : '0'}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Top Wicket Takers */}
                                {topWicketTakers.length > 0 && (
                                    <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">
                                        <div className="bg-gradient-to-r from-green-600 to-green-700 text-white px-6 py-4 flex items-center justify-between">
                                            <h3 className="text-lg font-black uppercase tracking-tight">⚾ Top Wicket Takers</h3>
                                            <span className="text-xs font-bold text-green-200">View full list →</span>
                                        </div>
                                        <div className="divide-y divide-slate-100">
                                            {topWicketTakers.slice(0, 5).map((player, idx) => (
                                                <div key={idx} className="p-4 flex items-center justify-between">
                                                    <div className="flex items-center gap-4">
                                                        <span className="text-lg font-black text-slate-300 w-8">{idx + 1}</span>
                                                        <div>
                                                            <p className="font-bold text-sm text-slate-800">{player.name}</p>
                                                            <p className="text-xs text-slate-500">{player.team}</p>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-xl font-black text-green-600">{player.wickets}</p>
                                                        <p className="text-[10px] text-slate-500">{player.overs} ov • Eco: {player.overs > 0 ? (player.runs / player.overs).toFixed(1) : '0'}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Squads Tab */}
                        {activeTab === 'squads' && (event.eventSquads || []).length > 0 && (
                            <div className="space-y-6">
                                {(event.eventSquads || []).map(squad => {
                                    const team = squad.team || {};
                                    return (
                                        <div key={squad._id || team._id} className="bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">
                                            <div className="bg-gradient-to-r from-[#031d44] to-[#0a2d5e] text-white px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    {team.logo && <img src={team.logo} alt={team.name} className="w-10 h-10 rounded-lg object-cover" />}
                                                    <div>
                                                        <h3 className="text-lg font-black uppercase">{team.name || 'Team'}</h3>
                                                        <p className="text-xs text-blue-200">{squad.players?.length || 0} Players</p>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="p-6">
                                                <div className="flex items-center gap-4 mb-4 text-xs font-bold">
                                                    <span className="text-blue-600">C: {squad.players?.find(p => p._id === squad.captain)?.name || 'TBD'}</span>
                                                    <span className="text-purple-600">VC: {squad.players?.find(p => p._id === squad.viceCaptain)?.name || 'TBD'}</span>
                                                    <span className="text-orange-600">WK: {squad.wicketKeepers?.length || 0}</span>
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    {squad.players?.map(player => {
                                                        const isC = player._id === squad.captain;
                                                        const isVC = player._id === squad.viceCaptain;
                                                        const isWK = squad.wicketKeepers?.includes(player._id);
                                                        return (
                                                            <span key={player._id} className="px-3 py-1.5 bg-slate-100 hover:bg-blue-100 hover:text-blue-700 rounded-lg text-xs font-bold transition-colors">
                                                                {player.name}
                                                                {isC && <span className="text-blue-600 ml-1">(C)</span>}
                                                                {isVC && <span className="text-purple-600 ml-1">(VC)</span>}
                                                                {isWK && <span className="text-orange-600 ml-1">(WK)</span>}
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Right Sidebar */}
                    <div className="space-y-6">
                        {/* Boundary Meter Card */}
                        <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200 sticky top-4">
                            <div className="bg-gradient-to-r from-purple-600 to-pink-600 text-white px-4 py-3">
                                <h3 className="text-sm font-black uppercase tracking-tight">📊 Quick Stats</h3>
                            </div>
                            <div className="p-4 space-y-4">
                                <div className="text-center p-3 bg-purple-50 rounded-xl">
                                    <p className="text-xs font-bold text-slate-500 uppercase mb-1">6s</p>
                                    <p className="text-3xl font-black text-purple-600">{boundaryStats.sixes}</p>
                                    <Link to="#stats" onClick={() => setActiveTab('stats')} className="text-xs font-bold text-purple-600 hover:underline block mt-1">Most 6s →</Link>
                                </div>
                                <div className="text-center p-3 bg-pink-50 rounded-xl">
                                    <p className="text-xs font-bold text-slate-500 uppercase mb-1">4s</p>
                                    <p className="text-3xl font-black text-pink-600">{boundaryStats.fours}</p>
                                    <Link to="#stats" onClick={() => setActiveTab('stats')} className="text-xs font-bold text-pink-600 hover:underline block mt-1">Most 4s →</Link>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
