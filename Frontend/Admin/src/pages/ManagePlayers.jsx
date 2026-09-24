import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { fetchPlayers, createPlayer, updatePlayer, updatePlayerStats, deletePlayer, bulkDeletePlayers } from "../store/slices/playersSlice";
import { fetchTeams } from "../store/slices/teamSlice";
import { Link } from "react-router-dom";
import { useToast } from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import PlayerForm from "@shared/components/PlayerForm";

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
  const [editingData, setEditingData] = useState({});
  const [selectedPlayers, setSelectedPlayers] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
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
        setEditingData({});
      } else {
        await dispatch(createPlayer(data));
      }
    } catch (err) {
      console.error(err);
      showToast(editingId ? "Failed to update player" : "Failed to create player", 'error');
    }
  };

  const handleEdit = (p) => {
    setEditingId(p._id);
    setEditingData({
      name: p.name,
      playingRole: p.playingRole || p.role || "",
      battingStyle: p.battingStyle || "",
      bowlingStyle: p.bowlingStyle || "",
      imageUrl: p.imageUrl || "",
      team: p.team?._id || p.team || "",
      category: p.category || "Other",
      subCategory: p.subCategory || "",
      ageGroup: p.ageGroup || "Open",
      organization: p.organization || "",
      address: p.address || { town: "", district: "", city: "", province: "" },
      gallery: p.gallery || [],
      videos: p.videos || [],
      socialLinks: p.socialLinks || {},
      privacy: p.privacy || {},
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingData({});
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
    <div className="min-h-screen bg-cric-bg p-6 lg:p-10">
      {/* Header */}
      <div className="mb-10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-4xl lg:text-5xl font-black text-cric-text tracking-tight">
            PLAYER REGISTRY
          </h1>
          <p className="text-cric-muted mt-2 font-medium">
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
              setEditingData({});
            }}
            className="px-6 py-3 bg-cric-accent hover:bg-[#e55a2b] text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-cric-accent/40 transition-all active:scale-95"
          >
            Assign Entry
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
        {/* Left Side: Filter & Form Sidebar */}
        <div className="xl:col-span-1 space-y-6">
          {/* Add/Edit Form */}
          <div className="bg-cric-card rounded-2xl shadow-xl p-6 border border-cric-border">
            <h2 className="text-sm font-black text-cric-text uppercase tracking-widest mb-6 pb-4 border-b border-cric-border">
              {editingId ? "Edit Personnel" : "Draft New Player"}
            </h2>
            <PlayerForm
              mode="admin"
              onSubmit={onSubmit}
              teams={teams}
              loading={loading}
              editingId={editingId}
              defaultValues={editingData}
              onCancel={cancelEdit}
            />
          </div>

          {/* Quick Filters */}
          <div className="bg-cric-card rounded-2xl shadow-xl p-6 border border-cric-border">
            <h2 className="text-sm font-black text-cric-text uppercase tracking-widest mb-6 pb-4 border-b border-cric-border">
              Advanced Filters
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[9px] font-black uppercase tracking-widest text-cric-muted mb-2">
                  Filter by Franchise
                </label>
                <select
                  value={filterTeam}
                  onChange={(e) => {
                    setFilterTeam(e.target.value);
                    setPage(1);
                  }}
                  className="w-full p-3 bg-cric-bg border border-cric-border rounded-xl focus:ring-2 focus:ring-cric-accent outline-none font-bold text-cric-text transition-all"
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
                <label className="block text-[9px] font-black uppercase tracking-widest text-cric-muted mb-2">
                  Campus Location
                </label>
                <input
                  value={filterCampus}
                  onChange={(e) => {
                    setFilterCampus(e.target.value);
                    setPage(1);
                  }}
                  className="w-full p-3 bg-cric-bg border border-cric-border rounded-xl focus:ring-2 focus:ring-cric-accent outline-none font-bold text-cric-text transition-all"
                  placeholder="Filter by campus..."
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Player Grid */}
        <div className="xl:col-span-3">
          <div className="mb-6">
            <h2 className="text-lg font-black text-cric-text uppercase tracking-widest mb-4">
              Talent Roster ({pagination.totalPlayers || 0})
            </h2>
            <div className="relative">
              <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-cric-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-12 pr-6 py-4 bg-cric-card border border-cric-border rounded-2xl outline-none focus:ring-4 focus:ring-cric-accent/10 focus:border-cric-accent font-bold text-cric-text transition-all"
                placeholder="Search players..."
              />
            </div>
          </div>

          {/* Bulk Delete Actions */}
          {selectedPlayers.length > 0 && (
            <div className="mb-6 p-4 bg-cric-accent/5 border border-cric-accent/20 rounded-xl flex items-center justify-between">
              <span className="text-sm font-black text-cric-text uppercase tracking-widest">
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
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-cric-accent border-t-transparent"></div>
              <p className="mt-4 text-xs font-black text-cric-muted uppercase tracking-widest">
                Accessing Records...
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {players.map((p) => (
              <div
                key={p._id}
                className={`bg-cric-card rounded-2xl shadow-xl border transition-all ${selectedPlayers.includes(p._id)
                    ? "border-cric-accent ring-2 ring-cric-accent/20"
                    : "border-cric-border hover:border-cric-border"
                  }`}
              >
                <div className="p-6">
                  <div className="flex items-start gap-4 mb-4">
                    <input
                      type="checkbox"
                      checked={selectedPlayers.includes(p._id)}
                      onChange={() => handleSelectPlayer(p._id)}
                      className="mt-1 w-5 h-5 rounded border-cric-border text-cric-accent focus:ring-cric-accent cursor-pointer"
                    />
                    {p.imageUrl ? (
                      <img
                        src={p.imageUrl}
                        alt={p.name}
                        className="w-16 h-16 rounded-xl object-cover border-2 border-cric-border"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-cric-accent to-[#e55a2b] flex items-center justify-center text-white font-black text-lg border-2 border-cric-border">
                        {p.name?.substring(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <Link
                        to={`/admin/players/${p._id}`}
                        className="text-base font-black text-cric-text hover:text-cric-accent transition-colors truncate block"
                      >
                        {p.name}
                      </Link>
                      <p className="text-xs font-bold text-cric-muted mt-1">
                        {p.role || "Prospect"}
                      </p>
                      <p className="text-[10px] font-bold text-cric-accent mt-1">
                        {p.team?.name || "Free Agent"}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-cric-bg rounded-xl p-3 border border-cric-border">
                      <p className="text-[9px] font-black uppercase tracking-widest text-cric-muted">
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
                        className="w-full bg-transparent font-black text-cric-text outline-none focus:text-cric-accent transition-colors"
                      />
                    </div>
                    <div className="bg-cric-bg rounded-xl p-3 border border-cric-border">
                      <p className="text-[9px] font-black uppercase tracking-widest text-cric-muted">
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
                        className="w-full bg-transparent font-black text-cric-text outline-none focus:text-red-600 transition-colors"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Link
                      to={`/admin/players/${p._id}`}
                      className="flex-1 py-2.5 bg-cric-bg hover:bg-cric-accent hover:text-white text-cric-muted font-bold text-[9px] uppercase tracking-widest rounded-xl transition-all border border-cric-border text-center"
                    >
                      Profile
                    </Link>
                    <button
                      onClick={() => handleEdit(p)}
                      className="flex-1 py-2.5 bg-cric-bg hover:bg-cric-accent hover:text-white text-cric-muted font-bold text-[9px] uppercase tracking-widest rounded-xl transition-all border border-cric-border"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(p._id)}
                      className="px-3 py-2.5 bg-cric-bg hover:bg-red-600 hover:text-white text-cric-muted font-bold rounded-xl transition-all border border-cric-border"
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
            <div className="text-center py-20 bg-cric-card rounded-2xl border border-cric-border">
              <p className="text-sm font-black text-cric-muted uppercase tracking-widest">
                No Personnel Recorded
              </p>
              <p className="text-xs text-cric-muted mt-2">
                Try adjusting your filters or search criteria.
              </p>
            </div>
          )}

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="mt-10 flex items-center justify-center gap-2 sm:gap-4">
              <button
                onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
                disabled={page === 1}
                className="px-3 sm:px-6 py-2 sm:py-3 bg-cric-card border border-cric-border rounded-xl hover:bg-cric-bg disabled:opacity-30 disabled:cursor-not-allowed text-[9px] sm:text-[10px] font-black uppercase tracking-widest transition-all text-cric-text"
              >
                Prev
              </button>
              <span className="text-[10px] sm:text-xs font-black text-cric-muted whitespace-nowrap">
                Page {pagination.currentPage} / {pagination.totalPages}
              </span>
              <button
                onClick={() => setPage((prev) => Math.min(prev + 1, pagination.totalPages))}
                disabled={page === pagination.totalPages}
                className="px-3 sm:px-6 py-2 sm:py-3 bg-cric-accent text-white rounded-xl hover:bg-[#e55a2b] disabled:opacity-30 disabled:cursor-not-allowed text-[9px] sm:text-[10px] font-black uppercase tracking-widest transition-all shadow-xl"
              >
                Next
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
