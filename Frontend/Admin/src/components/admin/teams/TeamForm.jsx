import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import api from '../../../services/api';

const CATEGORIES = ["School", "College", "University", "Organization", "Business", "Industry", "Club", "Corporate", "Academy", "International", "Other"];
const AGE_GROUPS = ["U-10", "U-13", "U-15", "U-17", "U-19", "Open"];

export default function TeamForm({ editMode, currentTeam, onSave, onCancel }) {
  const { register, handleSubmit, reset, setValue, watch } = useForm();
  const [activeTab, setActiveTab] = useState('basic');
  const [organizations, setOrganizations] = useState([]);
  const [categories, setCategories] = useState([]);
  const [freeAgents, setFreeAgents] = useState([]);
  const [selectedPlayers, setSelectedPlayers] = useState([]);
  const [playerSearch, setPlayerSearch] = useState('');
  const [squadPlayers, setSquadPlayers] = useState([]);
  const [locationData, setLocationData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [orgChain, setOrgChain] = useState([]);

  const selectedCategory = watch('category');

  useEffect(() => {
    fetchOrganizations();
    fetchCategories();
    fetchFreeAgents();
  }, []);

  useEffect(() => {
    if (selectedCategory && categories.length > 0) {
      const cat = categories.find(c => c.name === selectedCategory);
      if (cat) {
        setValue('categoryRef', cat._id);
        if (!editMode) loadRootOrgs(cat._id);
      }
    } else {
      setOrgChain([]);
    }
  }, [selectedCategory, categories, editMode]);

  useEffect(() => {
    if (editMode && currentTeam) {
      setValue('name', currentTeam.name);
      setValue('shortName', currentTeam.shortName);
      setValue('category', currentTeam.category || 'Other');
      setValue('categoryRef', currentTeam.categoryRef?._id || '');
      setValue('subCategory', currentTeam.subCategory || '');
      setValue('ageGroup', currentTeam.ageGroup || 'Open');
      setValue('organization', currentTeam.organization || '');
      setValue('organizationRef', currentTeam.organizationRef?._id || '');
      setValue('branchName', currentTeam.branchName || '');
      setValue('ownername', currentTeam.ownername || '');
      setValue('logo', currentTeam.logo || '');
      setValue('establishedYear', currentTeam.establishedYear || '');
      setValue('homeGround', currentTeam.homeGround || '');
      setValue('teamColorPrimary', currentTeam.teamColorPrimary || '#00a650');
      setValue('teamColorSecondary', currentTeam.teamColorSecondary || '#003087');
      setValue('fullAddress', currentTeam.fullAddress || '');
      setValue('city', currentTeam.address?.city || currentTeam.city || '');
      setValue('area', currentTeam.area || '');
      setValue('latitude', currentTeam.latitude || '');
      setValue('longitude', currentTeam.longitude || '');
      setValue('googleMapsUrl', currentTeam.googleMapsUrl || '');
      setValue('placeId', currentTeam.placeId || '');
      setValue('phone', currentTeam.phone || '');
      setValue('email', currentTeam.email || '');
      setValue('website', currentTeam.website || '');
      setSelectedPlayers(currentTeam.players?.map(p => p._id) || []);

      const orgId = currentTeam.organizationRef?._id || currentTeam.organizationRef;
      if (orgId) loadOrgChainForEdit(orgId);
    }
  }, [editMode, currentTeam, setValue, categories]);

  const loadRootOrgs = async (categoryId) => {
    try {
      const res = await api.get(`/organizations/roots?category=${categoryId}`);
      const roots = Array.isArray(res.data) ? res.data : [];
      setOrgChain(roots.length > 0 ? [{ level: 0, orgs: roots, selected: null }] : []);
    } catch (e) { console.error(e); }
  };

  const loadOrgChainForEdit = async (orgId) => {
    try {
      const res = await api.get(`/organizations/${orgId}/chain`);
      const chain = Array.isArray(res.data) ? res.data : [];
      if (chain.length === 0) return;

      const newChain = [];
      for (let i = 0; i < chain.length; i++) {
        if (i === 0) {
          const rootRes = await api.get(`/organizations/roots?category=${chain[i].category?._id || chain[i].category}`);
          const roots = Array.isArray(rootRes.data) ? rootRes.data : [];
          const selected = roots.find(r => r._id === chain[i]._id) || chain[i];
          newChain.push({ level: 0, orgs: roots, selected });
        } else {
          const childRes = await api.get(`/organizations/${chain[i - 1]._id}/children`);
          const children = Array.isArray(childRes.data) ? childRes.data : [];
          const selected = children.find(c => c._id === chain[i]._id) || chain[i];
          newChain.push({ level: i, orgs: children, selected });
        }
      }
      setOrgChain(newChain);
      setValue('organizationRef', chain[chain.length - 1]._id);
    } catch (e) { console.error(e); }
  };

  const handleOrgSelect = async (levelIndex, orgId) => {
    const selectedOrg = orgChain[levelIndex].orgs.find(o => o._id === orgId);
    const newChain = orgChain.slice(0, levelIndex + 1);
    newChain[levelIndex] = { ...newChain[levelIndex], selected: selectedOrg };

    if (selectedOrg) {
      try {
        const res = await api.get(`/organizations/${orgId}/children`);
        const children = Array.isArray(res.data) ? res.data : [];
        if (children.length > 0) {
          newChain.push({ level: levelIndex + 1, orgs: children, selected: null });
        }
      } catch (e) { console.error(e); }
      setValue('organizationRef', orgId);
    } else {
      setValue('organizationRef', '');
    }

    setOrgChain(newChain);
  };

  const fetchOrganizations = async () => {
    try {
      const res = await api.get('/organizations');
      setOrganizations(Array.isArray(res.data) ? res.data : []);
    } catch (e) { console.error(e); }
  };

  const fetchCategories = async () => {
    try {
      const res = await api.get('/team-categories');
      setCategories(Array.isArray(res.data) ? res.data : []);
    } catch (e) { console.error(e); }
  };

  const fetchFreeAgents = async () => {
    try {
      const res = await api.get('/players/free-agents');
      setFreeAgents(Array.isArray(res.data) ? res.data : []);
    } catch (e) { console.error(e); }
  };

  const handleLocationSearch = async () => {
    const query = watch('fullAddress') || watch('city') || '';
    if (!query) return;
    try {
      const res = await api.get(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${import.meta.env.VITE_GOOGLE_MAPS_KEY || ''}`);
      if (res.data?.results?.[0]) {
        const place = res.data.results[0];
        setLocationData({
          fullAddress: place.formatted_address,
          latitude: place.geometry.location.lat,
          longitude: place.geometry.location.lng,
          placeId: place.place_id,
          googleMapsUrl: `https://www.google.com/maps/place/?q=place_id:${place.place_id}`,
        });
        setValue('fullAddress', place.formatted_address);
        setValue('latitude', place.geometry.location.lat);
        setValue('longitude', place.geometry.location.lng);
        setValue('placeId', place.place_id);
        setValue('googleMapsUrl', `https://www.google.com/maps/place/?q=place_id:${place.place_id}`);
      }
    } catch (e) { console.error(e); }
  };

  const togglePlayerSelection = (playerId) => {
    setSelectedPlayers((prev) =>
      prev.includes(playerId) ? prev.filter((id) => id !== playerId) : [...prev, playerId]
    );
  };

  const onSubmit = async (data) => {
    setLoading(true);
    try {
      data.players = selectedPlayers;
      if (locationData) {
        data.latitude = locationData.latitude;
        data.longitude = locationData.longitude;
        data.googleMapsUrl = locationData.googleMapsUrl;
        data.placeId = locationData.placeId;
        data.fullAddress = locationData.fullAddress;
      }
      await onSave(data);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const filteredFreeAgents = freeAgents.filter(p =>
    p.name.toLowerCase().includes(playerSearch.toLowerCase())
  );

  const tabs = [
    { key: 'basic', label: 'Basic Info' },
    { key: 'location', label: 'Location & Contact' },
    { key: 'players', label: 'Players' },
    { key: 'stats', label: 'Stats & Ranking' },
  ];

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Tabs */}
      <div className="flex border-b border-slate-200 gap-1">
        {tabs.map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-6 py-3 font-bold text-xs uppercase tracking-wider transition-all rounded-t-xl ${
              activeTab === tab.key
                ? 'bg-[#031d44] text-white'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 1: Basic Info */}
      {activeTab === 'basic' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Category *</label>
              <select {...register('category', { required: true })} className="w-full border border-slate-300 rounded-xl px-4 py-3">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {selectedCategory && (
            <div className="bg-blue-50/50 rounded-2xl p-6 border border-blue-100">
              <h4 className="text-xs font-black text-[#031d44] uppercase tracking-widest mb-4 flex items-center gap-2">
                🏢 Organization / Institution Hierarchy — {selectedCategory}
              </h4>
              <p className="text-xs text-slate-500 mb-4">
                Select the organization chain from top to bottom. Each level filters the next.
                You can stop at any level — the deepest selected org becomes the parent.
              </p>
              <div className="space-y-4">
                {orgChain.map((level, i) => (
                  <div key={i}>
                    <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">
                      {i === 0 ? 'Main Organization' : `Sub Level ${i}`}
                    </label>
                    <select
                      value={level.selected?._id || ''}
                      onChange={(e) => handleOrgSelect(i, e.target.value)}
                      className="w-full border border-slate-300 rounded-xl px-4 py-3"
                    >
                      <option value="">-- Select --</option>
                      {level.orgs.map(org => (
                        <option key={org._id} value={org._id}>{org.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
                {orgChain.length > 0 && (
                  <p className="text-xs text-slate-400 italic">
                    Chain: {orgChain.filter(l => l.selected).map(l => l.selected?.name).join(' → ')}
                  </p>
                )}
                {orgChain.length === 0 && (
                  <p className="text-xs text-slate-400 italic">No organizations found. You can type one below or leave empty.</p>
                )}
              </div>
              <input type="hidden" {...register('organizationRef')} />
              <input type="hidden" {...register('categoryRef')} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">OR Type Organization Name (free text)</label>
                  <input {...register('organization')} placeholder="e.g., BanoQabil, Al-Khidmat" className="w-full border border-slate-300 rounded-xl px-4 py-3" />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Branch / Campus Name</label>
                  <input {...register('branchName')} placeholder="e.g., North Campus, Gulberg" className="w-full border border-slate-300 rounded-xl px-4 py-3" />
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Team Name *</label>
              <input {...register('name', { required: true })} placeholder="Team Name" className="w-full border border-slate-300 rounded-xl px-4 py-3" />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Short Name</label>
              <input {...register('shortName')} placeholder="Short Name" className="w-full border border-slate-300 rounded-xl px-4 py-3" />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Established Year</label>
              <input {...register('establishedYear')} type="number" placeholder="2024" className="w-full border border-slate-300 rounded-xl px-4 py-3" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Home Ground</label>
              <input {...register('homeGround')} placeholder="Home Ground" className="w-full border border-slate-300 rounded-xl px-4 py-3" />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Primary Color</label>
              <input {...register('teamColorPrimary')} type="color" className="w-full border border-slate-300 rounded-xl px-4 py-2 h-12" />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Secondary Color</label>
              <input {...register('teamColorSecondary')} type="color" className="w-full border border-slate-300 rounded-xl px-4 py-2 h-12" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Logo URL</label>
              <input {...register('logo')} placeholder="Logo URL" className="w-full border border-slate-300 rounded-xl px-4 py-3" />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Owner Name</label>
              <input {...register('ownername')} placeholder="Owner" className="w-full border border-slate-300 rounded-xl px-4 py-3" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Age Group</label>
              <select {...register('ageGroup')} className="w-full border border-slate-300 rounded-xl px-4 py-3">
                {AGE_GROUPS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Sub Category</label>
              <input {...register('subCategory')} placeholder="e.g., Pre-Medical" className="w-full border border-slate-300 rounded-xl px-4 py-3" />
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Location & Contact */}
      {activeTab === 'location' && (
        <div className="space-y-6">
          <div className="bg-blue-50 rounded-2xl p-6 border border-blue-100">
            <h4 className="font-black text-xs uppercase tracking-widest text-blue-800 mb-4">📍 Google Maps Location</h4>
            <div className="flex gap-4 mb-4">
              <input
                {...register('fullAddress')}
                placeholder="Search address or school/college name..."
                className="flex-1 border border-slate-300 rounded-xl px-4 py-3"
              />
              <button
                type="button"
                onClick={handleLocationSearch}
                className="bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-widest rounded-xl px-6 py-3"
              >
                Search
              </button>
            </div>
            {(locationData || watch('latitude')) && (
              <div className="mt-4">
                <div className="h-48 bg-slate-200 rounded-xl overflow-hidden mb-2">
                  <iframe
                    width="100%"
                    height="100%"
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    src={`https://www.google.com/maps?q=${watch('latitude') || locationData?.latitude},${watch('longitude') || locationData?.longitude}&z=15&output=embed`}
                  />
                </div>
                <p className="text-xs text-slate-500">
                  Lat: {watch('latitude') || locationData?.latitude}, Lng: {watch('longitude') || locationData?.longitude}
                </p>
              </div>
            )}
            <input {...register('placeId')} type="hidden" />
            <input {...register('googleMapsUrl')} type="hidden" />
            <input {...register('latitude')} type="hidden" />
            <input {...register('longitude')} type="hidden" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">City</label>
              <input {...register('city')} placeholder="City" className="w-full border border-slate-300 rounded-xl px-4 py-3" />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Area / Locality</label>
              <input {...register('area')} placeholder="Area" className="w-full border border-slate-300 rounded-xl px-4 py-3" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Phone</label>
              <input {...register('phone')} placeholder="Phone" className="w-full border border-slate-300 rounded-xl px-4 py-3" />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Email</label>
              <input {...register('email')} type="email" placeholder="Email" className="w-full border border-slate-300 rounded-xl px-4 py-3" />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Website</label>
            <input {...register('website')} placeholder="Website URL" className="w-full border border-slate-300 rounded-xl px-4 py-3" />
          </div>
        </div>
      )}

      {/* Tab 3: Players */}
      {activeTab === 'players' && (
        <div className="space-y-6">
          <div className="bg-green-50 rounded-2xl p-6 border border-green-100">
            <h4 className="font-black text-xs uppercase tracking-widest text-green-800 mb-4">👥 Current Squad ({selectedPlayers.length})</h4>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {selectedPlayers.length === 0 ? (
                <p className="text-slate-400 text-sm">No players added yet. Select from Free Agents below.</p>
              ) : (
                selectedPlayers.map(pid => {
                  const player = freeAgents.find(p => p._id === pid) || { _id: pid, name: pid, role: '' };
                  return (
                    <div key={pid} className="flex items-center justify-between bg-white rounded-xl px-4 py-3 border border-green-200">
                      <div>
                        <p className="font-bold text-slate-800">{player.name}</p>
                        <p className="text-xs text-slate-500">{player.role || 'Player'}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => togglePlayerSelection(pid)}
                        className="text-red-600 hover:text-red-800 font-black text-xs uppercase tracking-widest"
                      >
                        Remove
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="bg-amber-50 rounded-2xl p-6 border border-amber-100">
            <h4 className="font-black text-xs uppercase tracking-widest text-amber-800 mb-4">🔓 Free Agents</h4>
            <input
              type="text"
              placeholder="Search free agents..."
              value={playerSearch}
              onChange={(e) => setPlayerSearch(e.target.value)}
              className="w-full border border-slate-300 rounded-xl px-4 py-3 mb-4"
            />
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {filteredFreeAgents.length === 0 ? (
                <p className="text-slate-400 text-sm">No free agents available.</p>
              ) : (
                filteredFreeAgents.map(player => (
                  <div
                    key={player._id}
                    className="flex items-center justify-between bg-white rounded-xl px-4 py-3 border border-slate-200 hover:border-amber-300 transition-all cursor-pointer"
                    onClick={() => togglePlayerSelection(player._id)}
                  >
                    <div>
                      <p className="font-bold text-slate-800">{player.name}</p>
                      <p className="text-xs text-slate-500">{player.role || 'Player'}</p>
                    </div>
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                      selectedPlayers.includes(player._id)
                        ? 'bg-green-600 border-green-600'
                        : 'border-slate-300'
                    }`}>
                      {selectedPlayers.includes(player._id) && (
                        <span className="text-white text-xs">✓</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Stats & Ranking */}
      {activeTab === 'stats' && (
        <div className="space-y-6">
          {editMode && currentTeam ? (
            <div className="bg-white rounded-2xl p-8 border border-slate-200 text-center">
              <p className="text-slate-400 mb-4">View complete stats and rankings on the Team Detail page.</p>
              <p className="text-3xl font-black text-[#031d44]">{selectedPlayers.length}</p>
              <p className="text-xs text-slate-500 uppercase tracking-widest">Players in Squad</p>
            </div>
          ) : (
            <div className="bg-blue-50 rounded-2xl p-8 border border-blue-100 text-center">
              <p className="text-slate-500">Save the team first to see stats and rankings.</p>
            </div>
          )}
        </div>
      )}

      {/* Submit */}
      <div className="flex gap-3 pt-4 border-t border-slate-200">
        <button
          type="submit"
          disabled={loading}
          className="bg-[#031d44] hover:bg-slate-800 text-white font-black text-xs uppercase tracking-widest rounded-xl px-8 py-4 transition-all disabled:opacity-50"
        >
          {loading ? 'Saving...' : editMode ? 'Update Team' : 'Create Team'}
        </button>
        {editMode && (
          <button
            type="button"
            onClick={onCancel}
            className="bg-slate-200 hover:bg-slate-300 text-[#031d44] font-black text-xs uppercase tracking-widest rounded-xl px-8 py-4 transition-all"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
