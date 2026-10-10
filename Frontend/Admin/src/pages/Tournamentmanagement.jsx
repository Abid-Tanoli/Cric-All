import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { useToast } from '../components/Toast';

const TYPES = ['league', 'knockout', 'group-stage', 'mixed'];
const FORMATS = ['6 Overs', '8 Overs', 'T10', 'T20', 'ODI', 'Test'];
const FIXTURE_FORMATS = [
    { value: 'round-robin', label: 'Round Robin (league)' },
    { value: 'group', label: 'Group Stage' },
    { value: 'knockout', label: 'Knockout' },
];

const inputCls = 'border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#031d44] w-full';
const btnPrimary = 'bg-[#031d44] hover:bg-slate-800 text-white font-black text-xs uppercase tracking-widest rounded-xl px-4 py-2 disabled:opacity-50';
const btnGhost = 'bg-slate-200 hover:bg-slate-300 text-[#031d44] font-black text-xs uppercase tracking-widest rounded-xl px-4 py-2';

const emptyForm = {
    name: '',
    shortName: '',
    type: 'league',
    format: 'T20',
    startDate: '',
    endDate: '',
    venue: '',
    teams: [],
    pointsConfig: { win: 2, tie: 1, noResult: 1 },
};

const fmtDate = (value) => {
    if (!value) return 'TBD';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? 'TBD' : d.toLocaleString();
};

const teamName = (t) => t?.name || t?.shortName || 'TBD';

