import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useNavigate } from 'react-router-dom';
import {
  fetchTeams,
  createTeam,
  deleteTeam,
} from '../store/slices/teamSlice';
import { fetchPlayers } from '../store/slices/playersSlice';
import { initSocket } from '../store/socket';
import api from '../services/api';
import TeamForm from '../components/admin/teams/TeamForm';
import ConfirmModal from '../components/ConfirmModal';

const CATEGORIES = [
  { key: 'all', label: 'All', icon: '📋' },
  { key: 'School', label: 'School', icon: '🏫' },
  { key: 'College', label: 'College', icon: '🎓' },
  { key: 'University', label: 'University', icon: '🏛️' },
  { key: 'Organization', label: 'Organization', icon: '🏢' },
  { key: 'Business', label: 'Business', icon: '💼' },
  { key: 'Industry', label: 'Industry', icon: '🏭' },
  { key: 'Club', label: 'Club', icon: '🏏' },
  { key: 'Corporate', label: 'Corporate', icon: '🏢' },
  { key: 'Academy', label: 'Academy', icon: '⭐' },
  { key: 'International', label: 'International', icon: '🌍' },
  { key: 'Other', label: 'Other', icon: '📋' },
];

const Teams = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { teams, loading } = useSelector((state) => state.teams);
  const { pagination: playerPagination } = useSelector((state) => state.players);
  const [viewMode, setViewMode] = useState('grid');
  const [showForm, setShowForm] = useState(false);
  const [filterCategory, setFilterCategory] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [organizations, setOrganizations] = useState([]);
  const [expandedOrgs, setExpandedOrgs] = useState({});
  const [confirmModal, setConfirmModal] = useState({ open: false, title: '', message: '', onConfirm: null, variant: 'danger' });

  useEffect(() => {
    dispatch(fetchTeams());
    dispatch(fetchPlayers());
    fetchOrganizations();
    initSocket();
  }, [dispatch]);

  const fetchOrganizations = async () => {
    try {
      const res = await api.get('/organizations/tree');
      setOrganizations(Array.isArray(res.data) ? res.data : []);
    } catch (e) { console.error(e); }
  };

  // Terminal A: four search keys — team name, club name, team id, club id.
  const orgIdOf = (team) => String(team.organizationRef?._id || team.organizationRef || '');
  const orgNameOf = (team) => (team.organizationRef?.name || team.organization || '');

  const filteredTeams = teams.filter(team => {
    if (filterCategory !== 'all' && team.category !== filterCategory) return false;
    if (searchTerm) {
      const q = searchTerm.trim().toLowerCase();
      const matches =
        team.name?.toLowerCase().includes(q) ||
        team.shortName?.toLowerCase().includes(q) ||
        team.branchName?.toLowerCase().includes(q) ||
        String(team._id).toLowerCase().includes(q) ||
        orgIdOf(team).toLowerCase().includes(q) ||
        orgNameOf(team).toLowerCase().includes(q);
      if (!matches) return false;
    }
    if (cityFilter && !team.address?.city?.toLowerCase().includes(cityFilter.toLowerCase())) return false;
    return true;
  });

  // Counts (Task 5): a single glance at how much real data exists.
  const totalClubs = organizations.length;
  const totalTeams = teams.length;
  const totalPlayers = playerPagination?.totalPlayers ?? teams.reduce((n, t) => n + (t.players?.length || 0), 0);

  const groupedTeams = {};
  CATEGORIES.filter(c => c.key !== 'all').forEach(c => {
    const catTeams = filteredTeams.filter(t => t.category === c.key);
    if (catTeams.length > 0) {
      groupedTeams[c.key] = catTeams;
    }
  });

  const getCategoryIcon = (cat) => {
    const found = CATEGORIES.find(c => c.key === cat);
    return found?.icon || '📋';
  };

  const openCreateForm = () => {
    setShowForm(!showForm);
  };

  const closeForm = () => {
    setShowForm(false);
  };

  const handleCreateTeam = async (data) => {
    const result = await dispatch(createTeam(data));
    if (result.meta.requestStatus === 'fulfilled') {
      closeForm();
      dispatch(fetchTeams());
      fetchOrganizations();
    }
  };

  const handleDelete = (id) => {
    setConfirmModal({ open: true, title: 'Delete Team', message: 'Are you sure you want to delete this team?', confirmLabel: 'Delete', variant: 'danger', onConfirm: async () => { setConfirmModal({ open: false }); await dispatch(deleteTeam(id)); dispatch(fetchTeams()); fetchOrganizations(); } });
  };

  const toggleOrgExpand = (orgId) => {
    setExpandedOrgs(prev => ({ ...prev, [orgId]: !prev[orgId] }));
  };

  return (
    <div className="min-h-screen bg-cric-bg p-6 lg:p-10">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-4xl lg:text-5xl font-black text-cric-text">MANAGE TEAMS</h1>
          <p className="text-cric-muted font-bold text-sm mt-1">{teams.length} total teams</p>
        </div>
        <div className="flex gap-3">
          <div className="bg-cric-card rounded-xl border border-cric-border flex">
            <button
              onClick={() => setViewMode('grid')}
              className={`px-4 py-2 font-black text-xs uppercase tracking-wider rounded-l-xl transition-all ${viewMode === 'grid' ? 'bg-cric-accent text-white' : 'text-cric-muted hover:text-cric-text'}`}
            >
              Grid
            </button>
            <button
              onClick={() => setViewMode('org')}
              className={`px-4 py-2 font-black text-xs uppercase tracking-wider rounded-r-xl transition-all ${viewMode === 'org' ? 'bg-cric-accent text-white' : 'text-cric-muted hover:text-cric-text'}`}
            >
              Org Tree
            </button>
          </div>
          <button
            onClick={openCreateForm}
            className="bg-cric-accent hover:bg-[#e55a2b] text-white font-black text-xs uppercase tracking-widest rounded-xl px-6 py-3 transition-all"
          >
            {showForm ? 'Close Form' : '+ Add Team'}
          </button>
        </div>
      </div>

      {/* Create Team Form */}
      {showForm && (
        <div className="bg-cric-card rounded-2xl shadow-xl border border-cric-border p-6 mb-8">
          <h2 className="text-2xl font-bold text-cric-text mb-6">
            Create New Team
          </h2>
          <TeamForm
            editMode={false}
            currentTeam={null}
            onSave={handleCreateTeam}
            onCancel={closeForm}
          />
        </div>
      )}

      {/* Counts (Task 5) */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-cric-card rounded-2xl border border-cric-border p-4 text-center">
          <p className="text-3xl font-black text-cric-text">{totalClubs}</p>
          <p className="text-[10px] font-black uppercase tracking-widest text-cric-muted mt-1">Clubs</p>
        </div>
        <div className="bg-cric-card rounded-2xl border border-cric-border p-4 text-center">
          <p className="text-3xl font-black text-cric-text">{totalTeams}</p>
          <p className="text-[10px] font-black uppercase tracking-widest text-cric-muted mt-1">Teams</p>
        </div>
        <div className="bg-cric-card rounded-2xl border border-cric-border p-4 text-center">
          <p className="text-3xl font-black text-cric-text">{totalPlayers}</p>
          <p className="text-[10px] font-black uppercase tracking-widest text-cric-muted mt-1">Players</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-cric-card rounded-2xl shadow-sm border border-cric-border p-4 mb-6">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {CATEGORIES.map(cat => (
            <button
              key={cat.key}
              onClick={() => setFilterCategory(cat.key)}
              className={`px-4 py-2 rounded-xl font-black text-xs uppercase tracking-wider transition-all ${
                filterCategory === cat.key
                  ? 'bg-cric-accent text-white'
                  : 'bg-cric-bg text-cric-muted hover:bg-cric-border'
              }`}
            >
              {cat.icon} {cat.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Search by team name, club name, team ID or club ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 bg-cric-card border border-cric-border rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-cric-accent text-cric-text"
          />
          <input
            type="text"
            placeholder="Filter by city..."
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            className="w-full sm:w-48 bg-cric-card border border-cric-border rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-cric-accent text-cric-text"
          />
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cric-accent" />
        </div>
      )}

      {/* Organization Tree View */}
      {!loading && viewMode === 'org' && (
        <div className="space-y-6">
          {organizations.length === 0 ? (
            <p className="text-cric-muted text-center py-12">No organizations found. Create teams with organizations to see the tree.</p>
          ) : (
            organizations.map(({ organization, branches, branchCount, totalPlayers }) => (
              <div key={organization._id} className="bg-cric-card rounded-2xl shadow-sm border border-cric-border overflow-hidden">
                <button
                  onClick={() => toggleOrgExpand(organization._id)}
                  className="w-full flex items-center justify-between p-6 hover:bg-cric-bg transition-all"
                >
                  <div className="flex items-center gap-4">
                    {organization.logoUrl ? (
                      <img src={organization.logoUrl} alt="" className="w-12 h-12 rounded-xl object-cover" />
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-cric-accent flex items-center justify-center text-white font-black">
                        {organization.shortName || organization.name.charAt(0)}
                      </div>
                    )}
                    <div className="text-left">
                      <h3 className="text-xl font-bold text-cric-text">{organization.name}</h3>
                      <p className="text-xs text-cric-muted">{branchCount} branches • {totalPlayers} players</p>
                    </div>
                  </div>
                  <span className="text-2xl text-cric-muted">{expandedOrgs[organization._id] ? '−' : '+'}</span>
                </button>

                {expandedOrgs[organization._id] && (
                  <div className="border-t border-cric-border divide-y divide-cric-border">
                    {branches.map(branch => (
                      <div key={branch._id} className="flex items-center justify-between p-4 pl-16 hover:bg-cric-bg transition-all">
                        <div className="flex items-center gap-3">
                          <span className="text-lg">{getCategoryIcon(branch.category)}</span>
                          <div>
                            <Link to={`/admin/teams/${branch._id}`} className="font-bold text-cric-text hover:text-cric-accent">
                              {branch.name}
                            </Link>
                            <p className="text-xs text-cric-muted">
                              {branch.branchName}{branch.address?.city ? `, ${branch.address.city}` : ''}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-cric-muted">
                          <span>{branch.players?.length || 0} players</span>
                          <div className="flex gap-2">
                            <Link
                              to={`/admin/teams/${branch._id}/edit`}
                              className="text-cric-accent hover:text-cric-accent/80 font-bold"
                            >
                              Edit
                            </Link>
                            <button
                              onClick={() => handleDelete(branch._id)}
                              className="text-red-600 hover:text-red-800 font-bold"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Grid View */}
      {!loading && viewMode === 'grid' && (
        Object.keys(groupedTeams).length === 0 ? (
          <div className="text-center py-20">
            <p className="text-6xl mb-4">🏏</p>
            <p className="text-xl font-black text-cric-muted">No teams found</p>
            <p className="text-cric-muted text-sm mt-2">Create your first team to get started.</p>
          </div>
        ) : (
          Object.entries(groupedTeams).map(([category, catTeams]) => (
            <div key={category} className="mb-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold text-cric-text">
                  {getCategoryIcon(category)} {category}s ({catTeams.length})
                </h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {catTeams.map(team => {
                  const org = organizations.find(o => o.organization?._id === team.organizationRef);
                  return (
                    <div
                      key={team._id}
                      className="bg-cric-card rounded-2xl shadow-sm border border-cric-border overflow-hidden hover:shadow-lg transition-all"
                    >
                      <div
                        className="h-24 flex items-center justify-center relative"
                        style={{ background: `linear-gradient(135deg, ${team.teamColorPrimary || '#FF6B35'}, ${team.teamColorSecondary || '#e55a2b'})` }}
                      >
                        {team.logo ? (
                          <img src={team.logo} alt={team.name} className="h-16 w-16 object-contain rounded-full bg-white/20 p-1" />
                        ) : (
                          <span className="text-3xl font-black text-white/80">{team.shortName || team.name.substring(0, 3).toUpperCase()}</span>
                        )}
                        {team.branchName && (
                          <span className="absolute top-2 right-2 bg-white/20 text-white text-[10px] font-bold px-2 py-1 rounded-full">
                            {team.branchName}
                          </span>
                        )}
                      </div>
                      <div className="p-4">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm">{getCategoryIcon(team.category)}</span>
                          <h3 className="text-lg font-bold text-cric-text">{team.name}</h3>
                        </div>
                        <p className="text-xs text-cric-muted mb-3">
                          {team.organization}{team.organization && team.address?.city ? ` • ` : ''}{team.address?.city || ''}
                        </p>
                        <div className="flex items-center gap-4 text-xs text-cric-muted mb-3">
                          <span>👥 {team.players?.length || 0} players</span>
                          {org && <span>🏢 {org.organization?.shortName || org.organization?.name}</span>}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => navigate(`/admin/teams/${team._id}`)}
                            className="flex-1 bg-cric-accent hover:bg-[#e55a2b] text-white font-black text-[10px] uppercase tracking-widest rounded-xl py-2 transition-all"
                          >
                            View
                          </button>
                          <Link
                            to={`/admin/teams/${team._id}/edit`}
                            className="flex-1 bg-cric-accent hover:bg-[#e55a2b] text-white font-black text-[10px] uppercase tracking-widest rounded-xl py-2 text-center block transition-all"
                          >
                            Edit
                          </Link>
                          <button
                            onClick={() => handleDelete(team._id)}
                            className="flex-1 bg-red-600 hover:bg-red-700 text-white font-black text-[10px] uppercase tracking-widest rounded-xl py-2 transition-all"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )
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

export default Teams;
