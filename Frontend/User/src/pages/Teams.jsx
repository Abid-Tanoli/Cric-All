import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";

// Task 3: browse teams by the type of the organization that owns them
// (club, school, college, academy, league, …). The type lives on
// TeamOrganization and is populated onto each team as `organizationRef.type`.
const ORG_TYPE_ICONS = {
  club: "🏏",
  school: "🏫",
  college: "🎓",
  university: "🏛️",
  academy: "⭐",
  league: "🏆",
  organization: "🏢",
  business: "💼",
  industry: "🏭",
  corporate: "🏢",
  international: "🌍",
  other: "📋",
};

const orgTypeLabel = (type) => String(type || "")
  .split(/[_\s-]+/)
  .filter(Boolean)
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(" ");

const ICONS = {
  School: "🏫", College: "🎓", University: "🏛️",
  Organization: "🏢", Business: "💼", Industry: "🏭",
  Club: "🏏", Corporate: "🏢", Academy: "⭐",
  International: "🌍", Other: "📋",
};

export default function Teams() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeCategory, setActiveCategory] = useState("all");
  const [activeOrgType, setActiveOrgType] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    fetchTeams();
  }, [activeCategory, searchTerm]);

  // Options are derived from the teams actually loaded, so the filter always
  // reflects real organization types instead of a hardcoded enum. "all" is the
  // mixed view.
  const orgTypeOptions = useMemo(() => {
    const types = new Set();
    teams.forEach((team) => {
      const type = team.organizationRef?.type;
      if (type) types.add(String(type).toLowerCase());
    });
    return Array.from(types).sort();
  }, [teams]);

  const fetchTeams = async () => {
    try {
      setLoading(true);
      const params = {
        limit: 120,
        includePlayers: false,
      };
      if (activeCategory !== "all") params.category = activeCategory;
      if (searchTerm.trim()) params.search = searchTerm.trim();

      const teamsRes = await api.get("/teams", { params, timeout: 8000 });
      const payload = Array.isArray(teamsRes.data) ? teamsRes.data : (teamsRes.data?.teams || []);
      setTeams(payload);
      setError(null);
    } catch (e) {
      console.error(e);
      setError(e.response?.data?.message || e.message || "Failed to load teams");
      setTeams([]);
    } finally {
      setLoading(false);
    }
  };

  const filteredTeams = teams.filter(t => {
    if (activeOrgType !== "all" && String(t.organizationRef?.type || "").toLowerCase() !== activeOrgType) return false;
    if (activeCategory !== "all" && t.category !== activeCategory) return false;
    if (searchTerm && !t.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !t.organization?.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !t.branchName?.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    if (!["School", "College", "University", "Organization", "Business", "Industry", "Club", "Corporate", "Academy", "International", "Other"].includes(t.category)) return false;
    return true;
  });

  const groupedTeams = {};
  const visibleCategories = ["School", "College", "University", "Organization", "Business", "Industry", "Club", "Corporate", "Academy", "International", "Other"];
  visibleCategories.forEach(cat => {
    const catTeams = filteredTeams.filter(t => t.category === cat);
    if (catTeams.length > 0) {
      groupedTeams[cat] = catTeams;
    }
  });

  return (
    <div className="min-h-screen bg-cric-bg text-cric-text font-sans">

      <div className="bg-cric-accent text-white py-16 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-600/10 rounded-full -mr-48 -mt-48 blur-3xl" />
        <div className="max-w-7xl mx-auto px-4 relative">
          <h1 className="text-5xl font-black uppercase tracking-tighter italic mb-4">🏏 Teams Directory</h1>
          <p className="text-blue-200/60 font-black uppercase tracking-widest text-sm">Explore teams by category</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Search & Filter */}
        <div className="bg-cric-card rounded-2xl shadow-sm border border-slate-100 p-4 mb-8">
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => setActiveCategory("all")}
              className={`px-4 py-2 rounded-xl font-black text-xs uppercase tracking-wider transition-all ${
                activeCategory === "all" ? "bg-cric-accent text-white" : "bg-cric-bg text-cric-muted hover:bg-slate-200"
              }`}
            >
              📋 All
            </button>
            {visibleCategories.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-4 py-2 rounded-xl font-black text-xs uppercase tracking-wider transition-all ${
                  activeCategory === cat ? "bg-cric-accent text-white" : "bg-cric-bg text-cric-muted hover:bg-slate-200"
                }`}
              >
                {ICONS[cat] || "📋"} {cat}
              </button>
            ))}
          </div>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <label
              htmlFor="org-type-filter"
              className="text-[10px] font-black uppercase tracking-widest text-cric-muted"
            >
              Organization type
            </label>
            <select
              id="org-type-filter"
              aria-label="Filter by organization type"
              value={activeOrgType}
              onChange={(e) => setActiveOrgType(e.target.value)}
              className="w-full rounded-xl border border-cric-border bg-cric-bg px-4 py-3 text-sm font-bold text-cric-text focus:outline-none focus:ring-2 focus:ring-cric-accent sm:w-64"
            >
              <option value="all">All types</option>
              {orgTypeOptions.map((type) => (
                <option key={type} value={type}>
                  {ORG_TYPE_ICONS[type] || "📋"} {orgTypeLabel(type)}
                </option>
              ))}
            </select>
          </div>
          <input
            type="text"
            placeholder="Search teams or organizations..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full border border-cric-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-cric-accent"
          />
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-cric-muted font-black uppercase tracking-widest text-xs">Loading Teams...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="text-5xl mb-4">⚠️</div>
            <h2 className="text-2xl font-black text-cric-text mb-2">Failed to Load Teams</h2>
            <p className="text-cric-muted text-sm mb-4">{error}</p>
            <button onClick={fetchTeams} className="px-6 py-3 bg-blue-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-blue-700 transition-all">
              Try Again
            </button>
          </div>
        ) : Object.keys(groupedTeams).length === 0 ? (
          <div className="text-center py-20">
            <p className="text-6xl mb-4">🏏</p>
            <p className="text-xl font-black text-cric-muted">No teams found</p>
            <p className="text-cric-muted text-sm mt-2">Check back later for new teams.</p>
          </div>
        ) : (
          Object.entries(groupedTeams).map(([category, catTeams]) => (
            <div key={category} className="mb-10">
              <div className="flex items-center gap-3 mb-6">
                <span className="text-3xl">{ICONS[category] || "📋"}</span>
                <h2 className="text-3xl font-black text-cric-accent uppercase tracking-tighter italic">
                  {category}s
                </h2>
                <span className="px-3 py-1 bg-cric-card text-blue-800 rounded-full text-xs font-bold">
                  {catTeams.length} team{catTeams.length > 1 ? 's' : ''}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {catTeams.map(team => (
                  <Link
                    key={team._id}
                    to={`/teams/${team._id}`}
                    className="bg-cric-card rounded-2xl border border-slate-100 overflow-hidden hover:shadow-xl transition-all group"
                  >
                    <div
                      className="h-20 flex items-center justify-center relative"
                      style={{ background: `linear-gradient(135deg, ${team.teamColorPrimary || '#031d44'}, ${team.teamColorSecondary || '#003087'})` }}
                    >
                      {team.logo ? (
                        <img src={team.logo} alt="" className="h-14 w-14 object-contain rounded-full bg-white/20 p-1" />
                      ) : (
                        <span className="text-2xl font-black text-white/80">{team.shortName || team.name.substring(0, 3).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <h3 className="font-bold text-cric-accent group-hover:text-cric-accent transition-colors">
                          {team.name}
                        </h3>
                        <span className="text-xs opacity-50">{ICONS[category]}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-cric-muted">
                        {team.organization && <span>🏢 {team.organization}</span>}
                        {team.branchName && <span>📍 {team.branchName}</span>}
                      </div>
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                        <span className="text-xs text-cric-muted">👥 {team.players?.length || 0} players</span>
                        {team.address?.city && (
                          <span className="text-xs text-cric-muted">📍 {team.address.city}</span>
                        )}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
