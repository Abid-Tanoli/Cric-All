import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";

const SECTIONS = [
  { key: "teams", label: "Team Rankings" },
  { key: "players", label: "Player Rankings" },
];

const TEAM_TYPES = [
  { value: "", label: "All team types" },
  { value: "team", label: "Team" },
  { value: "local_team", label: "Local team" },
  { value: "league_team", label: "League team" },
  { value: "incubation_team", label: "Incubation team" },
  { value: "international_team", label: "International team" },
];

// Task 4: one leaderboard per player discipline. `type` is the value the
// consolidated player-ranking controller understands.
const PLAYER_BOARDS = [
  { key: "batting", label: "Batting", endpoint: "batting", metric: "Runs", metricOf: (item) => item.runs || 0 },
  { key: "bowling", label: "Bowling", endpoint: "bowling", metric: "Wickets", metricOf: (item) => item.wickets || 0 },
  { key: "all-rounder", label: "All-Rounder", endpoint: "all-rounder", metric: "Points", metricOf: (item) => Number(item.rankingPoints || item.points || 0).toFixed(0) },
  { key: "fielder", label: "Fielding", endpoint: "fielder", metric: "Dismissals", metricOf: (item) => (item.catches || 0) + (item.runOuts || 0) + (item.stumpings || 0) },
  { key: "wicket-keeper", label: "Wicket-Keeping", endpoint: "wicket-keeper", metric: "Dismissals", metricOf: (item) => (item.catches || 0) + (item.stumpings || 0) + (item.runOuts || 0) },
];

const PLAYER_SCOPES = [
  { key: "country", label: "Country", placeholder: "Country name" },
  { key: "city", label: "City", placeholder: "City name" },
  { key: "district", label: "District", placeholder: "District name" },
  { key: "town", label: "Town", placeholder: "Town name" },
  { key: "pre-town", label: "Area", placeholder: "Area or pre-town name" },
  { key: "team", label: "Team", placeholder: "Team name or ID" },
];

const rankBadgeClasses = (rank) =>
  rank <= 3 ? "bg-amber-100 text-amber-700" : "bg-cric-bg text-cric-muted";

function cleanParams(params) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== "" && value !== undefined && value !== null)
  );
}

