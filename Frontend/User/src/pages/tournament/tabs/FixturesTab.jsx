import React, { useMemo, useState } from "react";
import { MatchGroup } from "../MatchList";
import { distinctGroups, distinctTeams, filterMatches, groupMatches } from "../matchUtils";

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "live", label: "Live" },
  { value: "upcoming", label: "Upcoming" },
  { value: "completed", label: "Results" },
];

export default function FixturesTab({ matches = [] }) {
  const [query, setQuery] = useState("");
  const [teamId, setTeamId] = useState("");
  const [status, setStatus] = useState("all");
  const [group, setGroup] = useState("all");

  const teams = useMemo(() => distinctTeams(matches), [matches]);
  const groups = useMemo(() => distinctGroups(matches), [matches]);
  const filtered = useMemo(
    () => filterMatches(matches, { q: query, teamId, status, group }),
    [matches, query, teamId, status, group],
  );
  const grouped = useMemo(() => groupMatches(filtered), [filtered]);

  const hasMatches = matches.length > 0;
  const hasResults = filtered.length > 0;

  return (
    <div className="space-y-8">
      <div className="bg-cric-card rounded-2xl shadow-sm border border-cric-border p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <input
            type="search"
            aria-label="Search fixtures"
            placeholder="Search team, venue or match"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="px-3 py-2 rounded-lg border border-cric-border bg-cric-bg text-sm text-cric-text"
          />
          <select
            aria-label="Filter by team"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            className="px-3 py-2 rounded-lg border border-cric-border bg-cric-bg text-sm text-cric-text"
          >
            <option value="">All teams</option>
            {teams.map((team) => (
              <option key={team._id} value={team._id}>
                {team.name}
              </option>
            ))}
          </select>
          {groups.length > 0 && (
            <select
              aria-label="Filter by group"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              className="px-3 py-2 rounded-lg border border-cric-border bg-cric-bg text-sm text-cric-text"
            >
              <option value="all">All groups</option>
              {groups.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setStatus(option.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider border transition ${
                status === option.value
                  ? "bg-cric-accent text-white border-cric-accent"
                  : "bg-cric-bg text-cric-muted border-cric-border hover:text-cric-text"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {!hasMatches && (
        <div className="bg-cric-card rounded-2xl shadow-sm p-12 text-center border border-cric-border">
          <p className="text-cric-muted font-bold">No fixtures have been scheduled yet.</p>
        </div>
      )}

      {hasMatches && !hasResults && (
        <div className="bg-cric-card rounded-2xl shadow-sm p-12 text-center border border-cric-border">
          <p className="text-cric-muted font-bold">No matches match your filters.</p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setTeamId("");
              setStatus("all");
              setGroup("all");
            }}
            className="mt-3 text-sm font-bold text-cric-accent hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}

      {hasResults && (
        <div className="space-y-8">
          <MatchGroup title="Live" color="bg-red-600" matches={grouped.live} />
          <MatchGroup title="Results" color="bg-green-600" matches={grouped.completed} />
          <MatchGroup title="Upcoming" color="bg-blue-600" matches={grouped.upcoming} />
        </div>
      )}
    </div>
  );
}
