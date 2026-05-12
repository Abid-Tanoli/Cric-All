import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

export default function GlobalSearch() {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState({ events: [], teams: [], players: [] });
    const [loading, setLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const navigate = useNavigate();
    const dropdownRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (query.length < 2) {
            setResults({ events: [], teams: [], players: [] });
            return;
        }

        const timer = setTimeout(async () => {
            setLoading(true);
            try {
                const [eventsRes, teamsRes, playersRes] = await Promise.all([
                    api.get(`/events?search=${query}`),
                    api.get(`/teams?search=${query}`),
                    api.get(`/players?search=${query}&limit=5`)
                ]);

                setResults({
                    events: eventsRes.data.slice(0, 5),
                    teams: teamsRes.data.slice(0, 5),
                    players: playersRes.data.players?.slice(0, 5) || []
                });
                setIsOpen(true);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        }, 300);

        return () => clearTimeout(timer);
    }, [query]);

    const handleSelect = (type, item) => {
        setIsOpen(false);
        setQuery('');
        if (type === 'event') navigate(`/admin/events/${item._id}`);
        if (type === 'team') navigate(`/admin/teams`); // Assuming teams page handles selection or has individual views
        if (type === 'player') navigate(`/admin/players`); // Adjust path as needed
    };

    return (
        <div className="relative w-full max-w-2xl mx-auto" ref={dropdownRef}>
            <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <span className="text-xl">🔍</span>
                </div>
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search Events, Schools, Teams or Players..."
                    className="w-full pl-12 pr-4 py-4 bg-white border border-slate-200 rounded-2xl shadow-xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none font-bold text-slate-800 transition-all placeholder:text-slate-400"
                    onFocus={() => query.length >= 2 && setIsOpen(true)}
                />
                {loading && (
                    <div className="absolute inset-y-0 right-0 pr-4 flex items-center">
                        <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                )}
            </div>

            {isOpen && (results.events.length > 0 || results.teams.length > 0 || results.players.length > 0) && (
                <div className="absolute w-full mt-2 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden z-[100] max-h-[70vh] overflow-y-auto">
                    {results.events.length > 0 && (
                        <div>
                            <div className="bg-slate-50 px-4 py-2 border-b border-slate-100">
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Matches & Events</span>
                            </div>
                            {results.events.map(ev => (
                                <div key={ev._id} onClick={() => handleSelect('event', ev)} className="px-4 py-3 hover:bg-blue-50 cursor-pointer flex items-center gap-3 transition-colors">
                                    <div className="w-8 h-8 rounded bg-blue-100 flex items-center justify-center text-blue-600 text-sm">🏏</div>
                                    <div>
                                        <p className="text-sm font-black text-slate-800 uppercase tracking-tight">{ev.name}</p>
                                        <p className="text-[9px] font-bold text-slate-400 uppercase">{ev.category} | {ev.organization || 'No Institution'}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {results.teams.length > 0 && (
                        <div>
                            <div className="bg-slate-50 px-4 py-2 border-b border-slate-100">
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Teams & Schools</span>
                            </div>
                            {results.teams.map(team => (
                                <div key={team._id} onClick={() => handleSelect('team', team)} className="px-4 py-3 hover:bg-blue-50 cursor-pointer flex items-center gap-3 transition-colors">
                                    {team.logo ? (
                                        <img src={team.logo} className="w-8 h-8 rounded object-cover" />
                                    ) : (
                                        <div className="w-8 h-8 rounded bg-purple-100 flex items-center justify-center text-purple-600 text-sm font-black">{team.shortName}</div>
                                    )}
                                    <div>
                                        <p className="text-sm font-black text-slate-800 uppercase tracking-tight">{team.name}</p>
                                        <p className="text-[9px] font-bold text-slate-400 uppercase">{team.category} | {team.organization || 'Independent'}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {results.players.length > 0 && (
                        <div>
                            <div className="bg-slate-50 px-4 py-2 border-b border-slate-100">
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Players</span>
                            </div>
                            {results.players.map(player => (
                                <div key={player._id} onClick={() => handleSelect('player', player)} className="px-4 py-3 hover:bg-blue-50 cursor-pointer flex items-center gap-3 transition-colors">
                                    {player.imageUrl ? (
                                        <img src={player.imageUrl} className="w-8 h-8 rounded-full object-cover" />
                                    ) : (
                                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 text-xs font-black">{player.name.substring(0, 2)}</div>
                                    )}
                                    <div>
                                        <p className="text-sm font-black text-slate-800 uppercase tracking-tight">{player.name}</p>
                                        <p className="text-[9px] font-bold text-slate-400 uppercase">{player.playingRole} | {player.team?.name || 'Free Agent'}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
