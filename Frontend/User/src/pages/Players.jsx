import React, { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import PlayerCard, { playerRoleOf } from "../components/PlayerCard";
import { api } from "../services/api";
import LocationFilters, { locationQueryFromSearchParams } from "../components/LocationFilters";
import OrgTypeFilter, { orgTypeFromSearchParams } from "../components/OrgTypeFilter";

// The API returns at most 100 players a page. Search and the role filter run on
// the loaded list, so the directory loads every page (B11: with 126 players,
// page 2's 26 were never shown). Past MAX_PAGES it needs server-side paging.
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

// "All-Rounder" also matches the batting and bowling all-rounder roles.
function matchesRole(player, wanted) {
  if (!wanted) return true;
  const role = playerRoleOf(player).toLowerCase();
  const target = wanted.toLowerCase();
  return target === "all-rounder" ? role.includes("all-rounder") : role === target;
}

export default function Players() {
  const [searchParams] = useSearchParams();
  const teamIdFromUrl = searchParams.get("team");
  const locationQuery = locationQueryFromSearchParams(searchParams);
  const locationKey = JSON.stringify(locationQuery);
  const orgType = orgTypeFromSearchParams(searchParams);

  const [players, setPlayers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [filterTeam, setFilterTeam] = useState(teamIdFromUrl || "");
  const [filterRole, setFilterRole] = useState("");
  const latestRequest = useRef(0);

  useEffect(() => {
    // Fetch Teams for the filter dropdown
    api.get("/teams")
      .then(res => setTeams(Array.isArray(res.data) ? res.data : []))
      .catch(err => console.error("Failed to fetch teams:", err));
  }, []);

  // Runs on mount too. Role and search filter the loaded list, so they do not refetch.
  useEffect(() => {
    fetchPlayers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterTeam, locationKey, orgType]);

  const fetchPlayers = async () => {
    const requestId = ++latestRequest.current;
    setLoading(true);
    try {
      const params = { limit: PAGE_SIZE };
      if (filterTeam) params.team = filterTeam;
      if (orgType) params.orgType = orgType;
      Object.assign(params, locationQuery);
      const all = [];
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const { data } = await api.get("/players", { params: { ...params, page } });
        if (requestId !== latestRequest.current) return; // a newer filter took over
        if (Array.isArray(data)) { all.push(...data); break; }
        const batch = Array.isArray(data?.players) ? data.players : [];
        all.push(...batch);
        if (batch.length === 0 || page >= (Number(data?.totalPages) || 1)) break;
      }
      setPlayers(all);
    } catch (err) {
      console.error("Failed to fetch players:", err);
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  };

  const filteredPlayers = players.filter(p =>
    p.name?.toLowerCase().includes(search.toLowerCase()) && matchesRole(p, filterRole)
  );

  return (
    <div className="min-h-screen bg-cric-bg text-cric-text font-sans">

      {/* Hero / Filter Section */}
      <div className="bg-cric-accent text-white py-16 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-600/10 rounded-full -mr-48 -mt-48 blur-3xl" />
        <div className="max-w-7xl mx-auto px-4 relative">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
            <div>
              <h1 className="text-5xl font-black uppercase tracking-tighter italic mb-4">Players</h1>
              <p className="text-blue-200/60 font-black uppercase tracking-widest text-sm">Browse players from teams across CricAll</p>
            </div>

            <div className="w-full max-w-md group">
              <div className="relative">
                <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-300/30 group-focus-within:text-blue-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search players by name..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-12 pr-6 py-4 bg-white/5 border border-white/10 rounded-2xl outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500/50 font-bold text-white placeholder:text-blue-300/20 transition-all backdrop-blur-md"
                />
              </div>
            </div>
          </div>

          {/* Advanced Filter Pills */}
          <div className="flex flex-wrap items-center gap-4 mt-12 bg-white/5 p-2 rounded-2xl border border-white/10 backdrop-blur-sm">
            <select
              value={filterTeam}
              onChange={(e) => setFilterTeam(e.target.value)}
              className="bg-transparent text-[10px] font-black uppercase tracking-widest px-4 py-2 outline-none border-r border-white/10 cursor-pointer hover:text-blue-400"
            >
              <option value="" className="text-cric-text">All Teams</option>
              {teams.map(t => <option key={t._id} value={t._id} className="text-cric-text">{t.name}</option>)}
            </select>

            <select
              value={filterRole}
              onChange={(e) => setFilterRole(e.target.value)}
              className="bg-transparent text-[10px] font-black uppercase tracking-widest px-4 py-2 outline-none border-r border-white/10 cursor-pointer hover:text-blue-400"
            >
              <option value="" className="text-cric-text">All Roles</option>
              <option value="Batsman" className="text-cric-text">Batsman</option>
              <option value="Bowler" className="text-cric-text">Bowler</option>
              <option value="All-Rounder" className="text-cric-text">All-Rounder</option>
              <option value="Wicket-Keeper" className="text-cric-text">Wicket-Keeper</option>
            </select>

            <button
              onClick={() => { setFilterTeam(""); setFilterRole(""); setSearch(""); }}
              className="ml-auto px-6 py-2 bg-white text-cric-accent text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-red-600 hover:text-white transition-all shadow-lg"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 pt-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <OrgTypeFilter />
          <LocationFilters />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-12">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-cric-muted font-black uppercase tracking-widest text-xs">Loading players...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredPlayers.map((player) => (
              <PlayerCard key={player._id} player={player} />
            ))}

            {filteredPlayers.length === 0 && (
              <div className="col-span-full py-32 flex flex-col items-center justify-center bg-cric-card rounded-[2rem] border border-cric-border shadow-sm">
                <div className="w-16 h-16 bg-cric-bg rounded-full flex items-center justify-center mb-6">
                  <svg className="w-8 h-8 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                </div>
                <h4 className="text-xl font-black text-cric-accent uppercase tracking-tighter italic">No Players Found</h4>
                <p className="text-cric-muted text-sm mt-2 text-center max-w-xs uppercase tracking-widest text-[10px] font-black">Try a different name, team or role.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
