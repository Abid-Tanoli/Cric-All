import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { fetchTeams } from "../store/slices/teamSlice";
import api from "../services/api";
import EventSquadSelection from "../components/EventSquadSelection";
import ChangePlayerModal from "../components/ChangePlayerModal";
import { useToast } from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";

const EVENT_TYPES = [
    { value: "single-match", label: "Single Match", icon: "🏏", desc: "One standalone match" },
    { value: "series", label: "Series", icon: "📅", desc: "2+ teams, multiple matches" },
    { value: "tri-series", label: "Tri-Series", icon: "🔺", desc: "3 teams competing" },
    { value: "tournament", label: "Tournament", icon: "🏆", desc: "League/Knockout format" },
    { value: "league", label: "League", icon: "📊", desc: "Round-robin format" },
    { value: "world-cup", label: "World Cup", icon: "🌍", desc: "Global championship" },
    { value: "champions-trophy", label: "Champions Trophy", icon: "👑", desc: "Top teams invitational" },
];

export default function ManageEvents() {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { teams } = useSelector((state) => state.teams);
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [filterType, setFilterType] = useState("");
    const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm();
    const selectedType = watch("eventType");
    const selectedFormat = watch("format");
    const selectedTeams = watch("teams") || [];
    const selectedTotalMatches = watch("totalMatches");

    // Event Squad Modal State
    const [showEventSquadModal, setShowEventSquadModal] = useState(false);
    const [eventSquadEvent, setEventSquadEvent] = useState(null);
    const [eventSquadTeam, setEventSquadTeam] = useState(null);

    // Change Player Modal State
    const [showChangePlayerModal, setShowChangePlayerModal] = useState(false);
    const [changePlayerEvent, setChangePlayerEvent] = useState(null);
    const [changePlayerTeam, setChangePlayerTeam] = useState(null);
    const [changePlayerSquad, setChangePlayerSquad] = useState(null);
    const { showToast } = useToast();
    const [confirmModal, setConfirmModal] = useState({ open: false, title: '', message: '', onConfirm: null, variant: 'danger' });

    useEffect(() => {
        loadEvents();
        dispatch(fetchTeams());
    }, [dispatch]);

    const loadEvents = async () => {
        try {
            const res = await api.get("/events");
            setEvents(res.data);
        } catch (err) { console.error(err); } finally { setLoading(false); }
    };

    const openEventSquadModal = (eventObj, team) => {
        setEventSquadEvent(eventObj);
        setEventSquadTeam(team);
        setShowEventSquadModal(true);
    };

    const openChangePlayerModal = (eventObj, team, squad) => {
        setChangePlayerEvent(eventObj);
        setChangePlayerTeam(team);
        setChangePlayerSquad(squad);
        setShowChangePlayerModal(true);
    };

    const onSubmit = async (data) => {
        try {
            setLoading(true);
            let eventId = editingId;
            if (editingId) {
                await api.put(`/events/${editingId}`, data);
                setEditingId(null);
            } else {
                const res = await api.post("/events", data);
                eventId = res.data.event?._id;

                // Auto-create matches for series if we have exactly 2 teams and placeholders were filled
                if (data.eventType === 'series' && data.seriesMatches && data.teams?.length === 2 && eventId) {
                    for (let i = 0; i < data.seriesMatches.length; i++) {
                        const mData = data.seriesMatches[i];
                        if (!mData.date) continue; // Skip if date wasn't provided
                        
                        const startAt = new Date(`${mData.date}T${mData.time || '10:00'}`);
                        const matchPayload = {
                            title: `${data.name} - Match ${i + 1}`,
                            venue: mData.venue || data.venue || "",
                            matchType: data.format || "T20",
                            matchCategory: data.category || "Other",
                            category: data.category || "Other",
                            organization: data.organization || "",
                            address: data.address || {},
                            startAt,
                            teams: data.teams,
                            tournamentId: eventId,
                            series: data.name,
                            seriesMatchNumber: i + 1
                        };
                        try {
                            await api.post("/matches", matchPayload);
                        } catch (err) {
                            console.error(`Failed to create Match ${i+1}`, err);
                        }
                    }
                }
            }
            reset();
            setShowForm(false);
            loadEvents();
        } catch (err) {
            console.error(err);
            showToast(err.response?.data?.message || "Failed to save event", 'error');
        } finally { setLoading(false); }
    };

    const onEdit = (ev) => {
        setEditingId(ev._id);
        setShowForm(true);
        setValue("name", ev.name);
        setValue("shortName", ev.shortName);
        setValue("eventType", ev.eventType);
        setValue("format", ev.format);
        setValue("startDate", ev.startDate?.substring(0, 10));
        setValue("endDate", ev.endDate?.substring(0, 10));
        setValue("venue", ev.venue || "");
        setValue("description", ev.description || "");
        setValue("teams", ev.teams?.map(t => t._id || t));
        setValue("category", ev.category);
        setValue("subCategory", ev.subCategory);
        setValue("ageGroup", ev.ageGroup);
        setValue("organization", ev.organization);
        setValue("address", ev.address || { town: "", district: "", city: "", province: "", country: "Pakistan" });
    };

    const onDelete = (id) => {
        setConfirmModal({ open: true, title: 'Delete Event', message: 'Delete this event and all its matches?', confirmLabel: 'Delete', variant: 'danger', onConfirm: async () => { setConfirmModal({ open: false }); try { await api.delete(`/events/${id}`); loadEvents(); } catch (err) { showToast('Failed to delete event', 'error'); } } });
    };

    const openSquadForm = async (ev, teamId) => {
        console.log('=== OPENING SQUAD FORM ===');
        console.log('Event:', ev);
        console.log('Event ID:', ev._id);
        console.log('Team ID:', teamId);
        console.log('Navigation URL:', `/admin/events/${ev._id}/squad/${teamId}`);
        navigate(`/admin/events/${ev._id}/squad/${teamId}`);
    };

    const filtered = filterType ? events.filter(e => e.eventType === filterType) : events;

    return (
        <div className="space-y-6 bg-[#f8fafc] min-h-screen p-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#031d44] p-6 rounded-2xl shadow-xl text-white">
                <div>
                    <h2 className="text-2xl font-black uppercase tracking-tight">Manage Events</h2>
                    <p className="text-blue-200/60 text-xs mt-1 font-medium">Single matches, series, tournaments & championships</p>
                </div>
                <button
                    onClick={() => { setShowForm(!showForm); setEditingId(null); reset(); }}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg transition-all"
                >
                    {showForm ? "✕ Cancel" : "+ Create Event"}
                </button>
            </div>

            {/* Event Type Filter */}
            <div className="flex gap-2 overflow-x-auto pb-2">
                <button onClick={() => setFilterType("")} className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap ${!filterType ? "bg-[#031d44] text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>All ({events.length})</button>
                {EVENT_TYPES.map(et => (
                    <button key={et.value} onClick={() => setFilterType(et.value)} className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap ${filterType === et.value ? "bg-[#031d44] text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                        {et.icon} {et.label} ({events.filter(e => e.eventType === et.value).length})
                    </button>
                ))}
            </div>

            {/* Create/Edit Form */}
            {showForm && (
                <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">
                    <div className="bg-[#031d44] px-6 py-4">
                        <h3 className="text-white font-black uppercase tracking-widest text-xs">{editingId ? "Edit Event" : "Create New Event"}</h3>
                    </div>
                    <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
                        {/* Event Type Selector */}
                        <div>
                            <label className="text-[10px] font-black uppercase text-slate-400 block mb-2">Event Type *</label>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {EVENT_TYPES.map(et => (
                                    <label key={et.value} className={`p-3 rounded-xl border-2 cursor-pointer transition-all text-center ${selectedType === et.value ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-slate-300"}`}>
                                        <input type="radio" value={et.value} {...register("eventType", { required: true })} className="hidden" />
                                        <span className="text-2xl block">{et.icon}</span>
                                        <span className="text-xs font-bold text-slate-800 block mt-1">{et.label}</span>
                                        <span className="text-[9px] text-slate-500">{et.desc}</span>
                                    </label>
                                ))}
                            </div>
                            {errors.eventType && <p className="text-red-500 text-xs mt-1">Event type is required</p>}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Event Name *</label>
                                <input {...register("name", { required: true })} placeholder="e.g., Pakistan Super League 2026" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800" />
                            </div>
                            <div>
                                <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Short Name</label>
                                <input {...register("shortName")} placeholder="e.g., PSL 2026" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800" />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Format</label>
                                <select {...register("format")} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800">
                                    {["T20", "ODI", "T10", "Test", "6 Overs", "8 Overs", "Tape Ball"].map(f => <option key={f} value={f}>{f}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Start Date</label>
                                <input type="date" {...register("startDate", { required: true })} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800" />
                            </div>
                            <div>
                                <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">End Date</label>
                                <input type="date" {...register("endDate", { required: true })} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800" />
                            </div>
                        </div>

                        {/* Overs field for Tape Ball */}
                        {selectedFormat === "Tape Ball" && (
                            <div>
                                <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Overs Per Innings *</label>
                                <input type="number" {...register("overs", { min: 1, max: 20 })} min="1" max="20" placeholder="e.g., 6, 8, 10" className="w-full md:w-1/3 p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800" />
                                <p className="text-[10px] text-slate-500 mt-1">How many overs per innings for Tape Ball matches? (1-20)</p>
                            </div>
                        )}

                        {/* Total Matches (for series/tournaments) */}
                        {selectedType && selectedType !== "single-match" && (
                            <div>
                                <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Total Matches in Series *</label>
                                <input type="number" {...register("totalMatches", { min: 1 })} min="1" placeholder="e.g., 5" className="w-full md:w-1/3 p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800" />
                                <p className="text-[10px] text-slate-500 mt-1">How many matches will be played in this series/tournament?</p>
                            </div>
                        )}

                        {/* Deep Categorization Section */}
                        <div className="bg-blue-50/50 p-6 rounded-2xl border border-blue-100 space-y-4">
                            <h4 className="text-xs font-black text-[#031d44] uppercase tracking-widest flex items-center gap-2">
                                <span className="text-lg">🏷️</span> Deep Categorization
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Category</label>
                                    <select {...register("category")} className="w-full p-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 focus:ring-2 ring-blue-500/20">
                                        {["School", "College", "University", "Organization", "Business", "Industry", "Club", "International", "Other"].map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Sub-Category / Level</label>
                                    <input {...register("subCategory")} placeholder="e.g., Primary, CS, Engineering" className="w-full p-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-800" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Age Group</label>
                                    <select {...register("ageGroup")} className="w-full p-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-800">
                                        {["U-10", "U-13", "U-15", "U-17", "U-19", "Open"].map(a => <option key={a} value={a}>{a}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Parent Organization / Institution</label>
                                <input {...register("organization")} placeholder="e.g., Al-Khidmat, University of Karachi, Allied Bank" className="w-full p-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-800" />
                            </div>
                        </div>

                        {/* Location / Address Section */}
                        <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 space-y-4">
                            <h4 className="text-xs font-black text-[#031d44] uppercase tracking-widest flex items-center gap-2">
                                <span className="text-lg">📍</span> Location Details
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                <div>
                                    <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Town / Area</label>
                                    <input {...register("address.town")} placeholder="e.g., North Nazimabad" className="w-full p-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-800" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">District</label>
                                    <input {...register("address.district")} placeholder="e.g., Central" className="w-full p-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-800" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">City</label>
                                    <input {...register("address.city")} placeholder="e.g., Karachi" className="w-full p-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-800" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Province</label>
                                    <input {...register("address.province")} placeholder="e.g., Sindh" className="w-full p-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-800" />
                                </div>
                            </div>
                        </div>

                        {/* Dynamic Placeholders for Series Matches */}
                        {selectedType === "series" && selectedTotalMatches > 0 && (
                            <div className="bg-slate-50 p-4 border border-slate-200 rounded-xl space-y-3">
                                <h4 className="text-xs font-black text-[#031d44] uppercase mb-2">Match Schedule Configuration</h4>
                                <p className="text-[10px] text-slate-500 mb-4">Set dates, times, and venues for each match in the series to auto-create them.</p>
                                {[...Array(parseInt(selectedTotalMatches) || 0)].map((_, i) => (
                                    <div key={i} className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 bg-white border border-slate-200 rounded-lg shadow-sm focus-within:ring-2 ring-blue-500/20">
                                        <div>
                                            <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Match {i + 1} Date</label>
                                            <input type="date" {...register(`seriesMatches.${i}.date`)} className="w-full p-2 bg-slate-50 border border-slate-200 rounded text-sm font-bold text-slate-800 focus:outline-none" />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Time (Local)</label>
                                            <input type="time" {...register(`seriesMatches.${i}.time`)} className="w-full p-2 bg-slate-50 border border-slate-200 rounded text-sm font-bold text-slate-800 focus:outline-none" />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Venue</label>
                                            <input type="text" {...register(`seriesMatches.${i}.venue`)} placeholder="e.g., Gaddafi Stadium" className="w-full p-2 bg-slate-50 border border-slate-200 rounded text-sm font-bold text-slate-800 focus:outline-none" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div>
                            <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Venue</label>
                            <input {...register("venue")} placeholder="e.g., National Stadium, Karachi" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800" />
                        </div>

                        {/* Teams (for multi-team events) */}
                        {selectedType && selectedType !== "single-match" && (
                            <div>
                                <label className="text-[10px] font-black uppercase text-slate-400 block mb-2">Teams * (Selected: {selectedTeams.length})</label>
                                <div className="max-h-48 overflow-y-auto border rounded-xl p-3 space-y-2 bg-slate-50">
                                    {teams.map(team => (
                                        <label key={team._id} className="flex items-center gap-3 p-2 bg-white rounded-lg border border-slate-200 cursor-pointer hover:bg-blue-50">
                                            <input type="checkbox" value={team._id} {...register("teams", { validate: v => selectedType === "single-match" || v?.length >= 2 || "Select at least 2 teams" })} className="w-4 h-4" />
                                            {team.logo && <img src={team.logo} alt={team.name} className="w-6 h-6 rounded object-cover" />}
                                            <span className="text-sm font-bold text-slate-800">{team.name}</span>
                                        </label>
                                    ))}
                                </div>
                                {errors.teams && <p className="text-red-500 text-xs mt-1">{errors.teams.message}</p>}
                            </div>
                        )}

                        <div>
                            <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Description</label>
                            <textarea {...register("description")} rows={2} placeholder="Brief description of the event" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800" />
                        </div>

                        <div className="flex gap-3 pt-4 border-t">
                            <button type="submit" disabled={loading} className="flex-1 bg-[#031d44] hover:bg-slate-800 text-white py-3 rounded-xl font-black text-xs uppercase tracking-widest shadow-xl disabled:opacity-50">
                                {loading ? "Saving..." : editingId ? "Update Event" : "Create Event"}
                            </button>
                            {editingId && (
                                <button type="button" onClick={() => { setEditingId(null); reset(); }} className="px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-black text-xs uppercase tracking-widest">
                                    Cancel
                                </button>
                            )}
                        </div>
                    </form>
                </div>
            )}

            {/* Events List */}
            <div className="space-y-4">
                {loading && events.length === 0 ? (
                    <div className="flex justify-center py-20"><div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
                ) : filtered.length === 0 ? (
                    <div className="bg-white rounded-2xl shadow-xl p-16 text-center border border-slate-200">
                        <span className="text-5xl block mb-4">🏏</span>
                        <h4 className="text-xl font-black text-[#031d44] uppercase">No Events Found</h4>
                        <p className="text-slate-500 text-sm mt-2">Create your first event to get started</p>
                    </div>
                ) : (
                    filtered.map(ev => {
                        const et = EVENT_TYPES.find(t => t.value === ev.eventType);
                        const squadReady = (ev.eventSquads || []).filter(s => s.players?.length >= 11).length;
                        const totalTeams = ev.teams?.length || 0;
                        return (
                            <div key={ev._id} className="bg-white rounded-2xl shadow-lg overflow-hidden border border-slate-200 hover:shadow-xl transition-all">
                                <div className="p-5">
                                    <div className="flex items-start justify-between mb-3">
                                        <div className="flex items-center gap-4">
                                            {ev.logo ? (
                                                <img src={ev.logo} alt={ev.name} className="w-14 h-14 rounded-xl object-cover border-2 border-slate-200" />
                                            ) : (
                                                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[#031d44] to-blue-700 flex items-center justify-center text-white font-black text-xl">
                                                    {et?.icon || "🏏"}
                                                </div>
                                            )}
                                            <div>
                                                <h4 className="font-black text-lg text-[#031d44] uppercase tracking-tight">{ev.name}</h4>
                                                <div className="flex items-center gap-3 mt-1">
                                                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-[10px] font-bold uppercase">{et?.label}</span>
                                                    <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-[10px] font-bold uppercase">{ev.format}</span>
                                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${ev.status === "live" ? "bg-red-100 text-red-700" : ev.status === "completed" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>{ev.status}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${squadReady >= totalTeams && totalTeams > 0 ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                                            Squads: {squadReady}/{totalTeams}
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs mb-4">
                                        <div><span className="text-slate-500 font-bold block">Teams</span><span className="text-slate-800 font-black">{totalTeams}</span></div>
                                        <div><span className="text-slate-500 font-bold block">Matches</span><span className="text-slate-800 font-black">{ev.totalMatches || 0} planned</span></div>
                                        <div><span className="text-slate-500 font-bold block">Created</span><span className="text-slate-800 font-black">{ev.matches?.length || 0}</span></div>
                                        <div><span className="text-slate-500 font-bold block">Start</span><span className="text-slate-800 font-black">{ev.startDate ? new Date(ev.startDate).toLocaleDateString() : "TBD"}</span></div>
                                        <div><span className="text-slate-500 font-bold block">Venue</span><span className="text-slate-800 font-black truncate">{ev.venue || "TBD"}</span></div>
                                    </div>

                                    {/* Squad Warning */}
                                    {["series", "tri-series", "tournament", "world-cup", "champions-trophy", "league"].includes(ev.eventType) && squadReady < totalTeams && (
                                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 flex items-center gap-3">
                                            <span className="text-xl">⚠️</span>
                                            <div>
                                                <p className="text-xs font-bold text-amber-900">Squad selection pending</p>
                                                <p className="text-[10px] text-amber-700">Please select 11-20 players for each team in this event</p>
                                            </div>
                                        </div>
                                    )}

                                    {/* Action Buttons */}
                                    <div className="flex flex-wrap gap-2">
                                        <Link to={`/admin/events/${ev._id}`} className="px-3 py-1.5 bg-[#031d44] hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition-colors">
                                            📋 View Details
                                        </Link>
                                        {/* Squad buttons for multi-team events */}
                                        {["series", "tri-series", "tournament", "world-cup", "champions-trophy", "league"].includes(ev.eventType) && ev.teams?.map(team => {
                                            const teamId = team._id || team;
                                            const teamSquad = ev.eventSquads?.find(s => (s.team?._id || s.team) === teamId);
                                            const isReady = teamSquad?.players?.length >= 11;
                                            return (
                                                <button key={teamId} onClick={() => openEventSquadModal(ev, team)}
                                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${isReady ? "bg-green-50 border border-green-200 text-green-700 hover:bg-green-100" : "bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100"}`}>
                                                    {(team.shortName || team.name || "Team").substring(0, 15)} Squad {isReady ? `✓ (${teamSquad.players.length})` : "✗"}
                                                </button>
                                            );
                                        })}
                                        <button onClick={() => onEdit(ev)} className="px-3 py-1.5 bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 rounded-lg text-xs font-bold transition-colors">✎ Edit</button>
                                        <button onClick={() => onDelete(ev._id)} className="px-3 py-1.5 bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 rounded-lg text-xs font-bold transition-colors">🗑 Delete</button>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Event Squad Selection Modal */}
            {showEventSquadModal && eventSquadEvent && eventSquadTeam && (
                <EventSquadSelection
                    event={eventSquadEvent}
                    team={eventSquadTeam}
                    onClose={() => setShowEventSquadModal(false)}
                    onSuccess={loadEvents}
                />
            )}

            {/* Change Player Modal */}
            {showChangePlayerModal && changePlayerEvent && changePlayerTeam && changePlayerSquad && (
                <ChangePlayerModal
                    event={changePlayerEvent}
                    team={changePlayerTeam}
                    currentSquad={changePlayerSquad}
                    onClose={() => setShowChangePlayerModal(false)}
                    onSuccess={loadEvents}
                />
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
}
