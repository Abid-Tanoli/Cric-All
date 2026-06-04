import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../services/api';

const LiveNavbar = () => {
    const location = useLocation();
    const [trendingSeries, setTrendingSeries] = useState([]);
    const [runningSeries, setRunningSeries] = useState([]);
    const [popularTeams, setPopularTeams] = useState([]);
    const [showSeriesDropdown, setShowSeriesDropdown] = useState(false);

    useEffect(() => {
        loadNavigationData();
    }, []);

    const loadNavigationData = async () => {
        try {
            // Fetch trending/current series
            const eventsRes = await api.get('/events');
            const events = eventsRes.data || [];
            
            // Filter for live/trending series
            const trending = events.filter(e => e.status === 'live' || e.eventType === 'league').slice(0, 5);
            setTrendingSeries(trending);

            // Get running series
            const running = events.filter(e => e.status === 'live');
            setRunningSeries(running);

            // Popular teams (you can customize this)
            const teamsRes = await api.get('/teams');
            const teams = teamsRes.data || [];
            setPopularTeams(teams.filter(t => t.type === 'international' || t.type === 'league').slice(0, 10));
        } catch (err) {
            console.error('Failed to load navigation data:', err);
        }
    };

    const navItems = [
        { key: 'live', label: 'Live Scores', path: '/live', icon: '🔴' },
        { key: 'international', label: 'International', path: '/international', icon: 'INTL' },
        { key: 'series', label: 'Series', path: '/series', icon: '🏆' },
        { key: 'teams', label: 'Teams', path: '/teams', icon: '👥' },
        { key: 'news', label: 'News', path: '/news', icon: '📰' },
        { key: 'videos', label: 'Videos', path: '/videos', icon: '🎥' },
        { key: 'stats', label: 'Stats', path: '/rankings', icon: '📊' },
    ];

    const isActive = (path) => location.pathname === path;

    return (
        <div className="bg-white shadow-md sticky top-0 z-50">
            {/* Top Bar */}
            <div className="bg-gradient-to-r from-[#031d44] via-[#0a2d5e] to-[#031d44] text-white">
                <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
                    <Link to="/" className="text-2xl font-black tracking-tight">BQ PLAY</Link>
                    <div className="flex items-center gap-4">
                        <input
                            type="text"
                            placeholder="Search matches, teams, players..."
                            className="px-4 py-2 rounded-lg bg-white/10 border border-white/20 text-white placeholder-blue-200 text-sm focus:outline-none focus:bg-white/20 w-64"
                        />
                    </div>
                </div>
            </div>

            {/* Navigation Bar */}
            <div className="border-b border-slate-200">
                <div className="max-w-7xl mx-auto px-4 flex items-center gap-1 overflow-x-auto">
                    {navItems.map(item => (
                        <Link
                            key={item.key}
                            to={item.path}
                            className={`px-4 py-3 text-xs font-black uppercase tracking-widest transition-all relative whitespace-nowrap flex items-center gap-2 ${isActive(item.path) ? 'text-[#031d44]' : 'text-slate-600 hover:text-slate-900'}`}
                        >
                            <span>{item.icon}</span>
                            <span>{item.label}</span>
                            {isActive(item.path) && <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#031d44] rounded-t" />}
                        </Link>
                    ))}

                    {/* Trending Series Dropdown */}
                    {trendingSeries.length > 0 && (
                        <div
                            className="relative"
                            onMouseEnter={() => setShowSeriesDropdown(true)}
                            onMouseLeave={() => setShowSeriesDropdown(false)}
                        >
                            <button className="px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-600 hover:text-slate-900 flex items-center gap-2">
                                <span>🔥</span>
                                <span>{trendingSeries[0]?.name || 'Trending'}</span>
                                <span className="text-[10px]">▼</span>
                            </button>
                            
                            {showSeriesDropdown && (
                                <div className="absolute top-full left-0 bg-white shadow-xl rounded-lg border border-slate-200 py-2 w-64 z-50">
                                    {trendingSeries.map(series => (
                                        <Link
                                            key={series._id}
                                            to={`/series/${series._id}`}
                                            className="px-4 py-3 hover:bg-slate-50 flex items-center gap-3 transition-colors"
                                        >
                                            {series.logo ? (
                                                <img src={series.logo} alt={series.name} className="w-8 h-8 rounded object-cover" />
                                            ) : (
                                                <div className="w-8 h-8 rounded bg-slate-200 flex items-center justify-center text-xs font-bold">
                                                    {series.name?.charAt(0)}
                                                </div>
                                            )}
                                            <div>
                                                <p className="text-sm font-bold text-slate-800">{series.name}</p>
                                                <p className="text-[10px] text-slate-500 capitalize">{series.eventType} • {series.status}</p>
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Sub-navigation for running series */}
            {runningSeries.length > 0 && (
                <div className="bg-blue-50 border-b border-blue-100">
                    <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-4 overflow-x-auto">
                        <span className="text-xs font-bold text-blue-700 uppercase whitespace-nowrap">🔴 Live Series:</span>
                        {runningSeries.map(series => (
                            <Link
                                key={series._id}
                                to={`/series/${series._id}`}
                                className="px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded-full text-xs font-bold whitespace-nowrap transition-colors"
                            >
                                {series.shortName || series.name}
                            </Link>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default LiveNavbar;
