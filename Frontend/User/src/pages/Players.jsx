import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import PlayerCard from "../components/PlayerCard";
import { api } from "../services/api";

export default function Players() {
  const [searchParams] = useSearchParams();
  const teamIdFromUrl = searchParams.get("team");

  const [players, setPlayers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [filterTeam, setFilterTeam] = useState(teamIdFromUrl || "");
  const [filterRole, setFilterRole] = useState("");
  const [filterCampus, setFilterCampus] = useState("");

  useEffect(() => {
    // Fetch Teams for the filter dropdown
    api.get("/teams")
      .then(res => setTeams(Array.isArray(res.data) ? res.data : []))
      .catch(err => console.error("Failed to fetch teams:", err));

    // Initial fetch of players
    fetchPlayers();
  }, []);

  useEffect(() => {
    fetchPlayers();
  }, [filterTeam, filterRole, filterCampus]);

  const fetchPlayers = async () => {
    setLoading(true);
    try {
      const params = { limit: 100 };
      if (filterTeam) params.team = filterTeam;
      if (filterCampus) params.Campus = filterCampus;
      const res = await api.get("/players", { params });
      const data = res.data;
      setPlayers(Array.isArray(data.players) ? data.players : (Array.isArray(data) ? data : []));
    } catch (err) {
      console.error("Failed to fetch players:", err);
    } finally {
      setLoading(false);
    }
  };

  const filteredPlayers = players.filter(p =>
    p.name?.toLowerCase().includes(search.toLowerCase()) &&
    (!filterRole || p.role?.toLowerCase() === filterRole.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-cric-bg text-cric-text font-sans">

      {/* Hero / Filter Section */}
      <div className="bg-cric-accent text-white py-16 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-600/10 rounded-full -mr-48 -mt-48 blur-3xl" />
        <div className="max-w-7xl mx-auto px-4 relative">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
            <div>
              <h1 className="text-5xl font-black uppercase tracking-tighter italic mb-4">Elite Scouters</h1>
              <p className="text-blue-200/60 font-black uppercase tracking-widest text-sm">Discover and track the next legends of the league</p>
            </div>

            <div className="w-full max-w-md group">
              <div className="relative">
                <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-300/30 group-focus-within:text-blue-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Find specific scouts..."
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
              <option value="" className="text-cric-text">All Franchises</option>
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

            <div className="flex-1 min-w-[200px] flex items-center gap-3 px-4 py-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-blue-300/40">Campus:</span>
              <input
                value={filterCampus}
                onChange={(e) => setFilterCampus(e.target.value)}
                placeholder="Any Location"
                className="bg-transparent text-[10px] font-black outline-none w-full uppercase tracking-widest placeholder:text-blue-300/10"
              />
            </div>

            <button
              onClick={() => { setFilterTeam(""); setFilterRole(""); setFilterCampus(""); setSearch(""); }}
              className="px-6 py-2 bg-white text-cric-accent text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-red-600 hover:text-white transition-all shadow-lg"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-12">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-cric-muted font-black uppercase tracking-widest text-xs">Assembling Personnel Files...</p>
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
                <h4 className="text-xl font-black text-cric-accent uppercase tracking-tighter italic">No Scouters Found</h4>
                <p className="text-cric-muted text-sm mt-2 text-center max-w-xs uppercase tracking-widest text-[10px] font-black">Refine your parameters to locate the requested personnel.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
