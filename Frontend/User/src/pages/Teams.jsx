import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../services/api";
import LoadingWithTimeout from "../components/LoadingWithTimeout";
import LocationFilters, { locationQueryFromSearchParams } from "../components/LocationFilters";
import OrgTypeFilter, { orgTypeFromSearchParams } from "../components/OrgTypeFilter";
import { normalizeOrgType, orgTypeIcon, orgTypeLabel, teamRoleLabel, verificationBadge } from "../../../Shared/orgTypes.js";

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
  const [searchTerm, setSearchTerm] = useState("");
  const [searchParams] = useSearchParams();
  const activeOrgType = orgTypeFromSearchParams(searchParams) || "all";
  const locationQuery = locationQueryFromSearchParams(searchParams);
  const locationKey = JSON.stringify(locationQuery);

  useEffect(() => {
    fetchTeams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory, activeOrgType, searchTerm, locationKey]);

  // Options are derived from the teams actually loaded, so the filter always
  // reflects real organization types instead of a hardcoded enum. "all" is the
  // mixed view.
  const orgTypeOptions = useMemo(() => {
    const types = new Map();
    teams.forEach((team) => {
      const ref = team.organizationRef;
      const raw = String(ref?.orgType || ref?.type || "").toLowerCase();
      if (raw && !types.has(raw)) types.set(raw, normalizeOrgType(raw));
    });
    return Array.from(types.values(), (type) => ({
      value: type,
      label: orgTypeLabel(type),
      icon: orgTypeIcon(type),
    })).sort((a, b) => a.label.localeCompare(b.label));
  }, [teams]);

  const fetchTeams = async () => {
    try {
      setLoading(true);
      const params = {
        limit: 120,
        includePlayers: false,
      };
      if (activeCategory !== "all") params.category = activeCategory;
      if (activeOrgType !== "all") params.orgType = activeOrgType;
      if (searchTerm.trim()) params.search = searchTerm.trim();
      Object.assign(params, locationQuery);

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
    if (activeOrgType !== "all") {
      const allowed = activeOrgType.split(",").map(normalizeOrgType);
      const raw = String(t.organizationRef?.orgType || t.organizationRef?.type || "").toLowerCase();
      if (!allowed.includes(normalizeOrgType(raw))) return false;
    }
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
          <div className="mb-4 max-w-sm">
            <OrgTypeFilter ariaLabel="Filter by organization type" options={orgTypeOptions} />
          </div>
          <input
            type="text"
            placeholder="Search teams or organizations..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full border border-cric-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-cric-accent"
          />
          <div className="mt-4">
            <LocationFilters />
          </div>
        </div>

        {loading ? (
          <LoadingWithTimeout label="Loading Teams..." />
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="text-5xl mb-4">⚠️</div>
            <h2 className="text-2xl font-black text-cric-text mb-2">Teams unavailable</h2>
            <p className="text-cric-muted text-sm mb-4">
              Teams could not be loaded right now. Please try again soon.
            </p>
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
                      <div className="flex flex-wrap items-center gap-2 text-xs text-cric-muted">
                        {team.organization && <span>🏢 {team.organization}</span>}
                        <span className="rounded-full border border-cric-border bg-cric-bg px-2 py-0.5 text-[10px] font-black uppercase tracking-wider">
                          {teamRoleLabel(team.teamRole)}
                        </span>
                        {team.branchName && <span>📍 {team.branchName}</span>}
                        {team.organizationRef ? (
                          <span className="rounded-full border border-cric-border bg-cric-bg px-2 py-0.5 text-[10px] font-black uppercase tracking-wider">
                            {orgTypeIcon(team.organizationRef)} {orgTypeLabel(team.organizationRef)}
                          </span>
                        ) : null}
                        {team.organizationRef?.verificationStatus === "verified" ? (
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${verificationBadge("verified").className}`}>
                            ✓ Verified
                          </span>
                        ) : null}
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
