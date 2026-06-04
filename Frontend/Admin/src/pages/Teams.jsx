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
    const socket = initSocket();
    return () => { if (socket) socket.disconnect(); };
  }, [dispatch]);

  const fetchOrganizations = async () => {
    try {
      const res = await api.get('/organizations/tree');
      setOrganizations(Array.isArray(res.data) ? res.data : []);
    } catch (e) { console.error(e); }
  };

  const filteredTeams = teams.filter(team => {
    if (filterCategory !== 'all' && team.category !== filterCategory) return false;
    if (searchTerm && !team.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !team.shortName?.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !team.organization?.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    if (cityFilter && !team.address?.city?.toLowerCase().includes(cityFilter.toLowerCase())) return false;
    return true;
  });

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
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-6 lg:p-10">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-4xl lg:text-5xl font-black text-[#031d44]">Teams Management</h1>
          <p className="text-slate-500 font-bold text-sm mt-1">{teams.length} total teams</p>
        </div>
        <div className="flex gap-3">
          <div className="bg-white rounded-xl border border-slate-200 flex">
            <button
              onClick={() => setViewMode('grid')}
              className={`px-4 py-2 font-black text-xs uppercase tracking-wider rounded-l-xl transition-all ${viewMode === 'grid' ? 'bg-[#031d44] text-white' : 'text-slate-500 hover:text-slate-800'}`}
            >
              Grid
            </button>
            <button
              onClick={() => setViewMode('org')}
              className={`px-4 py-2 font-black text-xs uppercase tracking-wider rounded-r-xl transition-all ${viewMode === 'org' ? 'bg-[#031d44] text-white' : 'text-slate-500 hover:text-slate-800'}`}
            >
              Org Tree
            </button>
          </div>
          <button
            onClick={openCreateForm}
            className="bg-[#031d44] hover:bg-slate-800 text-white font-black text-xs uppercase tracking-widest rounded-xl px-6 py-3"
          >
            {showForm ? 'Close Form' : '+ Add Team'}
          </button>
        </div>
      </div>

      {/* Create Team Form */}
      {showForm && (
        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6 mb-8">
          <h2 className="text-2xl font-bold text-[#031d44] mb-6">
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

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 mb-6">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {CATEGORIES.map(cat => (
            <button
              key={cat.key}
              onClick={() => setFilterCategory(cat.key)}
              className={`px-4 py-2 rounded-xl font-black text-xs uppercase tracking-wider transition-all ${
                filterCategory === cat.key
                  ? 'bg-[#031d44] text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {cat.icon} {cat.label}
            </button>
          ))}
        </div>
        <div className="flex gap-4">
          <input
            type="text"
            placeholder="Search teams by name, org..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 border border-slate-300 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
          />
          <input
            type="text"
            placeholder="Filter by city..."
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            className="w-48 border border-slate-300 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
          />
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#031d44]" />
        </div>
      )}

      {/* Organization Tree View */}
      {!loading && viewMode === 'org' && (
        <div className="space-y-6">
          {organizations.length === 0 ? (
            <p className="text-slate-400 text-center py-12">No organizations found. Create teams with organizations to see the tree.</p>
          ) : (
            organizations.map(({ organization, branches, branchCount, totalPlayers }) => (
              <div key={organization._id} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                <button
                  onClick={() => toggleOrgExpand(organization._id)}
                  className="w-full flex items-center justify-between p-6 hover:bg-slate-50 transition-all"
                >
                  <div className="flex items-center gap-4">
                    {organization.logoUrl ? (
                      <img src={organization.logoUrl} alt="" className="w-12 h-12 rounded-xl object-cover" />
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-[#031d44] flex items-center justify-center text-white font-black">
                        {organization.shortName || organization.name.charAt(0)}
                      </div>
                    )}
                    <div className="text-left">
                      <h3 className="text-xl font-bold text-[#031d44]">{organization.name}</h3>
                      <p className="text-xs text-slate-500">{branchCount} branches • {totalPlayers} players</p>
                    </div>
                  </div>
                  <span className="text-2xl text-slate-400">{expandedOrgs[organization._id] ? '−' : '+'}</span>
                </button>

                {expandedOrgs[organization._id] && (
                  <div className="border-t border-slate-100 divide-y divide-slate-50">
                    {branches.map(branch => (
                      <div key={branch._id} className="flex items-center justify-between p-4 pl-16 hover:bg-slate-50 transition-all">
                        <div className="flex items-center gap-3">
                          <span className="text-lg">{getCategoryIcon(branch.category)}</span>
                          <div>
                            <Link to={`/admin/teams/${branch._id}`} className="font-bold text-[#031d44] hover:underline">
                              {branch.name}
                            </Link>
                            <p className="text-xs text-slate-500">
                              {branch.branchName}{branch.address?.city ? `, ${branch.address.city}` : ''}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-slate-500">
                          <span>{branch.players?.length || 0} players</span>
                          <div className="flex gap-2">
                            <Link
                              to={`/admin/teams/${branch._id}/edit`}
                              className="text-blue-600 hover:text-blue-800 font-bold"
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
            <p className="text-xl font-black text-slate-400">No teams found</p>
            <p className="text-slate-400 text-sm mt-2">Create your first team to get started.</p>
          </div>
        ) : (
          Object.entries(groupedTeams).map(([category, catTeams]) => (
            <div key={category} className="mb-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold text-[#031d44]">
                  {getCategoryIcon(category)} {category}s ({catTeams.length})
                </h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {catTeams.map(team => {
                  const org = organizations.find(o => o.organization?._id === team.organizationRef);
                  return (
                    <div
                      key={team._id}
                      className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden hover:shadow-lg transition-all"
                    >
                      <div
                        className="h-24 flex items-center justify-center relative"
                        style={{ background: `linear-gradient(135deg, ${team.teamColorPrimary || '#031d44'}, ${team.teamColorSecondary || '#003087'})` }}
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
                          <h3 className="text-lg font-bold text-[#031d44]">{team.name}</h3>
                        </div>
                        <p className="text-xs text-slate-500 mb-3">
                          {team.organization}{team.organization && team.address?.city ? ` • ` : ''}{team.address?.city || ''}
                        </p>
                        <div className="flex items-center gap-4 text-xs text-slate-500 mb-3">
                          <span>👥 {team.players?.length || 0} players</span>
                          {org && <span>🏢 {org.organization?.shortName || org.organization?.name}</span>}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => navigate(`/admin/teams/${team._id}`)}
                            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-black text-[10px] uppercase tracking-widest rounded-xl py-2"
                          >
                            View
                          </button>
                          <Link
                            to={`/admin/teams/${team._id}/edit`}
                            className="flex-1 bg-[#031d44] hover:bg-slate-800 text-white font-black text-[10px] uppercase tracking-widest rounded-xl py-2 text-center block"
                          >
                            Edit
                          </Link>
                          <button
                            onClick={() => handleDelete(team._id)}
                            className="flex-1 bg-red-600 hover:bg-red-700 text-white font-black text-[10px] uppercase tracking-widest rounded-xl py-2"
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