export default function Rankings() {
  const [section, setSection] = useState("teams");

  const [teamItems, setTeamItems] = useState([]);
  const [teamLoading, setTeamLoading] = useState(true);
  const [teamOrgType, setTeamOrgType] = useState("");
  const [teamType, setTeamType] = useState("");
  const [teamCity, setTeamCity] = useState("");
  const [teamCountry, setTeamCountry] = useState("");

  const [playerItems, setPlayerItems] = useState([]);
  const [playerLoading, setPlayerLoading] = useState(true);
  const [playerBoard, setPlayerBoard] = useState("batting");
  const [playerScope, setPlayerScope] = useState("country");
  const [playerScopeValue, setPlayerScopeValue] = useState("");

  const teamParams = useMemo(
    () =>
      cleanParams({
        limit: 100,
        orgType: teamOrgType.trim(),
        teamType,
        city: teamCity.trim(),
        country: teamCountry.trim(),
      }),
    [teamOrgType, teamType, teamCity, teamCountry]
  );

  const playerParams = useMemo(() => {
    const board = PLAYER_BOARDS.find((item) => item.key === playerBoard) || PLAYER_BOARDS[0];
    return cleanParams({
      limit: 100,
      type: board.endpoint,
      scope: playerScope,
      scopeValue: playerScopeValue.trim(),
    });
  }, [playerBoard, playerScope, playerScopeValue]);

  useEffect(() => {
    let cancelled = false;
    setTeamLoading(true);
    api
      .get("/rankings-v2/overall", { params: teamParams, timeout: 8000 })
      .then((res) => {
        if (!cancelled) setTeamItems(Array.isArray(res.data) ? res.data : []);
      })
      .catch(() => {
        if (!cancelled) setTeamItems([]);
      })
      .finally(() => {
        if (!cancelled) setTeamLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [teamParams]);

  useEffect(() => {
    let cancelled = false;
    setPlayerLoading(true);
    api
      .get("/players/rankings", { params: playerParams, timeout: 8000 })
      .then((res) => {
        if (!cancelled) setPlayerItems(Array.isArray(res.data) ? res.data : []);
      })
      .catch(() => {
        if (!cancelled) setPlayerItems([]);
      })
      .finally(() => {
        if (!cancelled) setPlayerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [playerParams]);

  const activeBoard = PLAYER_BOARDS.find((item) => item.key === playerBoard) || PLAYER_BOARDS[0];
  const activeScope = PLAYER_SCOPES.find((item) => item.key === playerScope) || PLAYER_SCOPES[0];

  const resetTeamFilters = () => {
    setTeamOrgType("");
    setTeamType("");
    setTeamCity("");
    setTeamCountry("");
  };

  return (
    <div className="min-h-screen bg-cric-bg text-cric-text font-sans">
      <div className="bg-cric-accent text-white">
        <div className="mx-auto max-w-7xl px-4 py-10">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-200">CricAll Leaderboards</p>
          <h1 className="mt-3 text-4xl font-black uppercase tracking-tight sm:text-5xl">Rankings</h1>
          <p className="mt-3 max-w-3xl text-sm font-semibold text-blue-100/80">
            Team and player leaderboards, filterable by organization type, team type and location.
          </p>

          <div className="mt-8 flex gap-2 overflow-x-auto pb-2 no-scrollbar">
            {SECTIONS.map((item) => (
              <button
                key={item.key}
                onClick={() => setSection(item.key)}
                aria-pressed={section === item.key}
                className={`shrink-0 rounded-xl px-5 py-3 text-[10px] font-black uppercase tracking-widest transition-all ${
                  section === item.key ? "bg-cric-card text-cric-accent" : "bg-white/10 text-blue-100 hover:bg-white/20"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 py-8">
        {section === "teams" ? (
          <section aria-label="Team Rankings">
            <div className="mb-6 rounded-2xl border border-cric-border bg-cric-card p-4 shadow-sm">
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                <label className="flex flex-col gap-1 text-[10px] font-black uppercase tracking-widest text-cric-muted">
                  Organization type
                  <input
                    id="org-type-filter"
                    aria-label="Organization type"
                    value={teamOrgType}
                    onChange={(event) => setTeamOrgType(event.target.value)}
                    placeholder="e.g. club, school"
                    className="rounded-xl border border-cric-border bg-cric-bg px-4 py-3 text-sm font-bold text-cric-text outline-none focus:border-blue-500"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[10px] font-black uppercase tracking-widest text-cric-muted">
                  Team type
                  <select
                    id="team-type-filter"
                    aria-label="Team type"
                    value={teamType}
                    onChange={(event) => setTeamType(event.target.value)}
                    className="rounded-xl border border-cric-border bg-cric-bg px-4 py-3 text-sm font-bold text-cric-text outline-none focus:border-blue-500"
                  >
                    {TEAM_TYPES.map((type) => (
                      <option key={type.value || "all"} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[10px] font-black uppercase tracking-widest text-cric-muted">
                  City
                  <input
                    id="team-city-filter"
                    aria-label="City"
                    value={teamCity}
                    onChange={(event) => setTeamCity(event.target.value)}
                    placeholder="City name"
                    className="rounded-xl border border-cric-border bg-cric-bg px-4 py-3 text-sm font-bold text-cric-text outline-none focus:border-blue-500"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[10px] font-black uppercase tracking-widest text-cric-muted">
                  Country
                  <input
                    id="team-country-filter"
                    aria-label="Country"
                    value={teamCountry}
                    onChange={(event) => setTeamCountry(event.target.value)}
                    placeholder="Country name"
                    className="rounded-xl border border-cric-border bg-cric-bg px-4 py-3 text-sm font-bold text-cric-text outline-none focus:border-blue-500"
                  />
                </label>
              </div>
              <button
                onClick={resetTeamFilters}
                className="mt-4 rounded-xl border border-cric-border px-4 py-2 text-[10px] font-black uppercase tracking-widest text-cric-muted hover:bg-cric-bg"
              >
                Clear Filters
              </button>
            </div>

            {teamLoading ? (
              <RankingsLoading />
            ) : teamItems.length === 0 ? (
              <EmptyState message="No team rankings match these filters." />
            ) : (
              <div className="overflow-hidden rounded-2xl border border-cric-border bg-cric-card shadow-xl">
                <div className="grid grid-cols-[64px_1fr_90px_90px] gap-3 bg-cric-accent px-4 py-4 text-[10px] font-black uppercase tracking-widest text-white sm:grid-cols-[80px_1fr_120px_120px]">
                  <span>Rank</span>
                  <span>Team</span>
                  <span className="text-center">Rating</span>
                  <span className="text-center">NRR</span>
                </div>
                <div className="divide-y divide-cric-bg">
                  {teamItems.map((item, index) => {
                    const team = item.team || {};
                    const rank = item.overallRank || item.categoryRank || index + 1;
                    return (
                      <Link
                        key={item._id || team._id || index}
                        to={`/teams/${team._id || ""}`}
                        className="grid grid-cols-[64px_1fr_90px_90px] gap-3 px-4 py-4 transition-all hover:bg-cric-bg sm:grid-cols-[80px_1fr_120px_120px]"
                      >
                        <div className="flex items-center">
                          <span className={`flex h-10 w-10 items-center justify-center rounded-xl text-sm font-black ${rankBadgeClasses(rank)}`}>
                            {rank}
                          </span>
                        </div>
                        <div className="flex min-w-0 items-center gap-3">
                          {team.logo && <img src={team.logo} alt="" className="h-9 w-9 rounded-lg object-cover" />}
                          <div className="min-w-0">
                            <p className="truncate font-black text-cric-text">{team.name || "-"}</p>
                            <p className="truncate text-[10px] font-bold uppercase tracking-wide text-cric-muted">
                              {team.branchName || team.shortName || "Team"}
                            </p>
                          </div>
                        </div>
                        <span className="self-center text-center text-sm font-black text-cric-accent">
                          {Number(item.rating || item.points || 0).toFixed(1)}
                        </span>
                        <span className="self-center text-center text-sm font-bold text-cric-muted">
                          {Number(item.netRunRate || 0).toFixed(2)}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        ) : (
          <section aria-label="Player Rankings">
            <div className="mb-4 flex gap-2 overflow-x-auto pb-2 no-scrollbar">
              {PLAYER_BOARDS.map((board) => (
                <button
                  key={board.key}
                  onClick={() => setPlayerBoard(board.key)}
                  aria-pressed={playerBoard === board.key}
                  className={`shrink-0 rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-all ${
                    playerBoard === board.key ? "bg-cric-accent text-white" : "bg-cric-card text-cric-muted hover:bg-cric-bg"
                  }`}
                >
                  {board.label}
                </button>
              ))}
            </div>

            <div className="mb-6 rounded-2xl border border-cric-border bg-cric-card p-4 shadow-sm">
              <div className="grid gap-3 md:grid-cols-[220px_1fr_auto] md:items-end">
                <label className="flex flex-col gap-1 text-[10px] font-black uppercase tracking-widest text-cric-muted">
                  Scope
                  <select
                    id="player-scope"
                    aria-label="Player scope"
                    value={playerScope}
                    onChange={(event) => setPlayerScope(event.target.value)}
                    className="rounded-xl border border-cric-border bg-cric-bg px-4 py-3 text-sm font-bold text-cric-text outline-none focus:border-blue-500"
                  >
                    {PLAYER_SCOPES.map((scope) => (
                      <option key={scope.key} value={scope.key}>
                        {scope.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[10px] font-black uppercase tracking-widest text-cric-muted">
                  Filter value
                  <input
                    id="player-scope-value"
                    aria-label="Player scope value"
                    value={playerScopeValue}
                    onChange={(event) => setPlayerScopeValue(event.target.value)}
                    placeholder={activeScope.placeholder}
                    className="rounded-xl border border-cric-border bg-cric-bg px-4 py-3 text-sm font-bold text-cric-text outline-none focus:border-blue-500"
                  />
                </label>
                <button
                  onClick={() => setPlayerScopeValue("")}
                  className="rounded-xl border border-cric-border px-4 py-3 text-[10px] font-black uppercase tracking-widest text-cric-muted hover:bg-cric-bg"
                >
                  Clear Filter
                </button>
              </div>
            </div>

            {playerLoading ? (
              <RankingsLoading />
            ) : playerItems.length === 0 ? (
              <EmptyState message="No player rankings match these filters." />
            ) : (
              <div className="overflow-hidden rounded-2xl border border-cric-border bg-cric-card shadow-xl">
                <div className="grid grid-cols-[64px_1fr_100px_80px] gap-3 bg-cric-accent px-4 py-4 text-[10px] font-black uppercase tracking-widest text-white sm:grid-cols-[80px_1fr_140px_100px]">
                  <span>Rank</span>
                  <span>Player</span>
                  <span className="text-center">{activeBoard.metric}</span>
                  <span className="text-center">Matches</span>
                </div>
                <div className="divide-y divide-cric-bg">
                  {playerItems.map((item, index) => {
                    const team = item.team || {};
                    const rank = item.rank || index + 1;
                    return (
                      <Link
                        key={item._id || index}
                        to={`/players/${item._id || ""}`}
                        className="grid grid-cols-[64px_1fr_100px_80px] gap-3 px-4 py-4 transition-all hover:bg-cric-bg sm:grid-cols-[80px_1fr_140px_100px]"
                      >
                        <div className="flex items-center">
                          <span className={`flex h-10 w-10 items-center justify-center rounded-xl text-sm font-black ${rankBadgeClasses(rank)}`}>
                            {rank}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-black text-cric-text">{item.name || "-"}</p>
                          <p className="truncate text-[10px] font-bold uppercase tracking-wide text-cric-muted">
                            {team.name || item.playingRole || "Player"}
                          </p>
                        </div>
                        <span className="self-center text-center text-sm font-black text-cric-accent">
                          {activeBoard.metricOf(item)}
                        </span>
                        <span className="self-center text-center text-sm font-bold text-cric-muted">
                          {item.matches || 0}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function RankingsLoading() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-cric-border bg-cric-card py-20">
      <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      <p className="text-xs font-black uppercase tracking-widest text-cric-muted">Loading rankings...</p>
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div className="rounded-2xl border border-cric-border bg-cric-card p-12 text-center">
      <p className="text-xl font-black text-cric-muted">{message}</p>
      <p className="mt-2 text-sm text-cric-muted">Adjust the filters or complete more matches to populate this board.</p>
    </div>
  );
}
