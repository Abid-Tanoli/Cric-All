import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";

const rankingTypes = [
  { key: "team-overall", label: "Team Overall", metric: "Rating" },
  { key: "batting", label: "Best Batsman", metric: "Runs" },
  { key: "bowling", label: "Best Bowler", metric: "Wickets" },
  { key: "all-rounder", label: "Best All-Rounder", metric: "Points" },
  { key: "fielder", label: "Best Fielder", metric: "Dismissals" },
  { key: "wicket-keeper", label: "Best Wicket-Keeper", metric: "Dismissals" },
];

const scopes = [
  { key: "team", label: "Team Player Rank", placeholder: "Team name or ID" },
  { key: "pre-town", label: "Pre-Town Wise", placeholder: "Area or pre-town name" },
  { key: "town", label: "Town Wise", placeholder: "Town name" },
  { key: "district", label: "District Wise", placeholder: "District name" },
  { key: "city", label: "City Wise", placeholder: "City name" },
  { key: "country", label: "Country Wise", placeholder: "Country name" },
];

const getRankLabel = (rank) => {
  if (rank === 1) return "1";
  if (rank === 2) return "2";
  if (rank === 3) return "3";
  return String(rank);
};

const playerMetric = (item, activeType) => {
  if (activeType === "batting") return item.runs || 0;
  if (activeType === "bowling") return item.wickets || 0;
  if (activeType === "fielder") return (item.catches || 0) + (item.runOuts || 0) + (item.stumpings || 0);
  if (activeType === "wicket-keeper") return (item.catches || 0) + (item.stumpings || 0) + (item.runOuts || 0);
  return Number(item.rankingPoints || item.points || 0).toFixed(0);
};