export default function TournamentManagement() {
    const { showToast } = useToast();
    const [tournaments, setTournaments] = useState([]);
    const [allTeams, setAllTeams] = useState([]);
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [editId, setEditId] = useState(null);

    const [selectedId, setSelectedId] = useState(null);
    const [detail, setDetail] = useState(null);
    const [fixtures, setFixtures] = useState([]);
    const [tab, setTab] = useState('fixtures');

    const [fixtureOpts, setFixtureOpts] = useState({ format: 'round-robin', startAt: '', gapHours: 2, venue: '' });
    const [preview, setPreview] = useState(null);
    const [manual, setManual] = useState({ team1: '', team2: '', startTime: '', round: 1, group: '' });
    const [groupAssign, setGroupAssign] = useState({});
    const [filters, setFilters] = useState({ status: '', team: '' });

    const fetchTournaments = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/tournaments');
            setTournaments(Array.isArray(res.data) ? res.data : res.data.data || []);
        } catch (err) {
            console.error(err);
            showToast('Failed to load tournaments', 'error');
        }
        setLoading(false);
    }, [showToast]);

    const fetchTeams = useCallback(async () => {
        try {
            const res = await api.get('/teams');
            setAllTeams(Array.isArray(res.data) ? res.data : res.data.data || []);
        } catch (err) {
            console.error(err);
        }
    }, []);

    useEffect(() => {
        fetchTournaments();
        fetchTeams();
    }, [fetchTournaments, fetchTeams]);

    const loadDetail = useCallback(async (id) => {
        try {
            const [detailRes, fixturesRes] = await Promise.all([
                api.get(`/tournaments/${id}`),
                api.get(`/tournaments/${id}/fixtures`),
            ]);
            setDetail(detailRes.data);
            setFixtures(Array.isArray(fixturesRes.data) ? fixturesRes.data : []);
            const assigns = {};
            (detailRes.data.groups || []).forEach((g) => {
                (g.teams || []).forEach((t) => {
                    assigns[String(t?._id || t)] = g.name;
                });
            });
            setGroupAssign(assigns);
        } catch (err) {
            console.error(err);
            showToast('Failed to load tournament detail', 'error');
        }
    }, [showToast]);

    useEffect(() => {
        if (selectedId) loadDetail(selectedId);
    }, [selectedId, loadDetail]);

    const tournamentTeams = useMemo(() => detail?.teams || [], [detail]);

    const statusOptions = useMemo(
        () => Array.from(new Set(fixtures.map((f) => f.status).filter(Boolean))),
        [fixtures],
    );

    const filteredFixtures = useMemo(
        () => fixtures.filter((f) => {
            if (filters.status && f.status !== filters.status) return false;
            if (filters.team) {
                const ids = (f.teams || []).map((t) => String(t?._id || t));
                if (!ids.includes(filters.team)) return false;
            }
            return true;
        }),
        [fixtures, filters],
    );

    const groupedFixtures = useMemo(() => {
        const groups = new Map();
        for (const f of filteredFixtures) {
            const round = f.round != null ? f.round : 1;
            const key = `${f.group || ''}::${round}`;
            if (!groups.has(key)) groups.set(key, { group: f.group || '', round, matches: [] });
            groups.get(key).matches.push(f);
        }
        return Array.from(groups.values()).sort(
            (a, b) => (a.group || '').localeCompare(b.group || '') || a.round - b.round,
        );
    }, [filteredFixtures]);

    const toggleTeam = (id) => {
        setForm((prev) => {
            const has = prev.teams.includes(id);
            return { ...prev, teams: has ? prev.teams.filter((t) => t !== id) : [...prev.teams, id] };
        });
    };

    const submitForm = async (e) => {
        e.preventDefault();
        try {
            const payload = {
                ...form,
                shortName: form.shortName || form.name.substring(0, 10).toUpperCase(),
            };
            if (editId) {
                await api.put(`/tournaments/${editId}`, payload);
                showToast('Tournament updated', 'success');
            } else {
                await api.post('/tournaments', payload);
                showToast('Tournament created', 'success');
            }
            setForm(emptyForm);
            setEditId(null);
            fetchTournaments();
        } catch (err) {
            showToast(err.response?.data?.message || 'Failed to save tournament', 'error');
        }
    };

    const startEdit = (t) => {
        setEditId(t._id);
        setForm({
            name: t.name || '',
            shortName: t.shortName || '',
            type: t.type || 'league',
            format: t.format || 'T20',
            startDate: t.startDate ? String(t.startDate).slice(0, 10) : '',
            endDate: t.endDate ? String(t.endDate).slice(0, 10) : '',
            venue: t.venue || '',
            teams: (t.teams || []).map((x) => String(x?._id || x)),
            pointsConfig: t.pointsConfig || { win: 2, tie: 1, noResult: 1 },
        });
    };

    const removeTournament = async (id) => {
        if (!window.confirm('Delete this tournament and all its fixtures?')) return;
        try {
            await api.delete(`/tournaments/${id}`);
            showToast('Tournament deleted', 'success');
            if (selectedId === id) setSelectedId(null);
            fetchTournaments();
        } catch (err) {
            showToast(err.response?.data?.message || 'Failed to delete', 'error');
        }
    };

    const previewFixtures = async () => {
        try {
            const res = await api.post(`/tournaments/${selectedId}/fixtures/preview`, fixtureOpts);
            setPreview(res.data.preview || null);
            showToast('Preview ready', 'success');
        } catch (err) {
            showToast(err.response?.data?.message || 'Preview failed', 'error');
        }
    };

    const applyFixtures = async () => {
        try {
            const res = await api.post(`/tournaments/${selectedId}/fixtures/apply`, fixtureOpts);
            showToast(res.data.message || 'Fixtures applied', 'success');
            setPreview(null);
            loadDetail(selectedId);
        } catch (err) {
            showToast(err.response?.data?.message || 'Apply failed', 'error');
        }
    };

    const createManualFixture = async () => {
        try {
            await api.post(`/tournaments/${selectedId}/matches`, {
                ...manual,
                round: Number(manual.round) || 1,
            });
            showToast('Fixture added', 'success');
            setManual({ team1: '', team2: '', startTime: '', round: 1, group: '' });
            loadDetail(selectedId);
        } catch (err) {
            showToast(err.response?.data?.message || 'Failed to add fixture', 'error');
        }
    };

    const saveGroups = async () => {
        const byName = {};
        Object.entries(groupAssign).forEach(([teamId, name]) => {
            const key = (name || '').trim();
            if (!key) return;
            byName[key] = byName[key] || [];
            byName[key].push(teamId);
        });
        const groups = Object.entries(byName).map(([name, teams]) => ({ name, teams }));
        if (!groups.length) {
            showToast('Assign at least one team to a group', 'error');
            return;
        }
        try {
            await api.post(`/tournaments/${selectedId}/groups`, { groups });
            showToast('Groups saved', 'success');
            loadDetail(selectedId);
        } catch (err) {
            showToast(err.response?.data?.message || 'Failed to save groups', 'error');
        }
    };

    const recomputePoints = async () => {
        try {
            await api.post('/tournaments/update-points', { tournamentId: selectedId });
            showToast('Points table recomputed', 'success');
            loadDetail(selectedId);
        } catch (err) {
            showToast(err.response?.data?.message || 'Recompute failed', 'error');
        }
    };

    const matchAction = async (matchId, action) => {
        try {
            if (action === 'abandon') {
                if (!window.confirm('Abandon this match?')) return;
                await api.post(`/matches/${matchId}/abandon`, {});
            } else if (action === 'postpone') {
                const reason = window.prompt('Reason for postponing?') || '';
                await api.post(`/matches/${matchId}/postpone`, { reason });
            } else if (action === 'reschedule') {
                const when = window.prompt('New date-time (ISO, e.g. 2026-10-11T09:00)');
                if (!when) return;
                await api.post(`/matches/${matchId}/reschedule`, { startAt: when });
            }
            showToast('Match updated', 'success');
            loadDetail(selectedId);
        } catch (err) {
            showToast(err.response?.data?.message || 'Action failed', 'error');
        }
    };

    const renderFixtures = () => (
        <div className="space-y-6">
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                <h4 className="font-bold text-[#031d44] mb-3">Auto-generate fixtures</h4>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                    <select
                        className={inputCls}
                        value={fixtureOpts.format}
                        onChange={(e) => setFixtureOpts({ ...fixtureOpts, format: e.target.value })}
                    >
                        {FIXTURE_FORMATS.map((f) => (
                            <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                    </select>
                    <input
                        type="datetime-local"
                        className={inputCls}
                        value={fixtureOpts.startAt}
                        onChange={(e) => setFixtureOpts({ ...fixtureOpts, startAt: e.target.value })}
                    />
                    <input
                        type="number"
                        min="1"
                        className={inputCls}
                        placeholder="Gap hours"
                        value={fixtureOpts.gapHours}
                        onChange={(e) => setFixtureOpts({ ...fixtureOpts, gapHours: e.target.value })}
                    />
                    <input
                        className={inputCls}
                        placeholder="Venue (optional)"
                        value={fixtureOpts.venue}
                        onChange={(e) => setFixtureOpts({ ...fixtureOpts, venue: e.target.value })}
                    />
                </div>
                <div className="flex gap-2">
                    <button className={btnGhost} onClick={previewFixtures}>Preview</button>
                    <button className={btnPrimary} onClick={applyFixtures}>Apply</button>
                </div>
                {preview && (
                    <p className="text-sm text-slate-600 mt-3">
                        {preview.format}: {preview.totalMatches} concrete match(es), {preview.tbdMatches} TBD
                        {preview.warnings?.length ? ` — ${preview.warnings.join(' ')}` : ''}
                    </p>
                )}
            </div>

            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                <h4 className="font-bold text-[#031d44] mb-3">Add a fixture manually</h4>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-3">
                    <select className={inputCls} value={manual.team1} onChange={(e) => setManual({ ...manual, team1: e.target.value })}>
                        <option value="">Team A</option>
                        {tournamentTeams.map((t) => (
                            <option key={t._id} value={t._id}>{teamName(t)}</option>
                        ))}
                    </select>
                    <select className={inputCls} value={manual.team2} onChange={(e) => setManual({ ...manual, team2: e.target.value })}>
                        <option value="">Team B</option>
                        {tournamentTeams.map((t) => (
                            <option key={t._id} value={t._id}>{teamName(t)}</option>
                        ))}
                    </select>
                    <input type="datetime-local" className={inputCls} value={manual.startTime} onChange={(e) => setManual({ ...manual, startTime: e.target.value })} />
                    <input type="number" min="1" className={inputCls} placeholder="Round" value={manual.round} onChange={(e) => setManual({ ...manual, round: e.target.value })} />
                    <input className={inputCls} placeholder="Group (optional)" value={manual.group} onChange={(e) => setManual({ ...manual, group: e.target.value })} />
                </div>
                <button className={btnPrimary} onClick={createManualFixture} disabled={!manual.team1 || !manual.team2}>Add fixture</button>
            </div>

            {fixtures.length === 0 ? (
                <p className="text-slate-500">No fixtures yet.</p>
            ) : (
                <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <select className={inputCls} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                            <option value="">All statuses</option>
                            {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <select className={inputCls} value={filters.team} onChange={(e) => setFilters({ ...filters, team: e.target.value })}>
                            <option value="">All teams</option>
                            {tournamentTeams.map((t) => <option key={t._id} value={t._id}>{teamName(t)}</option>)}
                        </select>
                        <button className={btnGhost} onClick={() => setFilters({ status: '', team: '' })}>Clear filters</button>
                    </div>

                    {groupedFixtures.length === 0 ? (
                        <p className="text-slate-500">No fixtures match these filters.</p>
                    ) : groupedFixtures.map((grp) => (
                        <div key={`${grp.group}-${grp.round}`}>
                            <h5 className="font-black text-xs uppercase tracking-widest text-slate-500 mb-2">
                                {grp.group ? `Group ${grp.group} · ` : ''}Round {grp.round}
                            </h5>
                            <div className="space-y-3">
                                {grp.matches.map((m) => (
                                    <div key={m._id} className="bg-white rounded-xl p-4 border border-slate-200">
                                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                                            <div>
                                                <p className="font-bold text-[#031d44]">
                                                    {teamName(m.teams?.[0])} vs {teamName(m.teams?.[1])}
                                                </p>
                                                <p className="text-sm text-slate-500">{fmtDate(m.startAt)} · {m.venue || 'Venue TBD'}</p>
                                                <span className="inline-block mt-1 text-xs font-bold uppercase tracking-widest text-slate-600">{m.status}</span>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                <Link className={btnPrimary} to={`/admin/score/${m._id}`}>Open scoring</Link>
                                                <button className={btnGhost} onClick={() => matchAction(m._id, 'reschedule')}>Reschedule</button>
                                                <button className={btnGhost} onClick={() => matchAction(m._id, 'postpone')}>Postpone</button>
                                                <button className={btnGhost} onClick={() => matchAction(m._id, 'abandon')}>Abandon</button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );

    const renderPoints = () => (
        <div className="space-y-3">
            <button className={btnPrimary} onClick={recomputePoints}>Recompute points</button>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-[#031d44] text-white">
                            <th className="px-4 py-3 text-left">Pos</th>
                            <th className="px-4 py-3 text-left">Team</th>
                            <th className="px-4 py-3 text-center">M</th>
                            <th className="px-4 py-3 text-center">W</th>
                            <th className="px-4 py-3 text-center">L</th>
                            <th className="px-4 py-3 text-center">T</th>
                            <th className="px-4 py-3 text-center">NRR</th>
                            <th className="px-4 py-3 text-center">PTS</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(detail?.pointsTable || []).map((row, idx) => (
                            <tr key={String(row.team?._id || row.team || idx)} className="border-b border-slate-200 hover:bg-slate-50">
                                <td className="px-4 py-3 font-bold">{idx + 1}</td>
                                <td className="px-4 py-3 font-bold text-[#031d44]">{teamName(row.team)}</td>
                                <td className="px-4 py-3 text-center">{row.matchesPlayed}</td>
                                <td className="px-4 py-3 text-center">{row.won}</td>
                                <td className="px-4 py-3 text-center">{row.lost}</td>
                                <td className="px-4 py-3 text-center">{row.tied}</td>
                                <td className="px-4 py-3 text-center">{Number(row.netRunRate || 0).toFixed(3)}</td>
                                <td className="px-4 py-3 text-center font-black">{row.points}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const renderGroups = () => (
        <div className="space-y-3">
            <p className="text-sm text-slate-600">Type a group name (A, B, ...) next to each team, then save.</p>
            {tournamentTeams.map((t) => (
                <div key={t._id} className="flex items-center gap-3">
                    <span className="flex-1 font-bold text-[#031d44]">{teamName(t)}</span>
                    <input
                        className={`${inputCls} max-w-[140px]`}
                        placeholder="Group"
                        value={groupAssign[t._id] || ''}
                        onChange={(e) => setGroupAssign({ ...groupAssign, [t._id]: e.target.value })}
                    />
                </div>
            ))}
            <button className={btnPrimary} onClick={saveGroups}>Save groups</button>
        </div>
    );

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-6 lg:p-10">
            <h1 className="text-4xl lg:text-5xl font-black text-[#031d44] mb-8">Tournament Management</h1>

            <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6 mb-8">
                <h2 className="text-2xl font-bold text-[#031d44] mb-4">{editId ? 'Edit Tournament' : 'Create New Tournament'}</h2>
                <form onSubmit={submitForm} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <input className={inputCls} placeholder="Tournament Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                    <input className={inputCls} placeholder="Short Name" value={form.shortName} onChange={(e) => setForm({ ...form, shortName: e.target.value })} />
                    <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                        {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <select className={inputCls} value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}>
                        {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                    <input type="date" className={inputCls} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
                    <input type="date" className={inputCls} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required />
                    <input className={inputCls} placeholder="Venue" value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} />
                    <div className="flex gap-2">
                        <button type="submit" className={btnPrimary}>{editId ? 'Update' : 'Create'}</button>
                        {editId && (
                            <button type="button" className={btnGhost} onClick={() => { setEditId(null); setForm(emptyForm); }}>Cancel</button>
                        )}
                    </div>
                    <div className="md:col-span-2 lg:col-span-4">
                        <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Teams ({form.teams.length} selected)</p>
                        <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                            {allTeams.map((t) => {
                                const active = form.teams.includes(t._id);
                                return (
                                    <button
                                        type="button"
                                        key={t._id}
                                        onClick={() => toggleTeam(t._id)}
                                        className={`px-3 py-1 rounded-lg text-xs font-bold border ${active ? 'bg-[#031d44] text-white border-[#031d44]' : 'bg-white text-slate-600 border-slate-300'}`}
                                    >
                                        {teamName(t)}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </form>
            </div>

            <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6 mb-8">
                <h2 className="text-2xl font-bold text-[#031d44] mb-4">Tournaments</h2>
                {loading ? (
                    <p className="text-slate-500">Loading...</p>
                ) : tournaments.length === 0 ? (
                    <p className="text-slate-500">No tournaments yet.</p>
                ) : (
                    <div className="space-y-3">
                        {tournaments.map((t) => (
                            <div key={t._id} className="flex flex-col md:flex-row md:items-center justify-between gap-3 border border-slate-200 rounded-xl p-4">
                                <div>
                                    <p className="font-bold text-[#031d44]">{t.name}</p>
                                    <p className="text-sm text-slate-500">{t.type} · {t.format} · {t.venue || 'Venue TBD'}</p>
                                    <p className="text-xs text-slate-400">{fmtDate(t.startDate)} – {fmtDate(t.endDate)}</p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <button className={btnPrimary} onClick={() => setSelectedId(t._id)}>Manage</button>
                                    <button className={btnGhost} onClick={() => startEdit(t)}>Edit</button>
                                    <button className={btnGhost} onClick={() => removeTournament(t._id)}>Delete</button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {selectedId && detail && (
                <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-bold text-[#031d44]">{detail.name}</h2>
                        <button className={btnGhost} onClick={() => setSelectedId(null)}>Close</button>
                    </div>
                    <div className="flex border-b border-slate-200 mb-4">
                        {['fixtures', 'points', 'groups'].map((name) => (
                            <button
                                key={name}
                                onClick={() => setTab(name)}
                                className={`px-6 py-3 font-bold text-sm uppercase tracking-wider ${tab === name ? 'bg-[#031d44] text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                            >
                                {name === 'fixtures' ? 'Fixtures' : name === 'points' ? 'Points Table' : 'Groups'}
                            </button>
                        ))}
                    </div>
                    {tab === 'fixtures' && renderFixtures()}
                    {tab === 'points' && renderPoints()}
                    {tab === 'groups' && renderGroups()}
                </div>
            )}
        </div>
    );
}
