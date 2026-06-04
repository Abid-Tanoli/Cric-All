import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { fetchPlayers, createPlayer, updatePlayer, updatePlayerStats, deletePlayer, bulkDeletePlayers } from "../store/slices/playersSlice";
import { fetchTeams } from "../store/slices/teamSlice";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { useToast } from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";

export default function ManagePlayers() {
  const dispatch = useDispatch();
  const { players, loading, pagination } = useSelector((state) => state.players);
  const { teams } = useSelector((state) => state.teams);
  const [search, setSearch] = useState("");
  const [filterTeam, setFilterTeam] = useState("");
  const [filterCampus, setFilterCampus] = useState("");
  const [page, setPage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [selectedPlayers, setSelectedPlayers] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const { register, handleSubmit, reset, setValue } = useForm();
  const { showToast } = useToast();
  const [confirmModal, setConfirmModal] = useState({ open: false, title: '', message: '', onConfirm: null, variant: 'danger' });

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    dispatch(fetchPlayers({ page, search: debouncedSearch, team: filterTeam, Campus: filterCampus }));
  }, [dispatch, page, debouncedSearch, filterTeam, filterCampus]);

  useEffect(() => {
    dispatch(fetchTeams());
  }, [dispatch]);

  useEffect(() => {
    setSelectedPlayers([]);
  }, [players]);

  const onSubmit = async (data) => {
    try {
      if (editingId) {
        await dispatch(updatePlayer({ id: editingId, data }));
        setEditingId(null);
      } else {
        await dispatch(createPlayer(data));
      }
      reset();
    } catch (err) {
      console.error(err);
      showToast(editingId ? "Failed to update player" : "Failed to create player", 'error');
    }
  };

  const handleEdit = (p) => {
    setEditingId(p._id);
    setValue("name", p.name);
    setValue("playingRole", p.playingRole || p.role || "");
    setValue("battingStyle", p.battingStyle || "");
    setValue("bowlingStyle", p.bowlingStyle || "");
    setValue("Campus", p.Campus || "");
    setValue("imageUrl", p.imageUrl || "");
    setValue("team", p.team?._id || p.team || "");
    setValue("category", p.category || "Other");
    setValue("subCategory", p.subCategory || "");
    setValue("ageGroup", p.ageGroup || "Open");
    setValue("organization", p.organization || "");
    setValue("address", p.address || { town: "", district: "", city: "", province: "", country: "Pakistan" });
  };

  const cancelEdit = () => {
    setEditingId(null);
    reset();
  };

  const handleDelete = (id) => {
    setConfirmModal({ open: true, title: 'Delete Player', message: 'Delete this player?', confirmLabel: 'Delete', variant: 'danger', onConfirm: async () => { setConfirmModal({ open: false }); await dispatch(deletePlayer(id)); } });
  };

  const handleSelectPlayer = (playerId) => {
    setSelectedPlayers((prev) =>
      prev.includes(playerId)
        ? prev.filter((id) => id !== playerId)
        : [...prev, playerId]
    );
  };

  const handleSelectAll = () => {
    if (selectedPlayers.length === players.length) {
      setSelectedPlayers([]);
    } else {
      setSelectedPlayers(players.map((p) => p._id));
    }
  };

  const handleBulkDelete = () => {
    if (selectedPlayers.length === 0) {
      showToast("Please select players to delete", 'warning');
      return;
    }
    setConfirmModal({ open: true, title: 'Bulk Delete Players', message: `Are you sure you want to delete ${selectedPlayers.length} player(s)? This action cannot be undone.`, confirmLabel: 'Delete All', variant: 'danger', onConfirm: async () => { setConfirmModal({ open: false }); doBulkDelete(); } });
  };

  const doBulkDelete = async () => {
    try {
      setBulkDeleting(true);
      await dispatch(bulkDeletePlayers(selectedPlayers));
      showToast(`Successfully deleted ${selectedPlayers.length} player(s)`, 'success');
      setSelectedPlayers([]);
      dispatch(fetchPlayers({ page, search: debouncedSearch, team: filterTeam, Campus: filterCampus }));
    } catch (err) {
      console.error(err);
      showToast("Error deleting players: " + (err.message || "Unknown error"), 'error');
    } finally {
      setBulkDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-6 lg:p-10">
      {/* Header */}
      <div className="mb-10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-4xl lg:text-5xl font-black text-[#031d44] tracking-tight">
            PLAYER REGISTRY
          </h1>
          <p className="text-slate-500 mt-2 font-medium">
            Manage your league's official talent pool
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            to="/admin/bulk-import"
            className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg transition-all active:scale-95"
          >
            Bulk Import
          </Link>
          <button
            onClick={() => {
              setEditingId(null);
              reset();
            }}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-900/40 transition-all active:scale-95"
          >
            Assign Entry
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
        {/* Left Side: Filter & Form Sidebar */}
        <div className="xl:col-span-1 space-y-6">
          {/* Add/Edit Form */}
          <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 p-6 border border-slate-100">
            <h2 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-6 pb-4 border-b border-slate-100">
              {editingId ? "Edit Personnel" : "Draft New Player"}
            </h2>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div>
                <label className="block text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">
                  Full Name
                </label>
                <input
                  {...register("name")}
                  required
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-800 transition-all"
                  placeholder="Enter full name"
                />
              </div>
              <div>
                <label className="block text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">
                  Playing Role
                </label>
                <select
                  {...register("playingRole")}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-800"
                >
                  <option value="">Select Role</option>
                  <option value="Batsman">Batsman</option>
                  <option value="Bowler">Bowler</option>
                  <option value="All-Rounder">All-Rounder</option>
                  <option value="Batting-All-Rounder">Batting-All-Rounder</option>
                  <option value="Bowling-All-Rounder">Bowling-All-Rounder</option>
                  <option value="Wicket-Keeper">Wicket-Keeper</option>
                </select>
              </div>
              <div>
                <label className="block text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">
                  Batting Style
                </label>
                <select
                  {...register("battingStyle")}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-800"
                >
                  <option value="">Select Style</option>
                  <option value="Right-handed">Right-handed</option>
                  <option value="Left-handed">Left-handed</option>
                </select>
              </div>
              <div>
                <label className="block text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">
                  Bowling Style
                </label>
                <select
                  {...register("bowlingStyle")}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-800"
                >
                  <option value="">Select Style</option>
                  <option value="Right-arm Fast">Right-arm Fast</option>
                  <option value="Right-arm Fast-Medium">Right-arm Fast-Medium</option>
                  <option value="Right-arm Medium">Right-arm Medium</option>
                  <option value="Right-arm Off-break">Right-arm Off-break</option>
                  <option value="Right-arm Leg-break">Right-arm Leg-break</option>
                  <option value="Left-arm Fast">Left-arm Fast</option>
                  <option value="Left-arm Orthodox">Left-arm Orthodox</option>
                  <option value="Not Applicable">Not Applicable</option>
                </select>
              </div>
              <div>
                <label className="block text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">
                  Team Assignment
                </label>
                <select
                  {...register("team")}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-800"
                >
                  <option value="">Agent (No Team)</option>
                  {teams.map((t) => (
                    <option key={t._id} value={t._id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">
                  Photo URL
                </label>
                <input
                  {...register("imageUrl")}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-800 transition-all"
                  placeholder="https://..."
                />
              </div>

              {/* Deep Categorization Section */}
              <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100 space-y-3">
                <label className="block text-[9px] font-black uppercase tracking-widest text-blue-900 mb-1">
                  Categorization
                </label>
                <select {...register("category")} className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800">
                  {["School", "College", "University", "Organization", "Business", "Industry", "Club", "International", "Other"].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <input {...register("subCategory")} placeholder="Sub-Category (e.g. CS, Eng)" className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800" />
                <select {...register("ageGroup")} className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800">
                  {["U-10", "U-13", "U-15", "U-17", "U-19", "Open"].map(a => <option key={a} value={a}>{a}</option>)}
                </select>
                <input {...register("organization")} placeholder="Institution Name" className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800" />
              </div>

              {/* Location Section */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
                <label className="block text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">
                  Location
                </label>
                <input {...register("address.town")} placeholder="Town" className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800" />
                <input {...register("address.district")} placeholder="District" className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800" />
                <input {...register("address.city")} placeholder="City" className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800" />
                <input {...register("address.province")} placeholder="Province" className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800" />
              </div>
              <button
                type="submit"
                className="w-full py-4 bg-[#031d44] hover:bg-slate-800 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-xl shadow-blue-900/10 active:scale-95"
              >
                {editingId ? "Update File" : "Enlist Player"}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="w-full py-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs uppercase tracking-widest rounded-xl transition-all"
                >
                  Cancel
                </button>
              )}
            </form>
          </div>

          {/* Quick Filters */}
          <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 p-6 border border-slate-100">
            <h2 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-6 pb-4 border-b border-slate-100">
              Advanced Filters
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">
                  Filter by Franchise
                </label>
                <select
                  value={filterTeam}
                  onChange={(e) => {
                    setFilterTeam(e.target.value);
                    setPage(1);
                  }}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-800 transition-all"
                >
                  <option value="">All Regions</option>
                  {teams.map((t) => (
                    <option key={t._id} value={t._id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">
                  Campus Location
                </label>
                <input
                  value={filterCampus}
                  onChange={(e) => {
                    setFilterCampus(e.target.value);
                    setPage(1);
                  }}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-800 transition-all"
                  placeholder="Filter by campus..."
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Player Grid */}
        <div className="xl:col-span-3">
          <div className="mb-6">
            <h2 className="text-lg font-black text-slate-800 uppercase tracking-widest mb-4">
              Talent Roster ({pagination.totalPlayers || 0})
            </h2>
            <div className="relative">
              <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-12 pr-6 py-4 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 font-bold text-slate-800 transition-all"
                placeholder="Search players..."
              />
            </div>
          </div>

          {/* Bulk Delete Actions */}
          {selectedPlayers.length > 0 && (
            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-between">
              <span className="text-sm font-black text-blue-900 uppercase tracking-widest">
                {selectedPlayers.length} Selected
              </span>
              <button
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="px-6 py-3 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-red-900/20 transition-all active:scale-95"
              >
                {bulkDeleting ? "Deleting..." : `Delete Selected (${selectedPlayers.length})`}
              </button>
            </div>
          )}

          {loading && players.length === 0 && (
            <div className="text-center py-20">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
              <p className="mt-4 text-xs font-black text-slate-400 uppercase tracking-widest">
                Accessing Records...
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {players.map((p) => (
              <div
                key={p._id}
                className={`bg-white rounded-2xl shadow-xl shadow-slate-200/50 border transition-all ${selectedPlayers.includes(p._id)
                    ? "border-blue-500 ring-2 ring-blue-500/20"
                    : "border-slate-100 hover:border-slate-200"
                  }`}
              >
                <div className="p-6">
                  <div className="flex items-start gap-4 mb-4">
                    <input
                      type="checkbox"
                      checked={selectedPlayers.includes(p._id)}
                      onChange={() => handleSelectPlayer(p._id)}
                      className="mt-1 w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                    {p.imageUrl ? (
                      <img
                        src={p.imageUrl}
                        alt={p.name}
                        className="w-16 h-16 rounded-xl object-cover border-2 border-slate-100"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-blue-600 to-[#031d44] flex items-center justify-center text-white font-black text-lg border-2 border-slate-100">
                        {p.name?.substring(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <Link
                        to={`/admin/players/${p._id}`}
                        className="text-base font-black text-slate-800 hover:text-blue-600 transition-colors truncate block"
                      >
                        {p.name}
                      </Link>
                      <p className="text-xs font-bold text-slate-500 mt-1">
                        {p.role || "Prospect"}
                      </p>
                      <p className="text-[10px] font-bold text-blue-600 mt-1">
                        {p.team?.name || "Free Agent"}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                        Total Runs
                      </p>
                      <input
                        type="number"
                        defaultValue={p.stats?.runs || 0}
                        onBlur={(e) =>
                          dispatch(
                            updatePlayerStats({
                              id: p._id,
                              stats: { ...p.stats, runs: +e.target.value },
                            })
                          )
                        }
                        className="w-full bg-transparent font-black text-slate-800 outline-none focus:text-blue-600 transition-colors"
                      />
                    </div>
                    <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                        Wickets
                      </p>
                      <input
                        type="number"
                        defaultValue={p.stats?.wickets || 0}
                        onBlur={(e) =>
                          dispatch(
                            updatePlayerStats({
                              id: p._id,
                              stats: { ...p.stats, wickets: +e.target.value },
                            })
                          )
                        }
                        className="w-full bg-transparent font-black text-slate-800 outline-none focus:text-red-600 transition-colors"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Link
                      to={`/admin/players/${p._id}`}
                      className="flex-1 py-2.5 bg-slate-50 hover:bg-blue-600 hover:text-white text-slate-400 font-bold text-[9px] uppercase tracking-widest rounded-xl transition-all border border-slate-100 text-center"
                    >
                      Profile
                    </Link>
                    <button
                      onClick={() => handleEdit(p)}
                      className="flex-1 py-2.5 bg-slate-50 hover:bg-blue-600 hover:text-white text-slate-400 font-bold text-[9px] uppercase tracking-widest rounded-xl transition-all border border-slate-100"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(p._id)}
                      className="px-3 py-2.5 bg-slate-50 hover:bg-red-600 hover:text-white text-slate-400 font-bold rounded-xl transition-all border border-slate-100"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {players.length === 0 && !loading && (
            <div className="text-center py-20 bg-white rounded-2xl border border-slate-100">
              <p className="text-sm font-black text-slate-300 uppercase tracking-widest">
                No Personnel Recorded
              </p>
              <p className="text-xs text-slate-400 mt-2">
                Try adjusting your filters or search criteria.
              </p>
            </div>
          )}

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="mt-10 flex items-center justify-center gap-4">
              <button
                onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
                disabled={page === 1}
                className="px-6 py-3 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed text-[10px] font-black uppercase tracking-widest transition-all"
              >
                Previous
              </button>
              <span className="text-xs font-black text-slate-500">
                Page {pagination.currentPage} of {pagination.totalPages}
              </span>
              <button
                onClick={() => setPage((prev) => Math.min(prev + 1, pagination.totalPages))}
                disabled={page === pagination.totalPages}
                className="px-6 py-3 bg-[#031d44] text-white rounded-xl hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed text-[10px] font-black uppercase tracking-widest transition-all shadow-xl shadow-blue-900/10"
              >
                Next Page
              </button>
            </div>
          )}
        </div>
      </div>
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