export default function Rankings() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeType, setActiveType] = useState("team-overall");
  const [scope, setScope] = useState("country");
  const [scopeValue, setScopeValue] = useState("");

  const isTeamView = activeType === "team-overall";
  const activeTypeMeta = rankingTypes.find((type) => type.key === activeType) || rankingTypes[0];
  const activeScopeMeta = scopes.find((item) => item.key === scope) || scopes[scopes.length - 1];

  const requestParams = useMemo(() => {
    const params = { limit: 100, scope };
    if (scopeValue.trim()) params.scopeValue = scopeValue.trim();
    return params;
  }, [scope, scopeValue]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchData();
    }, 250);

    return () => window.clearTimeout(timer);
  }, [activeType, requestParams]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = isTeamView
        ? await api.get("/rankings-v2/overall", { params: requestParams, timeout: 8000 })
        : await api.get("/players/rankings", { params: { ...requestParams, type: activeType }, timeout: 8000 });
      setItems(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-cric-bg text-cric-text font-sans">

      <div className="bg-cric-accent text-white">
        <div className="mx-auto max-w-7xl px-4 py-10">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-200">Step-wise Rankings</p>
          <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-4xl font-black uppercase tracking-tight sm:text-5xl">CricAll Leaderboard</h1>
              <p className="mt-3 max-w-3xl text-sm font-semibold text-blue-100/80">
                Rank teams and players by team, pre-town, town, district, city and country.
              </p>
            </div>
            <div className="rounded-2xl bg-white/10 px-5 py-4 text-sm font-bold text-blue-100">
              {activeTypeMeta.label} - {activeScopeMeta.label}
            </div>
          </div>

          <div className="mt-8 flex gap-2 overflow-x-auto pb-2 no-scrollbar">
            {rankingTypes.map((type) => (
              <button
                key={type.key}
                onClick={() => setActiveType(type.key)}
                className={`shrink-0 rounded-xl px-4 py-3 text-[10px] font-black uppercase tracking-widest transition-all ${
                  activeType === type.key ? "bg-cric-card text-cric-accent" : "bg-white/10 text-blue-100 hover:bg-white/20"
                }`}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 py-8">
        <section className="mb-8 rounded-2xl border border-cric-border bg-cric-card p-4 shadow-sm">
          <div className="mb-4 flex flex-wrap gap-2">
            {scopes.map((item) => (
              <button
                key={item.key}
                onClick={() => setScope(item.key)}
                className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-wide transition-all ${
                   scope === item.key ? "bg-cric-accent text-white" : "bg-cric-bg text-cric-muted hover:bg-cric-card"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
            <input
              value={scopeValue}
              onChange={(event) => setScopeValue(event.target.value)}
              placeholder={activeScopeMeta.placeholder}
              className="w-full rounded-xl border border-cric-border bg-cric-bg px-4 py-3 text-sm font-bold text-cric-text outline-none focus:border-blue-500"
            />
            <button
              onClick={() => setScopeValue("")}
              className="rounded-xl border border-cric-border px-4 py-3 text-[10px] font-black uppercase tracking-widest text-cric-muted hover:bg-cric-bg"
            >
              Clear Filter
            </button>
          </div>
            <p className="mt-3 text-xs font-semibold text-cric-muted">
            Leave the filter empty to show the top available rankings for this scope.
          </p>
        </section>

        {loading ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-cric-border bg-cric-card py-20">
            <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
            <p className="text-xs font-black uppercase tracking-widest text-cric-muted">Loading rankings...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-cric-border bg-cric-card p-12 text-center">
            <p className="text-xl font-black text-cric-muted">No rankings data yet</p>
            <p className="mt-2 text-sm text-cric-muted">Complete matches or adjust the filter to generate rankings.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-cric-border bg-cric-card shadow-xl">
            <div className="grid grid-cols-[80px_1fr_100px_100px] gap-3 bg-cric-accent px-4 py-4 text-[10px] font-black uppercase tracking-widest text-white sm:grid-cols-[100px_1fr_120px_120px]">
              <span>Rank</span>
              <span>{isTeamView ? "Team" : "Player"}</span>
              <span className="text-center">{activeTypeMeta.metric}</span>
              <span className="text-center">{isTeamView ? "NRR" : "Matches"}</span>
            </div>
            <div className="divide-y divide-cric-bg">
              {items.map((item, index) => {
                const rank = item.overallRank || item.rank || item.categoryRank || index + 1;
                const team = item.team || item.player?.team;
                const name = isTeamView ? (team?.name || "-") : (item.name || item.player?.name || "-");
                const linkTo = isTeamView ? `/teams/${team?._id || ""}` : `/players/${item._id || item.player?._id}`;
                const metric = isTeamView
                  ? Number(item.rating || item.points || 0).toFixed(1)
                  : playerMetric(item, activeType);

                return (
                  <Link
                    key={item._id || item.player?._id || index}
                    to={linkTo}
                    className="grid grid-cols-[80px_1fr_100px_100px] gap-3 px-4 py-4 transition-all hover:bg-cric-bg sm:grid-cols-[100px_1fr_120px_120px]"
                  >
                    <div className="flex items-center">
                      <span className={`flex h-10 w-10 items-center justify-center rounded-xl text-sm font-black ${
                        rank <= 3 ? "bg-amber-100 text-amber-700" : "bg-cric-bg text-cric-muted"
                      }`}>
                        {getRankLabel(rank)}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        {team?.logo && <img src={team.logo} alt="" className="h-9 w-9 rounded-lg object-cover" />}
                        <div className="min-w-0">
                          <p className="truncate font-black text-cric-text">{name}</p>
                          <p className="truncate text-[10px] font-bold uppercase tracking-wide text-cric-muted">
                            {isTeamView ? (team?.branchName || team?.shortName || "Team") : (team?.name || item.playingRole || "Player")}
                          </p>
                        </div>
                      </div>
                    </div>
                    <span className="self-center text-center text-sm font-black text-cric-accent">{metric}</span>
                    <span className="self-center text-center text-sm font-bold text-cric-muted">
                      {isTeamView ? Number(item.netRunRate || 0).toFixed(2) : item.matches || 0}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
